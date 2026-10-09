(function(root) {
  'use strict';
  const prefs = root.MarketBoardPreferences;
  const el = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const time = value => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '来源未提供';
  const format = (value, digits = 2) => value == null ? '—' : Number(value).toFixed(digits);
  const percent = value => value == null ? '—' : (value > 0 ? '+' : '') + format(value) + '%';
  let selection = prefs.normalize(prefs.read(prefs.storageKey, localStorage)), catalog = [], items = [], bound = false;
  let timer, pending, generation = 0, chart, detailKey = '', period = 'intraday', detailRequest = 0, dailyItem;
  let renderedBox, detailSignature = '', lastDetailItem = null;
  // Compare our last input, not browser-normalized innerHTML (checked="", SVG, etc.).
  const renderedHtml = new WeakMap();
  function html(id, value) {
    const node = el(id);
    if (node && renderedHtml.get(node) !== value) { node.innerHTML = value; renderedHtml.set(node, value); }
  }
  function save() {
    try { localStorage.setItem(prefs.storageKey, JSON.stringify(selection)); }
    catch (_) { el('marketBoardStatus').textContent = '设置未保存：本地存储不可用'; }
  }
  function choices() {
    return catalog.map(item => '<label><input type="checkbox" data-board-key="' + escape(item.key) + '" ' + (selection.keys.includes(item.key) ? 'checked' : '') + '> ' + escape(item.name) + ' <small>' + escape(item.group) + '</small></label>').join('');
  }
  function render() {
    const box = el('dashboardGlobalSignals'); if (!box) return;
    if (renderedBox !== box) {
      box.innerHTML = '<div class="market-board-toolbar"><strong>跨市场盯盘</strong><span id="marketBoardStatus">1分钟数据 · 30秒检查 · 北京时间</span><button type="button" id="marketBoardWidget">桌面挂件</button></div>' +
        '<details id="marketBoardChoices" class="market-board-choices"><summary id="marketBoardSelectionCount"></summary><div id="marketBoardChoiceList"></div>' +
        '<button type="button" id="marketBoardDefaults">恢复默认</button><button type="button" id="marketBoardNone">隐藏全部</button><p id="marketBoardOrder"></p></details>' +
        '<div id="marketBoardCards" style="display:contents"></div>' +
        '<p class="dashboard-global-signals-note">公开源延迟未保证；缺口保留。点击卡片查看分时 / 日 K。指数、CFD、汇率分别标识。</p>';
      renderedBox = box;
    }
    html('marketBoardSelectionCount', '展示设置 · 已选 ' + selection.keys.length + ' 项');
    html('marketBoardChoiceList', choices());
    html('marketBoardOrder', '显示顺序：' + selection.keys.map((key, i) => '<button type="button" data-board-up="' + escape(key) + '" title="点击向前移动">' + (i + 1) + '. ' + escape(catalog.find(row => row.key === key)?.name || key) + ' ↑</button>').join(''));
    html('marketBoardCards', items.length ? items.map(item => '<article class="dashboard-global-signal" role="button" tabindex="0" data-board-open="' + escape(item.key) + '" data-direction="' + (item.changePct > 0 ? 'up' : item.changePct < 0 ? 'down' : 'flat') + '">' +
        '<header><strong>' + escape(item.name) + '</strong><small>' + escape(item.group) + '</small></header><div><b>' + format(item.value, item.digits) + '</b><span>' + percent(item.changePct) + '</span></div>' +
        prefs.spark(item.points) + '<p title="' + escape(item.source + ' · ' + (item.note || '') + ' · ' + (item.reason || '')) + '">' +
        escape(['unavailable', 'loading'].includes(item.status) ? item.reason : (item.status === 'cached' ? '缓存 · ' : '') + time(item.observedAt)) + '</p></article>').join('') : '<p class="dashboard-global-signals-note">' + (selection.keys.length ? '正在获取所选行情…' : '已隐藏全部；可在展示设置中重新选择。') + '</p>');
  }
  function schedule(delay) {
    timer = setTimeout(() => { if (!document.hidden) load(); else schedule(30000); }, delay);
  }
  async function load() {
    bind();
    if (pending) return pending;
    clearTimeout(timer);
    const current = generation;
    pending = root.ApiClient.fetchJsonData('/api/market/global-board?keys=' + encodeURIComponent(selection.keys.join(',')), { maxRetries: 0 }).then(data => {
      if (current !== generation) return data;
      catalog = data.catalog || catalog; selection = prefs.normalize(selection, catalog.map(row => row.key));
      items = data.items || []; render();
      if (el('marketBoardStatus')) el('marketBoardStatus').textContent = '1分钟数据 · 30秒检查 · 北京时间';
      if (detailKey && period === 'intraday') drawDetail(items.find(row => row.key === detailKey));
      return data;
    }).catch(error => {
      if (current === generation && el('marketBoardStatus')) el('marketBoardStatus').textContent = '刷新失败，保留上次结果 · ' + error.message;
    }).finally(() => {
      pending = null;
      schedule(current !== generation ? 0 : items.some(row => row.status === 'loading') ? 2000 : 30000);
    });
    return pending;
  }
  function changeSelection() { generation++; save(); items = selection.keys.map(key => items.find(row => row.key === key)).filter(Boolean); render(); load(); }
  function minuteOption(item) {
    const points = item.points || [];
    return { animation: false, grid: { left: 76, right: 30, top: 30, bottom: 60 },
      tooltip: { trigger: 'axis', formatter: params => { const row = points[params?.[0]?.dataIndex]; return row ? time(row.time) + '<br>价格 ' + format(row.close, item.digits) : ''; } },
      xAxis: { type: 'category', boundaryGap: false, data: points.map(row => time(row.time)), axisLabel: { formatter: value => value.split(' ').at(-1)?.slice(0, 5) || value } },
      yAxis: { type: 'value', scale: true }, dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 10 }],
      series: [{ name: item.name, type: 'line', data: points.map(row => row.close), showSymbol: false, connectNulls: false, lineStyle: { width: 1.2 },
        markLine: item.previousClose > 0 ? { silent: true, symbol: 'none', data: [{ yAxis: item.previousClose, name: '前收' }], label: { formatter: '前收 {c}' } } : undefined }] };
  }
  function drawDetail(item) {
    if (!detailKey || !item || item.key !== detailKey) return;
    const hasPoints = value => period === 'daily' ? value.candles?.length : value.points?.some(point => point.close != null);
    if (!hasPoints(item) && lastDetailItem && lastDetailItem.key === item.key &&
        lastDetailItem.source === item.source && lastDetailItem.sessionDate === item.sessionDate) {
      item = { ...lastDetailItem, status: 'cached', reason: item.reason || '本次尚无有效数据，保留上次结果' };
    }
    const node = el('dashboardGlobalDetailChart');
    el('dashboardGlobalDetailTitle').textContent = item.name;
    el('dashboardGlobalDetailMeta').textContent = format(item.value, item.digits) + ' · ' + percent(item.changePct) + ' · 数据 ' + (period === 'daily' ? item.observedAt || '未提供' : time(item.observedAt));
    el('dashboardGlobalDetailSource').textContent = (item.source || '暂无来源') + ' · ' + (period === 'intraday' ? '交易日 ' + (item.sessionDate || '未提供') + ' · ' + (item.points?.filter(p => p.close != null).length || 0) + ' 个有效分钟点 · ' + (item.note || '') : '日 K · ' + (item.candles?.[0]?.date || '—') + ' 至 ' + (item.candles?.at(-1)?.date || '—')) +
      ' · 取数 ' + time(item.fetchedAt) + (item.status === 'cached' ? ' · 刷新失败，保留缓存' : '') + (item.reason ? ' · ' + item.reason : '');
    const link = el('dashboardGlobalDetailLink'); link.hidden = !/^https:\/\//.test(item.sourceUrl || ''); if (!link.hidden) link.href = item.sourceUrl;
    el('marketBoardPeriods').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.boardPeriod === period)));
    if (!hasPoints(item)) {
      chart?.dispose(); chart = null; detailSignature = ''; lastDetailItem = null; node.textContent = '该周期暂无可用数据；请稍后重试或切换周期。'; return;
    }
    lastDetailItem = item;
    const dark = document.body.classList.contains('dark');
    const signature = JSON.stringify([period, dark, item.key, item.source, item.sessionDate, item.name,
      item.digits, item.previousClose, period === 'daily' ? item.candles : item.points]);
    if (chart && signature === detailSignature) return;
    node.querySelector('.dashboard-market-unavailable')?.remove();
    if (!chart) { node.textContent = ''; chart = root.echarts.init(node); }
    const option = period === 'daily' ? root.MarketComparison.buildGlobalKlineOption(item) : minuteOption(item);
    root.ChartTheme?.applyToOption(option, { dark });
    if (root.ChartTheme?.renderTo) chart = root.ChartTheme.renderTo(root.echarts, node, chart, option, 'board:' + detailKey + ':' + period + ':' + (item.sessionDate || '') + ':' + (item.source || ''));
    else chart.setOption(option, true);
    detailSignature = signature;
    chart.resize();
  }
  async function open(key, nextPeriod = 'intraday') {
    bind(); detailKey = key; period = nextPeriod; const request = ++detailRequest;
    detailSignature = ''; lastDetailItem = null;
    el('dashboardGlobalDetailOverlay').style.display = 'grid';
    const cached = nextPeriod === 'intraday' ? items.find(row => row.key === key) : dailyItem?.key === key ? dailyItem : null;
    if (chart) { chart.dispose(); chart = null; }
    el('dashboardGlobalDetailChart').textContent = '正在读取' + (nextPeriod === 'daily' ? '日 K' : '分时') + '…';
    el('dashboardGlobalDetailTitle').textContent = catalog.find(row => row.key === key)?.name || key;
    el('dashboardGlobalDetailSource').textContent = '正在读取所选周期…';
    if (cached) drawDetail(cached);
    try {
      const item = await root.ApiClient.fetchJsonData('/api/market/global-board/' + encodeURIComponent(key) + '?period=' + nextPeriod, { maxRetries: 0 });
      if (request !== detailRequest || detailKey !== key) return;
      if (nextPeriod === 'daily') dailyItem = item;
      drawDetail(item);
    } catch (error) { if (request === detailRequest) el('dashboardGlobalDetailSource').textContent = '读取失败：' + error.message; }
  }
  function close() { detailRequest++; detailKey = ''; chart?.dispose(); chart = null; detailSignature = ''; lastDetailItem = null; el('dashboardGlobalDetailOverlay').style.display = 'none'; }
  async function toggleWidget() {
    const status = el('marketBoardStatus');
    if (!root.webstockDesktop?.setMarketWidget) { status.textContent = '悬浮挂件需在 Windows 安装版中开启；浏览器不支持系统置顶。'; return; }
    try { const state = await root.webstockDesktop.getMarketWidget(); const next = await root.webstockDesktop.setMarketWidget({ enabled: !state.enabled }); status.textContent = next.enabled ? '桌面挂件已打开，可在小窗内设置内容' : '桌面挂件已关闭'; }
    catch (error) { status.textContent = '挂件操作失败：' + error.message; }
  }
  function bind() {
    if (bound) return; bound = true; render();
    document.addEventListener('click', event => {
      const target = event.target.closest('[data-board-open]'); if (target) open(target.dataset.boardOpen);
      if (event.target.id === 'marketBoardWidget') toggleWidget();
      if (event.target.id === 'marketBoardDefaults') { selection = prefs.normalize(null); changeSelection(); }
      if (event.target.id === 'marketBoardNone') { selection.keys = []; changeSelection(); }
      const up = event.target.closest('[data-board-up]'); if (up) { const i = selection.keys.indexOf(up.dataset.boardUp); if (i > 0) { [selection.keys[i - 1], selection.keys[i]] = [selection.keys[i], selection.keys[i - 1]]; changeSelection(); } }
      if (event.target.dataset.boardPeriod) open(detailKey, event.target.dataset.boardPeriod);
      if (event.target.id === 'dashboardGlobalDetailClose' || event.target.id === 'dashboardGlobalDetailOverlay') close();
    });
    document.addEventListener('change', event => { const key = event.target.dataset.boardKey; if (key) { selection.keys = event.target.checked ? [...selection.keys, key] : selection.keys.filter(k => k !== key); changeSelection(); } });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && detailKey) close(); const card = event.target.closest('[data-board-open]'); if (card && ['Enter', ' '].includes(event.key)) { event.preventDefault(); open(card.dataset.boardOpen); } });
    root.addEventListener('storage', event => { if (event.key === prefs.storageKey) { selection = prefs.normalize(prefs.read(prefs.storageKey, localStorage)); generation++; items = selection.keys.map(key => items.find(row => row.key === key)).filter(Boolean); render(); load(); } });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  }
  root.MarketBoard = { load, open, close, resize: () => chart?.resize(), rerenderTheme: () => { if (detailKey) drawDetail(period === 'daily' ? dailyItem : items.find(row => row.key === detailKey)); } };
})(window);
