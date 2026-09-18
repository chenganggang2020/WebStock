const RULE_SCHEMA = 'webstock.quant.strategy-rule.v2';
const FORBIDDEN_TEXT = /(自动下单|实盘交易|提交委托|券商接口|python|javascript|执行代码|生成代码|\border\b|\bbroker\b)/i;

function ruleError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function integer(value, fallback, field, defaultedFields) {
  const number = Number(value);
  if (Number.isInteger(number) && number > 0) return number;
  defaultedFields.push(field);
  return fallback;
}

function decimal(value, fallback, field, defaultedFields) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number;
  defaultedFields.push(field);
  return fallback;
}

function firstMatch(text, pattern) {
  const match = text.match(pattern);
  return match ? match[1] : null;
}

function baseRule(sourceText, strategyFamily, label, parameters, defaultedFields, entryRule, exitRule, timing = {}) {
  const combinationCount = Object.values(parameters).reduce(function(total, values) {
    return total * (Array.isArray(values) ? values.length : 1);
  }, 1);
  if (combinationCount > 64) throw ruleError('单次研究最多支持64组参数。');
  return {
    schema: RULE_SCHEMA,
    sourceText,
    parser: 'local-deterministic-allowlist',
    strategyFamily,
    label,
    entryRule,
    exitRule,
    detectionTiming: timing.detectionTiming || 'daily-close',
    earliestActionTiming: timing.earliestActionTiming || 'next-executable-open',
    confirmationRule: timing.confirmationRule || '后续价格保持在信号确认位之上',
    invalidationRule: timing.invalidationRule || exitRule,
    parameters,
    parameterCombinationCount: combinationCount,
    defaultedFields,
    automaticTrading: false,
    warnings: defaultedFields.length
      ? ['未明确的参数使用了页面默认值，运行前请确认规则卡。']
      : []
  };
}

function percentage(value, fallback, field, defaultedFields) {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0 && number <= 100) return number / 100;
  defaultedFields.push(field);
  return fallback;
}

function parseMovingAverage(text) {
  const defaulted = [];
  const pair = text.match(/(\d+)\s*日?\s*(?:短期)?(?:均线|ma).*?(?:上穿|金叉|突破).*?(\d+)\s*日?\s*(?:长期)?(?:均线|ma)/i);
  const numbers = text.match(/\d+/g) || [];
  const shortWindow = integer(pair && pair[1] || numbers[0], 5, 'shortWindows', defaulted);
  const longWindow = integer(pair && pair[2] || numbers[1], 20, 'longWindows', defaulted);
  if (shortWindow >= longWindow) throw ruleError('短期均线必须小于长期均线。');
  return baseRule(text, 'moving-average-crossover', '均线交叉', {
    shortWindows: [shortWindow],
    longWindows: [longWindow]
  }, defaulted, '短期均线上穿长期均线后，下一可成交日开盘买入', '短期均线下穿长期均线后，按T+1在下一可成交日开盘卖出');
}

function parseMacd(text) {
  const defaulted = [];
  const afterMacd = text.slice(text.toUpperCase().indexOf('MACD') + 4);
  const numbers = afterMacd.match(/\d+/g) || [];
  const fast = integer(numbers[0], 12, 'fastWindows', defaulted);
  const slow = integer(numbers[1], 26, 'slowWindows', defaulted);
  const signal = integer(numbers[2], 9, 'signalWindows', defaulted);
  if (fast >= slow) throw ruleError('MACD快线周期必须小于慢线周期。');
  return baseRule(text, 'macd-crossover', 'MACD交叉', {
    fastWindows: [fast],
    slowWindows: [slow],
    signalWindows: [signal]
  }, defaulted, 'MACD线上穿信号线后，下一可成交日开盘买入', 'MACD线下穿信号线后，按T+1在下一可成交日开盘卖出');
}

function parseRsi(text) {
  const defaulted = [];
  const period = integer(firstMatch(text, /rsi\s*(\d+)/i), 14, 'rsiPeriods', defaulted);
  const entry = integer(firstMatch(text, /(?:从|低于|跌破|超卖(?:区)?(?:阈值)?\s*)(\d+)/i), 30, 'entryThresholds', defaulted);
  const exit = integer(firstMatch(text, /(?:到|达到|高于|升破|退出(?:阈值)?\s*)(\d+)/i), 70, 'exitThresholds', defaulted);
  if (entry >= exit || exit > 100) throw ruleError('RSI入场阈值必须小于退出阈值，且不超过100。');
  return baseRule(text, 'rsi-rebound', 'RSI超卖反弹', {
    rsiPeriods: [period],
    entryThresholds: [entry],
    exitThresholds: [exit]
  }, defaulted, 'RSI从超卖阈值下方向上穿越后，下一可成交日开盘买入', 'RSI达到退出阈值后，按T+1在下一可成交日开盘卖出');
}

