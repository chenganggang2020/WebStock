const axios = require('axios');
const marketData = require('./marketDataService');
const boardCompositeHistoryService = require('./boardCompositeHistoryService');
const {
  INDEX_HISTORY_DEFINITIONS,
  normalizeWindow,
  normalizeSinaPoints,
  normalizeIndexedSeries,
  buildReturnCorrelationMatrix,
  historyRequest,
  aggregateHistoryPoints
} = require('./marketIndexHistoryService');

const EASTMONEY_TOKEN = 'bd1d9ddb04089700cf9c27f6f7426281';
const EASTMONEY_CATALOG_HOSTS = [
  'https://push2.eastmoney.com',
  'https://41.push2.eastmoney.com',
  'https://33.push2.eastmoney.com'
];
const EASTMONEY_HISTORY_HOSTS = [
  'https://push2his.eastmoney.com',
  'https://41.push2his.eastmoney.com'
];

const STATIC_COMPARISON_DEFINITIONS = INDEX_HISTORY_DEFINITIONS.map(function(item) {
  return {
    key: 'index:' + item.key,
    legacyKey: item.key,
    kind: 'index',
    code: item.code,
    name: item.name,
    provider: 'sina-index',
    providerId: item.sinaSymbol,
    sinaSymbol: item.sinaSymbol,
    eastmoneySecid: item.eastmoneySecid,
    aliases: [item.name.replace(/指数|指$/g, '')],
    capabilities: { daily: true, intraday: true }
  };
}).concat([{
  key: 'sector-index:bank',
  kind: 'sector-index',
  code: '399986',
  name: '中证银行',
  provider: 'sina-index',
  providerId: 'sz399986',
  sinaSymbol: 'sz399986',
  eastmoneySecid: '0.399986',
  aliases: ['银行', '银行板块', '银行指数'],
  capabilities: { daily: true, intraday: true },
  methodologyUrl: 'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/indices/detail/files/zh_CN/399986factsheet.pdf'
}]);

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeSelectedKeys(input, allowedKeys) {
  const raw = Array.isArray(input) ? input : String(input || '').split(',');
  const seen = new Set();
  const keys = raw.map(function(value) { return String(value || '').trim(); })
    .filter(function(key) {
      if (!key || seen.has(key) || (allowedKeys && !allowedKeys.has(key))) return false;
      seen.add(key);
      return true;
    });
  if (keys.length < 2) throw new Error('请至少选择 2 个比较对象');
  if (keys.length > 8) throw new Error('最多选择 8 个比较对象');
  return keys;
}

function normalizeEastmoneyBoardPoints(payload) {
  const lines = payload && payload.data && Array.isArray(payload.data.klines)
    ? payload.data.klines : [];
  const byDate = new Map();
  lines.forEach(function(line) {
    const fields = String(line || '').split(',');
    const date = fields[0] || '';
    const open = finitePositive(fields[1]);
    const close = finitePositive(fields[2]);
    const high = finitePositive(fields[3]);
    const low = finitePositive(fields[4]);
    const volume = Number(fields[5]);
    const amount = Number(fields[6]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || open === null || close === null ||
        high === null || low === null || high < Math.max(open, close) || low > Math.min(open, close)) return;
    byDate.set(date, {
      date,
      open,
      close,
      high,
      low,
      volume: Number.isFinite(volume) && volume >= 0 ? volume : null,
      amount: Number.isFinite(amount) && amount >= 0 ? amount : null
    });
  });
  return Array.from(byDate.values()).sort(function(left, right) { return left.date.localeCompare(right.date); });
}

function publicDefinition(definition) {
  const providerLabels = {
    'sina-index': '新浪公开指数行情',
    'eastmoney-board': '东方财富公开板块'
  };
  return {
    key: definition.key,
    kind: definition.kind,
    code: definition.code,
    name: definition.name,
    provider: definition.provider,
    providerLabel: definition.providerLabel || providerLabels[definition.provider] || definition.provider,
    providerId: definition.providerId,
    aliases: Array.isArray(definition.aliases) ? definition.aliases : [],
    capabilities: Object.assign({ daily: false, intraday: false }, definition.capabilities || {}),
    status: definition.status || 'available',
    historyMode: definition.historyMode || null,
    methodologyUrl: definition.methodologyUrl || null
  };
}

