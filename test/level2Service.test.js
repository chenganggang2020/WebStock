const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const level2 = require('../services/level2Service');
const { aggregateAuthorizedTrades } = require('../services/capitalFlow');

test('large-order totals stay unknown when a trade amount is missing', () => {
  const missing = { price: 10, volume: null, amount: null, side: 'buy' };
  for (const trades of [[missing], [{ amount: 1000, side: 'sell' }, missing]]) {
    const stats = level2.calculateLargeOrderStats(trades);
    assert.equal(stats.totalAmount, null);
    assert.equal(stats.largeNetAmount, null);
    assert.equal(stats.largeAmountRatio, null);
    assert.equal(stats.missingAmountCount, 1);
    assert.equal(stats.buyCount, 1);
  }
  const zero = level2.calculateLargeOrderStats([{ amount: 0, side: 'neutral' }]);
  assert.equal(zero.totalAmount, 0);
  assert.equal(zero.missingAmountCount, 0);
});

test('trade normalization cannot derive zero money from missing prices or blank fields', () => {
  for (const item of [
    { price: null, volume: 100, amount: null, side: 'buy' },
    { price: 10, volume: null, amount: ' ', side: 'buy' },
    { price: 10, volume: false, amount: true, side: 'buy' }
  ]) {
    const trades = level2.normalizeTrades([item], { config: { volumeUnit: 'share' } });
    assert.equal(trades.length, 1);
    assert.equal(trades[0].amount, null);
    assert.equal(level2.calculateLargeOrderStats(trades).totalAmount, null);
  }
});

function withEnv(values, fn) {
  const oldEnv = {};
  Object.keys(values).forEach(function (key) {
    oldEnv[key] = process.env[key];
    process.env[key] = values[key];
  });
  return Promise.resolve()
    .then(fn)
    .finally(function () {
      Object.keys(values).forEach(function (key) {
        if (oldEnv[key] === undefined) delete process.env[key];
        else process.env[key] = oldEnv[key];
      });
    });
}

function createMockGateway() {
  const server = http.createServer(function (req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('Content-Type', 'application/json');

    if (url.pathname === '/depth') {
      res.end(JSON.stringify({
        success: true,
        data: {
          code: url.searchParams.get('code'),
          lastPrice: 10.25,
          bid: [[10.24, 12000, 16], [10.23, 8000, 9]],
          ask: [[10.25, 15000, 12], [10.26, 6000, 7]]
        }
      }));
      return;
    }

    if (url.pathname === '/trades') {
      res.end(JSON.stringify({
        data: {
          trades: [
            { time: '09:30:01', price: 10.25, volume: 60000, side: 'buy' },
            { time: '09:30:02', price: 10.21, volume: 50000, side: 'sell' },
            { time: '09:30:03', price: 10.22, volume: 1000, side: 'neutral' }
          ]
        }
      }));
      return;
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });

  return new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () {
      resolve(server);
    });
  });
}

test('Level-2 status is disabled until an authorized provider is configured', () => {
  const status = level2.getPublicStatus({
    LEVEL2_PROVIDER: 'disabled'
  });

  assert.equal(status.configured, false);
  assert.equal(status.hasApiKey, false);
});

test('Level-2 config save persists local gateway settings without returning secret keys', async () => {
  const configPath = path.join(os.tmpdir(), 'webstock-level2-config-' + process.pid + '-' + Date.now() + '.json');
  try { fs.rmSync(configPath, { force: true }); } catch (error) {}

  await withEnv({ WEBSTOCK_LEVEL2_CONFIG_PATH: configPath }, async function () {
    const saved = level2.saveLevel2Config({
      provider: 'tonghuashun-http',
      baseUrl: 'http://127.0.0.1:18180/',
      apiKey: 'secret-level2-key',
      loginUrl: 'https://quantapi.10jqka.com.cn/',
      largeOrderThreshold: '800000'
    });

    assert.equal(saved.provider, 'tonghuashun-http');
    assert.equal(saved.baseUrl, 'http://127.0.0.1:18180');
    assert.equal(saved.hasApiKey, true);
    assert.equal(Object.prototype.hasOwnProperty.call(saved, 'apiKey'), false);
    assert.equal(JSON.stringify(saved).includes('secret-level2-key'), false);

    const status = level2.getPublicStatus();
    assert.equal(status.configured, true);
    assert.equal(status.largeOrderThreshold, 800000);
    assert.equal(status.hasApiKey, true);
    assert.equal(JSON.stringify(status).includes('secret-level2-key'), false);

    const preserved = level2.saveLevel2Config({ baseUrl: 'http://127.0.0.1:18181', apiKey: '' });
    assert.equal(preserved.baseUrl, 'http://127.0.0.1:18181');
    assert.equal(preserved.hasApiKey, true);
  });

  try { fs.rmSync(configPath, { force: true }); } catch (error) {}
});

