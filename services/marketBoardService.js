const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');
const marketOverview = require('./marketOverviewService');
const { STATIC_COMPARISON_DEFINITIONS } = require('./marketComparisonService');

const SCHEMA = 'webstock.market-boards/v1';
const TAXONOMIES = ['index', 'industry', 'concept', 'region', 'style'];
const CONSTITUENT_TAXONOMIES = ['industry', 'concept', 'region'];
const REMOTE_TAXONOMIES = {
  industry: 'm:90+t:2+f:!50',
  concept: 'm:90+t:3+f:!50',
  region: 'm:90+t:1+f:!50'
};
const EASTMONEY_TOKEN = 'bd1d9ddb04089700cf9c27f6f7426281';
const EASTMONEY_HOSTS = [
  'https://push2.eastmoney.com',
  'https://41.push2.eastmoney.com',
  'https://33.push2.eastmoney.com'
];
const PAGE_SIZE = 500;
const SINA_NODES_URL = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodes';
const SINA_COUNT_URL = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeStockCount';
const SINA_DATA_URL = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData';
const SINA_PAGE_SIZE = 100;
const MAX_SINA_CONSTITUENTS = 10000;
const MAX_SINA_BOARDS = 2048;
const MAX_BOARD_CONSTITUENTS = 10000;
const SINA_TAXONOMY_CONFIG = {
  industry: {
    labels: ['\u7533\u4e07\u4e8c\u7ea7', '\u65b0\u6d6a\u884c\u4e1a'],
    nodePattern: /^(?:sw2_\d+|new_[a-z0-9_]+)$/i,
    provider: 'sina-public-industry'
  },
  concept: {
    labels: ['\u70ed\u95e8\u6982\u5ff5', '\u6982\u5ff5\u677f\u5757'],
    nodePattern: /^(?:chgn_\d+|gn_[a-z0-9_]+)$/i,
    provider: 'sina-public-concept'
  },
  region: {
    labels: ['\u5730\u57df\u677f\u5757'],
    nodePattern: /^diyu_\d+$/i,
    provider: 'sina-public-region'
  }
};
const SINA_SNAPSHOT_PRIORITIES = {
  concept: [
    '\u5546\u4e1a\u822a\u5929', '\u6d88\u8d39\u7535\u5b50', '\u5c0f\u91d1\u5c5e', '\u6709\u8272\u94dc', '\u6709\u8272\u94dd', '\u6709\u8272\u950c',
    '\u5148\u8fdb\u5c01\u88c5', '\u534a\u5bfc\u4f53\u8bbe\u5907', '\u534a\u5bfc\u4f53\u6750\u6599', '\u5149\u82af\u7247', '\u5149\u901a\u4fe1', 'PCB',
    '\u7b97\u529b\u82af\u7247', '\u7269\u7406AI', '\u5177\u8eab\u667a\u80fd', '\u4eba\u5f62\u673a\u5668\u4eba', '\u4f4e\u7a7a\u7ecf\u6d4e', '\u521b\u65b0\u836f'
  ],
  industry: [
    '\u6d88\u8d39\u7535\u5b50', '\u5c0f\u91d1\u5c5e', '\u534a\u5bfc\u4f53', '\u901a\u4fe1\u8bbe\u5907', '\u822a\u5929\u88c5\u5907',
    '\u80fd\u6e90\u91d1\u5c5e', '\u5de5\u4e1a\u91d1\u5c5e', '\u8d35\u91d1\u5c5e', '\u5149\u5b66\u5149\u7535\u5b50', '\u8f6f\u4ef6\u5f00\u53d1'
  ]
};

function defaultCachePath() {
  const databasePath = process.env.WEBSTOCK_DB_PATH || path.join(__dirname, '..', 'data', 'webstock.db');
  return process.env.WEBSTOCK_BOARD_CACHE_PATH || path.join(path.dirname(databasePath), 'market-board-catalog.json');
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '' || value === '-') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function cleanText(value, maximum) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum || 80);
}

function unwrapResponse(value) {
  let payload = value && Object.prototype.hasOwnProperty.call(value, 'data') ? value.data : value;
  if (typeof payload === 'string') {
    const text = payload.trim();
    try { payload = JSON.parse(text); } catch (error) {}
  }
  return payload;
}

function cleanReason(error) {
  const value = String(error && error.message || error || 'provider-request-failed')
    .replace(/[\r\n\t]+/g, ' ').trim();
  return value.slice(0, 240) || 'provider-request-failed';
}

function taxonomyInput(value) {
  const taxonomy = String(value || 'all').trim().toLowerCase();
  if (taxonomy === 'all') return TAXONOMIES.slice();
  if (!TAXONOMIES.includes(taxonomy)) {
    const error = new Error('Unsupported market board taxonomy');
    error.code = 'MARKET_BOARD_TAXONOMY_INVALID';
    throw error;
  }
  return [taxonomy];
}

function constituentInput(input) {
  input = input || {};
  const taxonomy = cleanText(input.taxonomy, 24).toLowerCase();
  if (!CONSTITUENT_TAXONOMIES.includes(taxonomy)) {
    const error = new Error('Unsupported market board taxonomy');
    error.code = 'MARKET_BOARD_TAXONOMY_INVALID';
    throw error;
  }
  const rawCode = cleanText(input.code, 64);
  const eastmoneyCode = /^BK\d{4}$/i.test(rawCode) ? rawCode.toUpperCase() : '';
  const sinaConfig = SINA_TAXONOMY_CONFIG[taxonomy];
  const sinaCode = !eastmoneyCode && sinaConfig && sinaConfig.nodePattern.test(rawCode)
    ? rawCode.toLowerCase() : '';
  if (!eastmoneyCode && !sinaCode) {
    const error = new Error('Invalid market board code');
    error.code = 'MARKET_BOARD_CODE_INVALID';
    throw error;
  }
  return { code: eastmoneyCode || sinaCode, taxonomy, refresh: input.refresh === true, source: sinaCode ? 'sina' : 'eastmoney' };
}

function capabilitiesFor(taxonomy) {
  if (taxonomy === 'style') {
    return { catalog: false, snapshot: false, daily: false, intraday: false, capitalFlow: false };
  }
  if (taxonomy === 'index') {
    return { catalog: true, snapshot: true, daily: true, intraday: true, capitalFlow: false };
  }
  return { catalog: true, snapshot: true, constituents: true, daily: true, intraday: false, capitalFlow: true };
}

function sinaBoardCapabilities() {
  return { catalog: true, snapshot: true, constituents: true, daily: false, intraday: false, capitalFlow: false };
}

function isSinaBoardProvider(provider) {
  return /^sina-public-(?:industry|concept|region)$/.test(String(provider || ''));
}

function mapStaticDefinition(definition, fetchedAt) {
  return {
    key: definition.key,
    code: definition.code,
    name: definition.name,
    provider: definition.provider || 'curated-public-index',
    providerId: definition.providerId || '',
    taxonomy: 'index',
    kind: definition.kind || 'index',
    aliases: Array.isArray(definition.aliases) ? definition.aliases : [],
    capabilities: Object.assign(capabilitiesFor('index'), definition.capabilities || {}),
    status: 'available',
    observedAt: null,
    fetchedAt,
    stale: false,
    coverageComplete: false,
    reason: 'curated-index-whitelist'
  };
}

