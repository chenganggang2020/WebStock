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
  if (window.AIAssistant) window.AIAssistant.bind();
  if (window.AIHistory) window.AIHistory.bind();
  if (window.StockDetail) window.StockDetail.bind();
  if (window.Settings) window.Settings.bind();
  if (window.HotMarket) window.HotMarket.bind();

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
      window.ApiClient.fetchJsonData('/api/minute?code=' + (State.currentStock ? State.currentStock.code : '')).then(function(minuteData) {
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
  const refreshDashboardBtn = document.getElementById('refreshDashboardBtn');
  if (refreshDashboardBtn) refreshDashboardBtn.addEventListener('click', async function(event) {
    event.stopImmediatePropagation();
    if (!window.Dashboard || typeof window.Dashboard.load !== 'function') {
      alert('刷新工作台模块尚未就绪');
      return;
    }
    const originalText = refreshDashboardBtn.textContent;
    refreshDashboardBtn.disabled = true;
    refreshDashboardBtn.setAttribute('aria-busy', 'true');
    refreshDashboardBtn.textContent = '刷新中...';
    if (typeof window.Dashboard.setRefreshStatus === 'function') {
      window.Dashboard.setRefreshStatus('Refreshing dashboard...', false);
    }
    try {
      await window.Dashboard.load();
    } catch (error) {
      const message = error && error.message ? error.message : '刷新工作台失败';
      if (typeof window.Dashboard.setRefreshStatus === 'function') {
        window.Dashboard.setRefreshStatus('Refresh failed: ' + message, true);
      }
      alert(message);
    } finally {
      refreshDashboardBtn.disabled = false;
      refreshDashboardBtn.removeAttribute('aria-busy');
      refreshDashboardBtn.textContent = originalText;
    }
  }, true);
  if (refreshDashboardBtn) refreshDashboardBtn.addEventListener('click', function() {
    window.Dashboard.load().catch(function(error) { alert(error.message || '刷新工作台失败'); });
  });
  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', async function(e) {
    Search.toggleClearButton();
    State.currentPage = 0;
    State.searchResults = Search.searchStocks(e.target.value);
    State.filteredStocks = State.searchResults.slice(0, State.PAGE_SIZE);
    StockList.renderStockTable(State.filteredStocks);
    if (window.HotMarket) window.HotMarket.syncSearchMode();
    StockList.refreshQuotes(State.filteredStocks).catch(function(error) { console.warn(error.message); });
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

  document.querySelectorAll('.main-tab, .sidebar-workspace-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      switchMainView(btn.getAttribute('data-main-view'));
    });
  });

  const watchlistGroupFilter = document.getElementById('watchlistGroupFilter');
  if (watchlistGroupFilter) watchlistGroupFilter.addEventListener('change', Watchlist.loadWatchlist);
  const watchlistSortSelect = document.getElementById('watchlistSortSelect');
  if (watchlistSortSelect) watchlistSortSelect.addEventListener('change', Watchlist.renderWatchlist);
  const watchlistSearchInput = document.getElementById('watchlistSearchInput');
  if (watchlistSearchInput) watchlistSearchInput.addEventListener('input', Watchlist.renderWatchlist);
  document.getElementById('addCurrentToWatchlistBtn').addEventListener('click', Watchlist.addCurrentStock);
  document.getElementById('refreshWatchlistBtn').addEventListener('click', Watchlist.refreshWatchlistQuotes);
  const bulkWatchlistGroupBtn = document.getElementById('bulkWatchlistGroupBtn');
  if (bulkWatchlistGroupBtn) bulkWatchlistGroupBtn.addEventListener('click', function() {
    Watchlist.bulkSetVisibleGroup().catch(function(error) { alert(error.message || '批量分组失败'); });
  });
  const exportWatchlistCsvBtn = document.getElementById('exportWatchlistCsvBtn');
  if (exportWatchlistCsvBtn) exportWatchlistCsvBtn.addEventListener('click', Watchlist.exportVisibleWatchlistCsv);

  document.getElementById('addTradeFromPortfolioBtn').addEventListener('click', function() { Trades.openTradeModal('new'); });
  document.getElementById('refreshPortfolioBtn').addEventListener('click', Portfolio.refreshPortfolio);
  const positionSearchInput = document.getElementById('positionSearchInput');
  if (positionSearchInput) positionSearchInput.addEventListener('input', Portfolio.renderPositions);
  const positionSortSelect = document.getElementById('positionSortSelect');
  if (positionSortSelect) positionSortSelect.addEventListener('change', Portfolio.renderPositions);
  const exportTradesFromPortfolioBtn = document.getElementById('exportTradesFromPortfolioBtn');
  if (exportTradesFromPortfolioBtn) exportTradesFromPortfolioBtn.addEventListener('click', Trades.exportTrades);
  const exportPositionsCsvBtn = document.getElementById('exportPositionsCsvBtn');
  if (exportPositionsCsvBtn) exportPositionsCsvBtn.addEventListener('click', Portfolio.exportPositionsCsv);
  document.getElementById('aiPortfolioAnalysisBtn').addEventListener('click', Portfolio.runAIAnalysis);

  document.getElementById('addTradeBtn').addEventListener('click', function() { Trades.openTradeModal('new'); });
  const resetTradeFiltersBtn = document.getElementById('resetTradeFiltersBtn');
  if (resetTradeFiltersBtn) resetTradeFiltersBtn.addEventListener('click', Trades.resetFilters);
  document.getElementById('exportTradesBtn').addEventListener('click', Trades.exportTrades);
  ['tradeCodeFilter', 'tradeSideFilter', 'tradeStartDate', 'tradeEndDate'].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(id === 'tradeCodeFilter' ? 'input' : 'change', function() { Trades.loadTrades(); });
  });
  document.getElementById('tradeModalCancel').addEventListener('click', Trades.closeTradeModal);
  document.getElementById('tradeModalOk').addEventListener('click', Trades.saveTrade);
  ['tradeSideInput', 'tradePriceInput', 'tradeQuantityInput', 'tradeFeeInput', 'tradeTaxInput'].forEach(function(id) {
    const input = document.getElementById(id);
    if (!input) return;
    input.addEventListener('input', Trades.updateTradeAmountPreview);
    input.addEventListener('change', Trades.updateTradeAmountPreview);
  });
  document.getElementById('tradeModalOverlay').addEventListener('click', function(e) {
    if (e.target === this) Trades.closeTradeModal();
  });
  if (Trades.bindTradeModalShortcuts) Trades.bindTradeModalShortcuts();
  document.getElementById('refreshStatsBtn').addEventListener('click', function() { Portfolio.loadPortfolio().then(Portfolio.renderStatsOverview); });
  const refreshRecentBtn = document.getElementById('refreshRecentStocksBtn');
  if (refreshRecentBtn) refreshRecentBtn.addEventListener('click', function() { window.RecentStocks.load(20).catch(function(error) { alert(error.message); }); });
  const clearRecentBtn = document.getElementById('clearRecentStocksBtn');
  if (clearRecentBtn) clearRecentBtn.addEventListener('click', function() { window.RecentStocks.clear().catch(function(error) { alert(error.message); }); });
  const exportRecentBtn = document.getElementById('exportRecentStocksCsvBtn');
  if (exportRecentBtn) exportRecentBtn.addEventListener('click', function() { window.RecentStocks.exportCsv(); });
  const recentSearchInput = document.getElementById('recentSearchInput');
  if (recentSearchInput) recentSearchInput.addEventListener('input', window.RecentStocks.render);
  const recentSortSelect = document.getElementById('recentSortSelect');
  if (recentSortSelect) recentSortSelect.addEventListener('change', window.RecentStocks.render);
  const refreshNewsBtn = document.getElementById('refreshNewsBtn');
  if (refreshNewsBtn) refreshNewsBtn.addEventListener('click', function() { window.News.load({ cacheBust: true }).catch(function(error) { alert(error.message); }); });
  const newsTypeFilter = document.getElementById('newsTypeFilter');
  if (newsTypeFilter) newsTypeFilter.addEventListener('change', function() { window.News.load().catch(function(error) { alert(error.message); }); });
  const newsSourceFilter = document.getElementById('newsSourceFilter');
  if (newsSourceFilter) newsSourceFilter.addEventListener('change', function() { window.News.load().catch(function(error) { alert(error.message); }); });
  const newsKeywordInput = document.getElementById('newsKeywordInput');
  if (newsKeywordInput) {
    newsKeywordInput.addEventListener('keydown', function(event) {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      window.News.load().catch(function(error) { alert(error.message); });
    });
  }
  const addSectorBtn = document.getElementById('addSectorBtn');
  if (addSectorBtn) addSectorBtn.addEventListener('click', function() { window.SectorLeaders.addSector().catch(function(error) { alert(error.message); }); });
  const refreshSectorsBtn = document.getElementById('refreshSectorsBtn');
  if (refreshSectorsBtn) refreshSectorsBtn.addEventListener('click', function() { window.SectorLeaders.load().catch(function(error) { alert(error.message); }); });
  const sectorSortSelect = document.getElementById('sectorSortSelect');
  if (sectorSortSelect) sectorSortSelect.addEventListener('change', function() { window.SectorLeaders.render(); });
  const sectorRoleFilter = document.getElementById('sectorRoleFilter');
  if (sectorRoleFilter) sectorRoleFilter.addEventListener('change', function() { window.SectorLeaders.render(); });
  const sectorKeywordFilter = document.getElementById('sectorKeywordFilter');
  if (sectorKeywordFilter) sectorKeywordFilter.addEventListener('input', function() { window.SectorLeaders.render(); });
  const sectorAiBtn = document.getElementById('sectorAiBtn');
  if (sectorAiBtn) sectorAiBtn.addEventListener('click', function() { window.SectorLeaders.runAIAnalysis().catch(function(error) { alert(error.message); }); });
  const sectorTrendBtn = document.getElementById('sectorTrendBtn');
  if (sectorTrendBtn) sectorTrendBtn.addEventListener('click', function() { window.SectorLeaders.showTrends().catch(function(error) { alert(error.message); }); });
  const sectorExportSnapshotsBtn = document.getElementById('sectorExportSnapshotsBtn');
  if (sectorExportSnapshotsBtn) sectorExportSnapshotsBtn.addEventListener('click', function() { window.SectorLeaders.exportSnapshotsCsv().catch(function(error) { alert(error.message); }); });
  const sectorExportConfigBtn = document.getElementById('sectorExportConfigBtn');
  if (sectorExportConfigBtn) sectorExportConfigBtn.addEventListener('click', function() { window.SectorLeaders.exportConfigJson().catch(function(error) { alert(error.message); }); });
  const sectorImportConfigBtn = document.getElementById('sectorImportConfigBtn');
  const sectorImportConfigFile = document.getElementById('sectorImportConfigFile');
  if (sectorImportConfigBtn && sectorImportConfigFile) {
    sectorImportConfigBtn.addEventListener('click', function() { sectorImportConfigFile.click(); });
    sectorImportConfigFile.addEventListener('change', function() {
      window.SectorLeaders.importConfigFromFile(sectorImportConfigFile.files && sectorImportConfigFile.files[0]).catch(function(error) { alert(error.message); });
      sectorImportConfigFile.value = '';
    });
  }
  const sectorPruneSnapshotsBtn = document.getElementById('sectorPruneSnapshotsBtn');
  if (sectorPruneSnapshotsBtn) sectorPruneSnapshotsBtn.addEventListener('click', function() { window.SectorLeaders.pruneSnapshots().catch(function(error) { alert(error.message); }); });
  document.querySelectorAll('[data-sector-mode]').forEach(function(btn) {
    btn.addEventListener('click', function() { window.SectorLeaders.setMode(btn.getAttribute('data-sector-mode')); });
  });
  const runScreenerBtn = document.getElementById('runScreenerBtn');
  if (runScreenerBtn) runScreenerBtn.addEventListener('click', function() { window.StockScreener.run().catch(function(error) { alert(error.message); }); });
  const screenerStrategySelect = document.getElementById('screenerStrategy');
  if (screenerStrategySelect) screenerStrategySelect.addEventListener('change', function() { window.StockScreener.renderStrategyHint(); });
  ['screenerMinScoreInput', 'screenerResultKeywordInput'].forEach(function(id) {
    const input = document.getElementById(id);
    if (!input) return;
    input.addEventListener('input', window.StockScreener.refreshResultFilters);
  });
  const resetScreenerFiltersBtn = document.getElementById('resetScreenerFiltersBtn');
  if (resetScreenerFiltersBtn) resetScreenerFiltersBtn.addEventListener('click', window.StockScreener.resetAndRefreshResultFilters);
  const saveScreenerResultBtn = document.getElementById('saveScreenerResultBtn');
  if (saveScreenerResultBtn) saveScreenerResultBtn.addEventListener('click', function() { window.StockScreener.saveCurrent().catch(function(error) { alert(error.message); }); });
  const exportScreenerCsvBtn = document.getElementById('exportScreenerCsvBtn');
  if (exportScreenerCsvBtn) exportScreenerCsvBtn.addEventListener('click', function() { window.StockScreener.exportCurrentCsv().catch(function(error) { alert(error.message); }); });
  const screenerAiBtn = document.getElementById('screenerAiBtn');
  if (screenerAiBtn) screenerAiBtn.addEventListener('click', function() { window.StockScreener.runAI().catch(function(error) { alert(error.message); }); });

  window.apiFetch('/ai-status').then(function(data) {
    const badge = document.getElementById('aiStatusBadge');
    if (data.enabled) {
      badge.textContent = '🟢 AI 已启用(' + (data.model || '') + ')';
    } else {
      badge.textContent = '🟡 AI 未启用';
    }
  }).catch(function() {});
}