test('Level-2 config rejects insecure remote gateways and absolute provider endpoints', async () => {
  const configPath = path.join(os.tmpdir(), 'webstock-level2-invalid-' + process.pid + '-' + Date.now() + '.json');
  try { fs.rmSync(configPath, { force: true }); } catch (error) {}

  await withEnv({ WEBSTOCK_LEVEL2_CONFIG_PATH: configPath }, async function () {
    assert.throws(() => level2.saveLevel2Config({
      provider: 'tonghuashun-http',
      baseUrl: 'http://example.com',
      apiKey: 'secret'
    }), /HTTPS|loopback/i);

    assert.throws(() => level2.saveLevel2Config({
      provider: 'tonghuashun-http',
      baseUrl: 'https://gateway.example.com',
      tradesEndpoint: 'https://attacker.example/collect?code={code}',
      apiKey: 'secret'
    }), /relative|endpoint/i);
  });

  try { fs.rmSync(configPath, { force: true }); } catch (error) {}
});

test('Level-2 normalizers accept common depth and tick trade shapes', () => {
  const depth = level2.normalizeDepth({
    code: '000001',
    lastPrice: '12.30',
    bid1Price: '12.29',
    bid1Vol: '1000',
    ask1Price: '12.30',
    ask1Vol: '2000'
  }, { provider: 'test' });

  assert.equal(depth.code, '000001');
  assert.equal(depth.bid[0].price, 12.29);
  assert.equal(depth.ask[0].volume, 2000);

  const trades = level2.normalizeTrades([
    { tradeTime: '10:00:00', tradePrice: '20', tradeQty: '30000', direction: 'B' },
    { tradeTime: '10:00:01', tradePrice: '19.9', tradeQty: '20000', direction: 'S' }
  ], { config: { volumeUnit: 'share' } });

  assert.equal(trades[0].amount, 600000);
  assert.equal(trades[0].side, 'buy');
  assert.equal(trades[1].side, 'sell');
});

test('Level-2 trades preserve missing amounts as unknown through capital-flow aggregation', () => {
  const trades = level2.normalizeTrades([
    { time: '09:30:01', price: 10.25, side: 'buy' },
    { time: '09:30:02', price: 10.25, volume: 0, amount: 0, side: 'sell' }
  ], { config: { volumeUnit: 'share' } });

  assert.equal(trades[0].volume, null);
  assert.equal(trades[0].amount, null);
  assert.equal(trades[1].volume, 0);
  assert.equal(trades[1].amount, 0);

  const flow = aggregateAuthorizedTrades(trades, {
    code: '000001',
    provider: 'test-gateway',
    fetchedAt: '2026-08-12T01:30:03.000Z',
    authorizationVerified: true,
    entitlementVerified: true
  });

  assert.equal(flow.points[0].inflowAmount, null);
  assert.equal(flow.points[0].netAmount, null);
});

test('free Eastmoney money-flow rows normalize to simulated large-order fields', () => {
  const flow = level2.normalizeEastmoneyMoneyFlow({
    f12: '000001',
    f14: '平安银行',
    f2: 10.24,
    f3: 0.1,
    f62: 48532210,
    f66: 85580728,
    f69: 7.48,
    f72: -37048518,
    f75: -3.24,
    f78: 593888,
    f81: 0.05,
    f84: -49126100,
    f87: -4.29,
    f184: 4.24
  });

  assert.equal(flow.provider, 'eastmoney-free-flow');
  assert.equal(flow.sourceType, 'free-estimated');
  assert.equal(flow.mainNetAmount, 48532210);
  assert.equal(flow.superLargeNetAmount, 85580728);
  assert.equal(flow.largeNetAmount, -37048518);
  assert.equal(flow.simulatedLargeNetAmount, 48532210);
  assert.equal(flow.status, 'available');
  assert.deepEqual(flow.missingFields, []);
});