function mapBoardRow(row, taxonomy, metadata, includeMarketFields) {
  const code = String(row && row.f12 || '').trim().toUpperCase();
  const name = cleanText(row && row.f14, 80);
  if (!/^BK\d+$/i.test(code) || !name) return null;
  const item = {
    key: 'eastmoney-' + taxonomy + ':' + code,
    code,
    name,
    provider: 'eastmoney-public-board',
    providerId: '90.' + code,
    taxonomy,
    kind: taxonomy,
    aliases: [],
    capabilities: capabilitiesFor(taxonomy),
    status: 'available',
    observedAt: null,
    fetchedAt: metadata.fetchedAt,
    stale: false,
    coverageComplete: metadata.coverageComplete,
    reason: metadata.coverageComplete ? null : 'provider-reported-total-not-fully-covered'
  };
  if (!includeMarketFields) return item;
  item.price = finiteNumber(row.f2);
  item.changePct = finiteNumber(row.f3);
  item.changeAmount = finiteNumber(row.f4);
  item.volume = finiteNumber(row.f5);
  item.amount = finiteNumber(row.f6);
  item.totalMarketValue = finiteNumber(row.f20);
  item.mainNetInflow = finiteNumber(row.f62);
  item.capitalFlowClass = 'provider-classified';
  if ([item.price, item.changePct, item.amount, item.mainNetInflow].every(value => value === null)) {
    item.status = 'unavailable';
    item.reason = 'provider-returned-no-market-observation';
  }
  return item;
}

function mapConstituentRow(row, board, metadata) {
  const code = cleanText(row && row.f12, 16);
  const name = cleanText(row && row.f14, 80);
  if (!/^\d{6}$/.test(code) || !name) return null;
  const netFlow = finiteNumber(row.f62);
  const marketCap = finiteNumber(row.f20);
  const item = {
    key: 'stock:' + code,
    code,
    name,
    provider: 'eastmoney-public-board',
    providerId: code,
    taxonomy: 'stock',
    kind: 'constituent',
    boardCode: board.code,
    boardTaxonomy: board.taxonomy,
    status: 'available',
    observedAt: null,
    fetchedAt: metadata.fetchedAt,
    stale: false,
    coverageComplete: metadata.coverageComplete,
    reason: metadata.coverageComplete ? null : 'provider-reported-total-not-fully-covered',
    price: finiteNumber(row.f2),
    changePct: finiteNumber(row.f3),
    changeAmount: finiteNumber(row.f4),
    volume: finiteNumber(row.f5),
    amount: finiteNumber(row.f6),
    netFlow,
    mainNetInflow: netFlow,
    marketCap,
    totalMarketValue: marketCap,
    capitalFlowClass: netFlow === null ? 'unavailable' : 'provider-classified'
  };
  if ([item.price, item.changePct, item.amount, item.netFlow, item.marketCap]
    .every(value => value === null)) {
    item.status = 'unavailable';
    item.reason = 'provider-returned-no-market-observation';
  }
  return item;
}

function mapSinaConstituentRow(row, board, metadata) {
  const rawCode = cleanText(row && (row.code || row.symbol), 24).toLowerCase();
  const match = rawCode.match(/(\d{6})$/);
  const code = match ? match[1] : '';
  const name = cleanText(row && row.name, 80);
  if (!code || !name) return null;
  const marketCapWan = finiteNumber(row && row.mktcap);
  const item = {
    key: 'stock:' + code,
    code,
    name,
    provider: metadata.provider,
    providerId: code,
    taxonomy: 'stock',
    kind: 'constituent',
    boardCode: board.code,
    boardTaxonomy: board.taxonomy,
    status: 'available',
    observedAt: null,
    fetchedAt: metadata.fetchedAt,
    stale: false,
    coverageComplete: metadata.coverageComplete,
    reason: metadata.coverageComplete ? null : 'provider-reported-total-not-fully-covered',
    price: finiteNumber(row && row.trade),
    changePct: finiteNumber(row && row.changepercent),
    changeAmount: finiteNumber(row && row.pricechange),
    volume: finiteNumber(row && row.volume),
    amount: finiteNumber(row && row.amount),
    netFlow: null,
    mainNetInflow: null,
    marketCap: marketCapWan === null ? null : marketCapWan * 10000,
    totalMarketValue: marketCapWan === null ? null : marketCapWan * 10000,
    capitalFlowClass: 'unavailable'
  };
  if ([item.price, item.changePct, item.amount, item.marketCap].every(value => value === null)) {
    item.status = 'unavailable';
    item.reason = 'provider-returned-no-market-observation';
  }
  return item;
}

function findSinaBoardRows(payload, label) {
  const visited = new Set();
  function visit(value, depth) {
    if (!Array.isArray(value) || depth > 12 || visited.has(value)) return null;
    visited.add(value);
    if (cleanText(value[0], 40) === label && Array.isArray(value[1])) return value[1];
    for (const child of value) {
      const found = visit(child, depth + 1);
      if (found) return found;
    }
    return null;
  }
  return visit(unwrapResponse(payload), 0);
}

function parseSinaBoardCatalog(payload, taxonomy, fetchedAt) {
  const config = SINA_TAXONOMY_CONFIG[taxonomy];
  if (!config) throw new Error('Unsupported Sina board taxonomy');
  let declaredRows = null;
  let classification = '';
  for (const label of config.labels) {
    const candidate = findSinaBoardRows(payload, label);
    if (candidate && candidate.length) {
      declaredRows = candidate;
      classification = label;
      break;
    }
  }
  if (!declaredRows || !declaredRows.length) throw new Error('Sina ' + taxonomy + ' catalog is unavailable');
  if (declaredRows.length > MAX_SINA_BOARDS) throw new Error('Sina ' + taxonomy + ' catalog exceeds safety limit');
  const seen = new Set();
  const descriptors = [];
  for (const row of declaredRows) {
    const name = cleanText(Array.isArray(row) ? row[0] : '', 80);
    const node = cleanText(Array.isArray(row) ? row[2] : '', 64).toLowerCase();
    if (!name || !config.nodePattern.test(node) || seen.has(node)) continue;
    seen.add(node);
    descriptors.push({ name, node, taxonomy, provider: config.provider, classification });
  }
  if (!descriptors.length) throw new Error('Sina ' + taxonomy + ' catalog returned no valid nodes');
  const coverageComplete = descriptors.length === declaredRows.length;
  const reason = coverageComplete ? null : 'Sina ' + taxonomy + ' catalog contained invalid or duplicate nodes';
  const items = descriptors.map(function(descriptor) {
    return {
      key: 'sina-' + taxonomy + ':' + descriptor.node,
      code: descriptor.node,
      name: descriptor.name,
      provider: config.provider,
      providerId: descriptor.node,
      taxonomy,
      kind: taxonomy,
      aliases: [],
      capabilities: sinaBoardCapabilities(),
      status: 'available',
      observedAt: null,
      fetchedAt,
      stale: false,
      coverageComplete,
      reason,
      classification
    };
  });
  return { descriptors, items, coverageComplete, reason, declaredCount: declaredRows.length, classification };
}

function normalizeSinaStockRows(payload) {
  const value = unwrapResponse(payload);
  return Array.isArray(value) ? value : [];
}

