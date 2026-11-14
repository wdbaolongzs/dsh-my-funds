// 通知通道：QQ 邮箱（SMTP）与 OneBot（QQ 协议端），零第三方依赖。
// SMTP 自己实现 465(隐式 TLS) 与 587(STARTTLS) 两种握手，省掉 nodemailer。

import tls from 'node:tls';
import net from 'node:net';

const CRLF = '\r\n';

function b64(text) {
  return Buffer.from(String(text), 'utf8').toString('base64');
}

function encodeHeader(text) {
  // 中文主题必须走 RFC 2047，否则 QQ 邮箱会显示乱码
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${b64(text)}?=`;
}

class SmtpSession {
  constructor(socket) {
    this.socket = socket;
    this.buffer = '';
    this.partial = '';
    this.queue = [];
    this.pending = [];
    this.closed = false;
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      this.buffer += chunk;
      let index = this.buffer.indexOf(CRLF);
      while (index >= 0) {
        const line = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + CRLF.length);
        this.onLine(line);
        index = this.buffer.indexOf(CRLF);
      }
    });
    socket.on('error', (error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('连接被服务器关闭')));
  }

  onLine(line) {
    // 多行响应（250-...）先攒着，最后一行才是一次完整回复
    if (/^\d{3}-/.test(line)) {
      this.partial += `${line}\n`;
      return;
    }
    const reply = this.partial + line;
    this.partial = '';
    const waiter = this.pending.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      if (waiter.timer.unref) waiter.timer.unref();
      const code = Number(line.slice(0, 3));
      if (code >= 400) waiter.reject(new Error(`${code}: ${line.slice(4) || line}`));
      else waiter.resolve(reply);
      return;
    }
    // 还没人等——服务器可能抢先说话了（比如连上就发 220 问候），先存起来
    this.queue.push(reply);
  }

  fail(error) {
    if (this.closed) return;
    this.closed = true;
    while (this.pending.length) {
      const waiter = this.pending.shift();
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  read(timeout = 20000) {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.pending.findIndex((item) => item.timer === timer);
        if (index >= 0) this.pending.splice(index, 1);
        reject(new Error(`等待服务器响应超时（${Math.round(timeout / 1000)}s）`));
      }, timeout);
      if (timer.unref) timer.unref();
      this.pending.push({ resolve, reject, timer });
    });
  }

  async command(line, timeout) {
    const wait = this.read(timeout);
    this.socket.write(`${line}${CRLF}`);
    return wait;
  }

  close() {
    this.closed = true;
    try {
      this.socket.end();
    } catch {
      /* ignore */
    }
  }
}

function connect({ host, port, secure }) {
  return new Promise((resolve, reject) => {
    const options = { host, port, servername: host };
    const socket = secure ? tls.connect(options, () => resolve(socket)) : net.connect(options, () => resolve(socket));
    socket.setTimeout(20000, () => {
      socket.destroy(new Error('SMTP 连接超时'));
    });
    socket.once('error', reject);
  });
}

/**
 * 发一封纯文本邮件。
 * cfg = { host, port, user, pass, to, from? }
 */
export async function sendMail(cfg, subject, body) {
  const host = cfg.host || 'smtp.qq.com';
  // 465 走隐式 TLS，587 走 STARTTLS；有的网络会拦其中一个，所以失败了换一个再试。
  const ports = [...new Set([Number(cfg.port) || 465, 465, 587])];
  let lastError = null;
  for (const port of ports) {
    try {
      return await sendViaPort({ ...cfg, host, port }, subject, body);
    } catch (error) {
      lastError = error;
      // 认证/账号类错误换端口也没用，直接抛
      if (/^\d*\s*(535|534|530|550|553)/.test(String(error.message)) || /授权码|缺少/.test(String(error.message))) break;
    }
  }
  throw lastError || new Error('发送失败');
}

async function sendViaPort(cfg, subject, body) {
  const host = cfg.host;
  const port = cfg.port;
  const secure = port === 465;
  const from = cfg.from || cfg.user;
  if (!cfg.user || !cfg.pass) throw new Error('缺少发件邮箱或授权码');
  if (!cfg.to) throw new Error('缺少收件邮箱');

  let socket = await connect({ host, port, secure });
  let session = new SmtpSession(socket);
  let stage = '处理问候';
  try {
    await session.read();
    stage = 'EHLO';
    let reply = await session.command(`EHLO my-funds`);
    if (!secure && !cfg.plain) {
      stage = 'STARTTLS';
      await session.command('STARTTLS');
      const upgraded = tls.connect({ socket, servername: host });
      await new Promise((resolve, reject) => {
        upgraded.once('secureConnect', resolve);
        upgraded.once('error', reject);
      });
      socket = upgraded;
      session = new SmtpSession(socket);
      reply = await session.command(`EHLO my-funds`);
    }
    const authLine = String(reply)
      .split(/\r?\n/)
      .find((line) => /AUTH/i.test(line)) || '';
    stage = '登录认证';
    if (/LOGIN/i.test(authLine) || !authLine) {
      await session.command('AUTH LOGIN');
      await session.command(b64(cfg.user));
      await session.command(b64(cfg.pass));
    } else if (/PLAIN/i.test(authLine)) {
      await session.command(`AUTH PLAIN ${b64(`\u0000${cfg.user}\u0000${cfg.pass}`)}`);
    } else {
      await session.command('AUTH LOGIN');
      await session.command(b64(cfg.user));
      await session.command(b64(cfg.pass));
    }
    stage = '发信人';
    await session.command(`MAIL FROM:<${from}>`);
    stage = '收信人';
    await session.command(`RCPT TO:<${cfg.to}>`);
    stage = '发送正文';
    await session.command('DATA');

    const stamp = new Date().toUTCString();
    const payload = [
      `From: ${encodeHeader('我的基金')} <${from}>`,
      `To: <${cfg.to}>`,
      `Subject: ${encodeHeader(subject)}`,
      `Date: ${stamp}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64(body).replace(/(.{76})/g, `$1${CRLF}`),
      '',
    ].join(CRLF);
    stage = '提交正文';
    // DATA 之后服务器只在收到单独的 "." 行时才回 250，中间不能等回复，
    // 否则双方互相干等到超时。正文和结束行必须一次写完再读一次。
    const submitted = session.read(30000);
    session.socket.write(`${payload}${CRLF}.${CRLF}`);
    await submitted;
    await session.command('QUIT').catch(() => {});
    return { ok: true, channel: 'mail', to: cfg.to };
  } catch (error) {
    throw new Error(`${stage}失败：${error?.message || error}`);
  } finally {
    session.close();
  }
}

