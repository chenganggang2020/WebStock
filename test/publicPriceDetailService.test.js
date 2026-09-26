const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  parseInfo, parsePage, aggregatePrices, fetchSnapshot, createPublicPriceDetailService, combinePriceSeries
} = require('../services/publicPriceDetailService');

const symbol = 'sz000001';
const info = (ranges, date = '20260918') => 'v_detail_time_' + symbol + '=[' + date + ',' + JSON.stringify(ranges) + ']';
const page = (index, lines) => 'v_detail_data_' + symbol + '=[' + index + ',' + JSON.stringify(lines) + ']';
const sample = '0/09:25:00/10/0/2/2000/B|1/09:30:00/10/0/1/1000/M|2/09:30:03/11/1/2/2200/B';

test('parses only exact source identity and valid dated metadata, never executes text', () => {
  assert.equal(parseInfo(info('09:25:00~09:30:03'), symbol).tradingDate, '2026-09-18');
  assert.throws(() => parseInfo(info('09:25:00~09:30:03', '20260230'), symbol));
  assert.throws(() => parseInfo(info('09:25:00~09:30:03'), 'sh600519'));
  assert.throws(() => parseInfo(info('09:25:00~09:30:03') + ';process.exit()', symbol));
  assert.throws(() => parsePage(page(1, sample), symbol, 0, '2026-09-18'));
  assert.throws(() => parsePage(page(0, sample.replace('/11/1/', '/NaN/1/')), symbol, 0, '2026-09-18'));
});

test('combines same-date prices without overwriting newer local observations or mixing trading days', () => {
  const local = { rows: [{ time: '2026-09-18 09:30:05', price: 10, volume: 20 }, { time: '2026-09-18 09:30:10', price: 12, volume: 30 }], meta: { tradingDate: '2026-09-18', dataSource: 'local-public-quote-5s' } };
  const remote = { rows: [{ time: '2026-09-18 09:30:05', price: 11, volume: null }], meta: { tradingDate: '2026-09-18', dataSource: 'tencent-public-detail', backfillState: 'ready' } };
  const merged = combinePriceSeries(local, remote);
  assert.deepEqual(merged.rows.map(row => row.price), [11, 12]);
  assert.deepEqual(merged.rows.map(row => row.volume), [20, 30]);
  assert.equal(merged.meta.localSupplementPoints, 1);
  assert.equal(merged.meta.localVolumeOverlayPoints, 1);
  assert.equal(merged.meta.volumeCoverage, 'local-observed-samples-only');
  const noLocalVolume = combinePriceSeries({ rows: [{ time: '2026-09-18 09:30:05', price: 10, volume: null }], meta: local.meta }, remote);
  assert.equal(noLocalVolume.meta.volumeCoverage, remote.meta.volumeCoverage);
  const tomorrow = { rows: [{ time: '2026-09-21 09:30:05', price: 13 }], meta: { tradingDate: '2026-09-21', dataSource: 'local-public-quote-5s' } };
  assert.deepEqual(combinePriceSeries(tomorrow, remote).rows, tomorrow.rows);
  const older = { rows: [{ time: '2026-09-17 09:30:05', price: 8 }], meta: { tradingDate: '2026-09-17' } };
  assert.deepEqual(combinePriceSeries(older, remote).rows, remote.rows);
});

test('prefers derived public-detail volume and uses local observed volume only for uncovered buckets', () => {
  const remote = { rows: [
    { time: '2026-09-18 09:30:05', price: 11, volume: 300, amount: 3200, volumeSource: 'tencent-public-detail-derived' },
    { time: '2026-09-18 09:30:10', price: 12, volume: null, amount: null }
  ], meta: { tradingDate: '2026-09-18', dataSource: 'tencent-public-detail', volumeCoverage: 'public-detail-derived' } };
  const local = { rows: [
    { time: '2026-09-18 09:30:05', price: 10, volume: 20, amount: 200 },
    { time: '2026-09-18 09:30:10', price: 12, volume: 30, amount: 360 }
  ], meta: { tradingDate: '2026-09-18', dataSource: 'local-public-quote-5s' } };
  const merged = combinePriceSeries(local, remote);
  assert.deepEqual(merged.rows.map(row => row.volume), [300, 30]);
  assert.deepEqual(merged.rows.map(row => row.volumeSource), ['tencent-public-detail-derived', 'local-public-quote-5s']);
  assert.equal(merged.meta.localVolumeOverlayPoints, 1);
  assert.equal(merged.meta.volumeCoverage, 'public-detail-derived-with-local-fallback');
});

