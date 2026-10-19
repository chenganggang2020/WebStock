const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const axios = require('axios');
const webPush = require('web-push');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-mobile-access-'));
const token = 'mobile-access-regression-pairing-token-only';
process.env.WEBSTOCK_DB_PATH = path.join(root, 'test.db');
process.env.WEBSTOCK_LEVEL2_CONFIG_PATH = path.join(root, 'level2.json');
process.env.WEBSTOCK_QUANT_WORKSPACE = path.join(root, 'quant');
process.env.WEBSTOCK_LAN_TOKEN = token;
process.env.OPENAI_ENABLED = 'false';
process.env.OPENAI_API_KEY = 'test-only-disabled';

const app = require('../server');
const db = require('../db');
const host = 'webstock.tailnet.test:8443';
const tailscaleHeaders = { 'Tailscale-User-Login': 'mobile@example.invalid' };

// Exercise the real Express stack while replacing only the transport peer.
// Every socket still connects to a fresh localhost port and every write uses test.db.
async function listen(t, remoteAddress = '127.0.0.1') {
  const server = http.createServer(function(req, res) {
    Object.defineProperty(req.socket, 'remoteAddress', { value: remoteAddress, configurable: true });
    app(req, res);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return server;
}

function request(server, requestPath, options = {}) {
  const headers = {
    Host: host,
    Cookie: 'webstock_lan_token=' + token,
    'Content-Type': 'application/json',
    ...options.headers
  };
  return new Promise((resolve, reject) => {
    const outgoing = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      path: requestPath,
      method: options.method || 'GET',
      headers,
      agent: false
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    outgoing.on('error', reject);
    outgoing.end(options.body === undefined ? undefined : JSON.stringify(options.body));
  });
}

test.before(() => {
  // Keep market/news providers and push delivery offline; authorization and storage are real.
  test.mock.method(axios, 'get', async () => ({ data: [] }));
  test.mock.method(axios, 'post', async () => { throw new Error('Unexpected external POST in mobile access regression'); });
  test.mock.method(webPush, 'sendNotification', async () => ({}));
});

test.after(() => {
  test.mock.restoreAll();
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('paired HTTPS Tailscale Serve mutation accepts the matching external origin', async t => {
  const server = await listen(t);
  const result = await request(server, '/api/mobile/push/subscription', {
    method: 'DELETE',
    headers: {
      ...tailscaleHeaders,
      Origin: 'https://' + host,
      'X-Forwarded-Proto': 'https',
      'Sec-Fetch-Site': 'same-origin'
    },
    body: { endpoint: 'https://push.example.invalid/not-subscribed' }
  });
  assert.equal(result.status, 200, result.body);
  assert.equal(JSON.parse(result.body).data.subscribed, false);
});

test('forwarded HTTPS headers from a direct remote peer cannot forge a same-origin mutation', async t => {
  const server = await listen(t, '192.168.50.20');
  const result = await request(server, '/api/mobile/push/subscription', {
    method: 'DELETE',
    headers: { ...tailscaleHeaders, Origin: 'https://' + host, 'X-Forwarded-Proto': 'https' },
    body: { endpoint: 'https://push.example.invalid/not-subscribed' }
  });
  assert.equal(result.status, 403, result.body);
});

test('a loopback HTTPS proxy still rejects an unrelated origin or cross-site request', async t => {
  const server = await listen(t);
  for (const headers of [
    { Origin: 'https://unrelated.example.invalid' },
    { Origin: 'https://' + host, 'Sec-Fetch-Site': 'cross-site' }
  ]) {
    const result = await request(server, '/api/mobile/push/subscription', {
      method: 'DELETE',
      headers: { ...tailscaleHeaders, 'X-Forwarded-Proto': 'https', ...headers },
      body: { endpoint: 'https://push.example.invalid/not-subscribed' }
    });
    assert.equal(result.status, 403, result.body);
  }
});

for (const peer of [
  { name: 'direct LAN', address: '192.168.50.20', headers: {} },
  { name: 'Tailscale Serve', address: '127.0.0.1', headers: tailscaleHeaders }
]) {
  test('paired ' + peer.name + ' device retains mobile snapshot, quote heartbeat and push operations', async t => {
    const server = await listen(t, peer.address);
    for (const requestPath of ['/mobile.html', '/api/mobile/snapshot', '/api/quote/snapshot', '/api/mobile/push/status']) {
      const result = await request(server, requestPath, { headers: peer.headers });
      assert.equal(result.status, 200, requestPath + ': ' + result.body);
    }

    const curve = crypto.createECDH('prime256v1');
    curve.generateKeys();
    const subscription = {
      endpoint: 'https://push.example.invalid/' + encodeURIComponent(peer.name),
      keys: { p256dh: curve.getPublicKey().toString('base64url'), auth: Buffer.alloc(16, 7).toString('base64url') }
    };
    for (const operation of [
      { path: '/api/mobile/push/subscription', method: 'POST', body: { subscription } },
      { path: '/api/mobile/push/test', method: 'POST', body: { endpoint: subscription.endpoint } },
      { path: '/api/mobile/push/subscription', method: 'DELETE', body: { endpoint: subscription.endpoint } }
    ]) {
      const result = await request(server, operation.path, { ...operation, headers: peer.headers });
      assert.equal(result.status, 200, operation.method + ' ' + operation.path + ': ' + result.body);
      assert.equal(JSON.parse(result.body).success, true);
    }
  });

  test('paired ' + peer.name + ' device cannot call desktop mutations or sensitive reads', async t => {
    const server = await listen(t, peer.address);
    for (const operation of [
      { path: '/api/portfolio/accounts', method: 'POST' },
      { path: '/api/portfolio/trades', method: 'POST' },
      { path: '/api/knowledge/analyze', method: 'POST' },
      { path: '/api/paper-portfolios', method: 'POST' },
      { path: '/api/portfolio/accounts', method: 'GET' },
      { path: '/api/portfolio/trades/export', method: 'GET' },
      { path: '/api/user/export', method: 'GET' },
      { path: '/api/research-runs', method: 'GET' },
      { path: '/ai-status', method: 'GET' },
      { path: '/api/mobile/push/subscription/extra', method: 'POST' },
      { path: '/api/mobile/push/status', method: 'POST' }
    ]) {
      await t.test(operation.method + ' ' + operation.path, async () => {
        const result = await request(server, operation.path, { ...operation, body: {}, headers: peer.headers });
        assert.equal(result.status, 403, result.body);
        assert.equal(JSON.parse(result.body).success, false);
      });
    }
  });
}

test('unpaired mobile requests remain unauthorized', async t => {
  const server = await listen(t, '192.168.50.20');
  const result = await request(server, '/api/mobile/snapshot', { headers: { Cookie: '' } });
  assert.equal(result.status, 401, result.body);
});

test('local Windows desktop retains account reads and mutations without a pairing cookie', async t => {
  const server = await listen(t);
  const created = await request(server, '/api/portfolio/accounts', {
    method: 'POST',
    headers: { Cookie: '', Origin: 'http://' + host },
    body: { accountKey: 'desktop-access-regression', name: 'Local regression account', cashBalance: 1000 }
  });
  assert.equal(created.status, 200, created.body);
  const result = await request(server, '/api/portfolio/accounts', { headers: { Cookie: '' } });
  assert.equal(result.status, 200, result.body);
  assert.ok(JSON.parse(result.body).data.some(account => account.accountKey === 'desktop-access-regression'));
});
