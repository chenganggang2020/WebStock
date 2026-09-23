const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-quant-api-'));
process.env.WEBSTOCK_DB_PATH = path.join(root, 'webstock.db');
process.env.WEBSTOCK_QUANT_WORKSPACE = path.join(root, 'quant-workspace');
process.env.WEBSTOCK_QUANT_PYTHON = path.join(root, 'missing-python.exe');
process.env.WEBSTOCK_DISABLE_SINA_NEWS = '1';
process.env.WEBSTOCK_HOT_MARKET_OFFLINE = '1';
process.env.WEBSTOCK_SENTIMENT_OFFLINE = '1';
process.env.WEBSTOCK_STOCK_PROFILE_OFFLINE = '1';

const app = require('../server');
const quant = require('../services/quantService');

function requestJson(server, options, body) {
  const address = server.address();
  const requestOptions = Object.assign({
    hostname: '127.0.0.1',
    port: address.port,
    method: 'GET',
    headers: {}
  }, typeof options === 'string' ? { path: options } : options);
  return new Promise((resolve, reject) => {
    const req = http.request(requestOptions, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, json: JSON.parse(raw) }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

test('quant API reports a missing isolated runtime without claiming availability', async t => {
  const server = app.listen(0);
  t.after(() => server.close());

  const response = await requestJson(server, '/api/quant/runtime');
  assert.equal(response.statusCode, 200);
  assert.equal(response.json.success, true);
  assert.equal(response.json.data.status, 'not_configured');
  assert.match(response.json.data.reason, /Python|runtime/i);
  assert.equal(response.json.data.installer.available, true);
  assert.equal(response.json.data.installer.python, '3.12.13');
});

test('quant API rejects linking a missing existing Python environment', async t => {
  const server = app.listen(0);
  t.after(() => server.close());

  const response = await requestJson(server, {
    path: '/api/quant/runtime/link',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { pythonPath: path.join(root, 'not-found', 'python.exe') });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json.success, false);
  assert.match(response.json.error, /不存在/);
});

test('quant API refuses to start a model job when the runtime is missing', async t => {
  const server = app.listen(0);
  t.after(() => server.close());

  const response = await requestJson(server, {
    path: '/api/quant/pilot',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { limit: 12, startDate: '2021-01-01' });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json.success, false);
  assert.match(response.json.error, /Python|runtime/i);
});

test('quant API rejects overlapping sample-out windows before starting a job', async t => {
  const server = app.listen(0);
  t.after(() => server.close());

  const response = await requestJson(server, {
    path: '/api/quant/runs',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { datasetId: 'test-dataset', testDays: 63, stepDays: 21 });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json.success, false);
  assert.match(response.json.error, /重叠|步长/);
});

test('quant API accepts only registered comparison models', async t => {
  const server = app.listen(0);
  t.after(() => server.close());

  const response = await requestJson(server, {
    path: '/api/quant/runs',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { datasetId: 'test-dataset', model: 'invented-model' });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json.success, false);
  assert.match(response.json.error, /模型/);
});

test('factor lab API lists results and validates windows before runtime startup', async t => {
  const server = app.listen(0);
  t.after(() => server.close());

  const listed = await requestJson(server, '/api/quant/factor-labs');
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.json.data, []);

  const invalid = await requestJson(server, {
    path: '/api/quant/factor-labs',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { datasetId: 'test-dataset', testDays: 63, stepDays: 21 });
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.json.error, /重叠|步长/);

  const missingRuntime = await requestJson(server, {
    path: '/api/quant/factor-labs',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { datasetId: 'test-dataset' });
  assert.equal(missingRuntime.statusCode, 409);
});

test('factor lab service arguments exclude model-specific training flags', () => {
  const args = quant.commonEvaluationArgs({ testDays: 63, stepDays: 63, topK: 12, costBps: 8 });
  assert.ok(args.includes('--test-days'));
  assert.ok(args.includes('--cost-bps'));
  assert.equal(args.includes('--num-boost-round'), false);
  assert.equal(args.includes('--master-epochs'), false);
});

test('strategy lab API is read-only, lists results and validates three-fold rule cards', async t => {
  const server = app.listen(0);
  t.after(() => server.close());

  const listed = await requestJson(server, '/api/quant/strategy-labs');
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.json.data, []);

  const invalid = await requestJson(server, {
    path: '/api/quant/strategy-labs',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { datasetId: 'test-dataset', maxFolds: 2 });
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.json.error, /3|样本外|窗口/);

  const missingRuntime = await requestJson(server, {
    path: '/api/quant/strategy-labs',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { datasetId: 'test-dataset', shortWindows: [5, 10], longWindows: [20, 40], maxFolds: 3 });
  assert.equal(missingRuntime.statusCode, 409);
  assert.match(missingRuntime.json.error, /Python|runtime/i);
});

test('strategy rule-card arguments contain A-share execution costs and no order flags', () => {
  const args = quant.strategyLabArgs({
    shortWindows: [5, 10], longWindows: [20, 40], maxFolds: 3,
    commissionBps: 2.5, stampDutyBps: 5, slippageBps: 2
  });
  assert.ok(args.includes('--short-windows'));
  assert.ok(args.includes('--commission-bps'));
  assert.ok(args.includes('--stamp-duty-bps'));
  assert.ok(args.includes('--slippage-bps'));
  assert.ok(args.includes('--max-instruments'));
  assert.equal(args.some(value => /order|broker|trade-submit/i.test(value)), false);
  assert.throws(() => quant.strategyLabArgs({
    shortWindows: Array.from({ length: 12 }, (_, index) => index + 1),
    longWindows: Array.from({ length: 12 }, (_, index) => index + 20)
  }), /64/);

  const macdArgs = quant.strategyLabArgs({
    strategyFamily: 'macd-crossover',
    fastWindows: [8, 12], slowWindows: [26], signalWindows: [9]
  });
  assert.deepEqual(macdArgs.slice(0, 8), [
    '--strategy-family', 'macd-crossover',
    '--fast-windows', '8,12',
    '--slow-windows', '26',
    '--signal-windows', '9'
  ]);
  assert.equal(macdArgs.some(value => /order|broker|trade-submit/i.test(value)), false);
  const stagnationArgs = quant.strategyLabArgs({
    strategyFamily: 'low-position-volume-stagnation',
    positionLookbackWindows: [120], maxRangePositions: [0.35],
    volumeWindows: [20], volumeMultipliers: [1.8], maxAbsReturns: [0.02],
    maxIntradayRanges: [0.06], minCloseLocations: [0.5]
  });
  assert.deepEqual(stagnationArgs.slice(0, 16), [
    '--strategy-family', 'low-position-volume-stagnation',
    '--position-lookback-windows', '120',
    '--max-range-positions', '0.35',
    '--volume-windows', '20',
    '--volume-multipliers', '1.8',
    '--max-abs-returns', '0.02',
    '--max-intraday-ranges', '0.06',
    '--min-close-locations', '0.5'
  ]);
  assert.ok(stagnationArgs.includes('--min-close-locations'));
  assert.throws(() => quant.strategyLabArgs({
    strategyFamily: 'rsi-rebound',
    rsiPeriods: [14], entryThresholds: [30.5], exitThresholds: [70]
  }), /整数/);
});

test('signal scan arguments are deterministic and contain no order actions', () => {
  const low = quant.signalScanArgs({
    strategyFamily: 'low-position-volume-stagnation',
    positionLookbackWindows: [120], maxRangePositions: [0.35],
    volumeWindows: [20], volumeMultipliers: [1.8], maxAbsReturns: [0.02],
    maxIntradayRanges: [0.06], minCloseLocations: [0.5]
  });
  assert.ok(low.includes('--position-lookback-windows'));
  assert.equal(low.some(value => /order|broker|trade-submit/i.test(value)), false);
  assert.throws(() => quant.signalScanArgs({
    strategyFamily: 'volume-breakout', breakoutWindows: [20, 40]
  }), /只能填写一个值/);
});

test('signal scan readiness distinguishes exploratory from formal data', () => {
  const dataset = {
    valid: true,
    manifest: {
      datasetId: 'a-share-qfq-ready', createdAt: '2026-08-30T01:00:00.000Z', asOf: '2026-08-28',
      adjustmentMode: 'forward-adjusted', eligibility: 'exploratory_only',
      source: { id: 'test-source' }, dateRange: { start: '2021-08-28', end: '2026-08-28' },
      universe: { policy: 'current-a-share-ex-st', membershipMode: 'current-list', requestedCount: 5510 },
      coverage: { requested: 5510, succeeded: 5400, failed: 110, rows: 1000000 },
      warnings: []
    }
  };
  const readiness = quant.signalScanReadiness({
    datasets: [dataset], expectedAsOf: '2026-08-28', expectedUniverseCount: 5510
  });
  assert.equal(readiness.state, 'ready-exploratory');
  assert.equal(readiness.exploratoryAllowed, true);
  assert.equal(readiness.formalAllowed, false);
  assert.equal(readiness.datasetId, 'a-share-qfq-ready');
});

test('signal scan API exposes data readiness without starting a job', async t => {
  const server = app.listen(0);
  t.after(() => server.close());
  const before = quant.listJobs().length;
  const response = await requestJson(server, '/api/quant/signal-scans/readiness');
  assert.equal(response.statusCode, 200);
  assert.equal(response.json.data.automaticTrading, false);
  assert.equal(quant.listJobs().length, before);
});

test('strategy rule parser API returns a read-only structured card', async t => {
  const server = app.listen(0);
  t.after(() => server.close());

  const parsed = await requestJson(server, {
    path: '/api/quant/strategy-rules/parse',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { text: 'MACD 12,26,9 金叉买入，死叉卖出' });

  assert.equal(parsed.statusCode, 200);
  assert.equal(parsed.json.data.strategyFamily, 'macd-crossover');
  assert.equal(parsed.json.data.automaticTrading, false);
  assert.deepEqual(parsed.json.data.parameters.fastWindows, [12]);

  const unsupported = await requestJson(server, {
    path: '/api/quant/strategy-rules/parse',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { text: '请生成Python代码并自动下单' });
  assert.equal(unsupported.statusCode, 400);
});

test('full-market collection IDs are deterministic for resumable date ranges', () => {
  assert.equal(
    quant.collectionDatasetId('2020-01-01', '2026-08-10'),
    'sina-a-share-20200101-20260810'
  );
});

test('full-market sync plan requests a forward-adjusted baseline and keeps trading disabled', () => {
  const plan = quant.fullMarketSyncPlan({
    expectedAsOf: '2026-08-27',
    expectedUniverseCount: 5315,
    datasets: []
  });
  assert.equal(plan.action.mode, 'full');
  assert.equal(plan.adjustmentMode, 'forward-adjusted');
  assert.equal(plan.automaticTrading, false);
  assert.equal(plan.datasetId, 'a-share-qfq-20210827-20260827');
});

test('full-market sync plan reuses a verified stale baseline for only the missing dates', () => {
  const plan = quant.fullMarketSyncPlan({
    expectedAsOf: '2026-08-27',
    expectedUniverseCount: 5315,
    datasets: [{
      valid: true,
      manifest: {
        datasetId: 'a-share-qfq-20210827-20260826',
        createdAt: '2026-08-26T16:00:00.000Z',
        asOf: '2026-08-26',
        adjustmentMode: 'forward-adjusted',
        universe: { policy: 'current-a-share-ex-st', requestedCount: 5315 },
        coverage: { requested: 5315, succeeded: 5315, failed: 0 },
        dateRange: { start: '2021-08-27', end: '2026-08-26' }
      }
    }]
  });
  assert.equal(plan.action.mode, 'incremental');
  assert.equal(plan.baseDatasetId, 'a-share-qfq-20210827-20260826');
  assert.equal(plan.fetchStartDate, '2026-08-27');
  assert.equal(plan.datasetId, 'a-share-qfq-20210827-20260827');
});

test('full-market sync plan can explicitly repair a fresh but incomplete baseline', () => {
  const plan = quant.fullMarketSyncPlan({
    expectedAsOf: '2026-08-27',
    expectedUniverseCount: 5315,
    repairIncomplete: true,
    datasets: [{
      valid: true,
      manifest: {
        datasetId: 'a-share-qfq-20210827-20260827',
        createdAt: '2026-08-27T16:00:00.000Z',
        asOf: '2026-08-27',
        adjustmentMode: 'forward-adjusted',
        universe: { policy: 'current-a-share-ex-st', requestedCount: 5315 },
        coverage: { requested: 5315, succeeded: 4942, failed: 373 },
        requestedDateRange: { start: '2021-08-27', end: '2026-08-27' },
        dateRange: { start: '2021-08-30', end: '2026-08-27' }
      }
    }]
  });
  assert.equal(plan.action.mode, 'repair');
  assert.equal(plan.datasetId, 'a-share-qfq-20210827-20260827');
  assert.equal(plan.action.startDate, '2021-08-27');
  assert.equal(plan.automaticTrading, false);
});

test('full-market sync status API exposes the plan without starting a job', async t => {
  const server = app.listen(0);
  t.after(() => server.close());

  const response = await requestJson(server, '/api/quant/full-market-sync');
  assert.equal(response.statusCode, 200);
  assert.equal(response.json.success, true);
  assert.equal(response.json.data.automaticTrading, false);
  assert.equal(response.json.data.action.mode, 'full');
  assert.equal(quant.listJobs().some(job => job.kind === 'full-market-sync'), false);
});

test('daily full-market auto sync waits for an explicit baseline then runs stale increments after 09:05', () => {
  const missing = quant.fullMarketAutoSyncDecision({
    now: new Date('2026-08-28T01:06:00.000Z'),
    expectedAsOf: '2026-08-27', expectedUniverseCount: 5315,
    datasets: [], runtimeAvailable: true, jobs: []
  });
  assert.equal(missing.action, 'baseline-required');

  const staleDataset = [{
    valid: true,
    manifest: {
      datasetId: 'a-share-qfq-20210827-20260826', createdAt: '2026-08-26T16:00:00.000Z',
      asOf: '2026-08-26', adjustmentMode: 'forward-adjusted',
      universe: { policy: 'current-a-share-ex-st', requestedCount: 5315 },
      coverage: { requested: 5315, succeeded: 5315, failed: 0 },
      dateRange: { start: '2021-08-27', end: '2026-08-26' }
    }
  }];
  const before = quant.fullMarketAutoSyncDecision({
    now: new Date('2026-08-28T01:04:00.000Z'),
    expectedAsOf: '2026-08-27', expectedUniverseCount: 5315,
    datasets: staleDataset, runtimeAvailable: true, jobs: []
  });
  const due = quant.fullMarketAutoSyncDecision({
    now: new Date('2026-08-28T01:06:00.000Z'),
    expectedAsOf: '2026-08-27', expectedUniverseCount: 5315,
    datasets: staleDataset, runtimeAvailable: true, jobs: []
  });
  assert.equal(before.action, 'waiting');
  assert.equal(due.action, 'run');
  assert.equal(due.plan.action.mode, 'incremental');
});

test('MASTER universe limits scale conservatively with available memory', () => {
  const gb = 1024 ** 3;
  assert.equal(quant.defaultMasterMaxInstruments(8 * gb), 200);
  assert.equal(quant.defaultMasterMaxInstruments(16 * gb), 350);
  assert.equal(quant.defaultMasterMaxInstruments(32 * gb), 600);
});

test('research suite plans baseline, factor gate and bounded MASTER in order', () => {
  const steps = quant.researchSuiteSteps({ datasetId: 'dataset-demo', masterMaxInstruments: 480 });
  assert.deepEqual(steps.map(step => step.kind), ['lightgbm', 'factor-lab', 'master']);
  assert.ok(steps[0].args.includes('lightgbm'));
  assert.ok(steps[1].args.includes('factor-lab'));
  assert.ok(steps[2].args.includes('master'));
  assert.ok(steps[2].args.includes('480'));
});

test('daily strategy suite plans four read-only strategy families on one dataset', () => {
  const steps = quant.strategyDailySuiteSteps({
    datasetId: 'dataset-demo', suiteTimestamp: '20260826T010000Z', maxFolds: 3
  });
  assert.deepEqual(steps.map(step => step.strategyFamily), [
    'moving-average-crossover', 'macd-crossover', 'rsi-rebound', 'volume-breakout'
  ]);
  assert.equal(steps.every(step => step.args.includes('dataset-demo')), true);
  assert.equal(steps.every(step => step.args.includes('--strategy-family')), true);
  assert.equal(steps.some(step => step.args.some(value => /order|broker|trade-submit/i.test(value))), false);
});

test('watchlist research plan passes the exact Tonghuashun group to adjusted collection', () => {
  const items = [
    ['601138', '工业富联'], ['000977', '浪潮信息'], ['600584', '长电科技'], ['002463', '沪电股份'],
    ['000063', '中兴通讯'], ['601899', '紫金矿业'], ['000938', '紫光股份'], ['600183', '生益科技']
  ].map(([code, name]) => ({ code, name }));
  const catalog = {
    available: true,
    fileUpdatedAt: '2026-08-28T01:00:00.000Z',
    groups: [{ id: 'default-self-stock', name: '同花顺自选', sourcePath: 'D:/ths/SelfStockInfo.json', items }]
  };

  const plan = quant.watchlistResearchPlan({ groupId: 'default-self-stock' }, {
    catalog,
    now: new Date('2026-08-28T08:30:00.000Z')
  });

  assert.equal(plan.group.name, '同花顺自选');
  assert.equal(plan.startDate, '2021-08-28');
  assert.equal(plan.endDate, '2026-08-28');
  assert.deepEqual(plan.codes, items.map(item => item.code));
  assert.equal(plan.collectArgs[plan.collectArgs.indexOf('--codes') + 1], items.map(item => item.code).join(','));
  assert.equal(plan.collectArgs[plan.collectArgs.indexOf('--limit') + 1], '8');
  assert.equal(plan.collectArgs[plan.collectArgs.indexOf('--adjustment-mode') + 1], 'forward-adjusted');
  assert.equal(plan.request.automaticTrading, false);
  assert.equal(plan.request.readOnlyTonghuashun, true);
  assert.equal(plan.collectArgs.some(value => /order|broker|trade-submit/i.test(value)), false);
});

test('watchlist research rejects missing and undersized Tonghuashun groups before collection', () => {
  const catalog = {
    available: true,
    groups: [{ id: 'tiny', name: '太小', sourcePath: 'D:/ths/tiny', items: [
      { code: '600000', name: '浦发银行' }, { code: '000001', name: '平安银行' }
    ] }]
  };
  assert.throws(() => quant.watchlistResearchPlan({ groupId: 'missing' }, { catalog }), /分组|missing/i);
  assert.throws(() => quant.watchlistResearchPlan({ groupId: 'tiny' }, { catalog }), /8|至少/);
});

test('watchlist recommendation preview keeps the full report separate and limits the actionable shortlist', () => {
  const candidates = Array.from({ length: 27 }, (_, index) => ({
    code: String(600000 + index),
    name: '候选' + (index + 1),
    stableFamilyCount: index < 5 ? 2 : 1
  }));
  const report = { asOf: '2026-08-27', candidates };

  const preview = quant.buildRecommendationPreview(report);

  assert.equal(report.candidates.length, 27);
  assert.equal(preview.items.length, 20);
  assert.equal(preview.totalCandidateCount, 27);
  assert.equal(preview.truncated, true);
  assert.equal(preview.automaticApply, false);
});

test('watchlist local summary keeps collection failures readable without dumping provider URLs', () => {
  const summary = quant.buildWatchlistResearchSummary(
    { comparisons: [], candidates: [] },
    { asOf: '2026-08-27', coverage: { requested: 8, succeeded: 7, failed: 1 } },
    { name: '同花顺自选' },
    { failures: [{ code: '001232', reason: '501 Server Error: Not Implemented for url: https://provider.invalid/very/long/url' }] }
  );
  assert.match(summary, /001232/);
  assert.match(summary, /前复权公开数据源/);
  assert.doesNotMatch(summary, /https:\/\//);
});

test('quant subprocesses use bounded native-library threads on Windows', () => {
  const environment = quant.quantProcessEnvironment({ PATH: 'demo', WEBSTOCK_QUANT_THREADS: '2' });
  assert.equal(environment.PATH, 'demo');
  assert.equal(environment.OMP_NUM_THREADS, '2');
  assert.equal(environment.MKL_NUM_THREADS, '2');
  assert.equal(environment.OPENBLAS_NUM_THREADS, '2');
  assert.equal(environment.NUMEXPR_NUM_THREADS, '2');
  assert.equal(environment.PYTHONFAULTHANDLER, '1');
});

test('native Windows access violations are retried once but ordinary failures are not', async () => {
  let attempts = 0;
  const recovered = await quant.retryNativeCrash(async function() {
    attempts += 1;
    if (attempts === 1) {
      const error = new Error('native crash');
      error.exitCode = 3221225477;
      throw error;
    }
    return 'ok';
  });
  assert.equal(recovered, 'ok');
  assert.equal(attempts, 2);

  let ordinaryAttempts = 0;
  await assert.rejects(() => quant.retryNativeCrash(async function() {
    ordinaryAttempts += 1;
    throw new Error('bad strategy input');
  }), /bad strategy input/);
  assert.equal(ordinaryAttempts, 1);
});

test('watchlist research APIs list local groups and start only the read-only research path', async t => {
  const originalGroups = quant.listWatchlistResearchGroups;
  const originalStart = quant.startWatchlistResearch;
  const calls = [];
  quant.listWatchlistResearchGroups = function() {
    calls.push({ kind: 'groups' });
    return { available: true, groups: [{ id: 'default-self-stock', name: '同花顺自选', count: 90 }] };
  };
  quant.startWatchlistResearch = function(input) {
    calls.push({ kind: 'start', input });
    return { id: 'watchlist-research-demo', kind: 'watchlist-research', status: 'queued', request: { automaticTrading: false } };
  };
  t.after(() => {
    quant.listWatchlistResearchGroups = originalGroups;
    quant.startWatchlistResearch = originalStart;
  });
  const server = app.listen(0);
  t.after(() => server.close());

  const listed = await requestJson(server, '/api/quant/watchlist-groups');
  const started = await requestJson(server, {
    path: '/api/quant/watchlist-research', method: 'POST', headers: { 'Content-Type': 'application/json' }
  }, { groupId: 'default-self-stock' });

  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json.data.groups[0].count, 90);
  assert.equal(started.statusCode, 200);
  assert.equal(started.json.data.kind, 'watchlist-research');
  assert.equal(started.json.data.request.automaticTrading, false);
  assert.deepEqual(calls, [
    { kind: 'groups' },
    { kind: 'start', input: { groupId: 'default-self-stock' } }
  ]);
});

test('daily strategy APIs expose comparison data and a bounded schedule decision', async t => {
  const originalReport = quant.getStrategyDailyReport;
  const originalSchedule = quant.getStrategyDailyScheduleStatus;
  const originalRunScheduled = quant.runScheduledStrategyDaily;
  const calls = [];
  quant.getStrategyDailyReport = function(options) {
    calls.push({ kind: 'report', verification: options.verification });
    return { schema: 'webstock.quant.strategy-daily.v1', status: 'partial', automaticTrading: false, candidates: [] };
  };
  quant.getStrategyDailyScheduleStatus = function() {
    calls.push({ kind: 'status' });
    return { action: 'blocked', reason: '请先同步全市场。' };
  };
  quant.runScheduledStrategyDaily = function() {
    calls.push({ kind: 'scheduled', argumentCount: arguments.length });
    return { action: 'blocked', reason: '请先同步全市场。' };
  };
  t.after(() => {
    quant.getStrategyDailyReport = originalReport;
    quant.getStrategyDailyScheduleStatus = originalSchedule;
    quant.runScheduledStrategyDaily = originalRunScheduled;
  });
  const server = app.listen(0);
  t.after(() => server.close());

  const report = await requestJson(server, '/api/quant/strategy-daily?verification=full');
  const status = await requestJson(server, '/api/quant/strategy-daily/schedule');
  const scheduled = await requestJson(server, {
    path: '/api/quant/strategy-daily/schedule', method: 'POST', headers: { 'Content-Type': 'application/json' }
  }, { now: '2099-01-01T09:06:00.000Z' });

  assert.equal(report.statusCode, 200);
  assert.equal(report.json.data.automaticTrading, false);
  assert.equal(status.json.data.action, 'blocked');
  assert.equal(scheduled.json.data.action, 'blocked');
  assert.deepEqual(calls, [
    { kind: 'report', verification: 'full' }, { kind: 'status' }, { kind: 'scheduled', argumentCount: 0 }
  ]);
});

test('research suite API refuses to start without the isolated runtime', async t => {
  const server = app.listen(0);
  t.after(() => server.close());
  const response = await requestJson(server, {
    path: '/api/quant/research-suite',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { datasetId: 'dataset-demo' });
  assert.equal(response.statusCode, 409);
  assert.match(response.json.error, /Python|runtime/i);
});

test('quant result APIs keep summary listing separate from explicit full verification', async t => {
  const originalListResults = quant.listResults;
  const originalListFactorResults = quant.listFactorResults;
  const calls = [];
  quant.listResults = function(limit, options) {
    calls.push({ kind: 'result', limit, verification: options && options.verification });
    const full = options && options.verification === 'full';
    return [{ verification: {
      status: full ? 'hash_verified' : 'metadata_valid',
      scope: full ? 'full' : 'metadata',
      hashesVerified: !!full,
      checkedAt: '2026-08-12T12:00:00.000Z'
    } }];
  };
  quant.listFactorResults = function(limit, options) {
    calls.push({ kind: 'factor', limit, verification: options && options.verification });
    return [{ verification: {
      status: 'hash_verified',
      scope: 'full',
      hashesVerified: true,
      checkedAt: '2026-08-12T12:00:00.000Z'
    } }];
  };
  t.after(() => {
    quant.listResults = originalListResults;
    quant.listFactorResults = originalListFactorResults;
  });

  const server = app.listen(0);
  t.after(() => server.close());
  const summary = await requestJson(server, '/api/quant/results?limit=7');
  const full = await requestJson(server, '/api/quant/results?limit=3&verification=full');
  const factorFull = await requestJson(server, '/api/quant/factor-labs?limit=5&verification=full');

  assert.deepEqual(summary.json.data[0].verification, {
    status: 'metadata_valid', scope: 'metadata', hashesVerified: false, checkedAt: '2026-08-12T12:00:00.000Z'
  });
  assert.deepEqual(full.json.data[0].verification, {
    status: 'hash_verified', scope: 'full', hashesVerified: true, checkedAt: '2026-08-12T12:00:00.000Z'
  });
  assert.deepEqual(factorFull.json.data[0].verification, {
    status: 'hash_verified', scope: 'full', hashesVerified: true, checkedAt: '2026-08-12T12:00:00.000Z'
  });

  assert.deepEqual(calls, [
    { kind: 'result', limit: '7', verification: undefined },
    { kind: 'result', limit: '3', verification: 'full' },
    { kind: 'factor', limit: '5', verification: 'full' }
  ]);
});

test.after(() => {
  require('../db').close();
  fs.rmSync(root, { recursive: true, force: true });
});
