const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-quant-listing-'));
process.env.WEBSTOCK_DB_PATH = path.join(root, 'webstock.db');
process.env.WEBSTOCK_QUANT_WORKSPACE = path.join(root, 'workspace');
process.env.OPENAI_API_KEY = '';
process.env.WEBSTOCK_DISABLE_SINA_NEWS = '1';
process.env.WEBSTOCK_HOT_MARKET_OFFLINE = '1';
process.env.WEBSTOCK_SENTIMENT_OFFLINE = '1';
process.env.WEBSTOCK_STOCK_PROFILE_OFFLINE = '1';

const { manifestSha256 } = require('../services/quantContractService');
const quant = require('../services/quantService');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value));
}

function datasetManifest(datasetId, files) {
  const count = files.length;
  const manifest = {
    schema: 'webstock.quant.dataset.v1',
    datasetId,
    createdAt: '2026-08-09T09:00:00.000Z',
    asOf: '2026-08-07',
    source: {
      id: 'listing-test',
      name: 'Listing test data',
      accessMode: 'local-test',
      endpoint: 'local://listing-test',
      termsVerified: false
    },
    universe: {
      policy: 'test-universe',
      membershipMode: 'current-list',
      requestedCount: count,
      includedCount: count,
      excludedCount: 0
    },
    dateRange: { start: '2019-01-01', end: '2026-08-07' },
    columns: ['date', 'code', 'open', 'high', 'low', 'close', 'volume'],
    adjustmentMode: 'unadjusted',
    coverage: { requested: count, succeeded: count, failed: 0, rows: count },
    files,
    eligibility: 'exploratory_only',
    warnings: ['Test fixture only.']
  };
  manifest.manifestSha256 = manifestSha256(manifest);
  return manifest;
}

function quantResult(runId, manifest, artifactPath, artifactHash, createdAt) {
  return {
    schema: 'webstock.quant.result.v1',
    runId,
    modelId: 'qlib-lightgbm-v1',
    createdAt,
    status: 'completed',
    validationStatus: 'exploratory',
    asOf: '2026-08-07',
    dataManifest: { datasetId: manifest.datasetId, sha256: manifest.manifestSha256 },
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
    candidates: [{ code: '000001', name: 'Test stock', score: 0.12 }],
    artifacts: [{ path: artifactPath, sha256: artifactHash, rows: 120 }],
    warnings: ['Exploratory public data only.']
  };
}

