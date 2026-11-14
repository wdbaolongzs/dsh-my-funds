// 我的基金 — host half.
// Stores holdings / DCA plans in <profile>/my-funds/state.json, talks to the
// public fund NAV APIs, runs the Windows OCR helper and serves a tiny JSON API
// on the harness web server for the client panel.

import { spawn } from 'node:child_process';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';

import {
  CHANNEL_RANK,
  STATE_VERSION,
  detectChannel,
  mergeImportedRows,
  normalizeHolding,
  ocrText,
  parseOcr,
  parseText,
  parseImportOcr,
  parsePatchNumber,
  parseImportText,
  effectiveDates,
  planDueDates,
  prevRuleDate,
  quoteMetrics,
  summarize,
  toHolding,
  upcomingDates,
  ymd,
} from './core.js';
import { buildReport, maskNotify, mergeNotify, sendMail, sendOneBot } from './notify.js';

export const name = 'my-funds';

const API_PREFIX = '/my-funds/api';
const OCR_SCRIPT = fileURLToPath(new URL('./ocr.ps1', import.meta.url));
const MOBILE_PAGE = fileURLToPath(new URL('./mobile.html', import.meta.url));
const EMPTY_STATE = {
  version: STATE_VERSION,
  holdings: [],
  plans: [],
  snapshots: {},
  settings: {
    autoRefresh: true,
    paydayHint: '',
    notify: { enabled: false, cron: ['08:00', '21:30'], lastSent: '', mail: {}, onebot: {} },
  },
  quotes: {},
};

/* --------------------------------------------------------------- storage */

function stateDir() {
  const base = process.env.DSH_PROFILE_DIR
    || path.join(os.homedir(), '.dsh', 'profiles', process.env.DSH_PROFILE || 'desktop');
  return path.join(base, 'my-funds');
}

function stateFile() {
  return path.join(stateDir(), 'state.json');
}

let cache = null;

/**
 * 老数据修复：早期版本的定投会从 startDate 一路补买历史，而持仓截图里本来
 * 就含这些买入，结果份额和成本被算了两遍。这里按「截图基准时间」把截图之前的
 * 期数剔掉，并且以后所有持仓都记一个基准，避免再出现。
 */
function repairBaseline(state) {
  let changed = false;
  for (const holding of state.holdings) {
    if (!holding.baseAt) {
      holding.baseAt = holding.updatedAt || new Date().toISOString();
      changed = true;
    }
  }
  for (const plan of state.plans) {
    const holding = state.holdings.find((row) => row.code === plan.code);
    if (!holding) continue;
    const baseDate = String(holding.baseAt || '').slice(0, 10);
    if (!baseDate) continue;
    const keep = [];
    for (const execution of plan.executions || []) {
      if (String(execution.date || '') <= baseDate) {
        holding.shares = Math.max(0, (Number(holding.shares) || 0) - (Number(execution.shares) || 0));
        holding.cost = Math.max(0, (Number(holding.cost) || 0) - (Number(execution.amount) || 0));
        changed = true;
      } else {
        keep.push(execution);
      }
    }
    if (keep.length !== (plan.executions || []).length) {
      plan.executions = keep;
      plan.lastRun = keep.length ? keep[keep.length - 1].date : baseDate;
    }
  }
  // 注意：这里不能再把 baseShares/baseCost 同步成当前值，
  // 否则每次加载都会把「基准」往后挪，定投历史会被反复重放（曾导致「凭空多 200」）。
  return changed;
}

/**
 * 同一只基金可能被重复建过计划（早前版本按 id 匹配，id 变了就多插一条）。
 * 这里按 code 合并成一条：期数取并集（按日期去重），lastRun 取较晚的那个。
 */
function dedupePlans(state) {
  const byCode = new Map();
  const keep = [];
  for (const plan of state.plans) {
    const key = plan.code;
    const prev = byCode.get(key);
    if (!prev) {
      byCode.set(key, plan);
      keep.push(plan);
      continue;
    }
    const seen = new Set((prev.executions || []).map((item) => item.date));
    for (const execution of plan.executions || []) {
      if (!seen.has(execution.date)) {
        prev.executions = prev.executions || [];
        prev.executions.push(execution);
        seen.add(execution.date);
      }
    }
    prev.executions.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (String(plan.lastRun || '') > String(prev.lastRun || '')) prev.lastRun = plan.lastRun;
    if (plan.enabled && !prev.enabled) prev.enabled = true;
  }
  const changed = keep.length !== state.plans.length;
  if (changed) state.plans = keep;
  return changed;
}

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const round4 = (value) => Math.round((Number(value) || 0) * 1e4) / 1e4;

/**
 * 基准不变式：份额 = baseShares + Σ期数份额，成本 = baseCost + Σ期数成本。
 * 任何历史脏数据（旧版本重复买入、手动补算）都会被这条规则拉回来，
 * 这样「凭空多 200」这类问题不会再出现。
 */
function enforceBaseline(state) {
  let changed = false;
  for (const holding of state.holdings) {
    const baseShares = Number(holding.baseShares);
    const baseCost = Number(holding.baseCost);
    if (!Number.isFinite(baseShares) || !Number.isFinite(baseCost)) continue;
    let addShares = 0;
    let addCost = 0;
    for (const plan of state.plans) {
      if (plan.code !== holding.code) continue;
      for (const execution of plan.executions || []) {
        if (execution.skipped) continue;
        addShares += Number(execution.shares) || 0;
        if (!execution.fromPending) addCost += Number(execution.amount) || 0;
      }
    }
    const wantShares = round4(baseShares + addShares);
    const wantCost = round2(baseCost + (Number(holding.pending) || 0) + addCost);
    if (Math.abs((Number(holding.shares) || 0) - wantShares) > 0.005) {
      holding.shares = wantShares;
      changed = true;
    }
    if (Math.abs((Number(holding.cost) || 0) - wantCost) > 0.005) {
      holding.cost = wantCost;
      changed = true;
    }
  }
  return changed;
}

async function loadState() {
  if (cache) return cache;
  try {
    const raw = await readFile(stateFile(), 'utf8');
    const parsed = JSON.parse(raw);
    cache = {
      ...structuredClone(EMPTY_STATE),
      ...parsed,
      holdings: Array.isArray(parsed.holdings) ? parsed.holdings : [],
      plans: Array.isArray(parsed.plans) ? parsed.plans : [],
      snapshots: parsed.snapshots && typeof parsed.snapshots === 'object' ? parsed.snapshots : {},
      settings: { ...EMPTY_STATE.settings, ...(parsed.settings || {}) },
      quotes: parsed.quotes && typeof parsed.quotes === 'object' ? parsed.quotes : {},
    };
  } catch {
    cache = structuredClone(EMPTY_STATE);
  }
  const deduped = dedupePlans(cache);
  const repaired = repairBaseline(cache);
  const enforced = enforceBaseline(cache);
  if (deduped || repaired || enforced) await saveState(cache).catch(() => {});
  return cache;
}

