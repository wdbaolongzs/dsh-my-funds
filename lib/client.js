// 我的基金 — client panel (sidebar rail entry + main page).
(() => {
  window.__ModuleLoader__.load({
    id: 'dsh-my-funds',
    factory: (require) => {
      const React = require('react');
      const h = React.createElement;
      const { useState, useEffect, useMemo, useRef, useCallback } = React;

      const NS = 'dsh-my-funds';
      const API = '/my-funds/api/';

      /* ------------------------------------------------------------ locale */

      const zh = {
        title: '我的基金',
        empty: '还没有持仓，导入一张持仓截图开始',
        emptyTitle: '还没有持仓',
        emptyHint: '导入基金 App 的持仓/资产详情截图，或手动填一只；定投可以另外导入定投详情页',
        add: '手动添加',
        updatedAt: '更新于',
        nextRefresh: '下次刷新',
        settledOn: '结算至',
        dataSource: '数据：天天基金 / 东方财富',
        minUnit: ' 分钟',
        staleHint: '行情可能过期，点刷新重试',
        phoneHint: '手机（同一 WiFi）打开这个地址看：',
        importShot: '导入截图',
        addManual: '手动添加',
        refresh: '刷新',
        refreshing: '更新中…',
        totalValue: '总市值',
        totalCost: '累计投入',
        backfillNote: '近 {n} 个交易日按当前份额回算',
        legendValue: '总市值',
        legendCost: '累计投入',
        todayPnl: '今日盈亏',
        holdPnl: '持有收益',
        sectorLabel: '\u5173\u8054\u677f\u5757',
        srcImport: '\u5f53\u65e5\u5b9e\u9645',
        srcImportTip: '\u4ece\u57fa\u91d1 App \u8d44\u4ea7\u8be6\u60c5\u9875\u8bfb\u5230\u7684\u5f53\u65e5\u6536\u76ca',
        srcGsz: '盘中估值',
        srcSector: '板块估算',
        srcNav: '今日净值',
        srcPrev: '昨日净值',
        srcPrevTip: '今天净值还没出，先显示上一交易日',
        estimated: '盘中估算',
        settled: '已收盘',
        holdings: '持仓',
        plans: '定投计划',
        addPlan: '新增定投',
        noPlans: '还没有定投计划',
        perDay: '每个交易日',
        perWeek: '每周',
        perMonth: '每月',
        invest: '每期买入',
        nextDate: '下次',
        pendingToday: '今日待确认',
        invested: '已投',
        runNow: '补算到今天',
        remove: '删除',
        save: '保存',
        cancel: '取消',
        shares: '份额',
        cost: '成本',
        value: '市值',
        profit: '收益',
        code: '代码',
        name: '名称',
        search: '代码或名称',
        searchHint: '输入 6 位代码或基金名称',
        importTitle: '从截图导入',
        importHint: '拖入 / 粘贴 / 选择持仓或定投截图，支持国泰、南方、支付宝、天天基金等',
        weekdayLabel: '星期',
        pick: '选择图片',
        parsing: '识别中…',
        found: '识别到 {n} 只基金，确认后导入',
        none: '没有识别到基金，试试手动添加',
        confirm: '确认导入',
        clear: '清空持仓',
        resetAll: '清空全部数据',
        resetConfirm: '将删除所有持仓、定投计划和历史快照，确定继续？',
        settings: '设置',
        autoRefresh: '自动更新',
        notifyTitle: 'QQ 邮箱推送',
        notifyOn: '每天定时推送',
        notifyUser: 'QQ 邮箱账号',
        notifyPass: 'SMTP 授权码',
        notifyTo: '收件邮箱',
        notifySave: '保存',
        notifyTest: '发一条测试',
        notifySaved: '已保存',
        notifySending: '发送中…',
        notifyOk: '已发送，去邮箱看看',
        notifyHint: '授权码在 QQ 邮箱 → 设置 → 账户 → 开启 SMTP 后生成，填一次就存在本机',
        notifyMorning: '早盘预估',
        notifyEvening: '收盘结算',
        ocrMissing: '未检测到系统 OCR，截图导入不可用',
        emptyRows: '空',
        dayUp: '涨',
        allClear: '确定清空所有持仓？',
        autoBook: '定投',
        weekdays: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
        planAmount: '每期金额',
        cycle: '周期',
        startFrom: '从今天起',
        deleteConfirm: '删除这项定投计划？',
        needsReview: '待确认',
        noMatch: '没找到该基金，请手动补充代码',
        matched: '已匹配',
        foundHoldings: '识别到 {n} 笔持仓',
        foundPlans: '识别到 {n} 个定投计划',
        importPlansHint: '截图里带「定投 / 每期 / 每月10日」等字样时会自动识别成定投计划',
        planDay: '扣款日',
        textHint: '持仓：招商中证白酒 161725 3210.45 +45.20；定投：110022 每周一 300',
        modeLabel: '导入内容',
        modeAuto: '自动识别',
        modeHoldings: '只导持仓',
        modePlans: '只导定投',
        channelLabel: '截图来源',
        channelAuto: '自动识别',
        channelDirect: '基金公司 APP',
        channelPlatform: '支付宝等代销',
        channelUnknown: '未识别',
        directNote: '基金公司 APP 的份额是全渠道合计',
        absorbed: '已含 {s}',
        conflict: '口径冲突，请确认',
        sources: '来源',
        skipped: '{n} 笔与基金公司合计重复，已跳过',
      };

      const en = {
        title: 'My Funds',
        emptyTitle: 'No holdings yet',
        emptyHint: 'Import a holdings or asset-detail screenshot, or add one by hand. DCA plans can be imported from the plan page.',
        add: 'Add',
        updatedAt: 'Updated',
        nextRefresh: 'Next refresh',
        settledOn: 'Settled to',
        dataSource: 'Data: Eastmoney',
        minUnit: ' min',
        staleHint: 'Quotes may be stale - hit refresh',
        phoneHint: 'Open this on your phone (same Wi-Fi):',
        empty: 'No holdings yet — import a screenshot to start',
        importShot: 'Import',
        addManual: 'Add manually',
        refresh: 'Refresh',
        refreshing: 'Updating…',
        totalValue: 'Market value',
        todayPnl: 'Today',
        holdPnl: 'Total return',
        sectorLabel: 'Sector',
        srcImport: 'Official',
        srcImportTip: 'Today figure read from the fund app asset page',
        srcGsz: 'Intraday',
        srcSector: 'Sector est.',
        srcNav: 'Today NAV',
        srcPrev: 'Prev NAV',
        srcPrevTip: 'Today NAV is not published yet; showing the last trading day',
        estimated: 'intraday',
        settled: 'closed',
        holdings: 'Holdings',
        plans: 'Auto-invest plans',
        addPlan: 'New plan',
        noPlans: 'No plans yet',
        perDay: 'Every trading day',
        perWeek: 'Weekly',
        perMonth: 'Monthly',
        invest: 'Amount',
        nextDate: 'Next',
        pendingToday: 'Confirming',
        invested: 'Invested',
        runNow: 'Catch up',
        remove: 'Delete',
        save: 'Save',
        cancel: 'Cancel',
        shares: 'Shares',
        cost: 'Cost',
        value: 'Value',
        profit: 'Return',
        code: 'Code',
        name: 'Name',
        search: 'Code or name',
        searchHint: 'Six-digit code or fund name',
        importTitle: 'Import from screenshot',
        importHint: 'Drop, paste or pick a holdings or auto-invest screenshot',
        weekdayLabel: 'Weekday',
        pick: 'Choose image',
        parsing: 'Reading…',
        found: '{n} funds found — confirm to import',
        none: 'No fund recognised, try manual entry',
        confirm: 'Import',
        clear: 'Clear holdings',
        resetAll: 'Reset everything',
        resetConfirm: 'Delete all holdings, plans and history snapshots?',
        settings: 'Settings',
        autoRefresh: 'Auto refresh',
        notifyTitle: 'Mail digest (QQ Mail)',
        notifyOn: 'Daily digest',
        notifyUser: 'Mailbox',
        notifyPass: 'SMTP auth code',
        notifyTo: 'Send to',
        notifySave: 'Save',
        notifyTest: 'Send a test',
        notifySaved: 'Saved',
        notifySending: 'Sending…',
        notifyOk: 'Sent — check your inbox',
        notifyHint: 'Get the auth code in QQ Mail → Settings → Account → enable SMTP',
        notifyMorning: 'Morning estimate',
        notifyEvening: 'Close settlement',
        ocrMissing: 'System OCR not available, screenshot import disabled',
        emptyRows: 'empty',
        dayUp: 'up',
        allClear: 'Clear every holding?',
        autoBook: 'DCA',
        weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        planAmount: 'Amount',
        cycle: 'Cycle',
        startFrom: 'Starts today',
        deleteConfirm: 'Delete this plan?',
        needsReview: 'Check',
        noMatch: 'Fund not found — enter its code',
        matched: 'matched',
        foundHoldings: '{n} holdings found',
        foundPlans: '{n} auto-invest plans found',
        importPlansHint: 'Rows mentioning 定投 / 每期 / 每月10日 become auto-invest plans',
        planDay: 'Day',
        textHint: 'Holding: 161725 3210.45 +45.20 · Plan: 110022 每周一 300',
        modeLabel: 'Import',
        modeAuto: 'Auto',
        modeHoldings: 'Holdings only',
        modePlans: 'Plans only',
        channelLabel: 'Source',
        channelAuto: 'Auto detect',
        channelDirect: 'Fund company app',
        channelPlatform: 'Alipay / broker',
        channelUnknown: 'Unknown',
        directNote: 'Fund-company shares already include every channel',
        absorbed: 'includes {s}',
        conflict: 'Scope conflict — check',
        sources: 'Sources',
        skipped: '{n} rows already inside the fund-company total — skipped',
      };

      /* ------------------------------------------------------------- styles */

      const CSS = `
.mf-root{height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.45}
.mf-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-layer-1));flex:none}
.mf-title{font-size:13px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mf-scroll{flex:1;min-height:0;overflow:auto;padding:10px;display:flex;flex-direction:column;gap:10px}
.mf-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:11px 12px}
.mf-hero{background:linear-gradient(180deg,color-mix(in oklab,var(--dsw-alias-brand-primary) 10%,var(--dsw-alias-bg-layer-1)),var(--dsw-alias-bg-layer-1));border:1px solid var(--dsw-alias-border-l1);border-radius:14px;padding:12px 13px;display:flex;flex-direction:column;gap:8px}
.mf-hero-label{font-size:11px;color:var(--dsw-alias-label-secondary)}
.mf-hero-value{font-size:24px;font-weight:650;letter-spacing:-0.4px;font-variant-numeric:tabular-nums}
.mf-hero-row{display:flex;gap:14px;flex-wrap:wrap}
.mf-hero-cell{display:flex;flex-direction:column;gap:1px;min-width:0}
.mf-k{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.mf-v{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.mf-up{color:var(--dsw-alias-state-error-primary)}
.mf-down{color:var(--dsw-alias-state-success-primary)}
.mf-flat{color:var(--dsw-alias-label-secondary)}
.mf-btn{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer;white-space:nowrap}
.mf-btn:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.mf-btn:disabled{opacity:.55;cursor:default}
.mf-btn-p{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}
.mf-btn-p:hover{background:var(--dsw-alias-brand-primary);opacity:.9}
.mf-btn-x{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary);padding:0 6px}
.mf-btn-x:hover{color:var(--dsw-alias-state-error-primary);border-color:transparent;background:color-mix(in oklab,var(--dsw-alias-state-error-primary) 10%,transparent)}
.mf-sec{display:flex;align-items:center;gap:6px;margin:2px 2px 0}
.mf-sec-t{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);letter-spacing:.4px;flex:1;text-transform:uppercase}
.mf-list{display:flex;flex-direction:column;gap:8px}
.mf-row{display:flex;flex-direction:column;gap:6px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:11px;padding:9px 10px;cursor:pointer;transition:border-color .12s}
.mf-row:hover{border-color:var(--dsw-alias-border-l2)}
.mf-row-top{display:flex;align-items:baseline;gap:6px}
.mf-name{font-size:12px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mf-code{font-size:10px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;flex:none}
.mf-row-bot{display:flex;align-items:baseline;gap:10px;font-size:11px;color:var(--dsw-alias-label-secondary);flex-wrap:wrap}
.mf-mgrid{display:grid;grid-template-columns:0.92fr 1fr 0.92fr;gap:6px 10px;margin-top:8px}
.mf-mgrid.mf-has-sector{grid-template-columns:0.86fr 1fr 0.92fr 1.22fr}
.mf-mcell{display:flex;flex-direction:column;gap:2px;min-width:0}
.mf-mk{font-size:10px;line-height:1.2;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.mf-mv{font-size:12.5px;font-weight:600;line-height:1.25;font-variant-numeric:tabular-nums;white-space:nowrap}
.mf-mtag{font-size:9px;line-height:1.4;padding:0 4px;border-radius:4px;margin-left:4px;vertical-align:1px;font-weight:500;white-space:nowrap}
.mf-tag{font-size:9px;padding:0 4px;border-radius:4px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);flex:none}
.mf-tag-b{color:var(--dsw-alias-brand-primary);border-color:color-mix(in oklab,var(--dsw-alias-brand-primary) 45%,transparent)}
.mf-tag-g{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in oklab,var(--dsw-alias-state-warn-primary) 40%,transparent)}
.mf-tag-n{color:var(--dsw-alias-label-secondary)}
.mf-notify{display:flex;flex-direction:column;gap:6px;margin-top:6px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1)}
.mf-ncheck{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-primary);cursor:pointer}
.mf-input{height:26px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;outline:none}
.mf-input:focus{border-color:var(--dsw-alias-brand-primary)}
.mf-times{display:flex;gap:10px}
.mf-time{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.mf-input-t{width:96px}
.mf-tag-pending{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in oklab,var(--dsw-alias-state-warn-primary) 45%,transparent)}
.mf-input{width:100%;height:26px;padding:0 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:12px;outline:none;box-sizing:border-box}
.mf-input:focus{border-color:var(--dsw-alias-brand-primary)}
.mf-field{display:flex;flex-direction:column;gap:3px;flex:1;min-width:0}
.mf-grid2{display:flex;gap:8px}
.mf-actions{display:flex;gap:6px;align-items:center}
.mf-empty{padding:22px 12px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12px;border:1px dashed var(--dsw-alias-border-l1);border-radius:12px}
.mf-empty-t{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);margin-bottom:6px}
.mf-empty-n{font-size:11.5px;line-height:1.6;margin-bottom:10px}
.mf-empty-row{display:flex;gap:6px;justify-content:center;flex-wrap:wrap}
.mf-foot{display:flex;flex-wrap:wrap;gap:4px 10px;padding:10px 2px 14px;font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.mf-foot-warn{color:var(--dsw-alias-state-warn-primary)}
.mf-lanurl{font-size:11px;color:var(--dsw-alias-brand-primary);cursor:pointer;word-break:break-all}
.mf-legend{display:flex;flex-wrap:wrap;align-items:center;gap:3px 12px;margin:-2px 0 8px;font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.mf-legend-i{display:inline-flex;align-items:center;gap:5px}
.mf-legend-line{width:16px;height:2px;border-radius:1px;background:var(--dsw-alias-state-error-primary)}
.mf-legend-dash{width:16px;height:0;border-top:1px dashed var(--dsw-alias-border-l2)}
.mf-legend-note{width:100%}
.mf-skel{display:flex;flex-direction:column;gap:8px;padding:8px 0}
.mf-skel-h{height:74px;border-radius:12px;background:var(--dsw-alias-bg-layer-2)}
.mf-skel-b{height:54px;border-radius:12px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}
@keyframes mf-pulse{0%,100%{opacity:.55}50%{opacity:1}}
.mf-skel-h,.mf-skel-b{animation:mf-pulse 1.4s ease-in-out infinite}
.mf-mask{position:fixed;inset:0;z-index:60;background:color-mix(in oklab,#000 42%,transparent);display:flex;align-items:flex-start;justify-content:center;padding:24px 12px;overflow:auto}
.mf-modal{width:min(560px,100%);background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1));border:1px solid var(--dsw-alias-border-l2);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.35);display:flex;flex-direction:column;max-height:calc(100vh - 48px)}
.mf-modal-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:13px;font-weight:600}
.mf-modal-body{padding:12px 14px;display:flex;flex-direction:column;gap:10px;overflow:auto}
.mf-modal-foot{padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l1);display:flex;gap:8px;justify-content:flex-end}
.mf-drop{border:1px dashed var(--dsw-alias-border-l2);border-radius:11px;padding:18px;text-align:center;color:var(--dsw-alias-label-secondary);cursor:pointer}
.mf-drop:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}
.mf-seg{display:flex;gap:0;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden;align-self:flex-start}.mf-seg-btn{font:inherit;font-size:12px;padding:5px 10px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}.mf-seg-btn+.mf-seg-btn{border-left:1px solid var(--dsw-alias-border-l1)}.mf-seg-on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-weight:600}.mf-preview{display:flex;flex-direction:column;gap:8px}
.mf-preview-row{display:flex;flex-direction:column;gap:5px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:8px 9px}
.mf-mono{font-variant-numeric:tabular-nums}
.mf-note{font-size:11px;color:var(--dsw-alias-label-secondary)}
.mf-warn{color:var(--dsw-alias-state-warn-primary)}
.mf-err{color:var(--dsw-alias-state-error-primary);font-size:11px}
.mf-idx{display:flex;gap:6px;flex-wrap:wrap}
.mf-idx-item{display:flex;align-items:baseline;gap:5px;padding:3px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);font-size:11px}
.mf-rail{height:100%;width:100%;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary)}
.mf-rail-on{color:var(--dsw-alias-brand-primary)}
.mf-spin{display:inline-block;animation:mf-rot 1s linear infinite}
@keyframes mf-rot{to{transform:rotate(360deg)}}
.mf-bar{height:4px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.mf-bar>i{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary)}
`;

      /* ------------------------------------------------------------- utils */

      const num = (value) => (Number.isFinite(value) ? value : 0);

      function fmt(value, digits = 2) {
        if (!Number.isFinite(value)) return '--';
        return value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
      }

      function signed(value, digits = 2) {
        if (!Number.isFinite(value)) return '--';
        return `${value > 0 ? '+' : ''}${fmt(value, digits)}`;
      }

      function pctText(value) {
        if (!Number.isFinite(value)) return '--';
        return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
      }

      function toneOf(value) {
        if (!Number.isFinite(value) || Math.abs(value) < 0.005) return 'mf-flat';
        return value > 0 ? 'mf-up' : 'mf-down';
      }

      async function api(route, body) {
        const response = await fetch(API + route, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body || {}),
        });
        const payload = await response.json().catch(() => null);
        if (!payload || payload.ok !== true) {
          throw new Error(payload?.error?.message || `请求失败 (${response.status})`);
        }
        return payload.value;
      }

      const readAsDataUrl = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('读取失败'));
        reader.readAsDataURL(file);
      });

      /* --------------------------------------------------------- components */

      function Rail({ size }) {
        const dimension = typeof size === 'number' ? Math.min(size, 26) : 20;
        return h('div', { className: 'mf-rail' },
          h('svg', { width: dimension, height: dimension, viewBox: '0 0 24 24', fill: 'none' },
            h('path', {
              d: 'M3 17.5l4.6-5.2 3.6 3 4-5.6 3.8 4.4',
              stroke: 'currentColor',
              strokeWidth: '1.8',
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
            }),
            h('circle', { cx: 19.4, cy: 6.6, r: 2.1, fill: 'currentColor', opacity: 0.75 }),
            h('path', { d: 'M3 20.5h18', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round', opacity: 0.4 })));
      }

      function seriesTone(series) {
        if (!series || series.length < 2) return 'var(--dsw-alias-state-error-primary)';
        const first = series[0].value;
        const last = series[series.length - 1].value;
        return last >= first ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-success-primary)';
      }

      function Sparkline({ series }) {
        if (!series || series.length < 2) return null;
        const width = 300;
        const height = 46;
        const values = series.map((item) => item.value);
        const costs = series.map((item) => (item.cost == null ? item.value : item.cost));
        const min = Math.min(...values, ...costs);
        const max = Math.max(...values, ...costs);
        const span = max - min || 1;
        const project = (list) => list.map((value, index) => {
          const x = (index / (list.length - 1)) * width;
          const y = height - ((value - min) / span) * (height - 6) - 3;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        });
        const valuePoints = project(values).join(' ');
        const costPoints = project(costs).join(' ');
        const areaPath = `M0,${height} L${project(values).join(' L')} L${width},${height} Z`;
        const first = values[0];
        const last = values[values.length - 1];
        const tone = last >= first ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-success-primary)';
        return h('svg', {
          viewBox: `0 0 ${width} ${height}`,
          preserveAspectRatio: 'none',
          style: { width: '100%', height, display: 'block', marginTop: 2 },
        },
        h('defs', null,
          h('linearGradient', { id: 'mf-spark-fill', x1: '0', y1: '0', x2: '0', y2: '1' },
            h('stop', { offset: '0%', stopColor: tone, stopOpacity: 0.22 }),
            h('stop', { offset: '100%', stopColor: tone, stopOpacity: 0 }))),
        h('path', { d: areaPath, style: { fill: 'url(#mf-spark-fill)', stroke: 'none' } }),
        h('polyline', {
          points: costPoints,
          style: { fill: 'none', stroke: 'var(--dsw-alias-border-l2)', strokeWidth: 1, strokeDasharray: '3 3' },
        }),
        h('polyline', {
          points: valuePoints,
          style: { fill: 'none', stroke: tone, strokeWidth: 1.8, strokeLinejoin: 'round', strokeLinecap: 'round' },
        }));
      }

      function Summary({ data, onRefresh, busy, t }) {
        const summary = data.summary;
        return h('div', { className: 'mf-hero' },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h('span', { className: 'mf-hero-label' }, t('totalValue')),
            h('span', { className: 'mf-tag' }, summary.estimated ? t('estimated') : t('settled'))),
          h('div', { className: 'mf-hero-value' }, fmt(summary.value)),
          h(Sparkline, { series: data.series }),
          data.series && data.series.length > 1
            ? h('div', { className: 'mf-legend' },
              h('span', { className: 'mf-legend-i' },
                h('span', { className: 'mf-legend-line', style: { background: seriesTone(data.series) } }),
                t('legendValue')),
              h('span', { className: 'mf-legend-i' },
                h('span', { className: 'mf-legend-dash' }), t('legendCost')),
              data.seriesBackfilled
                ? h('span', { className: 'mf-legend-i mf-legend-note' },
                  t('backfillNote').replace('{n}', String(data.series.length)))
                : null)
            : null,
          h('div', { className: 'mf-hero-row' },
            h('div', { className: 'mf-hero-cell' },
              h('span', { className: 'mf-k' }, t('todayPnl')),
              h('span', { className: `mf-v ${toneOf(summary.todayProfit)}` },
                `${signed(summary.todayProfit)} (${pctText(summary.todayPct)})`)),
            h('div', { className: 'mf-hero-cell' },
              h('span', { className: 'mf-k' }, t('holdPnl')),
              h('span', { className: `mf-v ${toneOf(summary.profit)}` },
                `${signed(summary.profit)} (${pctText(summary.profitPct)})`)),
            h('div', { className: 'mf-hero-cell' },
              h('span', { className: 'mf-k' }, t('totalCost')),
              h('span', { className: 'mf-v' }, fmt(summary.cost)))),
          data.indexes && data.indexes.length
            ? h('div', { className: 'mf-idx' }, data.indexes.map((item) => h('span', {
              key: item.label,
              className: 'mf-idx-item',
            },
            h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, item.label),
            h('span', { className: `mf-mono ${toneOf(item.chgPct)}` }, pctText(item.chgPct)))))
            : null,
          h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
            h('button', {
              type: 'button',
              className: 'mf-btn',
              disabled: busy,
              onClick: onRefresh,
            }, busy ? t('refreshing') : t('refresh')),
            h('span', { className: 'mf-note', style: { flex: 1, textAlign: 'right' } },
              data.updatedAt ? new Date(data.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '')));
      }

      function daySourceTag(row, t) {
        if (!row.daySource || row.daySource === 'none') return null;
        if (row.daySource === 'gsz') return h('span', { className: 'mf-mtag mf-tag-g' }, t('srcGsz'));
        if (row.daySource === 'sector') return h('span', { className: 'mf-mtag mf-tag-g' }, t('srcSector'));
        if (row.daySource === 'nav') return h('span', { className: 'mf-mtag mf-tag-n' }, t('srcNav'));
        if (row.daySource === 'import') return h('span', { className: 'mf-mtag mf-tag-n', title: t('srcImportTip') }, t('srcImport'));
        if (row.daySource === 'prev') {
          return h('span', { className: 'mf-mtag mf-tag-n', title: t('srcPrevTip') }, `${t('srcPrev')} ${row.navDate ? row.navDate.slice(5) : ''}`.trim());
        }
        return null;
      }

      function HoldingRow({ row, t, onSave, onRemove }) {
        const sector = row.sector && Number.isFinite(row.sector.chgPct) ? row.sector : null;
        const [open, setOpen] = useState(false);
        const [shares, setShares] = useState('');
        const [cost, setCost] = useState('');
        useEffect(() => {
          if (open) {
            setShares(String(row.shares ? Number(row.shares.toFixed(4)) : ''));
            setCost(String(row.cost ? Number(row.cost.toFixed(2)) : ''));
          }
        }, [open, row.shares, row.cost]);

        return h('div', { className: 'mf-row', onClick: () => setOpen(!open) },
          h('div', { className: 'mf-row-top' },
            h('span', { className: 'mf-name' }, row.name || row.code),
            row.autoInvest ? h('span', { className: 'mf-tag mf-tag-b' }, t('autoBook')) : null,
            h('span', { className: 'mf-code' }, row.code),
            h('span', { className: `mf-v ${toneOf(row.todayProfit)}`, style: { flex: 'none' } }, pctText(row.todayPct))),
          h('div', { className: 'mf-mgrid mf-has-sector' },
            h('div', { className: 'mf-mcell' },
              h('span', { className: 'mf-mk' }, t('value')),
              h('span', { className: 'mf-mv' }, fmt(row.value))),
            h('div', { className: 'mf-mcell' },
              h('span', { className: 'mf-mk' }, t('todayPnl')),
              h('span', { className: `mf-mv ${toneOf(row.todayProfit)}` }, signed(row.todayProfit)),
              daySourceTag(row, t)),
            h('div', { className: 'mf-mcell' },
              h('span', { className: 'mf-mk' }, t('holdPnl')),
              h('span', { className: `mf-mv ${toneOf(row.profit)}` }, signed(row.profit))),
            // 没有关联板块的基金也保留这一列（空着），这样四列在所有行上对齐。
            sector
              ? h('div', { className: 'mf-mcell' },
                h('span', { className: 'mf-mk' }, t('sectorLabel')),
                h('span', { className: `mf-mv ${toneOf(sector.chgPct)}` }, pctText(sector.chgPct)),
                h('span', { className: 'mf-mk', style: { fontSize: '9.5px' } }, sector.label))
              : h('div', { className: 'mf-mcell' },
                h('span', { className: 'mf-mk' }, t('sectorLabel')),
                h('span', { className: 'mf-mv', style: { color: 'var(--dsw-alias-state-idle-primary)' } }, '--'))),
          row.note || row.stale
            ? h('div', { className: 'mf-row-bot' },
              row.note ? h('span', { className: 'mf-note' }, row.note) : null,
              row.stale ? h('span', { className: 'mf-warn' }, '--') : null)
            : null,
          open
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 }, onClick: (event) => event.stopPropagation() },
              h('div', { className: 'mf-grid2' },
                h('label', { className: 'mf-field' },
                  h('span', { className: 'mf-k' }, t('shares')),
                  h('input', {
                    className: 'mf-input mf-mono',
                    value: shares,
                    inputMode: 'decimal',
                    onChange: (event) => setShares(event.target.value),
                  })),
                h('label', { className: 'mf-field' },
                  h('span', { className: 'mf-k' }, t('cost')),
                  h('input', {
                    className: 'mf-input mf-mono',
                    value: cost,
                    inputMode: 'decimal',
                    onChange: (event) => setCost(event.target.value),
                  }))),
              h('div', { className: 'mf-actions' },
                h('button', {
                  type: 'button',
                  className: 'mf-btn mf-btn-p',
                  onClick: () => onSave(row, { shares: Number(shares), cost: Number(cost) }),
                }, t('save')),
                h('button', {
                  type: 'button',
                  className: 'mf-btn',
                  onClick: () => setOpen(false),
                }, t('cancel')),
                h('span', { style: { flex: 1 } }),
                h('button', {
                  type: 'button',
                  className: 'mf-btn mf-btn-x',
                  onClick: () => onRemove(row),
                }, t('remove'))))
            : null);
      }

      function cycleLabel(plan, t) {
        if (plan.cycle === 'daily') return t('perDay');
        if (plan.cycle === 'weekly') return `${t('perWeek')} ${t('weekdays')[Math.max(0, Math.min(4, (plan.weekday || 1) - 1))]}`;
        return `${t('perMonth')} ${plan.day} 日`;
      }

      function PlanRow({ plan, t, onRemove, onRun }) {
        return h('div', { className: 'mf-row' },
          h('div', { className: 'mf-row-top' },
            h('span', { className: 'mf-name' }, plan.name || plan.code),
            h('span', { className: 'mf-code' }, plan.code)),
          h('div', { className: 'mf-row-bot' },
            h('span', null, `${cycleLabel(plan, t)} · ${fmt(plan.amount, 2)}`),
            h('span', null, `${t('invested')} ${fmt(plan.invested, 2)}`),
            plan.pendingToday > 0
              ? h('span', { className: 'mf-tag mf-tag-pending' }, `${t('pendingToday')} ${fmt(plan.pendingToday, 2)}`)
              : plan.nextDates && plan.nextDates.length
                ? h('span', { className: 'mf-note' }, `${t('nextDate')} ${plan.nextDates[0].slice(5)}`)
                : null),
          h('div', { className: 'mf-actions', style: { marginTop: 2 } },
            h('button', {
              type: 'button',
              className: 'mf-btn',
              onClick: () => onRun(plan),
            }, t('runNow')),
            h('span', { style: { flex: 1 } }),
            h('button', {
              type: 'button',
              className: 'mf-btn mf-btn-x',
              onClick: () => onRemove(plan),
            }, t('remove'))));
      }

      const WEEKDAY_CHOICES = [[1, 0], [2, 1], [3, 2], [4, 3], [5, 4], [6, 5], [0, 6]];
      const DAY_OPTIONS = Array.from({ length: 28 }, (_, index) => index + 1);

      function channelName(t, value) {
        if (value === 'direct') return t('channelDirect');
        if (value === 'platform') return t('channelPlatform');
        return t('channelUnknown');
      }

      function weekdaySelect(t, value, onChange) {
        return h('select', { className: 'mf-input', value: String(value), onChange },
          WEEKDAY_CHOICES.map(([day, at]) => h('option', { key: day, value: String(day) }, t('weekdays')[at])));
      }

      function PlanEditor({ t, onClose, onSubmit }) {
        const [code, setCode] = useState('');
        const [name, setName] = useState('');
        const [amount, setAmount] = useState('500');
        const [cycle, setCycle] = useState('monthly');
        const [weekday, setWeekday] = useState('1');
        const [day, setDay] = useState('1');
        const [busy, setBusy] = useState(false);
        const [error, setError] = useState('');

        const submit = async () => {
          setBusy(true);
          setError('');
          try {
            await onSubmit({
              code: code.trim(),
              name: name.trim(),
              amount: Number(amount),
              cycle,
              weekday: Number(weekday),
              day: Number(day),
              enabled: true,
            });
            onClose();
          } catch (err) {
            setError(String(err.message || err));
          } finally {
            setBusy(false);
          }
        };

        return h('div', { className: 'mf-mask', onClick: onClose },
          h('div', { className: 'mf-modal', onClick: (event) => event.stopPropagation() },
            h('div', { className: 'mf-modal-head' }, t('addPlan')),
            h('div', { className: 'mf-modal-body' },
              h('div', { className: 'mf-grid2' },
                h('label', { className: 'mf-field' },
                  h('span', { className: 'mf-k' }, t('code')),
                  h('input', { className: 'mf-input mf-mono', value: code, onChange: (event) => setCode(event.target.value), placeholder: '161725' })),
                h('label', { className: 'mf-field' },
                  h('span', { className: 'mf-k' }, t('name')),
                  h('input', { className: 'mf-input', value: name, onChange: (event) => setName(event.target.value), placeholder: t('searchHint') }))),
              h('div', { className: 'mf-grid2' },
                h('label', { className: 'mf-field' },
                  h('span', { className: 'mf-k' }, t('planAmount')),
                  h('input', { className: 'mf-input mf-mono', value: amount, inputMode: 'decimal', onChange: (event) => setAmount(event.target.value) })),
                h('label', { className: 'mf-field' },
                  h('span', { className: 'mf-k' }, t('cycle')),
                  h('select', {
                    className: 'mf-input',
                    value: cycle,
                    onChange: (event) => setCycle(event.target.value),
                  },
                  h('option', { value: 'daily' }, t('perDay')),
                  h('option', { value: 'weekly' }, t('perWeek')),
                  h('option', { value: 'monthly' }, t('perMonth'))))),
              cycle === 'weekly'
                ? h('label', { className: 'mf-field' },
                  h('span', { className: 'mf-k' }, t('weekdayLabel')),
                  weekdaySelect(t, weekday, (event) => setWeekday(event.target.value)))
                : null,
              cycle === 'monthly'
                ? h('label', { className: 'mf-field' },
                  h('span', { className: 'mf-k' }, t('cycle')),
                  h('select', { className: 'mf-input', value: day, onChange: (event) => setDay(event.target.value) },
                    DAY_OPTIONS.map((value) => h('option', { key: value, value: String(value) }, `${value} 日`))))
                : null,
              h('div', { className: 'mf-note' }, t('startFrom')),
              error ? h('div', { className: 'mf-err' }, error) : null),
            h('div', { className: 'mf-modal-foot' },
              h('button', { type: 'button', className: 'mf-btn', onClick: onClose }, t('cancel')),
              h('button', { type: 'button', className: 'mf-btn mf-btn-p', disabled: busy, onClick: submit }, t('save')))));
      }

      function ImportDialog({ t, ocr, onClose, onImported }) {
        const [busy, setBusy] = useState(false);
        const [rows, setRows] = useState(null);
        const [plans, setPlans] = useState([]);
        const [error, setError] = useState('');
        const [text, setText] = useState('');
        const [mode, setMode] = useState('auto');
        const [channel, setChannel] = useState('auto');
        const [sources, setSources] = useState([]);
        const inputRef = useRef(null);

        const runImport = useCallback(async (images, manualText) => {
          setBusy(true);
          setError('');
          try {
            const value = await api('import', { images, text: manualText || '', mode, channel });
            setRows(value.holdings || value.rows || []);
            setPlans(value.plans || []);
            setSources(value.sources || []);
          } catch (err) {
            setError(String(err.message || err));
          } finally {
            setBusy(false);
          }
        }, [mode, channel]);

        const handleFiles = useCallback(async (files) => {
          const list = [...(files || [])].filter((file) => file && file.type.startsWith('image/'));
          if (!list.length) return;
          const images = [];
          for (const file of list) {
            images.push({ name: file.name, data: await readAsDataUrl(file) });
          }
          await runImport(images);
        }, [runImport]);

        const editRow = (index, patch) => {
          setRows((current) => current.map((row, at) => (at === index ? { ...row, ...patch } : row)));
        };

        const editPlan = (index, patch) => {
          setPlans((current) => current.map((row, at) => (at === index ? { ...row, ...patch } : row)));
        };

        const confirm = async () => {
          const items = (rows || [])
            .filter((row) => row.code)
            .map((row) => ({
              code: row.code,
              name: row.officialName || row.name || '',
              value: Number(row.value),
              profit: row.profit == null || row.profit === '' ? null : Number(row.profit),
              channel: row.channel || channel,
              mergedFrom: row.mergedFrom || [],
            }))
            .filter((row) => Number.isFinite(row.value) && row.value > 0);
          const planItems = (plans || [])
            .filter((row) => row.code && Number(row.amount) > 0)
            .map((row) => ({
              code: row.code,
              name: row.officialName || row.name || '',
              amount: Number(row.amount),
              cycle: row.cycle || 'monthly',
              weekday: Number(row.weekday ?? 1),
              day: Number(row.day ?? 1),
              enabled: true,
              nextHint: row.nextHint || '',
            }));
          if (!items.length && !planItems.length) {
            setError(t('none'));
            return;
          }
          setBusy(true);
          try {
            let skipped = [];
            if (items.length) {
              const saved = await api('holdings', { action: 'save', holdings: items });
              skipped = Array.isArray(saved?.skipped) ? saved.skipped : [];
            }
            if (planItems.length) await api('plans', { action: 'save', plans: planItems });
            if (skipped.length) {
              // Fund-company totals already contain these rows — drop them, keep the dialog open.
              const codes = new Set(skipped.map((row) => row.code));
              setRows((current) => (current || []).filter((row) => !codes.has(row.code)));
              setError(t('skipped').replace('{n}', String(skipped.length)));
              onImported();
              setBusy(false);
              return;
            }
            onImported();
            onClose();
          } catch (err) {
            setError(String(err.message || err));
          } finally {
            setBusy(false);
          }
        };

        const planRow = (row, index) => h('div', { key: `plan-${index}`, className: 'mf-preview-row' },
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 6 } },
            h('span', { className: 'mf-name' }, row.name || row.officialName || '?'),
            row.code ? h('span', { className: 'mf-code' }, row.code) : h('span', { className: 'mf-tag mf-warn' }, t('needsReview')),
            row.needsReview && row.code ? h('span', { className: 'mf-tag mf-warn' }, t('needsReview')) : null),
          h('div', { className: 'mf-grid2' },
            h('label', { className: 'mf-field' },
              h('span', { className: 'mf-k' }, t('code')),
              h('input', {
                className: 'mf-input mf-mono',
                value: row.code || '',
                onChange: (event) => editPlan(index, { code: event.target.value.trim() }),
              })),
            h('label', { className: 'mf-field' },
              h('span', { className: 'mf-k' }, t('planAmount')),
              h('input', {
                className: 'mf-input mf-mono',
                value: row.amount ?? '',
                inputMode: 'decimal',
                onChange: (event) => editPlan(index, { amount: event.target.value }),
              })),
            h('label', { className: 'mf-field' },
              h('span', { className: 'mf-k' }, t('cycle')),
              h('select', {
                className: 'mf-input',
                value: row.cycle || 'monthly',
                onChange: (event) => editPlan(index, { cycle: event.target.value }),
              },
              h('option', { value: 'daily' }, t('perDay')),
              h('option', { value: 'weekly' }, t('perWeek')),
              h('option', { value: 'monthly' }, t('perMonth')))),
            row.cycle === 'weekly'
              ? h('label', { className: 'mf-field' },
                h('span', { className: 'mf-k' }, t('weekdayLabel')),
                weekdaySelect(t, row.weekday ?? 1, (event) => editPlan(index, { weekday: Number(event.target.value) })))
              : row.cycle === 'monthly'
                ? h('label', { className: 'mf-field' },
                  h('span', { className: 'mf-k' }, t('planDay')),
                  h('select', {
                    className: 'mf-input',
                    value: String(row.day ?? 1),
                    onChange: (event) => editPlan(index, { day: Number(event.target.value) }),
                  }, DAY_OPTIONS.map((value) => h('option', { key: value, value: String(value) }, `${value} 日`))))
                : h('div', null)),
          row.nextHint ? h('div', { className: 'mf-note' }, `${t('nextDate')} ${row.nextHint}`) : null);

        return h('div', { className: 'mf-mask', onClick: onClose },
          h('div', { className: 'mf-modal', onClick: (event) => event.stopPropagation() },
            h('div', { className: 'mf-modal-head' },
              h('span', { style: { flex: 1 } }, t('importTitle')),
              h('button', { type: 'button', className: 'mf-btn mf-btn-x', onClick: onClose }, '✕')),
            h('div', {
              className: 'mf-modal-body',
              onPaste: (event) => {
                const files = [];
                for (const item of event.clipboardData?.items || []) {
                  if (item.kind === 'file') {
                    const file = item.getAsFile();
                    if (file) files.push(file);
                  }
                }
                if (files.length) {
                  event.preventDefault();
                  void handleFiles(files);
                }
              },
            },
            ocr.available
              ? h('div', {
                className: 'mf-drop',
                onClick: () => inputRef.current?.click(),
                onDragOver: (event) => event.preventDefault(),
                onDrop: (event) => {
                  event.preventDefault();
                  void handleFiles(event.dataTransfer?.files);
                },
              }, busy ? t('parsing') : t('importHint'))
              : h('div', { className: 'mf-drop mf-warn' }, t('ocrMissing')),
            h('input', {
              ref: inputRef,
              type: 'file',
              accept: 'image/*',
              multiple: true,
              style: { display: 'none' },
              onChange: (event) => {
                void handleFiles(event.target.files);
                event.target.value = '';
              },
            }),
            h('div', { className: 'mf-seg' },
              ['auto', 'holdings', 'plans'].map((key) => h('button', {
                key,
                type: 'button',
                className: `mf-seg-btn${mode === key ? ' mf-seg-on' : ''}`,
                onClick: () => setMode(key),
              }, t(key === 'auto' ? 'modeAuto' : key === 'holdings' ? 'modeHoldings' : 'modePlans')))),
            h('label', { className: 'mf-field' },
              h('span', { className: 'mf-k' }, t('channelLabel')),
              h('select', {
                className: 'mf-input',
                value: channel,
                onChange: (event) => setChannel(event.target.value),
              },
              h('option', { value: 'auto' }, t('channelAuto')),
              h('option', { value: 'direct' }, t('channelDirect')),
              h('option', { value: 'platform' }, t('channelPlatform')),
              h('option', { value: 'unknown' }, t('channelUnknown')))),
            channel !== 'platform'
              ? h('div', { className: 'mf-note' }, t('directNote'))
              : null,
            sources.length
              ? h('div', { className: 'mf-note' },
                `${t('sources')}：${sources.map((item) => `${item.name || 'image'} ${channelName(t, item.channel)}`).join('，')}`)
              : null,
            h('div', { style: { display: 'flex', gap: 6 } },
              h('button', { type: 'button', className: 'mf-btn', onClick: () => inputRef.current?.click() }, t('pick'))),
            rows && rows.length
              ? h('div', { className: 'mf-preview' },
                h('div', { className: 'mf-note' }, t('foundHoldings').replace('{n}', String(rows.length))),
                rows.map((row, index) => h('div', { key: index, className: 'mf-preview-row' },
                  h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 6 } },
                    h('span', { className: 'mf-name' }, row.name || row.officialName || '?'),
                    row.code ? h('span', { className: 'mf-code' }, row.code) : h('span', { className: 'mf-tag mf-warn' }, t('needsReview')),
                    row.channel && row.channel !== 'unknown' ? h('span', { className: 'mf-tag' }, channelName(t, row.channel)) : null,
                    row.conflict ? h('span', { className: 'mf-tag mf-warn' }, t('conflict')) : null),
                  row.mergedFrom && row.mergedFrom.length
                    ? h('div', { className: 'mf-note' },
                      t('absorbed').replace('{s}', row.mergedFrom.map((item) => `${channelName(t, item.channel)}${item.value != null ? ` ¥${Number(item.value).toFixed(2)}` : ''}`).join('、')))
                    : null,
                  h('div', { className: 'mf-grid2' },
                    h('label', { className: 'mf-field' },
                      h('span', { className: 'mf-k' }, t('code')),
                      h('input', {
                        className: 'mf-input mf-mono',
                        value: row.code || '',
                        onChange: (event) => editRow(index, { code: event.target.value.trim() }),
                      })),
                    h('label', { className: 'mf-field' },
                      h('span', { className: 'mf-k' }, t('value')),
                      h('input', {
                        className: 'mf-input mf-mono',
                        value: row.value ?? '',
                        inputMode: 'decimal',
                        onChange: (event) => editRow(index, { value: event.target.value }),
                      })),
                    h('label', { className: 'mf-field' },
                      h('span', { className: 'mf-k' }, t('profit')),
                      h('input', {
                        className: 'mf-input mf-mono',
                        value: row.profit ?? '',
                        inputMode: 'decimal',
                        onChange: (event) => editRow(index, { profit: event.target.value }),
                      }))))))
              : null,
            plans.length
              ? h('div', { className: 'mf-preview' },
                h('div', { className: 'mf-note' }, t('foundPlans').replace('{n}', String(plans.length))),
                plans.map(planRow))
              : null,
            rows !== null && !plans.length ? h('div', { className: 'mf-note' }, t('importPlansHint')) : null,
            h('div', { className: 'mf-field' },
              h('span', { className: 'mf-k' }, '或粘贴文本'),
              h('textarea', {
                className: 'mf-input',
                style: { height: 56, padding: '6px 8px', resize: 'vertical' },
                value: text,
                onChange: (event) => setText(event.target.value),
                placeholder: t('textHint'),
              }),
              h('button', {
                type: 'button',
                className: 'mf-btn',
                disabled: busy || !text.trim(),
                onClick: () => runImport([], text),
                style: { alignSelf: 'flex-start' },
              }, t('parsing'))),
            error ? h('div', { className: 'mf-err' }, error) : null),
            h('div', { className: 'mf-modal-foot' },
              h('button', { type: 'button', className: 'mf-btn', onClick: onClose }, t('cancel')),
              h('button', {
                type: 'button',
                className: 'mf-btn mf-btn-p',
                disabled: busy || (!(rows || []).length && !plans.length),
                onClick: confirm,
              }, t('confirm')))));
      }

      function AddDialog({ t, onClose, onSubmit }) {
        const [query, setQuery] = useState('');
        const [code, setCode] = useState('');
        const [name, setName] = useState('');
        const [value, setValue] = useState('');
        const [profit, setProfit] = useState('');
        const [busy, setBusy] = useState(false);
        const [results, setResults] = useState([]);
        const [error, setError] = useState('');

        useEffect(() => {
          if (!/^\d{6}$/.test(query.trim())) return undefined;
          setCode(query.trim());
          let cancelled = false;
          api('search', { q: query.trim() }).then((value2) => {
            if (cancelled) return;
            const first = value2.results?.[0];
            if (first && !name) setName(first.name);
          }).catch(() => {});
          return () => { cancelled = true; };
        }, [query]);

        const search = async () => {
          setBusy(true);
          setError('');
          try {
            const value2 = await api('search', { q: query });
            setResults(value2.results || []);
            if (!value2.results?.length) setError(t('noMatch'));
          } catch (err) {
            setError(String(err.message || err));
          } finally {
            setBusy(false);
          }
        };

        const submit = async () => {
          setBusy(true);
          setError('');
          try {
            await onSubmit({
              code: code.trim() || query.trim(),
              name,
              value: Number(value),
              profit: profit === '' ? null : Number(profit),
            });
            onClose();
          } catch (err) {
            setError(String(err.message || err));
          } finally {
            setBusy(false);
          }
        };

        return h('div', { className: 'mf-mask', onClick: onClose },
          h('div', { className: 'mf-modal', onClick: (event) => event.stopPropagation() },
            h('div', { className: 'mf-modal-head' }, t('addManual')),
            h('div', { className: 'mf-modal-body' },
              h('div', { style: { display: 'flex', gap: 6 } },
                h('input', {
                  className: 'mf-input',
                  value: query,
                  placeholder: t('searchHint'),
                  onChange: (event) => setQuery(event.target.value),
                  onKeyDown: (event) => { if (event.key === 'Enter') void search(); },
                }),
                h('button', { type: 'button', className: 'mf-btn', disabled: busy, onClick: search }, t('search'))),
              results.length
                ? h('div', { className: 'mf-preview' }, results.map((item) => h('div', {
                  key: item.code,
                  className: 'mf-preview-row',
                  style: { cursor: 'pointer' },
                  onClick: () => {
                    setCode(item.code);
                    setName(item.name);
                    setResults([]);
                  },
                },
                h('div', { style: { display: 'flex', gap: 6, alignItems: 'baseline' } },
                  h('span', { className: 'mf-name' }, item.name),
                  h('span', { className: 'mf-code' }, item.code),
                  h('span', { className: 'mf-note' }, item.company || '')))))
                : null,
              h('div', { className: 'mf-grid2' },
                h('label', { className: 'mf-field' },
                  h('span', { className: 'mf-k' }, t('code')),
                  h('input', { className: 'mf-input mf-mono', value: code, onChange: (event) => setCode(event.target.value) })),
                h('label', { className: 'mf-field' },
                  h('span', { className: 'mf-k' }, t('name')),
                  h('input', { className: 'mf-input', value: name, onChange: (event) => setName(event.target.value) }))),
              h('div', { className: 'mf-grid2' },
                h('label', { className: 'mf-field' },
                  h('span', { className: 'mf-k' }, t('value')),
                  h('input', { className: 'mf-input mf-mono', value, inputMode: 'decimal', onChange: (event) => setValue(event.target.value) })),
                h('label', { className: 'mf-field' },
                  h('span', { className: 'mf-k' }, t('profit')),
                  h('input', { className: 'mf-input mf-mono', value: profit, inputMode: 'decimal', onChange: (event) => setProfit(event.target.value) }))),
              error ? h('div', { className: 'mf-err' }, error) : null),
            h('div', { className: 'mf-modal-foot' },
              h('button', { type: 'button', className: 'mf-btn', onClick: onClose }, t('cancel')),
              h('button', { type: 'button', className: 'mf-btn mf-btn-p', disabled: busy, onClick: submit }, t('save')))));
      }

      function holdingsCount(data) {
        return (data?.holdings || []).length;
      }

      function clock(iso) {
        const date = iso ? new Date(iso) : new Date();
        if (Number.isNaN(date.getTime())) return '--:--';
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
      }

      function Page({ t }) {
        const [data, setData] = useState(null);
        const [busy, setBusy] = useState(false);
        const [error, setError] = useState('');
        const [dialog, setDialog] = useState('');
        const [showSettings, setShowSettings] = useState(false);

        const load = useCallback(async (force) => {
          try {
            const value = force ? await api('refresh', {}) : await api('state', {});
            setData(value);
            setError('');
          } catch (err) {
            setError(String(err.message || err));
          }
        }, []);

        const trading = Boolean(data?.trading);
        useEffect(() => {
          void load(false);
        }, [load]);
        useEffect(() => {
          // 盘中 1 分钟刷一次，收盘后 5 分钟够用，省得空转。
          const delay = trading ? 60_000 : 300_000;
          const timer = setInterval(() => {
            if (typeof document !== 'undefined' && document.hidden) return;
            void load(false);
          }, delay);
          return () => clearInterval(timer);
        }, [load, trading]);

        const [mailDraft, setMailDraft] = useState({ user: '', pass: '', to: '', enabled: false, morning: '08:00', evening: '21:30' });
        const [mailState, setMailState] = useState('');
        useEffect(() => {
          const notify = data?.settings?.notify;
          if (!notify) return;
          const cron = Array.isArray(notify.cron) ? notify.cron.slice(0, 2) : [];
          setMailDraft({
            user: notify.mail?.user || '',
            pass: notify.mail?.pass || '',
            to: notify.mail?.to || '',
            enabled: Boolean(notify.enabled),
            morning: cron[0] || '08:00',
            evening: cron[1] || '21:30',
          });
        }, [data?.settings?.notify?.user, data?.settings?.notify?.mail?.user]);

        const notifyBody = useCallback(() => ({
          ...(data?.settings?.notify || {}),
          enabled: mailDraft.enabled,
          cron: [mailDraft.morning || '08:00', mailDraft.evening || '21:30'],
          mail: {
            host: 'smtp.qq.com',
            port: 465,
            user: mailDraft.user.trim(),
            pass: mailDraft.pass.trim(),
            to: mailDraft.to.trim() || mailDraft.user.trim(),
          },
        }), [data?.settings?.notify, mailDraft]);

        const saveMail = useCallback(async () => {
          setMailState(t('notifySending'));
          try {
            await api('notify', { action: 'save', notify: notifyBody() });
            setMailState(t('notifySaved'));
            await load(false);
          } catch (err) {
            setMailState(String(err.message || err));
          }
        }, [notifyBody, load, t]);

        const testMail = useCallback(async () => {
          setMailState(t('notifySending'));
          try {
            const value = await api('notify', { action: 'test', notify: notifyBody() });
            setMailState(value?.sent ? t('notifyOk') : t('notifySaved'));
          } catch (err) {
            setMailState(String(err.message || err));
          }
        }, [notifyBody, t]);

        const refresh = useCallback(async () => {
          setBusy(true);
          await load(true);
          setBusy(false);
        }, [load]);

        const saveHoldings = useCallback(async (items) => {
          const value = await api('holdings', { action: 'save', holdings: items });
          setData(value);
        }, []);

        const removeHolding = useCallback(async (row) => {
          const value = await api('holdings', { action: 'remove', holdings: [{ code: row.code }] });
          setData(value);
        }, []);

        const savePlan = useCallback(async (plan) => {
          const value = await api('plans', { action: 'save', plan });
          setData(value);
        }, []);

        const removePlan = useCallback(async (plan) => {
          if (!window.confirm(t('deleteConfirm'))) return;
          const value = await api('plans', { action: 'remove', id: plan.id });
          setData(value);
        }, [t]);

        const runPlan = useCallback(async (plan) => {
          const value = await api('plans', { action: 'run', id: plan.id });
          setData(value);
        }, []);

        const toggleAuto = useCallback(async () => {
          const next = { ...(data?.settings || {}), autoRefresh: !(data?.settings?.autoRefresh) };
          const value = await api('settings', { settings: next });
          setData(value);
        }, [data]);

        const clearAll = useCallback(async () => {
          if (!window.confirm(t('allClear'))) return;
          const value = await api('holdings', { action: 'clear' });
          setData(value);
        }, [t]);

        const resetAll = useCallback(async () => {
          if (!window.confirm(t('resetConfirm'))) return;
          const value = await api('settings', { action: 'reset' });
          setData(value);
        }, [t]);

        if (!data) {
          return h('div', { className: 'mf-root' },
            h('div', { className: 'mf-head' }, h('span', { className: 'mf-title' }, t('title'))),
            h('div', { className: 'mf-scroll' }, h('div', { className: 'mf-skel' },
              h('div', { className: 'mf-skel-h' }),
              h('div', { className: 'mf-skel-b' }),
              h('div', { className: 'mf-skel-h' }),
              h('div', { className: 'mf-skel-b' }))));
        }

        const summary = data.summary;
        const stale = Boolean(data.quotesAt) && Date.now() - data.quotesAt > 15 * 60_000
          && (holdingsCount(data) > 0);
        const holdings = data.holdings || [];
        const plans = data.plans || [];

        return h('div', { className: 'mf-root' },
          h('div', { className: 'mf-head' },
            h('span', { className: 'mf-title' }, t('title')),
            h('button', { type: 'button', className: 'mf-btn', onClick: () => setDialog('import') }, t('importShot')),
            h('button', { type: 'button', className: 'mf-btn', onClick: () => setDialog('add') }, '+'),
            h('button', { type: 'button', className: 'mf-btn mf-btn-x', onClick: () => setShowSettings(!showSettings) }, '⚙')),
          h('div', { className: 'mf-scroll' },
            h(Summary, { data, onRefresh: refresh, busy, t }),
            error ? h('div', { className: 'mf-err' }, error) : null,
            showSettings
              ? h('div', { className: 'mf-card', style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                h('label', { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' } },
                  h('input', { type: 'checkbox', checked: Boolean(data.settings?.autoRefresh), onChange: toggleAuto }),
                  h('span', null, t('autoRefresh'))),
                h('div', { className: 'mf-note' }, `OCR ${data.ocr?.available ? data.ocr.lang : '—'}`),
                (data.lanUrls || []).length
                  ? h('div', { className: 'mf-note' },
                    t('phoneHint'),
                    h('br', null),
                    h('code', { className: 'mf-lanurl', onClick: () => { try { navigator.clipboard.writeText(data.lanUrls[0]); } catch { /* ignore */ } } }, data.lanUrls[0]))
                  : null,
                h('div', { style: { display: 'flex', gap: 6 } },
                  h('button', { type: 'button', className: 'mf-btn', onClick: clearAll }, t('clear')),
                  h('button', { type: 'button', className: 'mf-btn', onClick: resetAll }, t('resetAll'))),
                h('div', { className: 'mf-notify' },
                  h('div', { className: 'mf-mk' }, t('notifyTitle')),
                  h('label', { className: 'mf-ncheck' },
                    h('input', {
                      type: 'checkbox',
                      checked: mailDraft.enabled,
                      onChange: (event) => setMailDraft({ ...mailDraft, enabled: event.target.checked }),
                    }),
                    h('span', null, t('notifyOn'))),
                  h('input', {
                    className: 'mf-input',
                    placeholder: t('notifyUser'),
                    value: mailDraft.user,
                    onChange: (event) => setMailDraft({ ...mailDraft, user: event.target.value }),
                  }),
                  h('input', {
                    className: 'mf-input',
                    type: 'password',
                    placeholder: t('notifyPass'),
                    value: mailDraft.pass,
                    onChange: (event) => setMailDraft({ ...mailDraft, pass: event.target.value }),
                  }),
                  h('input', {
                    className: 'mf-input',
                    placeholder: t('notifyTo'),
                    value: mailDraft.to,
                    onChange: (event) => setMailDraft({ ...mailDraft, to: event.target.value }),
                  }),
                  h('div', { className: 'mf-times' },
                    h('label', { className: 'mf-time' },
                      h('span', null, t('notifyMorning')),
                      h('input', {
                        className: 'mf-input mf-input-t',
                        type: 'time',
                        value: mailDraft.morning,
                        onChange: (event) => setMailDraft({ ...mailDraft, morning: event.target.value }),
                      })),
                    h('label', { className: 'mf-time' },
                      h('span', null, t('notifyEvening')),
                      h('input', {
                        className: 'mf-input mf-input-t',
                        type: 'time',
                        value: mailDraft.evening,
                        onChange: (event) => setMailDraft({ ...mailDraft, evening: event.target.value }),
                      }))),
                  h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
                    h('button', { type: 'button', className: 'mf-btn', onClick: saveMail }, t('notifySave')),
                    h('button', { type: 'button', className: 'mf-btn', onClick: testMail }, t('notifyTest')),
                    mailState ? h('span', { className: 'mf-note' }, mailState) : null),
                  h('div', { className: 'mf-note' }, t('notifyHint'))))
              : null,
            h('div', { className: 'mf-sec' },
              h('span', { className: 'mf-sec-t' }, `${t('holdings')} ${holdings.length}`),
              h('span', { className: 'mf-note' }, summary.estimated ? t('estimated') : t('settled'))),
            holdings.length
              ? h('div', { className: 'mf-list' }, holdings.map((row) => h(HoldingRow, {
                key: row.code,
                row,
                t,
                onSave: (target, patch) => saveHoldings([{ code: target.code, name: target.name, ...patch }]),
                onRemove: removeHolding,
              })))
              : h('div', { className: 'mf-empty' },
                h('div', { className: 'mf-empty-t' }, t('emptyTitle')),
                h('div', { className: 'mf-empty-n' }, t('emptyHint')),
                h('div', { className: 'mf-empty-row' },
                  h('button', { type: 'button', className: 'mf-btn mf-btn-p', onClick: () => setDialog('import') }, t('importShot')),
                  h('button', { type: 'button', className: 'mf-btn', onClick: () => setDialog('add') }, t('add')))),
            h('div', { className: 'mf-sec' },
              h('span', { className: 'mf-sec-t' }, t('plans')),
              h('button', { type: 'button', className: 'mf-btn', onClick: () => setDialog('plan') }, t('addPlan'))),
            plans.length
              ? h('div', { className: 'mf-list' }, plans.map((plan) => h(PlanRow, {
                key: plan.id,
                plan,
                t,
                onRemove: removePlan,
                onRun: runPlan,
              })))
              : h('div', { className: 'mf-empty' }, t('noPlans')),
            h('div', { className: 'mf-foot' },
              h('span', null, `${t('updatedAt')} ${clock(data.updatedAt)}`),
              h('span', null, `${t('nextRefresh')} ${data.trading ? 1 : 5}${t('minUnit')}`),
              data.lastSettle ? h('span', null, `${t('settledOn')} ${data.lastSettle}`) : null,
              h('span', null, t('dataSource')),
              stale ? h('span', { className: 'mf-foot-warn' }, t('staleHint')) : null)),
          dialog === 'import'
            ? h(ImportDialog, { t, ocr: data.ocr || {}, onClose: () => setDialog(''), onImported: () => void load(true) })
            : null,
          dialog === 'add'
            ? h(AddDialog, { t, onClose: () => setDialog(''), onSubmit: (item) => saveHoldings([item]) })
            : null,
          dialog === 'plan'
            ? h(PlanEditor, { t, onClose: () => setDialog(''), onSubmit: savePlan })
            : null);
      }

      /* -------------------------------------------------------------- apply */

      const inject = ['slots', 'locale'];

      function apply(ctx) {
        let disposeStyle = () => {};
        ctx.effect(() => {
          const style = document.createElement('style');
          style.setAttribute('data-dsh-my-funds', '1');
          style.textContent = CSS;
          document.head.append(style);
          disposeStyle = () => style.remove();
          return () => disposeStyle();
        }, 'my-funds: styles');

        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'my-funds: locale');
        const t = ctx.locale.bind(NS);
        const tt = (key) => {
          try {
            const value = t(key);
            return typeof value === 'string' && value ? value : (zh[key] ?? key);
          } catch {
            return zh[key] ?? key;
          }
        };

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'my-funds',
          order: 36,
          label: tt('title'),
          inject: () => ({ t: tt }),
        }, Rail));

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'my-funds',
          inject: () => ({ t: tt }),
        }, Page));
      }

      return { inject, apply };
    },
  });
})();
