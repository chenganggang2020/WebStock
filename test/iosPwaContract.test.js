const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('iPhone PWA opens the dedicated mobile shell with Apple install metadata', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  const html = fs.readFileSync(path.join(root, 'mobile.html'), 'utf8');

  assert.equal(manifest.id, '/mobile.html');
  assert.equal(manifest.start_url, '/mobile.html');
  assert.equal(manifest.display, 'standalone');
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /apple-mobile-web-app-status-bar-style/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /js\/mobileApp\.js/);
  assert.match(html, /css\/mobile\.css/);

  const css = fs.readFileSync(path.join(root, 'css', 'mobile.css'), 'utf8');
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
});

test('service worker preserves the iPhone shell and handles private push notifications', () => {
  const source = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

  assert.match(source, /['"]\/mobile\.html['"]/);
  assert.match(source, /['"]\/css\/mobile\.css['"]/);
  assert.match(source, /['"]\/js\/modules\/quoteSnapshotClientModel\.js['"]/);
  assert.match(source, /['"]\/js\/mobileApp\.js['"]/);
  assert.match(source, /addEventListener\(['"]push['"]/);
  assert.match(source, /addEventListener\(['"]notificationclick['"]/);
  assert.doesNotMatch(source, /cache\.put\([^\n]*\/api\/mobile\/snapshot/);
});

test('mobile snapshot view escapes names and keeps stale provenance visible', () => {
  const view = require('../js/modules/mobileSnapshotView');
  const html = view.renderSnapshot({
    schema: 'webstock.mobile-snapshot/v1',
    generatedAt: '2026-08-13T01:02:03.000Z',
    accounts: [{
      id: 1,
      name: '<img src=x onerror=alert(1)>',
      valuationStatus: 'stale',
      observedAt: '2026-08-12 15:00:00',
      source: { label: '最近收盘行情', stale: true },
      summary: { totalAssets: 10000, totalPnl: -25, todayPnl: 12, positionCount: 1 },
      positions: [{ code: '000001', name: '<script>x</script>', quantity: 100, currentPrice: 10, change: -1.2, unrealizedPnl: -25 }]
    }],
    research: { totals: { observationCount: 3, videoCount: 2, transcriptCount: 1, archiveCount: 1 }, channels: [] }
  }, 1);

  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /最近收盘行情/);
  assert.match(html, /2026-08-12 15:00:00/);
  assert.match(html, /class="negative"/);
  assert.match(html, /class="positive"/);
});

test('desktop settings exposes the official Tailscale login handoff', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const settings = fs.readFileSync(path.join(root, 'js', 'modules', 'settings.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');

  assert.match(html, /id="loginTailscaleBtn"/);
  assert.match(settings, /beginTailscaleLogin/);
  assert.match(preload, /webstock:begin-tailscale-login/);
  assert.match(main, /shell\.openExternal\(result\.loginUrl\)/);
});
