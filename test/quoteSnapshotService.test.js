const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createQuoteSnapshotService,
  classifyChinaQuoteStatus
} = require('../services/quoteSnapshotService');

function quote(code, price) {
  return {
    code,
    name: code,
    price,
    tradeDate: '2026-08-14',
    tradeTime: '10:00:00',
    quoteStatus: 'live'
  };
}

test('quote status is live only during the matching China trading session', () => {
  assert.equal(classifyChinaQuoteStatus('2026-08-14', Date.parse('2026-08-14T02:00:00.000Z')), 'live');
  assert.equal(classifyChinaQuoteStatus('2026-08-14', Date.parse('2026-08-14T04:00:00.000Z')), 'latest-close');
  assert.equal(classifyChinaQuoteStatus('2026-08-14', Date.parse('2026-08-14T12:00:00.000Z')), 'latest-close');
  assert.equal(classifyChinaQuoteStatus('2026-08-13', Date.parse('2026-08-14T02:00:00.000Z')), 'latest-close');
});

test('one-second snapshot reads reuse local data while fetchedAt and changedAt keep distinct meanings', async () => {
  let timestamp = Date.parse('2026-08-14T02:00:00.000Z');
  let providerCalls = 0;
  let price = 10;
  const service = createQuoteSnapshotService({
    now: () => timestamp,
    minRefreshMs: 3000,
    staleAfterMs: 10000,
    fetchBatch: async function(codes) {
      providerCalls += 1;
      return Object.fromEntries(codes.map(code => [code, quote(code, price)]));
    }
  });

  const first = await service.read(['000001']);
  timestamp += 1000;
  const localRead = await service.read(['000001']);

  assert.equal(providerCalls, 1);
  assert.equal(localRead.quotes[0].fetchedAt, first.quotes[0].fetchedAt);
  assert.equal(localRead.quotes[0].changedAt, first.quotes[0].changedAt);
  assert.equal(localRead.quotes[0].nextRefreshAt, '2026-08-14T02:00:03.000Z');
  assert.equal(localRead.meta.nextRefreshAt, '2026-08-14T02:00:03.000Z');
  assert.equal(localRead.quotes[0].stale, false);

  timestamp += 2000;
  const sameProviderValue = await service.read(['000001']);
  assert.equal(providerCalls, 2);
  assert.notEqual(sameProviderValue.quotes[0].fetchedAt, first.quotes[0].fetchedAt);
  assert.equal(sameProviderValue.quotes[0].changedAt, first.quotes[0].changedAt);

  price = 10.05;
  timestamp += 3000;
  const changedProviderValue = await service.read(['000001']);
  assert.equal(providerCalls, 3);
  assert.equal(changedProviderValue.quotes[0].price, 10.05);
  assert.equal(changedProviderValue.quotes[0].changedAt, new Date(timestamp).toISOString());
});

test('concurrent reads share one provider request for the same normalized batch', async () => {
  let providerCalls = 0;
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const service = createQuoteSnapshotService({
    fetchBatch: async function(codes) {
      providerCalls += 1;
      await pending;
      return Object.fromEntries(codes.map(code => [code, quote(code, 10)]));
    }
  });

  const first = service.read(['000001', '600000']);
  const second = service.read(['600000', '000001']);

  assert.equal(providerCalls, 1);
  complete();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.quotes.length, 2);
  assert.equal(secondResult.quotes.length, 2);
});

test('provider failure returns last-good data as stale and throttles the next local read', async () => {
  let timestamp = Date.parse('2026-08-14T02:00:00.000Z');
  let providerCalls = 0;
  let fail = false;
  const service = createQuoteSnapshotService({
    now: () => timestamp,
    minRefreshMs: 3000,
    staleAfterMs: 10000,
    fetchBatch: async function(codes) {
      providerCalls += 1;
      if (fail) throw new Error('provider unavailable');
      return Object.fromEntries(codes.map(code => [code, quote(code, 10)]));
    }
  });

  const good = await service.read(['000001']);
  fail = true;
  timestamp += 3000;
  const failedRefresh = await service.read(['000001']);
  timestamp += 1000;
  const throttledRead = await service.read(['000001']);

  assert.equal(providerCalls, 2);
  assert.equal(failedRefresh.quotes[0].price, 10);
  assert.equal(failedRefresh.quotes[0].fetchedAt, good.quotes[0].fetchedAt);
  assert.equal(failedRefresh.quotes[0].stale, true);
  assert.equal(failedRefresh.quotes[0].quoteStatus, 'stale');
  assert.equal(failedRefresh.quotes[0].reason, 'provider-request-failed');
  assert.equal(throttledRead.quotes[0].stale, true);
});

test('background reads return the local snapshot immediately and expose refresh state', async () => {
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const service = createQuoteSnapshotService({
    fetchBatch: async function(codes) {
      await pending;
      return Object.fromEntries(codes.map(code => [code, quote(code, 10)]));
    }
  });

  const local = await service.read(['000001'], { background: true });
  assert.equal(local.quotes[0].quoteStatus, 'unavailable');
  assert.equal(local.meta.refreshInFlight, true);
  complete();
  await service.whenIdle();

  const refreshed = await service.read(['000001'], { refresh: false });
  assert.equal(refreshed.quotes[0].price, 10);
  assert.equal(refreshed.meta.refreshInFlight, false);
});

test('quote requests are deduplicated, capped at 200 codes and split into batches of 80', async () => {
  const batchSizes = [];
  const service = createQuoteSnapshotService({
    batchSize: 80,
    maxCodes: 200,
    fetchBatch: async function(codes) {
      batchSizes.push(codes.length);
      return Object.fromEntries(codes.map(code => [code, quote(code, 10)]));
    }
  });
  const codes = Array.from({ length: 205 }, (_, index) => String(index + 1).padStart(6, '0'));

  const result = await service.read(codes.concat(['000001', 'not-a-code']));

  assert.deepEqual(batchSizes, [80, 80, 40]);
  assert.equal(result.quotes.length, 200);
  assert.equal(result.meta.requested, 206);
  assert.equal(result.meta.accepted, 200);
  assert.equal(result.meta.truncated, true);
  assert.equal(result.meta.source, 'sina-public-quote');
  assert.equal(result.meta.realtimeGuaranteed, false);
  assert.equal(result.meta.upstreamMinIntervalMs, 3000);
});