function updateSidebarWorkspace() {
  const State = window.State;
  const setText = function(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  };
  setText('sidebarWatchlistCount', (State.watchlist || []).length);
  setText('sidebarPortfolioCount', (State.positions || []).length);
  const sectorDashboard = window.SectorLeaders && window.SectorLeaders.getDashboard ? window.SectorLeaders.getDashboard() : null;
  setText('sidebarSectorCount', ((sectorDashboard && sectorDashboard.overview) || []).length);
  let historyCount = 0;
  try {
    historyCount = window.AIAssistant && window.AIAssistant.getSavedResults ? window.AIAssistant.getSavedResults().length : 0;
  } catch (error) {
    historyCount = 0;
  }
  setText('sidebarAiHistoryCount', historyCount);

  document.querySelectorAll('.sidebar-workspace-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.getAttribute('data-main-view') === State.currentMainView);
  });
}

function syncMainViewHistory(view, options) {
  if (!window.history || !view || (options && options.history === false)) return;
  const state = { mainView: view };
  const url = '#' + encodeURIComponent(view);
  if (window.history.state && window.history.state.mainView === view) return;
  if (options && options.replace) window.history.replaceState(state, '', url);
  else window.history.pushState(state, '', url);
}

function switchMainView(view, options) {
  const State = window.State;
  options = options || {};
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
  updateSidebarWorkspace();
  syncMainViewHistory(view, options);

  if (view === 'watchlist') window.Watchlist.loadWatchlist().catch(function(error) { alert(error.message); });
  if (view === 'recent') window.RecentStocks.load(50).catch(function(error) { alert(error.message); });
  if (view === 'news') window.News.load().catch(function(error) { alert(error.message); });
  if (view === 'sectors') {
    if (window.HotMarket) window.HotMarket.load({ silent: true, fast: true }).catch(function(error) { console.warn(error.message); });
    window.SectorLeaders.load().catch(function(error) { alert(error.message); });
  }
  if (view === 'screener') window.StockScreener.ensureLoaded().catch(function(error) { alert(error.message); });
  if (view === 'market' && window.StockList && State.currentStock && !State.currentRawData.length) {
    window.StockList.selectStock(State.currentStock).catch(function(error) { console.warn(error.message); });
  }
  if (view === 'aiHistory' && window.AIHistory) window.AIHistory.render();
  if (view === 'portfolio') window.Portfolio.loadPortfolio().catch(function(error) { alert(error.message); });
  if (view === 'trades') window.Trades.loadTrades().catch(function(error) { alert(error.message); });
  if (view === 'stats') Promise.all([
    window.Watchlist ? window.Watchlist.loadWatchlist().catch(function() {}) : Promise.resolve(),
    window.RecentStocks ? window.RecentStocks.load(20).catch(function() {}) : Promise.resolve(),
    window.SectorLeaders ? window.SectorLeaders.loadDashboardSummary().catch(function() {}) : Promise.resolve(),
    window.Portfolio.loadPortfolio()
  ]).then(function() {
    window.Portfolio.renderStatsOverview();
    if (window.PortfolioCharts) window.PortfolioCharts.resizePortfolioCharts();
  }).catch(function(error) { alert(error.message); });
  if (view === 'dashboard' && window.Dashboard) window.Dashboard.load().catch(function(error) { console.warn(error.message); });
  if (view === 'settings' && window.Settings) window.Settings.load().catch(function(error) { alert(error.message); });
}

