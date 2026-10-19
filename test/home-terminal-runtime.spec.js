// Opt-in acceptance against a running app. Uses real routes/data, never mocks quotes.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const baseURL = process.env.HOME_TERMINAL_URL;
test.use({ channel: 'msedge', viewport: { width: 1920, height: 1080 } });
test.setTimeout(180000);

test('fixed home uses the real chart, book, group selector and independent rankings', async ({ page }) => {
  test.skip(!baseURL, 'Set HOME_TERMINAL_URL to a verified running app; no fixture fallback.');
  const out = path.resolve(process.env.HOME_TERMINAL_EVIDENCE || 'output/playwright/home-terminal/runtime');
  fs.mkdirSync(out, { recursive: true });
  const assets = [];
  if (process.env.HOME_TERMINAL_VERIFY_ASSETS === '1') {
    for (const file of ['index.html','css/compact-terminal.css','css/fixed-workspace.css','js/modules/fixedWorkspace.js','js/app.js','js/modules/homeTerminal.js','js/modules/realtimeChart.js','js/modules/liveRefresh.js','js/modules/stockList.js']) {
      const response = await page.request.get(baseURL + '/' + file);
      expect(response.ok()).toBe(true);
      const actual = crypto.createHash('sha256').update(await response.body()).digest('hex');
      const expected = crypto.createHash('sha256').update(fs.readFileSync(path.resolve(file))).digest('hex');
      expect(actual, file + ' must be served by the new build').toBe(expected);
      assets.push({file,sha256:actual});
    }
  }
  const errors = [], resourceFailures = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) resourceFailures.push({status:response.status(), url:response.url()}); });
  await page.goto(baseURL + '/#dashboard');
  await expect(page.locator('#homeWatchRows button').first()).toBeVisible({timeout:60000});
  await page.waitForFunction(() => window.State.currentMinuteMeta?.code === window.State.currentStock?.code && window.State.timeChart?.getOption()?.series?.length > 0, {timeout:60000});
  await expect(page.locator('#homeIndexChart0 canvas')).toBeVisible({timeout:60000});
  await expect(page.locator('#homeIndustryRows tbody tr').first()).toBeVisible({timeout:60000});
  const boxes = {};
  for (const id of ['homeWatchPane','homeIndicators','homeChartHost','homeBookHost']) {
    await expect(page.locator('#' + id)).toBeVisible();
    boxes[id] = await page.locator('#' + id).boundingBox();
  }
  expect(boxes.homeWatchPane.x).toBeLessThan(boxes.homeChartHost.x);
  expect(boxes.homeIndicators.y).toBeLessThan(boxes.homeChartHost.y);
  expect(boxes.homeBookHost.x).toBeGreaterThan(boxes.homeChartHost.x);
  await expect(page.locator('#homeRankings')).toBeHidden();
  await page.getByRole('button',{name:'板块与风险榜单',exact:true}).click();
  await expect(page.locator('#homeRankings')).toBeVisible();
  await page.getByRole('button',{name:'行情工作台',exact:true}).click();
  await expect(page.locator('#homeChartHost #timeChartContainer')).toHaveCount(1);
  await expect(page.locator('#homeBookHost .realtime-right')).toHaveCount(1);
  const initialGroup = await page.locator('#homeGroups').inputValue();
  const readonlyGroup = await page.locator('#homeGroups option').filter({hasText:'同花顺 · 只读'}).first().getAttribute('value');
  await page.locator('#homeGroups').selectOption(readonlyGroup);
  await expect(page.locator('#homeGroups')).toHaveValue(readonlyGroup);
  expect(readonlyGroup).toMatch(/^ths:/);
  await expect(page.locator('#homeWatchRows button').first()).toBeVisible();
  await page.locator('#homeGroups').selectOption(initialGroup);
  await expect(page.locator('#homeGroups')).toHaveValue(initialGroup);
  await page.evaluate(() => { window.__homeChart = window.State.timeChart; });
  await page.screenshot({path:path.join(out, 'home-light-1920.png')});

  const rows = page.locator('#homeWatchRows button');
  const count = await rows.count();
  expect(count).toBeGreaterThan(1);
  const target = await rows.nth(1).getAttribute('data-home-stock');
  // Consecutive real clicks while earlier requests may still be in flight.
  await rows.nth(1).click();
  await rows.first().click();
  await rows.nth(1).click();
  await page.waitForFunction(code => window.State.currentMinuteMeta?.code === code && window.State.currentQuote?.code === code, target);
  await expect(page.locator('#chartTitle')).toContainText(target);
  await expect(page.locator('#orderBookStatus')).toContainText(target);
  expect(page.url()).toContain('#dashboard');
  expect(await page.evaluate(() => window.State.timeChart === window.__homeChart)).toBe(true);

  await page.locator('[data-period="day"]').click();
  await page.waitForFunction(code => window.State.currentKlineMeta?.code === code && window.State.currentKlineMeta?.period === 'day' && window.State.klineChart?.getOption()?.series?.length > 0, target);
  await expect(page.locator('#homeChartHost #chartContainer')).toBeVisible();
  await expect(page.locator('#homeBookHost #buy1')).toContainText('买1');
  await page.screenshot({path:path.join(out, 'home-day-1920.png')});

  await page.getByRole('button', { name: '个股详情', exact: true }).click();
  await expect(page.locator('#marketView #stockWorkspace')).toBeVisible();
  await expect(page.locator('#marketView .realtime-right')).toHaveCount(1);
  await page.getByRole('button', { name: '市场总览', exact: true }).click();
  await expect(page.locator('#homeChartHost #stockWorkspace')).toBeVisible();
  await page.locator('[data-period="minute"]').click();
  await page.waitForFunction(code => window.State.currentMinuteMeta?.code === code && window.State.timeChart?.getOption()?.series?.length > 0, target);
  const theme = page.locator('#themeToggle');
  await theme.click();
  await expect(page.locator('body')).toHaveClass(/dark/);
  await page.screenshot({path:path.join(out, 'home-dark-1920.png')});
  await page.setViewportSize({width:1280,height:900});
  await expect(page.locator('#homeBookHost')).toBeVisible();
  await page.screenshot({path:path.join(out, 'home-dark-1280.png')});
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  const identity = await page.evaluate(() => ({code:window.State.currentStock.code,
    chartCode:window.State.currentMinuteMeta.code, quoteCode:window.State.currentQuote.code,
    title:document.querySelector('#chartTitle').textContent,
    book:document.querySelector('#orderBookStatus').textContent,
    chartCount:document.querySelectorAll('#timeChartContainer').length,
    groups:document.querySelectorAll('#homeGroups option').length,
    indices:document.querySelectorAll('#homeIndices canvas').length}));
  fs.writeFileSync(path.join(out,'acceptance.json'), JSON.stringify({baseURL, testedAt:new Date().toISOString(), assets, boxes, identity, errors, resourceFailures}, null, 2));
  expect(errors).toEqual([]);
});