/** OneBot v11（NapCat / LLOneBot）：发给私聊或群 */
export async function sendOneBot(cfg, text) {
  const base = String(cfg.base || '').replace(/\/+$/, '');
  if (!base) throw new Error('缺少 OneBot 地址');
  const target = String(cfg.target || 'private:').trim();
  const [kind, id] = target.split(':');
  const url = `${base}/${kind === 'group' ? 'send_group_msg' : 'send_private_msg'}`;
  const payload = kind === 'group' ? { group_id: Number(id), message: text } : { user_id: Number(id), message: text };
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`OneBot ${response.status}`);
  const json = await response.json().catch(() => ({}));
  if (json.status && json.status !== 'ok') throw new Error(`OneBot: ${json.message || json.wording || '失败'}`);
  return { ok: true, channel: 'onebot', target };
}

const money = (value) => {
  const number = Number(value) || 0;
  return `${number >= 0 ? '+' : '-'}${Math.abs(number).toFixed(2)}`;
};

/** 把面板数据拼成一条日报 */
const SOURCE_LABEL = {
  import: '当日实际',
  nav: '今日净值',
  gsz: '盘中估值',
  sector: '板块估算',
  prev: '昨日净值',
};

/** slot: 'morning'（早盘预估）| 'evening'（结算）| 不传按时间猜 */
export function buildReport(payload, options = {}) {
  const summary = payload.summary || {};
  const rows = summary.rows || [];
  const hour = new Date().getHours();
  const slot = options.slot || (hour < 12 ? 'morning' : 'evening');
  const estimatedRows = rows.filter((row) => ['gsz', 'sector', 'prev'].includes(row.daySource));
  const settledRows = rows.filter((row) => ['nav', 'import'].includes(row.daySource));
  const today = payload.today || '';
  const todayProfit = Number(summary.todayProfit) || 0;
  const todayPct = Number(summary.todayPct) || 0;
  const lines = [];

  if (slot === 'morning') {
    lines.push(`我的基金 ${today} 早盘预估`);
    lines.push(`预计今日 ${money(todayProfit)} (${todayPct.toFixed(2)}%)   总市值 ${(Number(summary.value) || 0).toFixed(2)}`);
    lines.push(`持有收益 ${money(summary.profit)} (${(Number(summary.profitPct) || 0).toFixed(2)}%)`);
  } else {
    const suffix = estimatedRows.length ? `（${estimatedRows.length} 只还是估算）` : '（已结算）';
    lines.push(`我的基金 ${today} 收盘结算${suffix}`);
    lines.push(`今日 ${money(todayProfit)} (${todayPct.toFixed(2)}%)   总市值 ${(Number(summary.value) || 0).toFixed(2)}`);
    lines.push(`持有收益 ${money(summary.profit)} (${(Number(summary.profitPct) || 0).toFixed(2)}%)`);
  }
  lines.push('');

  for (const row of rows) {
    const sector = row.sector && Number.isFinite(row.sector.chgPct) ? `${row.sector.label} ${row.sector.chgPct > 0 ? '+' : ''}${row.sector.chgPct}%` : '';
    const source = slot === 'morning' ? (SOURCE_LABEL[row.daySource] || '') : (SOURCE_LABEL[row.daySource] || '');
    const tail = [sector, source].filter(Boolean).join(' · ');
    lines.push(`${row.name || row.code}  ${(Number(row.value) || 0).toFixed(2)}  今日 ${money(row.todayProfit)}  持有 ${money(row.profit)}${tail ? `   ${tail}` : ''}`);
  }

  const confirmed = [];
  const pending = [];
  for (const plan of payload.plans || []) {
    const executions = Array.isArray(plan.executions) ? plan.executions : [];
    const done = executions.filter((item) => String(item.date || '') === today);
    if (done.length) confirmed.push({ plan, done });
    if (Number(plan.pendingToday) > 0) pending.push(plan);
  }
  if (confirmed.length) {
    lines.push('');
    for (const { plan, done } of confirmed) {
      const amount = done.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
      const shares = done.reduce((sum, item) => sum + (Number(item.shares) || 0), 0);
      const nav = done[done.length - 1]?.nav;
      lines.push(`今日定投已确认 ${plan.name || plan.code} ${amount.toFixed(2)} 元 · ${shares.toFixed(2)} 份${Number.isFinite(Number(nav)) ? ` @ ${Number(nav).toFixed(4)}` : ''}`);
    }
  }
  if (pending.length) {
    const total = pending.reduce((sum, plan) => sum + Number(plan.pendingToday || 0), 0);
    lines.push(`今日定投待确认 ${total.toFixed(2)} 元（等净值${slot === 'morning' ? '，晚上结算' : ''}）`);
  }

  if (slot === 'morning') {
    lines.push('');
    lines.push(estimatedRows.length === rows.length
      ? '以上按关联板块推算，净值公布后以官方为准'
      : '部分为官方净值，其余按关联板块推算');
  } else if (estimatedRows.length) {
    lines.push('');
    lines.push(`${settledRows.length} 只已用官方净值，${estimatedRows.length} 只净值未出仍为估算`);
  }

  const subject = slot === 'morning'
    ? `[早盘预估] 我的基金 ${today} ${money(todayProfit)}`
    : `[结算] 我的基金 ${today} ${money(todayProfit)}`;
  return { subject, body: lines.join('\n'), slot };
}

