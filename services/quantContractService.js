const crypto = require('node:crypto');
const fs = require('node:fs');

const DATASET_SCHEMA = 'webstock.quant.dataset.v1';
const RESULT_SCHEMA = 'webstock.quant.result.v1';
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

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  }
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
  validateDatasetManifest,
  validateQuantResult,
  sha256File,
  manifestSha256
};
