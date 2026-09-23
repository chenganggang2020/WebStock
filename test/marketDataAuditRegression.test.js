const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createMarketBoardService } = require('../services/marketBoardService');
const { buildDataHealthReport, latestCompletedMarketDate } = require('../services/dataHealthService');

function providerRows(count, constituent) {
  return Array.from({ length: count }, function(_, index) {
    return {
      f12: constituent ? String(600001 + index) : 'BK' + String(index + 1).padStart(4, '0'),
      f14: (constituent ? '成分股' : '概念板块') + (index + 1),
      f2: 10 + index / 100,
      f3: 1.25,
      f6: 200000000 + index,
      f20: 3000000000 + index,
      f62: 6000000 + index
    };
  });
}

function providerResponse(rows, total) {
  return { data: { data: { total, diff: rows } } };
}

function boardService(t, kind, getter) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-market-data-audit-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return createMarketBoardService({
    staticDefinitions: [],
    cachePath: path.join(directory, 'catalog.json'),
    now: () => Date.parse('2026-09-07T02:00:00.000Z'),
    [kind + 'Get']: getter
  });
}

function fetchBoards(service, kind) {
  if (kind === 'constituents') {
    return service.fetchConstituents({ code: 'BK0475', taxonomy: 'concept', refresh: true });
  }
  return kind === 'catalog'
    ? service.fetchCatalog({ taxonomy: 'concept', refresh: true })
    : service.fetchSnapshot({ taxonomy: 'concept', refresh: true });
}