window.switchMainView = switchMainView;
window.updateSidebarWorkspace = updateSidebarWorkspace;

window.addEventListener('popstate', function(event) {
  if (!event.state || !event.state.mainView) return;
  switchMainView(event.state.mainView, { history: false });
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/sw.js').catch(function(error) {
      console.warn('Service worker registration failed:', error.message);
    });
  });
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

  State.allStocks = await window.ApiClient.fetchJsonData('/api/stocklist');
  State.filteredStocks = State.allStocks.slice(0, State.PAGE_SIZE);
  if (window.Watchlist) await window.Watchlist.loadWatchlist({ skipQuotes: true });
  if (window.RecentStocks) await window.RecentStocks.load(20).catch(function() {});
  StockList.renderStockTable(State.filteredStocks);
  bindButtons();
  const requestedView = window.location.hash ? decodeURIComponent(window.location.hash.slice(1)) : '';
  if (requestedView && document.getElementById(requestedView + 'View')) {
    switchMainView(requestedView, { replace: true });
  } else {
    updateSidebarWorkspace();
    syncMainViewHistory(State.currentMainView, { replace: true });
  }
  if (window.HotMarket) window.HotMarket.load({ silent: true, fast: true }).catch(function(error) { console.warn(error.message); });
  StockList.setupInfiniteScroll();
  setInterval(function() {
    const searchInput = document.getElementById('searchInput');
    const tableWrap = document.querySelector('.stock-table-wrap');
    const shouldRefreshList = Boolean(searchInput && searchInput.value.trim()) ||
      Boolean(tableWrap && getComputedStyle(tableWrap).display !== 'none');
    if (shouldRefreshList) StockList.refreshQuotes(State.filteredStocks).catch(function(error) { console.warn(error.message); });
  }, 15000);

  const pingAn = State.allStocks.find(function(s) { return s.code === '000001'; });
  if (pingAn) {
    StockList.primeStock(pingAn);
  }
  if (window.Dashboard) {
    setTimeout(function() {
      window.Dashboard.load().catch(function(error) { console.warn(error.message); });
    }, 0);
  }
}

init();
