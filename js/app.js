function bindButtons() {
  const State = window.State;
  const Search = window.Search;
  const StockList = window.StockList;
  const KlineChart = window.KlineChart;
  const RealtimeChart = window.RealtimeChart;
  const Analysis = window.Analysis;
  const Watchlist = window.Watchlist;
  const Trades = window.Trades;
  const Portfolio = window.Portfolio;

  const indSelect = document.getElementById('indicatorSelect');
  if (indSelect) {
    indSelect.addEventListener('change', function() {
      State.currentIndicator = indSelect.value;
      const maBtn = document.getElementById('maSettingsBtn');
      if (maBtn) maBtn.style.display = State.currentIndicator === 'ma' ? 'inline-flex' : 'none';
      if (State.currentRawData.length) KlineChart.renderKlineChart(State.currentRawData, State.currentIndicator);
    });
  }
  document.getElementById('themeToggle').addEventListener('click', function() {
    document.body.classList.toggle('dark');
    const btn = document.getElementById('themeToggle');
    btn.textContent = document.body.classList.contains('dark') ? '☀️' : '🌙';
    if (State.currentView === 'kline' && State.currentRawData.length) {
      KlineChart.renderKlineChart(State.currentRawData, State.currentIndicator);
    } else if (State.currentView === 'realtime' && State.timeChart) {
      fetch('/api/minute?code=' + (State.currentStock ? State.currentStock.code : '')).then(function(r) { return r.json(); }).then(function(minuteData) {
        if (minuteData && minuteData.length > 0) {
          RealtimeChart.renderTimeChart(minuteData);
          RealtimeChart.renderVolumeChart(minuteData);
        }
      }).catch(function() {});
    }
    if (window.PortfolioCharts) {
      window.PortfolioCharts.renderAllocationChart(State.portfolioAllocation);
      window.PortfolioCharts.renderPnlRankChart(State.positions);
      window.PortfolioCharts.resizePortfolioCharts();
    }
  });
  document.getElementById('clearBtn').addEventListener('click', Search.clearSearch);
  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', async function(e) {
    Search.toggleClearButton();
    State.currentPage = 0;
    State.searchResults = Search.searchStocks(e.target.value);
    State.filteredStocks = State.searchResults.slice(0, State.PAGE_SIZE);
    await StockList.refreshQuotes(State.filteredStocks);
    StockList.renderStockTable(State.filteredStocks);
  });
  Search.toggleClearButton();

  document.getElementById('maSettingsBtn').addEventListener('click', function() {
    if (State.currentIndicator === 'ma') KlineChart.openMASettings();
    else alert('请先切换到均线模式');
  });
  document.getElementById('maModalCancel').addEventListener('click', KlineChart.closeMASettings);
  document.getElementById('maModalOk').addEventListener('click', KlineChart.applyMASettings);
  document.getElementById('maModalOverlay').addEventListener('click', function(e) {
    if (e.target === this) KlineChart.closeMASettings();
  });

  document.getElementById('viewSwitchBtn').addEventListener('click', function() {
    if (State.currentView === 'realtime') {
      RealtimeChart.showKlineView();
    } else {
      RealtimeChart.showRealtimeView();
    }
  });

  document.getElementById('analysisBtn').addEventListener('click', function() {
    if (!State.currentStock) { alert('请先选择一只股票'); return; }
    Analysis.openAnalysisPanel(State.currentStock);
  });
  document.getElementById('analysisCloseBtn').addEventListener('click', Analysis.closeAnalysisPanel);
  document.getElementById('analysisOverlay').addEventListener('click', function(e) {
    if (e.target === this) Analysis.closeAnalysisPanel();
  });
  document.getElementById('analysisRefreshBtn').addEventListener('click', function() {
    if (State.currentStock) Analysis.openAnalysisPanel(State.currentStock, true);
  });

  document.querySelectorAll('.main-tab').forEach(function(btn) {
    btn.addEventListener('click', function() {
      switchMainView(btn.getAttribute('data-main-view'));
    });
  });

  const watchlistGroupFilter = document.getElementById('watchlistGroupFilter');
  if (watchlistGroupFilter) watchlistGroupFilter.addEventListener('change', Watchlist.loadWatchlist);
  document.getElementById('addCurrentToWatchlistBtn').addEventListener('click', Watchlist.addCurrentStock);
  document.getElementById('refreshWatchlistBtn').addEventListener('click', Watchlist.refreshWatchlistQuotes);

  document.getElementById('addTradeFromPortfolioBtn').addEventListener('click', function() { Trades.openTradeModal('new'); });
  document.getElementById('refreshPortfolioBtn').addEventListener('click', Portfolio.refreshPortfolio);
  document.getElementById('aiPortfolioAnalysisBtn').addEventListener('click', Portfolio.runAIAnalysis);

  document.getElementById('addTradeBtn').addEventListener('click', function() { Trades.openTradeModal('new'); });
  document.getElementById('exportTradesBtn').addEventListener('click', Trades.exportTrades);
  ['tradeCodeFilter', 'tradeSideFilter', 'tradeStartDate', 'tradeEndDate'].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(id === 'tradeCodeFilter' ? 'input' : 'change', function() { Trades.loadTrades(); });
  });
  document.getElementById('tradeModalCancel').addEventListener('click', Trades.closeTradeModal);
  document.getElementById('tradeModalOk').addEventListener('click', Trades.saveTrade);
  document.getElementById('tradeModalOverlay').addEventListener('click', function(e) {
    if (e.target === this) Trades.closeTradeModal();
  });
  document.getElementById('refreshStatsBtn').addEventListener('click', function() { Portfolio.loadPortfolio(); });

  fetch('/ai-status').then(function(r) { return r.json(); }).then(function(data) {
    const badge = document.getElementById('aiStatusBadge');
    if (data.enabled) {
      badge.textContent = '🟢 AI 已启用(' + (data.model || '') + ')';
    } else {
      badge.textContent = '🟡 AI 未启用';
    }
  }).catch(function() {});
}