function parseVolumeBreakout(text) {
  const defaulted = [];
  const lookback = integer(firstMatch(text, /突破\s*(\d+)\s*日(?:新高|高点)/i), 20, 'breakoutWindows', defaulted);
  const multiplier = decimal(firstMatch(text, /(\d+(?:\.\d+)?)\s*倍/i), 1.5, 'volumeMultipliers', defaulted);
  const margin = percentage(
    firstMatch(text, /(?:突破幅度|超过(?:前高|高点))[^，,。；;\n]{0,12}(\d+(?:\.\d+)?)\s*%/i),
    0.005,
    'breakoutMargins',
    defaulted
  );
  const minCloseLocation = percentage(
    firstMatch(text, /收盘位置[^，,。；;\n]{0,12}(?:不低于|至少|大于|超过)\s*(\d+(?:\.\d+)?)\s*%/i),
    0.7,
    'breakoutMinCloseLocations',
    defaulted
  );
  if (multiplier < 1) throw ruleError('放量突破倍数不能小于1。');
  return baseRule(text, 'volume-breakout', '放量突破', {
    breakoutWindows: [lookback],
    volumeMultipliers: [multiplier],
    breakoutMargins: [margin],
    breakoutMinCloseLocations: [minCloseLocation]
  }, defaulted, '收盘价突破此前N日高点且成交量达到此前N日均量倍数后，下一可成交日开盘买入', '收盘价下穿N日均线后，按T+1在下一可成交日开盘卖出');
}

function parseLowPositionVolumeStagnation(text) {
  const defaulted = [];
  const positionLookback = integer(
    firstMatch(text, /(\d+)\s*日(?:低位|价格位置|区间)/i),
    120,
    'positionLookbackWindows',
    defaulted
  );
  const maxRangePosition = percentage(
    firstMatch(text, /(?:价格位置|区间位置|低位)[^，,。；;\n]{0,12}(?:不超过|不高于|小于|以内)\s*(\d+(?:\.\d+)?)\s*%/i),
    0.35,
    'maxRangePositions',
    defaulted
  );
  const volumeWindow = integer(
    firstMatch(text, /(\d+)\s*日均量/i),
    20,
    'volumeWindows',
    defaulted
  );
  const volumeMultiplier = decimal(
    firstMatch(text, /(\d+(?:\.\d+)?)\s*倍/i),
    1.8,
    'volumeMultipliers',
    defaulted
  );
  const maxAbsReturn = percentage(
    firstMatch(text, /(?:涨跌幅|涨幅).*?(?:不超过|不高于|小于|以内)\s*(\d+(?:\.\d+)?)\s*%/i),
    0.02,
    'maxAbsReturns',
    defaulted
  );
  const maxIntradayRange = percentage(
    firstMatch(text, /振幅.*?(?:不超过|不高于|小于|以内)\s*(\d+(?:\.\d+)?)\s*%/i),
    0.06,
    'maxIntradayRanges',
    defaulted
  );
  const minCloseLocation = percentage(
    firstMatch(text, /收盘位置.*?(?:不低于|高于|至少)\s*(\d+(?:\.\d+)?)\s*%/i),
    0.5,
    'minCloseLocations',
    defaulted
  );
  if (volumeMultiplier < 1) throw ruleError('放量倍数不能小于1。');
  return baseRule(text, 'low-position-volume-stagnation', '低位放量滞涨', {
    positionLookbackWindows: [positionLookback],
    maxRangePositions: [maxRangePosition],
    volumeWindows: [volumeWindow],
    volumeMultipliers: [volumeMultiplier],
    maxAbsReturns: [maxAbsReturn],
    maxIntradayRanges: [maxIntradayRange],
    minCloseLocations: [minCloseLocation]
  }, defaulted,
  '日线收盘满足低位、放量、价格滞涨和收盘质量条件后形成研究候选，最早下一可成交日观察',
  '收盘跌破信号日最低价或放量继续下跌时失效', {
    confirmationRule: '未来3个交易日内收盘突破信号日最高价，且未先跌破信号日最低价',
    invalidationRule: '收盘跌破信号日最低价或放量继续下跌'
  });
}

function parseStrategyRule(input) {
  const text = String(input || '').trim();
  if (!text) throw ruleError('请输入需要解析的策略描述。');
  if (text.length > 1000) throw ruleError('策略描述不能超过1000个字符。');
  if (FORBIDDEN_TEXT.test(text)) throw ruleError('策略描述包含不支持的代码或交易执行要求。');
  if (/macd/i.test(text)) return parseMacd(text);
  if (/rsi/i.test(text)) return parseRsi(text);
  if (/低位/.test(text) && /(成交量|放量|均量)/.test(text) && /(滞涨|涨跌幅|涨幅)/.test(text)) {
    return parseLowPositionVolumeStagnation(text);
  }
  if (/(成交量|放量)/.test(text) && /(突破|新高)/.test(text)) return parseVolumeBreakout(text);
  if (/(均线|\bma\b)/i.test(text) && /(上穿|金叉|突破)/.test(text)) return parseMovingAverage(text);
  throw ruleError('无法识别受支持的策略。当前仅支持均线、MACD、RSI、放量突破和低位放量滞涨。');
}

module.exports = { RULE_SCHEMA, parseStrategyRule };
