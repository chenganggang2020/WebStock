const tagEnrichingCodes = new Set();
let tagEnrichTimer = null;
let suppressTagSchedule = false;
let stockSelectionSequence = 0;
const minutePrefetchRequests = new Map();
const minutePrefetchQueue = [];
const minutePrefetchQueuedCodes = new Set();
const minutePrefetchCells = new Map();
const minutePrefetchStatus = new Map();
const minutePrefetchMeta = new Map();
const minutePrefetchIdleWaiters = [];
const observedMinuteCells = new WeakSet();
const MINUTE_PREFETCH_CONCURRENCY = 3;
let minutePrefetchActive = 0;
let minuteRowObserver = null;

const MINI_CHART_LABELS = {
  sampling: '5分钟采样',
  loading: '加载分时...',
  unavailable: '行情源无分时',
  insufficient: '分时样本不足',
  empty: '暂无真实分时'
};

function minuteStockForCode(code) {
  const State = window.State || {};
  const lists = [State.watchlist, State.positions, State.filteredStocks,
    State.searchResults, State.recentStocks, State.allStocks];
  for (const list of lists) {
    const found = (list || []).find(function(item) { return item && item.code === code; });
    if (found) return found;
  }
  return { code };
}

function miniTrendColor(stock) {
  const change = stock && (stock.change !== undefined ? stock.change : stock.todayChange);
  if (window.MarketVisualModel) {
    return window.MarketVisualModel.trendColor(change, document.body.classList.contains('dark'));
  }
  return Number(change) >= 0 ? '#ff2d2d' : '#00b050';
}

function minuteChartCellsForCode(code) {
  const tracked = minutePrefetchCells.get(code) || new Set();
  if (document.querySelectorAll) {
    document.querySelectorAll('[data-mini-chart-code]').forEach(function(cell) {
      if (cell.getAttribute('data-mini-chart-code') === code) tracked.add(cell);
    });
  }
  const connected = new Set(Array.from(tracked).filter(function(cell) {
    return cell && cell.isConnected !== false;
  }));
  minutePrefetchCells.set(code, connected);
  return connected;
}

function renderMinuteChartCells(code) {
  const stock = minuteStockForCode(code);
  minuteChartCellsForCode(code).forEach(function(cell) {
    cell.innerHTML = stockMiniChart(stock, miniTrendColor(stock));
  });
}

function finishMinutePrefetchIfIdle() {
  if (minutePrefetchActive || minutePrefetchQueue.length || minutePrefetchRequests.size) return;
  minutePrefetchIdleWaiters.splice(0).forEach(function(resolve) { resolve(); });
}

function fetchMinuteSeriesForRow(code) {
  const cached = window.State && window.State.minuteSeriesByCode
    ? window.State.minuteSeriesByCode[code]
    : null;
  if (Array.isArray(cached) && cached.length >= 2) {
    minutePrefetchStatus.set(code, 'ready');
    return Promise.resolve(cached);
  }
  if (minutePrefetchRequests.has(code)) return minutePrefetchRequests.get(code);

  const request = window.ApiClient.fetchApiEnvelope('/api/minute?code=' + encodeURIComponent(code))
    .then(function(envelope) {
      const series = Array.isArray(envelope && envelope.data) ? envelope.data : [];
      const meta = envelope && envelope.meta || {};
      if (window.State && window.State.minuteSeriesByCode) {
        window.State.minuteSeriesByCode[code] = series.slice();
      }
      minutePrefetchMeta.set(code, meta);
      if (series.length >= 2) minutePrefetchStatus.set(code, 'ready');
      else if (meta.dataSource === 'unavailable') minutePrefetchStatus.set(code, 'unavailable');
      else minutePrefetchStatus.set(code, 'insufficient');
      return series;
    })
    .catch(function(error) {
      minutePrefetchStatus.set(code, 'unavailable');
      console.warn('分时缩略图加载失败 ' + code + ':', error.message || error);
      return [];
    })
    .finally(function() {
      minutePrefetchRequests.delete(code);
    });
  minutePrefetchRequests.set(code, request);
  return request;
}

