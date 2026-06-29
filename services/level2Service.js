require('dotenv').config();

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const db = require('../db');

const DEFAULT_LARGE_ORDER_THRESHOLD = 500000;
const CONFIG_KEYS = [
  'provider',
  'baseUrl',
  'apiKey',
  'authHeader',
  'authPrefix',
  'depthEndpoint',
  'tradesEndpoint',
  'ordersEndpoint',
  'timeoutMs',
  'largeOrderThreshold',
  'volumeUnit',
  'loginUrl'
];

function getConfigPath(env = process.env) {
  return env.WEBSTOCK_LEVEL2_CONFIG_PATH || path.join(path.dirname(db.dbPath), 'level2-config.json');
}

function readSavedConfig(env = process.env) {
  const file = getConfigPath(env);
  try {
    if (!fs.existsSync(file)) return {};
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.warn('[Level2] Could not read saved config:', error.message);
    return {};
  }
}

function writeSavedConfig(config, env = process.env) {
  const file = getConfigPath(env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
}

function envFirst(env, names, fallback) {
  for (let i = 0; i < names.length; i++) {
    const value = env[names[i]];
    if (value !== undefined && String(value).trim() !== '') return String(value).trim();
  }
  return fallback;
}

function toNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function roundMoney(value) {
  return Number(toNumber(value).toFixed(2));
}

function normalizeCode(code) {
  return String(code || '').trim().replace(/^(sh|sz|SH|SZ)/, '');
}

function getLevel2Config(env = process.env) {
  const saved = readSavedConfig(env);
  const provider = envFirst(env, ['LEVEL2_PROVIDER', 'TONGHUASHUN_LEVEL2_PROVIDER'], 'disabled').toLowerCase();
  const baseUrl = envFirst(env, ['LEVEL2_BASE_URL', 'TONGHUASHUN_LEVEL2_BASE_URL'], '');
  const envConfig = {
    provider,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey: envFirst(env, ['LEVEL2_API_KEY', 'TONGHUASHUN_LEVEL2_API_KEY'], ''),
    authHeader: envFirst(env, ['LEVEL2_AUTH_HEADER', 'TONGHUASHUN_LEVEL2_AUTH_HEADER'], 'Authorization'),
    authPrefix: envFirst(env, ['LEVEL2_AUTH_PREFIX', 'TONGHUASHUN_LEVEL2_AUTH_PREFIX'], 'Bearer'),
    depthEndpoint: envFirst(env, ['LEVEL2_DEPTH_ENDPOINT', 'TONGHUASHUN_LEVEL2_DEPTH_ENDPOINT'], '/depth?code={code}'),
    tradesEndpoint: envFirst(env, ['LEVEL2_TRADES_ENDPOINT', 'TONGHUASHUN_LEVEL2_TRADES_ENDPOINT'], '/trades?code={code}&limit={limit}'),
    ordersEndpoint: envFirst(env, ['LEVEL2_ORDERS_ENDPOINT', 'TONGHUASHUN_LEVEL2_ORDERS_ENDPOINT'], '/orders?code={code}&limit={limit}'),
    timeoutMs: toNumber(envFirst(env, ['LEVEL2_TIMEOUT_MS', 'TONGHUASHUN_LEVEL2_TIMEOUT_MS'], '5000'), 5000),
    largeOrderThreshold: toNumber(envFirst(env, ['LEVEL2_LARGE_ORDER_THRESHOLD'], String(DEFAULT_LARGE_ORDER_THRESHOLD)), DEFAULT_LARGE_ORDER_THRESHOLD),
    volumeUnit: envFirst(env, ['LEVEL2_VOLUME_UNIT'], 'share').toLowerCase(),
    loginUrl: envFirst(env, ['LEVEL2_LOGIN_URL', 'TONGHUASHUN_LEVEL2_LOGIN_URL'], 'https://quantapi.10jqka.com.cn/')
  };
  return normalizeConfig(Object.assign({}, envConfig, saved));
}

function maskSecret(value) {
  if (!value) return '';
  if (value.length <= 8) return '***';
  return value.slice(0, 4) + '...' + value.slice(-4);
}

function getPublicStatus(env = process.env) {
  const config = getLevel2Config(env);
  return {
    provider: config.provider,
    configured: config.provider !== 'disabled' && !!config.baseUrl,
    baseUrl: config.baseUrl,
    hasApiKey: !!config.apiKey,
    apiKeyPreview: maskSecret(config.apiKey),
    depthEndpoint: config.depthEndpoint,
    tradesEndpoint: config.tradesEndpoint,
    ordersEndpoint: config.ordersEndpoint,
    largeOrderThreshold: config.largeOrderThreshold,
    volumeUnit: config.volumeUnit,
    loginUrl: config.loginUrl
  };
}

function normalizeConfig(input) {
  const config = {};
  CONFIG_KEYS.forEach(function (key) {
    if (input[key] !== undefined) config[key] = input[key];
  });
  config.provider = String(config.provider || 'disabled').trim().toLowerCase();
  config.baseUrl = String(config.baseUrl || '').trim().replace(/\/+$/, '');
  config.apiKey = String(config.apiKey || '').trim();
  config.authHeader = String(config.authHeader || 'Authorization').trim();
  config.authPrefix = String(config.authPrefix || 'Bearer').trim();
  config.depthEndpoint = String(config.depthEndpoint || '/depth?code={code}').trim();
  config.tradesEndpoint = String(config.tradesEndpoint || '/trades?code={code}&limit={limit}').trim();
  config.ordersEndpoint = String(config.ordersEndpoint || '/orders?code={code}&limit={limit}').trim();
  config.timeoutMs = toNumber(config.timeoutMs, 5000);
  config.largeOrderThreshold = toNumber(config.largeOrderThreshold, DEFAULT_LARGE_ORDER_THRESHOLD);
  config.volumeUnit = String(config.volumeUnit || 'share').trim().toLowerCase() === 'lot' ? 'lot' : 'share';
  config.loginUrl = String(config.loginUrl || 'https://quantapi.10jqka.com.cn/').trim();
  return config;
}

function getEditableConfig(env = process.env) {
  const config = getLevel2Config(env);
  const result = Object.assign({}, config);
  delete result.apiKey;
  result.hasApiKey = !!config.apiKey;
  result.apiKeyPreview = maskSecret(config.apiKey);
  result.configured = config.provider !== 'disabled' && !!config.baseUrl;
  return result;
}

function saveLevel2Config(input, env = process.env) {
  const current = getLevel2Config(env);
  const nextInput = {};
  CONFIG_KEYS.forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(input, key)) nextInput[key] = input[key];
  });
  const shouldPreserveApiKey = !Object.prototype.hasOwnProperty.call(nextInput, 'apiKey') || String(nextInput.apiKey || '').trim() === '';
  const merged = Object.assign({}, current, nextInput);
  if (shouldPreserveApiKey && input.clearApiKey !== true) merged.apiKey = current.apiKey;
  if (input.clearApiKey === true) merged.apiKey = '';

  const saved = normalizeConfig(merged);
  writeSavedConfig(saved, env);
  return getEditableConfig(env);
}