function aggregateSinaBoardRows(descriptor, rows, expectedCount, fetchedAt) {
  const seen = new Set();
  const stocks = [];
  for (const row of rows) {
    const rawCode = cleanText(row && (row.code || row.symbol), 24).toLowerCase();
    const matched = rawCode.match(/(\d{6})$/);
    if (!matched || seen.has(matched[1])) continue;
    seen.add(matched[1]);
    stocks.push(row);
  }
  if (stocks.length !== expectedCount) {
    throw new Error('Sina board constituent coverage incomplete for ' + descriptor.node);
  }

  let amount = 0;
  let volume = 0;
  let totalMarketValue = 0;
  let currentFloatValue = 0;
  let previousFloatValue = 0;
  let hasTotalMarketValue = true;
  for (const stock of stocks) {
    const stockAmount = finiteNumber(stock.amount);
    const stockVolume = finiteNumber(stock.volume);
    const floatMarketValue = finiteNumber(stock.nmc);
    const stockTotalMarketValue = finiteNumber(stock.mktcap);
    const changePct = finiteNumber(stock.changepercent);
    if (stockAmount === null || stockAmount < 0 || stockVolume === null || stockVolume < 0 ||
        floatMarketValue === null || floatMarketValue < 0 || changePct === null || changePct <= -100) {
      throw new Error('Sina board constituent metrics incomplete for ' + descriptor.node);
    }
    amount += stockAmount;
    volume += stockVolume;
    currentFloatValue += floatMarketValue;
    previousFloatValue += floatMarketValue / (1 + changePct / 100);
    if (stockTotalMarketValue === null || stockTotalMarketValue < 0) {
      hasTotalMarketValue = false;
    } else {
      totalMarketValue += stockTotalMarketValue * 10000;
    }
    if (![amount, volume, currentFloatValue, previousFloatValue].every(Number.isFinite) ||
        (hasTotalMarketValue && !Number.isFinite(totalMarketValue))) {
      throw new Error('Sina board aggregate exceeds numeric safety limits for ' + descriptor.node);
    }
  }
  if (!(currentFloatValue > 0) || !(previousFloatValue > 0)) {
    throw new Error('Sina board market-cap weights unavailable for ' + descriptor.node);
  }

  const boardChangePct = (currentFloatValue / previousFloatValue - 1) * 100;
  if (!Number.isFinite(boardChangePct)) {
    throw new Error('Sina board change calculation is unavailable for ' + descriptor.node);
  }
  const taxonomy = descriptor.taxonomy || 'industry';
  const provider = descriptor.provider || 'sina-public-' + taxonomy;
  return {
    key: 'sina-' + taxonomy + ':' + descriptor.node,
    code: descriptor.node,
    name: descriptor.name,
    provider,
    providerId: descriptor.node,
    taxonomy,
    kind: taxonomy,
    aliases: [],
    capabilities: sinaBoardCapabilities(),
    status: 'available',
    observedAt: null,
    fetchedAt,
    stale: false,
    coverageComplete: true,
    reason: null,
    price: null,
    changePct: boardChangePct,
    changeAmount: null,
    volume,
    amount,
    totalMarketValue: hasTotalMarketValue ? totalMarketValue : null,
    mainNetInflow: null,
    capitalFlowClass: 'unavailable',
    constituentCount: stocks.length,
    expectedConstituentCount: expectedCount,
    calculationBasis: 'full-constituent-float-market-cap-weighted',
    amountBasis: 'full-constituent-sum',
    classification: descriptor.classification || null
  };
}

function readCache(cachePath) {
  try {
    const payload = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    return payload && payload.version === 1 && payload.taxonomies && typeof payload.taxonomies === 'object'
      ? payload : { version: 1, taxonomies: {} };
  } catch (error) {
    return { version: 1, taxonomies: {} };
  }
}

