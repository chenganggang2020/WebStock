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
  if (!stocks.length) return;
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
  }
}

function renderStockTable(stocks) {
  const State = window.State;
  const tbody = document.getElementById('stockTbody');
  if (!tbody) return;
  if (!stocks.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;">无结果</td></tr>';
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
      '<td>' + (s.name || '未知') + '</td>' +
      '<td class="price" style="text-align:right;color:' + priceColor + '">' + priceDisplay + '</td>' +
      '<td style="text-align:right;color:' + priceColor + '">' + changeDisplay + '</td>' +
      '</tr>';
  }).join('');

  async function openRow(row) {
    const stock = findStockByCode(stocks, row.getAttribute('data-code'));
    if (!stock) return;
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

  tbody.onkeydown = async function(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('button')) return;
    const row = event.target.closest('tr[data-code]');
    if (row) {
      event.preventDefault();
      await openRow(row);
    }
  };
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
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.value = '';
    window.Search.toggleClearButton();
    if (window.HotMarket) window.HotMarket.syncSearchMode();
  }
  State.currentPage = 0;
  State.filteredStocks = State.allStocks.slice(0, State.PAGE_SIZE);
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
  selectStock,
  runRowAction
};
