const db = require('../db');
const themeService = require('./themeService');

let indexChecked = false;

function unique(items) {
  return (items || []).filter(Boolean).filter(function(item, index, arr) {
    return arr.indexOf(item) === index;
  });
}

function compact(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function fuzzyMatch(query, target) {
  const q = compact(query);
  const t = compact(target);
  if (!q) return true;
  if (t.includes(q)) return true;
  let qi = 0;
  for (let ti = 0; qi < q.length && ti < t.length; ti++) {
    if (q[qi] === t[ti]) qi++;
  }
  return qi === q.length;
}

function text(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || '');
  } catch (error) {
    return fallback;
  }
}

function businessItemText(items) {
  return (items || []).map(function(item) {
    if (!item || !item.name) return '';
    const ratio = item.ratio == null ? '' : ' ' + item.ratio + '%';
    return item.name + ratio;
  }).filter(Boolean).join(' ');
}

function toIndexPayload(profile) {
  const decorated = themeService.decorateStock(profile || {});
  const mainBusinessItems = Array.isArray(decorated.mainBusinessItems) ? decorated.mainBusinessItems : [];
  const boards = unique(decorated.boards || []);
  const tags = unique((decorated.tags || []).concat((decorated.themes || []).map(function(theme) { return theme.name; })));
  const searchText = [
    decorated.code,
    decorated.name,
    decorated.industry,
    decorated.csrcIndustry,
    boards.join(' '),
    businessItemText(mainBusinessItems),
    decorated.businessScope,
    decorated.businessSummary,
    tags.join(' '),
    (decorated.themes || []).map(function(theme) {
      return [theme.name, theme.role, theme.reason].join(' ');
    }).join(' ')
  ].join(' ');
  return {
    code: themeService.normalizeCode(decorated.code),
    name: text(decorated.name),
    industry: text(decorated.industry || decorated.csrcIndustry),
    boardsText: boards.join(' '),
    businessScope: text(decorated.businessScope),
    businessSummary: text(decorated.businessSummary),
    mainBusinessJson: JSON.stringify(mainBusinessItems),
    tagsText: tags.join(' '),
    searchText: compact(searchText),
    source: decorated.source || ''
  };
}

function upsertProfile(profile) {
  const payload = toIndexPayload(profile);
  if (!payload.code || !payload.searchText) return null;
  db.prepare(`
    INSERT INTO stock_search_index (
      code, name, industry, boards_text, business_scope, business_summary,
      main_business_json, tags_text, search_text, source, updated_at
    ) VALUES (
      @code, @name, @industry, @boardsText, @businessScope, @businessSummary,
      @mainBusinessJson, @tagsText, @searchText, @source, CURRENT_TIMESTAMP
    )
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name,
      industry = excluded.industry,
      boards_text = excluded.boards_text,
      business_scope = excluded.business_scope,
      business_summary = excluded.business_summary,
      main_business_json = excluded.main_business_json,
      tags_text = excluded.tags_text,
      search_text = excluded.search_text,
      source = excluded.source,
      updated_at = CURRENT_TIMESTAMP
  `).run(payload);
  return payload;
}

function rebuildFromProfiles() {
  const rows = db.prepare('SELECT payload_json FROM stock_profiles').all();
  rows.forEach(function(row) {
    const profile = parseJson(row.payload_json, null);
    if (profile && profile.code) upsertProfile(profile);
  });
  indexChecked = true;
  return rows.length;
}

function ensureIndex() {
  if (indexChecked) return;
  const profileCount = db.prepare('SELECT COUNT(*) AS count FROM stock_profiles').get().count;
  const indexCount = db.prepare('SELECT COUNT(*) AS count FROM stock_search_index').get().count;
  if (profileCount > indexCount) rebuildFromProfiles();
  indexChecked = true;
}

function rowToStock(row, baseStock) {
  const mainBusinessItems = parseJson(row.main_business_json, []);
  const stock = Object.assign({}, baseStock || {}, themeService.decorateStock({
    code: row.code,
    name: row.name,
    industry: row.industry,
    boards: row.boards_text ? row.boards_text.split(/\s+/).filter(Boolean) : [],
    businessScope: row.business_scope,
    businessSummary: row.business_summary,
    mainBusinessItems,
    tags: row.tags_text ? row.tags_text.split(/\s+/).filter(Boolean) : []
  }));
  stock.matchReason = stockMatchReason(row);
  stock.searchIndexed = true;
  return stock;
}

function stockMatchReason(row) {
  const businessItems = parseJson(row.main_business_json, []);
  if (businessItems.length) return '主营：' + businessItems.slice(0, 3).map(function(item) {
    return item.ratio == null ? item.name : item.name + ' ' + item.ratio + '%';
  }).join(' / ');
  if (row.industry) return '行业：' + row.industry;
  if (row.boards_text) return '板块：' + row.boards_text.split(/\s+/).slice(0, 3).join(' / ');
  return '资料库匹配';
}

function localScore(query, row) {
  const q = compact(query);
  const code = compact(row.code);
  const name = compact(row.name);
  const industry = compact(row.industry);
  const business = compact(businessItemText(parseJson(row.main_business_json, [])));
  const boards = compact(row.boards_text);
  const scope = compact(row.business_scope + ' ' + row.business_summary + ' ' + row.tags_text);
  if (code === q) return 120;
  if (code.startsWith(q)) return 105;
  if (name.includes(q)) return 95;
  if (industry.includes(q)) return 88;
  if (business.includes(q)) return 84;
  if (boards.includes(q)) return 78;
  if (scope.includes(q)) return 68;
  return 50;
}

function search(query, options = {}) {
  const q = compact(query);
  if (!q) return { query: '', stocks: [], themes: [] };
  ensureIndex();
  const rows = db.prepare(`
    SELECT *
    FROM stock_search_index
    WHERE search_text LIKE ?
       OR code LIKE ?
       OR name LIKE ?
       OR industry LIKE ?
    LIMIT ?
  `).all('%' + q + '%', q + '%', '%' + text(query) + '%', '%' + text(query) + '%', Math.min(Number(options.limit) || 80, 160));
  const seen = new Set(rows.map(function(row) { return row.code; }));
  if (rows.length < (Number(options.limit) || 80)) {
    db.prepare('SELECT * FROM stock_search_index LIMIT 5000').all().forEach(function(row) {
      if (seen.has(row.code) || !fuzzyMatch(q, row.search_text)) return;
      seen.add(row.code);
      rows.push(row);
    });
  }
  const baseMap = new Map((options.baseStocks || []).map(function(stock) { return [themeService.normalizeCode(stock.code), stock]; }));
  const stocks = rows.map(function(row) {
    const stock = rowToStock(row, baseMap.get(row.code));
    stock.score = localScore(query, row);
    return stock;
  }).sort(function(a, b) {
    return (b.score || 0) - (a.score || 0);
  });
  return {
    query: text(query),
    stocks,
    themes: themeService.searchThemes(query)
  };
}

module.exports = {
  rebuildFromProfiles,
  search,
  fuzzyMatch,
  toIndexPayload,
  upsertProfile
};