function pumpMinutePrefetchQueue() {
  while (minutePrefetchActive < MINUTE_PREFETCH_CONCURRENCY && minutePrefetchQueue.length) {
    const code = minutePrefetchQueue.shift();
    minutePrefetchQueuedCodes.delete(code);
    minutePrefetchActive += 1;
    fetchMinuteSeriesForRow(code).finally(function() {
      renderMinuteChartCells(code);
      minutePrefetchActive -= 1;
      pumpMinutePrefetchQueue();
      finishMinutePrefetchIfIdle();
    });
  }
  finishMinutePrefetchIfIdle();
}

function queueVisibleMinuteCell(cell) {
  const code = cell && cell.getAttribute ? cell.getAttribute('data-mini-chart-code') : '';
  if (!code) return;
  const cells = minutePrefetchCells.get(code) || new Set();
  cells.add(cell);
  minutePrefetchCells.set(code, cells);

  const cached = window.State && window.State.minuteSeriesByCode
    ? window.State.minuteSeriesByCode[code]
    : null;
  if (Array.isArray(cached) && cached.length >= 2) {
    minutePrefetchStatus.set(code, 'ready');
    renderMinuteChartCells(code);
    return;
  }
  if (minutePrefetchStatus.get(code) === 'unavailable' || minutePrefetchStatus.get(code) === 'insufficient') {
    renderMinuteChartCells(code);
    return;
  }
  minutePrefetchStatus.set(code, 'loading');
  renderMinuteChartCells(code);
  if (minutePrefetchRequests.has(code) || minutePrefetchQueuedCodes.has(code)) return;
  minutePrefetchQueuedCodes.add(code);
  minutePrefetchQueue.push(code);
  pumpMinutePrefetchQueue();
}

function ensureMinuteRowObserver() {
  if (minuteRowObserver || typeof IntersectionObserver === 'undefined') return minuteRowObserver;
  minuteRowObserver = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (!entry.isIntersecting) return;
      minuteRowObserver.unobserve(entry.target);
      queueVisibleMinuteCell(entry.target);
    });
  }, { root: null, rootMargin: '80px 0px', threshold: 0.01 });
  return minuteRowObserver;
}

function observeMinuteRows(root) {
  if (!root || !root.querySelectorAll) return;
  const cells = root.querySelectorAll('[data-mini-chart-code]');
  const observer = ensureMinuteRowObserver();
  cells.forEach(function(cell) {
    const code = cell.getAttribute('data-mini-chart-code');
    if (!code) return;
    const tracked = minutePrefetchCells.get(code) || new Set();
    tracked.add(cell);
    minutePrefetchCells.set(code, tracked);
    if (observedMinuteCells.has(cell)) return;
    observedMinuteCells.add(cell);
    if (observer) observer.observe(cell);
    else setTimeout(function() {
      if (!cell.getBoundingClientRect) return queueVisibleMinuteCell(cell);
      const rect = cell.getBoundingClientRect();
      if (rect.bottom >= 0 && rect.top <= (window.innerHeight || document.documentElement.clientHeight)) {
        queueVisibleMinuteCell(cell);
      }
    }, 0);
  });
}

function waitForMinutePrefetchIdle() {
  if (!minutePrefetchActive && !minutePrefetchQueue.length && !minutePrefetchRequests.size) {
    return Promise.resolve();
  }
  return new Promise(function(resolve) { minutePrefetchIdleWaiters.push(resolve); });
}

function applyQuote(stock, quote) {
  if (!stock || !quote) return;
  Object.assign(stock, {
    price: quote.price,
    change: quote.change,
    open: quote.open,
    high: quote.high,
    low: quote.low,
    volume: quote.volume,
    amount: quote.amount,
    prevClose: quote.prevClose,
    tradeDate: quote.tradeDate,
    tradeTime: quote.tradeTime,
    quoteStatus: quote.quoteStatus
  });
}

