const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createCapitalFlowService, SOURCE_MODES } = require('../services/capitalFlow');

const STOCK = { scope: 'stock', code: '002080', source: SOURCE_MODES.VENDOR_CLASSIFIED };
const FRIDAY_CLOSE = '2026-09-18T07:00:01.000Z';
const SUNDAY = '2026-09-20T17:34:54.000Z';

function vendorPayload(date, code = STOCK.code, finalNet = 300) {
  return { data: { code, name: '测试证券', klines: [
    date + ' 14:59:00,100,-20,-80,40,60',
    date + ' 15:00:00,' + finalNet + ',-50,-250,100,200'
  ] } };
}

function offline() {
  const error = new Error('Fixture provider is unavailable');
  error.code = 'TEST_PROVIDER_OFFLINE';
  throw error;
}

async function temporaryHistory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'capital-flow-history-test-'));
  t.after(async function() {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('capital-flow-history-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('a failed closed-market refresh preserves the same-source last successful series and its observation time', async t => {
  const historyDirectory = await temporaryHistory(t);
  let clock = FRIDAY_CLOSE;
  let unavailable = false;
  const service = createCapitalFlowService({
    historyDirectory,
    now: () => new Date(clock),
    fetchVendorFlow: async () => unavailable ? offline() : vendorPayload('2026-09-18')
  });
  const observed = await service.getSeries(STOCK);
  assert.equal(observed.availability, 'available');

  unavailable = true;
  clock = SUNDAY;
  const result = await service.getSeries({ ...STOCK, refresh: true });

  assert.equal(result.availability, 'available');
  assert.deepEqual(result.points, observed.points);
  assert.equal(result.observation.observedAt, '2026-09-18T07:00:00.000Z');
  assert.equal(result.observation.checkedAt, SUNDAY);
  assert.equal(result.history.tradingDay, '2026-09-18');
  assert.equal(result.history.fromCache, true);
  assert.equal(result.refreshError.code, 'TEST_PROVIDER_OFFLINE');
  assert.equal(result.latest.netAmount, 300);
});

test('history remains readable by a fresh service instance after the provider becomes unavailable', async t => {
  const historyDirectory = await temporaryHistory(t);
  const writer = createCapitalFlowService({
    historyDirectory,
    now: () => new Date(FRIDAY_CLOSE),
    fetchVendorFlow: async () => vendorPayload('2026-09-18')
  });
  const original = await writer.getSeries(STOCK);
  const reader = createCapitalFlowService({
    historyDirectory,
    now: () => new Date(SUNDAY),
    fetchVendorFlow: async () => offline()
  });

  const result = await reader.getSeries(STOCK);

  assert.equal(result.availability, 'available');
  assert.deepEqual(result.points, original.points);
  assert.equal(result.history.fromCache, true);
  assert.deepEqual(result.history.availableDates, ['2026-09-18']);
});

test('selecting a saved date returns that day instead of a later provider response', async t => {
  const historyDirectory = await temporaryHistory(t);
  let date = '2026-09-17';
  let clock = '2026-09-17T07:00:01.000Z';
  const service = createCapitalFlowService({
    historyDirectory,
    now: () => new Date(clock),
    fetchVendorFlow: async () => vendorPayload(date, STOCK.code, date === '2026-09-17' ? 200 : 500)
  });
  const thursday = await service.getSeries(STOCK);
  date = '2026-09-18';
  clock = FRIDAY_CLOSE;
  await service.getSeries({ ...STOCK, refresh: true });

  const result = await service.getSeries({ ...STOCK, date: '2026-09-17', refresh: false });

  assert.deepEqual(result.points, thursday.points);
  assert.equal(result.latest.netAmount, 200);
  assert.equal(result.history.tradingDay, '2026-09-17');
  assert.deepEqual(result.history.availableDates, ['2026-09-18', '2026-09-17']);
});

test('an explicitly selected missing date is empty, never silently replaced with a different date', async t => {
  const historyDirectory = await temporaryHistory(t);
  const service = createCapitalFlowService({
    historyDirectory,
    now: () => new Date(FRIDAY_CLOSE),
    fetchVendorFlow: async () => vendorPayload('2026-09-18')
  });
  await service.getSeries(STOCK);

  const result = await service.getSeries({ ...STOCK, date: '2026-09-16', refresh: false });

  assert.equal(result.availability, 'unavailable');
  assert.deepEqual(result.points, []);
  assert.equal(result.latest, null);
  assert.equal(result.history.tradingDay, '2026-09-16');
  assert.deepEqual(result.history.availableDates, ['2026-09-18']);
});

test('empty provider data cannot erase a successful historical observation', async t => {
  const historyDirectory = await temporaryHistory(t);
  let payload = vendorPayload('2026-09-18');
  const service = createCapitalFlowService({
    historyDirectory,
    now: () => new Date(FRIDAY_CLOSE),
    fetchVendorFlow: async () => payload
  });
  const original = await service.getSeries(STOCK);
  payload = { data: { code: STOCK.code, klines: [] } };

  const result = await service.getSeries({ ...STOCK, refresh: true });

  assert.equal(result.availability, 'available');
  assert.deepEqual(result.points, original.points);
  assert.equal(result.history.fromCache, true);
  assert.ok(result.refreshError, 'The unsuccessful refresh must remain visible separately from the historical data.');
});

test('missing numeric values are preserved in history and are not fabricated as zero', async t => {
  const historyDirectory = await temporaryHistory(t);
  const writer = createCapitalFlowService({
    historyDirectory,
    now: () => new Date(FRIDAY_CLOSE),
    fetchVendorFlow: async () => ({ data: { code: STOCK.code, klines: [
      '2026-09-18 14:59:00,,,,,',
      '2026-09-18 15:00:00,300,,,,200'
    ] } })
  });
  const original = await writer.getSeries(STOCK);
  assert.equal(original.points[0].netAmount, null);
  const reader = createCapitalFlowService({
    historyDirectory,
    now: () => new Date(SUNDAY),
    fetchVendorFlow: async () => offline()
  });

  const result = await reader.getSeries(STOCK);

  assert.equal(result.availability, 'available');
  assert.deepEqual(result.points, original.points);
  assert.equal(result.points[0].netAmount, null);
  assert.equal(result.points[1].netFlowSpeed, null);
  assert.equal(result.points[1].buckets.smallNetAmount, null);
});

test('a future-dated unavailable response cannot overwrite or replace earlier valid history', async t => {
  const historyDirectory = await temporaryHistory(t);
  let future = false;
  const service = createCapitalFlowService({
    historyDirectory,
    now: () => new Date(FRIDAY_CLOSE),
    fetchVendorFlow: async () => vendorPayload(future ? '2026-09-21' : '2026-09-18')
  });
  const original = await service.getSeries(STOCK);
  future = true;

  const result = await service.getSeries({ ...STOCK, refresh: true });

  assert.equal(result.availability, 'available');
  assert.deepEqual(result.points, original.points);
  assert.deepEqual(result.history.availableDates, ['2026-09-18']);
  assert.ok(result.refreshError);
});

test('history isolation never substitutes another stock, source, or scope when no matching data exists', async t => {
  const historyDirectory = await temporaryHistory(t);
  const writer = createCapitalFlowService({
    historyDirectory,
    now: () => new Date(FRIDAY_CLOSE),
    fetchVendorFlow: async () => vendorPayload('2026-09-18')
  });
  await writer.getSeries(STOCK);
  const reader = createCapitalFlowService({
    historyDirectory,
    now: () => new Date(SUNDAY),
    fetchVendorFlow: async () => offline(),
    fetchMinuteBars: async () => offline(),
    getLevel2Status: () => ({ configured: false, provider: 'disabled' })
  });

  for (const input of [
    { ...STOCK, code: '600000' },
    { ...STOCK, source: SOURCE_MODES.LOCAL_ESTIMATE },
    { ...STOCK, source: SOURCE_MODES.AUTHORIZED_LEVEL2 },
    { ...STOCK, scope: 'sector', code: 'BK0475' }
  ]) {
    const result = await reader.getSeries(input);
    assert.equal(result.availability, 'unavailable');
    assert.deepEqual(result.points, []);
    assert.equal(result.latest, null);
    assert.equal(result.code, input.code);
    assert.equal(result.scope, input.scope);
    assert.equal(result.source.sourceClass, input.source);
  }
});

test('the historical date is the Beijing observation date, not the later refresh date', async t => {
  const historyDirectory = await temporaryHistory(t);
  const service = createCapitalFlowService({
    historyDirectory,
    now: () => new Date(SUNDAY),
    fetchVendorFlow: async () => vendorPayload('2026-09-18')
  });

  const result = await service.getSeries(STOCK);

  assert.equal(result.availability, 'available');
  assert.equal(result.observation.checkedAt, SUNDAY);
  assert.equal(result.history.tradingDay, '2026-09-18');
  assert.deepEqual(result.history.availableDates, ['2026-09-18']);
});
test('a later partial response preserves earlier points in the same saved day', async t => {
  const historyDirectory = await temporaryHistory(t);
  let payload = vendorPayload('2026-09-18');
  const service = createCapitalFlowService({ historyDirectory, now: () => new Date(FRIDAY_CLOSE), fetchVendorFlow: async () => payload });
  await service.getSeries(STOCK);
  payload = { data: { code: STOCK.code, klines: ['2026-09-18 15:00:00,400,-50,-250,100,300'] } };
  await service.getSeries({ ...STOCK, refresh: true });
  const saved = await service.getSeries({ ...STOCK, date: '2026-09-18' });
  assert.equal(saved.points.length, 2); assert.equal(saved.latest.netAmount, 400);
});

test('Level-2 historical selection is rejected rather than silently returning live data', async t => {
  const historyDirectory = await temporaryHistory(t);
  const service = createCapitalFlowService({ historyDirectory, now: () => new Date(SUNDAY) });
  await assert.rejects(service.getSeries({ ...STOCK, source: SOURCE_MODES.AUTHORIZED_LEVEL2, date: '2026-09-18' }), error => error.status === 400 || error.statusCode === 400);
});

test('opening saved history does not wait for an unavailable provider; refresh is explicit', async t => {
  const historyDirectory = await temporaryHistory(t);
  const writer = createCapitalFlowService({ historyDirectory, now: () => new Date(FRIDAY_CLOSE), fetchVendorFlow: async () => vendorPayload('2026-09-18') });
  await writer.getSeries(STOCK);
  let requests = 0;
  const reader = createCapitalFlowService({ historyDirectory, now: () => new Date(SUNDAY), fetchVendorFlow: async () => { requests++; return offline(); } });
  const saved = await reader.getSeries(STOCK);
  assert.equal(requests, 0);
  assert.equal(saved.history.fromCache, true);
  await reader.getSeries({ ...STOCK, refresh: true });
  assert.equal(requests, 1);
});
