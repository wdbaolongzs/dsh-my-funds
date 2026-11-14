// Pure helpers for 我的基金 (My Funds). No I/O, no timers — host-side only.

export const STATE_VERSION = 1;

/* ---------------------------------------------------------------- dates */

const pad = (n) => String(n).padStart(2, '0');

export function ymd(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseYmd(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || '').trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

export function daysInMonth(year, month /* 1-12 */) {
  return new Date(year, month, 0).getDate();
}

/** Inclusive list of ymd strings after `from` up to `to`. */
export function datesBetween(from, to, maxDays = 400) {
  const start = parseYmd(from);
  const end = parseYmd(to);
  if (!start || !end) return [];
  const out = [];
  let cursor = addDays(start, 1);
  let guard = 0;
  while (cursor.getTime() <= end.getTime() && guard < maxDays) {
    out.push(ymd(cursor));
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return out;
}

/* --------------------------------------------------------------- numbers */

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

export function normalizeCell(text) {
  return String(text || '')
    .replace(/[\u00a0\u3000]/g, ' ')
    .replace(/[，,]/g, ',')
    .replace(/[．。]/g, '.')
    .replace(/[—–−]/g, '-')
    .replace(/[＋十]/g, '+')
    .replace(/％/g, '%')
    .replace(/\s+/g, '')
    .trim();
}

/**
 * OCR routinely swaps glyphs in thin UI text: 016452 → "0164S2", 500 → "S00",
 * 800 → "8OO". Repair only inside numeric-looking tokens so fund names survive.
 */
export function digitFix(text) {
  return String(text || '')
    .replace(/[Ss]/g, '5')
    .replace(/[Oo]/g, '0')
    .replace(/[IlL|!]/g, '1')
    .replace(/B/g, '8')
    .replace(/[Zz]/g, '2')
    .replace(/G/g, '6')
    .replace(/[Dd]/g, '0');
}

/**
 * "持有金额800.00" — OCR often glues the label and the number into one cell,
 * so also accept a trailing amount after an arbitrary short prefix.
 */
export function parseMoneySuffix(text) {
  const raw = digitFix(normalizeCell(text)).replace(/^[¥￥$]/, '');
  const m = /([+\-]?)(\d[\d,]*(?:\.\d+)?)(万|亿)?(%?)$/.exec(raw);
  if (!m) return null;
  const digits = m[2].replace(/[,]/g, '');
  const looksNumeric = digits.includes('.') || digits.length >= 3 || m[4] === '%';
  if (!looksNumeric) return null;
  let value = Number(digits);
  if (!Number.isFinite(value)) return null;
  if (m[3] === '万') value *= 1e4;
  if (m[3] === '亿') value *= 1e8;
  if (m[1] === '-') value = -value;
  return { value, percent: m[4] === '%', signed: m[1] !== '' };
}

/** parseMoney with glyph repair, used only when the raw text is not a clean number. */
function parseMoneyLoose(text) {
  const direct = parseMoney(text);
  if (direct) return direct;
  const fixed = digitFix(normalizeCell(text)).replace(/^[¥￥$]/, '');
  return /\d/.test(fixed) ? parseMoney(fixed) : null;
}

/**
 * OCR renders a minus sign as a middle dot and a decimal point as the same dot
 * ("· 6 · 30" is -6.30, "970 · 72" is 970.72). A leading dot therefore means
 * negative; the rest become decimal points. Decoration brackets are dropped.
 */
function repairSigns(text) {
  let t = String(text || '').replace(/\s+/g, '');
  let neg = false;
  if (/^[·・‧∙−－—]/.test(t) || /^一(?=\d)/.test(t)) {
    neg = true;
    t = t.slice(1);
  }
  // 「·」「．」「，」 are all used by the OCR for a decimal point / minus sign.
  t = t.replace(/^[¥￥$]/, '');
  t = t.replace(/[·・‧∙．]/g, '.');
  t = t.replace(/^(\d{1,3})[,，](\d{1,2})(?=%|$)/, '$1.$2');
  t = t.replace(/^(\d{1,3})[,，](\d{3})(?=%|$)/, '$1$2');
  t = t.replace(/\s*(?:%|％)/g, '%').replace(/(?:元|人民币|圆)\s*$/, '');
  return { text: t, neg };
}

export function parseMoney(text) {
  const repaired = repairSigns(normalizeCell(text));
  let raw = repaired.text
    .replace(/[（）()\[\]【】「」]/g, '')
    .replace(/^[¥￥$]/, '')
    .replace(/^一(?=\d)/, '-')
    .replace(/\s+/g, '');
  if (repaired.neg && !/^[+-]/.test(raw)) raw = `-${raw}`;
  const m = /^([+-]?)(\d[\d,]*(?:\.\d+)?)(万|亿)?(%?)$/.exec(raw);
  if (!m) return null;
  let value = Number(m[2].replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  if (m[3] === '万') value *= 1e4;
  if (m[3] === '亿') value *= 1e8;
  if (m[1] === '-') value = -value;
  return { value, percent: m[4] === '%', signed: m[1] !== '' };
}

/* ---------------------------------------------------------- OCR layout */

/**
 * Windows OCR yields one word per CJK glyph and, on tables, one line per
 * column. So: merge glyphs inside a line into cells, then walk lines top-down
 * attaching amount/code lines to the fund name line above them.
 */
function buildCells(words) {
  const items = [];
  for (const word of words || []) {
    const text = String(word.t ?? word.text ?? '').trim();
    if (!text) continue;
    items.push({
      text,
      x: Number(word.x) || 0,
      w: Number(word.w) || 0,
      h: Number(word.h) || 12,
      cy: (Number(word.y) || 0) + (Number(word.h) || 12) / 2,
    });
  }
  items.sort((a, b) => a.x - b.x);
  const cells = [];
  for (const item of items) {
    const last = cells[cells.length - 1];
    if (last) {
      const gap = item.x - (last.x + last.w);
      const limit = Math.max(8, Math.min(item.h, last.h) * 0.6);
      if (gap <= limit) {
        const glueSpace = !CJK.test(last.text.slice(-1)) && !CJK.test(item.text[0]) && gap > 4;
        last.text = glueSpace ? `${last.text} ${item.text}` : last.text + item.text;
        last.w = item.x + item.w - last.x;
        last.cy = (last.cy + item.cy) / 2;
        continue;
      }
    }
    cells.push({ text: item.text, x: item.x, w: item.w, h: item.h, cy: item.cy });
  }
  return cells;
}

export function ocrLines(payload) {
  const lines = [];
  for (const line of payload?.lines || []) {
    const cells = buildCells(line.words);
    if (!cells.length) continue;
    const cy = cells.reduce((sum, cell) => sum + cell.cy, 0) / cells.length;
    lines.push({ cy, cells });
  }
  return lines.sort((a, b) => a.cy - b.cy);
}

const FUNDISH = /(基金|指数|混合|债券|股票|货币|理财|LOF|ETF|联接|连接|QDII|FOF|增强|灵活|成长|价值|红利|消费|医药|科技|新能源|中证|沪深|纳斯达克|标普|全球|养老|短债|纯债|同业|存单|余额|债券|精选|优选|回报|精选|量化|债|稳|纯|宝)/i;

const LABEL = /^(总金额|总资产|总市值|总收益|总盈亏|累计|昨日|今日|合计|持仓金额|持有金额|持有收益|持仓收益|参考市值|可用|份额|净值|成本|买入|定投|估值|涨跌幅|收益率|年化|盈亏|金额|收益|市值|名称|基金代码|代码|万元|七日|万份)/;
const LABEL_ANY = /(总资产|总金额|总市值|总收益|总盈亏|累计收益|昨日收益|昨日盈亏|今日收益|今日盈亏|持有收益|持仓收益|参考市值|合计|基金代码|净值估算|盘中估值|万份收益|七日年化)/;
const NAME_REJECT = /(下次|扣款|扣费|累计|每期|每\s*月|每\s*周|定投金额|计划|进行中|暂停|已终止|修改|协议|合计|总额|涨跌幅|净值|市值|金额|资产|持仓收益|持有收益|昨日收益|今日收益)/;

function looksLikeName(text) {
  const clean = String(text || '').trim();
  if (clean.length < 3) return false;
  const cjk = (clean.match(/[\u3400-\u9fff]/g) || []).length;
  if (cjk < 2) return false;
  if (/^[\d.,%+\-\s]+$/.test(clean)) return false;
  if (LABEL_ANY.test(clean)) return false;
  if (NAME_REJECT.test(clean)) return false;
  if (/^[、，,。.；;:：!！?？\-—·]/.test(clean)) return false;
  return FUNDISH.test(clean) || cjk >= 4;
}

function parseCells(cells) {
  const numbers = [];
  let code = null;
  const nameParts = [];
  for (const cell of cells) {
    const text = normalizeCell(cell.text);
    if (!text) continue;
    const digitText = digitFix(text);
    const found = /(?:^|\D)(\d{6})(?:\D|$)/.exec(digitText);
    if (found && !code && (/^\d{6}$/.test(digitText) || /代码|基金/.test(cell.text))) {
      code = found[1];
      continue;
    }
    const money = parseMoneyLoose(text) || parseMoneySuffix(text);
    if (money) {
      numbers.push(money);
      continue;
    }
    const plain = String(cell.text).replace(/\s+/g, '');
    if (LABEL.test(plain)) continue;
    if (looksLikeName(plain)) nameParts.push(plain);
  }
  const name = nameParts.sort((a, b) => b.length - a.length)[0] || '';
  return { name, code, numbers };
}

function pickValue(numbers) {
  const money = numbers.filter((item) => !item.percent);
  const percents = numbers.filter((item) => item.percent);
  const positives = money.filter((item) => item.value > 0).sort((a, b) => b.value - a.value);
  let value = positives.length ? positives[0].value : null;
  let profit = null;
  const others = money.filter((item) => item.value !== value);
  const signed = others.filter((item) => item.signed).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  if (signed.length) profit = signed[0].value;
  else if (positives.length > 1) profit = positives[1].value;
  const pct = percents.length ? percents[0].value : null;
  return { value, profit, pct };
}

const HARD_HEADER = /(总资产|总金额|总市值|总收益|总盈亏|累计收益|我的持仓|持仓明细|收益明细|资产分析|昨日收益明细)/;
const ANCHOR_WINDOW = 40;
const ATTACH_WINDOW = 70;

/* 定投计划识别：截图里出现“定投/扣款/每期/每月N日/每周X”等字样即视为定投行 */
const PLAN_HINT = /(定投|扣款|扣费|每期|每月|每周|每星期|每个交易日|每交易日|自动买入|定投协议)/;
const PLAN_WINDOW = 240;
const HOLD_LABEL = /(持有|持仓|参考市值|市值|金额|资产)/;
const PLAN_LINE = /(每\s*个?月|每\s*个?周|每个交易日|每交易日|每星期|扣款|下期|下次|定投)/;
const PLAN_SKIP = /(累计|已投|总额|总金额|合计|持有|市值|收益|份额|盈亏)/;
const PLAN_HEADER = /^(我的定投|定投计划|定投列表|定投管理|定投详情|定投设置|计划详情|定投协议)$/;
const WEEKDAY_MAP = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 0 };

/** 从一段文字里读扣款周期：每个交易日 / 每周X / 每月N日。 */
export function parsePlanCycle(text) {
  const t = normalizeCell(text);
  if (/每(?:个)?交易日|每日|每天|日定投/.test(t)) return { cycle: "daily" };
  const weekly = /每(?:周|星期|礼拜)\s*(?:周)?([一二三四五六日天1-7])/.exec(t);
  if (weekly) {
    const weekday = WEEKDAY_MAP[weekly[1]];
    if (weekday != null) return { cycle: "weekly", weekday };
  }
  const monthly = /每(?:个)?月\s*(\d{1,2})\s*[日号]?/.exec(t);
  if (monthly) return { cycle: "monthly", day: Math.min(31, Math.max(1, Number(monthly[1]))) };
  if (/月定投|月投/.test(t)) return { cycle: "monthly", day: 1 };
  if (/周定投|周投/.test(t)) return { cycle: "weekly", weekday: 1 };
  return null;
}

function planMeta(texts, moneyCells) {
  const joined = texts.join(" ");
  if (!PLAN_HINT.test(joined)) return null;
  const cycle = parsePlanCycle(joined);
  const plain = moneyCells.filter((cell) => !cell.percent && cell.value > 0 && !/^\d{6}$/.test(cell.text));
  const usable = plain.filter((cell) => !PLAN_SKIP.test(cell.text));
  const pool = usable.length ? usable : plain;
  const amount = pool.length ? pool.reduce((min, cell) => Math.min(min, cell.value), pool[0].value) : null;
  const next = /(?:下次|下期)[^\d]{0,6}(\d{1,2})\s*[-一－—~～\/.月]\s*(\d{1,2})/.exec(joined);
  return {
    cycle: cycle?.cycle || "monthly",
    weekday: cycle?.weekday ?? 1,
    day: cycle?.day ?? 1,
    amount,
    cycleKnown: Boolean(cycle),
    nextHint: next ? `${Number(next[1])}-${pad(Number(next[2]))}` : "",
  };
}

function assembleRows(lines) {
  const anchors = [];
  const floaters = [];
  const textFloaters = [];

  for (const line of lines) {
    const parsed = parseCells(line.cells);
    const lineText = line.cells.map((cell) => cell.text).join("");
    if (HARD_HEADER.test(lineText)) continue;
    if (PLAN_HEADER.test(normalizeCell(lineText))) continue;

    const moneyCells = line.cells
      .map((cell) => {
        const text = normalizeCell(cell.text);
        const money = parseMoney(text) || parseMoneyLoose(text) || parseMoneySuffix(text);
        return money ? { ...money, text } : null;
      })
      .filter(Boolean);

    const planLike = PLAN_LINE.test(normalizeCell(lineText));
    const isAnchor = Boolean(parsed.name || parsed.code);
    if (isAnchor) {
      const prev = anchors[anchors.length - 1];
      const close = prev && Math.abs(prev.cy - line.cy) <= ANCHOR_WINDOW;
      const complementary = prev && (!prev.name || !parsed.name) && (prev.code || parsed.code);
      const prevBare = prev && prev.name && parsed.name && !prev.numbers.length && !prev.moneyCells.length;
      if (close && (complementary || prevBare)) {
        prev.name = prev.name || parsed.name;
        prev.code = prev.code || parsed.code;
        prev.numbers.push(...parsed.numbers);
        prev.moneyCells.push(...moneyCells);
        prev.texts.push(lineText);
        prev.ys.push(line.cy);
        prev.cy = prev.ys.reduce((sum, y) => sum + y, 0) / prev.ys.length;
        continue;
      }
      anchors.push({
        cy: line.cy,
        ys: [line.cy],
        name: parsed.name,
        code: parsed.code,
        numbers: parsed.numbers.slice(),
        moneyCells,
        texts: [lineText],
      });
      continue;
    }
    if (moneyCells.length) floaters.push({ cy: line.cy, numbers: parsed.numbers, moneyCells, planLike, text: normalizeCell(lineText) });
    else if (normalizeCell(lineText).length >= 2) textFloaters.push({ cy: line.cy, text: normalizeCell(lineText), planLike });
  }

  // Measure the gap to the anchor's vertical band, not its centre: a name line
  // plus its code line forms a two-line block and amounts sit just below it.
  const attach = (cy, apply) => {
    let best = null;
    let bestGap = Infinity;
    for (const anchor of anchors) {
      const ys = anchor.ys && anchor.ys.length ? anchor.ys : [anchor.cy];
      const top = Math.min(...ys);
      const bottom = Math.max(...ys);
      const gap = cy < top ? top - cy : cy > bottom ? cy - bottom : 0;
      if (gap < bestGap) {
        bestGap = gap;
        best = anchor;
      }
    }
    if (best && bestGap <= ATTACH_WINDOW) apply(best);
    return best ? { best, bestGap } : null;
  };

  const firstY = anchors.length ? anchors[0].cy : Infinity;
  // The DCA plan block sits well below the position block on fund-company pages,
  // so plan-like lines get a wider reach before falling back to the closest row.
  const attachPlan = (cy, apply) => {
    const near = attach(cy, apply);
    if (near && near.bestGap <= ATTACH_WINDOW) return;
    let best = null;
    let bestGap = Infinity;
    for (const anchor of anchors) {
      const ys = anchor.ys && anchor.ys.length ? anchor.ys : [anchor.cy];
      const gap = cy < Math.min(...ys) ? Math.min(...ys) - cy : cy > Math.max(...ys) ? cy - Math.max(...ys) : 0;
      if (gap < bestGap) {
        bestGap = gap;
        best = anchor;
      }
    }
    if (best && bestGap <= PLAN_WINDOW) apply(best);
  };
  for (const floater of floaters) {
    if (floater.cy < firstY - 25) continue;
    const apply = (anchor) => {
      // A "每月10日 200.00" line belongs to the DCA plan, not to the holding P/L.
      if (!floater.planLike) anchor.numbers.push(...floater.numbers);
      else if (floater.text) anchor.texts.push(floater.text);
      anchor.moneyCells.push(...floater.moneyCells);
    };
    if (floater.planLike) attachPlan(floater.cy, apply);
    else attach(floater.cy, apply);
  }
  for (const floater of textFloaters) {
    if (floater.cy < firstY - 25) continue;
    if (floater.planLike) attachPlan(floater.cy, (anchor) => anchor.texts.push(floater.text));
    else attach(floater.cy, (anchor) => anchor.texts.push(floater.text));
  }

  const out = [];
  for (const anchor of anchors) {
    if (!anchor.name && !anchor.code) continue;
    const plan = planMeta(anchor.texts, anchor.moneyCells);
    const { value, profit, pct } = pickValue(anchor.numbers);
    // A fund-company block often carries the position AND its DCA plan under one
    // name; emit both rows instead of letting the plan swallow the holding.
    const planName = anchor.name || "";
    const planPlausible = plan && !PLAN_AD.test(`${planName} ${(anchor.texts || []).join(" ")}`) && (plan.amount != null || (plan.cycleKnown && FUNDISH.test(planName)));
    if (planPlausible) {
      out.push({
        isPlan: true,
        code: anchor.code,
        name: anchor.name,
        amount: plan.amount,
        cycle: plan.cycle,
        weekday: plan.weekday,
        day: plan.day,
        nextHint: plan.nextHint,
        cycleKnown: plan.cycleKnown,
        needsReview: !anchor.code || !plan.cycleKnown || plan.amount == null,
      });
    }
    const holdingMoney = anchor.moneyCells.some((cell) => HOLD_LABEL.test(cell.text));
    if (plan && (value != null || profit != null) && !holdingMoney && anchor.numbers.length < 2) continue;
    if (value == null && profit == null) continue;
    out.push({
      isPlan: false,
      code: anchor.code,
      name: anchor.name,
      value,
      profit,
      pct,
      needsReview: !anchor.code || (profit == null && pct == null),
    });
  }

  const seen = new Set();
  return out.filter((item) => {
    const key = item.isPlan
      ? `plan|${item.code || ""}|${item.name}|${Math.round((item.amount || 0) * 100)}`
      : `${item.code || ""}|${item.name}|${Math.round((item.value || 0) * 100)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const stripRow = (row) => {
  const { isPlan, ...rest } = row;
  void isPlan;
  return rest;
};

/** 持仓行（不含定投行）。 */
export function assembleFunds(lines) {
  return assembleRows(lines).filter((row) => !row.isPlan).map(stripRow);
}

/** 定投行。 */
export function assemblePlans(lines) {
  return assembleRows(lines).filter((row) => row.isPlan).map(stripRow);
}


/* ------------------------------------------------ label-over-value grid */

/* 国泰/天天「持仓」这类版式：标签在上、数值在下，而且不显示基金代码。 */
const GRID_LABEL_RULES = [
  { kind: 'nav', re: /(单位净值|最新净值|净值估算|净值)/ },
  // 「涨跌幅 / 收益率」must be checked before the generic 收益 rule.
  { kind: 'pct', re: /(涨跌幅|涨幅|跌幅|收益率)/ },
  { kind: 'day', re: /(昨日收益|当日收益|今日收益|日收益|昨日盈亏|今日盈亏|^收益$)/ },
  { kind: 'profit', re: /(持有收益|持仓收益|累计收益|总收益|持有盈亏|累计盈亏|收益|盈亏)/ },
  { kind: 'value', re: /(持有金额|持仓金额|持有市值|持仓市值|参考市值|总市值|市值|金额|资产)/ },
];
const GRID_LABEL_SKIP = /(份额|成本|费率|日期|时间|代码|名称|定投|手续费)/;
const GRID_NAME_SKIP = /(搜索|全部渠道|按市值|持有中|已赎回|基金购买|交易查询|我的定投|产品解读|我的基金|返回|提示|广告)/;
/* 营销文案/数据行不能当基金名：带小数的行一律跳过，否则「单位净值 2.1390」会顶掉真名字。 */
const GRID_NAME_REJECT = /(单位净值|净值估算|收益更新中|交易确认中|排序|历史持有|购买其他|锦囊|定投好基|涨多跌少|去看看|近\d+年)/;
const PLAN_AD = /(锦囊|定投好基|收益超|涨多跌少|近\d+年|去看看|推荐|广告|活动|领取|红包)/;

function gridKind(label) {
  if (GRID_LABEL_SKIP.test(label)) return null;
  for (const rule of GRID_LABEL_RULES) if (rule.re.test(label)) return rule.kind;
  return null;
}

/**
 * Pair every label with the number printed directly beneath it, then bind the
 * pair to the nearest fund name above the label. Used when the row-based walker
 * cannot find any holding (label-above layouts, screenshots without fund codes).
 */
export function parseLabelGrid(lines) {
  const all = [];
  for (const line of lines) {
    for (const cell of line.cells) all.push({ ...cell, cx: cell.x + cell.w / 2 });
  }
  const numbers = all
    .map((cell) => {
      const money = parseMoney(cell.text) || parseMoneyLoose(cell.text);
      return money && /\d/.test(cell.text) ? { ...cell, money } : null;
    })
    .filter(Boolean);
  const nameScore = (text) => (FUNDISH.test(text) ? 2 : 0) + (String(text).replace(/[^\u3400-\u9fff]/g, "").length >= 6 ? 1 : 0);
  const names = all.filter((cell) => {
    const text = normalizeCell(cell.text);
    if (/\d\s*[.．]\s*\d/.test(text) || /[%％]/.test(text)) return false;
    return !GRID_NAME_SKIP.test(text) && !GRID_NAME_REJECT.test(text) && looksLikeName(text);
  });

  // OCR splits a title like「南方纳斯达克100指数发起（QDII）A」into several cells; rebuild it from
  // the same visual line so A / I share classes stay distinct rows.
  const expandName = (cell) => {
    const sameLine = all
      .filter((item) => Math.abs(item.cy - cell.cy) <= 10 && item.x >= cell.x)
      .sort((a, b) => a.x - b.x);
    let text = normalizeCell(cell.text);
    let right = cell.x + cell.w;
    for (const item of sameLine.slice(1)) {
      const raw = normalizeCell(item.text);
      if (!raw) continue;
      // 「I」类份额常被 OCR 读成《/〈/l，这里按上下文还原成 I。
      const part = /^[《〈｛\{l|]+$/.test(raw) && /[）)]$/.test(text) ? 'I' : raw;
      const suffix = /^[（(]/.test(part) || /^[A-Za-z]{1,2}$/.test(part) || /^[A-Za-z]类$/.test(part);
      if (!suffix) break;
      if (item.x - right > 140) break;
      text += part;
      right = item.x + item.w;
    }
    return text;
  };

  const used = new Set();
  const found = [];
  for (const cell of all) {
    const label = normalizeCell(cell.text)
      .replace(/^\d{1,2}\s*[-一－—]\s*\d{1,2}\s*/, '')
      .replace(/[（(][^）)]*[）)]/g, '');
    if (!label || /\d/.test(label)) continue;
    const kind = gridKind(label);
    if (!kind) continue;
    const below = numbers
      .filter((item) => !used.has(item) && item.cy > cell.cy && item.cy - cell.cy <= 130)
      .filter((item) => Math.abs(item.cx - cell.cx) <= Math.max(120, cell.w))
      .filter((item) => (item.money.percent ? kind === 'pct' || kind === 'nav' : kind !== 'pct'))
      .sort((a, b) => (a.cy - b.cy) || (Math.abs(a.cx - cell.cx) - Math.abs(b.cx - cell.cx)));
    if (!below.length) continue;
    used.add(below[0]);
    const above = names
      .filter((item) => item.cy < cell.cy && cell.cy - item.cy <= 480)
      .sort((a, b) => (nameScore(normalizeCell(b.text)) - nameScore(normalizeCell(a.text))) || (b.cy - a.cy))[0];
    found.push({ kind, value: below[0].money.value, name: above ? expandName(above) : '' });
  }

  // Some layouts print the market value on the same line as the title (right aligned),
  // with only 收益/涨跌幅 under labels. Pick it up from the title line itself.
  for (const nameCell of names) {
    const inline = numbers
      .filter((item) => Math.abs(item.cy - nameCell.cy) <= 18 && item.cx > nameCell.x + nameCell.w * 0.45)
      .filter((item) => !item.money.percent && item.money.value > 0)
      .sort((a, b) => b.money.value - a.money.value)[0];
    if (inline && !used.has(inline)) {
      used.add(inline);
      found.push({ kind: 'value', value: inline.money.value, name: expandName(nameCell) });
    }
  }

  found.sort((a, b) => (a.name ? 0 : 1) - (b.name ? 0 : 1));
  const uniqueNames = [...new Set(found.map((item) => item.name).filter(Boolean))];
  const groups = new Map();
  for (const item of found) {
    const name = item.name || (uniqueNames.length === 1 ? uniqueNames[0] : '');
    if (!name) continue;
    const group = groups.get(name) || { name, code: null, value: null, profit: null, pct: null };
    if (item.kind === 'value' && group.value == null) group.value = item.value;
    if (item.kind === 'profit' && group.profit == null) group.profit = item.value;
    if (item.kind === 'pct' && group.pct == null) group.pct = item.value;
    if (item.kind === 'day' && group.day == null) group.day = item.value;
    groups.set(name, group);
  }
  return [...groups.values()]
    .filter((row) => Number.isFinite(row.value) && row.value > 0)
    .map((row) => ({ ...row, needsReview: row.profit == null }));
}


/* --------------------------------------------------- header + column grid */

/* 支付宝/天天/蛋卷的「持有」列表：表头一行定列，下面每只基金一行，不显示代码。 */
const TABLE_NAME_SKIP = /(财富号|产品月报|更多产品|销售服务|本页面|收益数据|过往业绩|市场有风险|投资需谨慎|基金市场|排行|自选|持有|搜索|全部渠道|按市值|已赎回|基金购买|交易查询|我的定投|我的持有|产品解读|我的基金|返回|提示|广告|更新时间|更新中|基金|精选|资讯|公告)/;
const TABLE_HEADER_KINDS = [
  { kind: 'day', re: /(昨日收益|当日收益|今日收益|昨日盈亏|今日盈亏)/ },
  { kind: 'profit', re: /(持有收益|持仓收益|累计收益|收益|盈亏)/ },
  { kind: 'pct', re: /^(收益率|率|涨跌幅)/ },
  { kind: 'value', re: /(金额|市值|资产)/ },
  { kind: 'name', re: /^(名称|基金名称)/ },
];

function headerKinds(text) {
  const plain = normalizeCell(text).replace(/[（(][^）)]*[）)]/g, '').replace(/元|人民币/g, '');
  if (!plain || /\d/.test(plain)) return [];
  const parts = plain.split(/[\/／]/).map((part) => part.trim()).filter(Boolean);
  const kinds = [];
  for (const part of parts) {
    const hit = TABLE_HEADER_KINDS.find((rule) => rule.re.test(part));
    if (hit) kinds.push(hit.kind);
  }
  return kinds;
}

/**
 * 表头定列版式：表头一行（名称 / 金额/昨日收益 / 持有收益/率），下面每只基金
 * 一行，数字按列归属；同一列有两个值时，按从上到下顺序对应两个表头。
 */
// 「资产详情」页（基金公司 APP 点进单只基金）比持仓列表更新、还带份额与成本，
// 是最准的一版：优先认它。版式是「三列标签一行、三个数字在下一行」，
// 所以按视觉行 + 列位置配对，不能按 OCR 的行顺序。
// 放大后重认的小块文字里抽数字（「+ 9 ． 62」→ 9.62）。
export function parsePatchNumber(text) {
  const squashed = String(text || '')
    .replace(/\s+/g, '')
    .replace(/[．·・‧∙。]/g, '.')
    .replace(/[－—–~～]/g, '-')
    .replace(/一(?=\d)/g, '-')
    .replace(/[^\d.\-+]/g, '');
  const match = /([+\-]?)(\d+(?:\.\d{1,2})?)/.exec(squashed);
  if (!match) return null;
  const value = Number(match[2]);
  if (!Number.isFinite(value)) return null;
  return match[1] === '-' ? -value : value;
}

export function parseAssetPage(lines, todayStr) {
  const today = todayStr || '';
  const squash = (text) => String(text == null ? '' : text)
    .replace(/\s+/g, '')
    .replace(/[．·・‧∙。]/g, '.')
    .replace(/[－—–~～]/g, '-')
    .replace(/一(?=\d)/g, '-')
    .replace(/，/g, ',');
  // 「1,143.48」的逗号是千分位、「2,1870」的逗号是小数点。
  const assetNumber = (text) => {
    const plain = squash(text);
    // 「○」「O」「①」这类图标不能被 digitFix 成 0。
    if (!/\d/.test(plain)) return null;
    let raw = digitFix(plain).replace(/[（）()【】「」\[\]]/g, '');
    const percent = /[%％]/.test(raw);
    raw = raw.replace(/[^\d.,\-+]/g, '');
    // 「· 3· 98 ％」这种多点数字：只保留最后一个点当小数点。
    if ((raw.match(/\./g) || []).length > 1) {
      const last = raw.lastIndexOf('.');
      raw = raw.slice(0, last).replace(/\./g, '') + raw.slice(last);
    }
    if (!/\d/.test(raw)) return null;
    let negative = false;
    if (/^-/.test(raw)) {
      negative = true;
      raw = raw.slice(1);
    }
    if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(raw)) raw = raw.replace(/,/g, '');
    else raw = raw.replace(/,/g, '.');
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    return { value: negative ? -value : value, percent, hadDot: /\./.test(raw) };
  };

  // 视觉行：同一 y 的格子聚成一行；行内按 x 排序，小间距合并成「块」（中文被逐字切开）。
  const cells = [];
  for (const line of lines) {
    for (const cell of line.cells) {
      const text = squash(cell.text);
      if (!text) continue;
      cells.push({ text, x: cell.x, x1: cell.x + cell.w, cx: cell.x + cell.w / 2, cy: line.cy });
    }
  }
  cells.sort((a, b) => a.cy - b.cy || a.x - b.x);
  const vrows = [];
  for (const cell of cells) {
    const last = vrows[vrows.length - 1];
    if (last && Math.abs(cell.cy - last.cy) <= 16) last.cells.push(cell);
    else vrows.push({ cy: cell.cy, cells: [cell] });
  }
  for (const row of vrows) {
    row.cells.sort((a, b) => a.x - b.x);
    const chunks = [];
    for (const cell of row.cells) {
      const prev = chunks[chunks.length - 1];
      if (prev && cell.x - prev.x1 <= 26) {
        // 再 squash 一次：单个「一」格子单独看不成负号，拼起来才认得出。
        prev.text = squash(prev.text + cell.text);
        prev.x1 = Math.max(prev.x1, cell.x1);
        prev.cx = (prev.x0 + prev.x1) / 2;
      } else {
        chunks.push({ text: cell.text, x0: cell.x, x1: cell.x1, cx: (cell.x + cell.x1) / 2, y: cell.y, cy: cell.cy });
      }
    }
    row.chunks = chunks;
  }

  const pageText = vrows.map((row) => squash(row.chunks.map((chunk) => chunk.text).join(''))).join('|');
  // 「资产详情 / 持仓详情 / 持有详情」是点进单只基金那一页的统称，各 App 文案不同。
  const isDetailPage = /(资产详情|持仓详情|持有详情)/.test(pageText);
  if (!isDetailPage && !/基金资产/.test(pageText)) return null;
  if (!/(金额|基金资产)/.test(pageText)) return null;
  if (!/(收益|净值|份额)/.test(pageText)) return null;

  // 标签所在块的下一行、水平最接近的块 = 它的数值。
  const labelValue = (matcher) => {
    for (let i = 0; i < vrows.length; i += 1) {
      const label = vrows[i].chunks.find((chunk) => matcher.test(chunk.text));
      if (!label) continue;
      // 「持有份额 233.46」「待确认金额 0.00」这类是标签和数值并排在同一行。
      // 同一行里和这个数字挨着的其他数字碎块（OCR 常把 9.62 拆成「+9」「2」）。
      const siblingsOf = (row, first) => row.chunks
        .filter((chunk) => chunk !== first
          && Math.abs(chunk.cy - first.cy) <= 30
          && assetNumber(chunk.text)
          && !/[%％]/.test(chunk.text)
          && chunk.x0 >= first.x0 - 40
          && chunk.x0 - first.x1 <= 60)
        .sort((a, b) => a.x0 - b.x0);
      const fieldOf = (row, first) => {
        const all = [first, ...siblingsOf(row, first)].sort((a, b) => a.x0 - b.x0);
        const left = Math.min(...all.map((chunk) => chunk.x0));
        const right = Math.max(...all.map((chunk) => chunk.x1));
        let hole = 0;
        for (let k = 1; k < all.length; k += 1) hole = Math.max(hole, all[k].x0 - all[k - 1].x1);
        const text = all.map((chunk) => chunk.text).join('');
        const midY = all.reduce((sum, chunk) => sum + (chunk.cy || 0), 0) / all.length;
        return {
          // 裁一小块放大重认：左右各留点余量，别把数字边缘切掉。
          box: [Math.max(0, left - 30), Math.max(0, Math.round(midY) - 46), right - left + 150, 92],
          // 中间有明显空隙 + 最终文本没有小数点 = 数字被读漏了，值得放大再认一次。
          // 空隙没补上，或者数字里混进了字母（78Z34），都值得放大再认一次。
          suspect: (hole > 25 && !/\./.test(squash(text))) || /[A-Za-z]/.test(text),
          hole,
          text,
        };
      };

      const inline = vrows[i].chunks
        .filter((chunk) => chunk.x0 >= label.x1 && chunk.x0 - label.x1 <= 220)
        .map((chunk) => ({ chunk, money: assetNumber(chunk.text) }))
        .filter((item) => item.money);
      if (inline.length) {
        inline.sort((a, b) => a.chunk.x0 - b.chunk.x0);
        return { money: inline[0].money, label: label.text, field: fieldOf(vrows[i], inline[0].chunk) };
      }
      for (let j = i + 1; j < Math.min(vrows.length, i + 3); j += 1) {
        const candidates = vrows[j].chunks
          .map((chunk) => ({ chunk, money: assetNumber(chunk.text) }))
          .filter((item) => item.money && Math.abs(item.chunk.cx - label.cx) <= Math.max(150, (label.x1 - label.x0) * 1.6));
        if (candidates.length) {
          candidates.sort((a, b) => Math.abs(a.chunk.cx - label.cx) - Math.abs(b.chunk.cx - label.cx));
          return { money: candidates[0].money, label: label.text, field: fieldOf(vrows[j], candidates[0].chunk) };
        }
      }
      return { money: null, label: label.text, field: null };
    }
    return null;
  };
  const findChunk = (matcher) => {
    for (const row of vrows) {
      const chunk = row.chunks.find((item) => matcher.test(item.text));
      if (chunk) return chunk;
    }
    return null;
  };

  const valueHit = labelValue(/^(基金资产|金额)/);
  const dayHit = labelValue(/^(今日收益|日收益|当日收益|\d{1,2}-\d{1,2}收益)/);
  const profitHit = labelValue(/^(持仓收益|持有收益)(?!率)/);
  const pctHit = labelValue(/^(持仓收益率|持有收益率|持仓涨跌幅|收益率)/);
  const pendingHit = labelValue(/^待确认金额/);

  // OCR 经常把小数点整颗丢掉（787.34→78Z34、21.86%→2L86%），所以每个数都给出两种可能，
  // 再用「收益率 = 收益 /（市值 − 收益）」这个恒等式把不合理的那种筛掉。
  const candidatesOf = (hit) => {
    if (!hit || !hit.money) return [];
    const list = [hit.money.value];
    if (!hit.money.hadDot && Math.abs(hit.money.value) >= 1000) list.push(hit.money.value / 100);
    return list;
  };
  const impliedPct = (value, profit) => (value != null && profit != null && value - profit !== 0
    ? (profit / (value - profit)) * 100
    : null);

  let profit = candidatesOf(profitHit)[0] ?? null;
  let pctRaw = candidatesOf(pctHit).find((item) => Math.abs(item) <= 100) ?? null;
  // OCR 常把负号读丢（「· 3· 98 ％」），收益率与收益同号基本恒成立。
  if (pctRaw != null && profit != null && pctRaw !== 0 && Math.sign(pctRaw) !== Math.sign(profit)) {
    pctRaw = -pctRaw;
  }
  let value = null;
  const valueOptions = candidatesOf(valueHit);
  if (valueOptions.length === 1) {
    value = valueOptions[0];
  } else if (valueOptions.length > 1) {
    if (pctRaw != null && profit != null) {
      let best = valueOptions[0];
      let bestGap = Infinity;
      for (const option of valueOptions) {
        const implied = impliedPct(option, profit);
        if (implied == null) continue;
        const gap = Math.abs(implied - pctRaw);
        if (gap < bestGap) {
          bestGap = gap;
          best = option;
        }
      }
      value = best;
    } else {
      value = valueOptions.find((item) => Math.abs(item) < 1e5) ?? valueOptions[0];
    }
  }
  if (value == null && profit != null) value = null;

  const dayOptions = (() => {
    if (!dayHit || !dayHit.money) return [];
    const list = [dayHit.money.value];
    if (!dayHit.money.hadDot && Math.abs(dayHit.money.value) >= 100) list.push(dayHit.money.value / 100);
    return list;
  })();
  let day = dayOptions[0] ?? null;
  if (dayOptions.length > 1) {
    const bound = value != null ? Math.max(1, Math.abs(value) * 0.3) : Infinity;
    const within = dayOptions.filter((item) => Math.abs(item) <= bound);
    day = within.length ? within.sort((a, b) => Math.abs(b) - Math.abs(a))[0] : dayOptions[0];
  }
  let pct = value != null && profit != null
    ? Math.round((impliedPct(value, profit) || 0) * 100) / 100
    : pctRaw;
  if (pctRaw != null && pct != null && Math.abs(pctRaw - pct) <= 0.5) pct = pctRaw;

  const rowTexts = vrows.map((row) => squash(row.chunks.map((chunk) => chunk.text).join('')));
  const scan = (matcher) => {
    for (const text of rowTexts) {
      const match = matcher.exec(text);
      if (match) return match;
    }
    return null;
  };

  let nav = null;
  let navChg = null;
  let shares = null;
  let avgCost = null;
  let dayDate = null;
  const navMatch = scan(/最新净值([\d,.]*\d)(?:[（(]([+\-]?[\d.]+)[%％])?/);
  if (navMatch) {
    const base = assetNumber(navMatch[1]);
    if (base) nav = base.value;
    if (navMatch[2] != null) navChg = Number(navMatch[2]);
  }
  const shareMatch = scan(/持有份额([\d,.]*\d)/);
  if (shareMatch) {
    const parsed = assetNumber(shareMatch[1]);
    if (parsed) shares = parsed.value;
  }
  const avgMatch = scan(/平均成本([\d,.]*\d)/);
  if (avgMatch) {
    const parsed = assetNumber(avgMatch[1]);
    if (parsed) avgCost = parsed.value;
  }
  if (dayHit) {
    const dated = /(\d{1,2})-(\d{1,2})/.exec(dayHit.label || '');
    const year = (today || String(new Date().getFullYear())).slice(0, 4);
    if (dated) {
      dayDate = `${year}-${String(dated[1]).padStart(2, '0')}-${String(dated[2]).padStart(2, '0')}`;
    } else if (/今日|当日/.test(dayHit.label || '')) {
      dayDate = today || null;
    }
  }
  if (!value && !profit) return null;

  const codeChunk = findChunk(/^\d{6}$/);
  let nameText = '';
  const NAME_BLOCK = /(资产详情|持仓详情|持有详情|基金详情|中高风险|中低风险|高风险|低风险|R\d|本基金|业绩走势|累计盈亏|单位净值|累计净值|业绩比较基准|分红方式|取消自选|买入|卖出|定投|讨论区|诊基|收益明细|交易记录|我的定投|投资指南|买卖计划|僭数基金|指数基金|金选)/;
  for (const text of rowTexts) {
    if (!/[\u3400-\u9fff]/.test(text)) continue;
    if (/[%％]/.test(text)) continue;
    if (/\d\s*[.]\s*\d/.test(text)) continue;
    if (NAME_BLOCK.test(text)) continue;
    if (/元|份|收益|净值|成本|金额/.test(text)) continue;
    if (GRID_NAME_SKIP.test(text) || GRID_NAME_REJECT.test(text)) continue;
    const cleaned = text
      .replace(/(基金|持仓|持有)?详情$/, '')
      .replace(/[|｜]+$/, '')
      .replace(/《/g, 'I')
      .replace(/（/g, '(')
      .replace(/）/g, ')');
    if (looksLikeName(cleaned)) {
      nameText = cleaned;
      break;
    }
  }

  // 成本优先用「资产 − 收益」：OCRed 的持仓成本常把 1,195 读成 M95。
  const cost = value != null && profit != null ? Math.round((value - profit) * 100) / 100 : null;
  const declaredPending = pendingHit && pendingHit.money ? pendingHit.money.value : null;

  const marketValue = value != null ? Math.abs(value) : null;
  const pending = declaredPending != null
    ? Math.max(0, declaredPending)
    : (marketValue != null && shares != null && nav != null
      ? Math.max(0, Math.round((marketValue - shares * nav) * 100) / 100)
      : 0);
  const repair = [];
  for (const [kind, hit] of [['value', valueHit], ['profit', profitHit], ['day', dayHit]]) {
    if (hit && hit.field && hit.field.suspect) repair.push({ kind, box: hit.field.box, text: hit.field.text });
  }

  return {
    name: nameText,
    code: codeChunk ? codeChunk.text : '',
    repair,
    value: marketValue,
    pending,
    profit: profit != null ? profit : null,
    pct: pct != null ? pct : null,
    day: day != null && !(dayHit && dayHit.money && dayHit.money.percent) ? day : null,
    dayDate,
    nav,
    navChg,
    shares,
    cost,
    avgCost,
    assetPage: true,
  };
}

export function parseTableGrid(lines) {
  const all = [];
  for (const line of lines) for (const cell of line.cells) all.push({ ...cell, cx: cell.x + cell.w / 2 });

  const headers = [];
  for (const cell of all) {
    const kinds = headerKinds(cell.text);
    if (kinds.length) headers.push({ cx: cell.cx, cy: cell.cy, kinds });
  }
  if (!headers.length) return [];
  const headerCy = Math.min(...headers.map((item) => item.cy));
  const columns = headers.filter((item) => item.cy - headerCy <= 40 && !item.kinds.includes('name'));
  if (!columns.length) return [];

  const names = all
    .filter((cell) => cell.cy > headerCy + 40)
    .filter((cell) => {
      const text = normalizeCell(cell.text);
      return !TABLE_NAME_SKIP.test(text) && looksLikeName(text);
    })
    .sort((a, b) => a.cy - b.cy);

  const merged = [];
  for (const cell of names) {
    const text = normalizeCell(cell.text);
    const last = merged[merged.length - 1];
    if (last && cell.cy - last.cy <= 70) {
      const lastCjk = (last.name.match(/[\u3400-\u9fff]/g) || []).length;
      const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
      if (cjk > lastCjk) last.name = text;
      continue;
    }
    merged.push({ name: text, cy: cell.cy, autoInvest: false });
  }
  if (!merged.length) return [];

  const numbers = all
    .filter((cell) => cell.cy > headerCy + 40)
    .map((cell) => {
      const money = parseMoney(normalizeCell(cell.text)) || parseMoneyLoose(normalizeCell(cell.text));
      return money && /\d/.test(cell.text) ? { ...cell, money } : null;
    })
    .filter(Boolean);

  const tags = all.filter((cell) => /^定投$|定投中|正在定投/.test(normalizeCell(cell.text)));

  return merged
    .map((row, index) => {
      const nextCy = index + 1 < merged.length ? merged[index + 1].cy : Infinity;
      const band = numbers.filter((item) => item.cy >= row.cy - 20 && item.cy < nextCy - 20);
      const buckets = new Map();
      for (const item of band) {
        let best = null;
        for (const column of columns) {
          const distance = Math.abs(item.cx - column.cx);
          if (distance <= 220 && (!best || distance < best.distance)) best = { column, distance };
        }
        if (!best) continue;
        const key = columns.indexOf(best.column);
        const list = buckets.get(key) || [];
        list.push(item);
        buckets.set(key, list);
      }
      const out = { name: row.name, code: null, value: null, profit: null, pct: null, day: null, autoInvest: false };
      for (const [key, list] of buckets) {
        list.sort((a, b) => a.cy - b.cy);
        columns[key].kinds.forEach((kind, order) => {
          const hit = list[order];
          if (!hit) return;
          if (kind === 'pct') {
            if (Math.abs(hit.money.value) > 100) return;
          } else if (hit.money.percent) {
            return;
          }
          if (out[kind] == null) out[kind] = hit.money.value;
        });
      }
      out.autoInvest = tags.some((tag) => tag.cy >= row.cy - 20 && tag.cy < nextCy - 20);
      return out;
    })
    .filter((row) => row.value != null && row.value > 0)
    .map((row) => ({ ...row, needsReview: row.profit == null }));
}

/**
 * 「账户汇总」版式（养基宝 / 组合类 App）：表头是
 * 当日收益 | 关联板块 | 持有收益，市值写在名字那一行（带 ¥），
 * 每个单元格上下两行分别是金额和百分比。
 */
export function parseSummaryGrid(lines) {
  const all = [];
  for (const line of lines) for (const cell of line.cells) all.push({ ...cell, cx: cell.x + cell.w / 2 });
  const plain = (text) => normalizeCell(text).replace(/[（(][^）)]*[）)]/g, '').replace(/^\d{1,2}[-一/]\d{1,2}$/, '');

  const columnOf = (cell) => {
    const text = plain(cell.text);
    if (/^(当日收益|今日收益|昨日收益)$/.test(text)) return 'day';
    if (/^(关联板块|关联指数|参考板块|跟踪指数)$/.test(text)) return 'sector';
    if (/^(持有收益|持仓收益|累计收益)$/.test(text)) return 'profit';
    return null;
  };
  const candidates = [];
  for (const cell of all) {
    const kind = columnOf(cell);
    if (kind) candidates.push({ kind, cx: cell.cx, cy: cell.cy });
  }
  if (!candidates.length) return [];
  // Headers must sit on one visual row: 账户资产's own 当日收益 above it is a decoy.
  let best = null;
  for (const seed of candidates) {
    const cluster = candidates.filter((item) => Math.abs(item.cy - seed.cy) <= 40);
    const kinds = new Set(cluster.map((item) => item.kind));
    if (!kinds.has('day') || !kinds.has('profit')) continue;
    const score = kinds.size * 10 - cluster[0].cy / 1000;
    if (!best || score > best.score) best = { cluster, score };
  }
  if (!best) return [];
  const columns = new Map();
  for (const item of best.cluster) if (!columns.has(item.kind)) columns.set(item.kind, item);
  const headerCy = Math.min(...best.cluster.map((item) => item.cy));
  const list = [...columns.values()];

  const rows = [];
  for (const line of lines) {
    if (line.cy <= headerCy + 30) continue;
    const text = normalizeCell(line.cells.map((cell) => cell.text).join(''));
    const cleaned = text.replace(/[“”"'·：:]+$/g, '');
    if (!cleaned || TABLE_NAME_SKIP.test(cleaned) || /^[¥￥]/.test(cleaned) || /^[+\-·]?[\d.,，]/.test(cleaned)) continue;
    if (!looksLikeName(cleaned)) continue;
    if (rows.length && line.cy - rows[rows.length - 1].cy <= 70) {
      const prevCjk = (rows[rows.length - 1].name.match(/[\u3400-\u9fff]/g) || []).length;
      const cjk = (cleaned.match(/[\u3400-\u9fff]/g) || []).length;
      if (cjk > prevCjk) rows[rows.length - 1].name = cleaned;
      continue;
    }
    rows.push({ name: cleaned, cy: line.cy });
  }
  if (!rows.length) return [];

  const parsed = rows.map((row, index) => {
    const nextCy = index + 1 < rows.length ? rows[index + 1].cy : Infinity;
    const band = all.filter((cell) => cell.cy >= row.cy - 20 && cell.cy < nextCy - 20);
    const out = { name: row.name, code: null, value: null, profit: null, pct: null, day: null, dayPct: null, sector: null, needsReview: false };

    for (const cell of band) {
      const text = normalizeCell(cell.text);
      const money = parseMoney(text) || parseMoneyLoose(text);
      if (!money) continue;
      let best = null;
      for (const column of list) {
        const distance = Math.abs(cell.cx - column.cx);
        if (distance <= 240 && (!best || distance < best.distance)) best = { column, distance };
      }
      if (!best) {
        // no header above this cell: a ¥-marked amount is the market value
        if (/[¥￥]/.test(cell.text) && !money.percent && out.value == null && money.value > 0) out.value = money.value;
        continue;
      }
      if (best.column.kind === 'day') {
        if (money.percent) { if (out.dayPct == null) out.dayPct = money.value; }
        else if (out.day == null) out.day = money.value;
      } else if (best.column.kind === 'profit') {
        if (money.percent) { if (out.pct == null) out.pct = money.value; }
        else if (out.profit == null) out.profit = money.value;
      } else if (!money.percent && !/\d/.test(text.replace(/[\d]/g, ''))) {
        // sector column: text label, numbers are its own percentage
      }
    }

    const sectorCell = band.find((cell) => {
      const text = normalizeCell(cell.text);
      return /[\u3400-\u9fffA-Za-z]/.test(text) && !parseMoney(text) && cell.cx > (columns.get('day').cx + 20);
    });
    if (sectorCell) out.sector = normalizeCell(sectorCell.text);

    if (out.value == null && out.day != null && out.profit != null) out.value = null;
    return out;
  });

  return parsed
    .filter((row) => row.value != null && row.value > 0)
    .map((row) => ({ ...row, needsReview: row.profit == null }));
}

export function parseOcr(payload) {
  const lines = ocrLines(payload);
  const rows = assembleFunds(lines);
  if (rows.length && rows.some((row) => row.value != null)) return rows;
  const grid = parseLabelGrid(lines);
  return grid.length ? grid : rows;
}

function textLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cy = 0;
      const cells = line
        .split(/\s{2,}|\t|\||｜/)
        .flatMap((part) => (part.split(/\s{1,}/).length > 3 ? part.split(/\s{1,}/) : [part]))
        .map((part) => ({ text: part, x: 0, w: 0, h: 12, cy }))
        .filter((cell) => cell.text);
      return { cy, cells };
    });
}

export function parseText(text) {
  return assembleFunds(textLines(text));
}

/** 导入用：同时返回持仓行与定投行。 */

/* ------------------------------------------------------- dca detail page */

function dcaNameScore(text) {
  const t = normalizeCell(text);
  return (FUNDISH.test(t) ? 2 : 0) + (String(t).replace(/[^\u3400-\u9fff]/g, '').length >= 6 ? 1 : 0);
}

function dcaExpandName(cell) {
  return String(cell.text || '').replace(/\s+/g, '').replace(/[《〈｛{]/g, 'I').replace(/[》〉｝}]/g, '');
}

/** OCR mangles dates into `2026． 1 1 ¦ 一13（星期五）` — rebuild the raw digits. */
export function normalizeDateText(text) {
  return normalizeCell(text)
    .replace(/\s+/g, '')
    .replace(/[．·・‧∙。]/g, '-')
    .replace(/[一－—–~～／]/g, '-')
    .replace(/[（(][^）)]*[）)]/g, '');
}

/** First date in the text: prefers YYYY-MM-DD, falls back to MM-DD (next year when past). */
export function parseDateHint(text, todayStr) {
  const t = normalizeDateText(text);
  const full = /(20\d{2})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (full) {
    const month = String(Number(full[2])).padStart(2, '0');
    const day = String(Number(full[3])).padStart(2, '0');
    return `${full[1]}-${month}-${day}`;
  }
  const short = /(?:^|[^\d])(\d{1,2})-(\d{1,2})(?:[^\d]|$)/.exec(t);
  if (!short) return null;
  const month = Number(short[1]);
  const day = Number(short[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const base = todayStr ? parseYmd(todayStr) : new Date();
  const year = base.getFullYear();
  const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (todayStr && candidate < todayStr) {
    const next = year + 1;
    return `${next}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return candidate;
}

const PAGE_PLAN_HINT = /(下次扣款|下次转入|扣款周期|定投方式|定投详情|普通定投|定投计划|扣款日|每期扣款)/;
const PAGE_PLAN_NOISE = /(累计定投|已投期数|协议号|定投记录|投资锦囊|历史涨多跌少|累计收益|持有收益|持仓收益)/;

/**
 * A 「定投详情」 page puts the plan block far below the fund title, so the
 * anchor-based pass sees nothing. Read the whole page as one plan instead.
 */
export function parsePlanPage(lines, todayStr) {
  const rows = lines.map((line) => ({
    cy: line.cy,
    text: line.cells.map((cell) => cell.text).join(''),
    cells: line.cells,
  }));
  const pageText = normalizeCell(rows.map((row) => row.text).join(' '));
  if (!PAGE_PLAN_HINT.test(pageText)) return null;

  let cycle = null;
  for (const row of rows) {
    if (PAGE_PLAN_NOISE.test(row.text)) continue;
    const hit = parsePlanCycle(row.text);
    if (hit) { cycle = hit; break; }
  }

  const amounts = [];
  const consider = (text) => {
    const clean = normalizeCell(text);
    if (!clean || PAGE_PLAN_NOISE.test(clean)) return;
    if (/^\d{6}$/.test(digitFix(clean))) return;
    // Per-period amounts always carry two decimals in these apps; that is what
    // keeps 「已投期数 4」 and fund codes out of the candidate list.
    if (!/\d\s*[.·．·\uff0e]\s*\d{2}/.test(clean)) return;
    const money = parseMoney(clean) || parseMoneySuffix(clean);
    if (!money || money.percent || money.value <= 0) return;
    amounts.push(money.value);
  };
  for (const row of rows) {
    if (PAGE_PLAN_NOISE.test(row.text)) continue;
    consider(row.text);
    for (const cell of row.cells) consider(cell.text);
  }
  if (!amounts.length) return null;
  const amount = Math.min(...amounts);

  let nextHint = null;
  const nextRow = rows.find((row) => /(下次扣款|下次转入|下次定投)/.test(row.text));
  if (nextRow) {
    nextHint = parseDateHint(nextRow.text, todayStr);
    if (!nextHint) {
      for (const row of rows) {
        if (row.cy <= nextRow.cy) continue;
        if (row.cy - nextRow.cy > 260) break;
        nextHint = parseDateHint(row.text, todayStr);
        if (nextHint) break;
      }
    }
  }

  const nameRow = rows
    .filter((row) => !PAGE_PLAN_NOISE.test(row.text) && !/[%％]/.test(row.text) && !/\d\s*[.．·]\s*\d/.test(row.text))
    .filter((row) => looksLikeName(normalizeCell(row.text)))
    .sort((a, b) => dcaNameScore(b.text) - dcaNameScore(a.text) || a.cy - b.cy)[0];
  const codeRow = rows.find((row) => /^\d{6}$/.test(digitFix(normalizeCell(row.text))));

  return {
    isPlan: true,
    name: nameRow ? dcaExpandName(nameRow) : '',
    code: codeRow ? digitFix(normalizeCell(codeRow.text)) : '',
    ...(cycle || { cycle: 'monthly', day: 1 }),
    cycleKnown: Boolean(cycle),
    amount: Math.round(amount * 100) / 100,
    nextHint: nextHint || null,
    wholePage: true,
  };
}

export function parseImportOcr(payload, today) {
  const lines = ocrLines(payload);
  // 「资产详情」页是最新最全的一版（含在途份额与成本），能认出来就直接用它。
  const asset = parseAssetPage(lines, today);
  if (asset && (asset.value || asset.profit) && (asset.shares || asset.cost)) {
    return { holdings: [asset], plans: [] };
  }
  const rows = assembleRows(lines);
  let holdings = rows.filter((row) => !row.isPlan).map(stripRow);
  const rawPlans = rows.filter((row) => row.isPlan);
  const score = (rows) => rows.reduce(
    (sum, row) => sum + (row.value != null ? 1 : 0) + (row.profit != null ? 0.5 : 0) + (row.pct != null ? 0.3 : 0) + (row.day != null ? 0.2 : 0),
    0,
  );
  let bestScore = score(holdings);
  for (const candidate of [parseTableGrid(lines), parseLabelGrid(lines), parseSummaryGrid(lines)]) {
    const candidateScore = score(candidate);
    if (candidateScore > bestScore) {
      holdings = candidate;
      bestScore = candidateScore;
    }
  }
  let plans = dropTagOnlyPlans(holdings, rawPlans);
  const weakPlans = !plans.length || plans.every((plan) => plan.amount == null || plan.needsReview);
  if (weakPlans) {
    const pagePlan = parsePlanPage(lines, today);
    if (pagePlan && pagePlan.amount != null) {
      plans = [pagePlan];
      // A 「定投详情」 page lists 定投记录 rows; none of them is a holding.
      holdings = holdings.filter((row) => !/支付成功|定投成功|确认中|扣款成功|扣费成功/.test(String(row.name || '')) && Number(row.value) > 0);
      if (pagePlan.name && !holdings.length) {
        // A DCA detail page still tells us which fund the plan belongs to; the
        // holding itself has no market value there, so plan only.
      }
    }
  }
  return { holdings, plans: plans.map(stripRow) };
}

/**
 * A screenshot that only tags a row 「定投」 has no amount or cycle — that is a
 * flag on the holding, not a plan. Keep real plans (cycle known, or an amount
 * that belongs to no holding).
 */
function dropTagOnlyPlans(holdings, plans) {
  const kept = [];
  for (const plan of plans) {
    const same = holdings.find((row) => row.name && plan.name && (row.name === plan.name || row.name.includes(plan.name) || plan.name.includes(row.name)));
    const tagOnly = !plan.cycleKnown && (!same || plan.amount == null || Math.abs((plan.amount || 0) - (same.value || 0)) <= 0.5);
    if (tagOnly) {
      if (same) same.autoInvest = true;
      continue;
    }
    kept.push(plan);
  }
  return kept;
}

export function parseImportText(text) {
  const rows = assembleRows(textLines(text));
  return { holdings: rows.filter((row) => !row.isPlan).map(stripRow), plans: rows.filter((row) => row.isPlan).map(stripRow) };
}

/* ------------------------------------------------------------- valuation */

/**
 * Day P&L for one fund, in the order that is most trustworthy first:
 * intraday valuation (gsz) -> today's official NAV -> tracked sector move ->
 * the last published NAV change (yesterday's number, shown as such).
 */
export function quoteMetrics(quote, todayStr) {
  if (!quote || !Number.isFinite(quote.nav)) return null;
  const hasGs = Number.isFinite(quote.gsz);
  const sectorPct = Number.isFinite(quote.sector?.chgPct) ? quote.sector.chgPct : null;
  const navChg = Number.isFinite(Number(quote.navChg)) ? Number(quote.navChg) : null;
  let price = quote.nav;
  let dayPct = 0;
  let daySource = 'none';
  if (hasGs) {
    price = quote.gsz;
    dayPct = Number(quote.gszChg) || 0;
    daySource = 'gsz';
  } else if (quote.navDate === todayStr) {
    price = quote.nav;
    dayPct = navChg || 0;
    daySource = 'nav';
  } else if (sectorPct != null) {
    price = quote.nav;
    dayPct = sectorPct;
    daySource = 'sector';
  } else if (navChg != null) {
    dayPct = navChg;
    daySource = 'prev';
  }
  const prev = dayPct ? price / (1 + dayPct / 100) : price;
  return {
    price,
    prev,
    dayPct,
    daySource,
    estimated: daySource === 'gsz' || daySource === 'sector',
    sector: quote.sector || null,
    nav: quote.nav,
    navDate: quote.navDate,
  };
}

export function toHolding(row, quote) {
  const nav = quote?.nav;
  const value = Number(row.value) || 0;
  const profit = row.profit == null
    ? (row.pct == null ? null : value - value / (1 + Number(row.pct) / 100))
    : Number(row.profit);
  const cost = profit == null ? value : value - profit;
  const shares = Number.isFinite(nav) && nav > 0 ? value / nav : 0;
  return {
    code: String(row.code || quote?.code || ''),
    name: row.name || quote?.name || '',
    shares,
    cost,
    updatedAt: new Date().toISOString(),
    source: row.source || 'import',
    note: shares > 0 ? '' : 'NO_NAV',
  };
}

export function summarize(holdings, quotes, todayStr) {
  let value = 0;
  let cost = 0;
  let todayProfit = 0;
  let estimated = false;
  const rows = [];
  for (const holding of holdings || []) {
    const quote = quotes?.[holding.code];
    const metrics = quoteMetrics(quote, todayStr);
    // 「在途金额」= 已扣款但尚未确认份额的钱（基金公司 App 的『2 笔交易确认中』），
    // 它算进市值和成本，但不产生当日盈亏。
    const pending = Number(holding.pending) > 0 ? Number(holding.pending) : 0;
    const holdingValue = (metrics ? holding.shares * metrics.price : 0) + pending;
    const profit = metrics ? holdingValue - holding.cost : 0;
    // 基金公司「资产详情」页已经给出当日收益时，它就是当天最准的数（净值刚公布、
    // 行情接口还没跟上），有效期只到那天，过期自动退回估算/净值口径。
    const importedDay = Number.isFinite(Number(holding.dayProfit)) && holding.dayDate === todayStr
      ? Number(holding.dayProfit)
      : null;
    const change = importedDay != null ? importedDay : (metrics ? holding.shares * (metrics.price - metrics.prev) : 0);
    if (metrics?.estimated && importedDay == null) estimated = true;
    value += holdingValue;
    cost += holding.cost;
    todayProfit += change;
    rows.push({
      code: holding.code,
      name: holding.name || quote?.name || holding.code,
      shares: holding.shares,
      cost: holding.cost,
      pending,
      value: holdingValue,
      profit,
      profitPct: holding.cost > 0 ? (profit / holding.cost) * 100 : 0,
      todayProfit: change,
      todayPct: metrics ? metrics.dayPct : 0,
      price: metrics ? metrics.price : null,
      nav: metrics ? metrics.nav : null,
      navDate: metrics ? metrics.navDate : null,
      estimated: importedDay != null ? false : Boolean(metrics?.estimated),
      daySource: importedDay != null ? 'import' : (metrics ? metrics.daySource : 'none'),
      sector: metrics?.sector || null,
      gzTime: quote?.gzTime || '',
      stale: !metrics,
      channel: holding.channel || 'unknown',
      note: holding.note && holding.note !== 'NO_NAV' ? holding.note : '',
    });
  }
  rows.sort((a, b) => b.value - a.value);
  return {
    rows,
    value,
    cost,
    profit: value - cost,
    profitPct: cost > 0 ? ((value - cost) / cost) * 100 : 0,
    todayProfit,
    todayPct: value - todayProfit > 0 ? (todayProfit / (value - todayProfit)) * 100 : 0,
    estimated,
    updatedAt: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------- channels */

/**
 * Where a screenshot came from. Fund-company apps report the whole TA account
 * (direct + every distributor), distributors only report their own slice, so
 * the two must never be summed together.
 */
export const CHANNEL_RANK = { direct: 2, unknown: 1, platform: 0 };

const PLATFORM_HINTS = /(支付宝|蚂蚁财富|蚂蚁（杭州）|余额宝|天天基金网|天天基金|理财通|蛋卷基金|且慢|京东金融|雪球|同花顺|东方财富|涨乐财富通|网上银行|基金销售有限公司|第三方销售)/;
// 基金公司 App 与「养基宝」这类记账 App 展示的都是全渠道合计，属同一口径；
// 支付宝/天天基金等代销只显示自己那一块。
const DIRECT_HINTS = /(基金管理有限公司|基金账户|我的基金账户|直销|基金公司APP|官方APP|活期宝|现金宝|资产详情)/;

export function detectChannel(text) {
  const source = String(text || '');
  if (!source.trim()) return 'unknown';
  const platform = PLATFORM_HINTS.test(source);
  const direct = DIRECT_HINTS.test(source);
  if (direct) return 'direct';
  if (platform) return 'platform';
  return 'unknown';
}

/** Flatten an OCR payload into plain text for channel detection. */
export function ocrText(ocr) {
  const lines = Array.isArray(ocr?.lines) ? ocr.lines : [];
  return lines.map((line) => (Array.isArray(line.words) ? line.words.map((w) => w.t).join('') : line.text || '')).join('\n');
}

/**
 * Collapse imported rows to one row per fund code.
 * Fund-company rows win over distributor rows; among equals the larger holding wins.
 * The loser is kept in `mergedFrom` so the UI can show what was absorbed.
 */
export function mergeImportedRows(rows) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const code = String(row?.code || '').trim();
    // Rows whose name could not be resolved still need to land in the dialog:
    // group them by name so two different funds never collapse into one row.
    const key = /^\d{6}$/.test(code) ? code : `~${String(row?.name || '').replace(/[^\u3400-\u9fffA-Za-z0-9]/g, '')}`;
    if (!key || key === '~') continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const merged = [];
  for (const [code, list] of groups) {
    const rank = (row) => CHANNEL_RANK[row?.channel || 'unknown'] ?? 1;
    const size = (row) => Number(row?.shares) > 0 ? Number(row.shares) : Number(row?.value) || 0;
    const assetRank = (row) => (row?.assetPage ? 1 : 0);
    const sorted = [...list].sort((a, b) => assetRank(b) - assetRank(a) || rank(b) - rank(a) || size(b) - size(a));
    const keeper = sorted[0];
    const dropped = sorted.slice(1);
    const names = new Set(list.map((row) => String(row.name || '').trim()).filter(Boolean));
    if (!/^\d{6}$/.test(code)) {
      merged.push({
        ...keeper,
        code: '',
        channel: keeper.channel || 'unknown',
        mergedFrom: dropped.map((row) => ({ channel: row.channel || 'unknown', value: Number(row.value), image: row.sourceImage || '' })),
        conflict: dropped.some((row) => size(row) > size(keeper) * 1.005),
      });
      continue;
    }
    if (dropped.length && names.size > 1 && list.every((row) => Number.isFinite(Number(row.value)))) {
      // Same code but different titles => A/I share classes that the name resolver
      // could not split. Summing keeps the market value right instead of losing one.
      const total = list.reduce((sum, row) => sum + Number(row.value), 0);
      const profits = list.map((row) => Number(row.profit)).filter(Number.isFinite);
      merged.push({
        ...keeper,
        code,
        value: Math.round(total * 100) / 100,
        profit: profits.length === list.length ? Math.round(profits.reduce((a, b) => a + b, 0) * 100) / 100 : keeper.profit,
        pct: null,
        shares: null,
        cost: null,
        channel: keeper.channel || 'unknown',
        note: '份额合并',
        mergedFrom: dropped.map((row) => ({
          channel: row.channel || 'unknown',
          value: Number(row.value),
          name: row.name || '',
          image: row.sourceImage || '',
        })),
        conflict: false,
      });
      continue;
    }
    merged.push({
      ...keeper,
      code,
      channel: keeper.channel || 'unknown',
      mergedFrom: dropped.map((row) => ({
        channel: row.channel || 'unknown',
        value: Number.isFinite(Number(row.value)) ? Number(row.value) : null,
        shares: Number.isFinite(Number(row.shares)) ? Number(row.shares) : null,
        image: row.sourceImage || '',
      })),
      // A dropped row that is actually bigger means the keeper may be a single-channel slice.
      conflict: dropped.some((row) => size(row) > size(keeper) * 1.005),
    });
  }
  return merged;
}

/* ------------------------------------------------------------------- dca */

/** True when dateStr is the plan's calendar rule date (weekends are rolled forward, not dropped). */
function isRuleDay(plan, dateStr) {
  const day = parseYmd(dateStr);
  if (!day) return false;
  if (plan.cycle === 'daily') {
    const weekday = day.getDay();
    return weekday !== 0 && weekday !== 6;
  }
  if (plan.cycle === 'weekly') return day.getDay() === Number(plan.weekday || 1);
  if (plan.cycle === 'monthly') {
    const target = Math.min(Number(plan.day || 1), daysInMonth(day.getFullYear(), day.getMonth() + 1));
    return day.getDate() === target;
  }
  return false;
}

/** Weekend/holiday rule dates buy on the next weekday, matching fund DCA rules. */
export function rollForward(dateStr, maxSteps = 10) {
  let cursor = parseYmd(dateStr);
  if (!cursor) return dateStr;
  let guard = 0;
  while ((cursor.getDay() === 0 || cursor.getDay() === 6) && guard < maxSteps) {
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return ymd(cursor);
}

/** The last real buy date strictly before dateStr (weekends/holidays skipped). */
export function prevRuleDate(plan, dateStr, maxDays = 45) {
  const base = parseYmd(dateStr);
  if (!base) return dateStr;
  let cursor = addDays(base, -1);
  for (let i = 0; i < maxDays; i += 1) {
    const date = ymd(cursor);
    if (isRuleDay(plan, date) && rollForward(date) === date) return date;
    cursor = addDays(cursor, -1);
  }
  return ymd(addDays(base, -1));
}

/** Effective buy dates (rule date rolled to a weekday) inside [from, to]. */
export function effectiveDates(plan, fromStr, toStr) {
  const start = parseYmd(fromStr);
  const end = parseYmd(toStr);
  if (!start || !end) return [];
  const out = [];
  const seen = new Set();
  let cursor = start;
  let guard = 0;
  while (cursor.getTime() <= end.getTime() && guard < 420) {
    const date = ymd(cursor);
    if (isRuleDay(plan, date)) {
      const buyDate = rollForward(date);
      if (!seen.has(buyDate) && buyDate <= toStr) {
        seen.add(buyDate);
        out.push(buyDate);
      }
    }
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return out.sort();
}

export function isDueOn(plan, dateStr) {
  if (!isRuleDay(plan, dateStr)) return false;
  return rollForward(dateStr) === dateStr;
}

/** Due dates for a plan in the (lastRun, today] window. */
export function planDueDates(plan, todayStr) {
  const start = plan.lastRun || plan.startDate || todayStr;
  return effectiveDates(plan, ymd(addDays(parseYmd(start), 1)), todayStr);
}

/** Next due dates after today — used for "接下来会买入" hints. */
export function upcomingDates(plan, todayStr, count = 3) {
  const horizon = ymd(addDays(parseYmd(todayStr), 200));
  return effectiveDates(plan, ymd(addDays(parseYmd(todayStr), 1)), horizon).slice(0, count);
}

/**
 * Normalize one holding edit/import row into a storable holding.
 * Accepts {shares, cost} directly, or derives them from {value, profit} / {value, pct} / nav.
 */
export function normalizeHolding(item, nav) {
  const code = String(item?.code || '').trim();
  if (!/^\d{6}$/.test(code)) return null;
  let shares = Number(item.shares);
  let cost = Number(item.cost);
  const value = Number(item.value);
  // 截图里的「金额/基金资产」是含在途（待确认）的；在途还没换成份额，
  // 所以用金额反推份额时必须先扣掉它，否则份额会凭空多出来（就是这里埋的雷）。
  const rawPending = Number(item?.pending);
  const pending = Number.isFinite(rawPending) && rawPending > 0 ? Math.round(rawPending * 100) / 100 : 0;
  const confirmedValue = Number.isFinite(value) && value > 0
    ? (pending > 0 ? Math.max(0, value - pending) : value)
    : NaN;
  let rate = Number.isFinite(nav) && nav > 0 ? Number(nav) : 0;
  if (!Number.isFinite(shares) || shares <= 0) {
    if (Number.isFinite(confirmedValue) && confirmedValue > 0 && rate > 0) shares = confirmedValue / rate;
  }
  if (!Number.isFinite(cost) || cost <= 0) {
    const profit = Number(item.profit);
    const pct = Number(item.pct);
    if (Number.isFinite(value) && value > 0) {
      // 成本按「含在途」的金额算：持仓成本本来就把待确认的钱算在内。
      if (Number.isFinite(profit)) cost = value - profit;
      else if (Number.isFinite(pct)) cost = value / (1 + pct / 100);
      else cost = value;
    } else if (Number.isFinite(shares) && shares > 0 && rate > 0) {
      cost = shares * rate;
    }
  }
  if (!Number.isFinite(shares) || shares <= 0) return null;
  if (!Number.isFinite(cost) || cost < 0) cost = 0;
  // 反推在途：页面给的「金额」如果比 份额×净值 大，差额就是还没确认的钱。
  // 有些页面（南方资产详情）的「待确认金额」写 0.00 却仍把在途算进金额，
  // 所以不能只信那个标签，要用恒等式补一次。
  let pendingFinal = pending;
  if (Number.isFinite(value) && value > 0 && rate > 0) {
    const implied = Math.round((value - shares * rate) * 100) / 100;
    if (implied > 0.5) pendingFinal = Math.max(pending, implied);
  }
  return {
    code,
    shares: Math.round(shares * 10000) / 10000,
    cost: Math.round(cost * 100) / 100,
    pending: pendingFinal,
  };
}