function updateVisibleQuoteRows(quoteMap) {
  const tbody = document.getElementById('stockTbody');
  if (!tbody) return;
  const style = getComputedStyle(document.body);
  const up = style.getPropertyValue('--up').trim() || '#e74c3c';
  const down = style.getPropertyValue('--down').trim() || '#2ecc71';
  tbody.querySelectorAll('tr[data-code]').forEach(function(row) {
    const code = row.getAttribute('data-code');
    const quote = quoteMap[code];
    if (!quote) return;
    const stock = findStockByCode(window.State.filteredStocks, code) || quote;
    const price = Number(quote.price) || 0;
    const change = Number(quote.change) || 0;
    const color = price > 0 ? (change >= 0 ? up : down) : '#999';
    const priceCell = row.querySelector('[data-quote-field="price"]');
    const changeCell = row.querySelector('[data-quote-field="change"]');
    const chartCell = row.querySelector('[data-quote-field="chart"]');
    if (priceCell) {
      priceCell.textContent = price > 0 ? price.toFixed(2) : '--';
      priceCell.style.color = color;
    }
    if (changeCell) {
      changeCell.textContent = price > 0 ? (change >= 0 ? '+' : '') + change.toFixed(2) + '%' : '--';
      changeCell.style.color = color;
    }
    if (chartCell) chartCell.innerHTML = stockMiniChart(stock, color);
  });
}

async function loadMoreStocks() {
  const State = window.State;
  State.currentPage++;
  const start = State.currentPage * State.PAGE_SIZE;
  const end = start + State.PAGE_SIZE;
  const sourceData = State.searchResults.length > 0 ? State.searchResults : State.allStocks;
  const newStocks = sourceData.slice(start, end);
  if (newStocks.length > 0) {
    State.filteredStocks = State.filteredStocks.concat(newStocks);
    await refreshQuotes(newStocks);
    renderStockTable(State.filteredStocks);
  }
}

function setupInfiniteScroll() {
  const State = window.State;
  const tableWrap = document.querySelector('.stock-table-wrap');
  if (!tableWrap) return;
  tableWrap.addEventListener('scroll', function () {
    if (tableWrap.scrollTop + tableWrap.clientHeight >= tableWrap.scrollHeight - 50) {
      const sourceData = State.searchResults.length > 0 ? State.searchResults : State.allStocks;
      if (State.filteredStocks.length < sourceData.length) {
        loadMoreStocks();
      }
    }
  });
}

async function refreshQuotes(stocks) {
  const State = window.State;
  if (!stocks || !stocks.length) return { ok: true, count: 0 };
  const codes = stocks.map(s => s.code).join(',');
  try {
    const quotes = await window.ApiClient.fetchJsonData('/api/quote?codes=' + codes);
    if (!Array.isArray(quotes)) throw new Error('行情接口返回格式异常');
    const map = {};
    quotes.forEach(q => map[q.code] = q);
    stocks.forEach(s => {
      if (map[s.code]) applyQuote(s, map[s.code]);
    });
    State.allStocks.forEach(s => {
      if (map[s.code]) applyQuote(s, map[s.code]);
    });
    if (State.searchResults.length > 0) {
      State.searchResults.forEach(s => {
        if (map[s.code]) applyQuote(s, map[s.code]);
      });
    }
    updateVisibleQuoteRows(map);
    if (State.currentStock && map[State.currentStock.code]) {
      const q = map[State.currentStock.code];
      const activeMeta = State.currentView === 'kline' ? State.currentKlineMeta : State.currentMinuteMeta;
      const sameSnapshot = activeMeta && activeMeta.code === State.currentStock.code &&
        (State.currentView !== 'kline' || activeMeta.period === State.currentPeriod);
      const preserveSourceNotice = sameSnapshot &&
        (activeMeta.stale || activeMeta.dataSource === 'unavailable' || activeMeta.quoteStatus === 'unavailable');
      const price = Number(q.price) || 0;
      const change = Number(q.change) || 0;
      const pColor = price > 0 ? (change >= 0 ? 'var(--up)' : 'var(--down)') : '#999';
      if (!preserveSourceNotice) {
        document.getElementById('priceInfo').innerHTML = '最新价 <span style="color:' + pColor + ';font-weight:600">' + (price > 0 ? price.toFixed(2) : '--') + '</span> | 涨跌幅 <span style="color:' + pColor + ';font-weight:600">' + (price > 0 ? (change >= 0 ? '+' : '') + change.toFixed(2) + '%' : '--') + '</span>';
      }
    }
    const observedAt = quotes.map(function(quote) {
      return [quote.tradeDate, quote.tradeTime].filter(Boolean).join(' ');
    }).filter(Boolean).sort().pop();
    return { ok: true, count: quotes.length, observedAt };
  } catch (e) {
    console.error(e);
    const hint = document.getElementById('stockListStatus');
    if (hint) hint.textContent = '行情刷新失败，已保留本地列表：' + e.message;
    return { ok: false, error: e };
  }
}

