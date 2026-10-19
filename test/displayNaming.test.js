const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('desktop header uses functional context instead of a product brand', () => {
  const header = read('index.html').match(/<header class="terminal-topbar">([\s\S]*?)<\/header>/)[1];
  assert.doesNotMatch(header, /WebStock/i);
  assert.match(header, /盯盘终端/);
  assert.match(header, /id="searchInput"/);
  assert.match(header, /id="themeToggle"/);
});

test('mobile title, home-screen label and visible header have no product brand', () => {
  const html = read('mobile.html');
  assert.doesNotMatch(html.match(/<title>(.*?)<\/title>/)[1], /WebStock/i);
  assert.doesNotMatch(html.match(/<meta name="apple-mobile-web-app-title"[^>]*>/)[0], /WebStock/i);
  assert.doesNotMatch(html.match(/<strong>(.*?)<\/strong>/)[1], /WebStock/i);
  const manifest = JSON.parse(read('manifest.webmanifest'));
  for (const key of ['name', 'short_name', 'description']) assert.doesNotMatch(manifest[key], /WebStock/i);
  assert.equal(manifest.start_url, '/mobile.html');
});

test('native window and tray captions use functional labels', () => {
  const main = read('electron/main.js');
  assert.doesNotMatch(main, /title:\s*(?:title\s*\|\|\s*)?'WebStock'/);
  assert.doesNotMatch(main, /createChildWindow\('WebStock'\)/);
  assert.doesNotMatch(read('electron/douyinSessionManager.js'), /title:[^\n]*WebStock/);
  assert.doesNotMatch(read('electron/backgroundMode.js'), /(?:setToolTip\(|label:)\s*'[^']*WebStock/);
});

test('display naming does not change installed identity, data paths or import markers', () => {
  assert.match(read('electron/main.js'), /app\.setName\('WebStock'\)/);
  assert.match(read('electron/runtimeConfig.js'), /'WebStockData'/);
  assert.match(read('electron/loginStartup.js'), /name: 'WebStock'/);
  assert.equal(JSON.parse(read('package.json')).build.appId, 'com.webstock.desktop');
  assert.match(read('js/modules/aiAssistant.js'), /WEBSTOCK_RESULT_START/);
  assert.match(read('js/modules/aiAssistant.js'), /WEBSTOCK_RESULT_END/);
});

test('secondary interface copy no longer carries product branding', () => {
  assert.doesNotMatch(read('index.html'), /WebStock/);
  for (const file of ['watchlist','news','hotMarket','aiAssistant','aiResearch','chartCoach','externalResearch','expertTracker','portfolio']) {
    // The time utility is a compatibility identifier, not a display label.
    assert.doesNotMatch(read('js/modules/' + file + '.js').replaceAll('WebStockTime', ''), /WebStock/);
  }
  assert.doesNotMatch(read('services/mobilePushService.js'), /title:.*WebStock/);
});
