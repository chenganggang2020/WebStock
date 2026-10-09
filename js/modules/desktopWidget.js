(function() {
  'use strict';
  const prefs = window.MarketBoardPreferences, native = window.marketWidgetDesktop;
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, digits = 2) => v == null ? '—' : Number(v).toFixed(digits);
  const pct = v => v == null ? '—' : (v > 0 ? '+' : '') + fmt(v) + '%';
  const color = v => v > 0 ? 'up' : v < 0 ? 'down' : '';
  const stamp = v => v ? new Date(v).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '时间未提供';
  let settings = prefs.widget(prefs.read(prefs.widgetKey, localStorage)), catalog = [], accounts = [], quotes = [], positions = [];
  let selectedAccount = null, timer, busy = false, generation = 0, failure = '';
  const money = v => settings.hideAmounts ? '••••' : fmt(v);
  async function get(url) { const response = await fetch(url, { signal: AbortSignal.timeout(18000) }); const body = await response.json(); if (!response.ok || !body.success) throw Error(body.error || '接口不可用'); return body.data; }
  function render() {
    el('widgetQuotes').innerHTML = settings.showQuotes ? quotes.map(item => '<div class="widget-row"><strong>' + esc(item.name) + '</strong><b class="' + color(item.changePct) + '">' + fmt(item.value, item.digits) + '</b><small>' + esc(item.group) + '</small><span class="' + color(item.changePct) + '">' + pct(item.changePct) + '</span>' + prefs.spark(item.points) + '<p>' + esc((item.status === 'cached' ? '缓存 · ' : '') + stamp(item.observedAt) + ' · ' + (item.source || item.reason || '未返回')) + '</p></div>').join('') : '';
    const summary = selectedAccount?.summary || {};
    el('widgetPnl').innerHTML = settings.showPnl ? '<small>' + esc(selectedAccount?.name || '暂无账户') + ' · 持仓采集日 ' + esc(selectedAccount?.latestSnapshot?.snapshotDate || '未提供') + '</small><div class="widget-pnl"><div>当日盈亏<b class="' + color(summary.todayPnl) + '">' + money(summary.todayPnl) + '</b></div><div>浮动盈亏<b class="' + color(summary.unrealizedPnl) + '">' + money(summary.unrealizedPnl) + '</b></div></div><small>行情 ' + esc((summary.quoteDate || '未提供') + ' ' + (summary.quoteTime || '')) + ' · ' + esc(({ live: '估值更新中', stale: '最近报价（非实时）', partial: '部分缺失', unavailable: '暂无可用行情', empty: '无持仓' })[summary.valuationStatus] || '状态未知') + ' · 当日盈亏日期 ' + esc(summary.todayPnlDate || '不可用') + '</small>' : '';
    el('widgetPositions').innerHTML = settings.showPositions ? positions.map(row => '<div class="widget-row"><strong>' + esc(row.name) + ' <small>' + esc(row.code) + '</small></strong><b class="' + color(row.change) + '">' + fmt(row.currentPrice) + '</b><small>浮动盈亏 ' + money(row.unrealizedPnl) + '</small><span class="' + color(row.change) + '">' + pct(row.change) + '</span><p>行情 ' + esc((row.quoteDate || '未提供') + ' ' + (row.quoteTime || '')) + '</p></div>').join('') : '';
    el('widgetStatus').textContent = failure ? '刷新失败，保留上次结果：' + failure : '30秒检查 · 数据时间见各项 · 公开源延迟未保证';
    el('widgetStatus').className = failure ? 'warning' : '';
  }
  function renderChoices() {
    for (const key of ['showQuotes', 'showPnl', 'showPositions', 'hideAmounts']) el(key).checked = settings[key];
    el('widgetQuoteChoices').innerHTML = catalog.map(item => '<label><input type="checkbox" data-widget-key="' + esc(item.key) + '" ' + (settings.keys.includes(item.key) ? 'checked' : '') + '> ' + esc(item.name) + '</label>').join('');
    el('widgetAccount').innerHTML = '<option value="0">优先同花顺同步账户</option>' + accounts.map(a => '<option value="' + a.id + '">' + esc(a.name) + '</option>').join('');
    el('widgetAccount').value = String(settings.accountId);
  }
  async function refresh() {
    if (busy) return;
    busy = true; clearTimeout(timer); const request = generation;
    try {
      const [market, overview] = await Promise.all([
        settings.showQuotes || !catalog.length ? get('/api/market/global-board?keys=' + encodeURIComponent(settings.showQuotes ? settings.keys.join(',') : '')) : null,
        settings.showPnl || settings.showPositions ? get('/api/portfolio/accounts/overview') : null
      ]);
      if (request !== generation) return;
      if (market) { catalog = market.catalog || []; quotes = market.items || []; }
      if (overview) accounts = overview;
      selectedAccount = settings.accountId ? accounts.find(a => a.id === settings.accountId) : accounts.find(a => /同花顺/.test(a.name)) || accounts[0];
      if (settings.showPositions && selectedAccount) {
        const rows = await get('/api/portfolio/positions?accountId=' + selectedAccount.id);
        if (request !== generation) return; positions = rows;
      } else positions = [];
      failure = ''; renderChoices(); render();
    } catch (error) { if (request === generation) { failure = error.message; render(); } }
    finally { busy = false; timer = setTimeout(refresh, request !== generation ? 0 : quotes.some(row => row.status === 'loading') ? 2000 : 30000); }
  }
  el('widgetSettings').addEventListener('change', event => {
    const key = event.target.dataset.widgetKey;
    if (key) settings.keys = event.target.checked ? [...settings.keys, key] : settings.keys.filter(k => k !== key);
    else if (event.target.id === 'widgetAccount') { settings.accountId = Number(event.target.value); selectedAccount = null; positions = []; }
    else if (['showQuotes', 'showPnl', 'showPositions', 'hideAmounts'].includes(event.target.id)) settings[event.target.id] = event.target.checked;
    generation++; quotes = quotes.filter(row => settings.keys.includes(row.key)); render();
    try { localStorage.setItem(prefs.widgetKey, JSON.stringify(settings)); } catch (_) { failure = '设置未保存'; render(); }
    refresh();
  });
  el('widgetClose').onclick = () => native?.setState({ enabled: false }).catch(error => { failure = error.message; render(); });
  el('widgetMain').onclick = () => native?.openMain();
  el('widgetTop').onclick = async () => { if (!native) return; const state = await native.getState(); const next = await native.setState({ alwaysOnTop: !state.alwaysOnTop }); el('widgetTop').setAttribute('aria-pressed', String(next.alwaysOnTop)); };
  if (native) native.getState().then(state => el('widgetTop').setAttribute('aria-pressed', String(state.alwaysOnTop)));
  else for (const id of ['widgetTop', 'widgetMain', 'widgetClose']) el(id).disabled = true;
  renderChoices(); refresh();
})();