function refreshVisibleMinuteCharts(codes) {
  const allowed = new Set((codes || []).filter(Boolean));
  if (!allowed.size || !document.querySelectorAll) return;
  document.querySelectorAll('[data-mini-chart-code]').forEach(function(cell) {
    const code = cell.getAttribute('data-mini-chart-code');
    if (!allowed.has(code)) return;
    const rect = cell.getBoundingClientRect ? cell.getBoundingClientRect() : null;
    if (rect && (rect.bottom < 0 || rect.top > (window.innerHeight || document.documentElement.clientHeight))) return;
    if (window.State && window.State.minuteSeriesByCode) delete window.State.minuteSeriesByCode[code];
    minutePrefetchStatus.delete(code);
    queueVisibleMinuteCell(cell);
  });
}

function findStockByCode(stocks, code) {
  const State = window.State;
  if (code && typeof code === 'object') return code;
  return stocks.find(s => s.code === code) || State.allStocks.find(s => s.code === code);
}

function normalizeStock(stock) {
  if (!stock) return stock;
  if (stock.code && typeof stock.code === 'object') return stock.code;
  return stock;
}

function stockEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stockMarketLabel(code) {
  const value = String(code || '').replace(/\D/g, '').slice(-6);
  if (/^30[0-9]/.test(value)) return '创业板';
  if (/^68[89]?/.test(value)) return '科创板';
  if (/^(8|4|92)/.test(value)) return '北交所';
  if (/^(50|51|52|56|58|15|16)/.test(value)) return 'ETF';
  if (/^60[0135]/.test(value)) return '沪主板';
  if (/^(00|001|002|003)/.test(value)) return '深主板';
  return 'A股';
}

function stockTags(stock) {
  const tags = [stock.marketLabel || stockMarketLabel(stock.code)];
  (stock.themes || []).forEach(function(theme) {
    if (theme && theme.name) tags.push(theme.name);
  });
  if (stock.industry) tags.push(stock.industry);
  (stock.boards || []).slice(0, 4).forEach(function(board) { tags.push(board); });
  (stock.mainBusinessItems || []).slice(0, 2).forEach(function(item) {
    if (item && item.name) tags.push(item.ratio == null ? item.name : item.name + ' ' + item.ratio + '%');
  });
  if (stock.matchReason) tags.push(stock.matchReason);
  return tags.filter(Boolean).filter(function(tag, index, arr) {
    return arr.indexOf(tag) === index;
  }).slice(0, 5);
}