async function saveState(state) {
  cache = state;
  await mkdir(stateDir(), { recursive: true });
  const target = stateFile();
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(state, null, 2), 'utf8');
  await rename(temp, target);
}

/* ---------------------------------------------------------------- network */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function getJson(url, headers = {}, timeout = 15000) {
  const response = await fetch(url, {
    headers: { ...headers },
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
  return response.json();
}

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeQuote(item) {
  const code = String(item.FCODE || item.CODE || '').trim();
  if (!/^\d{6}$/.test(code)) return null;
  const nav = num(item.NAV);
  const gsz = num(item.GSZ);
  return {
    code,
    name: String(item.SHORTNAME || item.NAME || '').trim(),
    nav: nav,
    navDate: String(item.PDATE || item.FSRQ || '').slice(0, 10),
    navChg: num(item.NAVCHGRT),
    gsz: gsz,
    gszChg: num(item.GSZZL),
    gzTime: String(item.GZTIME || '').replace(/[^\d: -]/g, '').trim(),
    at: Date.now(),
  };
}

function tradingNow() {
  const now = new Date();
  const day = now.getDay();
  if (day < 1 || day > 5) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  return (minutes >= 570 && minutes <= 690) || (minutes >= 780 && minutes <= 900);
}

async function fetchQuotes(codes) {
  const list = [...new Set(codes.filter((code) => /^\d{6}$/.test(code)))];
  if (!list.length) return {};
  const out = {};
  const chunkSize = 40;
  for (let i = 0; i < list.length; i += chunkSize) {
    const chunk = list.slice(i, i + chunkSize);
    const url = 'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo'
      + `?pageIndex=1&pageSize=${chunk.length}&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=1`
      + `&Fcodes=${chunk.join(',')}`;
    try {
      const payload = await getJson(url);
      for (const item of payload?.Datas || []) {
        const quote = normalizeQuote(item);
        if (quote) out[quote.code] = quote;
      }
    } catch (error) {
      // fall through to per-code retry below
      void error;
    }
  }
  const missing = list.filter((code) => !out[code]);
  for (const code of missing) {
    try {
      const url = 'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo'
        + `?pageIndex=1&pageSize=1&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=1&Fcodes=${code}`;
      const payload = await getJson(url);
      const quote = normalizeQuote(payload?.Datas?.[0] || {});
      if (quote) out[code] = quote;
    } catch {
      /* ignore single failures */
    }
  }
  return out;
}

async function fetchHistory(code, pages = 2) {
  const map = new Map();
  for (let page = 1; page <= pages; page += 1) {
    try {
      const payload = await getJson(
        `https://danjuanfunds.com/djapi/fund/nav/history/${code}?size=100&page=${page}`,
        { 'user-agent': UA },
      );
      const items = payload?.data?.items || [];
      if (!items.length) break;
      for (const item of items) {
        const date = String(item.date || '').slice(0, 10);
        const nav = num(item.nav);
        if (date && nav) map.set(date, nav);
      }
      if (items.length < 100) break;
    } catch {
      break;
    }
  }
  if (!map.size) {
    try {
      const payload = await getJson(
        `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=100`,
        { referer: 'http://fundf10.eastmoney.com/', 'user-agent': UA },
      );
      for (const item of payload?.Data?.LSJZList || []) {
        const date = String(item.FSRQ || '').slice(0, 10);
        const nav = num(item.DWJZ);
        if (date && nav) map.set(date, nav);
      }
    } catch {
      /* ignore */
    }
  }
  return map;
}

const historyCache = new Map();

/** Cached NAV history for one code (6h TTL) — used for DCA settlement and backfill. */
async function navHistory(code, pages = 1, force = false) {
  const cached = historyCache.get(code);
  if (!force && cached && Date.now() - cached.at < 6 * 3600_000) return cached.map;
  const map = await fetchHistory(code, pages);
  if (map.size) historyCache.set(code, { at: Date.now(), map });
  return map;
}

/** Latest NAV at or before date (walks back up to 12 days for holidays). */
function navOn(map, dateStr) {
  if (!map || !map.size) return 0;
  if (map.has(dateStr)) return map.get(dateStr);
  let cursor = new Date(`${dateStr}T00:00:00`);
  for (let i = 0; i < 12; i += 1) {
    cursor = new Date(cursor.getTime() - 864e5);
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
    if (map.has(key)) return map.get(key);
  }
  return 0;
}

function weekdaysBack(todayStr, count) {
  const out = [];
  let cursor = new Date(`${todayStr}T00:00:00`);
  let guard = 0;
  while (out.length < count && guard < count * 3) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      out.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`);
    }
    cursor = new Date(cursor.getTime() - 864e5);
    guard += 1;
  }
  return out.reverse();
}

/**
 * Value/cost history. Real snapshots once the portfolio has run a few days;
 * on a fresh install rebuild the last weeks from NAV history + DCA executions.
 */
async function buildSeries(state, today, snapshotRows) {
  const entries = Object.entries(state.snapshots || {})
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, item]) => ({
      date,
      value: item.value,
      cost: item.cost,
      profit: Math.round((item.value - item.cost) * 100) / 100,
    }));
  if (entries.length >= 5 || !state.holdings.length || !snapshotRows.length) {
    return { series: entries.slice(-120), backfilled: false };
  }
  const navs = new Map();
  await Promise.all(state.holdings.slice(0, 15).map(async (holding) => {
    navs.set(holding.code, await navHistory(holding.code, 1).catch(() => new Map()));
  }));
  const buys = [];
  for (const plan of state.plans || []) {
    for (const exec of plan.executions || []) {
      buys.push({ code: plan.code, date: exec.date, amount: Number(exec.amount) || 0, shares: Number(exec.shares) || 0 });
    }
  }
  const dates = weekdaysBack(today, 60);
  const filled = dates.map((date) => {
    let value = 0;
    let cost = 0;
    for (const holding of state.holdings) {
      const nav = navOn(navs.get(holding.code), date);
      if (!nav) continue;
      let shares = Number(holding.shares) || 0;
      let base = Number(holding.cost) || 0;
      for (const buy of buys) {
        if (buy.code === holding.code && buy.date > date) {
          shares -= buy.shares;
          base -= buy.amount;
        }
      }
      if (shares <= 0) continue;
      value += shares * nav;
      cost += Math.max(base, 0);
    }
    return {
      date,
      value: Math.round(value * 100) / 100,
      cost: Math.round(cost * 100) / 100,
      profit: Math.round((value - cost) * 100) / 100,
    };
  }).filter((item) => item.value > 0);
  const merged = new Map(filled.map((item) => [item.date, item]));
  for (const item of entries) merged.set(item.date, item);
  const series = [...merged.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-120);
  return { series, backfilled: filled.length > 1 };
}

async function searchFunds(keyword) {
  const text = String(keyword || '').trim();
  if (!text) return [];
  try {
    const payload = await getJson(
      `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(text)}`,
    );
    return (payload?.Datas || [])
      .filter((item) => /^\d{6}$/.test(String(item.CODE || '')))
      .slice(0, 8)
      .map((item) => ({
        code: String(item.CODE),
        name: String(item.NAME || '').trim(),
        company: String(item.FundBaseInfo?.JJGS || '').trim(),
        type: String(item.FundBaseInfo?.FTYPE || item.CATEGORYDESC || '').trim(),
      }));
  } catch {
    return [];
  }
}

/** Bigram overlap of two fund titles, ignoring share-class punctuation. */
function nameScore(a, b) {
  const clean = (text) => String(text || '').replace(/[（()）\s·・.,，。\-—_]/g, '').replace(/[A-Za-z]+$/i, '');
  const grams = (text) => {
    const chars = [...clean(text)];
    const out = new Set();
    for (let i = 0; i < chars.length - 1; i += 1) out.add(chars[i] + chars[i + 1]);
    return out;
  };
  const left = grams(a);
  const right = grams(b);
  if (!left.size || !right.size) return 0;
  let hit = 0;
  for (const gram of left) if (right.has(gram)) hit += 1;
  return (2 * hit) / (left.size + right.size);
}

async function resolveOne(row) {
  if (row.code && /^\d{6}$/.test(row.code)) {
    const quotes = await fetchQuotes([row.code]);
    return { code: row.code, quote: quotes[row.code] || null, matchedBy: 'code' };
  }
  if (!row.name) return { code: '', quote: null, matchedBy: '' };
  const candidates = await searchFunds(row.name);
  if (!candidates.length) return { code: '', quote: null, matchedBy: '' };
  // Never accept a name-search hit blindly: a bogus title used to resolve to an
  // unrelated fund and show the wrong holding. Require a real title overlap.
  const scored = candidates
    .map((item) => ({ item, score: nameScore(row.name, item.name) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  const exact = candidates.find((item) => row.name.includes(item.name) || item.name.includes(row.name));
  const chosen = exact || (best && best.score >= 0.45 ? best.item : null);
  if (!chosen) return { code: '', quote: null, matchedBy: '' };
  const quotes = await fetchQuotes([chosen.code]);
  return { code: chosen.code, quote: quotes[chosen.code] || null, matchedBy: exact ? 'name' : 'fuzzy' };
}

let indexCache = { at: 0, rows: [] };

/* 「关联板块」：没有盘中估值时，用跟踪指数/板块的涨跌推算当日收益，和养基宝一个口径。 */
const SECTOR_RULES = [
  { re: /纳斯达克|纳指/i, secid: '100.NDX', label: '纳斯达克100' },
  { re: /标普500|标普/i, secid: '100.SPX', label: '标普500' },
  { re: /道琼斯|道指/i, secid: '100.DJIA', label: '道琼斯' },
  { re: /恒生科技/i, secid: '124.HSTECH', label: '恒生科技' },
  { re: /恒生/i, secid: '100.HSI', label: '恒生指数' },
  { re: /沪深300|沪深３００/, secid: '1.000300', label: '沪深300' },
  { re: /中证500|中证５００/, secid: '1.000905', label: '中证500' },
  { re: /中证1000/, secid: '1.000852', label: '中证1000' },
  { re: /创业板/, secid: '0.399006', label: '创业板指' },
  { re: /科创50|科创板/, secid: '1.000688', label: '科创50' },
  { re: /白酒/, secid: '0.399997', label: '中证白酒' },
  { re: /医药|医疗/, secid: '0.399989', label: '中证医疗' },
  { re: /半导体|芯片/, secid: '0.990001', label: '半导体' },
  { re: /新能源|光伏/, secid: '0.399808', label: '中证新能' },
  { re: /黄金|金ETF/, secid: '101.GC00Y', label: '伦敦金' },
  { re: /原油|石油/, secid: '101.CL00Y', label: '原油' },
  { re: /红利/, secid: '1.000015', label: '上证红利' },
  { re: /上证50/, secid: '1.000016', label: '上证50' },
];

function sectorFor(name) {
  const text = String(name || '');
  for (const rule of SECTOR_RULES) if (rule.re.test(text)) return { secid: rule.secid, label: rule.label };
  return null;
}

let sectorCache = { at: 0, map: {} };

async function fetchSectors(secids, force = false) {
  const unique = [...new Set(secids.filter(Boolean))];
  if (!unique.length) return {};
  if (!force && Date.now() - sectorCache.at < 60_000) {
    const cached = unique.every((id) => sectorCache.map[id] !== undefined);
    if (cached) return sectorCache.map;
  }
  // ulist.np 那支接口现在经常直接断开，改成逐只走 stock/get（这个稳定）。
  const map = { ...sectorCache.map };
  let touched = false;
  await Promise.all(unique.map(async (secid) => {
    try {
      const payload = await getJson(
        `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f58,f170`,
        { referer: 'https://quote.eastmoney.com/', 'user-agent': UA },
      );
      const chg = num(payload?.data?.f170);
      if (chg == null) return;
      const hit = {
        label: String(payload?.data?.f58 || ''),
        chgPct: Math.round((chg / 100) * 100) / 100,
        at: Date.now(),
      };
      map[secid] = hit;
      const bare = secid.split('.').pop();
      if (bare) map[bare] = hit;
      touched = true;
    } catch (error) {
      void error;
    }
  }));
  if (touched) sectorCache = { at: Date.now(), map };
  return map;
}

async function attachSectors(holdings, quotes, force = false) {
  const wanted = [];
  for (const holding of holdings || []) {
    const sector = sectorFor(holding.name || quotes[holding.code]?.name);
    if (sector) wanted.push(sector.secid);
  }
  if (!wanted.length) return;
  const map = await fetchSectors(wanted, force);
  for (const holding of holdings || []) {
    const sector = sectorFor(holding.name || quotes[holding.code]?.name);
    if (!sector) continue;
    const hit = map[sector.secid] || map[String(sector.secid).split('.').pop()];
    const quote = quotes[holding.code];
    if (!quote) continue;
    quote.sector = { label: sector.label, chgPct: hit ? hit.chgPct : null };
  }
}

async function fetchIndexes(force = false) {
  if (!force && indexCache.rows.length && Date.now() - indexCache.at < 30_000) return indexCache.rows;
  const targets = [
    { secid: '1.000001', label: '上证指数' },
    { secid: '1.000300', label: '沪深300' },
    { secid: '0.399006', label: '创业板指' },
  ];
  const out = [];
  for (const target of targets) {
    try {
      const payload = await getJson(
        `https://push2.eastmoney.com/api/qt/stock/get?secid=${target.secid}&fields=f43,f58,f170,f169`,
        { referer: 'https://quote.eastmoney.com/', 'user-agent': UA },
      );
      const data = payload?.data;
      if (!data) continue;
      out.push({
        label: target.label,
        name: String(data.f58 || target.label),
        point: num(data.f43) == null ? null : num(data.f43) / 100,
        chgPct: num(data.f170) == null ? null : num(data.f170) / 100,
      });
    } catch {
      /* ignore */
    }
  }
  if (out.length) indexCache = { at: Date.now(), rows: out };
  return out.length ? out : indexCache.rows;
}

