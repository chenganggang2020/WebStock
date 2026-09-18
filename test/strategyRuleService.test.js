const test = require('node:test');
const assert = require('node:assert/strict');

const { parseStrategyRule } = require('../services/strategyRuleService');

test('controlled Chinese rule parser produces an auditable moving-average card', () => {
  const rule = parseStrategyRule('5日均线上穿20日均线买入，下穿后卖出');

  assert.equal(rule.schema, 'webstock.quant.strategy-rule.v2');
  assert.equal(rule.strategyFamily, 'moving-average-crossover');
  assert.deepEqual(rule.parameters.shortWindows, [5]);
  assert.deepEqual(rule.parameters.longWindows, [20]);
  assert.equal(rule.parameterCombinationCount, 1);
  assert.equal(rule.automaticTrading, false);
  assert.deepEqual(rule.defaultedFields, []);
});

test('controlled Chinese rule parser recognises explicit MACD periods', () => {
  const rule = parseStrategyRule('MACD 12,26,9 金叉买入，死叉卖出');

  assert.equal(rule.strategyFamily, 'macd-crossover');
  assert.deepEqual(rule.parameters.fastWindows, [12]);
  assert.deepEqual(rule.parameters.slowWindows, [26]);
  assert.deepEqual(rule.parameters.signalWindows, [9]);
  assert.equal(rule.parameterCombinationCount, 1);
});

test('controlled Chinese rule parser recognises RSI rebound thresholds', () => {
  const rule = parseStrategyRule('RSI14 从30超卖区向上反弹买入，到70卖出');

  assert.equal(rule.strategyFamily, 'rsi-rebound');
  assert.deepEqual(rule.parameters.rsiPeriods, [14]);
  assert.deepEqual(rule.parameters.entryThresholds, [30]);
  assert.deepEqual(rule.parameters.exitThresholds, [70]);
  assert.equal(rule.parameterCombinationCount, 1);
});

test('controlled Chinese rule parser recognises volume breakout rules', () => {
  const rule = parseStrategyRule('突破20日新高且成交量达到过去20日均量1.5倍，跌破20日均线卖出');

  assert.equal(rule.strategyFamily, 'volume-breakout');
  assert.deepEqual(rule.parameters.breakoutWindows, [20]);
  assert.deepEqual(rule.parameters.volumeMultipliers, [1.5]);
  assert.deepEqual(rule.parameters.breakoutMargins, [0.005]);
  assert.deepEqual(rule.parameters.breakoutMinCloseLocations, [0.7]);
  assert.equal(rule.parameterCombinationCount, 1);
});

test('controlled Chinese rule parser recognises low-position high-volume stagnation', () => {
  const rule = parseStrategyRule('筛选120日低位，成交量达到20日均量1.8倍，涨跌幅不超过2%，振幅不超过6%的股票');

  assert.equal(rule.schema, 'webstock.quant.strategy-rule.v2');
  assert.equal(rule.strategyFamily, 'low-position-volume-stagnation');
  assert.deepEqual(rule.parameters.positionLookbackWindows, [120]);
  assert.deepEqual(rule.parameters.maxRangePositions, [0.35]);
  assert.deepEqual(rule.parameters.volumeWindows, [20]);
  assert.deepEqual(rule.parameters.volumeMultipliers, [1.8]);
  assert.deepEqual(rule.parameters.maxAbsReturns, [0.02]);
  assert.deepEqual(rule.parameters.maxIntradayRanges, [0.06]);
  assert.deepEqual(rule.parameters.minCloseLocations, [0.5]);
  assert.equal(rule.detectionTiming, 'daily-close');
  assert.equal(rule.earliestActionTiming, 'next-executable-open');
  assert.match(rule.confirmationRule, /3个交易日/);
  assert.match(rule.invalidationRule, /信号日最低价/);
  assert.equal(rule.automaticTrading, false);
});

test('controlled Chinese rule parser refuses unsupported or code-like instructions', () => {
  assert.throws(() => parseStrategyRule('请生成Python代码并自动下单'), /无法识别|不支持|策略/);
  assert.throws(() => parseStrategyRule('网格交易策略'), /无法识别|不支持|策略/);
});
