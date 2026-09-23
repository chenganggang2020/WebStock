const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) {
  test.use({ launchOptions: { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } });
}

const testDbPath = path.join(os.tmpdir(), 'webstock-mobile-dashboard-' + process.pid + '.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
}
process.env.WEBSTOCK_DB_PATH = testDbPath;
process.env.NODE_ENV = 'test';
process.env.OPENAI_API_KEY = '';
process.env.WEBSTOCK_DISABLE_SINA_NEWS = '1';
process.env.WEBSTOCK_HOT_MARKET_OFFLINE = '1';
process.env.WEBSTOCK_SENTIMENT_OFFLINE = '1';
process.env.WEBSTOCK_STOCK_PROFILE_OFFLINE = '1';

const app = require('../server');
let server;
let baseURL;

test.beforeAll(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseURL = 'http://127.0.0.1:' + server.address().port;
});

test.afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
  }
});

function mobileSnapshot() {
  const news = Array.from({ length: 12 }, (_, index) => ({
    id: 'news-' + index,
    title: index === 0 ? '重点政策推动产业链更新' : '连续资讯 ' + (index + 1),
    source: 'Fixture Wire', provider: 'Fixture Wire',
    time: '2026-08-14T01:' + String(50 - index).padStart(2, '0') + ':00.000Z',
    summary: '用于验证手机资讯连续向下展示。', link: 'https://example.com/news/' + index,
    imageUrl: index === 0 ? 'https://example.com/image.jpg' : null,
    relatedStocks: index === 0 ? ['000001'] : [], relatedSectors: [],
    importance: index === 0
      ? { score: 78, level: 'high', label: '重点', reason: '明确政策事件词，可复算。' }
      : { score: 10, level: 'low', label: '一般', reason: '暂无重点信号。' }
  }));
  return {
    schema: 'webstock.mobile-snapshot/v1', generatedAt: '2026-08-14T02:00:00.000Z', mode: 'read-only',
    accounts: [{
      id: 1, name: '默认账户', isDefault: true, valuationStatus: 'live', observedAt: '2026-08-14 10:00:00',
      source: { label: '本机行情快照', stale: false },
      summary: { cashBalance: 500, totalAssets: 1500, totalMarketValue: 1000, totalCost: 900, unrealizedPnl: 100, totalPnl: 100, todayPnl: 20, realizedPnl: 0, lifetimeBuyCost: 900 },
      positions: [{ code: '000001', name: '平安银行', quantity: 100, costValue: 900, currentPrice: 10, marketValue: 1000, unrealizedPnl: 100, change: 1 }]
    }],
    watchlist: { status: 'available', items: [{ code: '600519', name: '贵州茅台', currentPrice: 1400, change: -0.5, groupName: '核心' }], observation: {} },
    news: { status: 'available', items: news, pagination: { returned: 12, hasMore: false } },
    capitalMomentum: {
      status: 'available', target: { code: '000001', name: '平安银行' },
      source: { provider: '授权分类资金源', truthStatement: '供应商分类口径，不等于交易所事实。' },
      observation: { observedAt: '2026-08-14T01:59:00.000Z' },
      latest: { timestamp: '2026-08-14T01:59:00.000Z', netAmount: 12000000, netFlowSpeed: -250000, netFlowAcceleration: -10000, flowState: { label: '正流入回吐' } },
      points: [1000000, 4000000, 12000000].map((netAmount, index) => ({ netAmount, timestamp: '2026-08-14T01:5' + index + ':00.000Z' }))
    },
    screener: { status: 'available', taskName: '已保存全市场技术候选', candidates: [{ code: '688981', name: '中芯国际', score: 88, reasons: ['量价确认'], risks: ['波动风险'] }] },
    latestGptPicks: { status: 'available', title: 'ChatGPT 8月14日候选', analysisExcerpt: '等待量价确认', picks: [{ code: '600519', name: '贵州茅台', score: null, reasons: ['现金流稳定'], risks: ['需求风险'], originalAnalysis: '仅作观察' }] },
    research: { totals: { observationCount: 10, videoCount: 5, transcriptCount: 4, archiveCount: 5 }, channels: [] }
  };
}

for (const viewport of [{ width: 390, height: 844 }, { width: 430, height: 932 }]) {
  test('mobile intelligence dashboard is complete at ' + viewport.width + 'px', async ({ page }) => {
    await page.setViewportSize(viewport);
    let snapshotReads = 0;
    let quoteReads = 0;
    await page.route('**/api/mobile/snapshot', route => {
      snapshotReads += 1;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: mobileSnapshot() }) });
    });
    await page.route('**/api/quote/snapshot?**', route => {
      quoteReads += 1;
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            { code: '000001', name: '平安银行', price: 10.12, change: 2.2, quoteStatus: 'live', fetchedAt: '2026-08-14T02:00:03.000Z', changedAt: '2026-08-14T02:00:03.000Z', source: 'sina-public-quote', stale: false },
            { code: '600519', name: '贵州茅台', price: 1401, change: -0.4, quoteStatus: 'live', fetchedAt: '2026-08-14T02:00:03.000Z', changedAt: '2026-08-14T02:00:03.000Z', source: 'sina-public-quote', stale: false }
          ],
          meta: { source: 'sina-public-quote', fetchedAt: '2026-08-14T02:00:03.000Z', stale: false, localReadIntervalMs: 1000, upstreamMinIntervalMs: 3000, realtimeGuaranteed: false }
        })
      });
    });

    await page.goto(baseURL + '/mobile.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.position-section')).toContainText('平安银行');
    await expect(page.locator('.watchlist-panel')).toContainText('贵州茅台');
    await expect(page.locator('.screener-panel')).toContainText('中芯国际');
    await expect(page.locator('.gpt-picks-panel')).toContainText('ChatGPT 8月14日候选');
    await expect(page.locator('.gpt-picks-panel')).not.toContainText('分析分');
    await expect(page.locator('.capital-panel')).toContainText('正流入回吐');
    await expect(page.locator('.capital-sparkline')).toBeVisible();
    await expect(page.locator('.news-row')).toHaveCount(12);
    await expect(page.locator('.news-row.important')).toContainText('标识原因');
    await expect(page.locator('.news-row.important .importance-tag')).toContainText('重点');
    await expect(page.locator('.news-thumbnail')).toHaveCount(1);

    await expect.poll(() => quoteReads, { timeout: 4500 }).toBeGreaterThanOrEqual(1);
    await expect(page.locator('[data-position-code="000001"] [data-position-field="currentPrice"]')).toHaveText('10.12');
    expect(snapshotReads).toBe(1);
    const overflow = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.width);
  });
}
