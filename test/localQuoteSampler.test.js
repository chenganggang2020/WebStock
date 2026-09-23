const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocalQuoteSampler, samplingSession } = require('../services/localQuoteSampler');

test('sampler includes both auctions and pauses for lunch, holidays and unknown calendars', () => {
  for (const time of ['09:15:00', '09:24:59', '14:57:00', '15:00:04']) assert.equal(samplingSession('2026-09-18T' + time + '+08:00').allowed, true);
  for (const time of ['09:26:00', '12:00:00', '15:01:00']) assert.equal(samplingSession('2026-09-18T' + time + '+08:00').allowed, false);
  assert.equal(samplingSession('2026-09-25T09:20:00+08:00').allowed, false);
  assert.equal(samplingSession('2027-01-04T09:20:00+08:00').allowed, false);
});

test('background sampler deduplicates, caps scope and coalesces overlapping refreshes', async () => {
  let calls = 0, release;
  const service = createLocalQuoteSampler({ now: () => Date.parse('2026-09-18T09:20:00+08:00'),
    loadCodes: () => ['600000', '600000', 'bad'].concat(Array.from({length:205}, (_, i) => '000' + String(i).padStart(3,'0'))),
    readQuotes: async codes => { calls++; assert.equal(codes.length, 200); await new Promise(resolve => { release = resolve; }); return {quotes: {}, meta: {}}; }
  });
  const first = service.tick();
  await new Promise(resolve => setImmediate(resolve));
  const second = service.tick();
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(service.status().targetCount, 206);
  assert.equal(service.status().requestedCount, 200);
  assert.equal(service.status().freshQuoteCount, 0);
  assert.equal(service.status().omittedCount, 6);
  assert.equal(service.status().automaticTrading, false);
});

test('idle and failed collection are visible without manufacturing a successful timestamp', async () => {
  let time = Date.parse('2026-09-18T12:00:00+08:00'), calls = 0;
  const service = createLocalQuoteSampler({ now: () => time, loadCodes: () => ['600000'], readQuotes: async () => { calls++; throw Error('upstream failed'); } });
  await service.tick(); assert.equal(calls, 0);
  time = Date.parse('2026-09-18T13:01:00+08:00');
  await service.tick(); assert.equal(calls, 1);
  assert.equal(service.status().lastSuccessAt, null);
  assert.match(service.status().lastError, /upstream/);
});

test('lifecycle start is idempotent, stop removes the timer', () => {
  let created=0, cleared=0;
  const service=createLocalQuoteSampler({now:()=>Date.parse('2026-09-18T12:00:00+08:00'), loadCodes:()=>[], readQuotes:async()=>({}),
    setInterval:()=>{created++;return {unref(){}};},clearInterval:()=>{cleared++;}});
  service.start();service.start();service.stop();service.stop();
  assert.equal(created,1);assert.equal(cleared,1);
});

test('provider time, not retrieval success, determines whether background collection succeeded', async () => {
  let observed = '2026-09-17 15:00:00';
  const service = createLocalQuoteSampler({now:()=>Date.parse('2026-09-18T09:20:00+08:00'),loadCodes:()=>['600000'],
    readQuotes:async()=>({quotes:{'600000':{price:10,providerObservedAt:observed,stale:false}}})});
  await service.tick();assert.equal(service.status().lastSuccessAt,null);
  observed = '2026-09-18 09:19:58';
  await service.tick();assert.ok(service.status().lastSuccessAt);
  assert.equal(service.status().freshQuoteCount,1);
});

