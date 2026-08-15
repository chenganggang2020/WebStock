const test = require('node:test');
const assert = require('node:assert/strict');

const { analyzeChart } = require('../services/chartAnalysisService');

function buildBars(count, options = {}) {
  const start = Date.parse(options.start || '2026-01-01T00:00:00Z');
  const step = options.step == null ? 0.5 : Number(options.step);
  const base = options.base == null ? 10 : Number(options.base);
  return Array.from({ length: count }, function(_, index) {
    const close = +(base + step * index).toFixed(2);
    const volumeBoost = index >= count - 5 ? Number(options.lastFiveVolumeMultiplier || 1) : 1;
    return {
      date: new Date(start + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      open: +(close - step * 0.35).toFixed(2),
      high: +(close + 0.4).toFixed(2),
      low: +(close - 0.45).toFixed(2),
      close,
      volume: Math.round((100000 + index * 1000) * volumeBoost)
    };
  });
}

test('chart analysis returns deterministic teaching observations tied to the requested period and cutoff', () => {
  const input = {
    code: '000001',
    period: 'day',
    asOf: '2026-02-09T23:59:59.000Z',
    bars: buildBars(40, { lastFiveVolumeMultiplier: 2 })
  };

  const result = analyzeChart(input);
  const repeated = analyzeChart(input);

  assert.deepEqual(repeated, result);
  assert.equal(result.schema, 'webstock.chart-analysis/v1');
  assert.equal(result.status, 'ok');
  assert.equal(result.code, input.code);
  assert.equal(result.period, input.period);
  assert.equal(result.asOf, input.asOf);
  assert.equal(result.rulesVersion, 'webstock-chart-rules/1.0.0');
  assert.equal(result.knowledgeScope, 'phase-one-deterministic-rule-dictionary');
  assert.equal(result.strategyValidation, 'not-backtested');
  assert.equal(result.rules.length, 7);
  assert.ok(result.observations.some(item => item.category === 'trend'));
  assert.ok(result.observations.some(item => item.category === 'price-volume'));
  assert.ok(result.observations.some(item => item.category === 'macd'));
  assert.ok(result.observations.some(item => item.category === 'rsi'));
  assert.ok(result.observations.some(item => item.category === 'kdj'));
  assert.ok(result.evidence.length >= 5);
  assert.ok(result.plainMeaning.length >= result.observations.length);
  assert.ok(result.confirmations.length > 0);
  assert.ok(result.invalidation.length > 0);
  assert.ok(result.limitations.length > 0);

  const evidenceIds = new Set(result.evidence.map(item => item.id));
  result.observations.forEach(function(observation) {
    assert.equal(typeof observation.plainMeaning, 'string');
    assert.ok(observation.plainMeaning.length > 0);
    assert.ok(observation.evidenceIds.length > 0);
    assert.ok(observation.evidenceIds.every(id => evidenceIds.has(id)));
    assert.ok(Array.isArray(observation.confirmations));
    assert.ok(Array.isArray(observation.invalidation));
    assert.ok(Array.isArray(observation.limitations));
    assert.equal(observation.rulesVersion, result.rulesVersion);
    assert.ok(result.rules.some(rule => rule.ruleId === observation.ruleId));
  });
  result.evidence.forEach(function(item) {
    assert.equal(item.period, input.period);
    assert.equal(item.asOf, input.asOf);
    assert.ok(Date.parse(item.lastBarAt) <= Date.parse(input.asOf));
  });
  ['macd_dif', 'macd_dea', 'macd_bar', 'kdj_k', 'kdj_d', 'kdj_j'].forEach(function(metric) {
    const recursiveEvidence = result.evidence.find(item => item.metric === metric);
    assert.equal(recursiveEvidence.firstBarAt, result.coverage.firstBarAt);
  });
});

test('chart analysis exposes versioned deterministic rule definitions and scoped official references', () => {
  const bars = buildBars(40);
  const result = analyzeChart({ code: '000001', period: 'day', asOf: bars.at(-1).date, bars });
  const rulesById = new Map(result.rules.map(rule => [rule.ruleId, rule]));
  const referencesById = new Map(result.knowledgeReferences.map(reference => [reference.id, reference]));

  [
    'trend.ma-stack.v1',
    'price-volume.avg5-vs20.v1',
    'momentum.macd-12-26-9.v1',
    'momentum.rsi-14.v1',
    'momentum.kdj-9-3-3.v1',
    'structure.close-breakout-20.v1',
    'structure.full-gap-adjacent.v1'
  ].forEach(ruleId => {
    const rule = rulesById.get(ruleId);
    assert.ok(rule, ruleId);
    assert.equal(rule.rulesVersion, result.rulesVersion);
    assert.ok(rule.trigger.length > 0);
    assert.ok(rule.assumptions.length > 0);
    assert.ok(rule.limitations.length > 0);
    assert.equal(rule.predictiveClaim, false);
  });

  [
    ['talib-stoch', 'https://ta-lib.org/functions/stoch.html'],
    ['talib-macd', 'https://ta-lib.org/functions/macd.html'],
    ['talib-atr', 'https://ta-lib.org/functions/atr.html'],
    ['talib-obv', 'https://ta-lib.org/functions/obv.html'],
    ['lightweight-charts-realtime-update', 'https://tradingview.github.io/lightweight-charts/docs/5.0#updating-the-data-in-a-series']
  ].forEach(([id, url]) => {
    assert.equal(referencesById.get(id).url, url);
  });
  assert.equal(referencesById.get('talib-atr').implementedInChartAnalysis, true);
  assert.equal(referencesById.get('talib-atr').usage, 'key-level-tolerance-reference');
  assert.equal(referencesById.get('talib-obv').implementedInChartAnalysis, false);
  assert.equal(referencesById.get('lightweight-charts-realtime-update').usage, 'implementation-reference-only');
  assert.match(referencesById.get('talib-stoch').notes, /不等同|not equivalent/i);
  assert.match(referencesById.get('talib-macd').notes, /2倍|twice/i);
});

test('chart analysis excludes bars after asOf so future values cannot affect evidence', () => {
  const eligible = buildBars(30);
  const future = {
    date: '2026-01-31', open: 1000, high: 1200, low: 900, close: 1100, volume: 999999999
  };
  const result = analyzeChart({
    code: '600000',
    period: 'day',
    asOf: '2026-01-30T23:59:59.000Z',
    bars: eligible.concat(future)
  });

  const latestClose = result.evidence.find(item => item.metric === 'latest_close');
  assert.equal(result.coverage.providedBars, 31);
  assert.equal(result.coverage.eligibleBars, 30);
  assert.equal(result.coverage.excludedFutureBars, 1);
  assert.equal(result.coverage.lastBarAt, '2026-01-30');
  assert.equal(latestClose.value, eligible[eligible.length - 1].close);
  assert.doesNotMatch(JSON.stringify(result.evidence), /1100|999999999/);
});

test('chart analysis reports insufficient data instead of manufacturing a conclusion', () => {
  const result = analyzeChart({
    code: '300750',
    period: 'week',
    asOf: '2026-01-10T23:59:59.000Z',
    bars: buildBars(10)
  });

  assert.equal(result.status, 'insufficient');
  assert.equal(result.period, 'week');
  assert.equal(result.coverage.eligibleBars, 10);
  assert.deepEqual(result.observations, []);
  assert.deepEqual(result.evidence, []);
  assert.ok(result.limitations.some(item => /20/.test(item)));
});

test('chart analysis explains available indicators and degrades missing MACD coverage explicitly', () => {
  const result = analyzeChart({
    code: '600519',
    period: 'month',
    asOf: '2026-01-25T23:59:59.000Z',
    bars: buildBars(25, { step: -0.15 })
  });

  assert.equal(result.status, 'ok');
  assert.ok(result.observations.some(item => item.category === 'trend'));
  assert.ok(result.observations.some(item => item.category === 'rsi'));
  assert.ok(result.observations.some(item => item.category === 'kdj'));
  assert.ok(!result.observations.some(item => item.category === 'macd'));
  assert.ok(result.limitations.some(item => /MACD/.test(item) && /35/.test(item)));
});

test('chart analysis degrades unavailable price-volume and KDJ inputs without NaN evidence', () => {
  const bars = buildBars(40).map(function(item) {
    return { date: item.date, close: item.close };
  });
  const result = analyzeChart({
    code: '002594',
    period: 'day',
    asOf: '2026-02-09T23:59:59.000Z',
    bars
  });

  assert.equal(result.status, 'ok');
  assert.ok(result.observations.some(item => item.category === 'trend'));
  assert.ok(result.observations.some(item => item.category === 'macd'));
  assert.ok(result.observations.some(item => item.category === 'rsi'));
  assert.ok(!result.observations.some(item => item.category === 'price-volume'));
  assert.ok(!result.observations.some(item => item.category === 'kdj'));
  assert.ok(result.limitations.some(item => /成交量/.test(item)));
  assert.ok(result.limitations.some(item => /KDJ/.test(item)));
  assert.doesNotMatch(JSON.stringify(result.evidence), /NaN|Infinity/);
});

test('chart analysis describes current evidence without buy-sell predictions', () => {
  const result = analyzeChart({
    code: '688981',
    period: 'day',
    asOf: '2026-02-09T23:59:59.000Z',
    bars: buildBars(40, { step: -0.2, lastFiveVolumeMultiplier: 1.8 })
  });
  const text = JSON.stringify(result);

  assert.doesNotMatch(text, /买入|卖出|建仓|清仓|目标价|必然上涨|必然下跌/);
  assert.ok(result.limitations.some(item => /不判断未来/.test(item)));
});

test('chart analysis reports an upward range breakout and an opening gap with traceable thresholds', () => {
  const bars = buildBars(40, { step: 0.02 });
  const previous = bars[bars.length - 2];
  const latest = bars[bars.length - 1];
  latest.open = +(previous.high + 0.5).toFixed(2);
  latest.low = +(previous.high + 0.4).toFixed(2);
  latest.close = +(previous.high + 0.7).toFixed(2);
  latest.high = +(previous.high + 0.9).toFixed(2);

  const result = analyzeChart({
    code: '000001',
    period: 'day',
    asOf: latest.date,
    bars
  });

  const breakout = result.observations.find(item => item.category === 'breakout');
  const gap = result.observations.find(item => item.category === 'gap');
  assert.equal(breakout.state, 'upward-breakout');
  assert.equal(gap.state, 'up-gap');
  assert.ok(result.evidence.some(item => item.metric === 'prior_high_20'));
  assert.ok(result.evidence.some(item => item.metric === 'breakout_distance_pct'));
  assert.ok(result.evidence.some(item => item.metric === 'previous_high'));
  assert.ok(result.evidence.some(item => item.metric === 'latest_low'));
  assert.ok(result.evidence.some(item => item.metric === 'gap_size_pct'));
  assert.doesNotMatch(JSON.stringify({ breakout, gap }), /买入|卖出|建仓|清仓|目标价|保证/);
});

test('chart analysis distinguishes a downward range break from a non-gap opening', () => {
  const bars = buildBars(40, { step: -0.01 });
  const previous = bars[bars.length - 2];
  const latest = bars[bars.length - 1];
  const priorLows = bars.slice(-21, -1).map(item => item.low);
  const priorLow = Math.min.apply(null, priorLows);
  latest.open = +(previous.close - 0.05).toFixed(2);
  latest.high = +(previous.low + 0.05).toFixed(2);
  latest.close = +(priorLow - 0.4).toFixed(2);
  latest.low = +(priorLow - 0.6).toFixed(2);

  const result = analyzeChart({
    code: '600000',
    period: 'day',
    asOf: latest.date,
    bars
  });

  assert.equal(result.observations.find(item => item.category === 'breakout').state, 'downward-breakout');
  assert.equal(result.observations.find(item => item.category === 'gap').state, 'no-full-gap');
});

test('chart analysis reports downward gap size as a positive magnitude', () => {
  const bars = buildBars(40, { step: -0.01 });
  const previous = bars[bars.length - 2];
  const latest = bars[bars.length - 1];
  latest.open = +(previous.low - 0.5).toFixed(2);
  latest.high = +(previous.low - 0.3).toFixed(2);
  latest.close = +(previous.low - 0.6).toFixed(2);
  latest.low = +(previous.low - 0.8).toFixed(2);

  const result = analyzeChart({ code: '600000', period: 'day', asOf: latest.date, bars });
  const gap = result.observations.find(item => item.category === 'gap');
  const gapSize = result.evidence.find(item => item.observationId === gap.id && item.metric === 'gap_size_pct');

  assert.equal(gap.state, 'down-gap');
  assert.ok(gapSize.value > 0);
});

test('chart analysis KDJ values match the chart indicator initialization contract', () => {
  const bars = buildBars(20);
  const result = analyzeChart({
    code: '000001',
    period: 'day',
    asOf: bars[bars.length - 1].date,
    bars
  });

  assert.equal(result.evidence.find(item => item.metric === 'kdj_k').value, 91.42);
  assert.equal(result.evidence.find(item => item.metric === 'kdj_d').value, 90.13);
  assert.equal(result.evidence.find(item => item.metric === 'kdj_j').value, 94);
});

test('chart analysis validates explicit identity, period, cutoff and bar inputs', () => {
  assert.throws(() => analyzeChart({ period: 'day', asOf: '2026-01-01', bars: [] }), /code/);
  assert.throws(() => analyzeChart({ code: '000001', asOf: '2026-01-01', bars: [] }), /period/);
  assert.throws(() => analyzeChart({ code: '000001', period: 'day', asOf: 'not-a-date', bars: [] }), /asOf/);
  assert.throws(() => analyzeChart({ code: '000001', period: 'day', asOf: '2026-01-01', bars: null }), /bars/);
});

test('decision guide raises an entry observation only when several bullish rules agree', () => {
  const bars = buildBars(40, { base: 20, step: 0.5, lastFiveVolumeMultiplier: 2 });
  const result = analyzeChart({ code: '000001', period: 'day', asOf: bars.at(-1).date, bars });

  assert.equal(result.decisionGuide.schema, 'webstock.decision-observation/v1');
  assert.equal(result.decisionGuide.label, '入场观察');
  assert.ok(result.decisionGuide.score >= 55);
  assert.ok(result.decisionGuide.positiveEvidenceCount >= 3);
  assert.ok(result.decisionGuide.evidence.some(item => item.category === 'trend' && item.direction === 'positive'));
  assert.ok(result.decisionGuide.confirmations.length > 0);
  assert.ok(result.decisionGuide.invalidation.length > 0);
  assert.equal(result.decisionGuide.strategyValidation, 'not-backtested');
  assert.equal(result.decisionGuide.notInvestmentAdvice, true);
});

test('decision guide raises an exit warning only when several bearish rules agree', () => {
  const bars = buildBars(40, { base: 100, step: -0.5, lastFiveVolumeMultiplier: 2 });
  const result = analyzeChart({ code: '600000', period: 'day', asOf: bars.at(-1).date, bars });

  assert.equal(result.decisionGuide.label, '离场警示');
  assert.ok(result.decisionGuide.score <= -55);
  assert.ok(result.decisionGuide.negativeEvidenceCount >= 3);
  assert.ok(result.decisionGuide.evidence.some(item => item.category === 'breakout' && item.direction === 'negative'));
  assert.ok(result.decisionGuide.invalidation.length > 0);
});

test('decision guide stays unavailable when the chart sample is insufficient', () => {
  const bars = buildBars(10);
  const result = analyzeChart({ code: '300750', period: 'day', asOf: bars.at(-1).date, bars });

  assert.equal(result.decisionGuide.label, '数据不足');
  assert.equal(result.decisionGuide.score, null);
  assert.deepEqual(result.decisionGuide.evidence, []);
});
