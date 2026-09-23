const fs = require('fs');
const path = require('path');
const app = require('../server');
const { chromium, devices } = require('@playwright/test');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

function account(id, name, values) {
  return {
    id,
    name,
    isDefault: id === 1,
    valuationStatus: 'live',
    observedAt: '2026-08-13 10:30:00',
    source: { label: '新浪实时行情', stale: false },
    summary: values.summary,
    positions: values.positions
  };
}

const snapshot = {
  schema: 'webstock.mobile-snapshot/v1',
  generatedAt: '2026-08-13T02:30:00.000Z',
  accounts: [
    account(1, '当前账户', {
      summary: { totalAssets: 120000, totalMarketValue: 110000, totalPnl: 8600, todayPnl: 520 },
      positions: [{
        code: '600584', name: '长电科技', quantity: 200, currentPrice: 78.18,
        change: 0.66, unrealizedPnl: 3556.24
      }]
    }),
    account(2, '广发证券', {
      summary: { totalAssets: 88469, totalMarketValue: 78469, totalPnl: 514.06, todayPnl: -2013 },
      positions: [{
        code: '300122', name: '智飞生物', quantity: 100, currentPrice: 135.05,
        change: -2.22, unrealizedPnl: -4223.75
      }]
    })
  ],
  research: {
    totals: { observationCount: 8, videoCount: 5, transcriptCount: 3, archiveCount: 2 },
    channels: []
  }
};

async function listen() {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function serviceWorkerState(page) {
  return page.evaluate(async () => {
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('service worker timeout')), 10000))
    ]);
    if (!navigator.serviceWorker.controller) {
      await new Promise(resolve => {
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
        setTimeout(resolve, 2000);
      });
    }
    return {
      active: registration.active && registration.active.state,
      controller: Boolean(navigator.serviceWorker.controller)
    };
  });
}

async function run() {
  const output = path.join(process.cwd(), 'output', 'playwright');
  fs.mkdirSync(output, { recursive: true });
  const server = await listen();
  let browser;

  try {
    browser = await chromium.launch({ executablePath: EDGE_PATH, headless: true });
    const context = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await context.newPage();
    const errors = [];
    let isOfflineCheck = false;
    page.on('pageerror', error => errors.push('pageerror: ' + error.message));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      if (isOfflineCheck && message.text().includes('ERR_INTERNET_DISCONNECTED')) return;
      errors.push('console: ' + message.text());
    });
    await page.route('**/api/mobile/snapshot', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: snapshot })
    }));

    const url = `http://127.0.0.1:${server.address().port}/mobile.html`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.locator('[data-account-id]').first().waitFor({ timeout: 10000 });
    const sw = await serviceWorkerState(page);
    await page.screenshot({ path: path.join(output, 'ios-pwa-online.png'), fullPage: true });
    const online = {
      connection: await page.locator('#mobileConnectionText').innerText(),
      accountTabs: await page.locator('[data-account-id]').count(),
      heading: await page.locator('.account-head h1').innerText()
    };

    await page.unroute('**/api/mobile/snapshot');
    isOfflineCheck = true;
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.locator('#mobileConnectionText').filter({ hasText: '离线快照' }).waitFor({ timeout: 10000 });
    await page.screenshot({ path: path.join(output, 'ios-pwa-offline.png'), fullPage: true });
    const offline = {
      connection: await page.locator('#mobileConnectionText').innerText(),
      accountTabs: await page.locator('[data-account-id]').count()
    };

    const result = { url, sw, online, offline, errors };
    console.log(JSON.stringify(result, null, 2));
    if (!sw.controller || online.accountTabs !== 2 || offline.accountTabs !== 2 || errors.length) {
      process.exitCode = 1;
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

run().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