test('large result listings read only the requested summaries and invalidate cached dependencies', t => {
  const datasetId = 'large-listing-dataset';
  const datasetFiles = Array.from({ length: 1200 }, (_, index) => ({
    path: 'raw/' + String(index).padStart(6, '0') + '.parquet',
    sha256: 'a'.repeat(64),
    rows: 1
  }));
  const manifest = datasetManifest(datasetId, datasetFiles);
  const manifestPath = path.join(root, 'workspace', 'datasets', datasetId, 'manifest.json');
  writeJson(manifestPath, manifest);

  const baseTime = Date.parse('2026-08-10T00:00:00.000Z');
  for (let index = 0; index < 600; index += 1) {
    const runId = 'bulk-run-' + String(index).padStart(4, '0');
    const runRoot = path.join(root, 'workspace', 'runs', runId);
    const artifactName = 'predictions.bin';
    const artifact = Buffer.from('artifact-' + index);
    fs.mkdirSync(runRoot, { recursive: true });
    fs.writeFileSync(path.join(runRoot, artifactName), artifact);
    const resultPath = path.join(runRoot, 'result.json');
    writeJson(resultPath, quantResult(
      runId,
      manifest,
      artifactName,
      sha256(artifact),
      new Date(baseTime + index * 1000).toISOString()
    ));
    const timestamp = new Date(baseTime + index * 1000);
    fs.utimesSync(resultPath, timestamp, timestamp);
  }

  const originalReadFileSync = fs.readFileSync;
  const reads = { result: 0, manifest: 0 };
  fs.readFileSync = function(filePath, ...args) {
    const normalized = String(filePath).replace(/\\/g, '/');
    if (normalized.endsWith('/result.json')) reads.result += 1;
    if (normalized.endsWith('/manifest.json')) reads.manifest += 1;
    return originalReadFileSync.call(fs, filePath, ...args);
  };
  t.after(() => { fs.readFileSync = originalReadFileSync; });

  const started = Date.now();
  const first = quant.listResults(20);
  const elapsed = Date.now() - started;
  assert.equal(first.length, 20);
  assert.ok(first.every(item => item.valid));
  assert.ok(first.every(item => item.verification && item.verification.scope === 'metadata'));
  assert.ok(first.every(item => item.verification.hashesVerified === false));
  assert.ok(reads.result <= 20, 'expected at most 20 result reads, got ' + reads.result);
  assert.equal(reads.manifest, 1);
  assert.ok(elapsed < 1500, 'large summary listing took ' + elapsed + ' ms');

  reads.result = 0;
  reads.manifest = 0;
  const repeated = quant.listResults(20);
  assert.equal(repeated[0].result.runId, first[0].result.runId);
  assert.equal(reads.result, 0);
  assert.equal(reads.manifest, 0);

  const newestPath = first[0].resultPath;
  const changed = JSON.parse(originalReadFileSync(newestPath, 'utf8'));
  changed.warnings = ['Changed result metadata.'];
  writeJson(newestPath, changed);
  const changedTime = new Date(Date.now() + 5000);
  fs.utimesSync(newestPath, changedTime, changedTime);
  reads.result = 0;
  const refreshed = quant.listResults(20);
  assert.equal(refreshed[0].result.warnings[0], 'Changed result metadata.');
  assert.equal(reads.result, 1);

  const changedManifest = JSON.parse(originalReadFileSync(manifestPath, 'utf8'));
  changedManifest.warnings = ['Manifest metadata changed.'];
  changedManifest.manifestSha256 = manifestSha256(changedManifest);
  writeJson(manifestPath, changedManifest);
  const manifestTime = new Date(Date.now() + 10000);
  fs.utimesSync(manifestPath, manifestTime, manifestTime);
  const invalidated = quant.listResults(1);
  assert.equal(invalidated[0].valid, false);
  assert.match(invalidated[0].error, /manifest|SHA256|hash/i);
});

test('summary listing never replaces explicit full hash verification', () => {
  const datasetId = 'full-verification-dataset';
  const datasetRoot = path.join(root, 'workspace', 'datasets', datasetId);
  const data = Buffer.from('verified dataset bytes');
  fs.mkdirSync(path.join(datasetRoot, 'raw'), { recursive: true });
  fs.writeFileSync(path.join(datasetRoot, 'raw', '000001.parquet'), data);
  const manifest = datasetManifest(datasetId, [{
    path: 'raw/000001.parquet',
    sha256: sha256(data),
    rows: 1
  }]);
  writeJson(path.join(datasetRoot, 'manifest.json'), manifest);

  const runRoot = path.join(root, 'workspace', 'runs', 'full-verification-run');
  const artifact = Buffer.from('verified result bytes');
  fs.mkdirSync(runRoot, { recursive: true });
  fs.writeFileSync(path.join(runRoot, 'predictions.bin'), artifact);
  const resultPath = path.join(runRoot, 'result.json');
  writeJson(resultPath, quantResult(
    'full-verification-run',
    manifest,
    'predictions.bin',
    sha256(artifact),
    '2026-08-12T12:00:00.000Z'
  ));
  const newest = new Date(Date.now() + 20000);
  fs.utimesSync(resultPath, newest, newest);

  const initial = quant.listResults(1);
  assert.equal(initial[0].valid, true);
  assert.equal(initial[0].verification.hashesVerified, false);

  fs.writeFileSync(path.join(runRoot, 'predictions.bin'), 'tampered result bytes');
  const tampered = quant.listResults(1);
  assert.equal(tampered[0].valid, true);
  assert.equal(tampered[0].verification.hashesVerified, false);

  const fullyVerified = quant.listResults(1, { verification: 'full' });
  assert.equal(fullyVerified[0].valid, false);
  assert.equal(fullyVerified[0].verification.scope, 'full');
  assert.match(fullyVerified[0].error, /hash|SHA256|哈希/i);
});

test.after(() => {
  require('../db').close();
  fs.rmSync(root, { recursive: true, force: true });
});
