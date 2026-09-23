const crypto = require('node:crypto');
const fs = require('node:fs');

const DATASET_SCHEMA = 'webstock.quant.dataset.v1';
const RESULT_SCHEMA = 'webstock.quant.result.v1';
const FACTOR_LAB_SCHEMA = 'webstock.quant.factor-lab.v1';
const STRATEGY_LAB_SCHEMA = 'webstock.quant.strategy-lab.v1';
const SIGNAL_SCAN_SCHEMA = 'webstock.quant.signal-scan.v1';
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REQUIRED_METRICS = [
  'rankIc',
  'icir',
  'annualizedReturn',
  'volatility',
  'maxDrawdown',
  'sharpe',
  'turnover',
  'tradeCount'
];

function contractError(message) {
  const error = new Error(message);
  error.code = 'INVALID_QUANT_CONTRACT';
  return error;
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw contractError(label + ' must be an object');
  }
  return value;
}

function nonEmptyString(value, label) {
  const next = String(value == null ? '' : value).trim();
  if (!next) throw contractError(label + ' is required');
  return next;
}

function dateString(value, label) {
  const next = nonEmptyString(value, label);
  if (!DATE_PATTERN.test(next) || Number.isNaN(Date.parse(next + 'T00:00:00Z'))) {
    throw contractError(label + ' must be YYYY-MM-DD');
  }
  return next;
}

function timestampString(value, label) {
  const next = nonEmptyString(value, label);
  if (Number.isNaN(Date.parse(next))) throw contractError(label + ' must be an ISO timestamp');
  return next;
}

function finiteNumber(value, label) {
  const next = Number(value);
  if (!Number.isFinite(next)) throw contractError(label + ' must be finite');
  return next;
}

function nonNegativeInteger(value, label) {
  const next = Number(value);
  if (!Number.isInteger(next) || next < 0) throw contractError(label + ' must be a non-negative integer');
  return next;
}

function sha256(value, label) {
  const next = nonEmptyString(value, label);
  if (!SHA256_PATTERN.test(next)) throw contractError(label + ' must be a SHA-256 hex digest');
  return next.toLowerCase();
}

function stringArray(value, label, allowEmpty = false) {
  if (!Array.isArray(value)) throw contractError(label + ' must be an array');
  const items = value.map(item => String(item == null ? '' : item).trim()).filter(Boolean);
  if (!allowEmpty && !items.length) throw contractError(label + ' must not be empty');
  return items;
}

function validateDatasetManifest(input) {
  const manifest = object(input, 'dataset manifest');
  if (manifest.schema !== DATASET_SCHEMA) throw contractError('unsupported dataset manifest schema');
  nonEmptyString(manifest.datasetId, 'datasetId');
  nonEmptyString(manifest.createdAt, 'createdAt');
  dateString(manifest.asOf, 'asOf');

  const source = object(manifest.source, 'source');
  nonEmptyString(source.id, 'source.id');
  nonEmptyString(source.name, 'source.name');
  nonEmptyString(source.accessMode, 'source.accessMode');
  nonEmptyString(source.endpoint, 'source.endpoint');
  if (typeof source.termsVerified !== 'boolean') throw contractError('source.termsVerified must be boolean');

  const universe = object(manifest.universe, 'universe');
  nonEmptyString(universe.policy, 'universe.policy');
  nonEmptyString(universe.membershipMode, 'universe.membershipMode');
  const requestedCount = nonNegativeInteger(universe.requestedCount, 'universe.requestedCount');
  const includedCount = nonNegativeInteger(universe.includedCount, 'universe.includedCount');
  const excludedCount = nonNegativeInteger(universe.excludedCount, 'universe.excludedCount');
  if (includedCount + excludedCount !== requestedCount) {
    throw contractError('universe coverage counts are inconsistent');
  }

  const dateRange = object(manifest.dateRange, 'dateRange');
  const start = dateString(dateRange.start, 'dateRange.start');
  const end = dateString(dateRange.end, 'dateRange.end');
  if (start > end || manifest.asOf < end) throw contractError('dataset date range is inconsistent with asOf');
  stringArray(manifest.columns, 'columns');
  nonEmptyString(manifest.adjustmentMode, 'adjustmentMode');

  const coverage = object(manifest.coverage, 'coverage');
  const coverageRequested = nonNegativeInteger(coverage.requested, 'coverage.requested');
  const succeeded = nonNegativeInteger(coverage.succeeded, 'coverage.succeeded');
  const failed = nonNegativeInteger(coverage.failed, 'coverage.failed');
  nonNegativeInteger(coverage.rows, 'coverage.rows');
  if (succeeded + failed !== coverageRequested || coverageRequested !== requestedCount) {
    throw contractError('coverage counts are inconsistent');
  }

  if (!Array.isArray(manifest.files) || !manifest.files.length) {
    throw contractError('files must contain at least one artifact');
  }
  manifest.files.forEach((file, index) => {
    object(file, 'files[' + index + ']');
    nonEmptyString(file.path, 'files[' + index + '].path');
    sha256(file.sha256, 'files[' + index + '].sha256');
    nonNegativeInteger(file.rows, 'files[' + index + '].rows');
  });
  sha256(manifest.manifestSha256, 'manifestSha256');

  if (!['exploratory_only', 'validation_eligible'].includes(manifest.eligibility)) {
    throw contractError('eligibility must be exploratory_only or validation_eligible');
  }
  stringArray(manifest.warnings, 'warnings', true);

  if (manifest.eligibility === 'validation_eligible') {
    if (!source.termsVerified) throw contractError('validation-eligible data requires verified source terms');
    if (universe.membershipMode !== 'point-in-time') throw contractError('validation-eligible data requires point-in-time membership');
    if (!['forward-adjusted', 'backward-adjusted', 'point-in-time-adjusted'].includes(manifest.adjustmentMode)) {
      throw contractError('validation-eligible data requires an explicit adjustment method');
    }
  }
  return manifest;
}

