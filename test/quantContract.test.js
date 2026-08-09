const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateDatasetManifest,
  validateQuantResult,
  validateFactorLabResult
} = require('../services/quantContractService');

function validManifest(overrides = {}) {
  return Object.assign({
    schema: 'webstock.quant.dataset.v1',
    datasetId: 'sina-pilot-20260809',
    createdAt: '2026-08-09T09:00:00.000Z',
    asOf: '2026-08-07',
    source: {
      id: 'sina-public-kline',
      name: 'Sina public daily K-line endpoint',
      accessMode: 'public-http',
      endpoint: 'https://money.finance.sina.com.cn/',
      termsVerified: false
    },
    universe: {
      policy: 'current-a-share-ex-st',
      membershipMode: 'current-list',
      requestedCount: 30,
      includedCount: 28,
      excludedCount: 2
    },
    dateRange: { start: '2019-01-01', end: '2026-08-07' },
    columns: ['date', 'code', 'open', 'high', 'low', 'close', 'volume'],
    adjustmentMode: 'unadjusted',
    coverage: { requested: 30, succeeded: 28, failed: 2, rows: 52140 },
    files: [{ path: 'raw/000001.parquet', sha256: 'a'.repeat(64), rows: 1860 }],
    manifestSha256: 'b'.repeat(64),
    eligibility: 'exploratory_only',
    warnings: ['Current-list universe has survivorship bias.']
  }, overrides);
}

function validResult(overrides = {}) {
  return Object.assign({
    schema: 'webstock.quant.result.v1',
    runId: 'run-20260809-001',
    modelId: 'qlib-lightgbm-v1',
    createdAt: '2026-08-09T09:30:00.000Z',
    status: 'completed',
    validationStatus: 'exploratory',
    asOf: '2026-08-07',
    dataManifest: {
      datasetId: 'sina-pilot-20260809',
      sha256: 'b'.repeat(64)
    },
    runtime: { python: '3.12.13', qlib: '0.9.7', lightgbm: '4.7.0' },
    parameters: { labelHorizon: 5, topK: 10, costBps: 8 },
    folds: [{
      train: { start: '2019-01-02', end: '2023-12-22' },
      validation: { start: '2024-01-02', end: '2024-06-21' },
      test: { start: '2024-07-01', end: '2024-09-27' },
      purgeDays: 5
    }],
    metrics: {
      rankIc: 0.03,
      icir: 0.4,
      annualizedReturn: 0.08,
      volatility: 0.2,
      maxDrawdown: -0.12,
      sharpe: 0.4,
      turnover: 0.8,
      tradeCount: 120
    },
    candidates: [{ code: '000001', name: '平安银行', score: 0.12 }],
    artifacts: [{ path: 'predictions.parquet', sha256: 'c'.repeat(64), rows: 120 }],
    warnings: ['Exploratory public data only.']
  }, overrides);
}

function validFactorLabResult(overrides = {}) {
  const metrics = validResult().metrics;
  return Object.assign({
    schema: 'webstock.quant.factor-lab.v1',
    runId: 'factor-lab-20260809-001',
    createdAt: '2026-08-09T10:00:00.000Z',
    status: 'completed',
    validationStatus: 'exploratory',
    asOf: '2026-08-07',
    dataManifest: { datasetId: 'sina-pilot-20260809', sha256: 'b'.repeat(64) },
    runtime: { python: '3.12.13', qlib: '0.9.7', lightgbm: '4.7.0' },
    parameters: { labelHorizon: 5, topK: 10, costBps: 8 },
    folds: validResult().folds,
    factors: [{
      factorId: 'feature_momentum_20',
      displayName: '20日动量',
      validationRankIc: 0.03,
      testRankIc: 0.02,
      positiveFoldRate: 1,
      maxAbsCorrelation: 0.4,
      admission: 'watch',
      metrics,
      folds: [{ fold: 1, orientation: 1, validationRankIc: 0.03, testRankIc: 0.02 }]
    }],
    composite: {
      metrics,
      candidates: [{ code: '000001', name: '平安银行', score: 0.12 }]
    },
    artifacts: [{ path: 'factor_scores.parquet', sha256: 'c'.repeat(64), rows: 120 }],
    warnings: ['Exploratory factor gate only.']
  }, overrides);
}

