(function(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.HomeTerminal = api;
})(typeof window !== 'undefined' ? window : null, function(root) {
  let bound = false;
  let groupKey = ':watchlist';
  let visibleItems = [], navigationItems = [], rowLimit = 60, lookupRows = null, lookupQuery = '', searchSequence = 0, searchTimer = null;
  let selecting = false;
  const origins = new Map();
  const charts = new Map();
  let indicesSignature = '';
  let pinned = true, browserTab = 'stocks', instrument = '', volumeChart;
  let lastIndices, lastIntraday, indexSelection = null;
  try {
    pinned = root?.localStorage?.getItem('webstock-home-pin') !== 'false';
    indexSelection = JSON.parse(root?.localStorage?.getItem('webstock-home-indices') || 'null');
  } catch (_) {}
  const el = id => root && root.document.getElementById(id);
  const finite = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const formatNumber = value => finite(value) === null ? '—' : Number(value).toFixed(2);
  const pct = value => finite(value) === null ? '—' : (Number(value) > 0 ? '+' : '') + formatNumber(value) + '%';
  const trend = value => finite(value) === null || Number(value) === 0 ? '' : Number(value) > 0 ? 'pnl-up' : 'pnl-down';
  const amount = value => finite(value) === null ? '—' : (Number(value) / 1e8).toFixed(2) + '亿';
  const isChartView = view => view === 'dashboard' || view === 'market';
  const indexHistory = (series, key) => (series || []).find(row => row.key === key || row.key === 'index:' + key);
  // Live quote polling is bounded even when the user browses the whole catalog.
  const groupItems = () => visibleItems.slice(0, 60);
  const displayTime = value => value && root.WebStockTime ? root.WebStockTime.formatDateTime(value) : value || '未记录';

  function browserGroups(groups) {
    return [{ key: ':watchlist', name: '全部自选' }, { key: ':market', name: '全市场' }].concat((groups || []).filter(group => group.readOnly));
  }
  function sentimentBand(value) {
    const n = finite(value);
    return n === null ? 'unknown' : n < 25 ? 'fear-extreme' : n < 45 ? 'fear' : n <= 55 ? 'neutral' : n <= 75 ? 'greed' : 'greed-extreme';
  }
  function syncBrowser(view) {
    const drawer = el('marketDrawer'), dock = el('homeMarketDock');
    if (!drawer || !dock) return;
    const docked = pinned && view === 'dashboard';
    move(drawer, dock, docked);
    drawer.classList.toggle('home-docked', docked);
    drawer.dataset.browserTab = browserTab;
    dock.hidden = !docked;
    root.document.body.classList.toggle('home-browser-pinned', docked);
    if (docked) { drawer.removeAttribute('inert'); drawer.setAttribute('aria-hidden', 'false'); root.document.body.classList.remove('market-drawer-open'); }
    else if (!root.document.body.classList.contains('market-drawer-open')) { drawer.setAttribute('inert', ''); drawer.setAttribute('aria-hidden', 'true'); }
    if (el('marketDrawerPin')) { el('marketDrawerPin').textContent = pinned ? '取消固定' : '固定到主页'; el('marketDrawerPin').setAttribute('aria-pressed', String(pinned)); }
  }
  function setPinned(value) {
    pinned = value;
    try { root.localStorage.setItem('webstock-home-pin', String(value)); } catch (_) {}
    syncBrowser(root.State.currentMainView); resize();
  }
  function activateInstrument(kind) {
    if (kind && root.State.currentMainView !== 'dashboard') root.switchMainView('dashboard');
    if (kind !== 'index') root.MarketComparison?.closeIndexDetail?.();
    if (kind !== 'global') root.MarketBoard?.close?.();
    instrument = kind;
    if (el('homeChartHost')) el('homeChartHost').dataset.instrument = kind;
    if (el('homeBookHost')) el('homeBookHost').hidden = Boolean(kind);
    root.requestAnimationFrame(resize);
  }
  function closeInstrument(kind) {
    if (instrument !== kind) return;
    instrument = '';
    if (el('homeChartHost')) el('homeChartHost').dataset.instrument = '';
    if (el('homeBookHost')) el('homeBookHost').hidden = false;
    root.requestAnimationFrame(resize);
  }

  function rankBoards(boards, kind) {
    const field = kind === 'industry' ? 'mainNetInflow' : 'dailyChangePct';
    return (boards || []).filter(x => x && (x.kind === kind || kind === 'industry' && x.kind === 'sina-industry'))
      .slice().sort((a, b) => (finite(b[field]) ?? -Infinity) - (finite(a[field]) ?? -Infinity)).slice(0, 6);
  }

  function html(id, value) {
    const node = el(id);
    if (node && node.innerHTML !== value) node.innerHTML = value;
  }

  function move(node, target, active) {
    if (!node || !target) return;
    if (!origins.has(node)) {
      const marker = root.document.createComment('shared stock workspace');
      node.before(marker);
      origins.set(node, marker);
    }
    if (active) { if (node.parentNode !== target) target.appendChild(node); }
    else { const marker = origins.get(node); marker.after(node); }
  }

  function sync(view) {
    const active = view === 'dashboard';
    syncBrowser(view);
    if (!active && instrument) activateInstrument('');
    // A deep link primes the security without calling showRealtimeView().
    // Reveal its controls when the shared chart is brought into a visible view.
    if (isChartView(view) && root.State.currentStock) el('indicatorBtns')?.classList.add('visible');
    move(el('stockWorkspace'), el('homeChartHost'), active);
    move(root.document.querySelector('.realtime-right'), el('homeBookHost'), active);
    move(root.document.querySelector('.stock-detail-card'), el('homeStockDetails'), active);
    const right = root.document.querySelector('.realtime-right');
    if (right && active) right.prepend(right.querySelector('.order-book'));
    if (active) renderWatchlist();
    root.requestAnimationFrame(resize);
  }

  function resize() {
    ['timeChart', 'volumeChart', 'klineChart'].forEach(key => {
      const chart = root.State && root.State[key];
      if (chart) chart.resize();
    });
    charts.forEach(chart => chart.resize());
    volumeChart?.resize();
    root.MarketBoard?.resize?.();
    root.MarketComparison?.resize?.();
  }

  function renderWatchlist() {
    if (!root.Watchlist || !root.Watchlist.getGroupItems) return;
    const groups = root.Watchlist.watchlistGroups();
    if (![':market', ':watchlist'].includes(groupKey) && !groups.some(group => group.key === groupKey)) groupKey = ':watchlist';
    html('homeGroups', browserGroups(groups).map(group => '<button type="button" data-home-group="' + escape(group.key) + '" aria-pressed="' + (group.key === groupKey) + '">' + escape(group.name) + '</button>').join(''));
    const query = (el('homeWatchSearch').value || '').trim().toLowerCase();
    el('homeWatchSearch').placeholder = groupKey === ':market' ? '代码 / 名称 / 拼音 · 联网补查' : '筛选自选；全市场请切换上方范围';
    const source = groupKey === ':market' ? (root.State.allStocks || []) : groupKey === ':watchlist'
      ? Array.from(new Map(groups.flatMap(group => root.Watchlist.getGroupItems(group.key)).map(item => [item.code, item])).values())
      : root.Watchlist.getGroupItems(groupKey);
    const local = !query ? source : groupKey === ':market' && root.Search ? root.Search.searchStocks(query)
      : source.filter(item => root.Search ? root.Search.matchScore(query, item) > 0 : (item.code + ' ' + item.name).toLowerCase().includes(query));
    const matches = groupKey === ':market' && query === lookupQuery && lookupRows ? lookupRows : local;
    navigationItems = matches;
    const items = matches.slice(0, rowLimit);
    visibleItems = items;
    const selected = root.State.currentStock && root.State.currentStock.code;
    html('homeWatchRows', items.length ? items.map(item => '<button type="button" data-home-stock="' + escape(item.code) + '" aria-pressed="' + (item.code === selected) + '"><span>' + escape(item.name || item.code) + '<small>' + escape(item.code) + '</small></span><b class="' + trend(item.change) + '">' + (finite(item.price) > 0 ? pct(item.change) : '—') + '</b></button>').join('') : '<p class="home-empty">当前范围无匹配结果。可切换到“A股 / ETF”按代码、名称或拼音检索。</p>');
    if (el('homeLoadMore')) el('homeLoadMore').hidden = items.length >= matches.length;
    if (el('homeAddWatchlist')) {
      el('homeAddWatchlist').disabled = !root.State.currentStock;
      el('homeAddWatchlist').textContent = root.State.currentStock ? '加入自选：' + (root.State.currentStock.name || selected) : '选中股票后加入自选';
    }
    el('homeWatchStatus').textContent = '已显示 ' + items.length + ' / ' + matches.length + ' 只 · ' +
      (groupKey === ':market' ? 'A股与场内ETF；目录覆盖不等于实时行情覆盖。' : '点击联动主图 · 同花顺分组只读');
  }

  function search() {
    const seq = ++searchSequence;
    rowLimit = 60; lookupRows = null;
    if (searchTimer) clearTimeout(searchTimer);
    renderWatchlist();
    const query = el('homeWatchSearch').value.trim().toLowerCase();
    if (groupKey !== ':market' || query.length < 2 || !root.Search) return;
    el('homeWatchStatus').textContent += ' 正在联网补查…';
    searchTimer = setTimeout(async () => {
      const rows = await root.Search.searchStocksDeep(query, root.Search.searchStocks(query));
      if (seq !== searchSequence || groupKey !== ':market' || el('homeWatchSearch').value.trim().toLowerCase() !== query) return;
      lookupQuery = query; lookupRows = rows;
      renderWatchlist();
    }, 250);
  }

  async function select(code) {
    const item = visibleItems.find(x => x.code === code) || (root.State.watchlist || []).find(x => x.code === code) || (root.State.allStocks || []).find(x => x.code === code);
    if (!item) return;
    const group = root.Watchlist.watchlistGroups().find(row => row.key === groupKey);
    const label = groupKey === ':market' ? '全市场搜索' : groupKey === ':watchlist' ? '全部自选' : '自选 · ' + (group && group.name || '当前组');
    if (root.State.currentMainView !== 'dashboard') root.switchMainView?.('dashboard');
    await root.StockList.selectStock(item, { navigation: { items: navigationItems, label } });
    renderWatchlist();
  }

  function ensureSelection() {
    if (selecting || instrument || root.State.currentMainView !== 'dashboard') return;
    renderWatchlist();
    const stock = root.State.currentStock || groupItems()[0];
    if (!stock) return;
    selecting = true;
    root.StockList.selectStock(stock).catch(error => { el('chartRealtimeStatus').textContent = '行情读取失败：' + error.message; })
      .finally(() => { selecting = false; renderWatchlist(); });
  }

  function renderMarket(snapshot) {
    if (!el('homeSentiment')) return;
    snapshot = snapshot || {};
    const data = Object.assign({}, snapshot.sentiment || root.State.marketSentiment || {});
    data.updatedAt = displayTime(data.updatedAt);
    const a = data.aShare || {};
    const unavailable = ['unavailable', 'fallback'].includes(a.sourceStatus);
    html('homeSentiment', '<strong class="home-score" data-band="' + sentimentBand(unavailable ? null : a.score) + '">' + (unavailable ? '—' : formatNumber(a.score)) + '<small>' + escape(unavailable ? '行情不可用' : a.label || '情绪估算') + '</small></strong><dl><dt>上涨 / 下跌</dt><dd><span class="pnl-up">' + escape(unavailable ? '—' : a.advancing ?? '—') + '</span> / <span class="pnl-down">' + escape(unavailable ? '—' : a.declining ?? '—') + '</span></dd><dt>上涨占比</dt><dd>' + (unavailable ? '—' : pct(a.breadthPct)) + '</dd><dt>涨停 / 大跌样本</dt><dd>' + escape(unavailable ? '—' : a.limitUpLike ?? '—') + ' / ' + escape(unavailable ? '—' : a.sharpDown ?? '—') + '</dd></dl><small>' + escape(a.source || '公开行情估算') + ' · ' + escape(data.updatedAt || '时间未记录') + '</small>');
    const hot = snapshot.hot || {};
    const boards = hot.marketStatus === 'unavailable' ? [] : hot.boards && hot.boards.day || [];
    ['industry', 'concept'].forEach(kind => {
      const rows = rankBoards(boards, kind);
      html(kind === 'industry' ? 'homeIndustryRows' : 'homeConceptRows', rows.length ? '<table><thead><tr><th>板块</th><th>涨跌幅</th><th>主力净额</th></tr></thead><tbody>' + rows.map(item => '<tr><td>' + escape(item.name || item.code) + '</td><td class="' + trend(item.dailyChangePct) + '">' + pct(item.dailyChangePct) + '</td><td class="' + trend(item.mainNetInflow) + '">' + amount(item.mainNetInflow) + '</td></tr>').join('') + '</tbody></table>' : '<p class="home-empty">板块数据暂不可用，未使用本地分组代替。</p>');
    });
    const risks = root.Dashboard ? root.Dashboard.buildRisks().slice(0, 6) : [];
    html('homeRiskRows', risks.length ? risks.map(risk => '<button type="button" class="home-risk"' + (risk.code ? ' data-home-stock="' + escape(risk.code) + '"' : ' data-home-page="watchlist"') + '><strong>' + escape(risk.title) + '</strong><span>' + escape(risk.detail) + '</span></button>').join('') : '<p class="home-empty">当前无可用风险提示；不代表没有风险。</p>');
    const sources = (hot.sources || []).join(' / ') || '板块来源暂不可用';
    const failed = Object.keys(snapshot.refreshErrors || {}).map(key => ({ indices: '指数', sentiment: '情绪', hot: '板块', indexHistory: '指数历史' }[key] || key));
    el('homeSources').textContent = sources + ' · 板块更新 ' + displayTime(hot.generatedAt) + ' · 净额为供应商模型估算，行业与概念不可相加。' +
      (snapshot.error || failed.length ? ' · 刷新失败，保留上次结果（无历史则暂无）：' + (snapshot.error || failed.join('、')) : '');
    renderWatchlist();
  }

  function renderVolume(data) {
    if (!el('homeVolume')) return;
    const m = data && data.metrics || {};
    const usable = !(data && data.quality && data.quality.usable === false);
    const measure = data && data.measure;
    const curve = el('homeVolumeCurve');
    if (curve && root.echarts) {
      if (!volumeChart) volumeChart = root.echarts.init(curve);
      const points = data?.series || [];
      volumeChart.setOption({ animation: false, grid: { left: 30, right: 5, top: 5, bottom: 17 },
        tooltip: { trigger: 'axis', valueFormatter: pct },
        xAxis: { type: 'category', data: points.map(p => p.label), axisLabel: { fontSize: 9, hideOverlap: true }, boundaryGap: false },
        yAxis: { type: 'value', axisLabel: { fontSize: 9, formatter: '{value}%' }, splitNumber: 2 },
        series: [['累计同比','cumulativeYoYPct','#d94355'],['5分同比','rolling5YoYPct','#488de0'],['5分环比','rolling5SequentialPct','#ce9b28']].map(([name,key,color]) => ({ name, type: 'line', symbol: 'none', connectNulls: false, lineStyle: { width: 1, color }, data: points.map(p => finite(p[key])) }))
      }, true);
    }
    html('homeVolume', '<dl><dt>' + (measure === 'amount' ? '同时间成交额' : '同时间成交量（降级）') + '</dt><dd>' + (usable ? amount(m.todayCumulativeValue) : '—') + '</dd><dt>累计同比</dt><dd class="' + trend(m.cumulativeYoYPct) + '">' + (usable ? pct(m.cumulativeYoYPct) : '—') + '</dd><dt>近5分钟同比</dt><dd class="' + trend(m.rolling5YoYPct) + '">' + pct(m.rolling5YoYPct) + '</dd><dt>近5分钟环比</dt><dd class="' + trend(m.rolling5SequentialPct) + '">' + pct(m.rolling5SequentialPct) + '</dd></dl><small>' + escape(data && data.tradingDate || '无交易日期') + ' ' + escape(data && data.asOf || '') + ' · ' + escape(data && data.source && data.source.label || '来源不可用') + '</small>');
  }

  function renderIndices(indicesData, intradayData) {
    if (!el('homeIndices')) return;
    lastIndices = indicesData; lastIntraday = intradayData;
    const all = indicesData && indicesData.indices || [];
    if (!Array.isArray(indexSelection) && all.length) indexSelection = all.map(item => item.key);
    html('homeIndexChoices', all.map(item => '<label><input type="checkbox" data-home-index="' + escape(item.key) + '" ' + (indexSelection.includes(item.key) ? 'checked' : '') + '> ' + escape(item.name) + '</label>').join(''));
    const indices = all.filter(item => (indexSelection || []).includes(item.key));
    const series = intradayData && intradayData.series || [];
    const signature = JSON.stringify([indices, series, root.document.body.classList.contains('dark')]);
    if (indicesSignature === signature) return;
    indicesSignature = signature;
    charts.forEach(chart => chart.dispose());
    charts.clear();
    html('homeIndices', indices.length ? indices.map((item, i) => {
      const history = indexHistory(series, item.key);
      const quote = root.MarketComparison.indexCardDisplayQuote(item, history);
      return '<article class="home-panel home-index" data-index-key="' + escape(item.key) + '" role="button" tabindex="0" title="点击查看指数详情"><header><strong>' + escape(item.name || item.code) + '</strong><small>' + escape(item.code) + '</small></header><div class="home-index-value ' + trend(quote.changePct) + '"><b>' + formatNumber(quote.price) + '</b><span>' + pct(quote.changePct) + '</span></div><div id="homeIndexChart' + i + '" class="home-index-chart"></div><small>' + escape(root.MarketComparison.indexCardIntradayStatus(history)) + '</small></article>';
    }).join('') : '<article class="home-panel home-empty">指数行情暂不可用</article>');
    if (!root.echarts) return;
    indices.forEach((item, i) => {
      const history = indexHistory(series, item.key);
      if (!history || history.status !== 'available' || !history.points || !history.points.length) return;
      const node = el('homeIndexChart' + i);
      const chart = root.echarts.init(node);
      const option = root.MarketComparison.buildMiniIntradayOption(history.points, history);
      option.backgroundColor = 'transparent';
      const dark = root.document.body.classList.contains('dark');
      option.series[0].lineStyle = { width: 1.15, color: dark ? '#dce7f2' : '#263f67' };
      chart.setOption(option);
      charts.set(item.key, chart);
    });
  }
  function bind() {
    if (bound || !el('homeChartHost')) return;
    bound = true;
    const globals = el('dashboardGlobalSignals');
    if (globals) el('homeIndicators').after(globals);
    el('marketDrawer')?.appendChild(el('homeWatchPane'));
    ['dashboardIndexDetailOverlay', 'dashboardGlobalDetailOverlay'].forEach(id => {
      const node = el(id); if (!node) return;
      el('homeChartHost').appendChild(node); node.classList.add('home-instrument-chart');
      node.querySelector('[role="dialog"]')?.removeAttribute('aria-modal');
    });
    el('homeGroups').addEventListener('click', event => {
      const button = event.target.closest('[data-home-group]'); if (!button) return;
      groupKey = button.dataset.homeGroup;
      search();
    });
    root.document.addEventListener('click', event => {
      if (event.target.id === 'marketDrawerPin') { setPinned(!pinned); return; }
      const tab = event.target.closest('[data-browser-tab]');
      if (tab) { browserTab = tab.dataset.browserTab; syncBrowser(root.State.currentMainView); root.document.querySelectorAll('[data-browser-tab]').forEach(button => button.setAttribute('aria-pressed', String(button === tab))); }
      const stock = event.target.closest('[data-home-stock]');
      const page = event.target.closest('[data-home-page]');
      if (stock) select(stock.dataset.homeStock).catch(error => { el('homeWatchStatus').textContent = error.message; });
      if (page) root.switchMainView(page.dataset.homePage);
    });
    root.document.addEventListener('change', event => {
      const key = event.target.dataset.homeIndex; if (!key) return;
      indexSelection = event.target.checked ? [...new Set(indexSelection.concat(key))] : indexSelection.filter(id => id !== key);
      try { root.localStorage.setItem('webstock-home-indices', JSON.stringify(indexSelection)); } catch (_) {}
      renderIndices(lastIndices, lastIntraday);
    });
    el('homeWatchSearch').addEventListener('input', search);
    el('searchInput')?.addEventListener('input', event => {
      if (!event.target.value.trim()) return;
      groupKey = ':market'; browserTab = 'stocks';
      el('homeWatchSearch').value = event.target.value;
      syncBrowser(root.State.currentMainView); search();
    });
    el('homeLoadMore')?.addEventListener('click', () => { rowLimit += 60; renderWatchlist(); });
    el('homeAddWatchlist')?.addEventListener('click', async () => {
      if (!root.State.currentStock) return;
      try { await root.Watchlist.addStock(root.State.currentStock); renderWatchlist(); }
      catch(error) { el('homeWatchStatus').textContent = '加入自选失败：' + error.message; }
    });
    el('homeManageWatchlist').addEventListener('click', () => root.switchMainView('watchlist'));
    el('homeMarketMore').addEventListener('toggle', () => {
      if (root.MarketComparison) root.MarketComparison.resize();
      if (root.VolumePace) root.VolumePace.resize();
    });
    el('homeStockMore').addEventListener('toggle', () => {
      if (root.EastmoneyDarkStocks) root.EastmoneyDarkStocks.sync();
    });
    sync(root.State.currentMainView || 'dashboard');
    root.addEventListener('resize', resize);
  }

  return { bind, sync, resize, renderWatchlist, renderMarket, renderVolume, renderIndices, ensureSelection, isChartView, rankBoards, formatNumber, indexHistory, groupItems, browserGroups, sentimentBand, setPinned, activateInstrument, closeInstrument, isDocked: () => pinned && root.State.currentMainView === 'dashboard' };
});