test('caps concurrent downloads at two and backs off failures without discarding cached data', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'detail-limits-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let count = 0;
  const service = createPublicPriceDetailService({ cacheDir: directory, download: async () => { count++; await gate; throw new Error('fixture offline'); } });
  await service.list('000001');
  await service.list('600519');
  assert.equal((await service.list('600584')).meta.backfillState, 'busy');
  assert.equal(count, 2);
  release();
  await Promise.allSettled([service.waitFor('000001'), service.waitFor('600519')]);
  const failed = await service.list('000001');
  assert.equal(failed.meta.backfillState, 'failed');
  assert.equal(count, 2);
});

test('observed-price buckets retain missing intervals and exclude auction, lunch and after-hours', () => {
  const rows = parsePage(page(0, sample + '|3/09:30:15/12/1/1/1200/B|4/11:30:03/13/1/1/1300/B|5/13:00:00/14/1/1/1400/B|6/14:57:00/15/1/1/1500/B|7/15:10:00/16/1/1/1600/B'), symbol, 0, '2026-09-18');
  const bars = aggregatePrices(rows, 5);
  assert.deepEqual(bars.map(row => row.time), ['2026-09-18 09:30:05', '2026-09-18 09:30:15', '2026-09-18 13:00:05']);
  assert.equal(bars[0].open, 10);
  assert.equal(bars[0].price, 11);
  assert.equal(bars[0].observedCount, 2);
  assert.equal(bars[0].volume, 300);
  assert.equal(bars[0].amount, 3200);
  assert.equal(bars[0].volumeSource, 'tencent-public-detail-derived');
  assert.equal(bars[0].averagePrice, null);
});

test('invalid public-detail quantity fails closed without publishing partial bucket volume', () => {
  const rows = parsePage(page(0, sample.replace('2/09:30:03/11/1/2/2200/B', '2/09:30:03/11/1/oops/2200/B')), symbol, 0, '2026-09-18');
  const bars = aggregatePrices(rows, 5);
  assert.equal(bars[0].price, 11);
  assert.equal(bars[0].volume, null);
  assert.equal(bars[0].amount, null);
});

test('downloads indexed pages and rejects cross-day, incomplete and duplicate records', async () => {
  const get = async params => params.action === 'info' ? info('09:25:00~09:30:03') : page(0, sample);
  const result = await fetchSnapshot('000001', { get, delay: async () => {}, now: () => Date.parse('2026-09-20T10:00:00Z') });
  assert.equal(result.tradingDate, '2026-09-18');
  assert.equal(result.records.length, 3);
  assert.equal(result.rawPages[0].text, page(0, sample));
  assert.equal(result.paginationComplete, true);
  await assert.rejects(fetchSnapshot('000001', { get, tradingDate: '2026-09-17' }), /date/i);
  let calls = 0;
  await assert.rejects(fetchSnapshot('000001', { get: async p => p.action === 'info' ? info('09:25:00~09:30:03', ++calls === 1 ? '20260918' : '20260921') : page(0, sample), delay: async () => {} }), /date/i);
  await assert.rejects(fetchSnapshot('000001', { get: async p => p.action === 'info' ? info('09:25:00~09:30:03') : page(0, sample.replace('2/09:30:03', '1/09:30:03')), delay: async () => {} }), /sequence/i);
});

test('reuses unchanged complete pages and reads the growing final page again', async () => {
  const last = '3/09:30:06/12/1/1/1200/B';
  const get = async p => p.action === 'info' ? info('09:25:00~09:30:03|09:30:06~09:30:06') : page(p.p, p.p === 0 ? sample : last);
  const previous = await fetchSnapshot('000001', { get, delay: async () => {} });
  const requestedPages = [];
  await fetchSnapshot('000001', { previous, delay: async () => {}, get: async p => { if (p.action === 'data') requestedPages.push(p.p); return get(p); } });
  assert.deepEqual(requestedPages, [1]);
});