function stockMiniChart(stock, color) {
  const chartTheme = window.ChartTheme
    ? window.ChartTheme.get(document.body.classList.contains('dark'))
    : { widths: { mini: 1.15, reference: 0.7 } };
  const miniWidth = chartTheme.widths.mini;
  const referenceWidth = Math.max(Number(chartTheme.widths.reference) || 0.7, 1);
  const storedSeries = window.State && window.State.minuteSeriesByCode
    ? window.State.minuteSeriesByCode[stock.code]
    : null;
  const sourceSeries = Array.isArray(stock.minuteSeries) ? stock.minuteSeries : storedSeries;
  const realPrices = (Array.isArray(sourceSeries) ? sourceSeries : [])
    .map(function(item) { return Number(item && item.price); })
    .filter(function(value) { return Number.isFinite(value) && value > 0; });
  const previousClose = Number(stock.prevClose);

  if (realPrices.length >= 2) {
    const sampled = realPrices.filter(function(value, index) {
      const step = Math.max(1, Math.ceil(realPrices.length / 48));
      return index % step === 0 || index === realPrices.length - 1;
    });
    const base = Number.isFinite(previousClose) && previousClose > 0 ? previousClose : sampled[0];
    const min = Math.min.apply(null, sampled.concat([base]));
    const max = Math.max.apply(null, sampled.concat([base]));
    const span = Math.max(max - min, 0.01);
    const yFor = function(value) { return 47 - ((value - min) / span) * 38; };
    const points = sampled.map(function(value, index) {
      const x = 25 + index * (149 / Math.max(1, sampled.length - 1));
      return x.toFixed(1) + ',' + yFor(value).toFixed(1);
    }).join(' ');
    const trendColor = stockEscape(color || (sampled[sampled.length - 1] >= base ? 'var(--up)' : 'var(--down)'));
    const lastX = 174;
    const lastY = yFor(sampled[sampled.length - 1]).toFixed(1);
    const range = window.RealtimeChartModel && window.RealtimeChartModel.priceRangePercent
      ? window.RealtimeChartModel.priceRangePercent(sampled, base)
      : {
        highPercent: (max - base) / base * 100,
        lowPercent: (min - base) / base * 100
      };
    const formatPercent = function(value) {
      const number = Number(value) || 0;
      return (number > 0 ? '+' : '') + number.toFixed(1) + '%';
    };
    const sampling = window.RealtimeChartModel && window.RealtimeChartModel.describeSampling
      ? window.RealtimeChartModel.describeSampling(sourceSeries, minutePrefetchMeta.get(stock.code) || {})
      : { label: MINI_CHART_LABELS.sampling };
    return '<svg class="stock-mini-chart" viewBox="0 0 180 60" role="img" aria-label="' +
      stockEscape(sampling.label + ' ' + MINI_CHART_LABELS.empty) + '">' +
      '<text x="1" y="10" fill="' + trendColor + '" font-size="7.5">' + formatPercent(range.highPercent) + '</text>' +
      '<text x="1" y="49" fill="' + trendColor + '" font-size="7.5">' + formatPercent(range.lowPercent) + '</text>' +
      '<line class="mini-zero-reference" x1="25" y1="' + yFor(base).toFixed(1) + '" x2="174" y2="' + yFor(base).toFixed(1) + '" stroke="#94a3b8" stroke-width="' + referenceWidth + '" stroke-dasharray="3 3"/>' +
      '<polygon points="25,50 ' + points + ' ' + lastX + ',50" fill="' + trendColor + '" opacity="0.08"/>' +
      '<polyline points="' + points + '" fill="none" stroke="' + trendColor + '" stroke-width="' + miniWidth + '" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + lastX + '" cy="' + lastY + '" r="1.8" fill="' + trendColor + '"/>' +
      '<text x="174" y="58" text-anchor="end" fill="#94a3b8" font-size="7.5">' + stockEscape(sampling.label) + '</text>' +
      '</svg>';
  }

  const status = minutePrefetchStatus.get(stock.code);
  const label = status === 'loading'
    ? MINI_CHART_LABELS.loading
    : status === 'unavailable'
      ? MINI_CHART_LABELS.unavailable
      : Array.isArray(sourceSeries) && sourceSeries.length
        ? MINI_CHART_LABELS.insufficient
        : MINI_CHART_LABELS.empty;
  const placeholderColor = stockEscape(color || miniTrendColor(stock));
  return '<svg class="stock-mini-chart" viewBox="0 0 180 60" role="img" aria-label="' + stockEscape(label) + '">' +
    '<line class="mini-zero-reference" x1="22" y1="27" x2="174" y2="27" stroke="' + placeholderColor + '" stroke-width="' + referenceWidth + '" stroke-dasharray="3 3"/>' +
    '<text x="90" y="32" text-anchor="middle" fill="' + placeholderColor + '" font-size="9">' + stockEscape(label) + '</text>' +
    '</svg>';
}

function renderStockNameCell(stock) {
  const tags = stockTags(stock).map(function(tag) {
    return '<span class="stock-tag">' + stockEscape(tag) + '</span>';
  }).join('');
  return '<div class="stock-name-cell"><span>' + stockEscape(stock.name || '未知') + '</span><div class="stock-tags">' + tags + '</div></div>';
}

