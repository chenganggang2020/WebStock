const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const level2 = require('../services/level2Service');

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