test('retains a source-truncated final page as explicitly incomplete, never claims full coverage', async () => {
  const result = await fetchSnapshot('000001', {
    get: async p => p.action === 'info' ? info('09:25:00~09:30:06') : page(0, sample), delay: async () => {}
  });
  assert.equal(result.records.length, 3);
  assert.equal(result.paginationComplete, false);
  assert.equal(result.rawPages[0].range, '09:25:00~09:30:03');
});

test('retains sparse post-market source pages separately without fabricating missing records', async () => {
  const result = await fetchSnapshot('000001', { delay: async () => {}, get: async p =>
    p.action === 'info' ? info('09:25:00~09:30:03|15:10:00~15:16:24|15:16:27~15:17:00') :
      page(p.p, p.p === 0 ? sample : p.p === 1 ? '3/15:10:00/12/0/1/1200/B|4/15:15:51/12/0/1/1200/B' : '7/15:16:27/12/0/1/1200/B')
  });
  assert.equal(result.records.length, 6);
  assert.equal(result.outsideSessionMissingRecords, 2);
  assert.equal(result.paginationComplete, false);
  assert.equal(aggregatePrices(result.records).length, 1);
});

test('service returns promptly, deduplicates jobs and survives restart with dated raw cache', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'public-detail-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let release;
  let downloads = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const snapshot = await fetchSnapshot('000001', { get: async p => p.action === 'info' ? info('09:25:00~09:30:03') : page(0, sample), delay: async () => {} });
  const service = createPublicPriceDetailService({ cacheDir: directory, download: async () => { downloads++; await pending; return snapshot; } });
  const first = await service.list('000001', { intervalSeconds: 5 });
  assert.equal(first.meta.backfillState, 'loading');
  assert.equal(first.rows.length, 0);
  await service.list('000001');
  assert.equal(downloads, 1);
  release();
  await service.waitFor('000001');
  const complete = await service.list('000001', { tradingDate: '2026-09-18' });
  assert.equal(complete.meta.rawRecordCount, 3);
  assert.equal(complete.meta.tradingDate, '2026-09-18');
  const restarted = createPublicPriceDetailService({ cacheDir: directory, download: async () => { throw Error('network disabled'); } });
  assert.equal((await restarted.list('000001', { tradingDate: '2026-09-18' })).rows.length, 1);
  const otherDay = await restarted.list('000001', { tradingDate: '2026-09-17' });
  assert.equal(otherDay.rows.length, 0);
  assert.equal(otherDay.meta.backfillState, 'date-not-cached');
});

test('an incomplete refresh cannot replace longer same-day cached history', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'detail-retain-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const complete = await fetchSnapshot('000001', { get: async p => p.action === 'info' ? info('09:25:00~09:30:03') : page(0, sample), delay: async () => {} });
  let calls = 0;
  const service = createPublicPriceDetailService({ cacheDir: directory, download: async () => ++calls === 1 ? complete : { ...complete, records: complete.records.slice(0, 2), paginationComplete: false } });
  await service.refresh('000001');
  await assert.rejects(service.refresh('000001'), /shorter|incomplete/i);
  const retained = await service.list('000001', { tradingDate: '2026-09-18' });
  assert.equal(retained.meta.rawRecordCount, 3);
  assert.equal(retained.meta.paginationComplete, true);
});

test('freshness uses actual market observation time, not download time or post-market rows', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'detail-freshness-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let current = Date.parse('2026-09-18T02:00:00Z');
  const snapshot = await fetchSnapshot('000001', {
    get: async p => p.action === 'info' ? info('09:25:00~15:10:00')
      : page(0, sample + '|3/15:10:00/12/0/1/1200/B'), delay: async () => {}, now: () => current
  });
  const service = createPublicPriceDetailService({ cacheDir: directory, now: () => current, download: async () => snapshot });
  await service.refresh('000001');
  assert.equal((await service.list('000001')).meta.stale, true);
  assert.equal((await service.list('000001')).meta.marketState, 'delayed');
  current = Date.parse('2026-09-18T01:30:30Z');
  assert.equal((await service.list('000001')).meta.stale, false);
  snapshot.records.splice(3, 0, { id: 3, time: '2026-09-18 15:00:00', price: 12, phase: 'closing-result' });
  current = Date.parse('2026-09-20T04:00:00Z');
  assert.equal((await service.list('000001')).meta.marketState, 'latest-close');
  await service.waitFor('000001');
});
