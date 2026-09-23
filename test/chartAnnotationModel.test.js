const test = require('node:test');
const assert = require('node:assert/strict');

const { buildChartAnnotations } = require('../services/chartAnalysisService');

function bar(index, overrides = {}) {
  const close = 10 + index * 0.05;
  return Object.assign({
    date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
    open: close - 0.03,
    high: close + 0.18,
    low: close - 0.18,
    close,
    volume: 1000 + index * 10
  }, overrides);
}

test('chart annotations expose current pivot support and resistance from prior data', () => {
  const bars = Array.from({ length: 30 }, (_, index) => bar(index));
  const previous = bars[bars.length - 2];
  previous.high = 12;
  previous.low = 10;
  previous.close = 11;
  bars[bars.length - 1].close = 11;

  const result = buildChartAnnotations(bars, 'day');

  assert.equal(result.rulesVersion, 'webstock-chart-annotations/1.0.0');
  assert.equal(result.currentLevels.resistance.price, 12);
  assert.equal(result.currentLevels.resistance.label, 'R1 压力');
  assert.equal(result.currentLevels.support.price, 10);
  assert.equal(result.currentLevels.support.label, 'S1 支撑');
  assert.equal(result.currentLevels.resistance.triggerUsesFutureData, false);
});

test('historical chart event triggers never change when only future bars change', () => {
  const shared = Array.from({ length: 25 }, (_, index) => bar(index));
  const priorHigh = Math.max(...shared.slice(4, 24).map(item => item.high));
  shared[24] = bar(24, {
    open: priorHigh - 0.1,
    high: priorHigh + 0.8,
    low: priorHigh - 0.2,
    close: priorHigh + 0.5,
    volume: 5000
  });
  const positiveFuture = shared.concat(Array.from({ length: 5 }, (_, index) => bar(25 + index, {
    close: shared[24].close + index + 1,
    high: shared[24].close + index + 1.2,
    low: shared[24].close + index + 0.8
  })));
  const negativeFuture = shared.concat(Array.from({ length: 5 }, (_, index) => bar(25 + index, {
    close: shared[24].close - index - 1,
    high: shared[24].close - index - 0.8,
    low: shared[24].close - index - 1.2
  })));

  const positive = buildChartAnnotations(positiveFuture, 'day').events
    .find(item => item.date === shared[24].date);
  const negative = buildChartAnnotations(negativeFuture, 'day').events
    .find(item => item.date === shared[24].date);

  assert.equal(positive.type, 'breakout-up');
  assert.equal(negative.type, 'breakout-up');
  assert.deepEqual(positive.triggerEvidence, negative.triggerEvidence);
  assert.equal(positive.triggerUsesFutureData, false);
  assert.equal(positive.validationUsesFutureData, true);
  assert.notEqual(positive.validation.forwardClosePct, negative.validation.forwardClosePct);
});

test('historical annotations keep only meaningful events and disclose pending validation', () => {
  const bars = Array.from({ length: 24 }, (_, index) => bar(index));
  const priorLow = Math.min(...bars.slice(3, 23).map(item => item.low));
  bars[23] = bar(23, {
    open: priorLow + 0.1,
    high: priorLow + 0.2,
    low: priorLow - 0.7,
    close: priorLow - 0.5,
    volume: 4500
  });

  const event = buildChartAnnotations(bars, 'day').events.at(-1);

  assert.equal(event.type, 'breakout-down');
  assert.equal(event.marker, '破');
  assert.equal(event.validation.status, 'pending');
  assert.match(event.limitations.join(' '), /回看/);
});

test('key levels grade repeated historical support and resistance with traceable touch evidence', () => {
  const bars = Array.from({ length: 60 }, (_, index) => bar(index, {
    open: 11.2,
    high: 11.8,
    low: 10.4,
    close: 11.2,
    volume: 1000
  }));
  [10, 25, 40].forEach(function(index) {
    bars[index] = bar(index, { open: 10.35, high: 10.9, low: 10, close: 10.75, volume: 1800 });
  });
  [15, 30, 45].forEach(function(index) {
    bars[index] = bar(index, { open: 12.65, high: 13, low: 12.1, close: 12.25, volume: 1700 });
  });
  bars[59] = bar(59, { open: 11.3, high: 11.7, low: 11.1, close: 11.4, volume: 1200 });

  const result = buildChartAnnotations(bars, 'day');

  assert.equal(result.keyLevels.rulesVersion, 'webstock-key-levels/1.0.0');
  assert.equal(result.keyLevels.support.type, 'support');
  assert.equal(result.keyLevels.support.price, 10);
  assert.equal(result.keyLevels.support.touchCount, 3);
  assert.equal(result.keyLevels.support.strengthKey, 'strong');
  assert.equal(result.keyLevels.resistance.type, 'resistance');
  assert.equal(result.keyLevels.resistance.price, 13);
  assert.equal(result.keyLevels.resistance.touchCount, 3);
  assert.equal(result.keyLevels.resistance.strengthKey, 'strong');
  assert.equal(result.keyLevels.calculationUsesFutureData, false);
  assert.match(result.keyLevels.method.strengthRule, /至少3次触碰/);
  assert.match(result.keyLevels.method.toleranceRule, /ATR14/);
  assert.ok(result.keyLevels.tolerance > 0);
  assert.ok(result.keyLevels.support.touchDates.includes(bars[25].date));
  assert.match(result.keyLevels.support.basis, /局部低点聚类/);
  assert.ok(result.keyLevels.limitations.some(item => /预测/.test(item)));
});

test('key level grading does not turn a single pivot into strong support', () => {
  const bars = Array.from({ length: 35 }, (_, index) => bar(index, {
    open: 11,
    high: 11.8,
    low: 10.5,
    close: 11.1,
    volume: 1000
  }));
  bars[12] = bar(12, { open: 10.4, high: 10.9, low: 9.8, close: 10.7, volume: 900 });
  bars[34] = bar(34, { open: 11.1, high: 11.5, low: 10.9, close: 11.2, volume: 1000 });

  const support = buildChartAnnotations(bars, 'day').keyLevels.support;

  assert.equal(support.touchCount, 1);
  assert.equal(support.strengthKey, 'weak');
  assert.equal(support.volumeConfirmedTouches, 0);
});
