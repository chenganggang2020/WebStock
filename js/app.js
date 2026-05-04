function bindButtons() {
  const State = window.State;
  const Search = window.Search;
  const StockList = window.StockList;
  const KlineChart = window.KlineChart;
  const RealtimeChart = window.RealtimeChart;
  const Analysis = window.Analysis;

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

  fetch('/ai-status').then(function(r) { return r.json(); }).then(function(data) {
    const badge = document.getElementById('aiStatusBadge');
    if (data.enabled) {
      badge.textContent = '🟢 AI 已启用(' + (data.model || '') + ')';
    } else {
      badge.textContent = '🟡 AI 未启用';
    }
  }).catch(function() {});
}

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