for (const kind of ['catalog', 'snapshot', 'constituents']) {
  test(kind + ' covers all 705 records when the provider caps each page at 100 rows', async t => {
    const rows = providerRows(705, kind === 'constituents');
    const requestedPages = [];
    const service = boardService(t, kind, async url => {
      const params = new URL(url).searchParams;
      const page = Number(params.get('pn'));
      const pageSize = Math.min(Number(params.get('pz')), 100);
      requestedPages.push(page);
      const offset = (page - 1) * pageSize;
      return providerResponse(rows.slice(offset, offset + pageSize), rows.length);
    });

    const result = await fetchBoards(service, kind);

    assert.equal(result.items.length, 705);
    assert.equal(new Set(result.items.map(item => item.code)).size, 705);
    assert.equal(result.status, 'available');
    assert.equal(result.coverageComplete, true);
    assert.equal(result.reason, null);
    assert.deepEqual(requestedPages, [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.ok(result.items.every(item => item.coverageComplete === true));
  });

  test(kind + ' follows overlapping capped pages until 705 unique identities are covered', async t => {
    const rows = providerRows(705, kind === 'constituents');
    const service = boardService(t, kind, async url => {
      const page = Number(new URL(url).searchParams.get('pn'));
      const offset = (page - 1) * 90;
      return providerResponse(rows.slice(offset, offset + 100), rows.length);
    });

    const result = await fetchBoards(service, kind);

    assert.equal(result.items.length, rows.length);
    assert.deepEqual(result.items.map(item => item.code), rows.map(row => row.f12));
    assert.equal(result.coverageComplete, true);
    assert.equal(result.status, 'available');
  });

  test(kind + ' stops on a repeated page and never treats duplicates as complete coverage', async t => {
    const firstPage = providerRows(100, kind === 'constituents');
    let requests = 0;
    const service = boardService(t, kind, async () => {
      requests += 1;
      assert.ok(requests <= 3, 'a provider that repeats its first page must not cause unbounded requests');
      return providerResponse(firstPage, 705);
    });

    const result = await fetchBoards(service, kind);

    assert.equal(result.items.length, 100);
    assert.equal(new Set(result.items.map(item => item.code)).size, 100);
    assert.equal(result.status, 'partial');
    assert.equal(result.coverageComplete, false);
    assert.match(result.reason, /(?:cover|incomplete|repeat|duplicate|完整|覆盖)/i);
    assert.equal(requests, 2, 'the next page is needed to distinguish a provider cap from a repeated page');
  });
}

test('constituent pagination can cover more than 20 provider-capped pages within the record safety limit', async t => {
  const rows = providerRows(2505, true);
  const service = boardService(t, 'constituents', async url => {
    const params = new URL(url).searchParams;
    const pageSize = Math.min(Number(params.get('pz')), 100);
    const offset = (Number(params.get('pn')) - 1) * pageSize;
    return providerResponse(rows.slice(offset, offset + pageSize), rows.length);
  });

  const result = await fetchBoards(service, 'constituents');

  assert.equal(result.items.length, 2505);
  assert.equal(result.coverageComplete, true);
  assert.equal(result.status, 'available');
});

test('constituent pagination still rejects a declared total above 10000', async t => {
  let requests = 0;
  const service = boardService(t, 'constituents', async () => {
    requests += 1;
    return providerResponse(providerRows(100, true), 10001);
  });

  const result = await fetchBoards(service, 'constituents');

  assert.equal(result.status, 'unavailable');
  assert.equal(result.coverageComplete, false);
  assert.deepEqual(result.items, []);
  assert.equal(requests, 1);
  assert.match(result.reason, /(?:total|limit|上限)/i);
});

function cacheHealth(checkedAt, observedAt, eligibility = 'validation_eligible') {
  const expectedAsOf = latestCompletedMarketDate(new Date(checkedAt));
  return buildDataHealthReport({
    checkedAt,
    expectedAsOf,
    expectedUniverseCount: 5315,
    database: { available: true },
    marketCache: { observedAt },
    tonghuashunWatchlist: { available: true },
    tonghuashunHoldings: { available: true },
    quantRuntime: { status: 'available', verified: true },
    datasets: [{
      valid: true,
      manifest: {
        datasetId: 'audit-full-market-fixture',
        asOf: expectedAsOf,
        adjustmentMode: 'forward-adjusted',
        eligibility,
        universe: { policy: 'current-a-share-ex-st', requestedCount: 5315 },
        coverage: { requested: 5315, succeeded: 5315, failed: 0 },
        source: { id: 'isolated-test-fixture' }
      }
    }],
    jobs: []
  });
}

for (const observation of [
  { label: 'a week-old observation', observedAt: '2026-08-31T07:01:00.000Z' },
  { label: 'a two-hour-old intraday observation', observedAt: '2026-09-07T01:00:00.000Z' }
]) {
  test('data health marks ' + observation.label + ' as needing attention', () => {
    const report = cacheHealth('2026-09-07T03:00:00.000Z', observation.observedAt);
    const cache = report.sources.find(item => item.id === 'market-cache');

    assert.ok(['attention', 'stale'].includes(cache.state), 'an existing timestamp is not proof of current data');
    assert.equal(cache.observedAt, observation.observedAt);
    assert.match(cache.reason, /(?:stale|expired|old|过期|陈旧|刷新|早于|超时)/i);
    assert.equal(report.overallState, 'attention');
    assert.ok((report.summary.attention || 0) + (report.summary.stale || 0) >= 1);
  });
}

test('data health keeps a fresh intraday cache ready', () => {
  const report = cacheHealth('2026-09-07T03:00:00.000Z', '2026-09-07T02:59:45.000Z');
  const cache = report.sources.find(item => item.id === 'market-cache');

  assert.equal(cache.state, 'ready');
  assert.equal(report.overallState, 'ready');
});

test('data health accepts the most recent completed Friday close during the weekend', () => {
  const report = cacheHealth('2026-09-06T04:00:00.000Z', '2026-09-04T07:01:00.000Z');
  const cache = report.sources.find(item => item.id === 'market-cache');

  assert.equal(cache.state, 'ready');
  assert.equal(report.overallState, 'ready');
});

test('fresh cache alone cannot qualify a dataset with unknown research eligibility', () => {
  const report = cacheHealth('2026-09-07T03:00:00.000Z', '2026-09-07T02:59:45.000Z', '');
  assert.equal(report.sources.find(item => item.id === 'market-cache').state, 'ready');
  const dataset = report.sources.find(item => item.id === 'full-market-dataset');
  assert.equal(dataset.state, 'attention');
  assert.match(dataset.reason, /资格尚未确认/);
  assert.equal(report.overallState, 'attention');
});