function ensureConfigured(config) {
  if (config.provider === 'disabled' || !config.baseUrl) {
    const error = new Error('Level-2 provider is not configured. Set LEVEL2_PROVIDER and LEVEL2_BASE_URL after buying an authorized data API.');
    error.statusCode = 503;
    throw error;
  }
}

function buildAuthHeaders(config) {
  const headers = {};
  if (!config.apiKey || !config.authHeader) return headers;

  if (config.authHeader.toLowerCase() === 'authorization') {
    const hasScheme = /^(bearer|basic)\s+/i.test(config.apiKey);
    headers[config.authHeader] = hasScheme || !config.authPrefix
      ? config.apiKey
      : config.authPrefix + ' ' + config.apiKey;
  } else {
    headers[config.authHeader] = config.authPrefix
      ? config.authPrefix + ' ' + config.apiKey
      : config.apiKey;
  }
  return headers;
}

function buildUrl(config, endpoint, params) {
  let rendered = endpoint;
  Object.keys(params).forEach(function (key) {
    rendered = rendered.replace(new RegExp('\\{' + key + '\\}', 'g'), encodeURIComponent(String(params[key])));
  });

  const url = new URL(rendered, config.baseUrl + '/');
  Object.keys(params).forEach(function (key) {
    if (!endpoint.includes('{' + key + '}') && params[key] !== undefined && params[key] !== null && params[key] !== '') {
      url.searchParams.set(key, String(params[key]));
    }
  });
  return url.toString();
}

function unwrapPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  if (payload.success && payload.data !== undefined) return payload.data;
  if (payload.result !== undefined) return payload.result;
  if (payload.payload !== undefined) return payload.payload;
  return payload.data !== undefined ? payload.data : payload;
}

