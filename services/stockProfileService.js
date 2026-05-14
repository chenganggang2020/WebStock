const axios = require('axios');
const db = require('../db');
const themeService = require('./themeService');

const EASTMONEY_F10_BASE = 'https://emweb.securities.eastmoney.com/PC_HSF10';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function isExternalDisabled() {
  return process.env.WEBSTOCK_STOCK_PROFILE_OFFLINE === '1' || process.env.NODE_ENV === 'test';
}

function eastmoneyCode(code) {
  const normalized = themeService.normalizeCode(code);
  if (/^(6|5|9)/.test(normalized)) return 'SH' + normalized;
  if (/^(8|4|92)/.test(normalized)) return 'BJ' + normalized;
  return 'SZ' + normalized;
}

function unique(items) {
  return (items || []).filter(Boolean).filter(function(item, index, arr) {
    return arr.indexOf(item) === index;
  });
}

function shortText(value, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const limit = maxLength || 160;
  return text.length > limit ? text.slice(0, limit) + '...' : text;
}

function latestMainItems(rows) {
  const items = Array.isArray(rows) ? rows : [];
  if (!items.length) return [];
  const latestDate = items.map(function(item) {
    return item.REPORT_DATE || '';
  }).filter(Boolean).sort().pop();
  const seen = new Set();
  return items.filter(function(item) {
    return !latestDate || item.REPORT_DATE === latestDate;
  }).sort(function(a, b) {
    return Number(a.RANK || 99) - Number(b.RANK || 99);
  }).filter(function(item) {
    const name = item.ITEM_NAME || '';
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return true;
  }).slice(0, 6).map(function(item) {
    return {
      name: item.ITEM_NAME || '',
      ratio: item.MBI_RATIO == null ? null : Number((Number(item.MBI_RATIO) * 100).toFixed(2)),
      reportDate: item.REPORT_DATE || ''
    };
  }).filter(function(item) { return item.name; });
}

function buildBusinessSummary(business, core) {
  const review = business && business.jyps && business.jyps[0] ? business.jyps[0].BUSINESS_REVIEW : '';
  const scope = business && business.zyfw && business.zyfw[0] ? business.zyfw[0].BUSINESS_SCOPE : '';
  const coreScope = (core && core.hxtc || []).find(function(item) {
    return item.KEYWORD === '经营范围' || item.KEY_CLASSIF === '经营范围';
  });
  return shortText(review || scope || (coreScope && coreScope.MAINPOINT_CONTENT), 220);
}

function parseProfile(code, survey, core, business) {
  const base = survey && survey.jbzl && survey.jbzl[0] ? survey.jbzl[0] : {};
  const boards = (core && Array.isArray(core.ssbk) ? core.ssbk : [])
    .sort(function(a, b) { return Number(a.BOARD_RANK || 999) - Number(b.BOARD_RANK || 999); })
    .map(function(item) { return item.BOARD_NAME || ''; });
  const mainItems = latestMainItems(business && business.zygcfx);
  const businessSummary = buildBusinessSummary(business, core);
  const businessScope = business && business.zyfw && business.zyfw[0] ? business.zyfw[0].BUSINESS_SCOPE : '';
  const marketOnly = themeService.decorateStock({ code });
  const industry = base.EM2016 || base.INDUSTRYCSRC1 || '';
  const industryTags = unique([industry, base.INDUSTRYCSRC1].concat(boards.slice(0, 8)));
  const allTags = unique((marketOnly.tags || []).concat(industryTags).concat(mainItems.slice(0, 3).map(function(item) {
    return item.name;
  }))).slice(0, 16);

  return Object.assign({}, marketOnly, {
    code: themeService.normalizeCode(code),
    name: base.SECURITY_NAME_ABBR || marketOnly.name || '',
    source: 'Eastmoney F10',
    sourceUrl: 'https://emweb.securities.eastmoney.com/PC_HSF10/CompanySurvey/Index?code=' + eastmoneyCode(code) + '&type=web',
    securityType: base.SECURITY_TYPE || '',
    exchange: base.TRADE_MARKET || '',
    companyName: base.ORG_NAME || '',
    industry,
    csrcIndustry: base.INDUSTRYCSRC1 || '',
    boards: unique(boards).slice(0, 24),
    mainBusinessItems: mainItems,
    businessScope: shortText(businessScope, 320),
    businessSummary,
    tags: allTags,
    fetchedAt: new Date().toISOString()
  });
}

function readCache(code) {
  const normalized = themeService.normalizeCode(code);
  const row = db.prepare('SELECT payload_json, fetched_at FROM stock_profiles WHERE code = ?').get(normalized);
  if (!row) return null;
  try {
    const payload = JSON.parse(row.payload_json || '{}');
    payload.cached = true;
    payload.fetchedAt = payload.fetchedAt || row.fetched_at;
    return payload;
  } catch (error) {
    return null;
  }
}

function isFresh(profile) {
  if (!profile || !profile.fetchedAt) return false;
  const time = new Date(profile.fetchedAt).getTime();
  return Number.isFinite(time) && Date.now() - time < CACHE_TTL_MS;
}

function saveCache(profile) {
  const payload = JSON.stringify(profile);
  db.prepare(`
    INSERT INTO stock_profiles (code, source, payload_json, fetched_at, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(code) DO UPDATE SET
      source = excluded.source,
      payload_json = excluded.payload_json,
      fetched_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `).run(profile.code, profile.source || 'Eastmoney F10', payload);
  return profile;
}

async function f10Get(path, code) {
  const response = await axios.get(EASTMONEY_F10_BASE + path + '/PageAjax', {
    timeout: 8000,
    params: { code: eastmoneyCode(code) },
    headers: {
      Referer: 'https://emweb.securities.eastmoney.com/',
      'User-Agent': 'Mozilla/5.0 WebStock'
    }
  });
  return response.data || {};
}

async function fetchProfile(code) {
  if (isExternalDisabled()) return themeService.decorateStock({ code: themeService.normalizeCode(code) });
  const normalized = themeService.normalizeCode(code);
  const [survey, core, business] = await Promise.all([
    f10Get('/CompanySurvey', normalized),
    f10Get('/CoreConception', normalized),
    f10Get('/BusinessAnalysis', normalized)
  ]);
  return saveCache(parseProfile(normalized, survey, core, business));
}

async function getProfile(code, options = {}) {
  const normalized = themeService.normalizeCode(code);
  if (!normalized) return null;
  const cached = readCache(normalized);
  if (!options.refresh && isFresh(cached)) return cached;
  if (isExternalDisabled()) return Object.assign({}, themeService.decorateStock({ code: normalized }), cached || {});
  try {
    return await fetchProfile(normalized);
  } catch (error) {
    return Object.assign({}, themeService.decorateStock({ code: normalized }), cached || {}, {
      error: error.message || String(error),
      degraded: true
    });
  }
}

async function mapLimit(items, limit, worker) {
  const result = [];
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async function() {
    while (index < items.length) {
      const item = items[index++];
      result.push(await worker(item));
    }
  });
  await Promise.all(runners);
  return result;
}

async function getProfiles(codes, options = {}) {
  const uniqueCodes = unique((codes || []).map(themeService.normalizeCode)).slice(0, Number(options.limit) || 80);
  if (!options.detail) {
    return uniqueCodes.map(function(code) {
      return Object.assign({}, themeService.decorateStock({ code }), readCache(code) || {});
    });
  }
  return mapLimit(uniqueCodes, 4, function(code) {
    return getProfile(code, options);
  });
}

module.exports = {
  eastmoneyCode,
  getProfile,
  getProfiles,
  parseProfile,
  readCache
};
