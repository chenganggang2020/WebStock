const portfolio = require('./portfolioService');
const userService = require('./userService');
const axios = require('axios');

const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
const providers = [];
const asyncProviders = [];

function cacheKey(params) {
  return JSON.stringify(params || {});
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeNews(item) {
  return {
    title: String(item.title || '').trim(),
    source: item.source || 'WebStock',
    time: item.time || nowIso(),
    summary: item.summary || '',
    link: item.link || '#',
    type: item.type || 'market',
    relatedStocks: Array.isArray(item.relatedStocks) ? item.relatedStocks : [],
    relatedSectors: Array.isArray(item.relatedSectors) ? item.relatedSectors : []
  };
}

function dedupeNews(items) {
  const seen = new Set();
  const deduped = [];
  (items || []).map(normalizeNews).forEach(item => {
    if (!item.title) return;
    const key = [
      item.title.toLowerCase(),
      item.link || '#',
      item.relatedStocks.join(','),
      item.relatedSectors.join(',')
    ].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(item);
  });
  return deduped;
}

function setDefaultSource(items, sourceName) {
  return (items || []).map(item => {
    if (!item || typeof item !== 'object') return item;
    if (item.source) return item;
    return Object.assign({}, item, { source: sourceName || 'WebStock' });
  });
}

function normalizedText(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function newsSearchText(item) {
  return [
    item.title,
    item.source,
    item.summary,
    item.link,
    item.type,
    ...(item.relatedStocks || []),
    ...(item.relatedSectors || [])
  ].map(normalizedText).join(' ');
}

function includesToken(values, token) {
  const normalized = normalizedText(token);
  if (!normalized) return false;
  return (values || []).some(value => normalizedText(value) === normalized);
}

function matchesNewsType(item, filters = {}) {
  if (!filters.type) return true;
  if (item.type === filters.type) return true;
  if (filters.type === 'stock' && filters.code) {
    return includesToken(item.relatedStocks, filters.code);
  }
  if (filters.type === 'sector' && filters.sector) {
    return includesToken(item.relatedSectors, filters.sector);
  }
  return false;
}

function matchesNewsKeyword(item, filters = {}) {
  const keyword = normalizedText(filters.keyword);
  if (!keyword) return true;
  return newsSearchText(item).includes(keyword);
}

function matchesNewsSource(item, filters = {}) {
  const source = normalizedText(filters.source);
  if (!source) return true;
  if (!item || !item.source) return false;
  return normalizedText(item.source) === source;
}

function applyNewsFilters(items, filters = {}) {
  return (items || []).filter(item => matchesNewsType(item, filters) && matchesNewsKeyword(item, filters) && matchesNewsSource(item, filters));
}

function hasExplicitNewsFilter(filters = {}) {
  return Boolean(filters.type || filters.code || filters.sector || filters.keyword || filters.source);
}

function getItemSourceList(items = []) {
  return Array.from(new Set((items || [])
    .map(function(item) { return item && item.source ? item.source.trim() : ''; })
    .filter(Boolean)))
    .sort();
}

function fallbackMarketNews() {
  return [
    normalizeNews({
      type: 'market',
      title: 'Market watch: review positions, alerts, and sector leaders before acting',
      source: 'WebStock Fallback',
      summary: 'External news providers are unavailable or not configured. WebStock keeps a local research-oriented fallback feed so the page remains usable.',
      relatedSectors: ['Market']
    }),
    normalizeNews({
      type: 'market',
      title: 'Workbench checklist: compare watchlist, holdings, recent stocks, and leaders',
      source: 'WebStock Fallback',
      summary: 'Use news as one input only. Cross-check price, volume, risk exposure, and your own notes before making decisions.',
      relatedSectors: ['Workbench']
    })
  ];
}

function stockNews(code, name) {
  const label = name || code;
  return [
    normalizeNews({
      type: 'stock',
      title: label + ' stock note: compare price, volume, and moving-average position',
      source: 'WebStock Fallback',
      summary: 'This is a local fallback note. Combine chart context, position cost, watchlist notes, and risk checks before drawing conclusions.',
      relatedStocks: [code]
    }),
    normalizeNews({
      type: 'stock',
      title: label + ' risk note: do not rely on a single delayed signal',
      source: 'WebStock Fallback',
      summary: 'Quotes, news, and AI analysis can fail or lag. Candidate lists are for research and learning only, not investment advice.',
      relatedStocks: [code]
    })
  ];
}

function sectorNews(sector) {
  const label = sector || 'Sector';
  return [
    normalizeNews({
      type: 'sector',
      title: label + ' leader watch: monitor persistence, turnover, and pullback risk',
      source: 'WebStock Fallback',
      summary: 'Sector leaders are most useful when compared as a group. Watch relative strength, breadth, and volume rather than one isolated move.',
      relatedSectors: [label]
    })
  ];
}

function watchlistNews() {
  const items = portfolio.listWatchlist().slice(0, 5);
  if (!items.length) return [];
  return items.flatMap(item => stockNews(item.code, item.name).slice(0, 1))
    .map(item => Object.assign({}, item, { type: 'watchlist' }));
}

function holdingNews() {
  const positions = portfolio.getPositions().slice(0, 5);
  if (!positions.length) return [];
  return positions.flatMap(item => stockNews(item.code, item.name).slice(0, 1))
    .map(item => Object.assign({}, item, { type: 'holding' }));
}

function recentNews() {
  const recent = userService.listRecentStocks(5);
  return recent.flatMap(item => stockNews(item.code, item.name).slice(0, 1));
}

function buildFallbackNews(filters = {}) {
  let data = [];
  if (filters.type === 'stock' && filters.code) {
    data = stockNews(filters.code, filters.name || filters.code);
  } else if (filters.type === 'market') {
    data = fallbackMarketNews();
  } else if (filters.type === 'sector') {
    data = sectorNews(filters.sector || filters.name || 'Sector');
  } else if (filters.type === 'watchlist') {
    data = watchlistNews();
  } else if (filters.type === 'holding') {
    data = holdingNews();
  } else {
    data = fallbackMarketNews().concat(recentNews(), watchlistNews(), holdingNews());
  }
  return applyNewsFilters(data, filters);
}

function registerProvider(provider) {
  if (!provider || !provider.name || typeof provider.list !== 'function') {
    throw new Error('News provider must include name and list(filters)');
  }
  providers.unshift(provider);
  cache.clear();
}

function registerAsyncProvider(provider) {
  if (!provider || !provider.name || typeof provider.list !== 'function') {
    throw new Error('Async news provider must include name and list(filters)');
  }
  asyncProviders.unshift(provider);
  cache.clear();
}

function createJsonUrlProvider(url, options = {}) {
  if (!url) throw new Error('JSON news provider URL is required');
  return {
    name: options.name || 'json-url-provider',
    async list(filters = {}) {
      const response = await axios.get(url, {
        timeout: options.timeoutMs || 6000,
        params: {
          type: filters.type || '',
          code: filters.code || '',
          sector: filters.sector || filters.name || ''
        }
      });
      const payload = response.data;
      const rawItems = Array.isArray(payload) ? payload
        : Array.isArray(payload.items) ? payload.items
          : Array.isArray(payload.data) ? payload.data
            : [];
      return rawItems.map(item => normalizeNews(item));
    }
  };
}

function sinaTimeToIso(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return nowIso();
  return new Date(seconds * 1000).toISOString();
}

function createSinaFinanceProvider(options = {}) {
  const url = options.url || 'https://feed.mix.sina.com.cn/api/roll/get';
  const lids = options.lids || [2517, 2516];
  const pageid = options.pageid || 153;
  const num = options.num || 30;
  return {
    name: options.name || 'sina-finance-roll',
    async list(filters = {}) {
      const lists = await Promise.all(lids.map(async function(lid) {
        const response = await axios.get(url, {
          timeout: options.timeoutMs || 7000,
          params: {
            pageid,
            lid,
            num,
            page: 1,
            encode: 'utf-8',
            _: Date.now()
          },
          headers: {
            Referer: 'https://finance.sina.com.cn/',
            'User-Agent': 'Mozilla/5.0 WebStock'
          }
        });
        const data = response.data && response.data.result && Array.isArray(response.data.result.data)
          ? response.data.result.data
          : [];
        return data;
      }));
      return lists.flat().map(function(item) {
        const keywords = String(item.keywords || '').split(',').map(function(tag) { return tag.trim(); }).filter(Boolean);
        const relatedStocks = [];
        if (filters.code && [
          item.title,
          item.stitle,
          item.keywords,
          item.summary,
          item.wapsummary
        ].join(' ').includes(filters.code)) {
          relatedStocks.push(filters.code);
        }
        const relatedSectors = filters.sector ? [filters.sector] : keywords.slice(0, 4);
        return normalizeNews({
          title: item.title || item.stitle || '',
          source: 'Sina Finance',
          time: sinaTimeToIso(item.ctime || item.mtime),
          summary: item.intro || item.wapsummary || item.stitle || keywords.join('、'),
          link: item.url || '#',
          type: filters.type || 'market',
          relatedStocks,
          relatedSectors
        });
      });
    }
  };
}

providers.push({
  name: 'webstock-fallback',
  list: buildFallbackNews
});

if (process.env.NEWS_JSON_URL) {
  asyncProviders.push(createJsonUrlProvider(process.env.NEWS_JSON_URL, { name: 'configured-json-url-provider' }));
}

if (process.env.WEBSTOCK_DISABLE_SINA_NEWS !== '1') {
  asyncProviders.push(createSinaFinanceProvider());
}

function listNewsWithMeta(filters = {}) {
  const key = cacheKey(filters);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    const cacheAgeMs = Date.now() - cached.ts;
    return {
      items: cached.items,
      meta: Object.assign({}, cached.meta, {
        cached: true,
        cacheAgeMs
      })
    };
  }

  let data = [];
  const providerStatuses = [];
  for (const provider of providers) {
    try {
      const providerData = applyNewsFilters(dedupeNews(setDefaultSource(provider.list(filters) || [], provider.name).map(normalizeNews)), filters);
      providerStatuses.push({ name: provider.name, ok: true, count: providerData.length });
      if (providerData.length) {
        data = providerData;
        break;
      }
    } catch (error) {
      providerStatuses.push({ name: provider.name, ok: false, error: error.message });
      console.error('[News] Provider failed:', provider.name, error.message);
    }
  }

  if (!data.length && !hasExplicitNewsFilter(filters)) data = dedupeNews(fallbackMarketNews());
  const meta = {
    cached: false,
    cacheAgeMs: 0,
    cacheTtlMs: CACHE_TTL_MS,
    generatedAt: nowIso(),
    itemCount: data.length,
    providers: providerStatuses,
    degraded: providerStatuses.some(status => !status.ok),
    sources: getItemSourceList(data)
  };

  cache.set(key, { ts: Date.now(), items: data, meta });
  return { items: data, meta };
}

function listNews(filters = {}) {
  return listNewsWithMeta(filters).items;
}

async function listNewsWithMetaAsync(filters = {}) {
  const key = cacheKey(Object.assign({ async: true }, filters));
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    const cacheAgeMs = Date.now() - cached.ts;
    return {
      items: cached.items,
      meta: Object.assign({}, cached.meta, {
        cached: true,
        cacheAgeMs
      })
    };
  }

  const providerStatuses = [];
  for (const provider of asyncProviders) {
    try {
      const providerData = applyNewsFilters(dedupeNews(setDefaultSource(await provider.list(filters), provider.name).map(normalizeNews)), filters);
      providerStatuses.push({ name: provider.name, ok: true, count: providerData.length });
      if (providerData.length) {
        const meta = {
          cached: false,
          cacheAgeMs: 0,
          cacheTtlMs: CACHE_TTL_MS,
          generatedAt: nowIso(),
          itemCount: providerData.length,
          sources: getItemSourceList(providerData),
          providers: providerStatuses,
          degraded: false
        };
        cache.set(key, { ts: Date.now(), items: providerData, meta });
        return { items: providerData, meta };
      }
    } catch (error) {
      providerStatuses.push({ name: provider.name, ok: false, error: error.message });
      console.error('[News] Async provider failed:', provider.name, error.message);
    }
  }

  const fallback = listNewsWithMeta(filters);
  return {
    items: fallback.items,
    meta: Object.assign({}, fallback.meta, {
      cached: fallback.meta.cached,
      cacheAgeMs: fallback.meta.cacheAgeMs || 0,
      providers: providerStatuses.concat(fallback.meta.providers || []),
      degraded: providerStatuses.some(status => !status.ok) || fallback.meta.degraded
    })
  };
}

async function listNewsAsync(filters = {}) {
  return (await listNewsWithMetaAsync(filters)).items;
}

module.exports = {
  listNews,
  listNewsWithMeta,
  listNewsAsync,
  listNewsWithMetaAsync,
  normalizeNews,
  dedupeNews,
  applyNewsFilters,
  registerProvider,
  registerAsyncProvider,
  createJsonUrlProvider,
  createSinaFinanceProvider,
  providers,
  asyncProviders
};
