const marketData = require('./marketDataService');
const { normalizeSinaKlines } = require('./publicMinuteService');
const { STATIC_COMPARISON_DEFINITIONS } = require('./marketComparisonService');

const TONGHUASHUN_LEADING_INDEXES = Object.freeze({
  'index:sse': { id: '1A0001', name: '上证指数' },
  'index:szse': { id: '399001', name: '深证成指' },
  'index:chinext': { id: '399006', name: '创业板指' },
  'index:star50': { id: '1B0688', name: '科创50' },
  'index:csi300': { id: '1B0300', name: '沪深300' },
  'index:csi500': { id: '1B0905', name: '中证500' },
  'index:csi1000': { id: '1B0852', name: '中证1000' },
  'index:sse50': { id: '1B0016', name: '上证50' }
});

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compactDate(value) {
  const match = String(value || '').match(/^(\d{4})(\d{2})(\d{2})$/);
  return match ? match[1] + '-' + match[2] + '-' + match[3] : '';
}

function tradingLabel(value) {
  const match = String(value || '').match(/^(\d{2})(\d{2})$/);
  if (!match) return '';
  const minute = Number(match[1]) * 60 + Number(match[2]);
  if (!((minute >= 570 && minute <= 690) || (minute >= 780 && minute <= 900))) return '';
  return match[1] + ':' + match[2];
}

function normalizeTencentInstrumentMinute(payload, definition) {
  const symbol = String(definition && definition.providerId || '');
  const container = payload && payload.data && payload.data[symbol];
  const source = container && container.data;
  const quote = container && container.qt && (container.qt[symbol] || container.qt[definition.code]);
  const tradingDate = compactDate(source && source.date);
  const lines = source && Array.isArray(source.data) ? source.data : [];
  let previousCumulativeVolume = 0;
  let previousCumulativeAmount = 0;
  const points = lines.map(function(line) {
    const fields = String(line || '').trim().split(/\s+/);
    const label = tradingLabel(fields[0]);
    const price = numberOrNull(fields[1]);
    const cumulativeVolumeLots = numberOrNull(fields[2]);
    const cumulativeAmount = numberOrNull(fields[3]);
    if (!tradingDate || !label || price === null || price <= 0 ||
        cumulativeVolumeLots === null || cumulativeAmount === null) return null;
    const volume = Math.max(cumulativeVolumeLots - previousCumulativeVolume, 0) * 100;
    const amount = Math.max(cumulativeAmount - previousCumulativeAmount, 0);
    previousCumulativeVolume = cumulativeVolumeLots;
    previousCumulativeAmount = cumulativeAmount;
    return {
      time: tradingDate + ' ' + label + ':00',
      label,
      price,
      volume,
      amount
    };
  }).filter(Boolean).sort(function(left, right) { return left.time.localeCompare(right.time); });
  const pointPrices = points.map(function(point) { return point.price; });
  const quotedLatestPrice = numberOrNull(quote && quote[3]);
  const quotedPreviousClose = numberOrNull(quote && quote[4]);
  const quotedOpenPrice = numberOrNull(quote && quote[5]);
  const quotedHighPrice = numberOrNull(quote && quote[33]);
  const quotedLowPrice = numberOrNull(quote && quote[34]);
  const latestPrice = quotedLatestPrice !== null && quotedLatestPrice > 0
    ? quotedLatestPrice : (points.length ? points[points.length - 1].price : null);
  const previousClose = quotedPreviousClose !== null && quotedPreviousClose > 0
    ? quotedPreviousClose : null;
  const changePct = numberOrNull(quote && quote[32]);
  return {
    tradingDate,
    points,
    previousClose,
    latestPrice,
    openPrice: quotedOpenPrice !== null && quotedOpenPrice > 0
      ? quotedOpenPrice : (points.length ? points[0].price : null),
    highPrice: quotedHighPrice !== null && quotedHighPrice > 0
      ? quotedHighPrice : (pointPrices.length ? Math.max.apply(null, pointPrices) : null),
    lowPrice: quotedLowPrice !== null && quotedLowPrice > 0
      ? quotedLowPrice : (pointPrices.length ? Math.min.apply(null, pointPrices) : null),
    changePct: changePct === null && previousClose && latestPrice
      ? Number(((latestPrice - previousClose) / previousClose * 100).toFixed(4)) : changePct
  };
}

