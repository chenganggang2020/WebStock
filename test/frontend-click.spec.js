const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDbPath = path.join(os.tmpdir(), 'webstock-frontend-' + process.pid + '.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
}
process.env.WEBSTOCK_DB_PATH = testDbPath;
process.env.OPENAI_API_KEY = '';

const app = require('../server');

let server;
let baseURL;
let allowApiFetchNonJsonConsole = false;

test.beforeAll(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseURL = 'http://127.0.0.1:' + server.address().port;
});

test.afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
});

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => {
    throw error;
  });
  page.on('console', msg => {
    const text = msg.text();
    const isApiFetchNonJson = /Interface returned non JSON|接口返回非 JSON|鎺ュ彛杩斿洖闈?JSON/.test(text);
    if (msg.type() === 'error' && (/Unexpected token/.test(text) || (isApiFetchNonJson && !allowApiFetchNonJsonConsole))) {
      throw new Error(msg.text());
    }
  });
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.includes('echarts')) {
      return route.fulfill({ contentType: 'application/javascript', body: 'window.echarts={init:function(){return {setOption:function(){},resize:function(){},dispose:function(){},on:function(){}}}};' });
    }
    if (url.includes('/api/quote')) {
      const codes = new URL(url).searchParams.get('codes').split(',');
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(codes.map(code => ({ code, name: code === '000001' ? '平安银行' : code, price: 11.28, change: -0.18, open: 11.29, high: 11.31, low: 11.16, prevClose: 11.3, amount: 100000000 })))
      });
    }
    if (url.includes('/api/minute')) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ time: '2026-05-11 09:30:00', price: 11.28, volume: 10000, amount: 112800 }]) });
    }
    if (url.includes('/api/kline')) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ date: '2026-05-11', open: 11, close: 11.28, high: 11.4, low: 10.9, volume: 10000, amount: 112800 }]) });
    }
    if (url.includes('/api/analysis-stream')) {
      return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"type":"simulated","prompt":"测试提示词：仅供研究，不构成投资建议。"}\n\n' });
    }
    if (url.includes('/api/sector-leaders/1') && route.request().method() === 'PUT') {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { id: 1, sectorId: 1, code: '000001', name: '平安银行', role: '趋势龙头', note: '编辑测试', weight: 1 } })
      });
    }
    if (url.includes('/api/sector-leaders/1') && route.request().method() === 'DELETE') {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { deleted: true } })
      });
    }
    if (url.includes('/api/sector-leaders/snapshots') && route.request().method() === 'GET') {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [{ code: '000001', name: '平安银行', sectorName: '测试板块', price: 11.28, change: 1.2, amount: 1000000, capturedAt: '2026-05-12T00:00:00.000Z' }]
        })
      });
    }
    if (url.includes('/api/sector-leaders/dashboard')) {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            sectors: [{
              id: 1,
              name: '测试板块',
              description: '测试',
              status: '偏强',
              leaders: [{
                id: 1,
                sectorId: 1,
                code: '000001',
                name: '平安银行',
                role: '观察股',
                price: 11.28,
                change: 1.2,
                amount: 100000000,
                strength: '平',
                note: '测试',
                weight: 1
              }]
            }],
            overview: [{ id: 1, sectorName: '测试板块', code: '000001', name: '平安银行', role: '观察股', price: 11.28, change: 1.2, amount: 100000000, strength: '平', note: '测试', weight: 1 }],
            risks: []
          }
        })
      });
    }
    return route.continue();
  });
});