/* -------------------------------------------------------------------- OCR */

let ocrProbe = null;

function runPowershell(args, timeout = 90000) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args], {
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('OCR 超时'));
    }, timeout);
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function ocrLanguages() {
  if (ocrProbe) return ocrProbe;
  try {
    const { stdout } = await runPowershell([
      '-Command',
      "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; [Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime]::AvailableRecognizerLanguages | ForEach-Object { $_.LanguageTag }",
    ], 30000);
    const tags = stdout.split(/\s+/).map((item) => item.trim()).filter(Boolean);
    const lang = tags.find((tag) => /zh-Hans/i.test(tag)) || tags.find((tag) => /^zh/i.test(tag)) || tags[0] || '';
    ocrProbe = { available: Boolean(lang), lang, tags };
  } catch (error) {
    ocrProbe = { available: false, lang: '', tags: [], error: String(error?.message || error) };
  }
  return ocrProbe;
}

function decodeBase64Image(data) {
  const text = String(data || '');
  const comma = text.indexOf(',');
  const base = text.startsWith('data:') && comma >= 0 ? text.slice(comma + 1) : text;
  return Buffer.from(base, 'base64');
}

async function ocrImage(buffer, options = {}) {
  const probe = await ocrLanguages();
  if (!probe.available) throw new Error('本机未安装 Windows OCR 中文识别组件');
  const dir = path.join(stateDir(), 'tmp');
  await mkdir(dir, { recursive: true });
  const imagePath = path.join(dir, `${randomUUID()}.png`);
  const outPath = `${imagePath}.json`;
  await writeFile(imagePath, buffer);
  const extra = [];
  if (options.crop) extra.push('-Crop', String(options.crop), '-Scale', String(options.scale || 4));
  try {
    const { stdout, stderr } = await runPowershell([
      '-File', OCR_SCRIPT,
      '-Path', imagePath,
      '-Out', outPath,
      '-Lang', probe.lang,
      ...extra,
    ]);
    const raw = await readFile(outPath, 'utf8').catch(() => '');
    if (!raw) throw new Error(`OCR 无输出 ${stderr || stdout}`.trim());
    const parsed = JSON.parse(raw);
    if (!parsed.ok) throw new Error(String(parsed.error || 'OCR 失败'));
    return parsed;
  } finally {
    await rm(imagePath, { force: true }).catch(() => {});
    await rm(outPath, { force: true }).catch(() => {});
  }
}