function writeCache(cachePath, payload) {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const temporary = cachePath + '.tmp-' + process.pid + '-' + Date.now();
  try {
    fs.writeFileSync(temporary, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(temporary, cachePath);
  } finally {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch (error) {}
  }
}

function sanitizeCachedItem(item, taxonomy) {
  if (!item || typeof item !== 'object') return null;
  const provider = isSinaBoardProvider(item.provider)
    ? item.provider : (item.provider === 'eastmoney-public-board' ? 'eastmoney-public-board' : '');
  const name = cleanText(item.name, 80);
  if (!provider || !name) return null;
  let code;
  let providerId;
  let capabilities;
  let key;
  if (isSinaBoardProvider(provider)) {
    const config = SINA_TAXONOMY_CONFIG[taxonomy];
    providerId = cleanText(item.providerId || item.code, 64).toLowerCase();
    if (!config || provider !== config.provider || !config.nodePattern.test(providerId)) return null;
    code = providerId;
    key = 'sina-' + taxonomy + ':' + providerId;
    capabilities = sinaBoardCapabilities();
  } else {
    code = cleanText(item.code, 24).toUpperCase();
    if (!/^BK\d+$/i.test(code)) return null;
    providerId = '90.' + code;
    key = 'eastmoney-' + taxonomy + ':' + code;
    capabilities = capabilitiesFor(taxonomy);
  }
  return {
    key,
    code,
    name,
    provider,
    providerId,
    taxonomy,
    kind: taxonomy,
    aliases: Array.isArray(item.aliases) ? item.aliases.slice(0, 20).map(value => cleanText(value, 80)).filter(Boolean) : [],
    capabilities,
    status: 'available',
    observedAt: null,
    fetchedAt: cleanText(item.fetchedAt, 40) || null,
    stale: item.stale === true,
    coverageComplete: item.coverageComplete === true,
    reason: item.reason ? cleanText(item.reason, 240) : null,
    classification: item.classification ? cleanText(item.classification, 40) : null
  };
}

function cachedTaxonomy(cachePath, taxonomy) {
  const cache = readCache(cachePath);
  const entry = cache.taxonomies[taxonomy];
  if (!entry || !Array.isArray(entry.items) || !entry.items.length) return null;
  const items = entry.items.map(item => sanitizeCachedItem(item, taxonomy)).filter(Boolean);
  if (!items.length) return null;
  const providers = Array.from(new Set(items.map(item => item.provider)));
  return {
    provider: providers.length === 1 ? providers[0] : 'mixed-public',
    taxonomy,
    fetchedAt: cleanText(entry.fetchedAt, 40) || null,
    coverageComplete: entry.coverageComplete === true && items.length === entry.items.length,
    items
  };
}

function persistTaxonomy(cachePath, taxonomy, items, fetchedAt, coverageComplete, provider) {
  const cache = readCache(cachePath);
  cache.savedAt = fetchedAt;
  cache.taxonomies[taxonomy] = {
    provider: provider || 'eastmoney-public-board',
    taxonomy,
    fetchedAt,
    coverageComplete: coverageComplete === true,
    items: items.map(function(item) {
      const copy = Object.assign({}, item);
      delete copy.price;
      delete copy.changePct;
      delete copy.changeAmount;
      delete copy.volume;
      delete copy.amount;
      delete copy.totalMarketValue;
      delete copy.mainNetInflow;
      delete copy.capitalFlowClass;
      delete copy.constituentCount;
      delete copy.expectedConstituentCount;
      delete copy.calculationBasis;
      delete copy.amountBasis;
      return copy;
    })
  };
  writeCache(cachePath, cache);
}

function coverageRecord(input) {
  return {
    provider: input.provider,
    taxonomy: input.taxonomy,
    capabilities: input.capabilities || capabilitiesFor(input.taxonomy),
    status: input.status,
    count: Number(input.count) || 0,
    observedAt: input.observedAt || null,
    fetchedAt: input.fetchedAt,
    stale: input.stale === true,
    coverageComplete: input.coverageComplete === true,
    reason: input.reason || null,
    lastSuccessfulAt: input.lastSuccessfulAt || null
  };
}

function aggregateResult(kind, taxonomies, groups, fetchedAt, query) {
  let items = groups.flatMap(group => group.items || []);
  const needle = cleanText(query, 80).toLowerCase();
  if (needle) {
    items = items.filter(function(item) {
      return [item.name, item.code, item.key].concat(item.aliases || []).some(function(value) {
        return String(value || '').toLowerCase().includes(needle);
      });
    });
  }
  const coverage = groups.map(group => group.coverage);
  const usable = coverage.filter(item => item.status !== 'unavailable');
  const allFreshComplete = coverage.length > 0 && coverage.every(function(item) {
    return item.status === 'available' && item.stale !== true && item.coverageComplete === true;
  });
  const status = usable.length === 0 ? 'unavailable' : (allFreshComplete ? 'available' : 'partial');
  const reasons = Array.from(new Set(coverage.map(item => item.reason).filter(Boolean)));
  const providers = Array.from(new Set(coverage.map(item => item.provider)
    .filter(provider => provider && provider !== 'unavailable')));
  return {
    schema: SCHEMA,
    kind,
    status,
    provider: providers.length === 1 ? providers[0] : 'mixed-public',
    taxonomy: taxonomies.length === 1 ? taxonomies[0] : 'mixed',
    capabilities: {
      catalog: kind === 'catalog',
      snapshot: kind === 'snapshot',
      daily: items.some(item => item.capabilities && item.capabilities.daily === true),
      intraday: items.some(item => item.capabilities && item.capabilities.intraday === true),
      capitalFlow: items.some(item => item.capabilities && item.capabilities.capitalFlow === true)
    },
    observedAt: null,
    fetchedAt,
    stale: coverage.some(item => item.stale === true),
    coverageComplete: coverage.length > 0 && coverage.every(item => item.coverageComplete === true),
    reason: reasons.length ? reasons.join('; ') : null,
    coverage,
    items
  };
}

function createMarketBoardService(options) {
  options = options || {};
  const staticDefinitions = options.staticDefinitions || STATIC_COMPARISON_DEFINITIONS;
  const cachePath = options.cachePath || defaultCachePath();
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const eastmoneyTimeoutMs = boundedNumber(options.eastmoneyTimeoutMs, 2500, 250, 5000);
  const sinaTimeoutMs = boundedNumber(options.sinaTimeoutMs, 2500, 250, 5000);
  const sinaDeadlineMs = boundedNumber(options.sinaDeadlineMs, 6500, 100, 8000);
  const sinaConcurrency = Math.floor(boundedNumber(options.sinaConcurrency, 12, 1, 24));
  const catalogTtlMs = Number.isFinite(options.catalogCacheTtlMs)
    ? Math.max(0, options.catalogCacheTtlMs) : 30 * 60 * 1000;
  const snapshotTtlMs = Number.isFinite(options.snapshotCacheTtlMs)
    ? Math.max(0, options.snapshotCacheTtlMs) : 5 * 60 * 1000;
  const memoryCatalog = new Map();
  const memorySnapshot = new Map();
  const memoryConstituents = new Map();
  const pendingCatalog = new Map();
  const pendingSnapshot = new Map();
  const pendingConstituents = new Map();

  function parseEastmoneyResponse(response) {
    const data = response && response.data && response.data.data;
    const rows = data && Array.isArray(data.diff) ? data.diff : [];
    if (!rows.length) throw new Error('provider returned no board rows');
    return { rows, total: finiteNumber(data.total) };
  }

  async function requestPage(taxonomy, mode, page) {
    const fields = mode === 'snapshot'
      ? 'f2,f3,f4,f5,f6,f12,f14,f20,f62'
      : 'f12,f14';
    const params = new URLSearchParams({
      pn: String(page),
      pz: String(PAGE_SIZE),
      po: '1',
      np: '1',
      ut: EASTMONEY_TOKEN,
      fltt: '2',
      invt: '2',
      fid: 'f3',
      fs: REMOTE_TAXONOMIES[taxonomy],
      fields
    });
    const injected = mode === 'snapshot' ? options.snapshotGet : options.catalogGet;
    if (typeof injected === 'function') {
      const url = EASTMONEY_HOSTS[0] + '/api/qt/clist/get?' + params.toString();
      try {
        return parseEastmoneyResponse(await injected(url));
      } catch (error) {
        throw new Error(cleanReason(error));
      }
    }

    const failures = [];
    const getter = typeof options.eastmoneyHttpGet === 'function' ? options.eastmoneyHttpGet : axios.get;
    const attempts = EASTMONEY_HOSTS.map(async function(host) {
      const url = host + '/api/qt/clist/get?' + params.toString();
      try {
        const response = options.marketData && typeof options.marketData.get === 'function'
          ? await options.marketData.get('market-board-' + mode + ':' + taxonomy + ':' + page + ':' + host, url, {
            timeout: eastmoneyTimeoutMs,
            headers: { Referer: 'https://quote.eastmoney.com/', 'User-Agent': 'Mozilla/5.0 WebStock' }
          })
          : await getter(url, {
            timeout: eastmoneyTimeoutMs,
            headers: { Referer: 'https://quote.eastmoney.com/', 'User-Agent': 'Mozilla/5.0 WebStock' }
          });
        return parseEastmoneyResponse(response);
      } catch (error) {
        failures.push(cleanReason(error));
        throw error;
      }
    });
    try {
      return await Promise.any(attempts);
    } catch (error) {
      throw new Error(failures.join(' | ') || 'Eastmoney board provider unavailable');
    }
  }

  async function fetchRemoteTaxonomy(taxonomy, mode) {
    const rows = [];
    const seen = new Set();
    let total = null;
    let page = 1;
    const deadline = Date.now() + 8000;
    while (page <= 200 && Date.now() <= deadline) {
      const result = await requestPage(taxonomy, mode, page);
      if (total === null && result.total !== null) {
        if (!Number.isInteger(result.total) || result.total < 0 || result.total > 10000) throw new Error('provider returned invalid board total');
        total = result.total;
      }
      let added = 0;
      result.rows.forEach(function(row) {
        const code = String(row && row.f12 || '').trim().toUpperCase();
        if (!code || seen.has(code)) return;
        seen.add(code);
        rows.push(row);
        added += 1;
      });
      if (rows.length > 10000) throw new Error('provider board rows exceed safety limit');
      if ((total !== null && rows.length >= total) || (total === null && result.rows.length < PAGE_SIZE) || added === 0) break;
      page += 1;
    }
    const fetchedAt = new Date(now()).toISOString();
    const validRows = rows.filter(function(row) {
      return /^BK\d+$/i.test(String(row && row.f12 || '').trim()) && String(row && row.f14 || '').trim();
    });
    const coverageComplete = total !== null && validRows.length === total;
    const items = validRows.map(row => mapBoardRow(row, taxonomy, { fetchedAt, coverageComplete }, mode === 'snapshot'))
      .filter(Boolean);
    if (!items.length) throw new Error('provider returned no valid board rows');
    return {
      items,
      fetchedAt,
      coverageComplete,
      provider: 'eastmoney-public-board',
      reason: coverageComplete ? null : 'provider-reported-total-not-fully-covered'
    };
  }

  function parseConstituentResponse(response) {
    const data = response && response.data && response.data.data;
    const rows = data && Array.isArray(data.diff) ? data.diff : [];
    if (!rows.length) throw new Error('provider returned no constituent rows');
    if (rows.length > PAGE_SIZE) throw new Error('provider constituent page exceeds safety limit');
    return { rows, total: finiteNumber(data.total) };
  }

  async function requestConstituentPage(boardCode, page) {
    const params = new URLSearchParams({
      pn: String(page),
      pz: String(PAGE_SIZE),
      po: '1',
      np: '1',
      ut: EASTMONEY_TOKEN,
      fltt: '2',
      invt: '2',
      fid: 'f12',
      fs: 'b:' + boardCode,
      fields: 'f2,f3,f4,f5,f6,f12,f14,f20,f62'
    });
    if (typeof options.constituentsGet === 'function') {
      const url = EASTMONEY_HOSTS[0] + '/api/qt/clist/get?' + params.toString();
      try {
        return parseConstituentResponse(await options.constituentsGet(url));
      } catch (error) {
        throw new Error(cleanReason(error));
      }
    }

    const failures = [];
    const getter = typeof options.eastmoneyHttpGet === 'function' ? options.eastmoneyHttpGet : axios.get;
    const attempts = EASTMONEY_HOSTS.map(async function(host) {
      const url = host + '/api/qt/clist/get?' + params.toString();
      try {
        const response = options.marketData && typeof options.marketData.get === 'function'
          ? await options.marketData.get('market-board-constituents:' + boardCode + ':' + page + ':' + host, url, {
            timeout: eastmoneyTimeoutMs,
            headers: { Referer: 'https://quote.eastmoney.com/', 'User-Agent': 'Mozilla/5.0 WebStock' }
          })
          : await getter(url, {
            timeout: eastmoneyTimeoutMs,
            headers: { Referer: 'https://quote.eastmoney.com/', 'User-Agent': 'Mozilla/5.0 WebStock' }
          });
        return parseConstituentResponse(response);
      } catch (error) {
        failures.push(cleanReason(error));
        throw error;
      }
    });
    try {
      return await Promise.any(attempts);
    } catch (error) {
      throw new Error(failures.join(' | ') || 'Eastmoney board constituents unavailable');
    }
  }

  function boardIdentity(input) {
    const memory = memoryCatalog.get(input.taxonomy);
    const memoryItem = memory && memory.value && Array.isArray(memory.value.items)
      ? memory.value.items.find(item => item.code === input.code) : null;
    if (memoryItem) return { code: input.code, name: memoryItem.name, taxonomy: input.taxonomy };
    const snapshot = memorySnapshot.get(input.taxonomy);
    const snapshotItem = snapshot && snapshot.value && Array.isArray(snapshot.value.items)
      ? snapshot.value.items.find(item => item.code === input.code) : null;
    if (snapshotItem) return { code: input.code, name: snapshotItem.name, taxonomy: input.taxonomy };
    const saved = cachedTaxonomy(cachePath, input.taxonomy);
    const savedItem = saved && saved.items.find(item => item.code === input.code);
    return {
      code: input.code,
      name: savedItem ? savedItem.name : null,
      taxonomy: input.taxonomy
    };
  }

  async function fetchEastmoneyConstituents(input) {
    const rows = [];
    const seen = new Set();
    let total = null;
    let page = 1;
    const deadline = Date.now() + 8000;
    while (page <= 200 && Date.now() <= deadline) {
      const response = await requestConstituentPage(input.code, page);
      if (total === null && response.total !== null) {
        if (!Number.isInteger(response.total) || response.total < 0 || response.total > MAX_BOARD_CONSTITUENTS) {
          throw new Error('provider returned invalid constituent total');
        }
        total = response.total;
      }
      let added = 0;
      for (const row of response.rows) {
        const code = cleanText(row && row.f12, 16);
        if (!/^\d{6}$/.test(code) || seen.has(code)) continue;
        seen.add(code);
        rows.push(row);
        added += 1;
      }
      if (rows.length > MAX_BOARD_CONSTITUENTS) throw new Error('provider constituent rows exceed safety limit');
      if ((total !== null && rows.length >= total) || (total === null && response.rows.length < PAGE_SIZE) || added === 0) break;
      page += 1;
    }
    const fetchedAt = new Date(now()).toISOString();
    const coverageComplete = total !== null && rows.length === total;
    const coverageReason = coverageComplete ? null : 'provider-reported-total-not-fully-covered';
    const board = boardIdentity(input);
    const items = rows.map(row => mapConstituentRow(row, board, { fetchedAt, coverageComplete }))
      .filter(Boolean);
    if (!items.length) throw new Error('provider returned no valid constituent rows');
    const available = items.filter(item => item.status === 'available').length;
    const reason = coverageReason || (available === items.length
      ? null : 'provider-returned-incomplete-market-observations');
    return {
      schema: SCHEMA,
      kind: 'constituents',
      status: coverageComplete && available === items.length ? 'available' : 'partial',
      provider: 'eastmoney-public-board',
      taxonomy: input.taxonomy,
      board: Object.assign({}, board, {
        provider: 'eastmoney-public-board', providerId: '90.' + input.code
      }),
      capabilities: { snapshot: true, capitalFlow: true },
      observedAt: null,
      fetchedAt,
      stale: false,
      coverageComplete,
      reason,
      items
    };
  }

  function assertSinaActive(context) {
    if (!context) return;
    if (context.expired || Date.now() >= context.deadlineAt) {
      context.expired = true;
      throw new Error('Sina board snapshot deadline exceeded');
    }
  }

  function createSinaDeadline() {
    const controller = new AbortController();
    const context = {
      controller,
      deadlineAt: Date.now() + sinaDeadlineMs,
      expired: false,
      token: Symbol('sina-deadline'),
      timer: null,
      promise: null
    };
    context.promise = new Promise(resolve => {
      context.timer = setTimeout(function() {
        context.expired = true;
        controller.abort();
        resolve(context.token);
      }, sinaDeadlineMs);
    });
    context.close = function() {
      if (context.timer) clearTimeout(context.timer);
      context.expired = true;
      controller.abort();
    };
    return context;
  }

  async function requestSina(kind, params, context) {
    assertSinaActive(context);
    const safeParams = Object.assign({}, params || {});
    const remaining = context ? Math.max(50, context.deadlineAt - Date.now()) : sinaTimeoutMs;
    const requestConfig = {
      timeout: Math.min(sinaTimeoutMs, remaining),
      signal: context ? context.controller.signal : undefined
    };
    if (typeof options.sinaGet === 'function') {
      return options.sinaGet(kind, safeParams, requestConfig);
    }
    let url;
    if (kind === 'nodes') url = SINA_NODES_URL;
    else if (kind === 'count') url = SINA_COUNT_URL;
    else if (kind === 'data') url = SINA_DATA_URL;
    else throw new Error('Unsupported Sina board request');
    const response = await axios.get(url, {
      timeout: requestConfig.timeout,
      signal: requestConfig.signal,
      params: safeParams,
      headers: { Referer: 'https://finance.sina.com.cn/', 'User-Agent': 'Mozilla/5.0 WebStock' }
    });
    return response;
  }

  async function fetchSinaConstituents(input) {
    const config = SINA_TAXONOMY_CONFIG[input.taxonomy];
    const deadline = createSinaDeadline();
    try {
      const task = (async function() {
        const countPayload = unwrapResponse(await requestSina('count', { node: input.code }, deadline));
        const expectedCount = finiteNumber(countPayload);
        if (!Number.isInteger(expectedCount) || expectedCount <= 0 || expectedCount > MAX_SINA_CONSTITUENTS) {
          throw new Error('Sina board returned invalid constituent count for ' + input.code);
        }
        const rows = [];
        const pageCount = Math.ceil(expectedCount / SINA_PAGE_SIZE);
        for (let page = 1; page <= pageCount; page += 1) {
          const payload = await requestSina('data', {
            page, num: SINA_PAGE_SIZE, sort: 'symbol', asc: 1,
            node: input.code, symbol: '', _s_r_a: 'page'
          }, deadline);
          const pageRows = normalizeSinaStockRows(payload);
          if (pageRows.length > SINA_PAGE_SIZE || rows.length + pageRows.length > expectedCount) {
            throw new Error('Sina board constituent page exceeds declared bounds for ' + input.code);
          }
          for (const row of pageRows) rows.push(row);
        }
        const fetchedAt = new Date(now()).toISOString();
        const board = boardIdentity(input);
        const seen = new Set();
        const items = rows.map(function(row) {
          const item = mapSinaConstituentRow(row, board, {
            provider: config.provider, fetchedAt, coverageComplete: true
          });
          if (!item || seen.has(item.code)) return null;
          seen.add(item.code);
          return item;
        }).filter(Boolean);
        const coverageComplete = rows.length === expectedCount && items.length === expectedCount;
        if (!coverageComplete) {
          for (const item of items) {
            item.coverageComplete = false;
            if (item.status === 'available') item.reason = 'provider-reported-total-not-fully-covered';
          }
        }
        const available = items.filter(item => item.status === 'available').length;
        return {
          schema: SCHEMA,
          kind: 'constituents',
          status: coverageComplete && available === items.length ? 'available' : 'partial',
          provider: config.provider,
          taxonomy: input.taxonomy,
          board: Object.assign({}, board, { provider: config.provider, providerId: input.code }),
          capabilities: { snapshot: true, constituents: true, capitalFlow: false },
          observedAt: null,
          fetchedAt,
          stale: false,
          coverageComplete,
          reason: coverageComplete && available === items.length ? null : 'provider-returned-incomplete-constituent-observations',
          items
        };
      })();
      const result = await Promise.race([task, deadline.promise]);
      if (result === deadline.token) throw new Error('Sina board constituents deadline exceeded');
      return result;
    } finally {
      deadline.close();
    }
  }

  async function fetchRemoteConstituents(input) {
    return input.source === 'sina'
      ? fetchSinaConstituents(input)
      : fetchEastmoneyConstituents(input);
  }

  async function fetchSinaBoardCatalog(taxonomy, context) {
    const fetchedAt = new Date(now()).toISOString();
    // The root response contains the complete industry/concept/region trees.
    // Passing node=hs_a returns only the A-share leaf with empty children.
    const payload = await requestSina('nodes', {}, context);
    assertSinaActive(context);
    const result = parseSinaBoardCatalog(payload, taxonomy, fetchedAt);
    return {
      items: result.items,
      descriptors: result.descriptors,
      fetchedAt,
      coverageComplete: result.coverageComplete,
      provider: SINA_TAXONOMY_CONFIG[taxonomy].provider,
      reason: result.reason,
      classification: result.classification
    };
  }

  async function fetchSinaNodeSnapshot(descriptor, fetchedAt, context) {
    const countPayload = unwrapResponse(await requestSina('count', { node: descriptor.node }, context));
    assertSinaActive(context);
    const expectedCount = finiteNumber(countPayload);
    if (!Number.isInteger(expectedCount) || expectedCount <= 0 || expectedCount > MAX_SINA_CONSTITUENTS) {
      throw new Error('Sina board returned invalid constituent count for ' + descriptor.node);
    }
    const rows = [];
    const pageCount = Math.ceil(expectedCount / SINA_PAGE_SIZE);
    for (let page = 1; page <= pageCount; page += 1) {
      assertSinaActive(context);
      const payload = await requestSina('data', {
        page,
        num: SINA_PAGE_SIZE,
        sort: 'symbol',
        asc: 1,
        node: descriptor.node,
        symbol: '',
        _s_r_a: 'page'
      }, context);
      assertSinaActive(context);
      const pageRows = normalizeSinaStockRows(payload);
      if (pageRows.length > SINA_PAGE_SIZE || rows.length + pageRows.length > expectedCount) {
        throw new Error('Sina board constituent page exceeds declared bounds for ' + descriptor.node);
      }
      for (const row of pageRows) rows.push(row);
    }
    return aggregateSinaBoardRows(descriptor, rows, expectedCount, fetchedAt);
  }

  function prioritizedSinaWork(taxonomy, descriptors) {
    const priorities = SINA_SNAPSHOT_PRIORITIES[taxonomy] || [];
    return descriptors.map(function(descriptor, index) {
      const priority = priorities.findIndex(function(keyword) {
        return descriptor.name === keyword || descriptor.name.includes(keyword);
      });
      return { descriptor, index, priority: priority < 0 ? Number.MAX_SAFE_INTEGER : priority };
    }).sort(function(left, right) {
      return left.priority - right.priority || left.index - right.index;
    });
  }

  async function fetchSinaBoardSnapshot(taxonomy) {
    const deadline = createSinaDeadline();
    const items = [];
    const failures = [];
    const failureByIndex = new Map();
    try {
      const catalogResult = await Promise.race([fetchSinaBoardCatalog(taxonomy, deadline), deadline.promise]);
      if (catalogResult === deadline.token) throw new Error('Sina ' + taxonomy + ' snapshot deadline exceeded');
      const catalog = catalogResult;
      const work = prioritizedSinaWork(taxonomy, catalog.descriptors);
      let cursor = 0;
      let completed = false;
      const workers = Array.from({ length: Math.min(sinaConcurrency, work.length) }, async function() {
        while (!deadline.expired) {
          const workIndex = cursor;
          cursor += 1;
          if (workIndex >= work.length) return;
          const entry = work[workIndex];
          const descriptor = entry.descriptor;
          try {
            const item = await fetchSinaNodeSnapshot(descriptor, catalog.fetchedAt, deadline);
            if (!deadline.expired) items.push({ index: entry.index, item });
          } catch (error) {
            const reason = cleanReason(error);
            failures.push(reason);
            failureByIndex.set(entry.index, reason);
          }
        }
      });
      const workersResult = await Promise.race([
        Promise.all(workers).then(function() {
          completed = true;
          return true;
        }),
        deadline.promise
      ]);
      if (workersResult === deadline.token) deadline.expired = true;
      items.sort((left, right) => left.index - right.index);
      const availableByIndex = new Map(items.map(entry => [entry.index, entry.item]));
      if (!availableByIndex.size) {
        throw new Error(failures[failures.length - 1] || 'Sina ' + taxonomy + ' snapshot unavailable');
      }
      const snapshots = catalog.items.map(function(identity, index) {
        const available = availableByIndex.get(index);
        if (available) return available;
        const reason = failureByIndex.get(index) || 'Sina ' + taxonomy + ' node snapshot unavailable';
        return Object.assign({}, identity, {
          status: 'unavailable', observedAt: null, fetchedAt: catalog.fetchedAt,
          stale: false, coverageComplete: false, reason,
          price: null, changePct: null, changeAmount: null, volume: null, amount: null,
          totalMarketValue: null, mainNetInflow: null, capitalFlowClass: 'unavailable',
          constituentCount: null, expectedConstituentCount: null
        });
      });
      const coverageComplete = catalog.coverageComplete && completed &&
        availableByIndex.size === catalog.descriptors.length;
      return {
        items: snapshots,
        fetchedAt: catalog.fetchedAt,
        coverageComplete,
        provider: SINA_TAXONOMY_CONFIG[taxonomy].provider,
        reason: coverageComplete ? null : 'Sina ' + taxonomy + ' nodes not fully covered (' +
          availableByIndex.size + '/' + catalog.descriptors.length + ')',
        classification: catalog.classification
      };
    } finally {
      deadline.close();
    }
  }

  function shouldAttemptSina(taxonomy, mode) {
    if (!SINA_TAXONOMY_CONFIG[taxonomy]) return false;
    if (typeof options.sinaGet === 'function') return true;
    const legacyInjection = mode === 'snapshot' ? options.snapshotGet : options.catalogGet;
    return typeof legacyInjection !== 'function';
  }

  function mergePartialProviderResults(results) {
    if (results.length < 2) return results[0];
    const ordered = results.slice().sort(function(left, right) {
      const leftAvailable = left.items.filter(item => item.status === 'available').length;
      const rightAvailable = right.items.filter(item => item.status === 'available').length;
      return rightAvailable - leftAvailable || right.items.length - left.items.length;
    });
    const merged = new Map();
    function nameKey(item) {
      return cleanText(item && item.name, 80).toLowerCase()
        .replace(/[（(][^）)]*[）)]/g, '')
        .replace(/[\s·・]/g, '');
    }
    function quality(item) {
      let score = item && item.status === 'available' ? 100 : 0;
      if (item && item.provider === 'eastmoney-public-board') score += 20;
      if (item && item.capitalFlowClass !== 'unavailable' && item.mainNetInflow !== null) score += 10;
      for (const key of ['changePct', 'amount', 'totalMarketValue']) {
        if (item && item[key] !== null && item[key] !== undefined) score += 1;
      }
      return score;
    }
    ordered.forEach(function(result) {
      result.items.forEach(function(item) {
        const key = nameKey(item) || item.key;
        const current = merged.get(key);
        if (!current || quality(item) > quality(current)) merged.set(key, item);
      });
    });
    const items = Array.from(merged.values());
    const availableCount = items.filter(item => item.status === 'available').length;
    return {
      items,
      fetchedAt: ordered.map(item => item.fetchedAt).filter(Boolean).sort().pop() || null,
      coverageComplete: false,
      provider: 'mixed-public',
      reason: 'combined partial public providers; available ' + availableCount + '/' + items.length,
      classification: null
    };
  }

  async function fetchFreshTaxonomy(taxonomy, mode) {
    const attempts = [fetchRemoteTaxonomy(taxonomy, mode)];
    if (shouldAttemptSina(taxonomy, mode)) {
      attempts.push(mode === 'snapshot' ? fetchSinaBoardSnapshot(taxonomy) : fetchSinaBoardCatalog(taxonomy));
    }
    if (attempts.length === 1) return attempts[0];
    return new Promise(function(resolve, reject) {
      const partialResults = [];
      const errors = [];
      let settled = 0;
      let finished = false;
      function settle() {
        settled += 1;
        if (finished || settled < attempts.length) return;
        if (partialResults.length) {
          finished = true;
          resolve(mergePartialProviderResults(partialResults));
          return;
        }
        finished = true;
        reject(new Error(errors.map(cleanReason).join(' | ') || 'market board providers unavailable'));
      }
      attempts.forEach(function(attempt) {
        Promise.resolve(attempt).then(function(result) {
          if (finished) return;
          const hasObservation = mode === 'catalog' || result.items.some(item => item.status === 'available');
          if (result.coverageComplete && hasObservation) {
            finished = true;
            resolve(result);
            return;
          }
          partialResults.push(result);
          settle();
        }, function(error) {
          errors.push(error);
          settle();
        });
      });
    });
  }

  function unsupportedGroup(taxonomy, fetchedAt) {
    const reason = taxonomy === 'style'
      ? 'no-verified-public-style-board-catalog'
      : 'taxonomy-provider-unavailable';
    return {
      items: [],
      coverage: coverageRecord({
        provider: 'unavailable', taxonomy, capabilities: capabilitiesFor(taxonomy), status: 'unavailable',
        count: 0, fetchedAt, stale: false, coverageComplete: false, reason
      })
    };
  }

  function indexCatalogGroup(fetchedAt) {
    const items = staticDefinitions.map(definition => mapStaticDefinition(definition, fetchedAt));
    return {
      items,
      coverage: coverageRecord({
        provider: 'curated-public-index', taxonomy: 'index', status: items.length ? 'partial' : 'unavailable',
        count: items.length, fetchedAt, stale: false, coverageComplete: false,
        reason: items.length ? 'curated-index-whitelist' : 'index-catalog-empty'
      })
    };
  }

  async function remoteCatalogGroup(taxonomy, refresh) {
    const cachedMemory = memoryCatalog.get(taxonomy);
    if (!refresh && cachedMemory && now() - cachedMemory.storedAt < catalogTtlMs) return cachedMemory.value;
    if (!refresh && pendingCatalog.has(taxonomy)) return pendingCatalog.get(taxonomy);
    const request = (async function() {
      try {
        const result = await fetchFreshTaxonomy(taxonomy, 'catalog');
        if (result.coverageComplete) {
          try {
            persistTaxonomy(cachePath, taxonomy, result.items, result.fetchedAt, true, result.provider);
          } catch (error) {}
        }
        const value = {
          items: result.items,
          coverage: coverageRecord({
            provider: result.provider, taxonomy,
            capabilities: isSinaBoardProvider(result.provider)
              ? sinaBoardCapabilities() : capabilitiesFor(taxonomy),
            status: result.coverageComplete ? 'available' : 'partial',
            count: result.items.length, fetchedAt: result.fetchedAt, stale: false,
            coverageComplete: result.coverageComplete,
            reason: result.reason
          })
        };
        memoryCatalog.set(taxonomy, { storedAt: now(), value });
        return value;
      } catch (error) {
        const fetchedAt = new Date(now()).toISOString();
        const reason = cleanReason(error);
        const saved = cachedTaxonomy(cachePath, taxonomy);
        if (!saved) {
          return {
            items: [],
            coverage: coverageRecord({
              provider: shouldAttemptSina(taxonomy, 'catalog')
                ? 'mixed-public' : 'eastmoney-public-board',
              taxonomy, status: 'unavailable', count: 0,
              fetchedAt, stale: false, coverageComplete: false, reason
            })
          };
        }
        const staleReason = 'provider unavailable; using last successful catalog: ' + reason;
        const items = saved.items.map(function(item) {
          return Object.assign({}, item, { stale: true, reason: staleReason });
        });
        return {
          items,
          coverage: coverageRecord({
            provider: saved.provider || 'eastmoney-public-board', taxonomy, status: 'partial',
            capabilities: isSinaBoardProvider(saved.provider)
              ? sinaBoardCapabilities() : capabilitiesFor(taxonomy),
            count: items.length, fetchedAt, stale: true, coverageComplete: saved.coverageComplete === true,
            reason: staleReason, lastSuccessfulAt: saved.fetchedAt || null
          })
        };
      }
    })();
    pendingCatalog.set(taxonomy, request);
    return request.finally(function() {
      if (pendingCatalog.get(taxonomy) === request) pendingCatalog.delete(taxonomy);
    });
  }

  async function indexSnapshotGroup(fetchedAt) {
    const definitions = staticDefinitions.map(definition => mapStaticDefinition(definition, fetchedAt));
    try {
      const fetchIndexOverview = options.indexOverview || marketOverview.fetchIndexOverview;
      const overview = await fetchIndexOverview();
      const quotes = new Map((overview.indices || []).map(item => [item.key, item]));
      const items = definitions.map(function(item) {
        const definition = staticDefinitions.find(entry => entry.key === item.key) || {};
        const quote = quotes.get(definition.legacyKey || String(item.key).replace(/^index:/, ''));
        if (!quote) {
          return Object.assign({}, item, {
            status: 'unavailable', price: null, changePct: null, changeAmount: null,
            volume: null, amount: null, totalMarketValue: null, mainNetInflow: null,
            reason: 'index-snapshot-unavailable'
          });
        }
        return Object.assign({}, item, {
          status: 'available', price: finiteNumber(quote.price), changePct: finiteNumber(quote.changePct),
          changeAmount: finiteNumber(quote.changeAmount), volume: finiteNumber(quote.volume),
          amount: finiteNumber(quote.amount), totalMarketValue: null, mainNetInflow: null,
          fetchedAt: overview.fetchedAt || fetchedAt, reason: null
        });
      });
      const available = items.filter(item => item.status === 'available').length;
      return {
        items,
        coverage: coverageRecord({
          provider: 'sina-public-index', taxonomy: 'index',
          status: available === items.length ? 'partial' : (available ? 'partial' : 'unavailable'),
          count: available, fetchedAt, stale: false, coverageComplete: false,
          reason: available ? 'curated-index-whitelist' : 'index-snapshot-unavailable'
        })
      };
    } catch (error) {
      const reason = cleanReason(error);
      return {
        items: definitions.map(function(item) {
          return Object.assign({}, item, {
            status: 'unavailable', stale: true, price: null, changePct: null, changeAmount: null,
            volume: null, amount: null, totalMarketValue: null, mainNetInflow: null, reason
          });
        }),
        coverage: coverageRecord({
          provider: 'sina-public-index', taxonomy: 'index', status: 'unavailable', count: 0,
          fetchedAt, stale: true, coverageComplete: false, reason
        })
      };
    }
  }

  async function remoteSnapshotGroup(taxonomy, refresh) {
    const cachedMemory = memorySnapshot.get(taxonomy);
    if (!refresh && cachedMemory && now() - cachedMemory.storedAt < snapshotTtlMs) return cachedMemory.value;
    if (pendingSnapshot.has(taxonomy)) return pendingSnapshot.get(taxonomy);
    const request = (async function() {
      try {
        const result = await fetchFreshTaxonomy(taxonomy, 'snapshot');
        if (result.coverageComplete) {
          try {
            persistTaxonomy(cachePath, taxonomy, result.items, result.fetchedAt, true, result.provider);
          } catch (error) {}
        }
        const availableCount = result.items.filter(item => item.status === 'available').length;
        const value = {
          items: result.items,
          coverage: coverageRecord({
            provider: result.provider, taxonomy,
            capabilities: isSinaBoardProvider(result.provider)
              ? sinaBoardCapabilities() : capabilitiesFor(taxonomy),
            status: availableCount === result.items.length && result.coverageComplete ? 'available' :
              (availableCount ? 'partial' : 'unavailable'),
            count: availableCount, fetchedAt: result.fetchedAt, stale: false,
            coverageComplete: result.coverageComplete,
            reason: result.reason
          })
        };
        memorySnapshot.set(taxonomy, { storedAt: now(), value });
        return value;
      } catch (error) {
        const fetchedAt = new Date(now()).toISOString();
        const reason = cleanReason(error);
        const saved = cachedTaxonomy(cachePath, taxonomy);
        if (!saved) {
          return {
            items: [],
            coverage: coverageRecord({
              provider: shouldAttemptSina(taxonomy, 'snapshot')
                ? 'mixed-public' : 'eastmoney-public-board',
              taxonomy, status: 'unavailable', count: 0,
              fetchedAt, stale: false, coverageComplete: false, reason
            })
          };
        }
        const items = saved.items.map(function(item) {
          return Object.assign({}, item, {
            status: 'unavailable', observedAt: null, fetchedAt, stale: true,
            coverageComplete: false,
            price: null, changePct: null, changeAmount: null, volume: null, amount: null,
            totalMarketValue: null, mainNetInflow: null, capitalFlowClass: 'unavailable', reason
          });
        });
        return {
          items,
          coverage: coverageRecord({
            provider: saved.provider || 'eastmoney-public-board', taxonomy, status: 'unavailable', count: 0,
            capabilities: isSinaBoardProvider(saved.provider)
              ? sinaBoardCapabilities() : capabilitiesFor(taxonomy),
            fetchedAt, stale: true, coverageComplete: false,
            reason, lastSuccessfulAt: saved.fetchedAt || null
          })
        };
      }
    })();
    pendingSnapshot.set(taxonomy, request);
    return request.finally(function() {
      if (pendingSnapshot.get(taxonomy) === request) pendingSnapshot.delete(taxonomy);
    });
  }

  async function fetchCatalog(input) {
    input = typeof input === 'string' ? { query: input } : (input || {});
    const taxonomies = taxonomyInput(input.taxonomy);
    const fetchedAt = new Date(now()).toISOString();
    const groups = await Promise.all(taxonomies.map(function(taxonomy) {
      if (taxonomy === 'index') return indexCatalogGroup(fetchedAt);
      if (!REMOTE_TAXONOMIES[taxonomy]) return unsupportedGroup(taxonomy, fetchedAt);
      return remoteCatalogGroup(taxonomy, input.refresh === true);
    }));
    return aggregateResult('catalog', taxonomies, groups, fetchedAt, input.query);
  }

  async function fetchSnapshot(input) {
    input = input || {};
    const taxonomies = taxonomyInput(input.taxonomy);
    const fetchedAt = new Date(now()).toISOString();
    const groups = await Promise.all(taxonomies.map(function(taxonomy) {
      if (taxonomy === 'index') return indexSnapshotGroup(fetchedAt);
      if (!REMOTE_TAXONOMIES[taxonomy]) return unsupportedGroup(taxonomy, fetchedAt);
      return remoteSnapshotGroup(taxonomy, input.refresh === true);
    }));
    return aggregateResult('snapshot', taxonomies, groups, fetchedAt, '');
  }

  async function fetchConstituents(rawInput) {
    const input = constituentInput(rawInput);
    const cacheKey = input.taxonomy + ':' + input.code;
    const cached = memoryConstituents.get(cacheKey);
    if (!input.refresh && cached && now() - cached.storedAt < snapshotTtlMs) return cached.value;
    if (!input.refresh && pendingConstituents.has(cacheKey)) return pendingConstituents.get(cacheKey);
    const request = (async function() {
      try {
        const value = await fetchRemoteConstituents(input);
        memoryConstituents.set(cacheKey, { storedAt: now(), value });
        return value;
      } catch (error) {
        const fetchedAt = new Date(now()).toISOString();
        const reason = cleanReason(error);
        const lastGood = memoryConstituents.get(cacheKey);
        const provider = input.source === 'sina'
          ? SINA_TAXONOMY_CONFIG[input.taxonomy].provider
          : 'eastmoney-public-board';
        const capabilities = input.source === 'sina'
          ? { snapshot: true, constituents: true, capitalFlow: false }
          : { snapshot: true, constituents: true, capitalFlow: true };
        const board = lastGood && lastGood.value && lastGood.value.board
          ? lastGood.value.board : Object.assign(boardIdentity(input), {
            provider, providerId: input.source === 'sina' ? input.code : '90.' + input.code
          });
        const items = lastGood && lastGood.value && Array.isArray(lastGood.value.items)
          ? lastGood.value.items.map(function(item) {
            return Object.assign({}, item, {
              status: 'unavailable', observedAt: null, fetchedAt, stale: true,
              coverageComplete: false, reason,
              price: null, changePct: null, changeAmount: null, volume: null, amount: null,
              netFlow: null, mainNetInflow: null, marketCap: null, totalMarketValue: null,
              capitalFlowClass: 'unavailable'
            });
          }) : [];
        return {
          schema: SCHEMA,
          kind: 'constituents',
          status: 'unavailable',
          provider,
          taxonomy: input.taxonomy,
          board,
          capabilities,
          observedAt: null,
          fetchedAt,
          stale: items.length > 0,
          coverageComplete: false,
          reason,
          lastSuccessfulAt: lastGood && lastGood.value ? lastGood.value.fetchedAt : null,
          items
        };
      }
    })();
    pendingConstituents.set(cacheKey, request);
    return request.finally(function() {
      if (pendingConstituents.get(cacheKey) === request) pendingConstituents.delete(cacheKey);
    });
  }

  return { fetchCatalog, fetchSnapshot, fetchConstituents };
}

const defaultService = createMarketBoardService();

module.exports = {
  SCHEMA,
  TAXONOMIES,
  CONSTITUENT_TAXONOMIES,
  REMOTE_TAXONOMIES,
  taxonomyInput,
  constituentInput,
  mapBoardRow,
  mapConstituentRow,
  createMarketBoardService,
  fetchCatalog: defaultService.fetchCatalog,
  fetchSnapshot: defaultService.fetchSnapshot,
  fetchConstituents: defaultService.fetchConstituents
};