function primeStock(stock) {
  const normalized = normalizeStock(stock);
  if (!normalized || !normalized.code) return;
  const State = window.State;
  State.currentStock = normalized;
  State.currentRawData = [];
  const title = document.getElementById('chartTitle');
  if (title) title.textContent = (normalized.name || normalized.code) + ' (' + normalized.code + ')';
  const priceInfo = document.getElementById('priceInfo');
  if (priceInfo) priceInfo.innerHTML = '<span style="color:#999">进入行情页后加载实时行情与K线</span>';
}

function mergeTagProfile(profile) {
  if (!profile || !profile.code) return;
  const State = window.State;
  [State.allStocks, State.searchResults, State.filteredStocks].forEach(function(list) {
    (list || []).forEach(function(stock) {
      if (stock.code === profile.code) Object.assign(stock, profile, { tagDetailFetched: true });
    });
  });
  if (State.currentStock && State.currentStock.code === profile.code) {
    Object.assign(State.currentStock, profile, { tagDetailFetched: true });
  }
}

async function enrichStockTags(codes, options) {
  options = options || {};
  const uniqueCodes = codes.filter(Boolean).filter(function(code, index, arr) {
    return arr.indexOf(code) === index;
  }).slice(0, options.limit || 50);
  if (!uniqueCodes.length) return [];
  uniqueCodes.forEach(function(code) { tagEnrichingCodes.add(code); });
  try {
    const query = new URLSearchParams({
      detail: '1',
      limit: String(options.limit || 50),
      codes: uniqueCodes.join(',')
    });
    const profiles = await window.ApiClient.fetchJsonData('/api/stock-tags?' + query.toString());
    (profiles || []).forEach(mergeTagProfile);
    suppressTagSchedule = true;
    renderStockTable(window.State.filteredStocks);
    if (window.StockDetail && window.State.currentStock) window.StockDetail.renderProfile(window.State.currentStock);
    return profiles || [];
  } catch (error) {
    console.warn(error.message || error);
    return [];
  } finally {
    uniqueCodes.forEach(function(code) { tagEnrichingCodes.delete(code); });
  }
}

function scheduleTagEnrichment(stocks) {
  const searchInput = document.getElementById('searchInput');
  if (!searchInput || !searchInput.value.trim()) return;
  const candidates = (stocks || []).filter(function(stock) {
    return stock && stock.code && stock.type !== 'fund' && !stock.tagDetailFetched && !tagEnrichingCodes.has(stock.code);
  }).slice(0, 36).map(function(stock) { return stock.code; });
  if (!candidates.length) return;
  if (tagEnrichTimer) clearTimeout(tagEnrichTimer);
  tagEnrichTimer = setTimeout(function() {
    enrichStockTags(candidates, { limit: 36 }).catch(function(error) { console.warn(error.message || error); });
  }, 350);
}

async function runRowAction(action, stock) {
  if (!stock) return;
  if (action === 'view') {
    if (window.switchMainView) window.switchMainView('market');
    await selectStock(stock);
    return;
  }
  if (action === 'analysis') {
    if (window.switchMainView) window.switchMainView('market');
    await selectStock(stock);
    if (window.Analysis) window.Analysis.openAnalysisPanel(stock);
    return;
  }
  if (action === 'watchlist') {
    if (!window.Watchlist) return;
    const watched = window.State.watchlist.some(item => item.code === stock.code);
    if (watched) await window.Watchlist.removeByCode(stock.code);
    else await window.Watchlist.addStock(stock);
    return;
  }
  if (action === 'trade') {
    if (window.Portfolio) window.Portfolio.openBuyTrade(stock);
    else if (window.Trades) window.Trades.openTradeModal('new', null, Object.assign({ side: 'buy' }, stock));
    return;
  }
  if (action === 'sell') {
    if (window.Portfolio) window.Portfolio.openSellTradeByCode(stock.code);
    return;
  }
  if (action === 'trades') {
    if (window.Portfolio) window.Portfolio.viewTrades(stock.code);
    return;
  }
  if (action === 'news') {
    if (window.switchMainView) window.switchMainView('news');
    const type = document.getElementById('newsTypeFilter');
    const keyword = document.getElementById('newsKeywordInput');
    if (type) type.value = 'stock';
    if (keyword) keyword.value = stock.code;
    if (window.News) await window.News.load({ cacheBust: true });
    return;
  }
  if (action === 'sector') {
    if (window.switchMainView) window.switchMainView('sectors');
  }
}