function normalizeTonghuashunIndexLeadingMinute(payload, definition) {
  definition = definition || TONGHUASHUN_LEADING_INDEXES['index:sse'];
  let parsed = payload;
  if (typeof parsed === 'string') {
    const start = parsed.indexOf('(');
    const end = parsed.lastIndexOf(')');
    if (start < 0 || end <= start) throw new Error('Tonghuashun leading payload is not valid JSONP');
    parsed = JSON.parse(parsed.slice(start + 1, end));
  }
  const sourceKey = 'hs_' + definition.id;
  const source = parsed && parsed[sourceKey];
  const sourceName = String(source && source.name || '').trim();
  if (sourceName && definition.name && sourceName !== definition.name) {
    throw new Error('Tonghuashun leading payload identity mismatch');
  }
  const tradingDate = compactDate(source && source.date);
  const lines = String(source && source.data || '').split(';').filter(Boolean);
  const points = lines.map(function(line) {
    const fields = String(line || '').split(',');
    const label = tradingLabel(fields[0]);
    const price = numberOrNull(fields[1]);
    const amount = numberOrNull(fields[2]);
    const equalWeightPrice = numberOrNull(fields[3]);
    const volume = numberOrNull(fields[4]);
    if (!tradingDate || !label || price === null || price <= 0 ||
        equalWeightPrice === null || equalWeightPrice <= 0) return null;
    return {
      time: tradingDate + ' ' + label + ':00',
      label,
      price,
      equalWeightPrice,
      volume: volume !== null && volume >= 0 ? volume : null,
      amount: amount !== null && amount >= 0 ? amount : null
    };
  }).filter(Boolean).sort(function(left, right) { return left.time.localeCompare(right.time); });
  if (!points.length) throw new Error('Tonghuashun returned no usable index leading minutes');
  const prices = points.map(function(point) { return point.price; });
  const previousClose = numberOrNull(source && source.pre);
  const latestPrice = points[points.length - 1].price;
  return {
    tradingDate,
    points,
    previousClose: previousClose !== null && previousClose > 0 ? previousClose : null,
    latestPrice,
    openPrice: points[0].price,
    highPrice: Math.max.apply(null, prices),
    lowPrice: Math.min.apply(null, prices),
    changePct: previousClose !== null && previousClose > 0
      ? Number(((latestPrice - previousClose) / previousClose * 100).toFixed(4)) : null,
    dataSource: 'tonghuashun-public-index-leading-minute',
    providerLabel: '同花顺公开' + (definition.name || sourceName || '指数') + '领先1分钟分时',
    leadingIndicator: {
      available: true,
      weightedField: 'price',
      equalWeightField: 'equalWeightPrice',
      meaning: '白线为加权指数，黄线为不加权领先指标'
    },
    sampling: { intervalMinutes: 1, intervalSeconds: 60, observedPoints: points.length }
  };
}

function normalizeTonghuashunSseLeadingMinute(payload) {
  return normalizeTonghuashunIndexLeadingMinute(payload, TONGHUASHUN_LEADING_INDEXES['index:sse']);
}

function shanghaiParts(timestamp) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(timestamp)).map(function(part) { return [part.type, part.value]; }));
}