/**
 * A number the first OCR pass mangled ("+9" + "2" for 9.62) is re-read from a
 * cropped, 4x-upscaled patch of the same screenshot. Only accepted when it stays
 * in the same ballpark and the same direction as what we already had.
 */
async function repairRowNumbers(row, buffer) {
  const hints = Array.isArray(row.repair) ? row.repair : [];
  for (const hint of hints) {
    try {
      const patch = await ocrImage(buffer, { crop: hint.box.join(','), scale: 4 });
      const text = (patch.lines || [])
        .map((line) => line.words.map((word) => word.t).join(' '))
        .join(' ');
      const value = parsePatchNumber(text);
      if (value == null) continue;
      const current = Number.isFinite(Number(row[hint.kind])) ? Number(row[hint.kind]) : null;
      if (current != null && Math.abs(value) > Math.abs(current) * 5 + 10) continue;
      row[hint.kind] = value;
      row.patched = (row.patched || []).concat(hint.kind);
    } catch {
      /* a failed patch just leaves the first-pass number in place */
    }
  }
  delete row.repair;
  if (row.patched && Number.isFinite(Number(row.value)) && Number.isFinite(Number(row.profit))) {
    row.cost = Math.round((Number(row.value) - Number(row.profit)) * 100) / 100;
    const base = Number(row.value) - Number(row.profit);
    if (base) row.pct = Math.round((Number(row.profit) / base) * 10000) / 100;
  }
  return row;
}

/* ------------------------------------------------------------- settlement */

/**
 * "下次扣款 12-10" from a fund-company screenshot → the date the next buy lands on.
 * Fund companies keep charging on the same rule date, so the plan is anchored there
 * instead of restarting from today.
 */
function resolveHintDate(hint) {
  const text = String(hint || '').trim();
  const match = text.match(/(\d{1,2})\s*[-一－—~～\/.月]\s*(\d{1,2})/);
  if (!match) return '';
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= 31)) return '';
  const today = ymd();
  const year = Number(today.slice(0, 4));
  const pad = (value) => String(value).padStart(2, '0');
  let candidate = `${year}-${pad(month)}-${pad(day)}`;
  if (candidate < today) candidate = `${year + 1}-${pad(month)}-${pad(day)}`;
  return candidate;
}

function ensurePlanShape(plan) {
  const now = new Date().toISOString().slice(0, 10);
  return {
    id: plan.id || randomUUID(),
    code: String(plan.code || ''),
    name: String(plan.name || plan.code || ''),
    amount: Math.max(0, Number(plan.amount) || 0),
    cycle: ['daily', 'weekly', 'monthly'].includes(plan.cycle) ? plan.cycle : 'monthly',
    weekday: Number.isInteger(Number(plan.weekday)) && Number(plan.weekday) >= 0 && Number(plan.weekday) <= 6 ? Number(plan.weekday) : 1,
    day: Math.min(31, Math.max(1, Number(plan.day) || 1)),
    startDate: plan.startDate || now,
    enabled: plan.enabled !== false,
    autoDetect: plan.autoDetect !== false,
    lastRun: plan.lastRun || '',
    executions: Array.isArray(plan.executions) ? plan.executions.slice(-400) : [],
    createdAt: plan.createdAt || now,
  };
}