function switchMainView(view) {
  const State = window.State;
  State.currentMainView = view;

  document.querySelectorAll('.main-view').forEach(function(el) {
    el.style.display = 'none';
    el.classList.remove('active');
  });

  const target = document.getElementById(view + 'View');
  if (target) {
    target.style.display = '';
    target.classList.add('active');
  }

  document.querySelectorAll('.main-tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.getAttribute('data-main-view') === view);
  });

  if (view === 'watchlist') window.Watchlist.loadWatchlist().then(window.Watchlist.refreshWatchlistQuotes).catch(function(error) { alert(error.message); });
  if (view === 'portfolio') window.Portfolio.loadPortfolio().catch(function(error) { alert(error.message); });
  if (view === 'trades') window.Trades.loadTrades().catch(function(error) { alert(error.message); });
  if (view === 'stats') window.Portfolio.loadPortfolio().then(function() {
    if (window.PortfolioCharts) window.PortfolioCharts.resizePortfolioCharts();
  }).catch(function(error) { alert(error.message); });
}

window.switchMainView = switchMainView;

document.querySelectorAll('.period-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    const State = window.State;
    const KlineChart = window.KlineChart;
    const period = this.getAttribute('data-period');
    if (period === State.currentPeriod) return;

    document.querySelectorAll('.period-btn').forEach(function(b) { b.classList.remove('active'); });
    this.classList.add('active');

    State.currentPeriod = period;
    if (State.currentStock) {
      KlineChart.loadKlineData(State.currentStock.code, period);
    }
  });
});

async function init() {
  const State = window.State;
  const StockList = window.StockList;

  const resp = await fetch('/api/stocklist');
  State.allStocks = await resp.json();
  State.filteredStocks = State.allStocks.slice(0, State.PAGE_SIZE);
  if (window.Watchlist) await window.Watchlist.loadWatchlist();
  StockList.renderStockTable(State.filteredStocks);
  bindButtons();
  StockList.refreshQuotes(State.filteredStocks);
  StockList.setupInfiniteScroll();
  setInterval(function() { StockList.refreshQuotes(State.filteredStocks); }, 5000);

  const pingAn = State.allStocks.find(function(s) { return s.code === '000001'; });
  if (pingAn) {
    await StockList.selectStock(pingAn);
  }
}

init();