async function requestProvider(endpoint, params, env = process.env) {
  const config = getLevel2Config(env);
  ensureConfigured(config);
  const url = buildUrl(config, endpoint, params);
  const response = await axios.get(url, {
    timeout: config.timeoutMs,
    headers: buildAuthHeaders(config)
  });
  return { config, data: unwrapPayload(response.data) };
}

function valueFrom(item, keys, fallback) {
  for (let i = 0; i < keys.length; i++) {
    if (item && item[keys[i]] !== undefined) return item[keys[i]];
  }
  return fallback;
}

function normalizeBookRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(function (row, index) {
    if (Array.isArray(row)) {
      return {
        level: index + 1,
        price: toNumber(row[0]),
        volume: toNumber(row[1]),
        orderCount: toNumber(row[2], null)
      };
    }
    return {
      level: toNumber(valueFrom(row, ['level', 'rank'], index + 1), index + 1),
      price: toNumber(valueFrom(row, ['price', 'p', 'bidPrice', 'askPrice'])),
      volume: toNumber(valueFrom(row, ['volume', 'vol', 'qty', 'quantity'])),
      orderCount: toNumber(valueFrom(row, ['orderCount', 'orders'], null), null)
    };
  }).filter(function (row) {
    return row.price > 0 || row.volume > 0;
  });
}

function normalizeDepth(payload, options = {}) {
  const data = unwrapPayload(payload) || {};
  const code = normalizeCode(options.code || data.code || data.symbol);
  const bidRows = data.bid || data.bids || data.buy || data.buyBook;
  const askRows = data.ask || data.asks || data.sell || data.sellBook;
  let bid = normalizeBookRows(bidRows);
  let ask = normalizeBookRows(askRows);

  if (bid.length === 0 || ask.length === 0) {
    bid = bid.length ? bid : [];
    ask = ask.length ? ask : [];
    for (let i = 1; i <= 10; i++) {
      const bidPrice = toNumber(valueFrom(data, ['bid' + i + 'Price', 'buy' + i + 'Price', 'bidPrice' + i, 'buyPrice' + i, 'bp' + i]));
      const bidVolume = toNumber(valueFrom(data, ['bid' + i + 'Vol', 'buy' + i + 'Vol', 'bidVolume' + i, 'buyVolume' + i, 'bv' + i]));
      const askPrice = toNumber(valueFrom(data, ['ask' + i + 'Price', 'sell' + i + 'Price', 'askPrice' + i, 'sellPrice' + i, 'ap' + i]));
      const askVolume = toNumber(valueFrom(data, ['ask' + i + 'Vol', 'sell' + i + 'Vol', 'askVolume' + i, 'sellVolume' + i, 'av' + i]));
      if (bidPrice > 0 || bidVolume > 0) bid.push({ level: i, price: bidPrice, volume: bidVolume, orderCount: null });
      if (askPrice > 0 || askVolume > 0) ask.push({ level: i, price: askPrice, volume: askVolume, orderCount: null });
    }
  }

  return {
    code,
    provider: options.provider || data.provider || 'level2',
    timestamp: data.timestamp || data.time || new Date().toISOString(),
    lastPrice: toNumber(valueFrom(data, ['lastPrice', 'price', 'latestPrice'])),
    bid,
    ask
  };
}

function normalizeSide(value) {
  const text = String(value || '').trim().toLowerCase();
  if (['b', 'buy', '1', 'bid', '主动买入', '买入', '外盘'].includes(text)) return 'buy';
  if (['s', 'sell', '2', 'ask', '主动卖出', '卖出', '内盘'].includes(text)) return 'sell';
  return 'neutral';
}

function normalizeTradeRows(payload) {
  const data = unwrapPayload(payload);
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  return data.trades || data.ticks || data.items || data.list || [];
}

function normalizeTrades(payload, options = {}) {
  const config = options.config || getLevel2Config();
  const multiplier = config.volumeUnit === 'lot' ? 100 : 1;
  return normalizeTradeRows(payload).map(function (item, index) {
    const price = toNumber(valueFrom(item, ['price', 'tradePrice', '成交价']));
    const volume = toNumber(valueFrom(item, ['volume', 'vol', 'qty', 'quantity', 'tradeQty', '成交量']));
    const amount = roundMoney(toNumber(valueFrom(item, ['amount', 'tradeAmount', '成交额']), price * volume * multiplier));
    return {
      sequence: valueFrom(item, ['sequence', 'seq', 'id'], index + 1),
      time: valueFrom(item, ['time', 'tradeTime', 'datetime', '成交时间'], ''),
      price,
      volume,
      amount,
      side: normalizeSide(valueFrom(item, ['side', 'bs', 'direction', 'type', 'buySellFlag'], 'neutral')),
      orderId: valueFrom(item, ['orderId', 'orderNo'], '')
    };
  }).filter(function (trade) {
    return trade.price > 0 || trade.volume > 0 || trade.amount > 0;
  });
}

