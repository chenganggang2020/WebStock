const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const express = require('express');

const lan = require('../services/lanAccessService');

test('LAN pairing helpers distinguish loopback and compare full tokens', () => {
  const token = 'a'.repeat(64);
  assert.equal(lan.isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(lan.isLoopbackAddress('127.0.0.2'), true);
  assert.equal(lan.isLoopbackAddress('192.168.1.20'), false);
  assert.equal(lan.tokenMatches(token, token), true);
  assert.equal(lan.tokenMatches(token, 'a'.repeat(63)), false);
});

test('LAN address filter accepts private and shared ranges only', () => {
  assert.equal(lan.isLocalNetworkAddress('192.168.1.20'), true);
  assert.equal(lan.isLocalNetworkAddress('172.26.48.1'), true);
  assert.equal(lan.isLocalNetworkAddress('100.64.213.144'), true);
  assert.equal(lan.isLocalNetworkAddress('100.128.0.1'), false);
  assert.equal(lan.isLocalNetworkAddress('1.2.0.31'), false);
});

test('server listen host defaults to loopback and requires a token for LAN binding', () => {
  assert.equal(lan.resolveSafeListenHost('', ''), '127.0.0.1');
  assert.equal(lan.resolveSafeListenHost('localhost', ''), '127.0.0.1');
  assert.throws(() => lan.resolveSafeListenHost('0.0.0.0', ''), /pairing token/i);
  assert.equal(lan.resolveSafeListenHost('0.0.0.0', 'a'.repeat(64)), '0.0.0.0');
});

test('LAN pairing cookie parser returns only the requested cookie', () => {
  assert.equal(lan.cookieValue('theme=dark; webstock_lan_token=abc123; x=1', 'webstock_lan_token'), 'abc123');
  assert.equal(lan.cookieValue('', 'webstock_lan_token'), '');
});

function fakeRequest(overrides = {}) {
  return {
    socket: { remoteAddress: '192.168.1.20' },
    query: {},
    method: 'GET',
    path: '/',
    get(name) {
      return name === 'cookie' ? '' : undefined;
    },
    ...overrides
  };
}

function fakeResponse() {
  return {
    headers: {},
    statusCode: 200,
    payload: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.payload = value;
      return this;
    },
    type() {
      return this;
    },
    send(value) {
      this.payload = value;
      return this;
    },
    redirect(code, location) {
      this.statusCode = code;
      this.headers.Location = location;
      return this;
    }
  };
}

test('LAN pairing middleware rejects unpaired remote requests', () => {
  const previous = process.env.WEBSTOCK_LAN_TOKEN;
  process.env.WEBSTOCK_LAN_TOKEN = 'a'.repeat(64);
  try {
    const response = fakeResponse();
    let continued = false;
    lan.requireLanPairing(fakeRequest({ path: '/api/portfolio' }), response, () => { continued = true; });
    assert.equal(continued, false);
    assert.equal(response.statusCode, 401);
    assert.equal(response.payload.success, false);
  } finally {
    if (previous === undefined) delete process.env.WEBSTOCK_LAN_TOKEN;
    else process.env.WEBSTOCK_LAN_TOKEN = previous;
  }
});

test('LAN pairing middleware exchanges a query token for a protected cookie', () => {
  const previous = process.env.WEBSTOCK_LAN_TOKEN;
  const token = 'b'.repeat(64);
  process.env.WEBSTOCK_LAN_TOKEN = token;
  try {
    const response = fakeResponse();
    lan.requireLanPairing(fakeRequest({ query: { pair: token } }), response, () => {
      assert.fail('pairing GET should redirect after setting the cookie');
    });
    assert.equal(response.statusCode, 302);
    assert.equal(response.headers.Location, '/');
    assert.match(response.headers['Set-Cookie'], /^webstock_lan_token=b{64};/);
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.equal(response.headers['Referrer-Policy'], 'no-referrer');
  } finally {
    if (previous === undefined) delete process.env.WEBSTOCK_LAN_TOKEN;
    else process.env.WEBSTOCK_LAN_TOKEN = previous;
  }
});

test('LAN pairing middleware accepts the protected pairing cookie', () => {
  const previous = process.env.WEBSTOCK_LAN_TOKEN;
  const token = 'c'.repeat(64);
  process.env.WEBSTOCK_LAN_TOKEN = token;
  try {
    const response = fakeResponse();
    let continued = false;
    const request = fakeRequest({
      get(name) {
        return name === 'cookie' ? 'webstock_lan_token=' + token : undefined;
      }
    });
    lan.requireLanPairing(request, response, () => { continued = true; });
    assert.equal(continued, true);
    assert.equal(response.statusCode, 200);
  } finally {
    if (previous === undefined) delete process.env.WEBSTOCK_LAN_TOKEN;
    else process.env.WEBSTOCK_LAN_TOKEN = previous;
  }
});

function request(address, port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = http.get({ host: address, port, path, headers }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    outgoing.on('error', reject);
  });
}

test('LAN pairing works end to end over a non-loopback local address', async t => {
  const address = Object.values(os.networkInterfaces()).flat()
    .find(item => item && item.family === 'IPv4' && !item.internal && lan.isLocalNetworkAddress(item.address))?.address;
  if (!address) return t.skip('No non-loopback IPv4 address is available');

  const previous = process.env.WEBSTOCK_LAN_TOKEN;
  const token = 'd'.repeat(64);
  process.env.WEBSTOCK_LAN_TOKEN = token;
  const app = express();
  app.use(lan.requireLanPairing);
  app.get('/', (req, res) => res.json({ success: true }));
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, resolve);
  });

  try {
    const port = server.address().port;
    const unauthorized = await request(address, port, '/');
    assert.equal(unauthorized.status, 401);

    const pairing = await request(address, port, '/?pair=' + token);
    assert.equal(pairing.status, 302);
    assert.equal(pairing.headers.location, '/');
    assert.match(pairing.headers['set-cookie'][0], /HttpOnly; SameSite=Strict/);

    const cookie = pairing.headers['set-cookie'][0].split(';')[0];
    const authorized = await request(address, port, '/', { Cookie: cookie });
    assert.equal(authorized.status, 200);
    assert.deepEqual(JSON.parse(authorized.body), { success: true });
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previous === undefined) delete process.env.WEBSTOCK_LAN_TOKEN;
    else process.env.WEBSTOCK_LAN_TOKEN = previous;
  }
});