async function settlePlans(state, force = false) {
  const today = ymd();
  const fresh = force || state.lastSettle !== today || (Date.now() - (state.lastSettleAt || 0) > 30 * 60_000);
  if (!fresh) return [];
  state.lastSettle = today;
  state.lastSettleAt = Date.now();
  const changed = [];
  for (const plan of state.plans) {
    if (!plan.enabled) continue;
    if (plan.amount <= 0 || !/^\d{6}$/.test(plan.code)) continue;
    const due = planDueDates(plan, today);
    if (!due.length) {
      if (!plan.lastRun) plan.lastRun = today;
      continue;
    }
    const staleToday = due.includes(today) && !plan.executions.some((item) => item.date === today);
    const history = staleToday ? await navHistory(plan.code, 3, true) : await fetchHistory(plan.code, 3);
    let executed = 0;
    // 净值还没出的日子先不要推进 lastRun，否则今天这一期会被永久跳过；
    // 超过两天还拿不到净值（长假/停牌）才认账，避免每次刷新都回头重算。
    const giveUpBefore = ymd(new Date(Date.now() - 2 * 864e5));
    for (const date of due) {
      const nav = history.get(date);
      if (!nav) {
        if (date < giveUpBefore) plan.lastRun = date;
        continue;
      }
      const already = plan.executions.some((item) => item.date === date);
      const holding = state.holdings.find((item) => item.code === plan.code);
      // 截图里的「待确认金额」= 已经扣过款、份额还没确认的钱。
      // 这种期数只需要把 pending 换成份额，绝不能再加一次成本，否则就是重复计算。
      const fromPending = Number(holding?.pending) >= plan.amount - 0.005;
      // 基准日（截图那天）及之前的期数，钱已经在截图的份额/成本里了，跳过。
      const baseDate = String(holding?.baseAt || '').slice(0, 10);
      if (!fromPending && baseDate && date <= baseDate) {
        if (!already) plan.executions.push({ date, amount: plan.amount, nav, shares: plan.amount / nav, skipped: true });
        plan.lastRun = date;
        continue;
      }
      plan.lastRun = date;
      if (already) continue;
      const shares = plan.amount / nav;
      plan.executions.push(fromPending ? { date, amount: plan.amount, nav, shares, fromPending: true } : { date, amount: plan.amount, nav, shares });
      if (holding) {
        holding.shares += shares;
        if (fromPending) {
          holding.pending = round2(Math.max(0, Number(holding.pending || 0) - plan.amount));
          holding.baseCost = round2((Number(holding.baseCost) || 0) + plan.amount);
        }
        else holding.cost += plan.amount;
        holding.updatedAt = new Date().toISOString();
        holding.autoInvest = true;
      } else {
        state.holdings.push({
          code: plan.code,
          name: plan.name,
          shares,
          cost: plan.amount,
          updatedAt: new Date().toISOString(),
          source: 'plan',
          autoInvest: true,
        });
      }
      executed += 1;
    }
    if (executed && !changed.includes(plan.code)) changed.push(plan.code);
  }
  if (force) {
    for (const plan of state.plans) {
      if (!plan.lastRun) plan.lastRun = today;
    }
  }
  return changed;
}

/* --------------------------------------------------------------- snapshot */

async function buildPayload(state, { force = false } = {}) {
  const today = ymd();
  const codes = new Set([
    ...state.holdings.map((item) => item.code),
    ...state.plans.map((item) => item.code),
  ]);
  const quotes = { ...(state.quotes || {}) };
  const ttl = tradingNow() ? 60_000 : 5 * 60_000;
  if (force || ((Date.now() - lastRefreshAt > ttl) && codes.size)) {
    const fresh = await fetchQuotes([...codes]);
    Object.assign(quotes, fresh);
    lastRefreshAt = Date.now();
  }
  state.quotes = quotes;

  await attachSectors(state.holdings, quotes, force).catch(() => {});
  const summary = summarize(state.holdings, quotes, today);
  const snapshot = { value: Math.round(summary.value * 100) / 100, cost: Math.round(summary.cost * 100) / 100 };
  if (summary.value > 0) state.snapshots[today] = snapshot;
  const keepFrom = ymd(new Date(Date.now() - 400 * 864e5));
  for (const key of Object.keys(state.snapshots)) {
    if (key < keepFrom) delete state.snapshots[key];
  }

  const { series, backfilled } = await buildSeries(state, today, summary.rows);

  const plans = state.plans.map((plan) => {
    // 今天该扣但净值还没出 → 叫「待确认」，别让用户以为漏了。
    const dueToday = plan.enabled && effectiveDates(plan, today, today).includes(today);
    const doneToday = plan.executions.some((item) => String(item.date) === today && !item.skipped);
    return {
      ...plan,
      nextDates: plan.enabled ? upcomingDates(plan, today, 3) : [],
      invested: plan.executions.reduce((sum, item) => (item.skipped ? sum : sum + (Number(item.amount) || 0)), 0),
      doneCount: plan.executions.filter((item) => !item.skipped).length,
      lastExecution: [...plan.executions].reverse().find((item) => !item.skipped) || null,
      dueToday,
      pendingToday: dueToday && !doneToday ? Number(plan.amount) || 0 : 0,
    };
  });

  const notifyView = maskNotify(state.settings?.notify || {});
  const probe = await ocrLanguages();
  const indexes = codes.size ? await fetchIndexes(force).catch(() => []) : [];
  const trading = tradingNow();
  const nextRefreshAt = (lastRefreshAt || Date.now()) + (trading ? 60_000 : 5 * 60_000);

  return {
    today,
    trading,
    summary,
    holdings: summary.rows.map((row) => {
      const raw = state.holdings.find((item) => item.code === row.code) || {};
      return { ...row, source: raw.source || 'import', note: raw.note || '', autoInvest: Boolean(raw.autoInvest) };
    }),
    rawHoldings: state.holdings,
    plans,
    series,
    seriesBackfilled: backfilled,
    quotes,
    indexes,
    ocr: { available: probe.available, lang: probe.lang, tags: probe.tags },
    settings: { ...state.settings, notify: notifyView },
    quotesAt: lastRefreshAt || 0,
    lanUrls,
    nextRefreshAt,
    lastSettle: state.lastSettle || '',
    lastSettleAt: state.lastSettleAt || 0,
    updatedAt: new Date().toISOString(),
  };
}

let lastRefreshAt = 0;
let lanServer = null;
let lanUrls = [];

/* -------------------------------------------------------------- http glue */

function sendJson(response, status, payload) {
  if (response.headersSent) return;
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, status, text) {
  if (response.headersSent) return;
  response.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' });
  response.end(text);
}

