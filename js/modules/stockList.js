const tagEnrichingCodes = new Set();
let tagEnrichTimer = null;
let suppressTagSchedule = false;

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
    State.allStocks.forEach(s => {
      if (map[s.code]) Object.assign(s, {
        price: map[s.code].price,
        change: map[s.code].change,
        open: map[s.code].open,
        high: map[s.code].high,
        low: map[s.code].low,
        volume: map[s.code].volume,
        amount: map[s.code].amount,
        prevClose: map[s.code].prevClose
      });
    });
    if (State.searchResults.length > 0) {
      State.searchResults.forEach(s => {
        if (map[s.code]) Object.assign(s, {
          price: map[s.code].price,
          change: map[s.code].change,
          open: map[s.code].open,
          high: map[s.code].high,
          low: map[s.code].low,
          volume: map[s.code].volume,
          amount: map[s.code].amount,
          prevClose: map[s.code].prevClose
        });
      });
    }
    renderStockTable(State.filteredStocks);
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
  const open = Number(stock.open);
  const high = Number(stock.high);
  const low = Number(stock.low);
  const price = Number(stock.price);
  const previousClose = Number(stock.prevClose);
  if (![open, high, low, price].every(Number.isFinite) || price <= 0 || high <= 0 || low <= 0 || high < low) {
    return '<svg class="stock-mini-chart" viewBox="0 0 118 42" aria-hidden="true">' +
      '<line x1="6" y1="21" x2="112" y2="21" stroke="#d8e0ea" stroke-width="1" stroke-dasharray="3 4"/>' +
      '<g opacity="0.7" stroke="#cbd5e1" stroke-width="1.6">' +
      '<line x1="14" y1="13" x2="14" y2="29"/><line x1="28" y1="18" x2="28" y2="31"/><line x1="42" y1="12" x2="42" y2="27"/><line x1="56" y1="16" x2="56" y2="30"/><line x1="70" y1="10" x2="70" y2="26"/><line x1="84" y1="15" x2="84" y2="32"/><line x1="98" y1="11" x2="98" y2="25"/>' +
      '</g>' +
      '<path d="M8 28 C22 19 34 24 48 16 S76 18 92 12 106 15 112 10" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"/>' +
      '</svg>';
  }
  const base = Number.isFinite(previousClose) && previousClose > 0 ? previousClose : open;
  const span = Math.max(high - low, Math.abs(price - base), Math.abs(open - base), 0.01);
  const paddedMin = Math.min(low, base, open, price) - span * 0.12;
  const paddedMax = Math.max(high, base, open, price) + span * 0.12;
  const yFor = function(value) {
    return 36 - ((value - paddedMin) / (paddedMax - paddedMin || 1)) * 30;
  };
  const clamp = function(value) {
    return Math.max(low, Math.min(high, value));
  };
  const codeSeed = String(stock.code || '').split('').reduce(function(sum, ch) {
    return sum + ch.charCodeAt(0);
  }, 0);
  const direction = price >= base ? 1 : -1;
  const range = Math.max(high - low, 0.01);
  const closeValues = [
    open,
    clamp(open + (price - open) * 0.18 + direction * range * ((codeSeed % 3) - 1) * 0.035),
    clamp(open + (price - open) * 0.34 - direction * range * 0.08),
    direction >= 0 ? Math.min(high, Math.max(open, price) + range * 0.18) : Math.max(low, Math.min(open, price) - range * 0.18),
    clamp(open + (price - open) * 0.58 + direction * range * 0.05),
    direction >= 0 ? Math.max(low, Math.min(open, price) - range * 0.15) : Math.min(high, Math.max(open, price) + range * 0.15),
    clamp(open + (price - open) * 0.82),
    price
  ];
  const candleWidth = 5;
  const candles = closeValues.map(function(closeValue, index) {
    const x = 10 + index * 14;
    const openValue = index === 0 ? base : closeValues[index - 1];
    const wiggle = range * (0.08 + ((codeSeed + index) % 4) * 0.018);
    const wickHigh = Math.min(high, Math.max(openValue, closeValue) + wiggle);
    const wickLow = Math.max(low, Math.min(openValue, closeValue) - wiggle);
    const isUp = closeValue >= openValue;
    const stroke = isUp ? 'var(--up)' : 'var(--down)';
    const bodyTop = Math.min(yFor(openValue), yFor(closeValue));
    const bodyHeight = Math.max(2, Math.abs(yFor(openValue) - yFor(closeValue)));
    return {
      x,
      closeValue,
      color: stroke,
      wickTop: yFor(wickHigh),
      wickBottom: yFor(wickLow),
      bodyTop,
      bodyHeight
    };
  });
  if (candles.length > 3) candles[3].wickTop = yFor(high);
  if (candles.length > 5) candles[5].wickBottom = yFor(low);
  const points = candles.map(function(item) {
    return item.x.toFixed(1) + ',' + yFor(item.closeValue).toFixed(1);
  }).join(' ');
  const areaPoints = '10,36 ' + points + ' 108,36';
  const trendColor = stockEscape(color || (price >= base ? 'var(--up)' : 'var(--down)'));
  const candleSvg = candles.map(function(item) {
    return '<g stroke="' + item.color + '" fill="' + item.color + '">' +
      '<line x1="' + item.x.toFixed(1) + '" y1="' + item.wickTop.toFixed(1) + '" x2="' + item.x.toFixed(1) + '" y2="' + item.wickBottom.toFixed(1) + '" stroke-width="1.2" stroke-linecap="round"/>' +
      '<rect x="' + (item.x - candleWidth / 2).toFixed(1) + '" y="' + item.bodyTop.toFixed(1) + '" width="' + candleWidth + '" height="' + item.bodyHeight.toFixed(1) + '" rx="1"/>' +
      '</g>';
  }).join('');
  return '<svg class="stock-mini-chart" viewBox="0 0 118 42" aria-hidden="true">' +
    '<line x1="6" y1="' + yFor(base).toFixed(1) + '" x2="112" y2="' + yFor(base).toFixed(1) + '" stroke="#d7dee8" stroke-width="1" stroke-dasharray="3 4"/>' +
    '<polygon points="' + areaPoints + '" fill="' + trendColor + '" opacity="0.08"/>' +
    candleSvg +
    '<polyline points="' + points + '" fill="none" stroke="' + trendColor + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="108" cy="' + yFor(price).toFixed(1) + '" r="2.2" fill="' + trendColor + '"/>' +
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
      '<td class="price" style="text-align:right;color:' + priceColor + '">' + priceDisplay + '</td>' +
      '<td style="text-align:right;color:' + priceColor + '">' + changeDisplay + '</td>' +
      '<td style="text-align:right">' + stockMiniChart(s, priceColor) + '</td>' +
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
  const Indicators = window.Indicators;
  const RealtimeChart = window.RealtimeChart;
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
  if (window.Dashboard) Promise.resolve(window.Dashboard.refreshCards()).catch(function(error) { console.warn(error.message); });

  try {
    const data = await window.ApiClient.fetchJsonData('/api/kline?code=' + stock.code + '&period=' + State.currentPeriod);
    if (Array.isArray(data) && data.length > 0) {
      State.currentRawData = data;
      State.klineSnapshots[stock.code] = data.slice(-80);
      Indicators.calcMAFromData(State.currentRawData, State.maPeriods);
    }
  } catch (e) {
    console.error('加载K线数据失败', e);
  }

  if (State.currentView === 'kline') {
    RealtimeChart.showKlineView();
  } else {
    RealtimeChart.showRealtimeView();
    RealtimeChart.loadRealtimeData(stock.code);
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
  showContextMenu: showStockContextMenu
};