export function maskNotify(notify) {
  const mail = notify?.mail || {};
  return {
    ...notify,
    mail: {
      host: mail.host || 'smtp.qq.com',
      port: mail.port || 465,
      user: mail.user || '',
      to: mail.to || '',
      pass: mail.pass ? '********' : '',
      hasPass: Boolean(mail.pass),
    },
  };
}

export function mergeNotify(current, incoming) {
  const base = { enabled: false, cron: [], lastSent: '', mail: {}, onebot: {}, ...(current || {}) };
  const next = { ...base, ...(incoming || {}) };
  next.mail = { ...(base.mail || {}), ...(incoming?.mail || {}) };
  next.onebot = { ...(base.onebot || {}), ...(incoming?.onebot || {}) };
  // 密码框回传掩码（或不传）时保留原授权码；显式传空字符串才是清空
  const incomingPass = incoming?.mail && Object.prototype.hasOwnProperty.call(incoming.mail, 'pass') ? incoming.mail.pass : undefined;
  if (incomingPass === undefined || /^\*+$/.test(String(incomingPass))) {
    next.mail.pass = base.mail?.pass || '';
  } else {
    next.mail.pass = String(incomingPass);
  }
  delete next.mail.hasPass;
  if (!Array.isArray(next.cron)) next.cron = [];
  next.cron = next.cron.map((item) => String(item).trim()).filter((item) => /^\d{1,2}:\d{2}$/.test(item));
  return next;
}
