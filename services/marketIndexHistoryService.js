const marketData = require('./marketDataService');

const INDEX_HISTORY_DEFINITIONS = [
  { key: 'sse', code: '000001', name: '上证指数', sinaSymbol: 'sh000001', eastmoneySecid: '1.000001' },
  { key: 'szse', code: '399001', name: '深证成指', sinaSymbol: 'sz399001', eastmoneySecid: '0.399001' },
  { key: 'chinext', code: '399006', name: '创业板指', sinaSymbol: 'sz399006', eastmoneySecid: '0.399006' },
  { key: 'star50', code: '000688', name: '科创50', sinaSymbol: 'sh000688', eastmoneySecid: '1.000688' },
  { key: 'csi300', code: '000300', name: '沪深300', sinaSymbol: 'sh000300', eastmoneySecid: '1.000300' },
  { key: 'csi500', code: '000905', name: '中证500', sinaSymbol: 'sh000905', eastmoneySecid: '1.000905' },
  { key: 'csi1000', code: '000852', name: '中证1000', sinaSymbol: 'sh000852', eastmoneySecid: '1.000852' },
  { key: 'sse50', code: '000016', name: '上证50', sinaSymbol: 'sh000016', eastmoneySecid: '1.000016' }
];

const VALID_WINDOWS = new Set([20, 60, 120]);
const VALID_PERIODS = new Set(['daily', 'weekly', 'yearly']);

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeWindow(value) {
  const number = Number(value);
  return VALID_WINDOWS.has(number) ? number : 60;
}

function normalizeHistoryPeriod(value) {
  const period = String(value || 'daily').toLowerCase();
  return VALID_PERIODS.has(period) ? period : 'daily';
}

function historyRequest(requestedWindow, requestedPeriod) {
  const period = normalizeHistoryPeriod(requestedPeriod);
  if (period === 'weekly') {
    return { period, rawDays: 260, outputPeriods: 52, aggregation: 'week' };
  }
  if (period === 'yearly') {
    return { period, rawDays: 1260, outputPeriods: 60, aggregation: 'month' };
  }
  const window = normalizeWindow(requestedWindow);
  return { period, rawDays: window, outputPeriods: window, aggregation: 'day' };
}

function weekKey(date) {
  const parsed = new Date(date + 'T00:00:00Z');
  const day = parsed.getUTCDay() || 7;
  parsed.setUTCDate(parsed.getUTCDate() - day + 1);
  return parsed.toISOString().slice(0, 10);
}

function aggregateHistoryPoints(input, requestedPeriod) {
  const period = normalizeHistoryPeriod(requestedPeriod);
  const points = (Array.isArray(input) ? input : []).slice().sort(function(a, b) {
    return String(a && a.date || '').localeCompare(String(b && b.date || ''));
  });
  if (period === 'daily') return points;

  const groups = new Map();
  points.forEach(function(point) {
    const date = String(point && point.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const key = period === 'weekly' ? weekKey(date) : date.slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(point);
  });

  return Array.from(groups.values()).map(function(group) {
    const first = group[0];
    const last = group[group.length - 1];
    const highs = group.map(function(item) { return finitePositive(item && item.high); }).filter(function(value) { return value !== null; });
    const lows = group.map(function(item) { return finitePositive(item && item.low); }).filter(function(value) { return value !== null; });
    const volumes = group.map(function(item) {
      const value = Number(item && item.volume);
      return Number.isFinite(value) && value >= 0 ? value : null;
    }).filter(function(value) { return value !== null; });
    return {
      date: String(last.date),
      open: finitePositive(first.open) || finitePositive(first.close),
      close: finitePositive(last.close),
      high: highs.length ? Math.max.apply(null, highs) : null,
      low: lows.length ? Math.min.apply(null, lows) : null,
      volume: volumes.length ? volumes.reduce(function(total, value) { return total + value; }, 0) : null
    };
  }).filter(function(point) { return point.close !== null; });
}

function normalizeSinaPoints(payload) {
  if (!Array.isArray(payload)) return [];
  const byDate = new Map();
  payload.forEach(function(item) {
    const date = String(item && item.day || '');
    const close = finitePositive(item && item.close);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || close === null) return;
    const open = finitePositive(item && item.open);
    const high = finitePositive(item && item.high);
    const low = finitePositive(item && item.low);
    const volume = Number(item && item.volume);
    byDate.set(date, {
      date,
      open,
      close,
      high,
      low,
      volume: Number.isFinite(volume) && volume >= 0 ? volume : null
    });
  });
  return Array.from(byDate.values()).sort(function(a, b) { return a.date.localeCompare(b.date); });
}

