let mainNavigationBound = false;
let marketDrawerReturnFocus = null;
const UI_STYLE_STORAGE_KEY = 'webstock-ui-style';

function readStoredUiStyle() {
  try {
    return window.localStorage.getItem(UI_STYLE_STORAGE_KEY) === 'terminal' ? 'terminal' : 'clarity';
  } catch (_) {
    return 'clarity';
  }
}

function applyUiStyle(style, persist) {
  const normalized = style === 'terminal' ? 'terminal' : 'clarity';
  const dark = normalized === 'terminal';
  document.body.dataset.uiStyle = normalized;
  document.body.classList.toggle('dark', dark);
  const button = document.getElementById('themeToggle');
  if (button) {
    const label = button.querySelector('[data-theme-label]');
    if (label) label.textContent = dark ? '终端深色' : '专业浅色';
    button.setAttribute('aria-pressed', String(dark));
    button.setAttribute('aria-label', dark ? '当前终端深色，切换为专业浅色' : '当前专业浅色，切换为终端深色');
  }
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.setAttribute('content', dark ? '#010102' : '#f4f4f6');
  if (persist !== false) {
    try { window.localStorage.setItem(UI_STYLE_STORAGE_KEY, normalized); } catch (_) {}
  }
  return normalized;
}

function setMarketDrawerOpen(open) {
  const drawer = document.getElementById('marketDrawer');
  const toggle = document.getElementById('marketDrawerToggle');
  if (!drawer || !toggle) return;
  if (open) marketDrawerReturnFocus = document.activeElement;
  document.body.classList.toggle('market-drawer-open', Boolean(open));
  drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
  drawer.inert = !open;
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  toggle.setAttribute('aria-label', open ? '关闭行情与资讯' : '打开行情与资讯');
  if (open) {
    const close = document.getElementById('marketDrawerClose');
    if (close) setTimeout(function() {
      if (document.body.classList.contains('market-drawer-open')) close.focus();
    }, 0);
  }
  if (!open && marketDrawerReturnFocus && typeof marketDrawerReturnFocus.focus === 'function') {
    marketDrawerReturnFocus.focus();
    marketDrawerReturnFocus = null;
  }
}

function bindMarketDrawer() {
  const toggle = document.getElementById('marketDrawerToggle');
  const close = document.getElementById('marketDrawerClose');
  const backdrop = document.getElementById('marketDrawerBackdrop');
  if (!toggle || !close || !backdrop || toggle.dataset.bound === 'true') return;
  toggle.dataset.bound = 'true';
  toggle.addEventListener('click', function() {
    setMarketDrawerOpen(!document.body.classList.contains('market-drawer-open'));
  });
  close.addEventListener('click', function() { setMarketDrawerOpen(false); });
  backdrop.addEventListener('click', function() { setMarketDrawerOpen(false); });
  document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') setMarketDrawerOpen(false);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      const search = document.getElementById('searchInput');
      if (search) search.focus();
    }
  });
  const stockTable = document.getElementById('stockTbody');
  if (stockTable) stockTable.addEventListener('click', function() {
    setTimeout(function() { setMarketDrawerOpen(false); }, 0);
  });
}