test('main stock actions and workspace navigation do not throw', async ({ page }) => {
  const dialogResponses = [];
  const dialogMessages = [];
  page.on('dialog', async dialog => {
    dialogMessages.push(dialog.message());
    const next = dialogResponses.length ? dialogResponses.shift() : '';
    if (dialog.type() === 'confirm') await dialog.accept();
    else await dialog.accept(next);
  });

  await page.goto(baseURL + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#stockTbody tr');
  await expect(page.locator('#themeToggle')).toHaveAttribute('aria-label', /切换/);
  await expect(page.locator('#clearBtn')).toHaveAttribute('aria-label', /清空/);

  await expect(page.locator('#sidebarWorkspaceNav')).toBeVisible();
  await expect(page.locator('#sidebarWatchlistBtn')).toContainText('泽哥自选');
  await expect(page.locator('#stockTbody tr:first-child [data-action]')).toHaveCount(0);
  await page.click('#stockTbody tr:first-child');
  await expect(page.locator('#analysisBtn')).toBeVisible();
  await expect(page.locator('#chartTitle')).toContainText('平安银行');
  await expect.poll(() => page.evaluate(() => Object.keys(window.State.klineSnapshots || {}).length)).toBeGreaterThan(0);

  await page.click('#stockTbody tr:first-child .star-btn');
  await page.click('#sidebarWatchlistBtn');
  await expect(page.locator('#watchlistView')).toBeVisible();
  await expect(page.locator('#watchlistTbody')).toContainText('000001');
  dialogResponses.push('测试分组', '测试备注', '10', '8');
  await page.click('#watchlistTbody [data-action="edit"]');
  await expect(page.locator('#watchlistTbody')).toContainText('测试备注');
  await expect(page.locator('#watchlistTbody')).toContainText('Alert high');
  dialogResponses.push('批量测试分组');
  await page.click('#bulkWatchlistGroupBtn');
  await expect(page.locator('#watchlistTbody')).toContainText('批量测试分组');
  await page.fill('#watchlistSearchInput', '批量测试分组');
  await expect(page.locator('#watchlistTbody')).toContainText('000001');
  await page.fill('#watchlistSearchInput', 'no-watchlist-match');
  await expect(page.locator('#watchlistEmpty')).toBeVisible();
  await page.fill('#watchlistSearchInput', '');
  const watchlistExportPromise = page.waitForEvent('download');
  await page.click('#exportWatchlistCsvBtn');
  const watchlistExport = await watchlistExportPromise;
  expect(watchlistExport.suggestedFilename()).toMatch(/^webstock-watchlist-/);
  await page.click('#watchlistTbody [data-action="view"]');
  await expect(page.locator('#detailWatchlistStatus')).toContainText('Alert high');

  await page.click('#analysisBtn');
  await expect(page.locator('#analysisOverlay')).toBeVisible();
  await expect(page.locator('#analysisPanelBody')).toContainText('测试提示词');

  await page.click('#analysisCloseBtn');
  await page.click('[data-main-view="recent"]');
  await expect(page.locator('#recentView')).toBeVisible();
  await page.fill('#recentSearchInput', '000001');
  await expect(page.locator('#recentStocksTbody')).toContainText('000001');
  await page.fill('#recentSearchInput', 'no-recent-match');
  await expect(page.locator('#recentStocksEmpty')).toBeVisible();
  await page.fill('#recentSearchInput', '');
  await page.selectOption('#recentSortSelect', 'view_count');
  const recentExportPromise = page.waitForEvent('download');
  await page.click('#exportRecentStocksCsvBtn');
  const recentExport = await recentExportPromise;
  expect(recentExport.suggestedFilename()).toMatch(/^webstock-recent-stocks-/);

  await page.click('[data-main-view="news"]');
  await expect(page.locator('#newsView')).toBeVisible();
  await expect(page.locator('#newsProviderStatus')).toContainText(/News provider|fallback/i);
  await page.fill('#newsKeywordInput', 'definitely-no-news-match');
  await page.press('#newsKeywordInput', 'Enter');
  await expect(page.locator('#newsList')).toContainText('No news is available');
  await page.fill('#newsKeywordInput', 'Workbench');
  await page.click('#refreshNewsBtn');
  await expect(page.locator('#newsList')).toContainText('Workbench checklist');
  await expect(page.locator('#newsList')).toContainText('1 items');
  await page.fill('#newsKeywordInput', '');
  await page.click('#refreshNewsBtn');

  await page.click('[data-main-view="watchlist"]');
  await expect(page.locator('#watchlistView')).toBeVisible();

  await page.click('[data-main-view="portfolio"]');
  await expect(page.locator('#portfolioView')).toBeVisible();
  await page.click('#addTradeFromPortfolioBtn');
  await expect(page.locator('#tradeModalOverlay')).toBeVisible();
  await page.fill('#tradeCodeInput', '000001');
  await page.fill('#tradeNameInput', '=Ping An Bank');
  await page.selectOption('#tradeSideInput', 'buy');
  await page.fill('#tradePriceInput', '10');
  await page.fill('#tradeQuantityInput', '1000');
  await expect(page.locator('#tradeAmountPreview')).toContainText('10000.00');
  await page.click('#tradeModalOk');
  await expect(page.locator('#positionsTbody')).toContainText('000001', { timeout: 15000 });
  await expect(page.locator('#closedPositionsPanel')).toContainText('No closed positions yet');
  await page.fill('#positionSearchInput', '000001');
  await expect(page.locator('#positionsTbody')).toContainText('000001');
  await page.selectOption('#positionSortSelect', 'return');
  await page.fill('#positionSearchInput', 'no-position-match');
  await expect(page.locator('#portfolioEmpty')).toContainText('No positions match current filters');
  await page.fill('#positionSearchInput', '');
  const positionsDownloadPromise = page.waitForEvent('download');
  await page.click('#exportPositionsCsvBtn');
  const positionsDownload = await positionsDownloadPromise;
  expect(positionsDownload.suggestedFilename()).toMatch(/^webstock-positions-/);
  const positionsCsv = fs.readFileSync(await positionsDownload.path(), 'utf8');
  expect(positionsCsv).toContain('code,name,quantity');
  expect(positionsCsv).toContain('000001');
  expect(positionsCsv).toContain("'=Ping An Bank");
  const tradesDownloadPromise = page.waitForEvent('download');
  await page.click('#exportTradesFromPortfolioBtn');
  const tradesDownload = await tradesDownloadPromise;
  expect(tradesDownload.suggestedFilename()).toBe('webstock-trades.csv');
  await page.click('#positionsTbody [data-action="sell"]');
  await expect(page.locator('#tradeModalOverlay')).toBeVisible();
  await expect(page.locator('#tradeAmountPreview')).toContainText('Estimated inflow');
  await page.fill('#tradeQuantityInput', '2000');
  await page.click('#tradeModalOk');
  await expect.poll(() => dialogMessages.some(message => message.includes('卖出数量不能超过当前持仓'))).toBeTruthy();
  await page.click('#tradeModalCancel');
  await expect(page.locator('#tradeModalOverlay')).toBeHidden();

  await page.click('#addTradeFromPortfolioBtn');
  await expect(page.locator('#tradeModalOverlay')).toBeVisible();
  await page.fill('#tradeCodeInput', '000002');
  await page.fill('#tradeNameInput', '=Export Test');
  await page.selectOption('#tradeSideInput', 'buy');
  await page.fill('#tradePriceInput', '8');
  await page.fill('#tradeQuantityInput', '100');
  await page.click('#tradeModalOk');
  await expect(page.locator('#positionsTbody')).toContainText('000002');
  await page.click('#positionsTbody [data-action="sell"][data-code="000002"]');
  await expect(page.locator('#tradeModalOverlay')).toBeVisible();
  await page.fill('#tradeQuantityInput', '100');
  await page.click('#tradeModalOk');
  await expect(page.locator('#closedPositionsPanel')).toContainText('000002');
  await expect(page.locator('#closedPositionsPanel')).toContainText('Win rate');
  const closedDownloadPromise = page.waitForEvent('download');
  await page.click('#closedPositionsPanel [data-action="exportClosedPositions"]');
  const closedDownload = await closedDownloadPromise;
  expect(closedDownload.suggestedFilename()).toMatch(/^webstock-closed-positions-/);
  const closedCsv = fs.readFileSync(await closedDownload.path(), 'utf8');
  expect(closedCsv).toContain('code,name,realized_pnl');
  expect(closedCsv).toContain('000002');
  expect(closedCsv).toContain("'=Export Test");

  await page.click('[data-main-view="trades"]');
  await expect(page.locator('#tradesView')).toBeVisible();
  await page.fill('#tradeCodeFilter', '000002');
  await page.selectOption('#tradeSideFilter', 'sell');
  await expect(page.locator('#tradesTbody')).toContainText('000002');
  await page.click('#resetTradeFiltersBtn');
  await expect(page.locator('#tradeCodeFilter')).toHaveValue('');
  await expect(page.locator('#tradeSideFilter')).toHaveValue('');
  await expect(page.locator('#tradesTbody')).toContainText('000001');
  await expect(page.locator('#tradesResultSummary')).toContainText('Showing');
  await page.fill('#tradeCodeFilter', 'no-trade-match');
  await expect(page.locator('#tradesEmpty')).toContainText('No trades match current filters');
  await expect(page.locator('#tradesResultSummary')).toContainText('No trades match current filters');
  await page.click('#resetTradeFiltersBtn');
  await expect(page.locator('#tradesTbody')).toContainText('000001');

  await page.click('[data-main-view="screener"]');
  await expect(page.locator('#screenerView')).toBeVisible();
  await expect(page.locator('#screenerStrategyHint')).toContainText('Stable watchlist');
  await page.selectOption('#screenerStrategy', 'breakout');
  await expect(page.locator('#screenerStrategyHint')).toContainText('Trend breakout');
  await page.click('#runScreenerBtn');
  await expect(page.locator('#screenerResults')).toContainText('不构成投资建议');
  await expect(page.locator('#screenerResults .factor-tag').first()).toBeVisible();
  await expect(page.locator('#screenerResults .factor-impact').first()).toBeVisible();
  await expect(page.locator('#screenerResults .screener-result-summary')).toContainText(/Showing/);
  await page.fill('#screenerMinScoreInput', '101');
  await expect(page.locator('#screenerResults')).toContainText('No candidates match current result filters');
  await page.click('#resetScreenerFiltersBtn');
  await expect(page.locator('#screenerMinScoreInput')).toHaveValue('0');
  await expect(page.locator('#screenerResults .factor-tag').first()).toBeVisible();
  await page.fill('#screenerResultKeywordInput', '000001');
  await expect(page.locator('#screenerResults .factor-tag').first()).toBeVisible();
  await page.fill('#screenerResultKeywordInput', '');
  const csvDownloadPromise = page.waitForEvent('download');
  await page.click('#exportScreenerCsvBtn');
  const csvDownload = await csvDownloadPromise;
  expect(csvDownload.suggestedFilename()).toMatch(/^webstock-screener-/);
  dialogResponses.push('Playwright screener save');
  await page.click('#saveScreenerResultBtn');
  await expect(page.locator('#screenerHistory')).toContainText('Playwright screener save');
  dialogResponses.push('Playwright screener renamed');
  await page.click('#screenerHistory [data-history-action="rename"]');
  await expect(page.locator('#screenerHistory')).toContainText('Playwright screener renamed');
  await page.click('#runScreenerBtn');
  dialogResponses.push('Playwright screener second');
  await page.click('#saveScreenerResultBtn');
  await expect(page.locator('#screenerHistory')).toContainText('Playwright screener second');
  await expect(page.locator('#screenerHistory')).toContainText('Compare latest two');
  await page.click('#screenerHistory [data-history-action="compare-latest"]');
  await expect(page.locator('#screenerResults')).toContainText('Saved screener comparison');
  await expect(page.locator('#screenerResults')).toContainText('Playwright screener renamed');
  await page.click('#screenerHistory [data-history-action="details"]');
  await expect(page.locator('#screenerResults')).toContainText('Saved screener task');
  await expect(page.locator('#screenerResults')).toContainText('Playwright screener second');
  dialogResponses.push('priority', 'Playwright candidate note');
  await page.click('#screenerResults [data-detail-action="review"]');
  await expect(page.locator('#screenerResults')).toContainText('priority');
  await expect(page.locator('#screenerResults')).toContainText('Playwright candidate note');
  await expect(page.locator('#screenerResults .review-summary')).toContainText('priority: 1');
  await page.selectOption('#candidateReviewFilter', 'priority');
  await expect(page.locator('#screenerResults')).toContainText('Playwright candidate note');
  await page.selectOption('#candidateReviewFilter', 'all');
  await page.click('[data-main-view="dashboard"]');
  await expect(page.locator('#dashboardScreenerReviewList')).toContainText('priority 1');
  await page.click('#refreshDashboardBtn');
  await expect(page.locator('#dashboardUpdatedAt')).toContainText('Last refreshed:');
  await expect(page.locator('#refreshDashboardBtn')).toHaveText(/工作台/);
  await expect(page.locator('#refreshDashboardBtn')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#refreshDashboardBtn')).toBeEnabled();
  await expect(page.locator('#dashboardView')).toBeVisible();
  await page.click('#dashboardScreenerReviewList [data-screener-id]');
  await expect(page.locator('#screenerView')).toBeVisible();
  await expect(page.locator('#screenerResults')).toContainText('Saved screener task');
  await expect(page.locator('#screenerResults')).toContainText('Playwright candidate note');
  dialogResponses.push('done', 'Playwright bulk note');
  await page.click('#screenerResults [data-detail-action="bulkReview"]');
  await expect(page.locator('#screenerResults')).toContainText('done');
  await expect(page.locator('#screenerResults')).toContainText('Playwright bulk note');
  await page.click('#screenerHistory [data-history-action="compare-selected"]');
  await expect(page.locator('#screenerResults')).toContainText('Saved screener comparison');
  await page.click('#screenerAiBtn');
  await expect(page.locator('#handoffModalOverlay')).toBeVisible();
  await page.fill('#handoffResultText', 'ChatGPT 返回结果测试');
  await page.click('#handoffSaveBtn');
  await expect(page.locator('#handoffModalOverlay')).toBeHidden();
  await expect(page.locator('#screenerHistory')).toContainText('AI saved');
  await expect(page.locator('#screenerResults')).toContainText('ChatGPT 返回结果测试');
  await page.click('[data-main-view="aiHistory"]');
  await expect(page.locator('#aiHistoryView')).toBeVisible();
  await expect(page.locator('#aiHistoryList')).toContainText('ChatGPT 返回结果测试');
  await expect(page.locator('#aiHistoryList')).toContainText('智能选股');
  await page.click('[data-main-view="screener"]');
  await page.click('#screenerHistory [data-history-action="delete"]');
  await expect(page.locator('#screenerHistory')).toContainText('Playwright screener renamed');
  await page.click('#screenerHistory [data-history-action="delete"]');
  await expect(page.locator('#screenerHistory')).toContainText('No saved screener tasks');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('webstock_ai_handoff_results') || '[]'));
  expect(saved[0].result).toContain('ChatGPT 返回结果测试');

  await page.click('[data-main-view="settings"]');
  await expect(page.locator('#settingsView')).toBeVisible();
  await expect(page.locator('#settingsAiStatus')).toContainText(/Handoff mode|Enabled/);
  await expect(page.locator('#savedHandoffResults')).toContainText('ChatGPT');
  await expect(page.locator('#exportUserDataBtn')).toBeVisible();
  await expect(page.locator('#importUserDataBtn')).toBeVisible();
  const watchlistTemplatePromise = page.waitForEvent('download');
  await page.click('#downloadWatchlistTemplateBtn');
  const watchlistTemplate = await watchlistTemplatePromise;
  expect(watchlistTemplate.suggestedFilename()).toBe('webstock-watchlist-template.csv');
  const tradesTemplatePromise = page.waitForEvent('download');
  await page.click('#downloadTradesTemplateBtn');
  const tradesTemplate = await tradesTemplatePromise;
  expect(tradesTemplate.suggestedFilename()).toBe('webstock-trades-template.csv');
  await page.fill('#riskDrawdownInput', '5');
  await page.fill('#riskDailyDropInput', '2');
  await page.fill('#riskLeaderDropInput', '2');
  await page.click('#saveRiskSettingsBtn');
  await expect(page.locator('#settingsRiskStatus')).toContainText('saved');
  await page.click('#resetRiskSettingsBtn');
  await expect(page.locator('#settingsRiskStatus')).toContainText('reset to defaults');
  await expect(page.locator('#riskDrawdownInput')).toHaveValue('8');
  await expect(page.locator('#riskDailyDropInput')).toHaveValue('3');
  await expect(page.locator('#riskLeaderDropInput')).toHaveValue('3');

  const sectorLeaders = [{
    id: 1,
    sectorId: 1,
    code: '000001',
    name: 'Ping An Bank',
    role: 'observe',
    price: 11.28,
    change: 1.2,
    amount: 100000000,
    strength: 'flat',
    note: 'test',
    weight: 1
  }];
  await page.route('**/api/sectors/1/leaders', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const body = JSON.parse(route.request().postData() || '{}');
    const leader = Object.assign({
      id: 2,
      sectorId: 1,
      price: 10.1,
      change: 0.8,
      amount: 50000000,
      strength: 'flat',
      weight: 1
    }, body);
    sectorLeaders.push(leader);
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: leader }) });
  });
  await page.route('**/api/sector-leaders/dashboard', route => {
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          sectors: [{ id: 1, name: 'Test Sector', description: 'test', status: 'flat', leaders: sectorLeaders }],
          overview: sectorLeaders.map(item => Object.assign({ sectorName: 'Test Sector' }, item)),
          risks: []
        }
      })
    });
  });
  await page.click('[data-main-view="sectors"]');
  await expect(page.locator('#sectorsView')).toBeVisible();
  await page.evaluate(() => window.SectorLeaders.load());
  await expect(page.locator('#sectorDashboard')).toContainText('编辑');
  await expect(page.locator('#sectorDashboard')).toContainText('删除');
  await expect(page.locator('#sectorDashboard')).toContainText('History');
  dialogResponses.push('000002', 'Added Leader', '趋势龙头', 'added note');
  await page.click('#sectorDashboard [data-action="addLeader"]');
  await expect(page.locator('#sectorDashboard')).toContainText('Added Leader');
  await expect(page.locator('#sectorDashboard')).toContainText('added note');
  await page.selectOption('#sectorRoleFilter', '趋势龙头');
  await expect(page.locator('#sectorDashboard')).toContainText('Added Leader');
  await expect(page.locator('#sectorDashboard')).not.toContainText('Ping An Bank');
  await page.selectOption('#sectorRoleFilter', '');
  await page.fill('#sectorKeywordFilter', 'Added');
  await expect(page.locator('#sectorDashboard')).toContainText('Added Leader');
  await expect(page.locator('#sectorDashboard')).not.toContainText('Ping An Bank');
  await page.fill('#sectorKeywordFilter', '');
  await page.click('#sectorDashboard [data-action="leaderHistory"]');
  await expect(page.locator('#sectorDashboard')).toContainText('Leader history');
  await page.click('#sectorDashboard [data-action="backToSectors"]');
  await expect(page.locator('#sectorDashboard')).toContainText('History');
  dialogResponses.push('000001', '平安银行', '趋势龙头', '1', '编辑测试', '测试理由');
  await page.click('#sectorDashboard [data-action="editLeader"]');
  await page.click('#sectorDashboard [data-action="deleteLeader"]');
  await page.click('#sectorTrendBtn');
  await expect(page.locator('#sectorDashboard')).toContainText('Leader trends');
  const sectorDownloadPromise = page.waitForEvent('download');
  await page.click('#sectorExportSnapshotsBtn');
  const sectorDownload = await sectorDownloadPromise;
  expect(sectorDownload.suggestedFilename()).toMatch(/^webstock-sector-snapshots-/);
  const sectorConfigDownloadPromise = page.waitForEvent('download');
  await page.click('#sectorExportConfigBtn');
  const sectorConfigDownload = await sectorConfigDownloadPromise;
  expect(sectorConfigDownload.suggestedFilename()).toMatch(/^webstock-sector-config-/);
  const sectorImportPath = path.join(os.tmpdir(), 'webstock-sector-config-import-' + process.pid + '.json');
  fs.writeFileSync(sectorImportPath, JSON.stringify({
    sectors: [{
      name: 'Playwright Imported Sector',
      description: 'imported from frontend test',
      leaders: [{ code: '000003', name: 'Imported Leader', role: '观察股', note: 'frontend import' }]
    }]
  }));
  await page.setInputFiles('#sectorImportConfigFile', sectorImportPath);
  await expect.poll(() => dialogMessages.some(message => message.includes('Imported sector config'))).toBeTruthy();
  await expect(page.locator('#sectorPruneSnapshotsBtn')).toBeVisible();
  await page.click('#sectorAiBtn');
  await expect(page.locator('#handoffModalOverlay')).toBeVisible();
  await expect(page.locator('#handoffCopyOpenBtn')).toBeVisible();
  await expect(page.locator('#handoffImportClipboardBtn')).toBeVisible();
  await page.fill('#handoffResultText', '板块热股 ChatGPT 分析记录');
  await page.click('#handoffSaveBtn');
  await page.click('#sidebarAiHistoryBtn');
  await expect(page.locator('#aiHistoryView')).toBeVisible();
  await expect(page.locator('#aiHistoryList')).toContainText('板块热股 ChatGPT 分析记录');
  await expect(page.locator('#aiHistoryList')).toContainText('板块龙头');

  await page.click('[data-main-view="dashboard"]');
  await expect(page.locator('#dashboardView')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator('#dashboardWatchlistList')).toContainText('Alert high');
  await page.evaluate(() => {
    window.State.watchlist = [{ code: '000001', name: 'Ping An Bank', price: 7, alertLow: 8, alertHigh: 20 }];
    window.State.positions = [{ code: '000002', name: 'Risk Position', unrealizedPnlRate: -12, todayChange: -4 }];
    window.Dashboard.renderRisks();
  });
  await expect(page.locator('#dashboardRiskList')).toContainText('alert low reached');
  await expect(page.locator('#dashboardRiskList')).toContainText('position drawdown');
  const riskCount = await page.locator('#dashboardRiskList .risk-item').count();
  await page.locator('#dashboardRiskList [data-risk-key]').first().click();
  await expect.poll(() => page.locator('#dashboardRiskList .risk-item').count()).toBeLessThan(riskCount);
  await expect(page.locator('#dashboardRiskList')).toContainText('dismissed today');
  await page.click('#dashboardRiskList [data-risk-toggle]');
  await expect(page.locator('#dashboardRiskList .risk-item.dismissed')).toHaveCount(1);
  await page.click('#dashboardRiskList [data-risk-restore]');
  await expect.poll(() => page.locator('#dashboardRiskList .risk-item').count()).toBe(riskCount);

  await page.click('[data-main-view="stats"]');
  await expect(page.locator('#statsView')).toBeVisible();
  await expect(page.locator('#statsOverviewCards')).toContainText('Positions');
  await expect(page.locator('#statsOverviewCards')).toContainText('Watchlist');
  await expect(page.locator('#statsExposureTable')).toContainText('Top exposures');
  await expect(page.locator('#statsExposureTable')).toContainText('000001');
});

