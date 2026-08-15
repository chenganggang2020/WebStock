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

const EXPLICIT_IMAGE_FIELDS = [
  'imageUrl', 'image_url', 'thumbnailUrl', 'thumbnail_url', 'thumbnail',
  'thumb', 'img', 'wap_thumb', 'coverUrl', 'cover_url'
];

function explicitImageField(item) {
  const declaredField = String(item.imageSourceField || '').trim();
  if (EXPLICIT_IMAGE_FIELDS.includes(declaredField) && item.imageUrl) {
    return { value: item.imageUrl, sourceField: declaredField };
  }
  for (const sourceField of EXPLICIT_IMAGE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(item, sourceField)) continue;
    const value = String(item[sourceField] == null ? '' : item[sourceField]).trim();
    if (value) return { value, sourceField };
  }
  return null;
}

function normalizeNews(item) {
  item = item || {};
  const source = item.source || 'WebStock';
  const relatedStocks = Array.isArray(item.relatedStocks) ? item.relatedStocks : [];
  const relatedSectors = Array.isArray(item.relatedSectors) ? item.relatedSectors : [];
  const evidenceKind = item.evidenceKind || (source === 'WebStock Fallback' ? 'local-fallback' : 'provider-item');
  const defaultAssociationProvenance = evidenceKind === 'local-fallback' ? 'local-fallback' : 'upstream-field';
  const image = explicitImageField(item);
  const providedTime = item.time !== undefined && item.time !== null && String(item.time).trim();
  return {
    title: String(item.title || '').trim(),
    source,
    time: item.time || nowIso(),
    timeProvenance: item.timeProvenance || (providedTime ? 'upstream-field' : 'generated-at-normalization'),
    summary: item.summary || '',
    link: item.link || '#',
    type: item.type || 'market',
    relatedStocks,
    relatedSectors,
    associationProvenance: {
      relatedStocks: item.associationProvenance && item.associationProvenance.relatedStocks
        ? item.associationProvenance.relatedStocks : defaultAssociationProvenance,
      relatedSectors: item.associationProvenance && item.associationProvenance.relatedSectors
        ? item.associationProvenance.relatedSectors : defaultAssociationProvenance
    },
    evidenceKind,
    provider: item.provider || source,
    sourcePriority: item.sourcePriority && typeof item.sourcePriority === 'object'
      ? {
          value: item.sourcePriority.value,
          field: item.sourcePriority.field || null,
          provenance: item.sourcePriority.provenance || null
        }
      : null,
    imageProvider: image ? (item.imageProvider || item.provider || source) : null,
    imageUrl: image ? image.value : null,
    imageSourceField: image ? image.sourceField : null
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

function setProviderMetadata(items, sourceName) {
  return (items || []).map(item => {
    if (!item || typeof item !== 'object') return item;
    return Object.assign({}, item, {
      source: item.source || sourceName || 'WebStock',
      provider: item.provider || sourceName || item.source || 'WebStock',
      imageProvider: item.imageProvider || (explicitImageField(item) ? (sourceName || item.source || 'WebStock') : null)
    });
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
  return {
    name: options.name || 'sina-finance-roll',
    async list(filters = {}) {
      const days = Math.min(Math.max(Number(filters.days) || options.days || 7, 1), 14);
      const pages = Math.min(Math.max(Number(filters.pages) || options.pages || 7, 1), 10);
      const num = Math.min(Math.max(Number(filters.num) || options.num || 50, 10), 80);
      const since = Date.now() - days * 24 * 60 * 60 * 1000;
      const tasks = [];
      for (const lid of lids) {
        for (let page = 1; page <= pages; page++) {
          tasks.push({ lid, page });
        }
      }
      const lists = await Promise.all(tasks.map(async function(task) {
        const response = await axios.get(url, {
          timeout: options.timeoutMs || 7000,
          params: {
            pageid,
            lid: task.lid,
            num,
            page: task.page,
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
      return lists.flat().filter(function(item) {
        const seconds = Number(item.ctime || item.mtime);
        if (!Number.isFinite(seconds) || seconds <= 0) return true;
        return seconds * 1000 >= since;
      }).sort(function(a, b) {
        return Number(b.ctime || b.mtime || 0) - Number(a.ctime || a.mtime || 0);
      }).map(function(item) {
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
        const rawTime = item.ctime || item.mtime;
        const rawSeconds = Number(rawTime);
        return normalizeNews({
          title: item.title || item.stitle || '',
          source: 'Sina Finance',
          time: sinaTimeToIso(rawTime),
          timeProvenance: Number.isFinite(rawSeconds) && rawSeconds > 0
            ? 'upstream-field' : 'generated-at-normalization',
          summary: item.intro || item.wapsummary || item.stitle || keywords.join('、'),
          link: item.url || '#',
          type: filters.type || 'market',
          relatedStocks,
          relatedSectors,
          associationProvenance: {
            relatedStocks: relatedStocks.length ? 'derived-text-match' : 'upstream-field',
            relatedSectors: filters.sector ? 'request-context' : 'upstream-keywords'
          },
          imageUrl: item.imageUrl,
          image_url: item.image_url,
          thumbnailUrl: item.thumbnailUrl,
          thumbnail_url: item.thumbnail_url,
          thumbnail: item.thumbnail,
          thumb: item.thumb,
          img: item.img,
          wap_thumb: item.wap_thumb
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
      const providerData = applyNewsFilters(dedupeNews(setProviderMetadata(provider.list(filters) || [], provider.name).map(normalizeNews)), filters);
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
      const providerData = applyNewsFilters(dedupeNews(setProviderMetadata(await provider.list(filters), provider.name).map(normalizeNews)), filters);
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
          degraded: providerStatuses.some(status => !status.ok)
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
