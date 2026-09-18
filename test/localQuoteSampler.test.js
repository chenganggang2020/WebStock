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
