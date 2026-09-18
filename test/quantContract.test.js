const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateDatasetManifest,
  validateQuantResult,
  validateFactorLabResult,
  validateStrategyLabResult,
  validateSignalScanResult,
  manifestSha256
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

function validStrategyLabResult(overrides = {}) {
  const folds = [
    {
      train: { start: '2022-01-04', end: '2023-01-03' },
      validation: { start: '2023-01-05', end: '2023-03-31' },
      test: { start: '2023-04-04', end: '2023-06-30' },
      purgeDays: 1
    },
    {
      train: { start: '2023-07-04', end: '2024-07-03' },
      validation: { start: '2024-07-05', end: '2024-09-30' },
      test: { start: '2024-10-02', end: '2024-12-31' },
      purgeDays: 1
    },
    {
      train: { start: '2025-01-03', end: '2025-07-01' },
      validation: { start: '2025-07-03', end: '2025-09-30' },
      test: { start: '2025-10-02', end: '2025-12-31' },
      purgeDays: 1
    }
  ];
  const foldMetrics = { netReturn: 0.02, maxDrawdown: -0.03, tradeCount: 4, winRate: 0.5, buyCount: 4, sellCount: 4, blockedBuys: 0, blockedSells: 1, unclosedPositions: 0 };
  const parameter = {
    parameterId: 'ma-5-20', shortWindow: 5, longWindow: 20, admission: 'stable',
    reasons: ['探索性稳定门槛'],
    metrics: { foldCount: 3, meanOosReturn: 0.02, medianOosReturn: 0.02, worstOosReturn: 0.01, positiveFoldRate: 1, maxDrawdown: -0.03, tradeCount: 12, winRate: 0.5, validationMeanReturn: 0.01 },
    folds: folds.map((_, index) => ({ fold: index + 1, validation: foldMetrics, test: foldMetrics }))
  };
  return Object.assign({
    schema: 'webstock.quant.strategy-lab.v1',
    runId: 'strategy-lab-20260826-001',
    createdAt: '2026-08-26T03:00:00.000Z',
    status: 'completed',
    validationStatus: 'exploratory',
    automaticTrading: false,
    asOf: '2026-08-07',
    dataManifest: { datasetId: 'sina-pilot-20260809', sha256: 'b'.repeat(64) },
    runtime: { python: '3.12.13' },
    ruleCard: { strategyFamily: 'moving-average-crossover', entryRule: 'next open', exitRule: 'next open', shortWindows: [5], longWindows: [20] },
    executionAssumptions: { commissionBps: 2.5, minimumCommission: 5, stampDutyBps: 5, slippageBps: 2, capitalPerSymbol: 100000, boardLot: 100, priceLimitRate: 0.1, tPlusOne: true, signalTiming: 'close-signal-next-open-execution', suspensionPolicy: 'zero-volume-not-executable' },
    windowParameters: { trainDays: 252, validationDays: 63, testDays: 63, stepDays: 63, maxFolds: 3, minimumHistoryDays: 120, maxInstruments: 600 },
    universe: { policy: 'main-board-a-share-ex-st', requested: 30, included: 20, excludedByBoard: 8, excludedSt: 2, excludedInsufficientHistory: 0, excludedByLiquidityCap: 0, suspendedRows: 3, minimumHistoryDays: 120 },
    folds,
    selections: folds.map((_, index) => ({ fold: index + 1, selectedParameterId: 'ma-5-20', selectedFrom: 'validation-only', validation: foldMetrics, test: foldMetrics })),
    selectedWalkForward: { admission: 'stable', foldCount: 3, meanOosReturn: 0.02, medianOosReturn: 0.02, worstOosReturn: 0.01, positiveFoldRate: 1, maxDrawdown: -0.03, tradeCount: 12, winRate: 0.5, reasons: [] },
    parameters: [parameter],
    stableParameterIds: ['ma-5-20'],
    bestParameter: parameter,
    worstParameter: parameter,
    artifacts: [{ path: 'parameter_stability.csv', sha256: 'c'.repeat(64), rows: 1 }],
    warnings: ['Exploratory research only.']
  }, overrides);
}

