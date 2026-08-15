const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) {
  test.use({ launchOptions: { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } });
}

const testDbPath = path.join(os.tmpdir(), 'webstock-capital-flow-page-' + process.pid + '.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
}
process.env.WEBSTOCK_DB_PATH = testDbPath;
process.env.OPENAI_API_KEY = '';

const app = require('../server');
let server;
let baseURL;

test.beforeAll(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseURL = 'http://127.0.0.1:' + server.address().port;
});

test.afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
});

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await page.addInitScript(() => {
    window.__capitalFlowChart = {
      clearCalls: 0,
      resizeCalls: 0,
      options: [],
      clear() { this.clearCalls += 1; },
      resize() { this.resizeCalls += 1; },
      dispose() {},
      setOption(option) { this.options.push(option); },
      on() {}
    };
  });
  await page.route('**/vendor/echarts.min.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.echarts={init:function(element){if(element&&element.id==="capitalFlowChart")return window.__capitalFlowChart;return {clear:function(){},resize:function(){},dispose:function(){},setOption:function(){},on:function(){}};}};'
  }));
  await page.route('**/api/stocklist', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([{ code: '000001', name: '平安银行', pinyin: 'payh' }])
  }));
  await page.route('**/api/quote?*', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([{ code: '000001', name: '平安银行', price: 10, change: 1 }])
  }));
  await page.route('**/api/hot-market/overview*', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: { boards: { day: [], month: [] }, hotStocks: [], news: [] } })
  }));
  await page.route('**/api/sentiment/overview*', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: {} })
  }));
  await page.route('**/api/news*', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: [] })
  }));
  await page.route('**/api/capital-flow/series?*', route => {
    const source = new URL(route.request().url()).searchParams.get('source');
    if (source === 'authorized-level2') {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: {
          schema: 'webstock.capital-flow.v1', availability: 'unavailable', scope: 'stock', code: '000001',
          source: { sourceClass: 'authorized-level2', provenanceTier: 'authorized-level2-observation', provider: 'disabled', authorizationStatus: 'not-configured', exchangeGroundTruth: false, truthStatement: 'Authorized gateway observations are not exchange ground truth.' },
          observation: { observedAt: null, checkedAt: '2026-08-12T05:10:00.000Z', expiresAt: null, isStale: true, state: 'unavailable', reason: 'observation-time-unavailable' },
          points: [], latest: null, limitations: ['No fallback source was used.'],
          error: { code: 'LEVEL2_NOT_CONFIGURED', message: '未配置已授权 Level-2；没有换用供应商或本地估算。' }
        } })
      });
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: {
        schema: 'webstock.capital-flow.v1', availability: 'available', scope: 'stock', code: '000001', name: '平安银行',
        source: { sourceClass: 'vendor-classified', provenanceTier: 'provider-classified', provider: 'Eastmoney', exchangeGroundTruth: false, truthStatement: 'Provider-classified data is not exchange ground truth.', methodology: '供应商定义的分类累计净额。', observationTimeBasis: 'provider-minute-label' },
        observation: { observedAt: '2026-08-12T05:06:00.000Z', checkedAt: '2026-08-12T05:10:00.000Z', expiresAt: '2026-08-12T05:16:00.000Z', isStale: false, state: 'fresh', reason: null },
        metricContract: { inflowAmount: { isGross: false }, outflowAmount: { isGross: false } },
        points: [
          { timestamp: '2026-08-12T05:05:00.000Z', inflowAmount: 100, outflowAmount: 0, netAmount: 100, netFlowSpeed: null, netFlowAcceleration: null, flowState: { code: 'unknown', label: '状态不足' } },
          { timestamp: '2026-08-12T05:06:00.000Z', inflowAmount: 300, outflowAmount: 0, netAmount: 300, netFlowSpeed: 200, netFlowAcceleration: null, flowState: { code: 'sustained-inflow', label: '持续流入' } }
        ],
        latest: { timestamp: '2026-08-12T05:06:00.000Z', inflowAmount: 300, outflowAmount: 0, netAmount: 300, netFlowSpeed: 200, netFlowAcceleration: null, flowState: { code: 'sustained-inflow', label: '持续流入' } },
        limitations: ['供应商分类净额不能反推出真实总买入和总卖出。']
      } })
    });
  });
});

test('capital momentum page renders three panels, provenance, observation time, and insufficient history', async ({ page }) => {
  await page.goto(baseURL + '/', { waitUntil: 'domcontentloaded' });
  await page.click('[data-main-view="capitalFlow"]');
  await expect(page).toHaveURL(/#capitalFlow$/);
  await expect(page.locator('#capitalFlowView')).toBeVisible();
  await expect(page.locator('#capitalFlowSourceTitle')).toContainText('供应商分类');
  await expect(page.locator('#capitalFlowSourceTier')).toContainText('provider-classified');
  await expect(page.locator('#capitalFlowTruthWarning')).toContainText('不等于交易所真值');
  await expect(page.locator('#capitalFlowObservedAt')).toContainText('观测时间');
  await expect(page.locator('#capitalFlowFreshness')).toContainText('新鲜');
  await expect(page.locator('#capitalFlowState')).toContainText('持续流入');
  await expect(page.locator('#capitalFlowHistoryStatus')).toContainText('尚未形成盘中序列');

  const chart = await page.evaluate(() => window.__capitalFlowChart.options.at(-1));
  expect(chart.grid).toHaveLength(3);
  expect(chart.series.map(item => item.name)).toContain('净额变化量');
  expect(chart.series.map(item => item.name)).toContain('净流速度');
  expect(chart.series.map(item => item.name)).toContain('净流加速度');
  expect(chart.series.find(item => item.name === '净流加速度').data.every(item => item[1] === null)).toBeTruthy();
});

test('unconfigured Level-2 clears the old chart and never displays a fallback line', async ({ page }) => {
  await page.goto(baseURL + '/#capitalFlow', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#capitalFlowSourceTitle')).toContainText('供应商分类');
  await page.selectOption('#capitalFlowSource', 'authorized-level2');
  await page.click('#capitalFlowRefreshBtn');
  await expect(page.locator('#capitalFlowSourceTitle')).toContainText('授权 Level-2');
  await expect(page.locator('#capitalFlowFreshness')).toContainText('不可用');
  await expect(page.locator('#capitalFlowError')).toContainText('没有换用供应商或本地估算');

  const chartState = await page.evaluate(() => ({
    clearCalls: window.__capitalFlowChart.clearCalls,
    optionCount: window.__capitalFlowChart.options.length
  }));
  expect(chartState.clearCalls).toBeGreaterThanOrEqual(4);
  expect(chartState.optionCount).toBe(1);
});

test('capital momentum page fits mobile width and resizes its private chart', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(baseURL + '/#capitalFlow', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#capitalFlowView')).toBeVisible();
  const result = await page.evaluate(async () => {
    window.dispatchEvent(new Event('orientationchange'));
    await new Promise(resolve => setTimeout(resolve, 100));
    return {
      noHorizontalClip: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      resizeCalls: window.__capitalFlowChart.resizeCalls
    };
  });
  expect(result.noHorizontalClip).toBeTruthy();
  expect(result.resizeCalls).toBeGreaterThan(0);
});