function bindMainNavigation() {
  if (mainNavigationBound) return;
  mainNavigationBound = true;
  document.querySelectorAll('.main-tab').forEach(function(btn) {
    btn.addEventListener('click', function() {
      switchMainView(btn.getAttribute('data-main-view'));
      setMarketDrawerOpen(false);
    });
  });
}

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
  if (window.ExpertTracker) window.ExpertTracker.bind();
  if (window.AIHistory) window.AIHistory.bind();
  if (window.StockDetail) window.StockDetail.bind();
  if (window.Settings) window.Settings.bind();
  if (window.HotMarket) window.HotMarket.bind();
  if (window.MarketOverview) window.MarketOverview.bind();
  if (window.MarketComparison) window.MarketComparison.bind();
  if (window.AIResearch) window.AIResearch.bind();
  if (window.CapitalFlow) window.CapitalFlow.bind();
  if (window.MarketInstitutionalFlow) window.MarketInstitutionalFlow.bind();
  if (window.CompoundLab) window.CompoundLab.bind();

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
    applyUiStyle(document.body.dataset.uiStyle === 'terminal' ? 'clarity' : 'terminal', true);
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
    if (State.currentMainView === 'capitalFlow' && window.CapitalFlow) window.CapitalFlow.rerender();
    if (State.currentMainView === 'compoundLab' && window.CompoundLab) window.CompoundLab.rerender();
    if (window.VolumePace && typeof window.VolumePace.rerender === 'function') window.VolumePace.rerender();
    if (window.MarketComparison && typeof window.MarketComparison.rerenderTheme === 'function') {
      window.MarketComparison.rerenderTheme();
    }
  });
  document.getElementById('clearBtn').addEventListener('click', Search.clearSearch);
  const refreshDashboardBtn = document.getElementById('refreshDashboardBtn');
  if (refreshDashboardBtn) refreshDashboardBtn.addEventListener('click', async function(event) {
    event.stopImmediatePropagation();
    if (!window.Dashboard || typeof window.Dashboard.load !== 'function') {
      alert('刷新首页模块尚未就绪');
      return;
    }
    const originalText = refreshDashboardBtn.textContent;
    refreshDashboardBtn.disabled = true;
    refreshDashboardBtn.setAttribute('aria-busy', 'true');
    refreshDashboardBtn.textContent = '刷新中...';
    if (typeof window.Dashboard.setRefreshStatus === 'function') {
      window.Dashboard.setRefreshStatus('正在刷新行情…', false);
    }
    try {
      const refreshTasks = [window.Dashboard.load({ force: true })];
      if (window.MarketInstitutionalFlow) refreshTasks.push(window.MarketInstitutionalFlow.load(true));
      await Promise.all(refreshTasks);
    } catch (error) {
      const message = error && error.message ? error.message : '刷新首页失败';
      if (typeof window.Dashboard.setRefreshStatus === 'function') {
        window.Dashboard.setRefreshStatus('刷新失败：' + message, true);
      }
      alert(message);
    } finally {
      refreshDashboardBtn.disabled = false;
      refreshDashboardBtn.removeAttribute('aria-busy');
      refreshDashboardBtn.textContent = originalText;
    }
  }, true);
  const searchInput = document.getElementById('searchInput');
  let searchTimer = null;
  let quoteTimer = null;
  let historyTimer = null;
  let searchSeq = 0;
  function runSearch(keyword, seq) {
    State.currentPage = 0;
    State.searchResults = keyword.trim() ? Search.searchStocks(keyword) : [];
    const source = keyword.trim() ? State.searchResults : State.allStocks;
    State.filteredStocks = source.slice(0, State.PAGE_SIZE);
    StockList.renderStockTable(State.filteredStocks);
    if (window.HotMarket) window.HotMarket.syncSearchMode();
    if (quoteTimer) clearTimeout(quoteTimer);
    quoteTimer = setTimeout(function() {
      if (seq !== searchSeq) return;
      StockList.refreshQuotes(State.filteredStocks).catch(function(error) { console.warn(error.message); });
    }, 360);
    Search.searchStocksDeep(keyword, State.searchResults).then(function(results) {
      if (!results || seq !== searchSeq || searchInput.value !== keyword) return;
      State.currentPage = 0;
      State.searchResults = results;
      State.filteredStocks = results.slice(0, State.PAGE_SIZE);
      StockList.renderStockTable(State.filteredStocks);
    });
  }
  searchInput.addEventListener('input', function(e) {
    const keyword = e.target.value;
    const seq = ++searchSeq;
    Search.toggleClearButton();
    Search.renderSearchHistory(keyword);
    if (searchTimer) clearTimeout(searchTimer);
    if (historyTimer) clearTimeout(historyTimer);
    if (keyword.trim()) {
      historyTimer = setTimeout(function() {
        if (searchInput.value === keyword) Search.saveSearchHistory(keyword);
      }, 800);
    }
    searchTimer = setTimeout(function() { runSearch(keyword, seq); }, 140);
  });
  searchInput.addEventListener('keydown', function(event) {
    if (event.key !== 'Enter') return;
    const keyword = searchInput.value.trim();
    if (keyword) Search.saveSearchHistory(keyword);
    Search.hideSearchHistory();
  });
  searchInput.addEventListener('focus', function() {
    Search.renderSearchHistory(searchInput.value);
  });
  document.getElementById('searchHistoryPanel').addEventListener('mousedown', function(event) {
    const item = event.target.closest('[data-keyword]');
    if (!item) return;
    event.preventDefault();
    searchInput.value = item.getAttribute('data-keyword');
    Search.toggleClearButton();
    Search.hideSearchHistory();
    runSearch(searchInput.value, ++searchSeq);
  });
  document.addEventListener('click', function(event) {
    if (!event.target.closest('.search-box')) Search.hideSearchHistory();
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

  document.getElementById('analysisBtn').addEventListener('click', function() {
    if (!State.currentStock) { alert('请先选择一只股票'); return; }
    Analysis.openAnalysisPanel(State.currentStock);
  });
  document.getElementById('analysisCloseBtn').addEventListener('click', Analysis.closeAnalysisPanel);
  document.getElementById('analysisOverlay').addEventListener('click', function(e) {
    if (e.target === this) Analysis.closeAnalysisPanel();
  });
  const newsDetailCloseBtn = document.getElementById('newsDetailCloseBtn');
  const newsDetailOverlay = document.getElementById('newsDetailOverlay');
  if (newsDetailCloseBtn) newsDetailCloseBtn.addEventListener('click', function() {
    if (newsDetailOverlay) newsDetailOverlay.style.display = 'none';
  });
  if (newsDetailOverlay) newsDetailOverlay.addEventListener('click', function(e) {
    if (e.target === this) newsDetailOverlay.style.display = 'none';
  });
  document.getElementById('analysisRefreshBtn').addEventListener('click', function() {
    if (State.currentStock) Analysis.openAnalysisPanel(State.currentStock, true);
  });

  bindMainNavigation();

  const watchlistGroupFilter = document.getElementById('watchlistGroupFilter');
  if (watchlistGroupFilter) watchlistGroupFilter.addEventListener('change', function() {
    Watchlist.setSelectedGroup(watchlistGroupFilter.value);
  });
  const watchlistSortSelect = document.getElementById('watchlistSortSelect');
  if (watchlistSortSelect) watchlistSortSelect.addEventListener('change', Watchlist.renderWatchlist);
  const watchlistSearchInput = document.getElementById('watchlistSearchInput');
  if (watchlistSearchInput) watchlistSearchInput.addEventListener('input', Watchlist.renderWatchlist);
  const watchlistGroupSearch = document.getElementById('watchlistGroupSearch');
  if (watchlistGroupSearch) watchlistGroupSearch.addEventListener('input', function() {
    Watchlist.renderPortfolioWatchlistTabs(Watchlist.watchlistGroups());
  });
  document.getElementById('addCurrentToWatchlistBtn').addEventListener('click', Watchlist.addCurrentStock);
  document.getElementById('refreshWatchlistBtn').addEventListener('click', Watchlist.refreshWatchlistQuotes);
  document.getElementById('syncTonghuashunWatchlistBtn').addEventListener('click', function() {
    Watchlist.syncTonghuashunWatchlist().catch(function(error) { alert(error.message || '同花顺自选同步失败'); });
  });
  document.getElementById('refreshWatchlistLevelsBtn').addEventListener('click', function() {
    Watchlist.refreshAutomaticLevels().catch(function(error) { alert(error.message || '自动点位更新失败'); });
  });
  const bulkWatchlistGroupBtn = document.getElementById('bulkWatchlistGroupBtn');
  if (bulkWatchlistGroupBtn) bulkWatchlistGroupBtn.addEventListener('click', function() {
    Watchlist.bulkSetVisibleGroup().catch(function(error) { alert(error.message || '批量分组失败'); });
  });
  const exportWatchlistCsvBtn = document.getElementById('exportWatchlistCsvBtn');
  if (exportWatchlistCsvBtn) exportWatchlistCsvBtn.addEventListener('click', Watchlist.exportVisibleWatchlistCsv);

  document.getElementById('addTradeFromPortfolioBtn').addEventListener('click', function() { Trades.openTradeModal('new'); });
  document.getElementById('refreshPortfolioBtn').addEventListener('click', Portfolio.refreshPortfolio);
  document.getElementById('syncTonghuashunHoldingsBtn').addEventListener('click', function() {
    Portfolio.syncTonghuashunHoldings().catch(function(error) { alert(error.message || '同花顺持仓同步失败'); });
  });
  document.getElementById('portfolioAccountSelect').addEventListener('change', function(event) {
    Portfolio.switchAccount(event.target.value).catch(function(error) { alert(error.message); });
  });
  document.getElementById('tradeAccountSelect').addEventListener('change', function(event) {
    Portfolio.switchAccount(event.target.value).catch(function(error) { alert(error.message); });
  });
  document.getElementById('portfolioAccountCompare').addEventListener('click', function(event) {
    const button = event.target.closest('[data-account-id]');
    if (button) Portfolio.switchAccount(button.dataset.accountId).catch(function(error) { alert(error.message); });
  });
  document.getElementById('addPortfolioAccountBtn').addEventListener('click', function() { Portfolio.openAccountModal(); });
  document.getElementById('editPortfolioAccountBtn').addEventListener('click', Portfolio.editActiveAccount);
  document.getElementById('portfolioAccountModalClose').addEventListener('click', Portfolio.closeAccountModal);
  document.getElementById('portfolioAccountModalCancel').addEventListener('click', Portfolio.closeAccountModal);
  document.getElementById('portfolioAccountModalOk').addEventListener('click', Portfolio.createAccountFromModal);
  document.getElementById('portfolioAccountDelete').addEventListener('click', Portfolio.deleteAccountFromModal);
  document.getElementById('portfolioAccountModalOverlay').addEventListener('click', function(event) {
    if (event.target === this) Portfolio.closeAccountModal();
  });
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
  ['newsDiscoveryTimeFilter', 'newsDiscoverySort', 'newsDiscoveryImageFilter'].forEach(function(id) {
    const control = document.getElementById(id);
    if (control) control.addEventListener('change', function() { window.News.load().catch(function(error) { alert(error.message); }); });
  });
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
  const screenerKnowledgeBtn = document.getElementById('screenerKnowledgeBtn');
  if (screenerKnowledgeBtn) screenerKnowledgeBtn.addEventListener('click', function() { window.StockScreener.runKnowledgeReview().catch(function(error) { alert(error.message); }); });

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
  const tonghuashunSelfGroup = State.tonghuashunCatalog && Array.isArray(State.tonghuashunCatalog.groups)
    ? State.tonghuashunCatalog.groups.find(function(group) { return group.name === '同花顺自选'; }) : null;
  setText('sidebarWatchlistCount', tonghuashunSelfGroup ? tonghuashunSelfGroup.items.length : (State.watchlist || []).length);
  const sectorDashboard = window.SectorLeaders && window.SectorLeaders.getDashboard ? window.SectorLeaders.getDashboard() : null;
  setText('sidebarSectorCount', ((sectorDashboard && sectorDashboard.overview) || []).length);
  let historyCount = 0;
  try {
    historyCount = window.AIAssistant && window.AIAssistant.getSavedResults ? window.AIAssistant.getSavedResults().length : 0;
  } catch (error) {
    historyCount = 0;
  }
  setText('sidebarAiHistoryCount', historyCount);
  setText('sidebarKnowledgeCount', window.AIResearch && window.AIResearch.getSourceCount ? window.AIResearch.getSourceCount() : 0);

  document.querySelectorAll('.sidebar-workspace-btn').forEach(function(btn) {
    const navigationView = State.currentMainView === 'portfolio' ? 'watchlist' : State.currentMainView;
    btn.classList.toggle('active', btn.getAttribute('data-main-view') === navigationView);
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

function setupPortfolioWatchlistPage() {
  const host = document.getElementById('watchlistView');
  const portfolio = document.getElementById('portfolioView');
  const tabs = document.getElementById('portfolioWatchlistTabs');
  if (!host || !portfolio || !tabs || portfolio.parentElement === host) return;
  portfolio.classList.remove('main-view');
  portfolio.classList.add('portfolio-watchlist-panel');
  host.appendChild(portfolio);
  tabs.addEventListener('click', function(event) {
    const button = event.target.closest('[data-portfolio-watchlist-tab]');
    if (!button) return;
    const kind = button.getAttribute('data-portfolio-watchlist-tab');
    if (kind === 'portfolio') {
      switchMainView('portfolio');
      return;
    }
    if (window.Watchlist) window.Watchlist.setSelectedGroup(button.getAttribute('data-group') || '');
    switchMainView('watchlist');
  });
}

function refreshPortfolioWatchlistTabState() {
  const currentKind = window.State.currentMainView === 'portfolio' ? 'portfolio' : 'watchlist';
  const currentGroup = window.Watchlist && window.Watchlist.getSelectedGroup
    ? window.Watchlist.getSelectedGroup() : '';
  document.querySelectorAll('[data-portfolio-watchlist-tab]').forEach(function(button) {
    const kind = button.getAttribute('data-portfolio-watchlist-tab');
    const group = button.getAttribute('data-group') || '';
    const active = kind === currentKind && (kind === 'portfolio' || group === currentGroup);
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function selectPortfolioWatchlistTab(view) {
  const holdings = document.getElementById('portfolioView');
  const watchlist = document.getElementById('combinedWatchlistPanel');
  const showHoldings = view === 'portfolio';
  if (holdings) holdings.style.display = showHoldings ? '' : 'none';
  if (watchlist) watchlist.style.display = showHoldings ? 'none' : '';
  refreshPortfolioWatchlistTabState();
}

window.refreshPortfolioWatchlistTabState = refreshPortfolioWatchlistTabState;

function switchMainView(view, options) {
  const State = window.State;
  options = options || {};
  State.currentMainView = view;
  if (window.EastmoneyDarkStocks) window.EastmoneyDarkStocks.sync();

  document.querySelectorAll('.main-view').forEach(function(el) {
    el.style.display = 'none';
    el.classList.remove('active');
  });

  const target = document.getElementById((view === 'portfolio' ? 'watchlist' : view) + 'View');
  if (target) {
    target.style.display = '';
    target.classList.add('active');
  }
  if (view === 'watchlist' || view === 'portfolio') selectPortfolioWatchlistTab(view);

  let navigationView = view === 'market' ? 'dashboard' : view;
  navigationView = view === 'portfolio' ? 'watchlist' : navigationView;
  document.querySelectorAll('.main-tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.getAttribute('data-main-view') === navigationView);
  });
  updateSidebarWorkspace();
  if (window.HotMarket && typeof window.HotMarket.syncSearchMode === 'function') {
    window.HotMarket.syncSearchMode();
  }
  syncMainViewHistory(view, options);

  if (view === 'watchlist') window.Watchlist.loadWatchlist().catch(function(error) { alert(error.message); });
  if (view === 'recent') window.RecentStocks.load(50).catch(function(error) { alert(error.message); });
  if (view === 'news') window.News.load().catch(function(error) { alert(error.message); });
  if (view === 'sectors') {
    if (window.HotMarket) window.HotMarket.load({ silent: true, fast: true }).catch(function(error) { console.warn(error.message); });
    if (window.ExternalResearch) window.ExternalResearch.load().catch(function(error) { console.warn(error.message); });
    window.SectorLeaders.load().catch(function(error) { alert(error.message); });
  }
  if (view === 'industryChain' && window.IndustryChain) {
    if (window.ExternalResearch) window.ExternalResearch.load().catch(function(error) { console.warn(error.message); });
    window.IndustryChain.load().then(function() {
      return window.IndustryChain.discover();
    }).catch(function(error) {
      console.warn(error && error.message ? error.message : error);
    });
  }
  if (view === 'screener') window.StockScreener.ensureLoaded().catch(function(error) { alert(error.message); });
  if (view === 'aiResearch') {
    if (window.ExpertTracker) window.ExpertTracker.bind();
    if (window.AIResearch) {
      window.AIResearch.bind();
      window.AIResearch.ensureLoaded(true).catch(function(error) { alert(error.message); });
    }
  }
  if (view === 'creatorTasks' && window.ExpertTracker) {
    window.ExpertTracker.bind();
    window.ExpertTracker.showCreatorTasks().catch(function(error) { alert(error.message); });
  }
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
  if (view === 'dashboard' && window.MarketInstitutionalFlow) {
    window.MarketInstitutionalFlow.ensureLoaded().catch(function(error) { console.warn(error.message); });
  }
  if (view === 'settings' && window.Settings) window.Settings.load().catch(function(error) { alert(error.message); });
  if (view === 'capitalFlow' && window.CapitalFlow) {
    if (window.SectorRotation) window.SectorRotation.run();
    const capitalFlowCode = document.getElementById('capitalFlowCode');
    if (capitalFlowCode && State.currentStock && State.currentStock.code) capitalFlowCode.value = State.currentStock.code;
    window.CapitalFlow.bind();
    window.CapitalFlow.resize();
  }
  if (view === 'capitalFlow' && window.MarketInstitutionalFlow) {
    window.MarketInstitutionalFlow.ensureLoaded().catch(function(error) {
      console.warn(error && error.message ? error.message : error);
    });
  }
  if (view === 'compoundLab' && window.CompoundLab) {
    window.CompoundLab.ensureLoaded().then(function() { window.CompoundLab.resize(); }).catch(function(error) {
      console.warn(error && error.message ? error.message : error);
    });
  }
  if (view === 'commentStrategy' && window.CommentStrategyLab) {
    window.CommentStrategyLab.ensureLoaded().catch(function(error) {
      console.warn(error && error.message ? error.message : error);
    });
  }
  if (window.RealtimeChart && typeof window.RealtimeChart.syncRefreshSchedule === 'function') {
    const marketDetailVisible = view === 'market' && (!window.MarketOverview || window.MarketOverview.isDetail());
    window.RealtimeChart.syncRefreshSchedule({ immediate: marketDetailVisible }).catch(function(error) {
      console.warn(error && error.message ? error.message : error);
    });
  }
  if (window.LiveRefresh && typeof window.LiveRefresh.sync === 'function') {
    window.LiveRefresh.sync({ immediate: false });
  }
  if (window.MarketComparison && typeof window.MarketComparison.resize === 'function') {
    setTimeout(function() { window.MarketComparison.resize(); }, 0);
  }
}

window.switchMainView = switchMainView;
window.updateSidebarWorkspace = updateSidebarWorkspace;

window.addEventListener('popstate', function(event) {
  if (!event.state || !event.state.mainView) return;
  switchMainView(event.state.mainView, { history: false });
});

let chartResizeTimer = null;
function resizeMarketCharts() {
  clearTimeout(chartResizeTimer);
  chartResizeTimer = setTimeout(function() {
    ['klineChart', 'timeChart', 'volumeChart'].forEach(function(key) {
      const chart = window.State && window.State[key];
      if (chart && typeof chart.resize === 'function') chart.resize();
    });
    if (window.State && window.State.currentMainView === 'capitalFlow' && window.CapitalFlow) window.CapitalFlow.resize();
    if (window.State && window.State.currentMainView === 'compoundLab' && window.CompoundLab) window.CompoundLab.resize();
    if (window.MarketComparison && typeof window.MarketComparison.resize === 'function') window.MarketComparison.resize();
    if (window.VolumePace && typeof window.VolumePace.resize === 'function') window.VolumePace.resize();
  }, 60);
}
window.addEventListener('resize', resizeMarketCharts);
window.addEventListener('orientationchange', resizeMarketCharts);

if ('serviceWorker' in navigator) {
  const hadServiceWorkerController = Boolean(navigator.serviceWorker.controller);
  let serviceWorkerRefreshStarted = false;
  navigator.serviceWorker.addEventListener('controllerchange', function() {
    if (!hadServiceWorkerController || serviceWorkerRefreshStarted) return;
    serviceWorkerRefreshStarted = true;
    window.location.reload();
  });
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/sw.js').then(function(registration) {
      return registration.update();
    }).catch(function(error) {
      console.warn('Service worker registration failed:', error.message);
    });
  });
}

document.querySelectorAll('.period-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    const State = window.State;
    const KlineChart = window.KlineChart;
    const period = this.getAttribute('data-period');
    if (period === State.currentPeriod &&
        ((period === 'minute' && State.currentView === 'realtime') ||
         (period !== 'minute' && State.currentView === 'kline'))) return;

    document.querySelectorAll('.period-btn').forEach(function(b) { b.classList.remove('active'); });
    this.classList.add('active');

    State.currentPeriod = period;
    if (period === 'minute') {
      RealtimeChart.showRealtimeView();
    } else {
      RealtimeChart.showKlineView(period);
    }
  });
});