function validSeries(series) {
  return (Array.isArray(series) ? series : []).map(function(item) {
    const byDate = new Map();
    (item && Array.isArray(item.points) ? item.points : []).forEach(function(point) {
      const date = String(point && point.date || '');
      const close = finitePositive(point && point.close);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && close !== null) byDate.set(date, close);
    });
    return {
      key: String(item && item.key || ''),
      name: String(item && item.name || item && item.key || ''),
      byDate
    };
  }).filter(function(item) { return item.key && item.byDate.size > 0; });
}

function sharedDates(series) {
  if (!series.length) return [];
  let dates = new Set(series[0].byDate.keys());
  series.slice(1).forEach(function(item) {
    dates = new Set(Array.from(dates).filter(function(date) { return item.byDate.has(date); }));
  });
  return Array.from(dates).sort();
}

function normalizeIndexedSeries(input, window) {
  const items = validSeries(input);
  const dates = sharedDates(items).slice(-normalizeWindow(window));
  return {
    dates,
    series: items.map(function(item) {
      const base = dates.length ? item.byDate.get(dates[0]) : null;
      return {
        key: item.key,
        name: item.name,
        values: base ? dates.map(function(date) {
          return Number(((item.byDate.get(date) / base) * 100).toFixed(6));
        }) : []
      };
    })
  };
}

function alignedReturnPair(leftItem, rightItem, window) {
  const normalized = validSeries([leftItem, rightItem]);
  if (normalized.length !== 2) return { left: [], right: [], dates: [] };
  const left = normalized[0];
  const right = normalized[1];
  const dates = Array.from(left.byDate.keys()).filter(function(date) {
    return right.byDate.has(date);
  }).sort().slice(-(normalizeWindow(window) + 1));
  const leftReturns = [];
  const rightReturns = [];
  const returnDates = [];
  for (let index = 1; index < dates.length; index += 1) {
    const leftValue = Math.log(left.byDate.get(dates[index]) / left.byDate.get(dates[index - 1]));
    const rightValue = Math.log(right.byDate.get(dates[index]) / right.byDate.get(dates[index - 1]));
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) continue;
    leftReturns.push(leftValue);
    rightReturns.push(rightValue);
    returnDates.push(dates[index]);
  }
  return { left: leftReturns, right: rightReturns, dates: returnDates };
}

function pearson(left, right) {
  if (!left.length || left.length !== right.length) return null;
  const count = left.length;
  const leftMean = left.reduce(function(total, value) { return total + value; }, 0) / count;
  const rightMean = right.reduce(function(total, value) { return total + value; }, 0) / count;
  let numerator = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < count; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftVariance += leftDelta * leftDelta;
    rightVariance += rightDelta * rightDelta;
  }
  const denominator = Math.sqrt(leftVariance * rightVariance);
  if (!Number.isFinite(denominator) || denominator <= Number.EPSILON) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : null;
}

function buildReturnCorrelationMatrix(input, options) {
  options = options || {};
  const items = Array.isArray(input) ? input.filter(function(item) { return item && item.key; }) : [];
  const window = normalizeWindow(options.window);
  const minSamples = Math.max(2, Number(options.minSamples) || 20);
  const pairs = items.map(function(leftItem) {
    return items.map(function(rightItem) {
      return alignedReturnPair(leftItem, rightItem, window);
    });
  });
  const values = items.map(function(_, rowIndex) {
    return items.map(function(__, columnIndex) {
      const pair = pairs[rowIndex][columnIndex];
      if (pair.dates.length < minSamples) return null;
      return pearson(pair.left, pair.right);
    });
  });
  const sampleCounts = items.map(function(_, rowIndex) {
    return items.map(function(__, columnIndex) {
      return pairs[rowIndex][columnIndex].dates.length;
    });
  });
  return {
    method: 'pearson-log-return',
    window,
    minSamples,
    keys: items.map(function(item) { return item.key; }),
    values,
    sampleCounts
  };
}

