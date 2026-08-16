const fs = require('fs');
const path = require('path');

const portfolio = require('./portfolioService');

function loadSecurityCatalog(rootDir = path.join(__dirname, '..')) {
  const catalog = new Map();
  ['stocks.json', 'funds.json'].forEach(function(filename) {
    const rows = JSON.parse(fs.readFileSync(path.join(rootDir, filename), 'utf8'));
    rows.forEach(function(item) {
      const code = String(item && item.code || '').trim();
      const name = String(item && item.name || code).trim();
      if (/^\d{6}$/.test(code) && name) catalog.set(code, name);
    });
  });
  return catalog;
}

function parseSelfStockCache(text, catalog) {
  const payload = JSON.parse(String(text || ''));
  const data = payload && payload.Data || {};
  const rawCodes = String(data.Selfstock || '').split(',')[0].split('|').map(function(code) {
    return code.trim();
  }).filter(Boolean);
  const seen = new Set();
  const ignored = new Set();
  const items = [];

  rawCodes.forEach(function(code) {
    if (seen.has(code)) return;
    seen.add(code);
    if (!/^\d{6}$/.test(code) || !catalog.has(code)) {
      ignored.add(code);
      return;
    }
    items.push({ code, name: catalog.get(code) });
  });

  return {
    items,
    ignoredCodes: Array.from(ignored),
    sourceCount: Number(data.Count) || rawCodes.length,
    modifyTime: String(data.ModifyTime || '')
  };
}

function cacheCandidates(root) {
  if (!root || !fs.existsSync(root)) return [];
  const direct = path.join(root, 'SelfStockCache.json');
  const files = fs.existsSync(direct) ? [direct] : [];
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (error) { return files; }
  entries.filter(function(entry) { return entry.isDirectory(); }).forEach(function(entry) {
    const candidate = path.join(root, entry.name, 'SelfStockCache.json');
    if (fs.existsSync(candidate)) files.push(candidate);
  });
  return files;
}

function findNewestSelfStockCache(roots) {
  const candidates = (roots || []).flatMap(cacheCandidates).map(function(filename) {
    return { filename, mtimeMs: fs.statSync(filename).mtimeMs };
  }).sort(function(left, right) { return right.mtimeMs - left.mtimeMs; });
  return candidates.length ? candidates[0].filename : null;
}

function defaultUserRoots() {
  const override = String(process.env.WEBSTOCK_THS_USER_DIR || '').trim();
  if (override) return [override];
  const roots = [
    path.join('D:\\Program Files (x86)', '同花顺远航版', 'bin', 'users')
  ];
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  const programFiles = process.env.ProgramFiles;
  if (programFilesX86) roots.push(path.join(programFilesX86, '同花顺远航版', 'bin', 'users'));
  if (programFiles) roots.push(path.join(programFiles, '同花顺远航版', 'bin', 'users'));
  return Array.from(new Set(roots));
}

function readLocalSelfStock(options = {}) {
  const cachePath = options.cachePath || findNewestSelfStockCache(options.roots || defaultUserRoots());
  if (!cachePath) throw new Error('未找到同花顺本地自选文件，请先在同花顺电脑版登录并同步自选');
  const catalog = options.catalog || loadSecurityCatalog(options.rootDir);
  const parsed = parseSelfStockCache(fs.readFileSync(cachePath, 'utf8'), catalog);
  const stat = fs.statSync(cachePath);
  return Object.assign(parsed, {
    cachePath,
    fileUpdatedAt: stat.mtime.toISOString()
  });
}

function getStatus(options = {}) {
  try {
    const result = readLocalSelfStock(options);
    return {
      available: true,
      cachePath: result.cachePath,
      fileUpdatedAt: result.fileUpdatedAt,
      modifyTime: result.modifyTime,
      sourceCount: result.sourceCount,
      supportedCount: result.items.length,
      ignoredCount: result.ignoredCodes.length
    };
  } catch (error) {
    return { available: false, error: error.message };
  }
}

function syncLocalSelfStock(options = {}) {
  const result = readLocalSelfStock(options);
  const imported = portfolio.importWatchlistItems(result.items, {
    groupName: '同花顺自选',
    note: '同花顺本地自选增量同步'
  });
  return Object.assign({}, imported, {
    modifyTime: result.modifyTime,
    fileUpdatedAt: result.fileUpdatedAt,
    ignoredCount: result.ignoredCodes.length,
    cachePath: result.cachePath
  });
}

module.exports = {
  loadSecurityCatalog,
  parseSelfStockCache,
  findNewestSelfStockCache,
  readLocalSelfStock,
  getStatus,
  syncLocalSelfStock
};