async function init() {
  const State = window.State;
  const StockList = window.StockList;

  applyUiStyle(readStoredUiStyle(), false);

  // Bind navigation before the first network wait so early user clicks are never dropped.
  bindMarketDrawer();
  bindMainNavigation();
  if (window.MarketComparison) window.MarketComparison.bind();
  setupPortfolioWatchlistPage();
  const initialDashboardLoad = window.Dashboard
    ? window.Dashboard.load().catch(function(error) { console.warn(error.message); })
    : Promise.resolve();
  if (window.MarketInstitutionalFlow) {
    window.MarketInstitutionalFlow.ensureLoaded().catch(function(error) { console.warn(error.message); });
  }
  if (window.NetworkHealth) window.NetworkHealth.start();
  if (window.News && window.News.loadSidebarNews) {
    window.News.loadSidebarNews().catch(function(error) { console.warn(error.message); });
  }
  if (window.AIResearch && typeof window.AIResearch.prefetchModels === 'function') {
    window.AIResearch.prefetchModels().catch(function(error) { console.warn(error.message); });
  }
  State.allStocks = await window.ApiClient.fetchJsonData('/api/stocklist');
  State.filteredStocks = State.allStocks.slice(0, State.PAGE_SIZE);
  if (window.Watchlist) await window.Watchlist.loadWatchlist({ skipQuotes: true });
  if (window.Watchlist && window.Watchlist.scheduleMorningMaintenance) window.Watchlist.scheduleMorningMaintenance();
  if (window.RecentStocks) await window.RecentStocks.load(20).catch(function() {});
  StockList.renderStockTable(State.filteredStocks);
  setTimeout(function() {
    StockList.refreshQuotes(State.filteredStocks).catch(function(error) { console.warn(error.message); });
  }, 0);
  bindButtons();
  const rawRequestedView = window.location.hash ? decodeURIComponent(window.location.hash.slice(1)) : '';
  const requestedView = rawRequestedView;
  if (requestedView && document.getElementById(requestedView + 'View')) {
    switchMainView(requestedView, { replace: true });
  } else {
    updateSidebarWorkspace();
    syncMainViewHistory(State.currentMainView, { replace: true });
  }
  if (window.HotMarket) window.HotMarket.load({ silent: true, fast: true }).catch(function(error) { console.warn(error.message); });
  StockList.setupInfiniteScroll();
  if (window.LiveRefresh) window.LiveRefresh.sync({ immediate: false });

  const pingAn = State.allStocks.find(function(s) { return s.code === '000001'; });
  if (pingAn) {
    StockList.primeStock(pingAn);
  }
  if (window.Dashboard) {
    initialDashboardLoad.finally(function() {
      window.Dashboard.refreshCards();
    });
  }
}

init();
