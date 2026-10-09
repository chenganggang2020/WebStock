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
  const sectionErrors = { market: '', accounts: '', positions: '' }, loading = new Set();
  const htmlCache = new Map();
  function html(id, value) {
    // Only this view owns these containers; unchanged snapshots must not replace
    // focused controls or rebuild sparklines.
    if (htmlCache.get(id) === value) return;
    el(id).innerHTML = value; htmlCache.set(id, value);
  }
  async function get(url) { const response = await fetch(url, { signal: AbortSignal.timeout(18000) }); const body = await response.json(); if (!response.ok || !body.success) throw Error(body.error || '接口不可用'); return body.data; }
  function render() {
    if (document.hidden) return;
    html('widgetQuotes', settings.showQuotes ? quotes.map(item => '<div class="widget-row"><strong>' + esc(item.name) + '</strong><b class="' + color(item.changePct) + '">' + fmt(item.value, item.digits) + '</b><small>' + esc(item.group) + '</small><span class="' + color(item.changePct) + '">' + pct(item.changePct) + '</span>' + prefs.spark(item.points) + '<p>' + esc((item.status === 'cached' ? '缓存 · ' : '') + stamp(item.observedAt) + ' · ' + (item.source || item.reason || '未返回')) + '</p></div>').join('') : '');
    const summary = selectedAccount?.summary || {};
    html('widgetPnl', settings.showPnl ? '<small>' + esc(selectedAccount?.name || '暂无账户') + ' · 持仓采集日 ' + esc(selectedAccount?.latestSnapshot?.snapshotDate || '未提供') + '</small><div class="widget-pnl"><div>当日盈亏<b class="' + color(summary.todayPnl) + '">' + money(summary.todayPnl) + '</b></div><div>浮动盈亏<b class="' + color(summary.unrealizedPnl) + '">' + money(summary.unrealizedPnl) + '</b></div></div><small>行情 ' + esc((summary.quoteDate || '未提供') + ' ' + (summary.quoteTime || '')) + ' · ' + esc(({ live: '估值更新中', stale: '最近报价（非实时）', partial: '部分缺失', unavailable: '暂无可用行情', empty: '无持仓' })[summary.valuationStatus] || '状态未知') + ' · 当日盈亏日期 ' + esc(summary.todayPnlDate || '不可用') + '</small>' : '');
    html('widgetPositions', settings.showPositions ? positions.map(row => '<div class="widget-row"><strong>' + esc(row.name) + ' <small>' + esc(row.code) + '</small></strong><b class="' + color(row.change) + '">' + fmt(row.currentPrice) + '</b><small>浮动盈亏 ' + money(row.unrealizedPnl) + '</small><span class="' + color(row.change) + '">' + pct(row.change) + '</span><p>行情 ' + esc((row.quoteDate || '未提供') + ' ' + (row.quoteTime || '')) + '</p></div>').join('') : '');
    const labels = { market: '行情', accounts: '账户', positions: '持仓' };
    const errors = Object.entries(sectionErrors).filter(([, message]) => message)
      .map(([key, message]) => labels[key] + '更新失败，保留已有结果：' + message);
    if (failure) errors.push(failure);
    const pending = [...loading].map(key => labels[key] + '读取中').join(' · ');
    el('widgetStatus').textContent = [errors.join('；'), pending,
      '30秒检查 · 数据时间见各项 · 公开源延迟未保证'].filter(Boolean).join(' · ');
    el('widgetStatus').className = errors.length ? 'warning' : '';
  }
  function renderChoices() {
    if (document.hidden) return;
    for (const key of ['showQuotes', 'showPnl', 'showPositions', 'hideAmounts']) el(key).checked = settings[key];
    html('widgetQuoteChoices', catalog.map(item => '<label><input type="checkbox" data-widget-key="' + esc(item.key) + '" ' + (settings.keys.includes(item.key) ? 'checked' : '') + '> ' + esc(item.name) + '</label>').join(''));
    html('widgetAccount', '<option value="0">优先同花顺同步账户</option>' + accounts.map(a => '<option value="' + a.id + '">' + esc(a.name) + '</option>').join(''));
    el('widgetAccount').value = String(settings.accountId);
  }
  async function refresh() {
    if (busy) return;
    clearTimeout(timer);
    // UI polling is separate from collection. Hiding this window must not
    // start or stop backend collectors.
    if (document.hidden) { timer = setTimeout(refresh, 30000); return; }
    busy = true; const request = generation;
    const current = () => request === generation;
    async function section(key, action) {
      loading.add(key); render();
      try { await action(); if (current()) sectionErrors[key] = ''; }
      catch (error) { if (current()) sectionErrors[key] = error.message || '接口不可用'; }
      finally { loading.delete(key); if (current()) { renderChoices(); render(); } }
    }
    const jobs = [];
    if (settings.showQuotes || !catalog.length) jobs.push(section('market', async () => {
      const market = await get('/api/market/global-board?keys=' + encodeURIComponent(settings.showQuotes ? settings.keys.join(',') : ''));
      if (!current()) return;
      if (!market || !Array.isArray(market.catalog) || !Array.isArray(market.items)) throw Error('行情返回格式无效');
      catalog = market.catalog; quotes = market.items;
    }));
    if (settings.showPnl || settings.showPositions) jobs.push(section('accounts', async () => {
      const overview = await get('/api/portfolio/accounts/overview');
      if (!current()) return;
      if (!Array.isArray(overview)) throw Error('账户返回格式无效');
      const previousId = selectedAccount?.id;
      accounts = overview;
      selectedAccount = settings.accountId ? accounts.find(a => a.id === settings.accountId) :
        accounts.find(a => /同花顺/.test(a.name)) || accounts[0];
      if (previousId !== selectedAccount?.id) positions = [];
      sectionErrors.accounts = ''; loading.delete('accounts');
      renderChoices(); render(); // Show valuation before the position request.
      if (settings.showPositions && selectedAccount) {
        const accountId = selectedAccount.id;
        await section('positions', async () => {
          const rows = await get('/api/portfolio/positions?accountId=' + accountId);
          if (!current() || selectedAccount?.id !== accountId) return;
          if (!Array.isArray(rows)) throw Error('持仓返回格式无效');
          positions = rows;
        });
      } else { positions = []; sectionErrors.positions = ''; }
    }));
    try {
      await Promise.all(jobs); // Completion barrier only; each region already paints independently.
    } finally {
      busy = false;
      timer = setTimeout(refresh, document.hidden ? 30000 : request !== generation ? 0 :
        quotes.some(row => row.status === 'loading') ? 2000 : 30000);
    }
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
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { renderChoices(); render(); refresh(); }
  });
  renderChoices(); refresh();
})();
