const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDataHealthReport,
  fullMarketDatasetStatus,
  latestCompletedMarketDate
} = require('../services/dataHealthService');

test('data health expects the last exchange session across a week-long holiday', () => {
  assert.equal(latestCompletedMarketDate(new Date('2026-10-07T08:00:00Z')), '2026-09-30');
});

function dataset(overrides) {
  return {
    valid: true,
    manifestPath: 'D:\\quant\\dataset\\manifest.json',
    manifest: Object.assign({
      datasetId: 'a-share-full-20210827-20260827',
      createdAt: '2026-08-27T16:00:00.000Z',
      asOf: '2026-08-27',
      adjustmentMode: 'forward-adjusted',
      eligibility: 'validation_eligible',
      universe: {
        policy: 'current-a-share-ex-st',
        requestedCount: 5315,
        includedCount: 5300,
        excludedCount: 15
      },
      coverage: { requested: 5315, succeeded: 5300, failed: 15, rows: 7000000 },
      dateRange: { start: '2021-08-27', end: '2026-08-27' },
      source: { id: 'mixed-public-forward-adjusted-kline', accessMode: 'public-http' },
      warnings: []
    }, overrides || {})
  };
}

test('full-market status requires an explicit forward-adjusted baseline', () => {
  const legacy = dataset({
    datasetId: 'sina-a-share-20200101-20260827',
    adjustmentMode: 'unadjusted'
  });

  const result = fullMarketDatasetStatus([legacy], {
    expectedUniverseCount: 5315,
    expectedAsOf: '2026-08-27'
  });

  assert.equal(result.state, 'missing-baseline');
  assert.equal(result.action.mode, 'full');
  assert.equal(result.baseline, null);
  assert.equal(result.legacyDataset.datasetId, 'sina-a-share-20200101-20260827');
});

test('full-market status reports a current forward-adjusted dataset as ready', () => {
  const result = fullMarketDatasetStatus([dataset()], {
    expectedUniverseCount: 5315,
    expectedAsOf: '2026-08-27'
  });

  assert.equal(result.state, 'ready');
  assert.equal(result.action.mode, 'none');
  assert.equal(result.baseline.datasetId, 'a-share-full-20210827-20260827');
  assert.equal(result.baseline.coverageRate, 5300 / 5315);
});

test('full-market status plans an incremental update without treating the baseline as current', () => {
  const result = fullMarketDatasetStatus([dataset({ asOf: '2026-08-26' })], {
    expectedUniverseCount: 5315,
    expectedAsOf: '2026-08-27'
  });

  assert.equal(result.state, 'stale');
  assert.equal(result.action.mode, 'incremental');
  assert.equal(result.action.baseDatasetId, 'a-share-full-20210827-20260827');
  assert.equal(result.action.fetchStartDate, '2026-08-27');
});

test('full-market readiness uses successful securities and retains a repairable partial baseline', () => {
  const result = fullMarketDatasetStatus([dataset({
    coverage: { requested: 5315, succeeded: 10, failed: 5305, rows: 1000 }
  })], { expectedUniverseCount: 5315, expectedAsOf: '2026-08-27' });
  assert.equal(result.state, 'partial');
  assert.equal(result.baseline.coverage.succeeded, 10);
  assert.equal(result.minimumCoverage, 5000);
  assert.equal(result.action.mode, 'repair');
  assert.match(result.action.reason, /10.*5000/);
});

test('full-market readiness rejects nonfinite success counts and reported bad rows', () => {
  for (const overrides of [
    { coverage: { requested: 5315, succeeded: 'unknown', failed: 0 } },
    { quality: { invalidRows: 12, duplicateRows: 0, staleSecurityCount: 0 } }
  ]) {
    const result = fullMarketDatasetStatus([dataset(overrides)], {
      expectedUniverseCount: 5315, expectedAsOf: '2026-08-27'
    });
    assert.equal(result.state, 'partial');
    assert.equal(result.action.mode, 'repair');
  }
});

test('full-market readiness rejects invalid requested counts even with successful coverage', () => {
  for (const requested of [undefined, null, '', ' ', 'bad', 0, -1, 5315.5]) {
    const result = fullMarketDatasetStatus([dataset({
      coverage: { requested, succeeded: 5000, failed: 0 }
    })], { expectedUniverseCount: 5315, expectedAsOf: '2026-08-27' });
    assert.equal(result.state, 'partial', String(requested));
    assert.equal(result.action.mode, 'repair');
    assert.match(result.action.reason, /请求.*计数/);
  }
});

test('current exploratory data stays scan-ready while health exposes its research qualification', () => {
  const report = buildDataHealthReport({
    datasets: [dataset({ eligibility: 'exploratory_only' })],
    expectedUniverseCount: 5315, expectedAsOf: '2026-08-27',
    checkedAt: '2026-08-28T03:00:00.000Z'
  });
  assert.equal(report.fullMarket.state, 'ready');
  const item = report.sources.find(item => item.id === 'full-market-dataset');
  assert.equal(item.state, 'attention');
  assert.equal(item.eligibility, 'exploratory_only');
  assert.match(item.reason, /探索/);
});

test('data health report keeps unavailable sources explicit and summarizes attention items', () => {
  const report = buildDataHealthReport({
    checkedAt: '2026-08-28T03:00:00.000Z',
    expectedAsOf: '2026-08-27',
    expectedUniverseCount: 5315,
    database: { available: true },
    marketCache: { observedAt: null },
    tonghuashunWatchlist: { available: true, supportedCount: 90, fileUpdatedAt: '2026-08-27T14:26:28.000Z' },
    tonghuashunHoldings: { available: false, method: 'manual-copy', error: '未找到导出文件' },
    quantRuntime: { status: 'available', verified: true },
    datasets: [dataset()],
    jobs: []
  });

  assert.equal(report.schema, 'webstock.data-health.v1');
  assert.equal(report.fullMarket.state, 'ready');
  assert.equal(report.sources.find(item => item.id === 'market-cache').state, 'unavailable');
  assert.equal(report.sources.find(item => item.id === 'tonghuashun-holdings').reason, '未找到导出文件');
  assert.equal(report.summary.unavailable, 2);
  assert.equal(report.overallState, 'attention');
});
