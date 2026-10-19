const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildStrategyDailyReport,
  strategyDailyScheduleDecision,
  latestEligibleDailyCompletionDate
} = require('../services/strategyDailyService');

const FAMILIES = [
  'moving-average-crossover', 'macd-crossover', 'rsi-rebound', 'volume-breakout'
];

function resultEntry(family, options = {}) {
  const parameterId = options.parameterId || family + '-parameter';
  const admission = options.admission || 'stable';
  const candidateCode = options.candidateCode || '600000';
  return {
    valid: true,
    resultPath: 'D:/quant/' + family + '/result.json',
    verification: { status: 'hash_verified', scope: 'full', hashesVerified: true },
    result: {
      runId: options.runId || 'run-' + family,
      createdAt: options.createdAt || '2026-08-26T01:00:00.000Z',
      automaticTrading: false,
      asOf: options.asOf || '2026-08-25',
      dataManifest: { datasetId: options.datasetId || 'sina-a-share-20200101-20260825', sha256: 'a'.repeat(64) },
      ruleCard: { strategyFamily: family, label: family },
      stableParameterIds: admission === 'stable' ? [parameterId] : [],
      bestParameter: { parameterId, label: parameterId, admission, metrics: { meanOosReturn: 0.02, medianOosReturn: 0.01, worstOosReturn: -0.01, positiveFoldRate: 0.67, maxDrawdown: -0.08, tradeCount: 12 } },
      selectedWalkForward: { admission, meanOosReturn: 0.01, medianOosReturn: 0.01, worstOosReturn: -0.02, positiveFoldRate: 0.67, maxDrawdown: -0.08, tradeCount: 10 },
      currentSignals: {
        asOf: options.asOf || '2026-08-25', universeScanned: 2800,
        candidateCount: 1, storedCount: 1, truncated: false,
        candidates: [{
          code: candidateCode, name: options.name || '浦发银行', signalDate: options.asOf || '2026-08-25',
          strategyFamily: family, parameterIds: [parameterId], admissions: [admission], candidateStatus: admission,
          evidence: [{ parameterId, label: parameterId, admission, positiveFoldRate: 0.67, meanOosReturn: 0.02, medianOosReturn: 0.01 }]
        }]
      }
    }
  };
}

test('daily report compares four same-source strategies and ranks explainable consensus', () => {
  const entries = FAMILIES.map(family => resultEntry(family));
  entries.push(resultEntry('macd-crossover', { datasetId: 'other-dataset', asOf: '2026-08-24', candidateCode: '000001' }));

  const report = buildStrategyDailyReport(entries);

  assert.equal(report.status, 'complete');
  assert.equal(report.automaticTrading, false);
  assert.equal(report.datasetId, 'sina-a-share-20200101-20260825');
  assert.equal(report.asOf, '2026-08-25');
  assert.equal(report.comparisons.length, 4);
  assert.deepEqual(report.missingFamilies, []);
  assert.equal(report.candidates[0].code, '600000');
  assert.equal(report.candidates[0].stableFamilyCount, 4);
  assert.equal(report.candidates[0].consensusCount, 4);
});

test('daily report marks missing families and never mixes a different cutoff', () => {
  const report = buildStrategyDailyReport([
    resultEntry('moving-average-crossover'),
    resultEntry('macd-crossover'),
    resultEntry('rsi-rebound', { asOf: '2026-08-24', candidateCode: '000001' })
  ]);

  assert.equal(report.status, 'partial');
  assert.equal(report.comparisons.length, 2);
  assert.deepEqual(report.missingFamilies.sort(), ['rsi-rebound', 'volume-breakout']);
  assert.equal(report.candidates.some(candidate => candidate.code === '000001'), false);
});

test('daily scheduler runs once after 09:05 Beijing and blocks stale full-market data', () => {
  const freshDatasets = [{
    valid: true,
    manifest: {
      datasetId: 'sina-a-share-20200101-20260825', asOf: '2026-08-25', createdAt: '2026-08-26T00:30:00.000Z',
      coverage: { requested: 5315 }
    }
  }];
  const ready = strategyDailyScheduleDecision({ now: new Date('2026-08-26T01:06:00.000Z'), datasets: freshDatasets });
  assert.equal(ready.action, 'run');
  assert.equal(ready.datasetId, 'sina-a-share-20200101-20260825');

  const duplicate = strategyDailyScheduleDecision({
    now: new Date('2026-08-26T01:06:00.000Z'), datasets: freshDatasets, lastCompletedDate: '2026-08-26'
  });
  assert.equal(duplicate.action, 'skip');

  const stale = strategyDailyScheduleDecision({
    now: new Date('2026-08-26T01:06:00.000Z'),
    datasets: [{ valid: true, manifest: { datasetId: 'sina-a-share-old', asOf: '2026-08-07', createdAt: '2026-08-08T00:00:00.000Z', coverage: { requested: 5315 } } }]
  });
  assert.equal(stale.action, 'blocked');
  assert.match(stale.reason, /过期|同步/);
});

test('daily scheduler reports a missing quant runtime before selecting data', () => {
  const decision = strategyDailyScheduleDecision({
    now: new Date('2026-08-26T01:06:00.000Z'),
    runtimeAvailable: false,
    datasets: [{ valid: true, manifest: { datasetId: 'sina-a-share-current', asOf: '2026-08-25', coverage: { requested: 5315 } } }]
  });
  assert.equal(decision.action, 'blocked');
  assert.match(decision.reason, /量化环境/);
});

test('daily scheduler respects exchange holidays and blocks uncovered calendar years', () => {
  const inputs = {
    datasets: [{ valid: true, manifest: { datasetId: 'full-market', asOf: '2026-09-30', coverage: { requested: 5315 } } }]
  };
  const holiday = strategyDailyScheduleDecision({ ...inputs, now: new Date('2026-10-01T10:00:00+08:00') });
  assert.equal(holiday.action, 'wait');
  assert.match(holiday.reason, /休市/);
  const uncovered = strategyDailyScheduleDecision({ ...inputs, now: new Date('2027-01-04T10:00:00+08:00') });
  assert.equal(uncovered.action, 'blocked');
  assert.match(uncovered.reason, /日历.*覆盖/);
});

test('daily completion only counts a qualifying full-market dataset', () => {
  const datasets = [
    { valid: true, manifest: { datasetId: 'full-market', asOf: '2026-08-25', coverage: { requested: 5315 } } },
    { valid: true, manifest: { datasetId: 'stale-full-market', asOf: '2026-08-01', coverage: { requested: 5315 } } },
    { valid: true, manifest: { datasetId: 'pilot', asOf: '2026-08-25', coverage: { requested: 8 } } }
  ];
  const jobs = [
    { kind: 'strategy-daily', status: 'completed', updatedAt: '2026-08-25T16:30:00.000Z', output: { datasetId: 'full-market' } },
    { kind: 'strategy-daily', status: 'completed', updatedAt: '2026-08-26T01:30:00.000Z', output: { datasetId: 'pilot' } },
    { kind: 'strategy-daily', status: 'completed', updatedAt: '2026-08-26T02:30:00.000Z', output: { datasetId: 'stale-full-market' } }
  ];
  assert.equal(latestEligibleDailyCompletionDate(jobs, datasets), '2026-08-26');
  assert.equal(latestEligibleDailyCompletionDate(jobs.slice(1), datasets), '');
});
