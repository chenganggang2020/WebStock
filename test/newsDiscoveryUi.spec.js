const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) {
  test.use({ launchOptions: { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } });
}

const testDbPath = path.join(os.tmpdir(), 'webstock-news-discovery-ui-' + process.pid + '.db');
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

function discoveryEnvelope() {
  return {
    success: true,
    data: {
      schema: 'webstock.news-discovery/v1',
      degraded: true,
      sourceMeta: {
        cached: false,
        itemCount: 2,
        generatedAt: '2026-08-12T12:00:00.000Z',
        sources: ['Fixture Wire', 'WebStock Fallback'],
        degraded: true,
        providers: [
          { name: 'planned-outage', ok: false, error: 'planned outage' },
          { name: 'fixture-provider', ok: true, count: 2 }
        ]
      },
      coverage: {
        itemCount: 2,
        upstreamImageCount: 1,
        upstreamImageRate: 50,
        validTimestampCount: 1,
        validTimestampRate: 50,
        explicitAssociationItemCount: 1,
        explicitAssociationRate: 50,
        relevanceEvaluatedCount: 2,
        relevanceMatchedCount: 1,
        relevanceMatchedRate: 50
      },
      items: [
        {
          id: 'fixture-image',
          title: '上游图片证据资讯',
          source: 'Fixture Wire',
          time: '2026-08-12T11:00:00.000Z',
          summary: '图片只来自明确的 image_url 字段。',
          link: 'https://example.com/article',
          type: 'stock',
          evidenceKind: 'provider-item',
          relatedStocks: ['000001'],
          relatedSectors: [],
          image: {
            url: baseURL + '/news-discovery-broken-image.jpg',
            sourceField: 'image_url',
            provider: 'fixture-provider',
            upstreamProvided: true
          },
          imageProvenance: {
            provider: 'fixture-provider',
            sourceField: 'image_url',
            upstreamProvided: true
          },
          importance: {
            score: 61,
            method: 'local-research-priority-v1',
            reasons: ['明确关联股票，并具有可信发布时间。']
          },
          relevance: {
            score: 85,
            method: 'explicit-association-text-match-v1',
            reasons: ['relatedStocks matched 000001.']
          }
        },
        {
          id: 'fixture-fallback',
          title: '本地降级提示',
          source: 'WebStock Fallback',
          time: '2026-08-12T12:00:00.000Z',
          summary: '外部来源不可用时明确显示本地兜底。',
          link: '#',
          type: 'market',
          evidenceKind: 'local-fallback',
          relatedStocks: [],
          relatedSectors: [],
          image: null,
          imageProvenance: null,
          importance: {
            score: 0,
            method: 'local-research-priority-v1',
            reasons: ['没有可支持的本地优先级信号。']
          },
          relevance: {
            score: null,
            method: 'explicit-association-text-match-v1',
            reasons: ['未提供股票、板块或关键词目标。']
          }
        }
      ]
    }
  };
}

test('news discovery UI renders provenance, honest scores, filters and broken-image fallback in Edge', async ({ page }) => {
  await page.route('**/api/news/discovery**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(discoveryEnvelope())
  }));
  await page.route('**/news-discovery-broken-image.jpg', route => route.fulfill({
    status: 404,
    contentType: 'text/plain',
    body: 'missing'
  }));

  await page.goto(baseURL + '/#news', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#newsView')).toBeVisible();
  await expect(page.locator('#newsDiscoveryTimeFilter')).toHaveValue('7d');
  await expect(page.locator('#newsDiscoverySort')).toHaveValue('latest');
  await expect(page.locator('[data-news-discovery-card]')).toHaveCount(2);
  await expect(page.locator('[data-news-discovery-card]').first()).toContainText('外部来源');
  await expect(page.locator('[data-image-provenance]')).toContainText('fixture-provider / image_url');
  await expect(page.locator('[data-importance-score]').first()).toContainText('本地研究优先级：61/100');
  await expect(page.locator('[data-relevance-score]').first()).toContainText('与你相关：85/100');
  await expect(page.locator('[data-news-discovery-card]').nth(1)).toContainText('本地兜底');
  await expect(page.locator('[data-news-discovery-card]').nth(1)).toContainText('数据源降级');
  await expect(page.locator('[data-relevance-score]').nth(1)).toContainText('与你相关：未评分');
  await expect(page.locator('#newsView')).not.toContainText('全网热度');

  const sidebar = page.locator('#hotSidebarPanel');
  await expect(sidebar).toContainText('重点资讯');
  await expect(sidebar.locator('[data-sidebar-news-item]')).toHaveCount(2);
  await expect(sidebar.locator('[data-sidebar-news-item]').first()).toHaveClass(/is-important/);
  await expect(sidebar.locator('[data-sidebar-news-item]').first()).toContainText('本地重点 61');
  await expect(sidebar.locator('[data-sidebar-news-item]').first()).toContainText('Fixture Wire');
  await expect(sidebar.locator('[data-sidebar-news-item]').nth(1)).not.toHaveClass(/is-important/);
  await sidebar.locator('[data-sidebar-news-item]').first().click();
  await expect(page.locator('#newsDetailOverlay')).toBeVisible();
  await expect(page.locator('#newsDetailTitle')).toHaveText('上游图片证据资讯');
  await expect(page.locator('#newsDetailOriginalBtn')).toBeVisible();
  await page.locator('#newsDetailCloseBtn').click();

  await expect(page.locator('[data-news-image]')).toBeHidden();

  const requests = [];
  page.on('request', request => {
    if (request.url().includes('/api/news/discovery')) requests.push(request.url());
  });
  await page.selectOption('#newsDiscoveryTimeFilter', '1h');
  await expect.poll(() => requests.some(url => new URL(url).searchParams.get('timeRange') === '1h')).toBe(true);
  await page.selectOption('#newsDiscoverySort', 'relevance');
  await expect.poll(() => requests.some(url => new URL(url).searchParams.get('sort') === 'relevance')).toBe(true);
  await page.check('#newsDiscoveryImageFilter');
  await expect.poll(() => requests.some(url => new URL(url).searchParams.get('withImage') === '1')).toBe(true);
});
