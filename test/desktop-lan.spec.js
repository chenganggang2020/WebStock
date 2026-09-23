const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function request(url) {
  return new Promise((resolve, reject) => {
    const outgoing = http.get(url, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    outgoing.on('error', reject);
  });
}

test('desktop flow exposes an opt-in paired Android connection', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-electron-lan-'));
  const port = await availablePort();
  const packagedExecutable = String(process.env.WEBSTOCK_UNPACKED_EXECUTABLE || '').trim();
  const launchOptions = {
    args: packagedExecutable ? ['--user-data-dir=' + root] : [path.resolve('.'), '--user-data-dir=' + root],
    env: {
      ...process.env,
      PORT: String(port),
      WEBSTOCK_DB_PATH: path.join(root, 'webstock.db'),
      WEBSTOCK_LEVEL2_CONFIG_PATH: path.join(root, 'level2-config.json'),
      WEBSTOCK_QUANT_WORKSPACE: path.join(root, 'quant-workspace'),
      WEBSTOCK_SKIP_FUND_REFRESH: '1'
    }
  };
  if (packagedExecutable) launchOptions.executablePath = packagedExecutable;
  const electronApp = await electron.launch(launchOptions);

  try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.locator('[data-main-view="settings"]').click();
    await expect(page.locator('#desktopLanAccessCard')).toBeVisible();
    await expect(page.locator('#settingsLanAccessStatus')).toContainText('已关闭');

    await page.locator('#enableLanAccessBtn').click();
    await expect(page.locator('#settingsLanAccessResult')).toContainText('手机连接已开启');
    await expect(page.locator('#settingsLanAccessStatus')).toContainText('已开启');
    const pairingUrl = await page.locator('#lanPairingUrlSelect').inputValue();
    expect(pairingUrl).toMatch(new RegExp('^http://(?:10\\.|172\\.|192\\.168\\.|100\\.)[^:]+:' + port + '/\\?pair=[a-f0-9]{64}$'));

    const withoutPairing = new URL(pairingUrl);
    withoutPairing.search = '';
    const unauthorized = await request(withoutPairing);
    expect(unauthorized.status).toBe(401);

    const paired = await request(pairingUrl);
    expect(paired.status).toBe(302);
    expect(paired.headers.location).toBe('/');
    expect(paired.headers['set-cookie'][0]).toContain('HttpOnly; SameSite=Strict');

    await page.locator('#disableLanAccessBtn').click();
    await expect(page.locator('#settingsLanAccessStatus')).toContainText('已关闭');
    await expect(request(withoutPairing)).rejects.toThrow();
  } finally {
    await electronApp.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