function validateSegment(segment, label) {
  const value = object(segment, label);
  return {
    start: dateString(value.start, label + '.start'),
    end: dateString(value.end, label + '.end')
  };
}

function validateQuantResult(input, datasetInput) {
  const result = object(input, 'quant result');
  const manifest = validateDatasetManifest(datasetInput);
  if (result.schema !== RESULT_SCHEMA) throw contractError('unsupported quant result schema');
  nonEmptyString(result.runId, 'runId');
  nonEmptyString(result.modelId, 'modelId');
  if (result.createdAt != null) timestampString(result.createdAt, 'createdAt');
  if (result.status !== 'completed') throw contractError('only completed results can be validated');
  if (!['exploratory', 'validated'].includes(result.validationStatus)) {
    throw contractError('validationStatus must be exploratory or validated');
  }
  if (result.validationStatus === 'validated' && manifest.eligibility !== 'validation_eligible') {
    throw contractError('exploratory dataset cannot produce a validated result');
  }
  const asOf = dateString(result.asOf, 'asOf');
  if (asOf > manifest.asOf) throw contractError('result asOf exceeds dataset asOf');

  const dataManifest = object(result.dataManifest, 'dataManifest');
  if (dataManifest.datasetId !== manifest.datasetId) throw contractError('result datasetId does not match manifest');
  if (sha256(dataManifest.sha256, 'dataManifest.sha256') !== manifest.manifestSha256.toLowerCase()) {
    throw contractError('result manifest SHA256 does not match the dataset manifest hash');
  }

  const runtime = object(result.runtime, 'runtime');
  nonEmptyString(runtime.python, 'runtime.python');
  nonEmptyString(runtime.qlib, 'runtime.qlib');
  nonEmptyString(runtime.lightgbm, 'runtime.lightgbm');
  const parameters = object(result.parameters, 'parameters');
  const labelHorizon = nonNegativeInteger(parameters.labelHorizon, 'parameters.labelHorizon');
  if (labelHorizon < 1) throw contractError('parameters.labelHorizon must be positive');

  if (!Array.isArray(result.folds) || !result.folds.length) throw contractError('folds must not be empty');
  let previousTestEnd = '';
  result.folds.forEach((fold, index) => {
    const value = object(fold, 'folds[' + index + ']');
    const train = validateSegment(value.train, 'folds[' + index + '].train');
    const validation = validateSegment(value.validation, 'folds[' + index + '].validation');
    const test = validateSegment(value.test, 'folds[' + index + '].test');
    const purgeDays = nonNegativeInteger(value.purgeDays, 'folds[' + index + '].purgeDays');
    if (!(train.start <= train.end && train.end < validation.start && validation.start <= validation.end && validation.end < test.start && test.start <= test.end)) {
      throw contractError('fold time ranges overlap or are out of order');
    }
    if (purgeDays < labelHorizon) throw contractError('fold purgeDays is smaller than label horizon');
    if (previousTestEnd && test.start <= previousTestEnd) {
      throw contractError('fold test ranges overlap');
    }
    previousTestEnd = test.end;
  });

  const metrics = object(result.metrics, 'metrics');
  REQUIRED_METRICS.forEach(name => finiteNumber(metrics[name], 'metrics.' + name));
  if (!Array.isArray(result.candidates)) throw contractError('candidates must be an array');
  result.candidates.forEach((candidate, index) => {
    object(candidate, 'candidates[' + index + ']');
    if (!/^\d{6}$/.test(nonEmptyString(candidate.code, 'candidates[' + index + '].code'))) {
      throw contractError('candidate code must contain six digits');
    }
    finiteNumber(candidate.score, 'candidates[' + index + '].score');
  });
  if (!Array.isArray(result.artifacts) || !result.artifacts.length) {
    throw contractError('artifacts must contain at least one output file');
  }
  result.artifacts.forEach((artifact, index) => {
    object(artifact, 'artifacts[' + index + ']');
    nonEmptyString(artifact.path, 'artifacts[' + index + '].path');
    sha256(artifact.sha256, 'artifacts[' + index + '].sha256');
    nonNegativeInteger(artifact.rows, 'artifacts[' + index + '].rows');
  });
  stringArray(result.warnings, 'warnings', true);
  return result;
}