test('mobile dark mode workspace remains usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(baseURL + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#stockTbody tr');

  await page.click('#themeToggle');
  await expect(page.locator('body')).toHaveClass(/dark/);
  await expect(page.locator('#dashboardView')).toBeVisible();
  await expect(page.locator('.dashboard-grid')).toBeVisible();
  await expect(page.locator('#sidebarWorkspaceNav')).toBeVisible();

  await page.click('#stockTbody tr:first-child');
  await expect(page.locator('#marketView')).toBeVisible();
  await expect(page.locator('#analysisBtn')).toBeVisible();

  await page.click('[data-main-view="screener"]');
  await expect(page.locator('#screenerView')).toBeVisible();
  await expect(page.locator('#screenerDemand')).toBeVisible();

  await page.click('[data-main-view="sectors"]');
  await expect(page.locator('#sectorsView')).toBeVisible();
  await expect(page.locator('#sectorSortSelect')).toBeVisible();

  await page.click('[data-main-view="portfolio"]');
  await expect(page.locator('#portfolioView')).toBeVisible();
  await expect(page.locator('#addTradeFromPortfolioBtn')).toBeVisible();
  await page.click('[data-main-view="trades"]');
  await expect(page.locator('#tradesView')).toBeVisible();
  await expect(page.locator('#resetTradeFiltersBtn')).toBeVisible();
});