function allowRequest(request) {
  const site = String(request.headers['sec-fetch-site'] || '');
  if (site === 'cross-site') return false;
  const origin = String(request.headers.origin || '');
  if (origin === 'null') return false;
  if (origin) {
    try {
      const url = new URL(origin);
      const host = String(request.headers.host || '');
      if (host && url.host !== host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function readJson(request, limit = 24 * 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('请求过大'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('JSON 解析失败'), { status: 400 });
  }
}

/* --------------------------------------------------------------- handlers */

async function handleApi(request, response, route) {
  if (!allowRequest(request)) {
    sendJson(response, 403, { ok: false, error: { message: '拒绝跨站请求' } });
    return;
  }
  const state = await loadState();

  try {
    if (route === 'state') {
      if (request.method === 'POST') await settlePlans(state);
      const payload = await buildPayload(state);
      await saveState(state);
      sendJson(response, 200, { ok: true, value: payload });
      return;
    }

    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: { message: '仅支持 POST' } });
      return;
    }

    const body = await readJson(request);

    if (route === 'refresh') {
      await settlePlans(state);
      const payload = await buildPayload(state, { force: true });
      await saveState(state);
      sendJson(response, 200, { ok: true, value: payload });
      return;
    }

    if (route === 'import') {
      const today = ymd();
      const holdingsRaw = [];
      const plansRaw = [];
      const mode = ['holdings', 'plans'].includes(body.mode) ? body.mode : 'auto';
      const forcedChannel = ['direct', 'platform', 'unknown'].includes(body.channel) ? body.channel : '';
      const sources = [];
      for (const image of body.images || []) {
        const buffer = decodeBase64Image(image.data);
        if (!buffer.length) continue;
        const ocr = await ocrImage(buffer);
        const channel = forcedChannel || detectChannel(ocrText(ocr));
        const parsed = parseImportOcr(ocr, today);
        const label = image.name || '';
        sources.push({ name: label, channel });
        if (mode !== 'plans') {
          for (const row of parsed.holdings) {
            if (row.repair?.length) await repairRowNumbers(row, buffer);
            holdingsRaw.push({ ...row, channel, sourceImage: label });
          }
        }
        if (mode !== 'holdings') {
          for (const row of parsed.plans) plansRaw.push({ ...row, channel, sourceImage: label });
        }
      }
      if (body.text) {
        const channel = forcedChannel || 'unknown';
        const parsed = parseImportText(body.text);
        if (mode !== 'plans') {
          for (const row of parsed.holdings) holdingsRaw.push({ ...row, channel, sourceImage: 'text' });
        }
        if (mode !== 'holdings') {
          for (const row of parsed.plans) plansRaw.push({ ...row, channel, sourceImage: 'text' });
        }
      }

      const enrich = async (row) => {
        const resolved = await resolveOne({ code: row.code, name: row.name });
        const quote = resolved.quote;
        const pct = row.pct ?? (row.profit != null && row.value ? (row.profit / (row.value - row.profit)) * 100 : null);
        return {
          ...row,
          code: row.code || resolved.code,
          // Official names beat OCR text — "（QD《DA" must never reach the panel.
          name: quote?.name || row.name || '',
          rawName: row.name || '',
          officialName: quote?.name || '',
          nav: quote?.nav ?? null,
          navDate: quote?.navDate ?? null,
          matchedBy: resolved.matchedBy,
          pct,
        };
      };

      const enriched = [];
      for (const row of holdingsRaw) enriched.push(await enrich(row));
      const plans = [];
      for (const row of plansRaw) plans.push(await enrich(row));

      // One row per fund code: a fund-company screenshot already contains the
      // distributor's slice, so the two must never be added together.
      const withShares = enriched.map((row) => {
        const normalized = normalizeHolding(row, row.nav);
        return {
          ...row,
          shares: normalized?.shares ?? null,
          cost: normalized?.cost ?? null,
          channel: row.channel || 'unknown',
        };
      });
      const holdings = mergeImportedRows(withShares);
      sendJson(response, 200, { ok: true, value: { rows: holdings, holdings, plans, sources, mode } });
      return;
    }

    if (route === 'holdings') {
      const items = Array.isArray(body.holdings) ? body.holdings : (body.holding ? [body.holding] : []);
      const skipped = [];
      if (body.action === 'clear') {
        state.holdings = [];
        await saveState(state);
        sendJson(response, 200, { ok: true, value: await buildPayload(state, { force: true }) });
        return;
      }
      if (body.action === 'remove') {
        const codes = new Set(items.map((item) => String(item.code || '')).filter(Boolean));
        state.holdings = state.holdings.filter((item) => !codes.has(item.code));
        await saveState(state);
        sendJson(response, 200, { ok: true, value: await buildPayload(state, { force: true }) });
        return;
      }
      for (const item of items) {
        const code = String(item.code || '').trim();
        if (!/^\d{6}$/.test(code)) continue;
        let nav = Number(item.nav);
        if (!Number.isFinite(nav) || nav <= 0) {
          const quotes = await fetchQuotes([code]);
          nav = quotes[code]?.nav ?? 0;
        }
        const normalized = normalizeHolding(item, nav);
        if (!normalized) continue;
        const existing = state.holdings.find((row) => row.code === code);
        const channel = ['direct', 'platform', 'unknown'].includes(item.channel) ? item.channel : (existing?.channel || 'unknown');
        const rankNew = CHANNEL_RANK[channel] ?? 1;
        const rankOld = CHANNEL_RANK[existing?.channel || 'unknown'] ?? 1;
        // Fund-company (direct) holdings are the whole TA account. A distributor
        // screenshot arriving afterwards is the same money — merging would double it.
        if (existing && rankOld > rankNew && normalized.shares <= existing.shares * 1.02) {
          skipped.push({
            code,
            name: existing.name,
            reason: 'duplicate',
            kept: existing.shares,
            dropped: normalized.shares,
          });
          continue;
        }
        if (existing?.autoInvest && Number.isFinite(Number(existing.baseShares))
          && normalized.shares < Number(existing.baseShares) - 0.01) {
          skipped.push({
            code,
            name: existing.name,
            reason: 'stale',
            kept: existing.baseShares,
            dropped: normalized.shares,
          });
          continue;
        }
        const absorbed = Array.isArray(item.mergedFrom) ? item.mergedFrom.filter((row) => row && row.channel !== 'direct') : [];
        const absorbedSum = (match) => absorbed
          .filter(match)
          .reduce((sum, row) => sum + (Number(row.value) || 0), 0);
        const platformSum = absorbedSum((row) => row.channel === 'platform');
        const otherSum = absorbedSum((row) => row.channel !== 'platform');
        const noteParts = [];
        if (platformSum > 0) noteParts.push(`已含代销 ¥${platformSum.toFixed(2)}`);
        else if (absorbed.some((row) => row.channel === 'platform')) noteParts.push('已含代销份额');
        if (otherSum > 0) noteParts.push(`另有其他来源 ¥${otherSum.toFixed(2)}·未计入`);
        const note = noteParts.join('；');
        const next = {
          code,
          name: String(item.name || existing?.name || '').trim(),
          shares: normalized.shares,
          cost: normalized.cost,
          pending: normalized.pending || 0,
          dayProfit: Number.isFinite(Number(item.day)) && item.dayDate ? Number(item.day) : existing?.dayProfit ?? null,
          dayDate: item.dayDate || existing?.dayDate || null,
          updatedAt: new Date().toISOString(),
          source: item.source || existing?.source || 'import',
          channel,
          note,
          autoInvest: Boolean(existing?.autoInvest || item.autoInvest),
          // 截图那一刻的份额/成本是基准：定投结算只买这之后的期数，之前的已经含在里面了。
          baseShares: normalized.shares,
          baseCost: round2(normalized.cost - (Number(normalized.pending) || 0)),
          baseAt: new Date().toISOString(),
        };
        if (existing) Object.assign(existing, next);
        else state.holdings.push(next);
      }
      await saveState(state);
      const payload = await buildPayload(state, { force: true });
      sendJson(response, 200, { ok: true, value: { ...payload, skipped } });
      return;
    }

    if (route === 'plans') {
      if (body.action === 'remove') {
        state.plans = state.plans.filter((plan) => plan.id !== body.id);
        await saveState(state);
        sendJson(response, 200, { ok: true, value: await buildPayload(state) });
        return;
      }
      if (body.action === 'save' && (body.plan || Array.isArray(body.plans))) {
        const incoming = Array.isArray(body.plans) ? body.plans : [body.plan];
        const saved = [];
        for (const input of incoming) {
          if (!input) continue;
          const plan = ensurePlanShape({ ...input, id: input.id || undefined });
          if (plan.amount <= 0) continue;
          if (!/^\d{6}$/.test(plan.code)) {
            const resolved = await resolveOne({ code: plan.code, name: input.name });
            if (!/^\d{6}$/.test(resolved.code || '')) continue;
            plan.code = resolved.code;
            if (!plan.name || plan.name === input.code) plan.name = resolved.quote?.name || plan.name;
          }
          const nameMissing = !plan.name || plan.name === plan.code;
          if (nameMissing) {
            const resolved = await resolveOne({ code: plan.code, name: input.name });
            plan.name = resolved.quote?.name || plan.name;
          }
          if (input.nextHint) {
            const anchorDate = resolveHintDate(input.nextHint);
            if (anchorDate) {
              plan.nextAnchor = anchorDate;
              plan.startDate = plan.startDate && plan.startDate <= anchorDate ? plan.startDate : anchorDate;
              plan.lastRun = prevRuleDate(plan, anchorDate);
            }
          }
          // 同一个 code 只保留一个计划：先按 id 命中，再按 code 命中，避免重复建计划
          // 导致同一期被买两次（历史上「凭空多 200」就是这条路）。
          let index = state.plans.findIndex((item) => item.id === plan.id);
          if (index < 0) index = state.plans.findIndex((item) => item.code === plan.code);
          if (index >= 0) {
            plan.id = state.plans[index].id;
            state.plans[index] = { ...state.plans[index], ...plan };
          } else state.plans.push(plan);
          saved.push(plan.id);
          const holding = state.holdings.find((row) => row.code === plan.code);
          if (holding) holding.autoInvest = true;
        }
        await saveState(state);
        const payload = await buildPayload(state);
        sendJson(response, 200, { ok: true, value: { ...payload, savedIds: saved } });
        return;
      }
      if (body.action === 'run') {
        const plan = state.plans.find((item) => item.id === body.id);
        if (!plan) {
          sendJson(response, 404, { ok: false, error: { message: '定投计划不存在' } });
          return;
        }
        // 只结清「已经到期但还没买」的期数；不把 lastRun 倒回去重放历史，
        // 历史那些期已经包含在导入截图里了，重放就是重复计算。
        const holding = state.holdings.find((row) => row.code === plan.code);
        const baseDate = String(holding?.baseAt || '').slice(0, 10);
        if (baseDate && String(plan.lastRun || '') < baseDate) plan.lastRun = baseDate;
        await settlePlans(state, true);
        await saveState(state);
        sendJson(response, 200, { ok: true, value: await buildPayload(state, { force: true }) });
        return;
      }
      sendJson(response, 400, { ok: false, error: { message: '未知操作' } });
      return;
    }

    if (route === 'notify') {
      const current = state.settings?.notify || {};
      if (body.action === 'test') {
        const merged = mergeNotify(current, body.notify || {});
        try {
          const payload = await buildPayload(state, { force: true });
          const report = buildReport(payload, { slot: new Date().getHours() < 12 ? 'morning' : 'evening' });
          const job = merged.mail?.user
            ? sendMail(merged.mail, `[测试] ${report.subject}`, report.body)
            : sendOneBot(merged.onebot, `[测试] ${report.subject}\n${report.body}`);
          const result = await job;
          sendJson(response, 200, { ok: true, value: { sent: result, notify: maskNotify(merged) } });
        } catch (error) {
          sendJson(response, 200, { ok: false, error: { message: String(error?.message || error) } });
        }
        return;
      }
      state.settings = { ...state.settings, notify: mergeNotify(current, body.notify || {}) };
      await saveState(state);
      sendJson(response, 200, { ok: true, value: { notify: maskNotify(state.settings.notify) } });
      return;
    }

    if (route === 'settings') {
      if (body.action === 'reset') {
        state.holdings = [];
        state.plans = [];
        state.snapshots = {};
        state.quotes = {};
        await saveState(state);
        sendJson(response, 200, { ok: true, value: await buildPayload(state, { force: true }) });
        return;
      }
      state.settings = { ...state.settings, ...(body.settings || {}) };
      await saveState(state);
      sendJson(response, 200, { ok: true, value: await buildPayload(state) });
      return;
    }

    if (route === 'search') {
      const results = await searchFunds(body.q || '');
      if (!results.length && /^\d{6}$/.test(String(body.q || '').trim())) {
        const quotes = await fetchQuotes([String(body.q).trim()]);
        const quote = Object.values(quotes)[0];
        if (quote) results.push({ code: quote.code, name: quote.name, company: '', type: '' });
      }
      sendJson(response, 200, { ok: true, value: { results } });
      return;
    }

    sendJson(response, 404, { ok: false, error: { message: `未知接口 ${route}` } });
  } catch (error) {
    sendJson(response, error?.status || 500, {
      ok: false,
      error: { message: String(error?.message || error) },
    });
  }
}


