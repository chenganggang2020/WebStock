function dashboardMiniChangeClass(value) {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return n >= 0 ? 'pnl-up' : 'pnl-down';
}

function dashboardMiniFmt(value, digits) {
  if (value === null || value === undefined || value === '') return '--';
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits === undefined ? 2 : digits) : '--';
}

function dashboardEscapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function dashboardScoreClass(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return n >= 50 ? 'pnl-up' : 'pnl-down';
}

function dashboardBreadthClass(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return n >= 50 ? 'pnl-up' : 'pnl-down';
}

function dashboardSignedPctHtml(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return '<span class="' + dashboardMiniChangeClass(n) + '">' + (n >= 0 ? '+' : '') + dashboardMiniFmt(n) + '%</span>';
}

function dashboardRiskMetricHtml(item) {
  if (!item || !Number.isFinite(Number(item.metricValue))) return '';
  return '<span class="risk-metric">' + dashboardEscapeHtml(item.metricLabel || '涨跌幅') + ' ' + dashboardSignedPctHtml(item.metricValue) + '</span>';
}

function dashboardWatchlistAlertLabel(item) {
  const price = Number(item.price);
  const high = Number(item.alertHigh);
  const low = Number(item.alertLow);
  if (!Number.isFinite(price)) return '';
  if (Number.isFinite(low) && low > 0 && price <= low) return '<span class="status-danger">Alert low</span>';
  if (Number.isFinite(high) && high > 0 && price >= high) return '<span class="status-warn">Alert high</span>';
  if ((Number.isFinite(low) && low > 0) || (Number.isFinite(high) && high > 0)) return '<span class="status-ok">Alert normal</span>';
  return '';
}

const DASHBOARD_DISMISSED_RISKS_KEY = 'webstock_dismissed_risks';
const DASHBOARD_SENTIMENT_REFRESH_MS = 5 * 60 * 1000;
let dashboardShowDismissedRisks = false;
let dashboardSentimentTimer = null;
let dashboardSelectedRiskKey = '';
let dashboardMarketSnapshot = null;

function dashboardMarketNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function dashboardMarketPoint(value) {
  const number = dashboardMarketNumber(value);
  return number === null
    ? '暂无'
    : number.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dashboardMarketPct(value) {
  const number = dashboardMarketNumber(value);
  return number === null ? '暂无' : (number > 0 ? '+' : '') + number.toFixed(2) + '%';
}

function dashboardMarketRatio(value) {
  const number = dashboardMarketNumber(value);
  return number === null ? '暂无' : number.toFixed(2) + '%';
}

function dashboardMarketAmount(value) {
  const number = dashboardMarketNumber(value);
  if (number === null) return '暂无';
  if (Math.abs(number) >= 1000000000000) return (number / 1000000000000).toFixed(2) + '万亿';
  return (number / 100000000).toFixed(2) + '亿';
}

function dashboardMarketCount(value) {
  const number = dashboardMarketNumber(value);
  return number === null ? '暂无' : String(Math.round(number));
}

function dashboardMarketVolume(value) {
  const number = dashboardMarketNumber(value);
  if (number === null) return '暂无';
  return number >= 100000000 ? (number / 100000000).toFixed(2) + '亿' : dashboardMarketCount(number);
}

function dashboardMarketEmpty(message) {
  return '<div class="dashboard-market-unavailable">' + dashboardEscapeHtml(message) + '</div>';
}

function dashboardMarketSourceLabel(value) {
  const labels = {
    'Eastmoney sector rank': '东方财富板块排行（供应商分类）',
    'Eastmoney stock rank': '东方财富个股排行',
    'Sina Finance': '新浪财经资讯',
    'Sina industry rank': '新浪行业排行（降级，无资金字段）',
    'Sina stock rank': '新浪个股排行',
    'Local sector watchlist': '本地观察板块（非实时热点）'
  };
  return labels[String(value || '')] || String(value || '');
}

function dashboardRenderMarketCockpit(snapshot) {
  snapshot = snapshot || {};
  if (window.HomeTerminal) window.HomeTerminal.renderMarket(snapshot);
  const indicesBox = document.getElementById('dashboardMarketIndices');
  const sectorsBox = document.getElementById('dashboardMarketSectors');
  const flowBox = document.getElementById('dashboardMarketFlow');
  const sourcesBox = document.getElementById('dashboardMarketSources');
  const indicesData = snapshot.indices || null;
  const sentimentData = snapshot.sentiment || null;
  const hotData = snapshot.hot || null;
  const indexHistory = snapshot.indexHistory || null;
  const indices = indicesData && Array.isArray(indicesData.indices) ? indicesData.indices : [];
  const aShare = sentimentData && sentimentData.aShare || null;
  const boards = hotData && hotData.boards && Array.isArray(hotData.boards.day) ? hotData.boards.day : [];
  const boardGroups = window.MarketOverview && window.MarketOverview.groupBoardsByType
    ? window.MarketOverview.groupBoardsByType(boards)
    : {
        industry: boards.filter(function(item) { return item && (item.kind === 'industry' || item.kind === 'sina-industry'); }),
        concept: boards.filter(function(item) { return item && item.kind === 'concept'; })
      };

  if (Object.prototype.hasOwnProperty.call(snapshot, 'sentiment')) {
    window.State.marketSentiment = sentimentData;
    dashboardRenderSentiment();
  }

  if (indicesBox && !(window.MarketComparison && typeof window.MarketComparison.render === 'function')) {
    indicesBox.innerHTML = indices.length ? indices.slice(0, 8).map(function(item) {
      const change = dashboardMarketNumber(item.changePct);
      return '<article class="dashboard-market-index">' +
        '<div><strong>' + dashboardEscapeHtml(item.name || item.code) + '</strong><span>' + dashboardEscapeHtml(item.code || '') + '</span></div>' +
        '<b>' + dashboardMarketPoint(item.price) + '</b>' +
        '<em class="' + (change === null ? '' : dashboardMiniChangeClass(change)) + '">' + dashboardMarketPct(change) + '</em>' +
        '<small>成交额 ' + dashboardMarketAmount(item.amount) + '</small>' +
      '</article>';
    }).join('') : dashboardMarketEmpty('主要指数行情暂不可用，其他模块仍可查看。');
  }

  if (sectorsBox && !document.getElementById('dashboardMarketHeatmap')) {
    if (!boards.length || hotData && hotData.marketStatus === 'unavailable') {
      sectorsBox.innerHTML = dashboardMarketEmpty('外部板块行情暂不可用；本地观察分组不会冒充今日热点。');
    } else {
      const rank = function(items) {
        return window.MarketOverview && window.MarketOverview.rankBoards
          ? window.MarketOverview.rankBoards(items, 3)
          : { gainers: [], laggards: [], flowLeaders: [] };
      };
      const industryRanked = rank(boardGroups.industry);
      const conceptRanked = rank(boardGroups.concept);
      const rows = function(items, label, emptyText) {
        if (!items.length) return '<section><h5>' + label + '</h5>' + dashboardMarketEmpty(emptyText) + '</section>';
        return '<section><h5>' + label + '</h5><ol>' + items.map(function(item) {
          return '<li><span>' + dashboardEscapeHtml(item.name || item.code) + '</span><b class="' + dashboardMiniChangeClass(item.dailyChangePct) + '">' + dashboardMarketPct(item.dailyChangePct) + '</b></li>';
        }).join('') + '</ol></section>';
      };
      sectorsBox.innerHTML = '<div class="dashboard-market-sector-columns">' +
        rows(industryRanked.gainers, '行业领涨', '行业排行暂不可用') +
        rows(industryRanked.laggards, '行业靠后', '行业排行暂不可用') +
        rows(conceptRanked.gainers, '概念领涨', '概念排行暂不可用') +
        rows(conceptRanked.laggards, '概念靠后', '概念排行暂不可用') + '</div>';
    }
  }

  if (flowBox) {
    const flow = window.MarketOverview && window.MarketOverview.summarizeSectorFlows
      ? window.MarketOverview.summarizeSectorFlows(boards)
      : {
          industry: { availableCount: 0, totalCount: boardGroups.industry.length, leaders: [] },
          concept: { availableCount: 0, totalCount: boardGroups.concept.length, leaders: [] }
        };
    const turnover = indicesData && indicesData.turnover || {};
    const volume = window.MarketOverview && window.MarketOverview.summarizeMarketVolume
      ? window.MarketOverview.summarizeMarketVolume(indexHistory)
      : { available: false, reason: '指数成交量历史暂不可用' };
    const flowRows = function(summary, label) {
      const leaders = summary && Array.isArray(summary.leaders) ? summary.leaders.slice(0, 3) : [];
      const unavailableText = label.indexOf('行业') === 0
        ? '行业板块资金净额暂不可用' : '概念板块资金净额暂不可用';
      return '<section><h5>' + label + '</h5>' + (leaders.length
        ? '<ol>' + leaders.map(function(item) {
            return '<li><span>' + dashboardEscapeHtml(item.name || item.code) + '</span><b class="' + dashboardMiniChangeClass(item.mainNetInflow) + '">' + dashboardMarketAmount(item.mainNetInflow) + '</b></li>';
          }).join('') + '</ol>'
        : dashboardMarketEmpty(unavailableText)) + '</section>';
    };
    const flowContent = '<div class="dashboard-market-sector-columns dashboard-market-flow-rankings">' +
      flowRows(flow.industry, '行业供应商资金净额') + flowRows(flow.concept, '概念供应商资金净额') + '</div>';
    const volumeContent = volume.available
      ? '<div class="dashboard-market-volume"><span>量能状态</span><strong>' + dashboardEscapeHtml(volume.state) +
        ' ' + dashboardMarketRatio(volume.ratio * 100) + '</strong><small>最新合计 ' +
        dashboardMarketVolume(volume.latest) + ' · 5日均量 ' + dashboardMarketVolume(volume.average5) +
        '（指数源原始口径） · ' + dashboardEscapeHtml(volume.sourceLabel) + '</small></div>'
      : dashboardMarketEmpty('量能状态暂不可用：' + dashboardEscapeHtml(volume.reason || '历史覆盖不足'));
    flowBox.innerHTML = '<div class="dashboard-market-turnover"><span>沪深成交额</span><strong>' + dashboardMarketAmount(turnover.total) + '</strong></div>' +
      volumeContent +
      flowContent + '<p class="dashboard-market-boundary">行业与概念按供应商口径分别排行，不跨类型相加；不是全市场真实资金流，也不代表机构身份。</p>';
  }

  if (sourcesBox) {
    const sources = [];
    if (indicesData && indicesData.source && indicesData.source.label) sources.push(indicesData.source.label);
    if (indexHistory && indexHistory.source && indexHistory.source.label) sources.push(indexHistory.source.label);
    if (aShare && aShare.source) sources.push(aShare.source);
    if (hotData && Array.isArray(hotData.sources)) sources.push.apply(sources, hotData.sources);
    const uniqueSources = sources.filter(Boolean).map(dashboardMarketSourceLabel)
      .filter(function(item, index, list) { return list.indexOf(item) === index; });
    const observedTimes = [];
    if (indicesData && indicesData.fetchedAt) observedTimes.push('指数行情 ' + dashboardDataTime(indicesData.fetchedAt));
    if (sentimentData && sentimentData.updatedAt) observedTimes.push('市场宽度 ' + dashboardDataTime(sentimentData.updatedAt));
    if (hotData && hotData.generatedAt) observedTimes.push('板块 ' + dashboardDataTime(hotData.generatedAt));
    if (indexHistory && indexHistory.fetchedAt) observedTimes.push('指数历史 ' + dashboardDataTime(indexHistory.fetchedAt));
    const flowSummary = window.MarketOverview && window.MarketOverview.summarizeSectorFlows
      ? window.MarketOverview.summarizeSectorFlows(boards) : null;
    const completeFlow = Boolean(flowSummary
      && flowSummary.industry.totalCount > 0
      && flowSummary.concept.totalCount > 0
      && flowSummary.industry.availableCount === flowSummary.industry.totalCount
      && flowSummary.concept.availableCount === flowSummary.concept.totalCount);
    const completeBreadth = Boolean(aShare
      && aShare.sourceStatus !== 'fallback'
      && ['score', 'advancing', 'declining', 'total', 'breadthPct', 'limitUpLike', 'sharpDown'].every(function(key) {
        return dashboardMarketNumber(aShare[key]) !== null;
      }));
    const completeIndices = indices.length >= 8 && indices.every(function(item) {
      return dashboardMarketNumber(item.price) !== null
        && dashboardMarketNumber(item.changePct) !== null
        && dashboardMarketNumber(item.amount) !== null;
    });
    const completeIndexHistory = Boolean(indexHistory && indexHistory.status === 'available' &&
      indexHistory.comparison && Array.isArray(indexHistory.comparison.dates) &&
      indexHistory.comparison.dates.length === Number(indexHistory.window));
    const completeBoardChanges = boardGroups.industry.length > 0
      && boardGroups.concept.length > 0
      && boardGroups.industry.length + boardGroups.concept.length === boards.length
      && boards.every(function(item) { return dashboardMarketNumber(item.dailyChangePct) !== null; });
    const overviewReady = completeIndices
      && dashboardMarketNumber(indicesData && indicesData.turnover && indicesData.turnover.total) !== null
      && completeIndexHistory
      && completeBreadth
      && hotData && hotData.marketStatus === 'available' && !hotData.degraded
      && completeBoardChanges
      && completeFlow;
    sourcesBox.dataset.state = overviewReady ? 'ready' : 'partial';
    const stateText = overviewReady
      ? '完整'
      : '部分可用（' + (hotData && hotData.degraded ? '板块源降级' : '存在缺失或不可用字段') + '）';
    sourcesBox.textContent = '驾驶舱基础数据来源：' + (uniqueSources.join(' · ') || '当前来源暂不可用') +
      ' · 抓取时间：' + (observedTimes.join('；') || '未记录') +
      ' · 驾驶舱基础数据状态：' + stateText + ' · 板块云图状态见云图图例';
  }
  if (window.MarketComparison && typeof window.MarketComparison.render === 'function') {
    window.MarketComparison.render(snapshot);
  }
}

async function dashboardLoadMarketCockpit(options) {
  options = options || {};
  if (!window.MarketOverview || typeof window.MarketOverview.load !== 'function') {
    dashboardMarketSnapshot = { error: '市场总览模块尚未加载' };
    dashboardRenderMarketCockpit(dashboardMarketSnapshot);
    return dashboardMarketSnapshot;
  }
  dashboardMarketSnapshot = await window.MarketOverview.load({ refresh: Boolean(options.force) });
  dashboardRenderMarketCockpit(dashboardMarketSnapshot);
  return dashboardMarketSnapshot;
}

function dashboardTodayKey() {
  if (window.WebStockTime && window.WebStockTime.todayDate) return window.WebStockTime.todayDate();
  return new Date().toISOString().slice(0, 10);
}

function dashboardRiskStorage() {
  try {
    return JSON.parse(localStorage.getItem(DASHBOARD_DISMISSED_RISKS_KEY) || '{}');
  } catch (error) {
    return {};
  }
}

function dashboardDismissedRiskKeys() {
  const data = dashboardRiskStorage();
  return new Set(data[dashboardTodayKey()] || []);
}

function dashboardDismissRisk(key) {
  const data = dashboardRiskStorage();
  const today = dashboardTodayKey();
  const set = new Set(data[today] || []);
  set.add(key);
  data[today] = Array.from(set);
  localStorage.setItem(DASHBOARD_DISMISSED_RISKS_KEY, JSON.stringify(data));
}

function dashboardRestoreRisk(key) {
  const data = dashboardRiskStorage();
  const today = dashboardTodayKey();
  const set = new Set(data[today] || []);
  set.delete(key);
  data[today] = Array.from(set);
  localStorage.setItem(DASHBOARD_DISMISSED_RISKS_KEY, JSON.stringify(data));
}

async function dashboardLoad(options) {
  options = options || {};
  const tasks = [
    dashboardLoadMarketCockpit(options).catch(function(error) {
      dashboardMarketSnapshot = { error: error && error.message ? error.message : '市场驾驶舱加载失败' };
    })
  ];
  if (window.VolumePace && typeof window.VolumePace.load === 'function') {
    tasks.push(window.VolumePace.load({ refresh: Boolean(options.force) }).catch(function(error) {
      console.warn(error && error.message ? error.message : error);
    }));
  }
  if (options.force && window.MarketComparison && typeof window.MarketComparison.loadHeatmapSnapshot === 'function') {
    tasks.push(window.MarketComparison.loadHeatmapSnapshot({ force: true }).catch(function(error) {
      console.warn(error && error.message ? error.message : error);
    }));
  }
  await Promise.all(tasks);
  dashboardSetUpdatedAt();
  dashboardRefreshCards();
  dashboardStartSentimentAutoRefresh();
}

function dashboardSetUpdatedAt() {
  const target = document.getElementById('dashboardUpdatedAt');
  if (!target) return;
  target.className = 'muted';
  target.textContent = '最后更新：' + (
    window.WebStockTime && window.WebStockTime.formatDateTime
      ? window.WebStockTime.formatDateTime(new Date())
      : new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
  );
}

function dashboardSetRefreshStatus(message, isError) {
  const target = document.getElementById('dashboardUpdatedAt');
  if (!target) return;
  target.className = isError ? 'status-danger' : 'muted';
  target.textContent = message;
}

function dashboardRefreshCards() {
  dashboardRenderMarketCockpit(dashboardMarketSnapshot);
  dashboardRenderSentiment();
}

async function dashboardLoadScreenerReviewSummary() {
  window.State.screenerReviewSummary = await window.apiFetch('/api/screener/review-summary?limit=5');
}

async function dashboardLoadSentiment() {
  window.State.marketSentiment = await window.apiFetch('/api/sentiment/overview');
}

function dashboardDataTime(value) {
  if (!value) return '未记录';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return window.WebStockTime && window.WebStockTime.formatDateTime
    ? window.WebStockTime.formatDateTime(parsed)
    : parsed.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

async function dashboardRefreshSentiment(options) {
  const box = document.getElementById('dashboardSentimentPanel');
  if (box && !(options && options.silent)) {
    box.classList.add('loading-soft');
  }
  try {
    window.State.marketSentiment = await window.apiFetch('/api/sentiment/overview?refresh=1');
    dashboardRenderSentiment();
  } catch (error) {
    if (!(options && options.silent)) alert(error.message || '情绪指标刷新失败');
  } finally {
    if (box) box.classList.remove('loading-soft');
  }
}

function dashboardStartSentimentAutoRefresh() {
  if (dashboardSentimentTimer) return;
  dashboardSentimentTimer = setInterval(function() {
    dashboardRefreshSentiment({ silent: true }).catch(function(error) {
      console.warn(error.message || error);
    });
  }, DASHBOARD_SENTIMENT_REFRESH_MS);
}

function dashboardHideContextMenu() {
  const menu = document.getElementById('stockContextMenu');
  if (menu) menu.style.display = 'none';
}

function dashboardShowSentimentContextMenu(event) {
  const menu = document.getElementById('stockContextMenu');
  if (!menu) return;
  event.preventDefault();
  menu.setAttribute('data-owner', 'dashboard-sentiment');
  menu.innerHTML = '<button data-dashboard-action="refresh-sentiment">刷新情绪指数</button>';
  menu.style.left = Math.min(event.clientX, window.innerWidth - 190) + 'px';
  menu.style.top = Math.min(event.clientY, window.innerHeight - 80) + 'px';
  menu.style.display = 'block';
  setTimeout(function() {
    document.addEventListener('click', dashboardHideContextMenu, { once: true });
  }, 0);
  menu.onclick = function(clickEvent) {
    const btn = clickEvent.target.closest('[data-dashboard-action]');
    if (!btn) return;
    dashboardHideContextMenu();
    if (btn.getAttribute('data-dashboard-action') === 'refresh-sentiment') {
      dashboardRefreshSentiment().catch(function(error) { alert(error.message || '情绪指标刷新失败'); });
    }
  };
}

function dashboardSentimentClass(score) {
  const n = dashboardMarketNumber(score);
  if (!Number.isFinite(n)) return '';
  if (n < 45) return 'fear';
  if (n <= 55) return 'neutral';
  if (n <= 75) return 'greed';
  return 'hot';
}

function dashboardRenderSentiment() {
  const box = document.getElementById('dashboardSentimentPanel');
  if (!box) return;
  const data = window.State.marketSentiment;
  if (!data) {
    box.innerHTML = '<div class="empty-state compact">市场情绪暂不可用</div>';
    return;
  }
  const aShare = data.aShare || {};
  const vix = data.vix || {};
  const total = dashboardMarketNumber(aShare.total);
  const advancing = dashboardMarketNumber(aShare.advancing);
  const declining = dashboardMarketNumber(aShare.declining);
  const flat = total === null || advancing === null || declining === null
    ? null
    : Math.max(0, total - advancing - declining);
  const sourceStatus = aShare.sourceStatus || '';
  const providerNote = sourceStatus === 'unavailable'
    ? '<div class="provider-status">公开行情暂不可用，情绪分与涨跌统计暂停计算；未使用内置样本。可右键重试刷新。</div>'
    : sourceStatus === 'sina'
    ? '<div class="provider-status">东方财富连接受限，已切换为新浪财经跨页抽样估算。情绪指数每 5 分钟自动刷新，可右键手动刷新。</div>'
    : (sourceStatus === 'fallback' ? '<div class="provider-status">外部行情暂不可用，当前为内置样本兜底。情绪指数每 5 分钟自动刷新，可右键手动刷新。</div>' : '<div class="provider-status">情绪指数每 5 分钟自动刷新，可右键手动刷新。</div>');
  box.innerHTML = '<div class="sentiment-layout">' +
    '<div class="sentiment-score ' + dashboardSentimentClass(aShare.score) + '">' +
      '<strong>' + dashboardMiniFmt(aShare.score, 0) + '</strong>' +
      '<span>' + dashboardEscapeHtml(aShare.label || '--') + '</span>' +
      '<em>A股情绪分</em>' +
    '</div>' +
    '<div class="sentiment-details">' +
      '<div class="sentiment-row"><span>上涨家数占比</span><strong>' + dashboardMarketRatio(aShare.breadthPct) + '</strong><em><span class="pnl-up">' + dashboardMarketCount(aShare.advancing) + '</span> / <span class="pnl-down">' + dashboardMarketCount(aShare.declining) + '</span> / ' + dashboardMarketCount(aShare.total) + '</em></div>' +
      '<div class="sentiment-row"><span>平均涨跌幅</span><strong class="' + dashboardMiniChangeClass(aShare.avgChangePct) + '">' + dashboardMarketPct(aShare.avgChangePct) + '</strong><em><span class="pnl-up">强 ' + dashboardMarketCount(aShare.strongCount) + '</span> / <span class="pnl-down">弱 ' + dashboardMarketCount(aShare.weakCount) + '</span></em></div>' +
      '<div class="sentiment-row"><span>极端涨跌</span><strong>平盘 ' + dashboardMarketCount(flat) + '</strong><em><span class="pnl-up">涨停样本 ' + dashboardMarketCount(aShare.limitUpLike) + '</span> / <span class="pnl-down">大跌样本 ' + dashboardMarketCount(aShare.sharpDown) + '</span></em></div>' +
      '<div class="sentiment-row"><span>VIX 美股恐慌指数</span><strong>' + dashboardMiniFmt(vix.value) + '</strong><em>' + dashboardEscapeHtml(vix.label || '--') + ' / ' + dashboardEscapeHtml(vix.date || '--') + '</em></div>' +
    '</div>' +
    '</div>' + providerNote;
  box.oncontextmenu = dashboardShowSentimentContextMenu;
}

function dashboardRenderWatchlist() {
  const box = document.getElementById('dashboardWatchlistList');
  if (!box) return;
  const items = (window.State.watchlist || []).slice(0, 6);
  if (!items.length) {
    box.innerHTML = '<div class="empty-state compact">No watchlist items yet. Use the star button in the stock list to add one.</div>';
    return;
  }
  box.innerHTML = '<table class="mini-table"><tbody>' + items.map(function(item) {
    const change = Number(item.change);
    const changeText = Number.isFinite(change) ? (change >= 0 ? '+' : '') + change.toFixed(2) + '%' : '--';
    const code = dashboardEscapeHtml(item.code || '');
    return '<tr><td>' + code + '</td><td>' + dashboardEscapeHtml(item.name || item.code || '') + '</td><td class="' + dashboardMiniChangeClass(change) + '">' + changeText + '</td><td>' + dashboardWatchlistAlertLabel(item) + '</td><td><button class="small-btn" data-code="' + code + '">View</button></td></tr>';
  }).join('') + '</tbody></table>';
  box.onclick = function(event) {
    const btn = event.target.closest('[data-code]');
    if (!btn) return;
    window.Watchlist.selectStock(btn.getAttribute('data-code'));
  };
}

function dashboardRenderPortfolio() {
  const box = document.getElementById('dashboardPortfolioList');
  if (!box) return;
  const positions = (window.State.positions || []).slice(0, 6);
  const summary = window.State.portfolioSummary || {};
  if (!positions.length) {
    box.innerHTML = '<div class="empty-state compact">No positions yet. Add a trade to calculate P/L.</div>';
    return;
  }
  box.innerHTML = '<div class="dashboard-kpis"><span>Market value ' + dashboardMiniFmt(summary.totalMarketValue) + '</span><span class="' + dashboardMiniChangeClass(summary.totalPnl) + '">P/L ' + dashboardMiniFmt(summary.totalPnl) + '</span></div>' +
    '<table class="mini-table"><tbody>' + positions.map(function(pos) {
      const code = dashboardEscapeHtml(pos.code || '');
      return '<tr><td>' + code + '</td><td>' + dashboardEscapeHtml(pos.name || pos.code || '') + '</td><td>' + dashboardEscapeHtml(pos.quantity) + '</td><td class="' + dashboardMiniChangeClass(pos.unrealizedPnl) + '">' + dashboardMiniFmt(pos.unrealizedPnl) + '</td><td><button class="small-btn" data-code="' + code + '">View</button></td></tr>';
    }).join('') + '</tbody></table>';
  box.onclick = function(event) {
    const btn = event.target.closest('[data-code]');
    if (!btn) return;
    window.Portfolio.selectPositionStock(btn.getAttribute('data-code'));
  };
}

function dashboardRenderScreenerReview() {
  const box = document.getElementById('dashboardScreenerReviewList');
  if (!box) return;
  const items = (window.State.screenerReviewSummary || []).slice(0, 5);
  if (!items.length) {
    box.innerHTML = '<div class="empty-state compact">No saved candidate reviews yet. Run and save a screener task to start tracking.</div>';
    return;
  }
  box.innerHTML = '<table class="mini-table"><tbody>' + items.map(function(item) {
    const counts = item.counts || {};
    return '<tr>' +
      '<td><strong>' + dashboardEscapeHtml(item.taskName || '') + '</strong><div class="muted">' + dashboardEscapeHtml(item.strategy || '') + ' / ' + dashboardEscapeHtml(item.candidateCount) + ' candidates</div></td>' +
      '<td><span class="review-status">priority ' + dashboardEscapeHtml(counts.priority || 0) + '</span></td>' +
      '<td><span class="review-status">risk ' + dashboardEscapeHtml(counts.risk || 0) + '</span></td>' +
      '<td><span class="review-status">todo ' + dashboardEscapeHtml(item.unreviewed) + '</span></td>' +
      '<td><button class="small-btn" data-screener-id="' + dashboardEscapeHtml(item.id || '') + '">Open</button></td>' +
      '</tr>';
  }).join('') + '</tbody></table>';
  box.onclick = function(event) {
    const btn = event.target.closest('[data-screener-id]');
    if (!btn) return;
    const id = btn.getAttribute('data-screener-id');
    window.switchMainView('screener');
    if (window.StockScreener) window.StockScreener.openSavedResult(id, 'details').catch(function(error) { alert(error.message); });
  };
}

function dashboardCollectRisks() {
  const risks = [];
  const settings = window.Settings && window.Settings.getRiskSettings
    ? window.Settings.getRiskSettings()
    : { drawdown: 8, dailyDrop: 3, leaderDrop: 3 };
  const drawdownLimit = -Math.abs(Number(settings.drawdown) || 8);
  const dailyDropLimit = -Math.abs(Number(settings.dailyDrop) || 3);
  const dailyRiseLimit = Math.abs(Number(settings.dailyDrop) || 3);
  const leaderDropLimit = -Math.abs(Number(settings.leaderDrop) || 3);
  const positionCodes = new Set((window.State.positions || []).map(function(pos) { return pos.code; }));

  (window.State.positions || []).forEach(function(pos) {
    const pnlRate = Number(pos.unrealizedPnlRate);
    const todayChange = Number(pos.todayChange);
    if (Number.isFinite(pnlRate) && pnlRate <= drawdownLimit) {
      risks.push({
        key: 'position-drawdown:' + pos.code,
        severity: pnlRate <= drawdownLimit * 1.8 ? 'high' : 'medium',
        code: pos.code,
        title: pos.code + ' 持仓回撤',
        detail: '请复核仓位、买入逻辑和止损/退出条件。',
        metricLabel: '浮动盈亏率',
        metricValue: pnlRate
      });
    }
    if (Number.isFinite(todayChange) && todayChange <= dailyDropLimit) {
      risks.push({
        key: 'daily-drop:' + pos.code,
        severity: todayChange <= dailyDropLimit * 1.6 ? 'high' : 'medium',
        code: pos.code,
        title: pos.code + ' 今日走弱',
        detail: '请区分是个股问题还是板块共振，必要时收紧止损或降低仓位。',
        metricLabel: '今日涨跌幅',
        metricValue: todayChange
      });
    }
    if (Number.isFinite(todayChange) && todayChange >= dailyRiseLimit) {
      risks.push({
        key: 'daily-rise:' + pos.code,
        severity: 'positive',
        code: pos.code,
        title: pos.code + ' 今日走强',
        detail: '关注是否放量、是否突破压力位；持仓可复核止盈计划，避免追高失控。',
        metricLabel: '今日涨跌幅',
        metricValue: todayChange
      });
    }
  });

  (window.State.watchlist || []).forEach(function(item) {
    const price = Number(item.price);
    const change = Number(item.change);
    const high = Number(item.alertHigh);
    const low = Number(item.alertLow);
    if (Number.isFinite(price) && Number.isFinite(high) && high > 0 && price >= high) {
      risks.push({
        key: 'watchlist-high:' + item.code,
        severity: 'medium',
        code: item.code,
        title: item.code + ' 触及高价提醒',
        detail: '当前价 ' + dashboardMiniFmt(price) + ' 已高于提醒价 ' + dashboardMiniFmt(high) + '。'
      });
    }
    if (Number.isFinite(price) && Number.isFinite(low) && low > 0 && price <= low) {
      risks.push({
        key: 'watchlist-low:' + item.code,
        severity: 'high',
        code: item.code,
        title: item.code + ' 触及低价提醒',
        detail: '当前价 ' + dashboardMiniFmt(price) + ' 已低于提醒价 ' + dashboardMiniFmt(low) + '。'
      });
    }
    if (item.quoteStatus === 'stale') {
      risks.push({
        key: 'quote-stale:' + item.code,
        severity: 'low',
        code: item.code,
        title: item.code + ' 行情保留',
        detail: '该自选股最新刷新失败，当前仍显示上一次保留行情。'
      });
    }
    if (!positionCodes.has(item.code) && Number.isFinite(change) && change <= dailyDropLimit) {
      risks.push({
        key: 'watchlist-daily-drop:' + item.code,
        severity: 'medium',
        code: item.code,
        title: item.code + ' 自选走弱',
        detail: '观察是否跌破关键均线或板块同步走弱，先确认原因再决定是否移出或等待企稳。',
        metricLabel: '今日涨跌幅',
        metricValue: change
      });
    }
    if (!positionCodes.has(item.code) && Number.isFinite(change) && change >= dailyRiseLimit) {
      risks.push({
        key: 'watchlist-daily-rise:' + item.code,
        severity: 'positive',
        code: item.code,
        title: item.code + ' 自选走强',
        detail: '可观察是否有量价配合、是否属于热点板块扩散；追入前先看回踩和承接。',
        metricLabel: '今日涨跌幅',
        metricValue: change
      });
    }
  });

  const sectorDashboard = window.SectorLeaders && window.SectorLeaders.getDashboard ? window.SectorLeaders.getDashboard() : null;
  ((sectorDashboard && sectorDashboard.overview) || []).forEach(function(item) {
    const change = Number(item.change);
    if (Number.isFinite(change) && change <= leaderDropLimit) {
      risks.push({
        key: 'leader-drop:' + item.code + ':' + (item.sectorName || ''),
        severity: change <= leaderDropLimit * 1.6 ? 'high' : 'medium',
        code: item.code,
        title: (item.sectorName || '板块') + ' 龙头走弱',
        detail: item.code + ' ' + item.name + ' 下跌 ' + dashboardMiniFmt(change) + '%，操作前请对比同板块其他龙头强弱。'
      });
    }
  });

  const severityRank = { high: 0, medium: 1, positive: 2, low: 3 };
  return risks.sort(function(a, b) {
    return (severityRank[a.severity] || 9) - (severityRank[b.severity] || 9);
  });
}

function dashboardBuildRisks(options) {
  const dismissed = dashboardDismissedRiskKeys();
  const includeDismissed = options && options.includeDismissed;
  return dashboardCollectRisks().map(function(item) {
    item.dismissed = dismissed.has(item.key);
    return item;
  }).filter(function(item) {
    if (includeDismissed) return true;
    return !dismissed.has(item.key);
  });
}

function dashboardStockForCode(code) {
  return window.State.allStocks.find(item => item.code === code) ||
    (window.State.watchlist || []).find(item => item.code === code) ||
    (window.State.positions || []).find(item => item.code === code) ||
    { code, name: code };
}

async function dashboardOpenStock(code) {
  if (!code || !window.StockList) return;
  const stock = dashboardStockForCode(code);
  window.switchMainView('market');
  await window.StockList.selectStock(stock);
}

function dashboardShowRiskContextMenu(event, risk) {
  const menu = document.getElementById('stockContextMenu');
  if (!menu) return;
  event.preventDefault();
  const hasCode = risk && risk.code;
  const dismissed = risk && risk.dismissed;
  menu.setAttribute('data-owner', 'dashboard-risk');
  menu.innerHTML =
    (hasCode ? '<button data-dashboard-risk-action="view">打开行情</button>' : '') +
    (hasCode ? '<button data-dashboard-risk-action="analysis">AI 个股分析</button>' : '') +
    (hasCode ? '<button data-dashboard-risk-action="news">查看资讯</button>' : '') +
    (hasCode ? '<button data-dashboard-risk-action="trades">交易记录</button>' : '') +
    (risk ? '<button data-dashboard-risk-action="' + (dismissed ? 'restore' : 'dismiss') + '">' + (dismissed ? '恢复提醒' : '今日忽略') + '</button>' : '') +
    '<button data-dashboard-risk-action="toggle-dismissed">' + (dashboardShowDismissedRisks ? '隐藏已忽略提醒' : '显示已忽略提醒') + '</button>';
  menu.style.left = Math.min(event.clientX, window.innerWidth - 190) + 'px';
  menu.style.top = Math.min(event.clientY, window.innerHeight - 240) + 'px';
  menu.style.display = 'block';
  setTimeout(function() {
    document.addEventListener('click', dashboardHideContextMenu, { once: true });
  }, 0);
  menu.onclick = async function(clickEvent) {
    const btn = clickEvent.target.closest('[data-dashboard-risk-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-dashboard-risk-action');
    dashboardHideContextMenu();
    try {
      if (action === 'view' && hasCode) await dashboardOpenStock(risk.code);
      else if (action === 'analysis' && hasCode && window.StockList) {
        const stock = dashboardStockForCode(risk.code);
        window.switchMainView('market');
        await window.StockList.selectStock(stock);
        if (window.Analysis) window.Analysis.openAnalysisPanel(stock);
      } else if (action === 'news' && hasCode && window.StockList) {
        await window.StockList.runRowAction('news', dashboardStockForCode(risk.code));
      } else if (action === 'trades' && hasCode && window.Portfolio) {
        window.Portfolio.viewTrades(risk.code);
      } else if (action === 'dismiss' && risk) {
        dashboardDismissRisk(risk.key);
        dashboardRenderRisks();
      } else if (action === 'restore' && risk) {
        dashboardRestoreRisk(risk.key);
        dashboardRenderRisks();
      } else if (action === 'toggle-dismissed') {
        dashboardShowDismissedRisks = !dashboardShowDismissedRisks;
        dashboardRenderRisks();
      }
    } catch (error) {
      alert(error.message || '操作失败');
    }
  };
}

function dashboardRenderRisks() {
  const box = document.getElementById('dashboardRiskList');
  if (!box) return;
  const allRisks = dashboardBuildRisks({ includeDismissed: true });
  const activeRisks = allRisks.filter(function(item) { return !item.dismissed; });
  const dismissedRisks = allRisks.filter(function(item) { return item.dismissed; });
  const toolbar = dismissedRisks.length
    ? '<div class="risk-toolbar"><span>今日已忽略 ' + dismissedRisks.length + ' 条，右键可' + (dashboardShowDismissedRisks ? '隐藏' : '显示') + '</span></div>'
    : '';
  box.onclick = function(event) {
    const item = event.target.closest('.risk-item[data-risk-key]');
    if (!item) return;
    dashboardSelectedRiskKey = decodeURIComponent(item.getAttribute('data-risk-key'));
    box.querySelectorAll('.risk-item.selected').forEach(function(row) { row.classList.remove('selected'); });
    item.classList.add('selected');
  };
  box.ondblclick = function(event) {
    const item = event.target.closest('.risk-item[data-code]');
    if (!item) return;
    dashboardOpenStock(item.getAttribute('data-code')).catch(function(error) { alert(error.message || '打开行情失败'); });
  };
  box.oncontextmenu = function(event) {
    const item = event.target.closest('.risk-item[data-risk-key]');
    if (!item) {
      dashboardShowRiskContextMenu(event, null);
      return;
    }
    const key = decodeURIComponent(item.getAttribute('data-risk-key'));
    const risk = allRisks.find(function(row) { return row.key === key; });
    dashboardSelectedRiskKey = key;
    dashboardShowRiskContextMenu(event, risk);
  };
  if (!activeRisks.length && !dismissedRisks.length) {
    box.innerHTML = '<div class="empty-state compact">当前没有明显风险提醒。</div>';
    return;
  }
  if (!activeRisks.length && dismissedRisks.length && !dashboardShowDismissedRisks) {
    box.innerHTML = toolbar + '<div class="empty-state compact">当前没有未处理风险提醒，右键可查看今日已忽略项目。</div>';
    return;
  }
  const visibleRisks = dashboardShowDismissedRisks ? activeRisks.concat(dismissedRisks) : activeRisks;
  box.innerHTML = toolbar + '<ul class="risk-list detailed">' + visibleRisks.slice(0, 16).map(function(item) {
    return '<li class="risk-item ' + item.severity + (item.dismissed ? ' dismissed' : '') + (dashboardSelectedRiskKey === item.key ? ' selected' : '') + '" data-risk-key="' + encodeURIComponent(item.key) + '"' + (item.code ? ' data-code="' + dashboardEscapeHtml(item.code) + '"' : '') + ' tabindex="0" title="双击打开行情，右键操作">' +
      '<div><strong>' + dashboardEscapeHtml(item.title) + '</strong><p>' + dashboardRiskMetricHtml(item) + dashboardEscapeHtml(item.detail) + '</p><em>双击查看 · 右键操作</em></div>' +
      '</li>';
  }).join('') + '</ul>';
}

window.Dashboard = {
  load: dashboardLoad,
  refreshCards: dashboardRefreshCards,
  renderMarketCockpit: dashboardRenderMarketCockpit,
  renderWatchlist: dashboardRenderWatchlist,
  renderSentiment: dashboardRenderSentiment,
  renderPortfolio: dashboardRenderPortfolio,
  renderScreenerReview: dashboardRenderScreenerReview,
  renderRisks: dashboardRenderRisks,
  buildRisks: dashboardBuildRisks,
  dismissRisk: dashboardDismissRisk,
  restoreRisk: dashboardRestoreRisk,
  setUpdatedAt: dashboardSetUpdatedAt,
  setRefreshStatus: dashboardSetRefreshStatus
};