test('keyboard activation works for core workspace controls', async ({ page }) => {
  await page.goto(baseURL + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#stockTbody tr');

  await page.focus('#searchInput');
  await expect(page.locator('#searchInput')).toBeFocused();
  await page.keyboard.type('000001');
  await expect(page.locator('#searchInput')).toHaveValue('000001');
  await page.keyboard.press('Tab');
  await expect(page.locator('#clearBtn')).toBeFocused();
  const clearOutline = await page.locator('#clearBtn').evaluate(el => getComputedStyle(el).outlineStyle);
  expect(clearOutline).toBe('solid');
  await page.keyboard.press('Enter');
  await expect(page.locator('#searchInput')).toHaveValue('');

  await page.focus('#themeToggle');
  await expect(page.locator('#themeToggle')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).toHaveClass(/dark/);
  await page.keyboard.press('Enter');
  await expect(page.locator('body')).not.toHaveClass(/dark/);

  await page.focus('[data-main-view="screener"]');
  await page.keyboard.press('Enter');
  await expect(page.locator('#screenerView')).toBeVisible();

  await page.focus('[data-main-view="market"]');
  await page.keyboard.press('Enter');
  await expect(page.locator('#marketView')).toBeVisible();
  await page.focus('#stockTbody tr:first-child');
  await page.keyboard.press('Enter');
  await expect(page.locator('#analysisBtn')).toBeVisible();

  await page.focus('#analysisBtn');
  await page.keyboard.press('Enter');
  await expect(page.locator('#analysisOverlay')).toBeVisible();
  await page.focus('#analysisCloseBtn');
  await page.keyboard.press('Enter');
  await expect(page.locator('#analysisOverlay')).toBeHidden();
});

test('apiFetch reports HTML API responses without Unexpected token', async ({ page }) => {
  allowApiFetchNonJsonConsole = true;
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  await page.route('**/api/html-regression', route => route.fulfill({
    status: 404,
    contentType: 'text/html',
    body: '<!DOCTYPE html><html><body>missing api</body></html>'
  }));

  try {
    await page.goto(baseURL + '/', { waitUntil: 'domcontentloaded' });
    const message = await page.evaluate(async () => {
      try {
        await window.apiFetch('/api/html-regression');
        return '';
      } catch (error) {
        return error.message;
      }
    });

    expect(message).toContain('Interface returned non JSON: /api/html-regression');
    expect(consoleErrors.some(text => text.includes('Interface returned non JSON'))).toBeTruthy();
    expect(consoleErrors.some(text => text.includes('Unexpected token'))).toBeFalsy();
  } finally {
    allowApiFetchNonJsonConsole = false;
  }
});
