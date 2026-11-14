// 线上接口审计：只读 + 幂等操作，验证「份额/成本/汇总」三处口径不会互相打架。
// 用法：node test/audit-live.mjs http://127.0.0.1:PORT
// 注意：会重新导入一张当前份额的截图（等价于用户又点了一次导入），结果必须不变。
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:55481';
const WORK = path.resolve(process.cwd(), '..');
const API = `${BASE}/my-funds/api`;

const results = [];
const near = (a, b, tol = 0.05) => Math.abs(Number(a) - Number(b)) <= tol;
function record(ok, name, detail = '') {
  results.push(`${ok ? '✅' : '❌'} ${name}${ok || !detail ? '' : `\n   ${detail}`}`);
  if (!ok) process.exitCode = 1;
}

async function post(route, body = {}) {
  const response = await fetch(`${API}/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!json.ok) throw new Error(`${route}: ${JSON.stringify(json.error)}`);
  return json.value;
}

const state = await post('state');
const { summary, rawHoldings = [], plans = [] } = state;

/* 1. 汇总 = 逐行相加 */
{
  const sumValue = summary.rows.reduce((sum, row) => sum + (Number(row.value) || 0), 0);
  const sumToday = summary.rows.reduce((sum, row) => sum + (Number(row.todayProfit) || 0), 0);
  const sumProfit = summary.rows.reduce((sum, row) => sum + (Number(row.profit) || 0), 0);
  record(near(sumValue, summary.value, 0.1), '总市值 = 各行市值之和', `${summary.value} vs ${sumValue.toFixed(2)}`);
  record(near(sumToday, summary.todayProfit, 0.1), '今日盈亏 = 各行之和', `${summary.todayProfit} vs ${sumToday.toFixed(2)}`);
  record(near(sumProfit, summary.profit, 0.1), '持有收益 = 各行之和', `${summary.profit} vs ${sumProfit.toFixed(2)}`);
  record(near(summary.value - summary.cost, summary.profit, 0.15), '持有收益 = 总市值 - 总成本',
    `${(summary.value - summary.cost).toFixed(2)} vs ${summary.profit}`);
}

/* 2. 基准不变式：份额 = 基准份额 + 已记录期数；成本 = 基准成本 + 在途 + 已记录成本 */
for (const holding of rawHoldings) {
  const execs = plans.filter((plan) => plan.code === holding.code).flatMap((plan) => plan.executions || []);
  const addShares = execs.filter((item) => !item.skipped).reduce((sum, item) => sum + (Number(item.shares) || 0), 0);
  const addCost = execs.filter((item) => !item.skipped && !item.fromPending)
    .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const wantShares = Number(holding.baseShares) + addShares;
  const wantCost = Number(holding.baseCost) + (Number(holding.pending) || 0) + addCost;
  record(near(holding.shares, wantShares, 0.02), `${holding.code} 份额 = 基准 + 期数`,
    `${holding.shares} vs ${wantShares.toFixed(4)}`);
  record(near(holding.cost, wantCost, 0.05), `${holding.code} 成本 = 基准 + 在途 + 期数`,
    `${holding.cost} vs ${wantCost.toFixed(2)}`);
}

/* 3. 计划按基金唯一 */
{
  const codes = plans.map((plan) => plan.code);
  record(new Set(codes).size === codes.length, '同一只基金只有一条定投计划', codes.join(','));
}

/* 4. 幂等：连续刷新 3 次，数字不变 */
{
  const first = await post('refresh');
  let stable = true;
  let detail = '';
  for (let index = 0; index < 2; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const next = await post('refresh');
    const same = near(next.summary.value, first.summary.value, 0.01)
      && next.summary.rows.every((row, i) => near(row.value, first.summary.rows[i].value, 0.01));
    if (!same) {
      stable = false;
      detail = `第 ${index + 2} 次 ${next.summary.value} vs ${first.summary.value}`;
    }
  }
  record(stable, '连续刷新市值不变（没有反复重放定投）', detail);
}

/* 5. 重复导入同一张截图：份额不变（幂等） */
if (rawHoldings.length) {
  const auto = rawHoldings.find((row) => row.autoInvest) || rawHoldings[0];
  const before = { shares: auto.shares, cost: auto.cost, count: plans.length };
  const images = ['s6-nanfang-a.jpg', 's8-yifangda300.jpg']
    .map((name) => path.join(WORK, name))
    .filter((file) => fs.existsSync(file))
    .map((file) => ({
      name: path.basename(file),
      data: `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`,
    }));
  if (images.length) {
    await post('import', { images, mode: 'holdings', channel: 'direct' });
    const after = await post('state');
    const row = after.rawHoldings.find((item) => item.code === auto.code);
    record(near(row.shares, before.shares, 0.02), `重复导入 ${auto.code} 份额不变`,
      `${row.shares} vs ${before.shares}`);
    record(after.plans.length === before.count, '重复导入不会新增定投计划',
      `${after.plans.length} vs ${before.count}`);
  }
}

/* 6. 旧截图不能把基准往后拉（stale 护卫） */
{
  const auto = rawHoldings.find((row) => row.autoInvest);
  if (auto) {
    const out = await post('holdings', {
      action: 'add',
      holdings: [{ code: auto.code, shares: Math.max(0.01, auto.shares - 10), cost: Math.max(0, auto.cost - 30), channel: 'direct' }],
    });
    const row = out.rawHoldings.find((item) => item.code === auto.code);
    const stale = (out.skipped || []).some((item) => item.code === auto.code && item.reason === 'stale');
    record(stale && near(row.shares, auto.shares, 0.02), '更小的旧截图被识别为 stale 并忽略',
      `skipped=${JSON.stringify(out.skipped || [])} shares=${row.shares}`);
  }
}

console.log(results.join('\n'));
console.log(process.exitCode ? '\n有失败项' : '\n线上审计全部通过');