function createMarketIndexHistoryService(options) {
  options = options || {};
  const client = options.marketData || marketData;
  const definitions = options.definitions || INDEX_HISTORY_DEFINITIONS;
  const cacheTtlMs = Number.isFinite(options.cacheTtlMs) ? Math.max(0, options.cacheTtlMs) : 5 * 60 * 1000;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const cacheByWindow = new Map();
  const pendingByWindow = new Map();

  async function fetchOne(definition, request) {
    const url = 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/' +
      'CN_MarketData.getKLineData?symbol=' + encodeURIComponent(definition.sinaSymbol) +
      '&scale=240&ma=no&datalen=' + (request.rawDays + 1);
    const response = await client.get('market-index-history:' + definition.sinaSymbol + ':' + request.period + ':' + request.rawDays, url, {
      headers: { Referer: 'https://finance.sina.com.cn' }
    });
    const requiredClosePoints = request.outputPeriods + 1;
    const rawPoints = normalizeSinaPoints(response && response.data).slice(-(request.rawDays + 1));
    const points = aggregateHistoryPoints(rawPoints, request.period).slice(-requiredClosePoints);
    const availableReturnDays = Math.max(0, points.length - 1);
    if (points.length < requiredClosePoints) {
      const error = new Error(definition.name + '历史指数覆盖不足：需要 ' + request.outputPeriods +
        ' 个收益日（' + requiredClosePoints + ' 个收盘点），实际 ' + availableReturnDays +
        ' 个收益日（' + points.length + ' 个收盘点）');
      error.code = 'INSUFFICIENT_INDEX_HISTORY';
      error.availableDays = availableReturnDays;
      throw error;
    }
    return {
      key: definition.key,
      code: definition.code,
      name: definition.name,
      sinaSymbol: definition.sinaSymbol,
      eastmoneySecid: definition.eastmoneySecid,
      status: 'available',
      requestedDays: request.outputPeriods,
      availableDays: request.outputPeriods,
      coverageRatio: 1,
      points
    };
  }

  async function loadIndexHistory(requestedWindow, requestedPeriod) {
    const request = historyRequest(requestedWindow, requestedPeriod);
    const window = request.outputPeriods;
    const results = await Promise.allSettled(definitions.map(function(definition) {
      return fetchOne(definition, request);
    }));
    const series = results.map(function(result, index) {
      if (result.status === 'fulfilled') return result.value;
      const definition = definitions[index];
      return {
        key: definition.key,
        code: definition.code,
        name: definition.name,
        sinaSymbol: definition.sinaSymbol,
        eastmoneySecid: definition.eastmoneySecid,
        status: 'unavailable',
        reason: result.reason && result.reason.message || 'provider-request-failed',
        requestedDays: window,
        availableDays: Math.max(0, Number(result.reason && result.reason.availableDays) || 0),
        coverageRatio: Math.min(1, Math.max(0, Number(result.reason && result.reason.availableDays) || 0) / window),
        points: []
      };
    });
    const available = series.filter(function(item) { return item.status === 'available'; });
    const comparison = normalizeIndexedSeries(available, window);
    const correlation = buildReturnCorrelationMatrix(available, { window, minSamples: 20 });
    return {
      window,
      period: request.period,
      aggregation: request.aggregation,
      rawDays: request.rawDays,
      status: available.length === definitions.length ? 'available' : (available.length ? 'partial' : 'unavailable'),
      fetchedAt: new Date().toISOString(),
      source: {
        id: 'sina-public-index-history',
        label: request.period === 'daily' ? '新浪公开指数日线' : '新浪公开指数日线聚合',
        note: request.period === 'weekly'
          ? '近一年日线按自然周聚合；归一化以共同窗口起点为100。'
          : (request.period === 'yearly'
            ? '近五年日线按月聚合展示；“年线”指长期视图，不代表单根年度K线。'
            : '指数使用显式市场代码；归一化以共同窗口起点为100，相关性按共同交易日的日对数收益率计算。')
      },
      series,
      comparison,
      correlation
    };
  }

  function fetchIndexHistory(requestedWindow, requestedPeriod) {
    const requestDefinition = historyRequest(requestedWindow, requestedPeriod);
    const cacheKey = requestDefinition.period + ':' + requestDefinition.outputPeriods;
    const cached = cacheByWindow.get(cacheKey);
    if (cached && now() - cached.storedAt < cacheTtlMs) return Promise.resolve(cached.value);
    if (pendingByWindow.has(cacheKey)) return pendingByWindow.get(cacheKey);
    const request = loadIndexHistory(requestedWindow, requestDefinition.period).then(function(value) {
      cacheByWindow.set(cacheKey, { storedAt: now(), value });
      return value;
    }).finally(function() {
      if (pendingByWindow.get(cacheKey) === request) pendingByWindow.delete(cacheKey);
    });
    pendingByWindow.set(cacheKey, request);
    return request;
  }

  return { fetchIndexHistory };
}

const defaultService = createMarketIndexHistoryService();

module.exports = {
  INDEX_HISTORY_DEFINITIONS,
  normalizeWindow,
  normalizeHistoryPeriod,
  historyRequest,
  aggregateHistoryPoints,
  normalizeSinaPoints,
  normalizeIndexedSeries,
  buildReturnCorrelationMatrix,
  createMarketIndexHistoryService,
  fetchIndexHistory: defaultService.fetchIndexHistory
};
