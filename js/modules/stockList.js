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
  const ChartUI = window.ChartUI;
  if (!stocks.length) return;
  const codes = stocks.map(s => s.code).join(',');
  try {
    const resp = await fetch('/api/quote?codes=' + codes);
    const quotes = await resp.json();
    const map = {};
    quotes.forEach(q => map[q.code] = q);
    State.allStocks.forEach(s => { if (map[s.code]) Object.assign(s, { price: map[s.code].price, change: map[s.code].change, open: map[s.code].open, high: map[s.code].high, low: map[s.code].low, volume: map[s.code].volume, prevClose: map[s.code].prevClose }); });
    if (State.searchResults.length > 0) {
      State.searchResults.forEach(s => { if (map[s.code]) Object.assign(s, { price: map[s.code].price, change: map[s.code].change, open: map[s.code].open, high: map[s.code].high, low: map[s.code].low, volume: map[s.code].volume, prevClose: map[s.code].prevClose }); });
    }
    renderStockTable(State.filteredStocks);
    if (State.currentStock && map[State.currentStock.code]) {
      const q = map[State.currentStock.code];
      const pColor = q.price > 0 ? (q.change >= 0 ? 'var(--up)' : 'var(--down)') : '#999';
      document.getElementById('priceInfo').innerHTML = '最新价 <span style="color:' + pColor + ';font-weight:600">' + q.price.toFixed(2) + '</span> | 涨跌幅 <span style="color:' + pColor + ';font-weight:600">' + (q.change >= 0 ? '+' : '') + q.change.toFixed(2) + '%</span>';
    }
  } catch (e) { console.error(e); }
}

function renderStockTable(stocks) {
  const State = window.State;
  const tbody = document.getElementById('stockTbody');
  if (!stocks.length) { tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;">无结果</td></tr>'; return; }
  const style = getComputedStyle(document.body);
  const up = style.getPropertyValue('--up').trim() || '#e74c3c', down = style.getPropertyValue('--down').trim() || '#2ecc71';
  tbody.innerHTML = stocks.map(s => {
    const change = parseFloat(s.change) || 0, price = parseFloat(s.price) || 0;
    const isUp = change >= 0, color = isUp ? up : down, sign = isUp ? '+' : '';
    const active = State.currentStock && State.currentStock.code === s.code ? 'active' : '';
    const priceDisplay = price === 0 ? '--' : price.toFixed(2);
    const changeDisplay = price === 0 ? '--' : sign + change.toFixed(2) + '%';
    const priceColor = price === 0 ? '#999' : color;
    return '<tr class="' + active + '" data-code="' + s.code + '"><td>' + s.code + '</td><td>' + (s.name || '未知') + '</td>' +
      '<td class="price" style="text-align:right;color:' + priceColor + '">' + priceDisplay + '</td>' +
      '<td style="text-align:right;color:' + priceColor + '">' + changeDisplay + '</td></tr>';
  }).join('');
  tbody.querySelectorAll('tr').forEach(row => row.addEventListener('click', () => {
    const code = row.getAttribute('data-code'); const stock = stocks.find(s => s.code === code); if (stock) StockList.selectStock(stock);
  }));
}

async function selectStock(stock) {
  const State = window.State;
  const Indicators = window.Indicators;
  const RealtimeChart = window.RealtimeChart;
  State.currentStock = stock;
  document.getElementById('chartTitle').textContent = stock.name + ' (' + stock.code + ')';
  const price = parseFloat(stock.price) || 0;
  if (price === 0) {
    document.getElementById('priceInfo').innerHTML = '<span style="color:#999">停牌/退市</span>';
  } else {
    const pColor = stock.change >= 0 ? 'var(--up)' : 'var(--down)';
    document.getElementById('priceInfo').innerHTML = '最新价 <span style="color:' + pColor + ';font-weight:600">' + stock.price.toFixed(2) + '</span> | 涨跌幅 <span style="color:' + pColor + ';font-weight:600">' + (stock.change >= 0 ? '+' : '') + ((stock.change || 0)).toFixed(2) + '%</span>';
  }
  renderStockTable(State.filteredStocks);
  const searchInput = document.getElementById('searchInput');
  searchInput.value = '';
  window.Search.toggleClearButton();
  State.currentPage = 0;
  State.filteredStocks = State.allStocks.slice(0, State.PAGE_SIZE);
  renderStockTable(State.filteredStocks);
  await refreshQuotes(State.filteredStocks);

  try {
    const resp = await fetch('/api/kline?code=' + stock.code + '&period=' + State.currentPeriod);
    const data = await resp.json();
    if (Array.isArray(data) && data.length > 0) {
      State.currentRawData = data;
      Indicators.calcMAFromData(State.currentRawData, State.maPeriods);
    }
  } catch (e) {
    console.error('加载K线数据失败:', e);
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
  selectStock
};