function mapEastmoneyBoard(row, kind) {
  const code = String(row && row.f12 || '').trim();
  const name = String(row && row.f14 || '').trim();
  if (!/^BK\d+$/i.test(code) || !name) return null;
  return {
    key: 'eastmoney-' + kind + ':' + code.toUpperCase(),
    kind,
    code: code.toUpperCase(),
    name,
    provider: 'eastmoney-board',
    providerId: '90.' + code.toUpperCase(),
    aliases: [],
    capabilities: { daily: true, intraday: false },
    status: 'available'
  };
}

function parseEastmoneyBoardKey(key) {
  const match = /^eastmoney-(industry|concept|region):(BK\d{4})$/i.exec(String(key || '').trim());
  if (!match) return null;
  const kind = match[1].toLowerCase();
  const code = match[2].toUpperCase();
  return mapEastmoneyBoard({ f12: code, f14: code }, kind);
}

function catalogMatches(item, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return true;
  return [item.name, item.code, item.key].concat(item.aliases || []).some(function(value) {
    return String(value || '').toLowerCase().includes(needle);
  });
}

function createMarketComparisonService(options) {
  options = options || {};
  const client = options.marketData || marketData;
  const boardCatalogService = options.boardCatalogService || null;
  const compositeService = options.boardCompositeHistoryService || boardCompositeHistoryService;
  const staticDefinitions = options.staticDefinitions || STATIC_COMPARISON_DEFINITIONS;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const historyCacheTtlMs = Number.isFinite(options.historyCacheTtlMs)
    ? Math.max(0, options.historyCacheTtlMs) : 5 * 60 * 1000;
  const catalogCacheTtlMs = Number.isFinite(options.catalogCacheTtlMs)
    ? Math.max(0, options.catalogCacheTtlMs) : 30 * 60 * 1000;
  const historyCache = new Map();
  const historyPending = new Map();
  let catalogCache = null;
  let catalogPending = null;

  async function catalogRequest(kind) {
    const fs = kind === 'concept' ? 'm:90+t:3+f:!50'
      : (kind === 'region' ? 'm:90+t:1+f:!50' : 'm:90+t:2+f:!50');
    const params = new URLSearchParams({
      pn: '1', pz: '500', po: '1', np: '1', ut: EASTMONEY_TOKEN,
      fltt: '2', invt: '2', fid: 'f3', fs, fields: 'f12,f14'
    });
    const errors = [];
    for (const host of EASTMONEY_CATALOG_HOSTS) {
      const url = host + '/api/qt/clist/get?' + params.toString();
      try {
        let response;
        if (typeof options.catalogGet === 'function') {
          response = await options.catalogGet(url);
        } else if (options.marketData) {
          response = await client.get('comparison-catalog:' + kind + ':' + host, url, {
            headers: { Referer: 'https://quote.eastmoney.com/', 'User-Agent': 'Mozilla/5.0 WebStock' }
          });
        } else {
          response = await axios.get(url, {
            timeout: 4500,
            headers: { Referer: 'https://quote.eastmoney.com/', 'User-Agent': 'Mozilla/5.0 WebStock' }
          });
        }
        const rows = response && response.data && response.data.data && Array.isArray(response.data.data.diff)
          ? response.data.data.diff : [];
        if (!rows.length) throw new Error('provider returned no board rows');
        return rows.map(function(row) { return mapEastmoneyBoard(row, kind); }).filter(Boolean);
      } catch (error) {
        errors.push(error && error.message || String(error));
      }
    }
    throw new Error(errors[errors.length - 1] || 'Eastmoney board catalog unavailable');
  }

  async function loadCatalog() {
    const kinds = ['industry', 'concept', 'region'];
    const results = await Promise.allSettled(kinds.map(catalogRequest));
    const dynamic = [];
    const warnings = [];
    results.forEach(function(result, index) {
      if (result.status === 'fulfilled') dynamic.push.apply(dynamic, result.value);
      else warnings.push(({ industry: '行业', concept: '概念', region: '地域' }[kinds[index]]) + '目录不可用：' +
        (result.reason && result.reason.message || 'provider-request-failed'));
    });
    let completeCatalog = null;
    if (options.boardCatalogService || warnings.length) {
      try {
        const catalogService = boardCatalogService || require('./marketBoardService');
        completeCatalog = await catalogService.fetchCatalog({});
      } catch (error) {
        warnings.push('完整公开板块目录不可用：' + (error && error.message || 'provider-request-failed'));
      }
    }
    const compositeAvailable = Boolean(compositeService && typeof compositeService.isAvailable === 'function' && compositeService.isAvailable());
    const completeItems = completeCatalog && Array.isArray(completeCatalog.items) ? completeCatalog.items : [];
    const merged = new Map();
    staticDefinitions.concat(dynamic, completeItems).forEach(function(item) {
      if (!item || !item.key) return;
      const isSinaBoard = /^sina-public-(?:industry|concept|region)$/.test(String(item.provider || ''));
      const enriched = isSinaBoard && compositeAvailable
        ? Object.assign({}, item, {
            capabilities: Object.assign({}, item.capabilities || {}, { daily: true }),
            historyMode: 'current-constituent-equal-weight-estimate',
            providerLabel: '新浪公开板块目录 + 本地当前成分等权估算'
          })
        : item;
      merged.set(enriched.key, enriched);
    });
    if (completeCatalog && Array.isArray(completeCatalog.warnings)) warnings.push.apply(warnings, completeCatalog.warnings);
    const items = Array.from(merged.values()).map(publicDefinition);
    return {
      status: items.length ? (warnings.length ? 'partial' : 'available') : 'unavailable',
      fetchedAt: new Date(now()).toISOString(),
      items,
      warnings,
      sources: [
        { id: 'curated-public-index', label: '公开指数白名单' },
        { id: 'eastmoney-board-catalog', label: '东方财富公开板块目录', available: dynamic.length > 0 },
        { id: 'sina-board-catalog', label: '新浪公开板块目录', available: completeItems.length > 0 },
        { id: 'local-current-constituent-equal-weight', label: '本地当前成分等权估算', available: compositeAvailable }
      ]
    };
  }

  function fetchCatalog(query) {
    const cached = catalogCache;
    const request = cached && now() - cached.storedAt < catalogCacheTtlMs
      ? Promise.resolve(cached.value)
      : (catalogPending || (catalogPending = loadCatalog().then(function(value) {
        catalogCache = { storedAt: now(), value };
        return value;
      }).finally(function() { catalogPending = null; })));
    return request.then(function(value) {
      if (!query) return value;
      return Object.assign({}, value, { items: value.items.filter(function(item) { return catalogMatches(item, query); }) });
    });
  }

  async function fetchSinaHistory(definition, rawDays) {
    const url = 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/' +
      'CN_MarketData.getKLineData?symbol=' + encodeURIComponent(definition.sinaSymbol || definition.providerId) +
      '&scale=240&ma=no&datalen=' + (rawDays + 1);
    const response = await client.get('comparison-history:' + definition.key + ':' + rawDays, url, {
      headers: { Referer: 'https://finance.sina.com.cn' }
    });
    return normalizeSinaPoints(response && response.data).slice(-(rawDays + 1));
  }

  async function fetchEastmoneyHistory(definition, rawDays) {
    const params = new URLSearchParams({
      secid: definition.providerId,
      fields1: 'f1,f2,f3,f4,f5,f6',
      fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
      klt: '101', fqt: '1', lmt: String(rawDays + 1), end: '20500101'
    });
    const errors = [];
    for (const host of EASTMONEY_HISTORY_HOSTS) {
      try {
        const url = host + '/api/qt/stock/kline/get?' + params.toString();
        const response = await client.get('comparison-history:' + definition.key + ':' + rawDays + ':' + host, url, {
          headers: { Referer: 'https://quote.eastmoney.com/', 'User-Agent': 'Mozilla/5.0 WebStock' }
        });
        const points = normalizeEastmoneyBoardPoints(response && response.data).slice(-(rawDays + 1));
        if (points.length) return points;
        throw new Error('provider returned no board history');
      } catch (error) {
        errors.push(error && error.message || String(error));
      }
    }
    throw new Error(errors[errors.length - 1] || 'Eastmoney board history unavailable');
  }

  function fetchDefinitionHistory(definition, requestDefinition) {
    const cacheKey = definition.key + '|' + requestDefinition.period + '|' + requestDefinition.rawDays;
    const cached = historyCache.get(cacheKey);
    if (cached && now() - cached.storedAt < historyCacheTtlMs) return Promise.resolve(cached.value);
    if (historyPending.has(cacheKey)) return historyPending.get(cacheKey);
    const loader = definition.historyMode === 'current-constituent-equal-weight-estimate'
      ? compositeService.fetchHistory(definition, requestDefinition.rawDays)
      : (definition.provider === 'eastmoney-board'
        ? fetchEastmoneyHistory(definition, requestDefinition.rawDays)
        : fetchSinaHistory(definition, requestDefinition.rawDays));
    const request = Promise.resolve(loader).then(function(result) {
        const rawPoints = Array.isArray(result) ? result : result.points;
        const points = aggregateHistoryPoints(rawPoints, requestDefinition.period).slice(-(requestDefinition.outputPeriods + 1));
        const minimumReturns = requestDefinition.period === 'yearly' ? 36
          : (requestDefinition.period === 'weekly' ? 40 : requestDefinition.outputPeriods);
        if (points.length < minimumReturns + 1) {
          const error = new Error('需要 ' + requestDefinition.outputPeriods + ' 个收益周期，实际 ' + Math.max(0, points.length - 1) + ' 个');
          error.code = 'INSUFFICIENT_COMPARISON_HISTORY';
          throw error;
        }
        const value = {
          points,
          availablePeriods: Math.max(0, points.length - 1),
          source: result && result.source || null,
          warnings: result && result.warnings || []
        };
        historyCache.set(cacheKey, { storedAt: now(), value });
        return value;
      }).finally(function() {
        if (historyPending.get(cacheKey) === request) historyPending.delete(cacheKey);
      });
    historyPending.set(cacheKey, request);
    return request;
  }

  async function resolveDefinitions(keys) {
    const byKey = new Map(staticDefinitions.map(function(item) { return [item.key, item]; }));
    keys.forEach(function(key) {
      const dynamic = parseEastmoneyBoardKey(key);
      if (dynamic) byKey.set(key, dynamic);
    });
    const unresolved = keys.filter(function(key) { return !byKey.has(key); });
    if (unresolved.length) {
      const catalog = await fetchCatalog();
      catalog.items.forEach(function(item) { byKey.set(item.key, item); });
    }
    return keys.map(function(key) {
      return byKey.get(key) || parseEastmoneyBoardKey(key) || {
        key, kind: 'unknown', code: '', name: key, provider: 'unavailable', providerId: '',
        capabilities: { daily: false, intraday: false }, status: 'unavailable'
      };
    });
  }

  async function fetchHistory(input) {
    input = input || {};
    const requestDefinition = historyRequest(input.window, input.period);
    const window = requestDefinition.outputPeriods;
    const keys = normalizeSelectedKeys(input.keys);
    const definitions = await resolveDefinitions(keys);
    const settled = await Promise.allSettled(definitions.map(function(definition) {
      if (!definition.capabilities || definition.capabilities.daily !== true) {
        return Promise.reject(new Error('该对象没有可验证的日线数据源'));
      }
      return fetchDefinitionHistory(definition, requestDefinition);
    }));
    const series = settled.map(function(result, index) {
      const definition = definitions[index];
      if (result.status === 'fulfilled') {
        return Object.assign(publicDefinition(definition), {
          status: 'available', requestedDays: window, availableDays: result.value.availablePeriods,
          coverageRatio: Math.min(1, result.value.availablePeriods / window), points: result.value.points,
          source: result.value.source || null,
          warnings: result.value.warnings || []
        });
      }
      return Object.assign(publicDefinition(definition), {
        status: 'unavailable', requestedDays: window, availableDays: 0,
        reason: result.reason && result.reason.message || 'provider-request-failed', points: []
      });
    });
    const available = series.filter(function(item) { return item.status === 'available'; });
    const warnings = series.reduce(function(all, item) {
      return all.concat(Array.isArray(item.warnings) ? item.warnings : []);
    }, []).filter(function(item, index, list) { return list.indexOf(item) === index; });
    return {
      mode: requestDefinition.period,
      window,
      rawDays: requestDefinition.rawDays,
      aggregation: requestDefinition.aggregation,
      requestedKeys: keys,
      status: available.length === series.length ? 'available' : (available.length ? 'partial' : 'unavailable'),
      fetchedAt: new Date(now()).toISOString(),
      source: {
        id: 'public-comparison-history',
        label: requestDefinition.period === 'daily' ? '公开指数/板块日线' : '公开指数/板块日线聚合',
        note: requestDefinition.period === 'weekly'
          ? '近一年日线按自然周聚合。'
          : (requestDefinition.period === 'yearly' ? '近五年日线按月聚合展示。' : '归一化使用共同交易日起点。')
      },
      warnings,
      series,
      comparison: normalizeIndexedSeries(available, window),
      correlation: buildReturnCorrelationMatrix(available, { window, minSamples: requestDefinition.period === 'yearly' ? 12 : 20 })
    };
  }

  return { fetchCatalog, fetchHistory };
}

const defaultService = createMarketComparisonService();

module.exports = {
  STATIC_COMPARISON_DEFINITIONS,
  normalizeSelectedKeys,
  normalizeEastmoneyBoardPoints,
  mapEastmoneyBoard,
  parseEastmoneyBoardKey,
  createMarketComparisonService,
  fetchCatalog: defaultService.fetchCatalog,
  fetchHistory: defaultService.fetchHistory
};