function hideStockContextMenu() {
  const menu = document.getElementById('stockContextMenu');
  if (menu) menu.style.display = 'none';
}

function showStockContextMenu(event, stock) {
  const menu = document.getElementById('stockContextMenu');
  if (!menu || !stock) return;
  event.preventDefault();
  const watched = window.State.watchlist.some(item => item.code === stock.code);
  menu.innerHTML =
    '<button data-action="view">打开行情</button>' +
    '<button data-action="analysis">AI 个股分析</button>' +
    '<button data-action="trade">买入记录</button>' +
    '<button data-action="sell">卖出记录</button>' +
    '<button data-action="trades">交易记录</button>' +
    '<button data-action="news">资讯查看</button>' +
    '<button data-action="sector">板块龙头</button>' +
    '<button data-action="watchlist">' + (watched ? '移出自选' : '加入自选') + '</button>';
  const x = Math.min(event.clientX, window.innerWidth - 190);
  const y = Math.min(event.clientY, window.innerHeight - 250);
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.style.display = 'block';
  setTimeout(function() {
    document.addEventListener('click', hideStockContextMenu, { once: true });
  }, 0);
  menu.onclick = async function(clickEvent) {
    const btn = clickEvent.target.closest('[data-action]');
    if (!btn) return;
    hideStockContextMenu();
    try {
      await runRowAction(btn.getAttribute('data-action'), stock);
    } catch (error) {
      alert(error.message || '操作失败');
    }
  };
}

function renderStockTable(stocks) {
  const State = window.State;
  const tbody = document.getElementById('stockTbody');
  if (!tbody) return;
  if (!stocks.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;">无结果</td></tr>';
    return;
  }

  const style = getComputedStyle(document.body);
  const up = style.getPropertyValue('--up').trim() || '#e74c3c';
  const down = style.getPropertyValue('--down').trim() || '#2ecc71';
  tbody.innerHTML = stocks.map(s => {
    const change = parseFloat(s.change) || 0;
    const price = parseFloat(s.price) || 0;
    const isUp = change >= 0;
    const color = isUp ? up : down;
    const sign = isUp ? '+' : '';
    const active = State.currentStock && State.currentStock.code === s.code ? 'active' : '';
    const priceDisplay = price === 0 ? '--' : price.toFixed(2);
    const changeDisplay = price === 0 ? '--' : sign + change.toFixed(2) + '%';
    const priceColor = price === 0 ? '#999' : color;
    const watched = State.watchlist.some(item => item.code === s.code);
    const star = watched ? '★' : '☆';
    return '<tr class="' + active + '" data-code="' + s.code + '" tabindex="0" aria-label="' + s.code + ' ' + (s.name || '未知') + '">' +
      '<td class="star-cell"><button class="star-btn ' + (watched ? 'active' : '') + '" data-code="' + s.code + '" title="切换自选">' + star + '</button></td>' +
      '<td>' + s.code + '</td>' +
      '<td>' + renderStockNameCell(s) + '</td>' +
      '<td class="price" data-quote-field="price" style="text-align:right;color:' + priceColor + '">' + priceDisplay + '</td>' +
      '<td data-quote-field="change" style="text-align:right;color:' + priceColor + '">' + changeDisplay + '</td>' +
      '<td data-quote-field="chart" data-mini-chart-code="' + s.code + '" style="text-align:right">' + stockMiniChart(s, priceColor) + '</td>' +
      '</tr>';
  }).join('');

  async function openRow(row) {
    const stock = findStockByCode(stocks, row.getAttribute('data-code'));
    if (!stock) return;
    const searchInput = document.getElementById('searchInput');
    if (window.Search && searchInput) window.Search.saveSearchHistory(searchInput.value || stock.code, stock);
    if (window.switchMainView) window.switchMainView('market');
    await selectStock(stock);
  }

  tbody.onclick = async function(event) {
    const actionBtn = event.target.closest('[data-action]');
    const starBtn = event.target.closest('.star-btn');
    if (actionBtn) {
      event.stopPropagation();
      const stock = findStockByCode(stocks, actionBtn.getAttribute('data-code'));
      try {
        await runRowAction(actionBtn.getAttribute('data-action'), stock);
      } catch (error) {
        alert(error.message || '操作失败');
      }
      return;
    }
    if (starBtn) {
      event.stopPropagation();
      const code = starBtn.getAttribute('data-code');
      const stock = findStockByCode(stocks, code);
      if (!stock || !window.Watchlist) return;
      try {
        if (starBtn.classList.contains('active')) await window.Watchlist.removeByCode(code);
        else await window.Watchlist.addStock(stock);
      } catch (error) {
        alert(error.message || '自选操作失败');
      }
      return;
    }
    const row = event.target.closest('tr[data-code]');
    if (row) {
      await openRow(row);
    }
  };

  tbody.oncontextmenu = function(event) {
    const row = event.target.closest('tr[data-code]');
    if (!row) return;
    const stock = findStockByCode(stocks, row.getAttribute('data-code'));
    showStockContextMenu(event, stock);
  };

  tbody.onkeydown = async function(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('button')) return;
    const row = event.target.closest('tr[data-code]');
    if (row) {
      event.preventDefault();
      await openRow(row);
    }
  };
  if (suppressTagSchedule) suppressTagSchedule = false;
  else scheduleTagEnrichment(stocks);
  observeMinuteRows(tbody);
}