/* --------------------------------------------------------------- LAN view */
// DSH 的 web 服务只监听 127.0.0.1，手机进不来。这里再开一个监听 0.0.0.0 的小服务，
// 只做两件事：发手机页面、把 /my-funds/* 原样转给本机 DSH。别的路径一律 404。
const LAN_PORT = Number(process.env.MY_FUNDS_LAN_PORT || 51399);

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal) out.push(item.address);
    }
  }
  return out;
}

function startLanServer(origin) {
  const server = http.createServer((request, response) => {
    const url = String(request.url || '/');
    if (request.method === 'GET' && (url === '/' || url === '/m' || url.startsWith('/?'))) {
      readFile(MOBILE_PAGE, 'utf8')
        .then((html) => {
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
          response.end(html);
        })
        .catch(() => sendText(response, 500, 'mobile page missing'));
      return;
    }
    if (!url.startsWith('/my-funds/')) {
      sendText(response, 404, 'not found');
      return;
    }
    const target = new URL(origin);
    // 手机是从局域网地址来的，Origin 跟本机端口对不上会被跨站防护挡掉，
    // 这里把它改写成上游自己的源，等于内部转发。
    const headers = { ...request.headers, host: target.host, origin: target.origin, referer: `${target.origin}/` };
    delete headers['content-length'];
    if (request.headers['content-length']) headers['content-length'] = request.headers['content-length'];
    const upstream = http.request({
      host: target.hostname,
      port: target.port,
      path: url,
      method: request.method,
      headers,
    }, (reply) => {
      response.writeHead(reply.statusCode || 502, reply.headers);
      reply.pipe(response);
    });
    upstream.on('error', () => sendText(response, 502, 'dsh unreachable'));
    request.pipe(upstream);
  });
  let retried = false;
  server.on('error', (error) => {
    // HMR 重载时旧监听可能还没彻底释放，稍等再试一次；再失败就放弃，
    // 面板会显示「手机地址不可用」，不会一直挂在一个死连接上。
    if (!retried && error && error.code === 'EADDRINUSE') {
      retried = true;
      setTimeout(() => {
        try {
          server.listen(LAN_PORT, '0.0.0.0');
        } catch {
          /* ignore */
        }
      }, 800).unref?.();
    }
  });
  server.listen(LAN_PORT, '0.0.0.0');
  server.unref?.();
  return server;
}

