// 纯函数审计：不碰磁盘、不碰网络，只验证 core.js 的算账口径。
// 目标：任何一次改动后，跑一遍就知道「份额/成本/今日盈亏/在途」有没有算歪。
import assert from 'node:assert/strict';
import {
  summarize,
  quoteMetrics,
  normalizeHolding,
  effectiveDates,
  planDueDates,
  rollForward,
  parseImportOcr,
} from '../lib/core.js';

const TODAY = '2026-11-13';
const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(`✅ ${name}`);
  } catch (error) {
    results.push(`❌ ${name}\n   ${error.message}`);
    process.exitCode = 1;
  }
}

const near = (a, b, tol = 0.05) => Math.abs(Number(a) - Number(b)) <= tol;

/* ---------------------------------------------------------- 在途 + 市值 */
check('在途金额计入市值与成本，不产生收益（南方 016452 案例）', () => {
  const holdings = [{ code: '016452', name: '南方纳指A', shares: 513.71, cost: 1195.5, pending: 20 }];
  const quotes = {
    '016452': { code: '016452', name: '南方纳指A', nav: 2.187, navDate: '2026-11-11', navChg: 0.1, gsz: null },
  };
  const summary = summarize(holdings, quotes, TODAY);
  assert.ok(near(summary.value, 1143.5, 0.1), `市值 ${summary.value} 应约 1143.5`);
  assert.ok(near(summary.profit, -52.0, 0.1), `持有收益 ${summary.profit} 应约 -52.0`);
  const row = summary.rows[0];
  assert.ok(near(row.value, 1143.5, 0.1));
  assert.ok(near(row.profit, -52.0, 0.1));
});

check('易方达 300：39.82 + 今日扣款 10 在途 = 49.82，收益仍 -0.18', () => {
  const holdings = [{ code: '110020', name: '易方达300', shares: 23.7533, cost: 50, pending: 10 }];
  const quotes = {
    '110020': { code: '110020', name: '易方达300', nav: 1.6764, navDate: '2026-11-12', navChg: 0.2, gsz: null },
  };
  const summary = summarize(holdings, quotes, TODAY);
  assert.ok(near(summary.value, 49.82, 0.1), `市值 ${summary.value} 应约 49.82`);
  assert.ok(near(summary.profit, -0.18, 0.1), `持有收益 ${summary.profit} 应约 -0.18`);
});

/* -------------------------------------------------------- 今日盈亏来源 */
check('当日官方净值优先于板块估算（navDate === today）', () => {
  const quote = { code: 'X', nav: 2.2, navDate: TODAY, navChg: 2.0, gsz: null, sector: { label: '纳斯达克100', chgPct: -0.39 } };
  const metrics = quoteMetrics(quote, TODAY);
  assert.equal(metrics.daySource, 'nav', `应走今日净值，实际 ${metrics.daySource}`);
  assert.equal(metrics.estimated, false);
});

check('净值滞后时用关联板块推算，并标 estimated', () => {
  const quote = { code: 'X', nav: 2.187, navDate: '2026-11-11', navChg: 0.4, gsz: null, sector: { label: '纳斯达克100', chgPct: -0.39 } };
  const metrics = quoteMetrics(quote, TODAY);
  assert.equal(metrics.daySource, 'sector', `应走板块估算，实际 ${metrics.daySource}`);
  assert.equal(metrics.estimated, true);
  assert.ok(near(metrics.dayPct, -0.39, 0.01), `板块涨跌应取 -0.39，实际 ${metrics.dayPct}`);
});

check('盘中估值 gsz 存在时优先（盘中最准）', () => {
  const quote = { code: 'X', nav: 2.187, navDate: '2026-11-11', navChg: 0.4, gsz: 2.2, gszChg: 0.6, gzTime: '15:00', sector: { label: 's', chgPct: -0.39 } };
  const metrics = quoteMetrics(quote, TODAY);
  assert.equal(metrics.daySource, 'gsz');
  assert.equal(metrics.estimated, true);
});

check('截图带来的当日收益优先于一切推算', () => {
  const holdings = [{ code: 'X', shares: 513.71, cost: 1195.5, pending: 20, dayProfit: 24.66, dayDate: TODAY }];
  const quotes = { X: { code: 'X', nav: 2.187, navDate: '2026-11-11', navChg: 0.4, gsz: null } };
  const row = summarize(holdings, quotes, TODAY).rows[0];
  assert.ok(near(row.todayProfit, 24.66, 0.01), `今日盈亏应取截图值，实际 ${row.todayProfit}`);
  assert.equal(row.daySource, 'import');
});

/* -------------------------------------------------- normalizeHolding 口径 */
check('normalizeHolding：市值+收益→成本，在途单独存放', () => {
  const out = normalizeHolding({ code: '016452', value: 1143.48, profit: -52.02, pending: 20 }, 2.187);
  assert.ok(near(out.cost, 1195.5, 0.02), `成本 ${out.cost}`);
  assert.ok(near(out.shares, 513.71, 0.02), `份额 ${out.shares}`);
  assert.equal(out.pending, 20);
});

check('normalizeHolding：只给收益率也能反推成本', () => {
  const out = normalizeHolding({ code: '016452', value: 1000, pct: 10 }, 1.0);
  assert.ok(near(out.cost, 909.09, 0.05), `成本 ${out.cost}`);
});

/* ------------------------------------------------------------ 定投排期 */
check('周末顺延：11-14(周六)→11-16(周一)', () => {
  assert.equal(rollForward('2026-11-14'), '2026-11-16');
  assert.equal(rollForward('2027-01-10'), '2027-01-11');
});

check('每交易日计划：从 11-12 起只有工作日', () => {
  const plan = { cycle: 'daily', startDate: '2026-11-12', lastRun: '2026-11-11', amount: 10 };
  const due = planDueDates(plan, '2026-11-17');
  assert.deepEqual(due, ['2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17']);
});

check('每月 10 日：落到周末顺延，不重复', () => {
  const plan = { cycle: 'monthly', day: 10, startDate: '2026-11-01', amount: 10 };
  const due = effectiveDates(plan, '2026-11-01', '2027-02-28');
  assert.deepEqual(due, ['2026-11-10', '2026-12-10', '2027-01-11', '2027-02-10']);
});

/* 截图解析的回归在 work/test-samples.mjs 里（需要真实 OCR 样本），这里只管算账。 */

const report = results.join('\n');
console.log(report);
console.log(process.exitCode ? '\n有失败项' : '\n纯函数审计全部通过');