function calculateLargeOrderStats(trades, options = {}) {
  const threshold = toNumber(options.threshold, DEFAULT_LARGE_ORDER_THRESHOLD);
  const stats = {
    threshold,
    tradeCount: trades.length,
    buyCount: 0,
    sellCount: 0,
    neutralCount: 0,
    totalAmount: 0,
    buyAmount: 0,
    sellAmount: 0,
    neutralAmount: 0,
    largeTradeCount: 0,
    largeBuyCount: 0,
    largeSellCount: 0,
    largeNeutralCount: 0,
    largeAmount: 0,
    largeBuyAmount: 0,
    largeSellAmount: 0,
    largeNeutralAmount: 0,
    largeNetAmount: 0,
    largeAmountRatio: 0,
    topLargeTrades: []
  };

  trades.forEach(function (trade) {
    const amount = toNumber(trade.amount);
    stats.totalAmount += amount;
    if (trade.side === 'buy') {
      stats.buyCount += 1;
      stats.buyAmount += amount;
    } else if (trade.side === 'sell') {
      stats.sellCount += 1;
      stats.sellAmount += amount;
    } else {
      stats.neutralCount += 1;
      stats.neutralAmount += amount;
    }

    if (amount >= threshold) {
      stats.largeTradeCount += 1;
      stats.largeAmount += amount;
      if (trade.side === 'buy') {
        stats.largeBuyCount += 1;
        stats.largeBuyAmount += amount;
      } else if (trade.side === 'sell') {
        stats.largeSellCount += 1;
        stats.largeSellAmount += amount;
      } else {
        stats.largeNeutralCount += 1;
        stats.largeNeutralAmount += amount;
      }
      stats.topLargeTrades.push(trade);
    }
  });

  stats.largeNetAmount = stats.largeBuyAmount - stats.largeSellAmount;
  [
    'totalAmount',
    'buyAmount',
    'sellAmount',
    'neutralAmount',
    'largeAmount',
    'largeBuyAmount',
    'largeSellAmount',
    'largeNeutralAmount',
    'largeNetAmount'
  ].forEach(function (key) {
    stats[key] = roundMoney(stats[key]);
  });
  stats.largeAmountRatio = stats.totalAmount ? Number((stats.largeAmount / stats.totalAmount).toFixed(4)) : 0;
  stats.topLargeTrades = stats.topLargeTrades
    .sort(function (a, b) { return b.amount - a.amount; })
    .slice(0, 10);
  return stats;
}

async function getDepth(code, env = process.env) {
  const config = getLevel2Config(env);
  const result = await requestProvider(config.depthEndpoint, { code: normalizeCode(code) }, env);
  return normalizeDepth(result.data, { code, provider: result.config.provider });
}

async function getTrades(code, options = {}, env = process.env) {
  const config = getLevel2Config(env);
  const limit = toNumber(options.limit, 200);
  const result = await requestProvider(config.tradesEndpoint, { code: normalizeCode(code), limit }, env);
  return {
    code: normalizeCode(code),
    provider: result.config.provider,
    timestamp: new Date().toISOString(),
    trades: normalizeTrades(result.data, { config: result.config })
  };
}

async function getLargeOrderStats(code, options = {}, env = process.env) {
  const tradesResult = await getTrades(code, options, env);
  const threshold = toNumber(options.threshold, getLevel2Config(env).largeOrderThreshold);
  return {
    code: normalizeCode(code),
    provider: tradesResult.provider,
    timestamp: tradesResult.timestamp,
    stats: calculateLargeOrderStats(tradesResult.trades, { threshold })
  };
}

module.exports = {
  DEFAULT_LARGE_ORDER_THRESHOLD,
  getLevel2Config,
  getPublicStatus,
  getEditableConfig,
  saveLevel2Config,
  normalizeDepth,
  normalizeTrades,
  calculateLargeOrderStats,
  getDepth,
  getTrades,
  getLargeOrderStats
};
