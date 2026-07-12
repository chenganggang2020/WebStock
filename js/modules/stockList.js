const tagEnrichingCodes = new Set();
let tagEnrichTimer = null;
let suppressTagSchedule = false;
let stockSelectionSequence = 0;

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
    tradeTime: quote.tradeTime
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
  if (!stocks || !stocks.length) return;
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
      const price = Number(q.price) || 0;
      const change = Number(q.change) || 0;
      const pColor = price > 0 ? (change >= 0 ? 'var(--up)' : 'var(--down)') : '#999';
      document.getElementById('priceInfo').innerHTML = '最新价 <span style="color:' + pColor + ';font-weight:600">' + (price > 0 ? price.toFixed(2) : '--') + '</span> | 涨跌幅 <span style="color:' + pColor + ';font-weight:600">' + (price > 0 ? (change >= 0 ? '+' : '') + change.toFixed(2) + '%' : '--') + '</span>';
    }
  } catch (e) {
    console.error(e);
    const hint = document.getElementById('stockListStatus');
    if (hint) hint.textContent = '行情刷新失败，已保留本地列表：' + e.message;
  }
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
  const storedSeries = window.State && window.State.minuteSeriesByCode
    ? window.State.minuteSeriesByCode[stock.code]
    : null;
  const sourceSeries = Array.isArray(stock.minuteSeries) ? stock.minuteSeries : storedSeries;
  const realPrices = (Array.isArray(sourceSeries) ? sourceSeries : [])
    .map(function(item) { return Number(item && item.price); })
    .filter(function(value) { return Number.isFinite(value) && value > 0; });
  const open = Number(stock.open);
  const high = Number(stock.high);
  const low = Number(stock.low);
  const price = Number(stock.price);
  const previousClose = Number(stock.prevClose);

  if (realPrices.length >= 2) {
    const sampled = realPrices.filter(function(value, index) {
      const step = Math.max(1, Math.ceil(realPrices.length / 28));
      return index % step === 0 || index === realPrices.length - 1;
    });
    const base = Number.isFinite(previousClose) && previousClose > 0 ? previousClose : sampled[0];
    const min = Math.min.apply(null, sampled.concat([base]));
    const max = Math.max.apply(null, sampled.concat([base]));
    const span = Math.max(max - min, 0.01);
    const yFor = function(value) { return 36 - ((value - min) / span) * 30; };
    const points = sampled.map(function(value, index) {
      const x = 6 + index * (106 / Math.max(1, sampled.length - 1));
      return x.toFixed(1) + ',' + yFor(value).toFixed(1);
    }).join(' ');
    const trendColor = stockEscape(color || (sampled[sampled.length - 1] >= base ? 'var(--up)' : 'var(--down)'));
    return '<svg class="stock-mini-chart" viewBox="0 0 118 42" aria-label="真实分时走势">' +
      '<line x1="6" y1="' + yFor(base).toFixed(1) + '" x2="112" y2="' + yFor(base).toFixed(1) + '" stroke="#d7dee8" stroke-width="1" stroke-dasharray="3 4"/>' +
      '<polyline points="' + points + '" fill="none" stroke="' + trendColor + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>';
  }

  if (![open, high, low, price].every(Number.isFinite) || price <= 0 || high <= 0 || low <= 0 || high < low) {
    return '<svg class="stock-mini-chart" viewBox="0 0 118 42" aria-hidden="true">' +
      '<line x1="8" y1="21" x2="110" y2="21" stroke="#d8e0ea" stroke-width="1" stroke-dasharray="3 4"/>' +
      '<text x="59" y="25" text-anchor="middle" fill="#94a3b8" font-size="9">暂无真实分时</text>' +
      '</svg>';
  }

  const base = Number.isFinite(previousClose) && previousClose > 0 ? previousClose : open;
  const rangeMin = Math.min(low, base, open, price);
  const rangeMax = Math.max(high, base, open, price);
  const range = Math.max(rangeMax - rangeMin, 0.01);
  const yFor = function(value) { return 36 - ((value - rangeMin) / range) * 30; };
  const trendColor = stockEscape(color || (price >= base ? 'var(--up)' : 'var(--down)'));
  return '<svg class="stock-mini-chart" viewBox="0 0 118 42" aria-label="当日真实高开低收区间">' +
    '<line x1="6" y1="' + yFor(base).toFixed(1) + '" x2="112" y2="' + yFor(base).toFixed(1) + '" stroke="#d7dee8" stroke-width="1" stroke-dasharray="3 4"/>' +
    '<line x1="59" y1="' + yFor(high).toFixed(1) + '" x2="59" y2="' + yFor(low).toFixed(1) + '" stroke="' + trendColor + '" stroke-width="2"/>' +
    '<line x1="44" y1="' + yFor(open).toFixed(1) + '" x2="59" y2="' + yFor(open).toFixed(1) + '" stroke="' + trendColor + '" stroke-width="2"/>' +
    '<line x1="59" y1="' + yFor(price).toFixed(1) + '" x2="78" y2="' + yFor(price).toFixed(1) + '" stroke="' + trendColor + '" stroke-width="2.5"/>' +
    '<text x="86" y="39" fill="#94a3b8" font-size="8">OHLC</text>' +
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
      '<td data-quote-field="chart" style="text-align:right">' + stockMiniChart(s, priceColor) + '</td>' +
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
    RealtimeChart.showKlineView();
  } else {
    RealtimeChart.showRealtimeView();
    setTimeout(function() {
      if (isCurrentSelection() && window.KlineChart) {
        window.KlineChart.loadKlineData(stock.code, State.currentPeriod);
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
  updateVisibleQuoteRows,
  showContextMenu: showStockContextMenu
};