function validateFactorLabResult(input, datasetInput) {
  const result = object(input, 'factor lab result');
  const manifest = validateDatasetManifest(datasetInput);
  if (result.schema !== FACTOR_LAB_SCHEMA) throw contractError('unsupported factor lab schema');
  nonEmptyString(result.runId, 'runId');
  if (result.createdAt != null) timestampString(result.createdAt, 'createdAt');
  if (result.status !== 'completed') throw contractError('only completed factor lab results can be validated');
  if (!['exploratory', 'validated'].includes(result.validationStatus)) {
    throw contractError('validationStatus must be exploratory or validated');
  }
  if (result.validationStatus === 'validated' && manifest.eligibility !== 'validation_eligible') {
    throw contractError('exploratory dataset cannot produce a validated factor lab result');
  }
  const asOf = dateString(result.asOf, 'asOf');
  if (asOf > manifest.asOf) throw contractError('factor result asOf exceeds dataset asOf');

  const dataManifest = object(result.dataManifest, 'dataManifest');
  if (dataManifest.datasetId !== manifest.datasetId) throw contractError('factor result datasetId does not match manifest');
  if (sha256(dataManifest.sha256, 'dataManifest.sha256') !== manifest.manifestSha256.toLowerCase()) {
    throw contractError('factor result manifest SHA256 does not match the dataset manifest hash');
  }
  nonEmptyString(object(result.runtime, 'runtime').python, 'runtime.python');
  const parameters = object(result.parameters, 'parameters');
  const labelHorizon = nonNegativeInteger(parameters.labelHorizon, 'parameters.labelHorizon');
  if (labelHorizon < 1) throw contractError('parameters.labelHorizon must be positive');

  if (!Array.isArray(result.folds) || !result.folds.length) throw contractError('folds must not be empty');
  let previousTestEnd = '';
  result.folds.forEach((fold, index) => {
    const value = object(fold, 'folds[' + index + ']');
    const train = validateSegment(value.train, 'folds[' + index + '].train');
    const validation = validateSegment(value.validation, 'folds[' + index + '].validation');
    const testSegment = validateSegment(value.test, 'folds[' + index + '].test');
    const purgeDays = nonNegativeInteger(value.purgeDays, 'folds[' + index + '].purgeDays');
    if (!(train.start <= train.end && train.end < validation.start && validation.start <= validation.end && validation.end < testSegment.start && testSegment.start <= testSegment.end)) {
      throw contractError('factor fold time ranges overlap or are out of order');
    }
    if (purgeDays < labelHorizon) throw contractError('factor fold purgeDays is smaller than label horizon');
    if (previousTestEnd && testSegment.start <= previousTestEnd) throw contractError('factor fold test ranges overlap');
    previousTestEnd = testSegment.end;
  });

  if (!Array.isArray(result.factors) || !result.factors.length) throw contractError('factors must not be empty');
  result.factors.forEach((factor, index) => {
    object(factor, 'factors[' + index + ']');
    nonEmptyString(factor.factorId, 'factors[' + index + '].factorId');
    if (!['candidate', 'watch', 'rejected'].includes(factor.admission)) {
      throw contractError('factor admission must be candidate, watch or rejected');
    }
    ['validationRankIc', 'testRankIc', 'positiveFoldRate', 'maxAbsCorrelation'].forEach(name => {
      finiteNumber(factor[name], 'factors[' + index + '].' + name);
    });
    const metrics = object(factor.metrics, 'factors[' + index + '].metrics');
    REQUIRED_METRICS.forEach(name => finiteNumber(metrics[name], 'factors[' + index + '].metrics.' + name));
    if (!Array.isArray(factor.folds) || factor.folds.length !== result.folds.length) {
      throw contractError('factor fold evidence must match the result folds');
    }
  });
  const composite = object(result.composite, 'composite');
  const compositeMetrics = object(composite.metrics, 'composite.metrics');
  REQUIRED_METRICS.forEach(name => finiteNumber(compositeMetrics[name], 'composite.metrics.' + name));
  if (!Array.isArray(composite.candidates)) throw contractError('composite.candidates must be an array');
  composite.candidates.forEach((candidate, index) => {
    if (!/^\d{6}$/.test(nonEmptyString(object(candidate, 'composite.candidates[' + index + ']').code, 'candidate.code'))) {
      throw contractError('factor candidate code must contain six digits');
    }
    finiteNumber(candidate.score, 'factor candidate score');
  });
  if (!Array.isArray(result.artifacts) || !result.artifacts.length) throw contractError('factor artifacts must not be empty');
  result.artifacts.forEach((artifact, index) => {
    object(artifact, 'artifacts[' + index + ']');
    nonEmptyString(artifact.path, 'artifacts[' + index + '].path');
    sha256(artifact.sha256, 'artifacts[' + index + '].sha256');
    nonNegativeInteger(artifact.rows, 'artifacts[' + index + '].rows');
  });
  stringArray(result.warnings, 'warnings', true);
  return result;
}

