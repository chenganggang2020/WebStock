(async function() {
  // Scope to real chart/search/watchlist UI. Unrelated services are not initialized.
  for (const key of ['Dashboard','StockDetail','DecisionGuide','MarketOverview','News','NetworkHealth','LiveRefresh','HotMarket','AIAssistant','ExpertTracker','AIHistory','Settings','AIResearch','CapitalFlow','MarketInstitutionalFlow','CompoundLab']) window[key] = null;
  RecentStocks.record = async () => {};
  applyUiStyle('clarity', false);
  State.allStocks = await ApiClient.fetchJsonData('/api/stocklist');
  State.filteredStocks = State.allStocks;
  State.watchlist = await ApiClient.fetchJsonData('/api/watchlist');
  bindMarketDrawer(); bindMainNavigation(); bindButtons();
  CompactTerminal.bind(); HomeTerminal.bind();
  FixedWorkspace.prepare(); FixedWorkspace.show('dashboard');
  document.getElementById('networkHealthMode').textContent = '隔离夹具验收 · 合成行情 · 无生产数据库';
  StockList.renderStockTable(State.filteredStocks);
  HomeTerminal.ensureSelection();
  window.desktopFixtureReady = true;
})();