test('dataset manifests preserve source, coverage, hashes and provenance limits', () => {
  const manifest = validateDatasetManifest(validManifest());
  assert.equal(manifest.datasetId, 'sina-pilot-20260809');
  assert.equal(manifest.eligibility, 'exploratory_only');
  assert.equal(manifest.coverage.succeeded + manifest.coverage.failed, manifest.coverage.requested);
});

test('dataset manifests reject inconsistent coverage and missing file hashes', () => {
  assert.throws(() => validateDatasetManifest(validManifest({
    coverage: { requested: 30, succeeded: 29, failed: 0, rows: 100 }
  })), /coverage/i);
  assert.throws(() => validateDatasetManifest(validManifest({
    files: [{ path: 'raw/000001.parquet', sha256: '', rows: 20 }]
  })), /sha256/i);
});

test('exploratory current-universe data cannot be promoted to a validated model result', () => {
  assert.throws(() => validateQuantResult(validResult({ validationStatus: 'validated' }), validManifest()), /exploratory|validated/i);
});

test('quant results reject time leakage and insufficient purge gaps', () => {
  const leaking = validResult({
    folds: [{
      train: { start: '2019-01-02', end: '2024-01-05' },
      validation: { start: '2024-01-02', end: '2024-06-21' },
      test: { start: '2024-07-01', end: '2024-09-27' },
      purgeDays: 2
    }]
  });
  assert.throws(() => validateQuantResult(leaking, validManifest()), /fold|purge|time/i);
});

test('quant results reject overlapping sample-out windows', () => {
  const overlapping = validResult({
    folds: [
      validResult().folds[0],
      {
        train: { start: '2019-02-01', end: '2024-02-05' },
        validation: { start: '2024-02-12', end: '2024-07-05' },
        test: { start: '2024-09-20', end: '2024-12-20' },
        purgeDays: 5
      }
    ]
  });
  assert.throws(() => validateQuantResult(overlapping, validManifest()), /overlap/i);
});

test('quant results must match the exact dataset manifest hash', () => {
  const result = validResult({ dataManifest: { datasetId: 'sina-pilot-20260809', sha256: 'c'.repeat(64) } });
  assert.throws(() => validateQuantResult(result, validManifest()), /manifest.*hash|sha256/i);
});

test('quant results require traceable output artifacts', () => {
  assert.throws(() => validateQuantResult(validResult({ artifacts: [] }), validManifest()), /artifacts/i);
  assert.throws(() => validateQuantResult(validResult({
    artifacts: [{ path: 'predictions.parquet', sha256: '', rows: 120 }]
  }), validManifest()), /sha256/i);
});

test('a traceable exploratory rolling result passes the contract', () => {
  const result = validateQuantResult(validResult(), validManifest());
  assert.equal(result.modelId, 'qlib-lightgbm-v1');
  assert.equal(result.folds.length, 1);
  assert.equal(result.validationStatus, 'exploratory');
});

test('factor lab results preserve sample-out folds, gates and artifacts', () => {
  const result = validateFactorLabResult(validFactorLabResult(), validManifest());
  assert.equal(result.factors[0].admission, 'watch');
  assert.equal(result.folds.length, 1);
});

test('factor lab rejects future-leaking folds and invalid admission labels', () => {
  assert.throws(() => validateFactorLabResult(validFactorLabResult({
    factors: [Object.assign({}, validFactorLabResult().factors[0], { admission: 'approved' })]
  }), validManifest()), /admission/i);
  assert.throws(() => validateFactorLabResult(validFactorLabResult({
    folds: [{
      train: { start: '2019-01-02', end: '2024-01-05' },
      validation: { start: '2024-01-02', end: '2024-06-21' },
      test: { start: '2024-07-01', end: '2024-09-27' },
      purgeDays: 5
    }]
  }), validManifest()), /fold|overlap/i);
});