function validSignalScanResult(overrides = {}) {
  return Object.assign({
    schema: 'webstock.quant.signal-scan.v1',
    runId: 'signal-scan-20260830-001',
    createdAt: '2026-08-30T03:00:00.000Z',
    status: 'completed',
    validationMode: 'exploratory',
    automaticTrading: false,
    asOf: '2026-08-07',
    dataManifest: { datasetId: 'sina-pilot-20260809', sha256: 'b'.repeat(64) },
    runtime: { python: '3.12.13' },
    dataGate: {
      datasetEligibility: 'exploratory_only', formalAllowed: false,
      researchUseOnly: true, adjustmentMode: 'unadjusted', membershipMode: 'current-list',
      coverage: { requested: 30, succeeded: 28, failed: 2, rows: 52140 }
    },
    ruleCard: {
      strategyFamily: 'low-position-volume-stagnation', label: '低位放量滞涨',
      entryRule: 'close rule', exitRule: 'next-open exit',
      parameterId: 'stagnation-120-0.35-20-1.8-0.02-0.06-0.5',
      settings: {
        positionLookbackWindow: 120, maxRangePosition: 0.35,
        volumeWindow: 20, volumeMultiplier: 1.8, maxAbsReturn: 0.02,
        maxIntradayRange: 0.06, minCloseLocation: 0.5
      }
    },
    universe: {
      policy: 'main-board-a-share-ex-st', requested: 28, included: 20,
      excludedByBoard: 5, excludedSt: 1, excludedInsufficientHistory: 2,
      suspendedRows: 0, minimumHistoryDays: 121
    },
    candidateCount: 1,
    storedCount: 1,
    truncated: false,
    candidates: [{
      code: '600000', name: '浦发银行', signalDate: '2026-08-07',
      strategyFamily: 'low-position-volume-stagnation',
      parameterId: 'stagnation-120-0.35-20-1.8-0.02-0.06-0.5',
      matchStrength: 78.5, candidateStatus: 'rule-match-unconfirmed',
      rawEvidence: { signalDate: '2026-08-07', close: 10, rangePosition: 0.2, volumeRatio: 2 },
      thresholds: { positionLookbackWindow: 120, maxRangePosition: 0.35 },
      whyMatched: ['区间位置满足阈值', '成交量满足阈值'],
      confirmationRule: '未来3个交易日确认', invalidationRule: '跌破信号日低点',
      earliestActionTiming: '下一可成交日人工观察'
    }],
    artifacts: [{ path: 'candidates.csv', sha256: 'c'.repeat(64), rows: 1 }],
    warnings: ['规则匹配不是买入推荐。']
  }, overrides);
}

test('dataset manifests preserve source, coverage, hashes and provenance limits', () => {
  const manifest = validateDatasetManifest(validManifest());
  assert.equal(manifest.datasetId, 'sina-pilot-20260809');
  assert.equal(manifest.eligibility, 'exploratory_only');
  assert.equal(manifest.coverage.succeeded + manifest.coverage.failed, manifest.coverage.requested);
});