/* ----------------------------------------------------------------- plugin */

export function apply(ctx) {
  ctx.inject(['webServer'], (host) => {
    host.effect(() => host.webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: async (request, response) => {
        const url = new URL(request.url || '/', 'http://localhost');
        const route = url.pathname.slice(API_PREFIX.length).replace(/^\/+/, '').split('/')[0] || 'state';
        await handleApi(request, response, route);
      },
    }, 'my-funds: api'), 'my-funds: routes');

    // 手机端：一个不依赖 DSH 前端外壳的只读页面，手机浏览器直接打开 /my-funds/m。
    host.effect(() => host.webServer.register({
      kind: 'exact',
      path: '/my-funds/m',
      handler: async (request, response) => {
        const html = await readFile(MOBILE_PAGE, 'utf8').catch(() => '');
        if (!html) {
          sendText(response, 500, 'mobile page missing');
          return;
        }
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        });
        response.end(html);
      },
    }, 'my-funds: mobile'), 'my-funds: mobile route');

    // 手机直连：0.0.0.0 上的小服务，地址随 /state 一起返回给面板显示。
    const origin = (() => {
      try {
        return host.webServer.getOrigin();
      } catch {
        return 'http://127.0.0.1:51385';
      }
    })();
    lanServer = startLanServer(origin);
    lanUrls = lanAddresses().map((ip) => `http://${ip}:${LAN_PORT}/`);
    host.effect(() => () => {
      try {
        lanServer?.close();
      } catch {
        /* ignore */
      }
    }, 'my-funds: lan dispose');
  });

  void ocrLanguages();

  const timer = setInterval(() => {
    void (async () => {
      try {
        const state = await loadState();
        if (!state.settings?.autoRefresh) return;
        if (!state.holdings.length && !state.plans.length) return;
        await settlePlans(state);
        await buildPayload(state, { force: true });
        await saveState(state);
      } catch {
        /* keep quiet */
      }
    })();
  }, 5 * 60 * 1000);
  if (typeof timer.unref === 'function') timer.unref();

  ctx.effect(() => () => clearInterval(timer), 'my-funds: refresh timer');
  // 定时推送：cron 里写 "08:00" 这种本地时间。
  // 不要求「正好这一分钟在线」：只要今天这个时间点已经过去且还没发过，就在 6 小时
  // 内补发一次，这样电脑休眠/刚开机也不会整天没有日报。
  const notifyTimer = setInterval(() => {
    void (async () => {
      try {
        const state = await loadState();
        const notify = state.settings?.notify;
        if (!notify?.enabled || !Array.isArray(notify.cron) || !notify.cron.length) return;
        if (!state.holdings.length) return;
        const now = new Date();
        const today = ymd(now);
        const due = [];
        for (const entry of notify.cron) {
          const match = /^(\d{1,2}):(\d{2})$/.exec(String(entry || '').trim());
          if (!match) continue;
          const at = new Date(now);
          at.setHours(Number(match[1]), Number(match[2]), 0, 0);
          const late = now.getTime() - at.getTime();
          if (late < 0 || late > 6 * 3600 * 1000) continue;
          const stamp = `${today} ${String(match[1]).padStart(2, '0')}:${match[2]}`;
          if (notify.lastSent === stamp) continue;
          due.push({ stamp, hour: Number(match[1]) });
        }
        if (!due.length) return;
        const target = due[0];
        const payload = await buildPayload(state, { force: true });
        const report = buildReport(payload, { slot: target.hour < 12 ? 'morning' : 'evening' });
        let sent = null;
        if (notify.mail?.user && notify.mail?.pass && notify.mail?.to) {
          sent = await sendMail(notify.mail, report.subject, report.body);
        } else if (notify.onebot?.base) {
          sent = await sendOneBot(notify.onebot, `${report.subject}\n${report.body}`);
        }
        if (sent) {
          notify.lastSent = target.stamp;
          await saveState(state);
        }
      } catch {
        /* keep quiet */
      }
    })();
  }, 30 * 1000);
  if (typeof notifyTimer.unref === 'function') notifyTimer.unref();
  ctx.effect(() => () => clearInterval(notifyTimer), 'my-funds: notify timer');


  setTimeout(() => {
    void (async () => {
      try {
        const state = await loadState();
        if (!state.holdings.length && !state.plans.length) return;
        await settlePlans(state);
        await buildPayload(state, { force: true });
        await saveState(state);
      } catch {
        /* keep quiet */
      }
    })();
  }, 4000).unref?.();
}

export const __internals = { stateDir, stateFile, fetchQuotes, fetchHistory, searchFunds, quoteMetrics, toHolding };