async function selectStock(stock) {
  stock = normalizeStock(stock);
  if (!stock || !stock.code) {
    alert('Invalid stock selection');
    return;
  }
  const State = window.State;
  const RealtimeChart = window.RealtimeChart;
  const selectionId = ++stockSelectionSequence;
  const isCurrentSelection = function() {
    return selectionId === stockSelectionSequence && State.currentStock && State.currentStock.code === stock.code;
  };
  State.currentStock = stock;
  if (window.DecisionGuide) window.DecisionGuide.refreshForStock(stock).catch(function(error) { console.warn(error.message || error); });
  if (window.RecentStocks) window.RecentStocks.record(stock).catch(function(error) { console.warn(error.message); });
  if (window.StockDetail) window.StockDetail.refresh(stock).catch(function(error) { console.warn(error.message); });
  enrichStockTags([stock.code], { limit: 1 }).catch(function(error) { console.warn(error.message || error); });

  document.getElementById('chartTitle').textContent = stock.name + ' (' + stock.code + ')';
  const price = parseFloat(stock.price) || 0;
  if (price === 0) {
    document.getElementById('priceInfo').innerHTML = '<span style="color:#999">停牌/退市或暂无行情</span>';
  } else {
    const change = Number(stock.change) || 0;
    const pColor = change >= 0 ? 'var(--up)' : 'var(--down)';
    document.getElementById('priceInfo').innerHTML = '最新价 <span style="color:' + pColor + ';font-weight:600">' + price.toFixed(2) + '</span> | 涨跌幅 <span style="color:' + pColor + ';font-weight:600">' + (change >= 0 ? '+' : '') + change.toFixed(2) + '%</span>';
  }

  renderStockTable(State.filteredStocks);
  await refreshQuotes([stock]);
  if (!isCurrentSelection()) return;
  if (window.Dashboard) Promise.resolve(window.Dashboard.refreshCards()).catch(function(error) { console.warn(error.message); });

  if (State.currentView === 'kline') {
    RealtimeChart.showKlineView(State.currentPeriod);
  } else {
    RealtimeChart.showRealtimeView();
    setTimeout(function() {
      if (isCurrentSelection() && window.KlineChart && typeof window.KlineChart.prefetchKlineSnapshot === 'function') {
        window.KlineChart.prefetchKlineSnapshot(stock.code, 'day').catch(function(error) { console.warn(error.message || error); });
      }
    }, 250);
  }
}

window.StockList = {
  loadMoreStocks,
  setupInfiniteScroll,
  refreshQuotes,
  renderStockTable,
  primeStock,
  enrichStockTags,
  selectStock,
  runRowAction,
  miniChart: stockMiniChart,
  observeMinuteRows,
  waitForMinutePrefetchIdle,
  refreshVisibleMinuteCharts,
  updateVisibleQuoteRows,
  showContextMenu: showStockContextMenu
};