function marketState(timestamp, tradingDate) {
  const parts = shanghaiParts(timestamp);
  const today = parts.year + '-' + parts.month + '-' + parts.day;
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  const weekday = parts.weekday;
  const tradingNow = weekday !== 'Sat' && weekday !== 'Sun' &&
    ((minute >= 570 && minute <= 690) || (minute >= 780 && minute < 900));
  if (!tradingNow) return { marketState: 'latest-close', stale: false, tradingSession: false };
  return tradingDate === today
    ? { marketState: 'live', stale: false, tradingSession: true }
    : { marketState: 'delayed', stale: true, tradingSession: true };
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
  return Math.max(-1, Math.min(1, numerator / denominator));
}

function pointKey(item, point) {
  const time = String(point && point.time || '').trim();
  const timestampMatch = time.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
  if (timestampMatch) return timestampMatch[1] + ' ' + timestampMatch[2];
  const label = String(point && point.label || time.slice(0, 5));
  const tradingDate = String(item && item.tradingDate || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(tradingDate) && /^\d{2}:\d{2}$/.test(label)
    ? tradingDate + ' ' + label : label;
}

function pointLabel(key) {
  const match = String(key || '').match(/(\d{2}:\d{2})$/);
  return match ? match[1] : String(key || '');
}

function pointMap(item) {
  return new Map((item && Array.isArray(item.points) ? item.points : []).map(function(point) {
    return [pointKey(item, point), Number(point.price)];
  }).filter(function(entry) { return entry[0] && Number.isFinite(entry[1]) && entry[1] > 0; }));
}

function sharedLabels(series) {
  if (!series.length) return [];
  const maps = series.map(pointMap);
  let labels = new Set(maps[0].keys());
  maps.slice(1).forEach(function(map) {
    labels = new Set(Array.from(labels).filter(function(label) { return map.has(label); }));
  });
  return Array.from(labels).sort();
}

function normalizeIntradayComparison(series) {
  const items = (Array.isArray(series) ? series : []).filter(function(item) {
    return item && item.status === 'available' && Array.isArray(item.points) && item.points.length;
  });
  const keys = sharedLabels(items);
  const allHavePreviousClose = items.length > 0 && items.every(function(item) {
    const previousClose = numberOrNull(item.previousClose);
    return previousClose !== null && previousClose > 0;
  });
  return {
    labels: keys.map(pointLabel),
    basis: allHavePreviousClose ? 'previous-close-100' : 'first-shared-point-100',
    series: items.map(function(item) {
      const values = pointMap(item);
      const base = numberOrNull(item.previousClose) || (keys.length ? values.get(keys[0]) : null);
      return {
        key: item.key,
        name: item.name,
        kind: item.kind,
        values: base ? keys.map(function(key) {
          return Number((values.get(key) / base * 100).toFixed(6));
        }) : []
      };
    })
  };
}

function buildIntradayCorrelation(series, minSamples) {
  const items = (Array.isArray(series) ? series : []).filter(function(item) {
    return item && item.status === 'available' && Array.isArray(item.points) && item.points.length;
  });
  const maps = items.map(pointMap);
  const minimum = Math.max(2, Number(minSamples) || 20);
  const pairs = items.map(function(_, row) {
    return items.map(function(__, column) {
      const labels = Array.from(maps[row].keys()).filter(function(label) { return maps[column].has(label); }).sort();
      const left = [];
      const right = [];
      for (let index = 1; index < labels.length; index += 1) {
        left.push(Math.log(maps[row].get(labels[index]) / maps[row].get(labels[index - 1])));
        right.push(Math.log(maps[column].get(labels[index]) / maps[column].get(labels[index - 1])));
      }
      return { left, right, count: left.length };
    });
  });
  return {
    method: 'pearson-minute-log-return',
    minSamples: minimum,
    keys: items.map(function(item) { return item.key; }),
    values: pairs.map(function(row) { return row.map(function(pair) {
      return pair.count >= minimum ? pearson(pair.left, pair.right) : null;
    }); }),
    sampleCounts: pairs.map(function(row) { return row.map(function(pair) { return pair.count; }); })
  };
}

function normalizeRequestedKeys(input, definitions, options) {
  options = options || {};
  const byKey = new Map();
  definitions.forEach(function(item) {
    byKey.set(item.key, item.key);
    if (item.legacyKey) byKey.set(item.legacyKey, item.key);
  });
  const raw = Array.isArray(input) ? input : String(input || '').split(',');
  const seen = new Set();
  const keys = raw.map(function(value) {
    const rawKey = String(value || '').trim();
    return byKey.get(rawKey) || (options.keepUnknown && /^[a-z-]+:[^,]+$/i.test(rawKey) ? rawKey : '');
  }).filter(function(key) {
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const minimum = options.minimum == null ? 1 : Number(options.minimum);
  if (keys.length < minimum) throw new Error('请至少选择 ' + minimum + ' 个分时对象');
  if (keys.length > 8) throw new Error('最多选择 8 个分时对象');
  return keys;
}

function createMarketIntradayService(options) {
  options = options || {};
  const client = options.marketData || marketData;
  const leadingGet = typeof options.leadingGet === 'function'
    ? options.leadingGet
    : (!options.marketData && client && typeof client.get === 'function' ? client.get.bind(client) : null);
  const definitions = (options.definitions || STATIC_COMPARISON_DEFINITIONS).filter(function(item) {
    return item && item.capabilities && item.capabilities.intraday === true;
  });
  const byKey = new Map(definitions.map(function(item) { return [item.key, item]; }));
  const indexDefinitions = definitions.filter(function(item) { return item.kind === 'index'; });
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const minCorrelationSamples = Math.max(2, Number(options.minCorrelationSamples) || 20);
  const cache = new Map();
  const pending = new Map();

  async function requestDefinition(definition) {
    const symbol = definition.providerId;
    const errors = [];
    const leadingDefinition = TONGHUASHUN_LEADING_INDEXES[definition.key];
    if (leadingDefinition && leadingGet) {
      try {
        const url = 'https://d.10jqka.com.cn/v6/time/hs_' + leadingDefinition.id + '/last.js';
        const response = await leadingGet('comparison-intraday-index-leading:' + definition.key, url, {
          headers: { Referer: 'https://q.10jqka.com.cn/zs/detail/code/' + leadingDefinition.id + '/', 'User-Agent': 'Mozilla/5.0 WebStock' }
        });
        return normalizeTonghuashunIndexLeadingMinute(response && response.data, leadingDefinition);
      } catch (error) {
        errors.push(error && error.message || String(error));
      }
    }
    try {
      const url = 'https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=' + encodeURIComponent(symbol);
      const response = await client.get('comparison-intraday-tencent:' + definition.key, url, {
        headers: { Referer: 'https://gu.qq.com/', 'User-Agent': 'Mozilla/5.0 WebStock' }
      });
      const normalized = normalizeTencentInstrumentMinute(response && response.data, definition);
      if (!normalized.points.length) throw new Error('Tencent returned no minute points');
      return Object.assign({}, normalized, {
        dataSource: 'tencent-public-index-minute',
        providerLabel: '腾讯公开指数1分钟行情',
        sampling: { intervalMinutes: 1, intervalSeconds: 60, observedPoints: normalized.points.length }
      });
    } catch (error) {
      errors.push(error && error.message || String(error));
    }

    try {
      const url = 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/' +
        'CN_MarketData.getKLineData?symbol=' + encodeURIComponent(symbol) + '&scale=5&ma=no&datalen=1000';
      const response = await client.get('comparison-intraday-sina:' + definition.key, url, {
        headers: { Referer: 'https://finance.sina.com.cn' }
      });
      const normalized = normalizeSinaKlines(response && response.data);
      if (!normalized.rows.length) throw new Error('Sina returned no minute points');
      const points = normalized.rows.map(function(row) {
        return {
          time: row.time,
          label: row.time.slice(11, 16),
          price: row.price,
          volume: row.volume,
          amount: row.amount
        };
      });
      return {
        tradingDate: normalized.tradingDate,
        points,
        previousClose: null,
        latestPrice: points[points.length - 1].price,
        openPrice: points[0].price,
        highPrice: Math.max.apply(null, points.map(function(point) { return point.price; })),
        lowPrice: Math.min.apply(null, points.map(function(point) { return point.price; })),
        changePct: null,
        dataSource: 'sina-public-index-5m',
        providerLabel: '新浪公开指数5分钟行情',
        fallbackFrom: 'tencent-public-index-minute',
        reason: errors[0],
        sampling: { intervalMinutes: 5, intervalSeconds: 300, observedPoints: points.length }
      };
    } catch (error) {
      errors.push(error && error.message || String(error));
    }
    const unavailable = new Error(errors[errors.length - 1] || 'public intraday providers unavailable');
    unavailable.code = 'INTRADAY_PROVIDER_UNAVAILABLE';
    throw unavailable;
  }

  function fetchOne(definition) {
    const timestamp = now();
    const timestampIso = new Date(timestamp).toISOString();
    const cached = cache.get(definition.key);
    const state = marketState(timestamp, cached && cached.value && cached.value.tradingDate || '');
    const ttl = state.tradingSession ? 15 * 1000 : 10 * 60 * 1000;
    if (cached && timestamp - cached.storedAt < ttl) {
      return Promise.resolve(Object.assign({}, cached.value, { servedAt: timestampIso }));
    }
    if (pending.has(definition.key)) return pending.get(definition.key);
    const request = requestDefinition(definition).then(function(value) {
      const observedState = marketState(timestamp, value.tradingDate);
      const result = Object.assign({}, definition, value, observedState, {
        status: 'available',
        fetchedAt: timestampIso,
        attemptedAt: timestampIso,
        servedAt: timestampIso,
        synthetic: false,
        realtimeGuaranteed: false,
        exchangeGroundTruth: false
      });
      cache.set(definition.key, { storedAt: timestamp, value: result });
      return result;
    }).catch(function(error) {
      if (cached && cached.value) {
        return Object.assign({}, cached.value, {
          stale: true,
          marketState: 'stale-cache',
          dataSource: 'cache',
          reason: 'provider-request-failed',
          attemptedAt: timestampIso,
          servedAt: timestampIso
        });
      }
      throw error;
    }).finally(function() {
      if (pending.get(definition.key) === request) pending.delete(definition.key);
    });
    pending.set(definition.key, request);
    return request;
  }

  function alignTradingDates(inputSeries) {
    const availableDates = (inputSeries || []).filter(function(item) {
      return item && item.status === 'available';
    }).map(function(item) {
      const direct = String(item.tradingDate || '');
      if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
      const point = (item.points || []).find(function(candidate) {
        return /^\d{4}-\d{2}-\d{2}/.test(String(candidate && candidate.time || ''));
      });
      return point ? String(point.time).slice(0, 10) : '';
    }).filter(Boolean);
    const tradingDate = availableDates.sort().pop() || '';
    return {
      tradingDate,
      series: (inputSeries || []).map(function(item) {
        if (!item || item.status !== 'available') return item;
        const itemDate = /^\d{4}-\d{2}-\d{2}$/.test(String(item.tradingDate || ''))
          ? String(item.tradingDate)
          : String(item.points && item.points[0] && item.points[0].time || '').slice(0, 10);
        if (tradingDate && itemDate === tradingDate) return Object.assign({}, item, { tradingDate: itemDate });
        return Object.assign({}, item, {
          status: 'unavailable',
          reason: itemDate
            ? '交易日不一致：该对象为 ' + itemDate + '，当前比较日为 ' + (tradingDate || '--')
            : '交易日不可验证，不纳入分时比较'
        });
      })
    };
  }

  function latestTimestamp(items, field) {
    return (items || []).map(function(item) { return String(item && item[field] || ''); })
      .filter(Boolean).sort().pop() || null;
  }

  async function fetchIntraday(inputKeys, requestOptions) {
    const keys = normalizeRequestedKeys(inputKeys, definitions, requestOptions);
    const requestStartedAt = new Date(now()).toISOString();
    const requested = keys.map(function(key) {
      return byKey.get(key) || {
        key, kind: 'unknown', code: '', name: key, providerId: '',
        capabilities: { intraday: false }
      };
    });
    const settled = await Promise.allSettled(requested.map(function(definition) {
      return definition.capabilities && definition.capabilities.intraday === true
        ? fetchOne(definition)
        : Promise.reject(new Error('该对象暂无可验证的分时数据，请切换日线'));
    }));
    const servedAt = new Date(now()).toISOString();
    const series = settled.map(function(result, index) {
      if (result.status === 'fulfilled') return result.value;
      const definition = requested[index];
      return Object.assign({}, definition, {
        status: 'unavailable', reason: result.reason && result.reason.message || 'provider-request-failed',
        points: [], tradingDate: '', stale: false, attemptedAt: requestStartedAt, servedAt
      });
    });
    const aligned = alignTradingDates(series);
    const alignedSeries = aligned.series;
    const available = alignedSeries.filter(function(item) { return item.status === 'available'; });
    const stale = available.some(function(item) {
      return item.stale === true || item.marketState === 'stale-cache';
    });
    return {
      mode: 'intraday',
      status: !available.length ? 'unavailable'
        : (available.length === alignedSeries.length && !stale ? 'available' : 'partial'),
      tradingDate: aligned.tradingDate,
      fetchedAt: latestTimestamp(available, 'fetchedAt'),
      attemptedAt: latestTimestamp(alignedSeries, 'attemptedAt'),
      servedAt,
      stale,
      source: {
        id: 'public-index-intraday',
        label: '同花顺指数领先 / 腾讯1分钟 / 新浪5分钟公开指数行情',
        note: '主要指数黄白线仅采用各指数公开领先字段；对应源失败时只展示加权指数，不模拟黄线。公开行情不保证交易所逐笔实时。'
      },
      requestedKeys: keys,
      series: alignedSeries,
      comparison: normalizeIntradayComparison(available),
      correlation: buildIntradayCorrelation(available, minCorrelationSamples)
    };
  }

  function fetchIndexIntraday(inputKeys) {
    const defaults = indexDefinitions.map(function(item) { return item.key; });
    const requested = Array.isArray(inputKeys) || String(inputKeys || '').trim() ? inputKeys : defaults;
    const raw = Array.isArray(requested) ? requested : String(requested || '').split(',');
    const allowed = new Map();
    indexDefinitions.forEach(function(item) {
      allowed.set(item.key, item.key);
      if (item.legacyKey) allowed.set(item.legacyKey, item.key);
    });
    const invalid = raw.map(function(value) { return String(value || '').trim(); })
      .filter(function(key) { return key && !allowed.has(key); });
    if (invalid.length) {
      const error = new Error('指数分时接口只允许固定指数 indexDefinitions：' + invalid.join(', '));
      error.code = 'INDEX_INTRADAY_KEY_INVALID';
      return Promise.reject(error);
    }
    const normalized = normalizeRequestedKeys(raw, indexDefinitions, { minimum: 1 });
    return fetchIntraday(normalized, { minimum: 1 });
  }

  return { fetchIntraday, fetchIndexIntraday };
}

const defaultService = createMarketIntradayService();

module.exports = {
  TONGHUASHUN_LEADING_INDEXES,
  normalizeTonghuashunIndexLeadingMinute,
  normalizeTonghuashunSseLeadingMinute,
  normalizeTencentInstrumentMinute,
  normalizeIntradayComparison,
  buildIntradayCorrelation,
  normalizeRequestedKeys,
  createMarketIntradayService,
  fetchIntraday: defaultService.fetchIntraday,
  fetchIndexIntraday: defaultService.fetchIndexIntraday
};
