(function(root) {
  let snapshot = null;
  let loadedAt = 0;
  let loadingPromise = null;
  let bound = false;
  let loadSequence = 0;
  let indexHistorySequence = 0;
  const CACHE_MS = 60 * 1000;

  function currentIndexWindow() {
    return root.MarketComparison && typeof root.MarketComparison.getSelectedWindow === 'function'
      ? root.MarketComparison.getSelectedWindow() : 60;
  }

  function setIndexHistory(history) {
    if (!history || !history.window) return;
    indexHistorySequence += 1;
    snapshot = snapshot || {};
    snapshot.indexHistory = history;
  }

  function finiteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function summarizeSectorFlows(boards) {
    const items = Array.isArray(boards) ? boards : [];
    const groups = groupBoardsByType(items);
    function summary(group) {
      const values = group.filter(function(item) { return finiteNumber(item && item.mainNetInflow) !== null; });
      return {
        availableCount: values.length,
        totalCount: group.length,
        leaders: values.slice().sort(function(a, b) {
          return Number(b.mainNetInflow) - Number(a.mainNetInflow);
        })
      };
    }
    return {
      industry: summary(groups.industry),
      concept: summary(groups.concept),
      totalCount: items.length,
      unclassifiedCount: items.length - groups.industry.length - groups.concept.length
    };
  }

  function summarizeMarketVolume(indexHistory) {
    const series = indexHistory && Array.isArray(indexHistory.series) ? indexHistory.series : [];
    const required = ['sse', 'szse'].map(function(key) {
      return series.find(function(item) { return item && item.key === key && item.status === 'available'; });
    });
    if (required.some(function(item) { return !item; })) {
      return { available: false, reason: '上证与深证指数成交量未同时可用' };
    }
    const maps = required.map(function(item) {
      const byDate = new Map();
      (Array.isArray(item.points) ? item.points : []).forEach(function(point) {
        const volume = finiteNumber(point && point.volume);
        const date = String(point && point.date || '');
        if (/^\d{4}-\d{2}-\d{2}$/.test(date) && volume !== null && volume >= 0) byDate.set(date, volume);
      });
      return byDate;
    });
    const dates = Array.from(maps[0].keys()).filter(function(date) { return maps[1].has(date); }).sort();
    const values = dates.map(function(date) { return maps[0].get(date) + maps[1].get(date); });
    if (values.length < 6) return { available: false, reason: '成交量历史少于6个共同交易日' };
    const latest = values[values.length - 1];
    const previousFive = values.slice(-6, -1);
    const average5 = previousFive.reduce(function(total, value) { return total + value; }, 0) / previousFive.length;
    if (!Number.isFinite(average5) || average5 <= 0) return { available: false, reason: '5日均量无法计算' };
    const ratio = latest / average5;
    return {
      available: true,
      date: dates[dates.length - 1],
      latest,
      average5,
      ratio,
      state: ratio >= 1.2 ? '放量' : (ratio <= 0.8 ? '缩量' : '平量'),
      sourceLabel: '上证与深证公开指数成交量合计'
    };
  }

  function rankBoards(boards, limit) {
    const items = Array.isArray(boards) ? boards.slice() : [];
    const count = Math.max(1, Number(limit) || 5);
    const withChange = items.filter(item => finiteNumber(item && item.dailyChangePct) !== null);
    const withFlow = items.filter(item => finiteNumber(item && item.mainNetInflow) !== null);
    return {
      gainers: withChange.slice().sort((a, b) => Number(b.dailyChangePct) - Number(a.dailyChangePct)).slice(0, count),
      laggards: withChange.slice().sort((a, b) => Number(a.dailyChangePct) - Number(b.dailyChangePct)).slice(0, count),
      flowLeaders: withFlow.slice().sort((a, b) => Number(b.mainNetInflow) - Number(a.mainNetInflow)).slice(0, count)
    };
  }

  function groupBoardsByType(boards) {
    const items = Array.isArray(boards) ? boards : [];
    return {
      industry: items.filter(function(item) {
        return item && (item.kind === 'industry' || item.kind === 'sina-industry');
      }),
      concept: items.filter(function(item) {
        return item && item.kind === 'concept';
      })
    };
  }

  function formatPct(value) {
    const number = finiteNumber(value);
    return number === null ? '--' : (number > 0 ? '+' : '') + number.toFixed(2) + '%';
  }

  function formatRatioPct(value) {
    const number = finiteNumber(value);
    return number === null ? '--' : number.toFixed(2) + '%';
  }

  function formatPoint(value) {
    const number = finiteNumber(value);
    if (number === null) return '--';
    return number.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatYi(value) {
    const number = finiteNumber(value);
    if (number === null) return '--';
    return (number / 100000000).toFixed(2) + '亿';
  }

  function formatCount(value) {
    const number = finiteNumber(value);
    return number === null ? '--' : number.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
  }

  function trendClass(value) {
    const number = finiteNumber(value);
    if (number === null || number === 0) return 'market-flat';
    return number > 0 ? 'pnl-up' : 'pnl-down';
  }

  function renderIndices(data) {
    const box = document.getElementById('marketIndexGrid');
    if (!box) return;
    const indices = data && Array.isArray(data.indices) ? data.indices : [];
    if (!indices.length) {
      box.innerHTML = '<div class="market-overview-empty">指数行情暂不可用，其他市场数据仍可查看。</div>';
      return;
    }
    box.innerHTML = indices.map(function(item) {
      return '<article class="market-index-card">' +
        '<div><strong>' + escapeHtml(item.name) + '</strong><span>' + escapeHtml(item.code) + '</span></div>' +
        '<b>' + formatPoint(item.price) + '</b>' +
        '<em class="' + trendClass(item.changePct) + '">' + formatPct(item.changePct) + '</em>' +
        '<small>成交额 ' + formatYi(item.amount) + '</small>' +
      '</article>';
    }).join('');
  }

  function renderBreadth(data) {
    const box = document.getElementById('marketBreadthPanel');
    if (!box) return;
    const aShare = data && data.aShare || null;
    if (!aShare) {
      box.innerHTML = '<div class="market-overview-empty">市场宽度暂不可用。</div>';
      return;
    }
    const sourceWarning = aShare.sourceStatus === 'fallback'
      ? '<p class="market-source-warning">当前是内置测试样本，不作为实时盘面判断。</p>' : '';
    box.innerHTML = '<div class="market-breadth-score">' +
      '<strong>' + formatCount(aShare.score) + '</strong><span>' + escapeHtml(aShare.label || '状态暂不可用') + '</span>' +
    '</div><div class="market-breadth-lines">' +
      '<p><span>上涨 / 下跌 / 样本</span><b><i class="pnl-up">' + formatCount(aShare.advancing) + '</i> / <i class="pnl-down">' + formatCount(aShare.declining) + '</i> / ' + formatCount(aShare.total) + '</b></p>' +
      '<p><span>上涨家数占比</span><b>' + formatRatioPct(aShare.breadthPct) + '</b></p>' +
      '<p><span>样本平均涨跌</span><b class="' + trendClass(aShare.avgChangePct) + '">' + formatPct(aShare.avgChangePct) + '</b></p>' +
      '<p><span>大涨 / 大跌样本</span><b>' + formatCount(aShare.strongCount) + ' / ' + formatCount(aShare.weakCount) + '</b></p>' +
    '</div>' + sourceWarning + '<small>来源：' + escapeHtml(aShare.source || '--') + '</small>';
  }

  function flowRanking(title, boards, unavailableText) {
    const rows = rankBoards(boards, 5).flowLeaders;
    return '<section><h4>' + escapeHtml(title) + '</h4>' + (rows.length
      ? '<ol>' + rows.map(item => boardRow(item, item.mainNetInflow, formatYi)).join('') + '</ol>'
      : '<div class="market-sector-unavailable">' + escapeHtml(unavailableText) + '</div>') + '</section>';
  }

  function renderFlow(hotData, indexData) {
    const box = document.getElementById('marketFlowPanel');
    if (!box) return;
    const boards = hotData && hotData.boards && Array.isArray(hotData.boards.day) ? hotData.boards.day : [];
    const groups = groupBoardsByType(boards);
    const turnover = indexData && indexData.turnover || {};
    box.innerHTML = '<div class="market-turnover-line"><span>沪深成交额</span><strong>' + formatYi(turnover.total) + '</strong></div>' +
      '<div class="market-sector-columns market-flow-rankings">' +
        flowRanking('行业资金净额靠前', groups.industry, '行业板块资金净额暂不可用。') +
        flowRanking('概念资金净额靠前', groups.concept, '概念板块资金净额暂不可用。') +
      '</div>' +
      '<p class="market-flow-boundary">行业与概念按供应商分类口径分别排序，不跨类型相加；该数据不是全市场总流入/总流出，也不是交易所逐笔资金真值。</p>';
  }

  function boardRow(item, metric, formatter) {
    return '<li><div><strong>' + escapeHtml(item.name || item.code) + '</strong><span>' + escapeHtml(item.leaderName || '') + '</span></div>' +
      '<b class="' + trendClass(metric) + '">' + formatter(metric) + '</b></li>';
  }

  function renderSectors(hotData) {
    const box = document.getElementById('marketSectorPanel');
    if (!box) return;
    const boards = hotData && hotData.boards && Array.isArray(hotData.boards.day) ? hotData.boards.day : [];
    if (!boards.length || hotData.marketStatus === 'unavailable') {
      box.innerHTML = '<div class="market-overview-empty">外部板块行情暂不可用；本地观察分组不会冒充今日市场热点。</div>';
      return;
    }
    const groups = groupBoardsByType(boards);
    const industry = rankBoards(groups.industry, 5);
    const concept = rankBoards(groups.concept, 5);
    function changeRanking(title, items, emptyText) {
      return '<section><h4>' + title + '</h4>' + (items.length
        ? '<ol>' + items.map(item => boardRow(item, item.dailyChangePct, formatPct)).join('') + '</ol>'
        : '<div class="market-sector-unavailable">' + emptyText + '</div>') + '</section>';
    }
    box.innerHTML = changeRanking('行业领涨', industry.gainers, '行业板块涨跌排行暂不可用。') +
      changeRanking('行业涨幅靠后', industry.laggards, '行业板块涨跌排行暂不可用。') +
      changeRanking('概念领涨', concept.gainers, '概念板块涨跌排行暂不可用。') +
      changeRanking('概念涨幅靠后', concept.laggards, '概念板块涨跌排行暂不可用。');
  }

  function hasCompleteBreadth(data) {
    const aShare = data && data.aShare;
    if (!aShare || aShare.sourceStatus === 'fallback') return false;
    return ['score', 'advancing', 'declining', 'total', 'breadthPct', 'avgChangePct', 'strongCount', 'weakCount']
      .every(function(key) { return finiteNumber(aShare[key]) !== null; });
  }

  function hasFlowForEachBoardType(hotData) {
    const boards = hotData && hotData.boards && Array.isArray(hotData.boards.day) ? hotData.boards.day : [];
    const groups = groupBoardsByType(boards);
    return groups.industry.length > 0 && groups.concept.length > 0 &&
      groups.industry.every(item => finiteNumber(item.mainNetInflow) !== null) &&
      groups.concept.every(item => finiteNumber(item.mainNetInflow) !== null);
  }

  function hasCompleteIndices(data) {
    const indices = data && Array.isArray(data.indices) ? data.indices : [];
    return indices.length >= 8
      && indices.every(function(item) {
        return finiteNumber(item.price) !== null
          && finiteNumber(item.changePct) !== null
          && finiteNumber(item.amount) !== null;
      })
      && finiteNumber(data && data.turnover && data.turnover.total) !== null;
  }

  function hasCompleteBoardChanges(hotData) {
    const boards = hotData && hotData.boards && Array.isArray(hotData.boards.day) ? hotData.boards.day : [];
    const groups = groupBoardsByType(boards);
    return groups.industry.length > 0
      && groups.concept.length > 0
      && groups.industry.length + groups.concept.length === boards.length
      && boards.every(function(item) { return finiteNumber(item.dailyChangePct) !== null; });
  }

  function isPartialSnapshot(results) {
    const failures = (results || []).some(item => item.status === 'rejected');
    const hotData = snapshot && snapshot.hot;
    return failures ||
      !hasCompleteIndices(snapshot && snapshot.indices) ||
      !hasCompleteBreadth(snapshot && snapshot.sentiment) ||
      !hotData || hotData.marketStatus !== 'available' || Boolean(hotData.degraded) ||
      !hasCompleteBoardChanges(hotData) ||
      !hasFlowForEachBoardType(hotData);
  }

  function renderStatus(results) {
    const status = document.getElementById('marketOverviewStatus');
    const source = document.getElementById('marketOverviewSources');
    if (!status || !source) return;
    const partial = isPartialSnapshot(results);
    status.textContent = partial ? '部分数据不可用，其余内容已更新' : '市场总览已更新';
    status.dataset.state = partial ? 'partial' : 'ready';
    const sources = [];
    if (snapshot.indices && snapshot.indices.source) sources.push(snapshot.indices.source.label);
    if (snapshot.sentiment && snapshot.sentiment.aShare) sources.push(snapshot.sentiment.aShare.source);
    if (snapshot.hot && Array.isArray(snapshot.hot.sources)) sources.push.apply(sources, snapshot.hot.sources);
    source.textContent = '来源：' + (sources.filter(Boolean).filter((item, index, list) => list.indexOf(item) === index).join(' · ') || '--');
  }

  async function load(options) {
    options = options || {};
    if (loadingPromise && !options.refresh) return loadingPromise;
    const indexWindow = currentIndexWindow();
    if (snapshot && snapshot.indexHistory && Number(snapshot.indexHistory.window) === indexWindow &&
        !options.refresh && Date.now() - loadedAt < CACHE_MS) return snapshot;
    const requestId = ++loadSequence;
    const refresh = options.refresh ? '?refresh=1' : '';
    const status = typeof document !== 'undefined' && document.getElementById('marketOverviewStatus');
    if (status) {
      status.textContent = '正在更新指数、资金和板块…';
      status.dataset.state = 'loading';
    }
    const historySequenceAtStart = indexHistorySequence;
    const indicesRequest = root.ApiClient.fetchJsonData('/api/market/indices').then(function(value) {
      if (requestId !== loadSequence) return value;
      snapshot = Object.assign({}, snapshot || {}, { indices: value });
      renderIndices(value);
      if (root.Dashboard && typeof root.Dashboard.renderMarketCockpit === 'function') {
        root.Dashboard.renderMarketCockpit(snapshot);
      }
      return value;
    });
    const request = Promise.allSettled([
      indicesRequest,
      root.ApiClient.fetchJsonData('/api/sentiment/overview' + refresh),
      root.ApiClient.fetchJsonData('/api/hot-market/overview?fast=1' + (options.refresh ? '&refresh=1' : '')),
      root.ApiClient.fetchJsonData('/api/market/index-history?window=' + indexWindow)
    ]).then(function(results) {
      if (requestId !== loadSequence) return snapshot;
      const preserveNewerHistory = indexHistorySequence !== historySequenceAtStart ||
        currentIndexWindow() !== indexWindow;
      const latestHistory = preserveNewerHistory && snapshot && snapshot.indexHistory
        ? snapshot.indexHistory
        : (results[3].status === 'fulfilled' ? results[3].value : null);
      snapshot = Object.assign({}, snapshot || {}, {
        indices: results[0].status === 'fulfilled' ? results[0].value : null,
        sentiment: results[1].status === 'fulfilled' ? results[1].value : null,
        hot: results[2].status === 'fulfilled' ? results[2].value : null,
        indexHistory: latestHistory
      });
      loadedAt = Date.now();
      renderIndices(snapshot.indices);
      renderBreadth(snapshot.sentiment);
      renderFlow(snapshot.hot, snapshot.indices);
      renderSectors(snapshot.hot);
      renderStatus(results);
      return snapshot;
    }).finally(function() {
      if (loadingPromise === request) loadingPromise = null;
    });
    loadingPromise = request;
    return request;
  }

  function showOverview(options) {
    const view = typeof document !== 'undefined' && document.getElementById('marketView');
    if (view) view.dataset.marketMode = 'overview';
    if (root.HotMarket && typeof root.HotMarket.syncSearchMode === 'function') root.HotMarket.syncSearchMode();
    return load(options).catch(function(error) {
      const status = document.getElementById('marketOverviewStatus');
      if (status) {
        status.textContent = error.message || '市场总览加载失败';
        status.dataset.state = 'error';
      }
      throw error;
    });
  }

  function showDetail() {
    const view = typeof document !== 'undefined' && document.getElementById('marketView');
    if (view) view.dataset.marketMode = 'detail';
    if (root.HotMarket && typeof root.HotMarket.syncSearchMode === 'function') root.HotMarket.syncSearchMode();
  }

  function isDetail() {
    const view = typeof document !== 'undefined' && document.getElementById('marketView');
    return Boolean(view && view.dataset.marketMode === 'detail');
  }

  function bind() {
    if (bound || typeof document === 'undefined') return;
    bound = true;
    const refresh = document.getElementById('refreshMarketOverviewBtn');
    const back = document.getElementById('backToMarketOverviewBtn');
    const sectors = document.getElementById('openMarketSectorsBtn');
    const flow = document.getElementById('openMarketFlowBtn');
    if (refresh) refresh.addEventListener('click', function() { showOverview({ refresh: true }).catch(error => alert(error.message)); });
    if (back) back.addEventListener('click', function() {
      if (root.switchMainView) root.switchMainView('dashboard');
    });
    if (sectors) sectors.addEventListener('click', function() { if (root.switchMainView) root.switchMainView('sectors'); });
    if (flow) flow.addEventListener('click', function() { if (root.switchMainView) root.switchMainView('capitalFlow'); });
  }

  const api = { summarizeSectorFlows, summarizeMarketVolume, rankBoards, groupBoardsByType, load, setIndexHistory, showOverview, showDetail, isDetail, bind };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MarketOverview = api;
})(typeof window !== 'undefined' ? window : globalThis);