test('free-flow missing provider fields remain unknown instead of zero', () => {
  for (const missing of [undefined, null, '', ' ', '-', false, true, [], {}]) {
    const flow = level2.normalizeEastmoneyMoneyFlow({
      f62: missing, f66: missing, f72: missing, f184: missing
    });
    for (const key of ['price', 'changePct', 'mainNetAmount', 'superLargeNetAmount',
      'largeNetAmount', 'mediumNetAmount', 'smallNetAmount', 'mainNetRatio',
      'superLargeNetRatio', 'largeNetRatio', 'mediumNetRatio', 'smallNetRatio', 'simulatedLargeNetAmount']) {
      assert.equal(flow[key], null, key);
    }
    assert.equal(flow.status, 'unavailable');
    assert.equal(flow.observedAt, null);
    assert.match(flow.note, /不是.*暗盘/);
  }
});

test('free-flow partial data preserves known values without filling missing bucket totals', () => {
  const flow = level2.normalizeEastmoneyMoneyFlow({ f62: 0, f66: -50, f184: '0' });
  assert.equal(flow.status, 'partial');
  assert.equal(flow.mainNetAmount, 0);
  assert.equal(flow.superLargeNetAmount, -50);
  assert.equal(flow.mainNetRatio, 0);
  assert.equal(flow.simulatedLargeNetAmount, null);
  assert.equal(level2.normalizeEastmoneyMoneyFlow({ f66: 20, f72: -30 }).simulatedLargeNetAmount, -10);
  const zero = level2.normalizeEastmoneyMoneyFlow({
    f62: 0, f66: 0, f72: 0, f78: 0, f84: 0, f184: 0, f69: 0, f75: 0, f81: 0, f87: 0,
    f2: 1.234
  });
  assert.equal(zero.status, 'available');
  assert.equal(zero.simulatedLargeNetAmount, 0);
  assert.equal(zero.price, 1.234);
});

test('manual retail Level-2 paste parses trades and calculates large-order stats', () => {
  const pasted = [
    '时间 成交价 成交量 方向',
    '09:30:01 10.25 60000 买入',
    '09:30:02 10.21 50000 卖出',
    '09:30:03 10.22 1000 中性'
  ].join('\n');

  const result = level2.analyzeManualTrades({
    code: '000001',
    text: pasted,
    threshold: 500000,
    volumeUnit: 'share'
  });

  assert.equal(result.provider, 'manual-level2-paste');
  assert.equal(result.trades.length, 3);
  assert.equal(result.trades[0].side, 'buy');
  assert.equal(result.trades[1].side, 'sell');
  assert.equal(result.stats.largeTradeCount, 2);
  assert.equal(result.stats.largeBuyAmount, 615000);
  assert.equal(result.stats.largeSellAmount, 510500);
  assert.equal(result.stats.largeNetAmount, 104500);
});

test('Level-2 HTTP provider fetches depth and calculates large order stats', async (t) => {
  const gateway = await createMockGateway();
  t.after(function () { gateway.close(); });
  const baseUrl = 'http://127.0.0.1:' + gateway.address().port;

  await withEnv({
    LEVEL2_PROVIDER: 'tonghuashun-http',
    LEVEL2_BASE_URL: baseUrl,
    LEVEL2_DEPTH_ENDPOINT: '/depth?code={code}',
    LEVEL2_TRADES_ENDPOINT: '/trades?code={code}&limit={limit}',
    LEVEL2_LARGE_ORDER_THRESHOLD: '500000',
    LEVEL2_VOLUME_UNIT: 'share'
  }, async function () {
    const depth = await level2.getDepth('000001');
    assert.equal(depth.provider, 'tonghuashun-http');
    assert.equal(depth.bid.length, 2);
    assert.equal(depth.ask[0].price, 10.25);

    const stats = await level2.getLargeOrderStats('000001');
    assert.equal(stats.code, '000001');
    assert.equal(stats.stats.largeTradeCount, 2);
    assert.equal(stats.stats.largeBuyAmount, 615000);
    assert.equal(stats.stats.largeSellAmount, 510500);
    assert.equal(stats.stats.largeNetAmount, 104500);
    assert.equal(stats.stats.topLargeTrades.length, 2);
  });
});