test('delayed provider snapshots are reported separately without manufacturing fresh collection', async () => {
  const { createQuoteSnapshotService } = require('../services/quoteSnapshotService');
  let time = Date.parse('2026-09-22T14:59:59+08:00');
  const snapshots = createQuoteSnapshotService({ now: () => time, fetchBatch: async () => ({
    '002080': { code: '002080', price: 66.24, providerObservedAt: '2026-09-22 14:59:24', quoteStatus: 'live' }
  }) });
  const sampler = createLocalQuoteSampler({ now: () => time, loadCodes: () => ['002080'],
    readQuotes: codes => snapshots.read(codes) });

  await sampler.tick();
  const delayed = sampler.status();
  assert.equal(delayed.returnedQuoteCount, 1);
  assert.equal(delayed.delayedQuoteCount, 1);
  assert.equal(delayed.freshQuoteCount, 0);
  assert.equal(delayed.lastSuccessAt, null);
  assert.equal(delayed.minimumProviderLagMs, 35000);
  assert.equal(delayed.latestProviderObservedAt, '2026-09-22T06:59:24.000Z');
  assert.equal(delayed.latestFetchedAt, '2026-09-22T06:59:59.000Z');
  assert.match(delayed.lastError, /已返回.*延迟/);

  time += 1000; // The snapshot is still cached; reading it cannot create another receipt timestamp.
  await sampler.tick();
  assert.equal(sampler.status().latestFetchedAt, delayed.latestFetchedAt);
  assert.equal(sampler.status().minimumProviderLagMs, 36000);
  assert.equal(sampler.status().lastSuccessAt, null);
});

test('freshness diagnostics reject future, invalid and stale quotes and reset after a failed read', async () => {
  let fail = false;
  const sampler = createLocalQuoteSampler({ now: () => Date.parse('2026-09-22T10:00:00+08:00'),
    loadCodes: () => ['002080'], readQuotes: async () => {
      if (fail) throw Error('upstream failed');
      return { quotes: [
        { price: 10, providerObservedAt: '2026-09-22 10:00:05', fetchedAt: '2026-09-22T02:00:00.000Z' },
        { price: 10, providerObservedAt: 'invalid', fetchedAt: 'invalid' },
        { price: 10, providerObservedAt: '2026-09-22 09:59:55', stale: true },
        { price: 0, providerObservedAt: '2026-09-22 09:59:59' }
      ] };
    }
  });
  await sampler.tick();
  assert.equal(sampler.status().returnedQuoteCount, 3);
  assert.equal(sampler.status().freshQuoteCount, 0);
  assert.equal(sampler.status().delayedQuoteCount, 0);
  assert.equal(sampler.status().lastSuccessAt, null);
  assert.equal(sampler.status().minimumProviderLagMs, -5000);
  assert.match(sampler.status().lastError, /过期|无效|失效/);

  fail = true;
  await sampler.tick();
  assert.equal(sampler.status().returnedQuoteCount, 0);
  assert.equal(sampler.status().delayedQuoteCount, 0);
  assert.equal(sampler.status().minimumProviderLagMs, null);
  assert.equal(sampler.status().latestProviderObservedAt, null);
  assert.equal(sampler.status().latestFetchedAt, null);
  assert.equal(sampler.status().lastSuccessAt, null);
});

test('fresh collection still uses the original 30-second boundary and preserves the last real success', async () => {
  let time = Date.parse('2026-09-22T10:00:00+08:00');
  const sampler = createLocalQuoteSampler({ now: () => time, loadCodes: () => ['002080'],
    readQuotes: async () => ({ quotes: [{ price: 10, providerObservedAt: '2026-09-22 09:59:30', stale: false }] }) });
  await sampler.tick();
  const succeededAt = sampler.status().lastSuccessAt;
  assert.equal(sampler.status().freshQuoteCount, 1);
  assert.equal(sampler.status().delayedQuoteCount, 0);
  assert.equal(sampler.status().latestFetchedAt, null); // Missing provider metadata is not replaced with the local clock.
  assert.equal(succeededAt, '2026-09-22T02:00:00.000Z');

  time++;
  await sampler.tick();
  assert.equal(sampler.status().freshQuoteCount, 0);
  assert.equal(sampler.status().delayedQuoteCount, 1);
  assert.equal(sampler.status().lastSuccessAt, succeededAt);
});