function validateStrategyMetrics(input, label, includeValidationMean = false) {
  const metrics = object(input, label);
  const required = [
    'foldCount', 'meanOosReturn', 'medianOosReturn', 'worstOosReturn',
    'positiveFoldRate', 'maxDrawdown', 'tradeCount', 'winRate'
  ];
  required.forEach(name => finiteNumber(metrics[name], label + '.' + name));
  if (includeValidationMean) finiteNumber(metrics.validationMeanReturn, label + '.validationMeanReturn');
  return metrics;
}

function validateExecutionMetrics(input, label) {
  const metrics = object(input, label);
  [
    'netReturn', 'maxDrawdown', 'tradeCount', 'winRate', 'buyCount', 'sellCount',
    'blockedBuys', 'blockedSells', 'unclosedPositions'
  ].forEach(name => finiteNumber(metrics[name], label + '.' + name));
  return metrics;
}

function validateStrategyLabResult(input, datasetInput) {
  const result = object(input, 'strategy lab result');
  const manifest = validateDatasetManifest(datasetInput);
  if (result.schema !== STRATEGY_LAB_SCHEMA) throw contractError('unsupported strategy lab schema');
  nonEmptyString(result.runId, 'runId');
  timestampString(result.createdAt, 'createdAt');
  if (result.status !== 'completed') throw contractError('only completed strategy lab results can be validated');
  if (result.validationStatus !== 'exploratory') {
    throw contractError('strategy lab is exploratory research only');
  }
  if (result.automaticTrading !== false) {
    throw contractError('strategy lab must keep automatic trading disabled');
  }
  const asOf = dateString(result.asOf, 'asOf');
  if (asOf > manifest.asOf) throw contractError('strategy result asOf exceeds dataset asOf');

  const dataManifest = object(result.dataManifest, 'dataManifest');
  if (dataManifest.datasetId !== manifest.datasetId) throw contractError('strategy result datasetId does not match manifest');
  if (sha256(dataManifest.sha256, 'dataManifest.sha256') !== manifest.manifestSha256.toLowerCase()) {
    throw contractError('strategy result manifest SHA256 does not match the dataset manifest hash');
  }
  nonEmptyString(object(result.runtime, 'runtime').python, 'runtime.python');

  const ruleCard = object(result.ruleCard, 'ruleCard');
  const strategyFamily = nonEmptyString(ruleCard.strategyFamily, 'ruleCard.strategyFamily');
  if (![
    'moving-average-crossover', 'macd-crossover', 'rsi-rebound', 'volume-breakout',
    'low-position-volume-stagnation'
  ].includes(strategyFamily)) {
    throw contractError('unsupported strategy family');
  }
  nonEmptyString(ruleCard.entryRule, 'ruleCard.entryRule');
  nonEmptyString(ruleCard.exitRule, 'ruleCard.exitRule');
  if (strategyFamily === 'moving-average-crossover') {
    const shortWindows = ruleCard.shortWindows;
    const longWindows = ruleCard.longWindows;
    if (!Array.isArray(shortWindows) || !shortWindows.length || !Array.isArray(longWindows) || !longWindows.length) {
      throw contractError('rule card moving-average windows must not be empty');
    }
    shortWindows.concat(longWindows).forEach(value => {
      if (!Number.isInteger(Number(value)) || Number(value) < 1) throw contractError('moving-average windows must be positive integers');
    });
  }

  const execution = object(result.executionAssumptions, 'executionAssumptions');
  [
    'commissionBps', 'minimumCommission', 'stampDutyBps', 'slippageBps',
    'capitalPerSymbol', 'boardLot', 'priceLimitRate'
  ].forEach(name => finiteNumber(execution[name], 'executionAssumptions.' + name));
  if (execution.tPlusOne !== true) throw contractError('strategy lab must model T+1');
  if (execution.signalTiming !== 'close-signal-next-open-execution') {
    throw contractError('strategy lab must execute close signals no earlier than the next open');
  }
  nonEmptyString(execution.suspensionPolicy, 'executionAssumptions.suspensionPolicy');

  const windowParameters = object(result.windowParameters, 'windowParameters');
  ['trainDays', 'validationDays', 'testDays', 'stepDays', 'maxFolds', 'minimumHistoryDays'].forEach(name => {
    const value = nonNegativeInteger(windowParameters[name], 'windowParameters.' + name);
    if (value < 1) throw contractError('strategy window parameters must be positive');
  });
  if (Number(windowParameters.maxFolds) < 3) throw contractError('strategy lab requires at least three configured folds');
  if (windowParameters.maxInstruments != null) {
    const maxInstruments = nonNegativeInteger(windowParameters.maxInstruments, 'windowParameters.maxInstruments');
    if (maxInstruments < 1 || maxInstruments > 1200) throw contractError('strategy lab instrument cap is invalid');
  }

  const universe = object(result.universe, 'universe');
  if (universe.policy !== 'main-board-a-share-ex-st') throw contractError('strategy lab universe must be main-board A-share ex-ST');
  const requested = nonNegativeInteger(universe.requested, 'universe.requested');
  const included = nonNegativeInteger(universe.included, 'universe.included');
  const excludedByBoard = nonNegativeInteger(universe.excludedByBoard, 'universe.excludedByBoard');
  const excludedSt = nonNegativeInteger(universe.excludedSt, 'universe.excludedSt');
  const excludedHistory = nonNegativeInteger(universe.excludedInsufficientHistory, 'universe.excludedInsufficientHistory');
  const excludedLiquidity = universe.excludedByLiquidityCap == null
    ? 0
    : nonNegativeInteger(universe.excludedByLiquidityCap, 'universe.excludedByLiquidityCap');
  if (included + excludedByBoard + excludedSt + excludedHistory + excludedLiquidity !== requested) {
    throw contractError('strategy universe coverage counts are inconsistent');
  }

  if (!Array.isArray(result.folds) || result.folds.length < 3) {
    throw contractError('strategy lab requires at least three sample-out folds');
  }
  let previousTestEnd = '';
  result.folds.forEach((fold, index) => {
    const value = object(fold, 'folds[' + index + ']');
    const train = validateSegment(value.train, 'folds[' + index + '].train');
    const validation = validateSegment(value.validation, 'folds[' + index + '].validation');
    const testSegment = validateSegment(value.test, 'folds[' + index + '].test');
    const purgeDays = nonNegativeInteger(value.purgeDays, 'folds[' + index + '].purgeDays');
    if (!(train.start <= train.end && train.end < validation.start && validation.start <= validation.end && validation.end < testSegment.start && testSegment.start <= testSegment.end)) {
      throw contractError('strategy fold time ranges overlap or are out of order');
    }
    if (purgeDays < 1) throw contractError('strategy fold requires a purge day');
    if (previousTestEnd && testSegment.start <= previousTestEnd) throw contractError('strategy fold test ranges overlap');
    previousTestEnd = testSegment.end;
  });

  if (!Array.isArray(result.parameters) || !result.parameters.length) {
    throw contractError('strategy parameters must not be empty');
  }
  const parameterIds = new Set();
  result.parameters.forEach((parameter, index) => {
    const value = object(parameter, 'parameters[' + index + ']');
    const id = nonEmptyString(value.parameterId, 'parameters[' + index + '].parameterId');
    if (parameterIds.has(id)) throw contractError('strategy parameter IDs must be unique');
    parameterIds.add(id);
    if (strategyFamily === 'moving-average-crossover') {
      const shortWindow = nonNegativeInteger(value.shortWindow, 'parameters[' + index + '].shortWindow');
      const longWindow = nonNegativeInteger(value.longWindow, 'parameters[' + index + '].longWindow');
      if (shortWindow < 1 || shortWindow >= longWindow) throw contractError('strategy moving-average pair is invalid');
      if (value.settings != null) {
        const settings = object(value.settings, 'parameters[' + index + '].settings');
        if (Number(settings.shortWindow) !== shortWindow || Number(settings.longWindow) !== longWindow) {
          throw contractError('strategy moving-average settings do not match legacy fields');
        }
      }
    } else {
      nonEmptyString(value.label, 'parameters[' + index + '].label');
      const settings = object(value.settings, 'parameters[' + index + '].settings');
      const positive = function(name) {
        const number = finiteNumber(settings[name], 'parameters[' + index + '].settings.' + name);
        if (number <= 0) throw contractError('strategy parameter settings must be positive');
        return number;
      };
      if (strategyFamily === 'macd-crossover') {
        const fast = positive('fastWindow');
        const slow = positive('slowWindow');
        const signal = positive('signalWindow');
        if (![fast, slow, signal].every(Number.isInteger) || fast >= slow) throw contractError('MACD parameter settings are invalid');
      } else if (strategyFamily === 'rsi-rebound') {
        const period = positive('rsiPeriod');
        const entry = positive('entryThreshold');
        const exit = positive('exitThreshold');
        if (![period, entry, exit].every(Number.isInteger) || entry >= exit || exit > 100) throw contractError('RSI parameter settings are invalid');
      } else if (strategyFamily === 'volume-breakout') {
        const window = positive('breakoutWindow');
        const multiplier = positive('volumeMultiplier');
        const margin = settings.breakoutMargin == null ? 0.005 : positive('breakoutMargin');
        const minClose = settings.minCloseLocation == null ? 0.7 : positive('minCloseLocation');
        if (!Number.isInteger(window) || multiplier < 1 || margin > 1 || minClose > 1) {
          throw contractError('volume-breakout parameter settings are invalid');
        }
      } else {
        const lookback = positive('positionLookbackWindow');
        const maxPosition = positive('maxRangePosition');
        const volumeWindow = positive('volumeWindow');
        const multiplier = positive('volumeMultiplier');
        const maxReturn = positive('maxAbsReturn');
        const maxRange = positive('maxIntradayRange');
        const minClose = positive('minCloseLocation');
        if (!Number.isInteger(lookback) || !Number.isInteger(volumeWindow)
            || multiplier < 1 || maxPosition > 1 || maxReturn > 1
            || maxRange > 1 || minClose > 1) {
          throw contractError('low-position-volume-stagnation parameter settings are invalid');
        }
      }
    }
    if (!['stable', 'watch', 'rejected'].includes(value.admission)) {
      throw contractError('strategy admission must be stable, watch or rejected');
    }
    stringArray(value.reasons, 'parameters[' + index + '].reasons', true);
    validateStrategyMetrics(value.metrics, 'parameters[' + index + '].metrics', true);
    if (!Array.isArray(value.folds) || value.folds.length !== result.folds.length) {
      throw contractError('strategy parameter fold evidence must match result folds');
    }
    value.folds.forEach((evidence, foldIndex) => {
      const item = object(evidence, 'parameters[' + index + '].folds[' + foldIndex + ']');
      validateExecutionMetrics(item.validation, 'parameter validation metrics');
      validateExecutionMetrics(item.test, 'parameter test metrics');
    });
  });
  if (ruleCard.parameterCount != null && nonNegativeInteger(ruleCard.parameterCount, 'ruleCard.parameterCount') !== result.parameters.length) {
    throw contractError('rule card parameter count does not match result parameters');
  }

  stringArray(result.stableParameterIds, 'stableParameterIds', true).forEach(id => {
    if (!parameterIds.has(id)) throw contractError('stable parameter ID is not present in parameters');
  });
  const bestId = nonEmptyString(object(result.bestParameter, 'bestParameter').parameterId, 'bestParameter.parameterId');
  const worstId = nonEmptyString(object(result.worstParameter, 'worstParameter').parameterId, 'worstParameter.parameterId');
  if (!parameterIds.has(bestId) || !parameterIds.has(worstId)) throw contractError('best or worst strategy parameter is not traceable');
  validateStrategyMetrics(result.selectedWalkForward, 'selectedWalkForward');

  if (result.currentSignals != null) {
    const current = object(result.currentSignals, 'currentSignals');
    if (dateString(current.asOf, 'currentSignals.asOf') !== asOf) throw contractError('current signal cutoff must match strategy asOf');
    if (current.earliestObservation !== 'next-executable-open') throw contractError('current signals must remain next-open observations');
    if (current.admissionPolicy !== 'stable-or-watch-only') throw contractError('current signal admission policy is invalid');
    const scannedUniverse = nonNegativeInteger(current.universeScanned, 'currentSignals.universeScanned');
    if (scannedUniverse < included || scannedUniverse > requested) throw contractError('current signal universe coverage is invalid');
    const eligibleParameters = nonNegativeInteger(current.eligibleParameterCount, 'currentSignals.eligibleParameterCount');
    const scannedParameters = nonNegativeInteger(current.scannedParameterCount, 'currentSignals.scannedParameterCount');
    if (eligibleParameters > result.parameters.length || scannedParameters > eligibleParameters || scannedParameters > 12) {
      throw contractError('current signal parameter coverage is invalid');
    }
    if (current.parameterScanTruncated !== (eligibleParameters > scannedParameters)) {
      throw contractError('current signal parameter truncation is inconsistent');
    }
    const candidateCount = nonNegativeInteger(current.candidateCount, 'currentSignals.candidateCount');
    const storedCount = nonNegativeInteger(current.storedCount, 'currentSignals.storedCount');
    if (!Array.isArray(current.candidates) || current.candidates.length !== storedCount || storedCount > candidateCount || storedCount > 200) {
      throw contractError('current signal candidate coverage is invalid');
    }
    if (current.truncated !== (candidateCount > storedCount)) throw contractError('current signal candidate truncation is inconsistent');
    const parametersById = new Map(result.parameters.map(parameter => [parameter.parameterId, parameter]));
    current.candidates.forEach((candidate, candidateIndex) => {
      const item = object(candidate, 'currentSignals.candidates[' + candidateIndex + ']');
      const code = nonEmptyString(item.code, 'currentSignals.candidates[' + candidateIndex + '].code');
      if (!/^\d{6}$/.test(code)) throw contractError('current signal candidate code is invalid');
      nonEmptyString(item.name, 'currentSignals.candidates[' + candidateIndex + '].name');
      if (dateString(item.signalDate, 'current signal date') !== asOf) throw contractError('current signal candidate date must match strategy asOf');
      if (item.strategyFamily !== strategyFamily) throw contractError('current signal candidate strategy family is inconsistent');
      const ids = stringArray(item.parameterIds, 'current signal parameter IDs');
      const admissions = stringArray(item.admissions, 'current signal admissions');
      if (!ids.length || !admissions.length || admissions.some(admission => !['stable', 'watch'].includes(admission))) {
        throw contractError('current signal candidate admission is invalid');
      }
      ids.forEach(id => {
        const parameter = parametersById.get(id);
        if (!parameter || !['stable', 'watch'].includes(parameter.admission) || !admissions.includes(parameter.admission)) {
          throw contractError('current signal candidate references an eliminated or missing parameter');
        }
      });
      const expectedStatus = admissions.includes('stable') ? 'stable' : 'watch';
      if (item.candidateStatus !== expectedStatus) throw contractError('current signal candidate status is inconsistent');
      if (!Array.isArray(item.evidence) || item.evidence.length < 1) throw contractError('current signal candidate evidence is missing');
      item.evidence.forEach((evidence, evidenceIndex) => {
        const value = object(evidence, 'current signal evidence[' + evidenceIndex + ']');
        const parameterId = nonEmptyString(value.parameterId, 'current signal evidence parameterId');
        const parameter = parametersById.get(parameterId);
        if (!parameter || value.admission !== parameter.admission || !ids.includes(parameterId)) {
          throw contractError('current signal evidence is not traceable to an admitted parameter');
        }
        nonEmptyString(value.label, 'current signal evidence label');
        finiteNumber(value.positiveFoldRate, 'current signal evidence positiveFoldRate');
        finiteNumber(value.meanOosReturn, 'current signal evidence meanOosReturn');
        finiteNumber(value.medianOosReturn, 'current signal evidence medianOosReturn');
        if (value.signalEvidence != null) {
          const signal = object(value.signalEvidence, 'current signal raw evidence');
          if (dateString(signal.signalDate, 'current signal raw evidence date') !== asOf) {
            throw contractError('current signal raw evidence date must match strategy asOf');
          }
          Object.keys(signal).filter(name => name !== 'signalDate').forEach(name => {
            finiteNumber(signal[name], 'current signal raw evidence.' + name);
          });
        }
      });
    });
  }

  if (!Array.isArray(result.artifacts) || !result.artifacts.length) throw contractError('strategy artifacts must not be empty');
  result.artifacts.forEach((artifact, index) => {
    object(artifact, 'artifacts[' + index + ']');
    nonEmptyString(artifact.path, 'artifacts[' + index + '].path');
    sha256(artifact.sha256, 'artifacts[' + index + '].sha256');
    nonNegativeInteger(artifact.rows, 'artifacts[' + index + '].rows');
  });
  stringArray(result.warnings, 'warnings', true);
  return result;
}

