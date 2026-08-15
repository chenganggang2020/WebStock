const test = require('node:test');
const assert = require('node:assert/strict');

const {
  toEastmoneySecid,
  createCapitalFlowAdapters
} = require('../services/capitalFlow/adapters');

test('toEastmoneySecid keeps stock and sector namespaces distinct', () => {
  assert.equal(toEastmoneySecid('stock', '000001'), '0.000001');
  assert.equal(toEastmoneySecid('stock', '600000'), '1.600000');
  assert.equal(toEastmoneySecid('sector', 'BK0475'), '90.BK0475');
});

test('Level-2 adapter exposes configured but unverified authorization as false without fetching trades', () => {
  let statusCalls = 0;
  const level2Service = {
    getPublicStatus: function() { statusCalls += 1; return { configured: true, provider: 'licensed-gateway' }; },
    getTrades: async function() { throw new Error('must not be called by status'); }
  };
  const adapters = createCapitalFlowAdapters({
    level2Service,
    env: {
      LEVEL2_PROVIDER: 'licensed-gateway',
      LEVEL2_BASE_URL: 'https://level2.example.test'
    }
  });

  assert.deepEqual(adapters.getLevel2Status(), {
    configured: true,
    provider: 'licensed-gateway',
    authorizationVerified: false,
    entitlementVerified: false
  });
  assert.equal(statusCalls, 0);
});

test('Level-2 adapter requires both explicit authorization and entitlement flags', () => {
  const level2Service = {
    getPublicStatus: function() { return { configured: true, provider: 'licensed-gateway' }; },
    getTrades: async function() { return { trades: [] }; }
  };
  const oneFlag = createCapitalFlowAdapters({
    level2Service,
    env: { LEVEL2_AUTHORIZATION_VERIFIED: '1' }
  }).getLevel2Status();
  const bothFlags = createCapitalFlowAdapters({
    level2Service,
    env: {
      LEVEL2_AUTHORIZATION_VERIFIED: '1',
      LEVEL2_ENTITLEMENT_VERIFIED: '1'
    }
  }).getLevel2Status();

  assert.equal(oneFlag.authorizationVerified, true);
  assert.equal(oneFlag.entitlementVerified, false);
  assert.equal(bothFlags.authorizationVerified, true);
  assert.equal(bothFlags.entitlementVerified, true);
});

test('Level-2 adapter exposes the fixed request window and conservative coverage metadata', async () => {
  let receivedOptions;
  const adapters = createCapitalFlowAdapters({
    level2Service: {
      getPublicStatus: function() { return { configured: true, provider: 'licensed-gateway' }; },
      getTrades: async function(code, options) {
        receivedOptions = { code, options };
        return {
          provider: 'licensed-gateway',
          timestamp: '2026-08-12T05:10:00.000Z',
          trades: Array.from({ length: 1000 }, function(_, index) {
            return { time: '13:' + String(Math.floor(index / 60)).padStart(2, '0') + ':' + String(index % 60).padStart(2, '0'), amount: 1, side: 'buy' };
          })
        };
      }
    }
  });

  const result = await adapters.fetchLevel2Trades({ code: '000001' });

  assert.deepEqual(receivedOptions, { code: '000001', options: { limit: 1000 } });
  assert.equal(result.coverage.requestedLimit, 1000);
  assert.equal(result.coverage.returnedCount, 1000);
  assert.equal(result.coverage.isComplete, false);
  assert.equal(result.coverage.completeness, 'truncated-at-request-limit');
  assert.equal(result.coverage.ordering, 'provider-response-order-unknown');
  assert.equal(result.coverage.fullSessionCoverage, 'unknown');
  assert.match(result.coverage.warning, /earlier trades may be omitted/i);
});

test('vendor and local adapters are lazy and use only their injected HTTP fixture', async () => {
  const calls = [];
  const adapters = createCapitalFlowAdapters({
    httpClient: {
      get: async function(url, config) {
        calls.push({ url, config });
        if (url.includes('fflow')) return { data: { data: { code: '000001', klines: [] } } };
        return { data: [{ day: '2026-08-12 09:30:00', close: '10.00', amount: '1000' }] };
      }
    },
    level2Service: {
      getPublicStatus: function() { throw new Error('Level-2 should remain lazy'); },
      getTrades: async function() { throw new Error('Level-2 should remain lazy'); }
    }
  });

  await adapters.fetchVendorFlow({ scope: 'stock', code: '000001' });
  const bars = await adapters.fetchMinuteBars({ code: '000001' });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].config.params.secid, '0.000001');
  assert.deepEqual(bars, [{ time: '2026-08-12 09:30:00', price: 10, amount: 1000 }]);
});