test('manifest hashes match Python canonical JSON for integral coverage rates', () => {
  const manifest = {
    datasetId: 'cross-language',
    quality: { coverageRate: 1, failed: 0 },
    warnings: ['中文']
  };
  assert.equal(manifestSha256(manifest), '82680d857f6bae84ef6765d09479206ad21b5b3b2956390e1f6cb0154dca4b16');
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

test('strategy lab preserves three-fold evidence and cannot enable automatic trading', () => {
  const result = validateStrategyLabResult(validStrategyLabResult(), validManifest());
  assert.equal(result.folds.length, 3);
  assert.equal(result.parameters[0].admission, 'stable');
  assert.equal(result.automaticTrading, false);
  assert.throws(() => validateStrategyLabResult(validStrategyLabResult({ automaticTrading: true }), validManifest()), /automatic|trading|只读/i);
});

test('strategy lab validates traceable current signals and rejects eliminated evidence', () => {
  const result = validStrategyLabResult({
    currentSignals: {
      asOf: '2026-08-07',
      earliestObservation: 'next-executable-open',
      admissionPolicy: 'stable-or-watch-only',
      universeScanned: 20,
      eligibleParameterCount: 1,
      scannedParameterCount: 1,
      parameterScanTruncated: false,
      candidateCount: 1,
      storedCount: 1,
      truncated: false,
      candidates: [{
        code: '600000', name: '浦发银行', signalDate: '2026-08-07',
        strategyFamily: 'moving-average-crossover', parameterIds: ['ma-5-20'],
        admissions: ['stable'], candidateStatus: 'stable',
        evidence: [{ parameterId: 'ma-5-20', label: 'MA5 / MA20', admission: 'stable', positiveFoldRate: 1, meanOosReturn: 0.02, medianOosReturn: 0.02 }]
      }]
    }
  });
  assert.equal(validateStrategyLabResult(result, validManifest()).currentSignals.candidateCount, 1);

  result.parameters[0].admission = 'rejected';
  result.stableParameterIds = [];
  assert.throws(() => validateStrategyLabResult(result, validManifest()), /current signal|candidate|admission/i);
});

test('strategy lab accepts generic audited parameters for every controlled family', () => {
  const families = [
    ['macd-crossover', 'macd-12-26-9', 'MACD 12/26/9', { fastWindow: 12, slowWindow: 26, signalWindow: 9 }],
    ['rsi-rebound', 'rsi-14-30-70', 'RSI 14 · 30/70', { rsiPeriod: 14, entryThreshold: 30, exitThreshold: 70 }],
    ['volume-breakout', 'breakout-20-1.5', '20日放量突破 · 1.5倍', { breakoutWindow: 20, volumeMultiplier: 1.5 }],
    ['low-position-volume-stagnation', 'stagnation-120-0.35-20-1.8-0.02-0.06-0.5', '120日低位放量滞涨 · 1.8倍量', {
      positionLookbackWindow: 120, maxRangePosition: 0.35,
      volumeWindow: 20, volumeMultiplier: 1.8, maxAbsReturn: 0.02,
      maxIntradayRange: 0.06, minCloseLocation: 0.5
    }]
  ];

  families.forEach(([family, parameterId, label, settings]) => {
    const result = validStrategyLabResult();
    const parameter = Object.assign({}, result.parameters[0], { parameterId, label, settings });
    delete parameter.shortWindow;
    delete parameter.longWindow;
    result.ruleCard = { strategyFamily: family, label, entryRule: 'next open', exitRule: 'next open', parameterCount: 1 };
    result.parameters = [parameter];
    result.stableParameterIds = [parameterId];
    result.bestParameter = parameter;
    result.worstParameter = parameter;
    result.selections = result.selections.map(item => Object.assign({}, item, { selectedParameterId: parameterId }));

    assert.equal(validateStrategyLabResult(result, validManifest()).ruleCard.strategyFamily, family);
  });
});

test('strategy lab rejects fractional periods in controlled strategy settings', () => {
  const macd = validStrategyLabResult();
  macd.ruleCard = { strategyFamily: 'macd-crossover', label: 'MACD', entryRule: 'next open', exitRule: 'next open', parameterCount: 1 };
  macd.parameters[0] = Object.assign({}, macd.parameters[0], {
    parameterId: 'macd-invalid', label: 'invalid',
    settings: { fastWindow: 12, slowWindow: 26, signalWindow: 9.5 }
  });
  delete macd.parameters[0].shortWindow;
  delete macd.parameters[0].longWindow;
  macd.stableParameterIds = ['macd-invalid'];
  macd.bestParameter = macd.parameters[0];
  macd.worstParameter = macd.parameters[0];
  macd.selections = macd.selections.map(item => Object.assign({}, item, { selectedParameterId: 'macd-invalid' }));
  assert.throws(() => validateStrategyLabResult(macd, validManifest()), /MACD parameter settings/i);

  const rsi = structuredClone(macd);
  rsi.ruleCard.strategyFamily = 'rsi-rebound';
  rsi.parameters[0].parameterId = 'rsi-invalid';
  rsi.parameters[0].settings = { rsiPeriod: 14, entryThreshold: 30.5, exitThreshold: 70 };
  rsi.stableParameterIds = ['rsi-invalid'];
  rsi.bestParameter = rsi.parameters[0];
  rsi.worstParameter = rsi.parameters[0];
  rsi.selections = rsi.selections.map(item => Object.assign({}, item, { selectedParameterId: 'rsi-invalid' }));
  assert.throws(() => validateStrategyLabResult(rsi, validManifest()), /RSI parameter settings/i);
});

test('strategy lab rejects fewer than three sample-out folds and invalid stable labels', () => {
  assert.throws(() => validateStrategyLabResult(validStrategyLabResult({ folds: validStrategyLabResult().folds.slice(0, 2) }), validManifest()), /three|3|fold/i);
  const invalid = validStrategyLabResult();
  invalid.parameters = [Object.assign({}, invalid.parameters[0], { admission: 'approved' })];
  assert.throws(() => validateStrategyLabResult(invalid, validManifest()), /admission/i);
});

test('signal scan preserves raw rule evidence and remains read-only', () => {
  const result = validateSignalScanResult(validSignalScanResult(), validManifest());
  assert.equal(result.candidates[0].candidateStatus, 'rule-match-unconfirmed');
  assert.equal(result.dataGate.formalAllowed, false);
  assert.equal(result.automaticTrading, false);
  assert.throws(() => validateSignalScanResult(
    validSignalScanResult({ automaticTrading: true }), validManifest()
  ), /automatic|trading|read-only/i);
});

test('formal signal scan cannot use an exploratory dataset', () => {
  const formal = validSignalScanResult({
    validationMode: 'formal',
    dataGate: Object.assign({}, validSignalScanResult().dataGate, {
      formalAllowed: true,
      researchUseOnly: false
    })
  });
  assert.throws(() => validateSignalScanResult(formal, validManifest()), /formal|eligible|exploratory/i);
});