function validateSignalScanResult(input, datasetInput) {
  const result = object(input, 'signal scan result');
  const manifest = validateDatasetManifest(datasetInput);
  if (result.schema !== SIGNAL_SCAN_SCHEMA) throw contractError('unsupported signal scan schema');
  nonEmptyString(result.runId, 'runId');
  timestampString(result.createdAt, 'createdAt');
  if (result.status !== 'completed') throw contractError('only completed signal scans can be validated');
  if (!['exploratory', 'formal'].includes(result.validationMode)) {
    throw contractError('signal scan validationMode must be exploratory or formal');
  }
  if (result.automaticTrading !== false) throw contractError('signal scan must keep automatic trading disabled');
  const asOf = dateString(result.asOf, 'asOf');
  if (asOf > manifest.asOf) throw contractError('signal scan asOf exceeds dataset asOf');

  const dataManifest = object(result.dataManifest, 'dataManifest');
  if (dataManifest.datasetId !== manifest.datasetId) throw contractError('signal scan datasetId does not match manifest');
  if (sha256(dataManifest.sha256, 'dataManifest.sha256') !== manifest.manifestSha256.toLowerCase()) {
    throw contractError('signal scan manifest SHA256 does not match the dataset manifest hash');
  }
  nonEmptyString(object(result.runtime, 'runtime').python, 'runtime.python');

  const gate = object(result.dataGate, 'dataGate');
  if (gate.datasetEligibility !== manifest.eligibility) throw contractError('signal scan data eligibility is inconsistent');
  const expectedFormalAllowed = manifest.eligibility === 'validation_eligible';
  if (gate.formalAllowed !== expectedFormalAllowed) throw contractError('signal scan formal eligibility is inconsistent');
  if (result.validationMode === 'formal' && !expectedFormalAllowed) {
    throw contractError('formal signal scan requires validation-eligible data');
  }
  if (gate.researchUseOnly !== (!expectedFormalAllowed || result.validationMode === 'exploratory')) {
    throw contractError('signal scan research-use label is inconsistent');
  }
  if (gate.adjustmentMode !== manifest.adjustmentMode || gate.membershipMode !== manifest.universe.membershipMode) {
    throw contractError('signal scan data gate provenance is inconsistent');
  }

  const ruleCard = object(result.ruleCard, 'ruleCard');
  const strategyFamily = nonEmptyString(ruleCard.strategyFamily, 'ruleCard.strategyFamily');
  if (![
    'moving-average-crossover', 'macd-crossover', 'rsi-rebound', 'volume-breakout',
    'low-position-volume-stagnation'
  ].includes(strategyFamily)) throw contractError('unsupported signal scan strategy family');
  nonEmptyString(ruleCard.label, 'ruleCard.label');
  nonEmptyString(ruleCard.entryRule, 'ruleCard.entryRule');
  nonEmptyString(ruleCard.exitRule, 'ruleCard.exitRule');
  const parameterId = nonEmptyString(ruleCard.parameterId, 'ruleCard.parameterId');
  const settings = object(ruleCard.settings, 'ruleCard.settings');
  Object.keys(settings).forEach(name => finiteNumber(settings[name], 'ruleCard.settings.' + name));

  const universe = object(result.universe, 'universe');
  if (universe.policy !== 'main-board-a-share-ex-st') throw contractError('signal scan universe must be main-board A-share ex-ST');
  const requested = nonNegativeInteger(universe.requested, 'universe.requested');
  const included = nonNegativeInteger(universe.included, 'universe.included');
  const excludedBoard = nonNegativeInteger(universe.excludedByBoard, 'universe.excludedByBoard');
  const excludedSt = nonNegativeInteger(universe.excludedSt, 'universe.excludedSt');
  const excludedHistory = nonNegativeInteger(universe.excludedInsufficientHistory, 'universe.excludedInsufficientHistory');
  if (included + excludedBoard + excludedSt + excludedHistory !== requested) {
    throw contractError('signal scan universe coverage counts are inconsistent');
  }
  nonNegativeInteger(universe.minimumHistoryDays, 'universe.minimumHistoryDays');

  const candidateCount = nonNegativeInteger(result.candidateCount, 'candidateCount');
  const storedCount = nonNegativeInteger(result.storedCount, 'storedCount');
  if (!Array.isArray(result.candidates) || result.candidates.length !== storedCount
      || storedCount > candidateCount || storedCount > 2000) {
    throw contractError('signal scan candidate coverage is invalid');
  }
  if (result.truncated !== (candidateCount > storedCount)) throw contractError('signal scan truncation is inconsistent');
  result.candidates.forEach((candidate, index) => {
    const item = object(candidate, 'candidates[' + index + ']');
    const code = nonEmptyString(item.code, 'candidate.code');
    if (!/^\d{6}$/.test(code)) throw contractError('signal scan candidate code is invalid');
    nonEmptyString(item.name, 'candidate.name');
    if (dateString(item.signalDate, 'candidate.signalDate') !== asOf) throw contractError('signal date must match scan asOf');
    if (item.strategyFamily !== strategyFamily || item.parameterId !== parameterId) {
      throw contractError('signal candidate rule identity is inconsistent');
    }
    const strength = finiteNumber(item.matchStrength, 'candidate.matchStrength');
    if (strength < 0 || strength > 100) throw contractError('signal match strength must be between 0 and 100');
    if (item.candidateStatus !== 'rule-match-unconfirmed') throw contractError('signal candidate must remain unconfirmed');
    const raw = object(item.rawEvidence, 'candidate.rawEvidence');
    if (dateString(raw.signalDate, 'candidate.rawEvidence.signalDate') !== asOf) {
      throw contractError('raw signal evidence date must match scan asOf');
    }
    Object.keys(raw).filter(name => name !== 'signalDate').forEach(name => {
      finiteNumber(raw[name], 'candidate.rawEvidence.' + name);
    });
    const thresholds = object(item.thresholds, 'candidate.thresholds');
    Object.keys(thresholds).forEach(name => finiteNumber(thresholds[name], 'candidate.thresholds.' + name));
    stringArray(item.whyMatched, 'candidate.whyMatched');
    nonEmptyString(item.confirmationRule, 'candidate.confirmationRule');
    nonEmptyString(item.invalidationRule, 'candidate.invalidationRule');
    nonEmptyString(item.earliestActionTiming, 'candidate.earliestActionTiming');
  });

  if (!Array.isArray(result.artifacts) || !result.artifacts.length) throw contractError('signal scan artifacts must not be empty');
  result.artifacts.forEach((artifact, index) => {
    object(artifact, 'artifacts[' + index + ']');
    nonEmptyString(artifact.path, 'artifacts[' + index + '].path');
    sha256(artifact.sha256, 'artifacts[' + index + '].sha256');
    nonNegativeInteger(artifact.rows, 'artifacts[' + index + '].rows');
  });
  stringArray(result.warnings, 'warnings', true);
  return result;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function canonicalJson(value, path = '') {
  if (Array.isArray(value)) return '[' + value.map(item => canonicalJson(item, path + '[]')).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' +
      canonicalJson(value[key], path ? path + '.' + key : key)).join(',') + '}';
  }
  // Python's collector serializes this schema field as a float, including 0.0 and 1.0.
  if (path === 'quality.coverageRate' && typeof value === 'number' && Number.isInteger(value)) return value.toFixed(1);
  return JSON.stringify(value);
}

function manifestSha256(manifest) {
  const payload = Object.assign({}, manifest);
  delete payload.manifestSha256;
  return crypto.createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
}

module.exports = {
  DATASET_SCHEMA,
  RESULT_SCHEMA,
  FACTOR_LAB_SCHEMA,
  STRATEGY_LAB_SCHEMA,
  validateDatasetManifest,
  validateQuantResult,
  validateFactorLabResult,
  validateStrategyLabResult,
  validateSignalScanResult,
  sha256File,
  manifestSha256
};
