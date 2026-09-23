const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

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

function parseSelfStockInfo(text, catalog) {
  const payload = JSON.parse(String(text || ''));
  if (!Array.isArray(payload)) throw new Error('同花顺新版自选文件格式不正确');
  const seen = new Set();
  const ignored = new Set();
  const items = [];
  let modifyTime = '';

  payload.forEach(function(row) {
    const code = String(row && row.C || '').trim();
    const market = String(row && row.M || '').trim();
    const rowTime = String(row && row.T || '').trim();
    if (rowTime > modifyTime) modifyTime = rowTime;
    if (!code || seen.has(code)) return;
    seen.add(code);
    if (!/^\d{6}$/.test(code) || (!catalog.has(code) && market !== '17' && market !== '33')) {
      ignored.add(code);
      return;
    }
    items.push({ code, name: catalog.get(code) || code });
  });

  return {
    items,
    ignoredCodes: Array.from(ignored),
    sourceCount: payload.length,
    modifyTime
  };
}

function decodeTonghuashunText(filename) {
  const source = fs.readFileSync(filename);
  const utf8 = source.toString('utf8');
  return utf8.includes('\uFFFD') ? iconv.decode(source, 'gbk') : utf8;
}

function parseCustomBlockNames(text) {
  const names = new Map();
  let inNameSection = false;
  String(text || '').split(/\r?\n/).forEach(function(line) {
    const trimmed = line.trim();
    if (/^\[BLOCK_NAME_MAP_TABLE\]$/i.test(trimmed)) {
      inNameSection = true;
      return;
    }
    if (/^\[.+\]$/.test(trimmed)) {
      inNameSection = false;
      return;
    }
    if (!inNameSection) return;
    const match = trimmed.match(/^([0-9A-F]+)=(.+)$/i);
    if (match) names.set(match[1].toUpperCase(), match[2].trim());
  });
  return names;
}

function parseCustomBlockCatalog(userDir, catalog) {
  const customDir = path.join(userDir, 'custom_block');
  const iniPath = path.join(userDir, 'stockblock.ini');
  if (!fs.existsSync(iniPath) || !fs.existsSync(customDir)) {
    return { groups: [], groupCount: 0, fileUpdatedAt: null };
  }
  const names = parseCustomBlockNames(decodeTonghuashunText(iniPath));
  const orderPath = path.join(customDir, '0');
  let order = Array.from(names.keys());
  if (fs.existsSync(orderPath)) {
    const payload = JSON.parse(fs.readFileSync(orderPath, 'utf8'));
    const listed = String(payload && payload.sortstr || '').split(',').map(function(value) {
      return value.trim().toUpperCase();
    }).filter(Boolean);
    if (listed.length) order = listed.filter(function(id) { return names.has(id); });
  }
  const groups = [];
  let newestMtime = fs.statSync(iniPath).mtimeMs;
  order.forEach(function(hexId) {
    const blockPath = path.join(customDir, String(parseInt(hexId, 16)));
    if (!fs.existsSync(blockPath)) return;
    const payload = JSON.parse(fs.readFileSync(blockPath, 'utf8'));
    const parts = String(payload && payload.context || '').split(',', 2);
    const codes = String(parts[0] || '').split('|').map(function(value) { return value.trim(); }).filter(Boolean);
    const markets = String(parts[1] || '').split('|').map(function(value) { return value.trim(); });
    const seen = new Set();
    const ignoredCodes = [];
    const items = [];
    codes.forEach(function(code, index) {
      if (seen.has(code)) return;
      seen.add(code);
      if (markets[index] === '48' || !/^\d{6}$/.test(code) ||
          (!catalog.has(code) && markets[index] !== '17' && markets[index] !== '33')) {
        ignoredCodes.push(code);
        return;
      }
      items.push({ code, name: catalog.get(code) || code });
    });
    newestMtime = Math.max(newestMtime, fs.statSync(blockPath).mtimeMs);
    groups.push({
      id: hexId,
      name: names.get(hexId),
      rawCodes: codes,
      items,
      ignoredCodes,
      sourcePath: blockPath
    });
  });
  return {
    groups,
    groupCount: groups.length,
    fileUpdatedAt: new Date(newestMtime).toISOString(),
    iniPath,
    customDir
  };
}

function cacheCandidates(root) {
  if (!root || !fs.existsSync(root)) return [];
  const filenames = ['SelfStockCache.json', 'SelfStockInfo.json'];
  const files = filenames.map(function(filename) {
    return path.join(root, filename);
  }).filter(function(filename) { return fs.existsSync(filename); });
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (error) { return files; }
  entries.filter(function(entry) { return entry.isDirectory(); }).forEach(function(entry) {
    filenames.forEach(function(filename) {
      const candidate = path.join(root, entry.name, filename);
      if (fs.existsSync(candidate)) files.push(candidate);
    });
  });
  return files;
}

function findNewestSelfStockCache(roots) {
  const candidates = (roots || []).flatMap(cacheCandidates).filter(function(filename) {
    return path.basename(filename).toLowerCase() === 'selfstockcache.json';
  }).map(function(filename) {
    return { filename, mtimeMs: fs.statSync(filename).mtimeMs };
  }).sort(function(left, right) { return right.mtimeMs - left.mtimeMs; });
  return candidates.length ? candidates[0].filename : null;
}

function findNewestSelfStockFile(roots) {
  const candidates = (roots || []).flatMap(cacheCandidates).map(function(filename) {
    return { filename, mtimeMs: fs.statSync(filename).mtimeMs };
  }).sort(function(left, right) { return right.mtimeMs - left.mtimeMs; });
  return candidates.length ? candidates[0].filename : null;
}

function defaultUserRoots() {
  const override = String(process.env.WEBSTOCK_THS_USER_DIR || '').trim();
  if (override) return [override];
  const roots = [
    path.join('D:\\', '同花顺软件', '同花顺'),
    path.join('D:\\Program Files (x86)', '同花顺远航版', 'bin', 'users')
  ];
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  const programFiles = process.env.ProgramFiles;
  if (programFilesX86) roots.push(path.join(programFilesX86, '同花顺远航版', 'bin', 'users'));
  if (programFiles) roots.push(path.join(programFiles, '同花顺远航版', 'bin', 'users'));
  return Array.from(new Set(roots));
}

function readLocalSelfStock(options = {}) {
  const cachePath = options.cachePath || findNewestSelfStockFile(options.roots || defaultUserRoots());
  if (!cachePath) throw new Error('未找到同花顺本地自选文件，请先在同花顺电脑版登录并同步自选');
  const catalog = options.catalog || loadSecurityCatalog(options.rootDir);
  const source = fs.readFileSync(cachePath, 'utf8');
  const parsed = path.basename(cachePath).toLowerCase() === 'selfstockinfo.json'
    ? parseSelfStockInfo(source, catalog)
    : parseSelfStockCache(source, catalog);
  const stat = fs.statSync(cachePath);
  return Object.assign(parsed, {
    cachePath,
    fileUpdatedAt: stat.mtime.toISOString()
  });
}

function readLocalCatalog(options = {}) {
  const selfStock = readLocalSelfStock(options);
  const catalog = options.catalog || loadSecurityCatalog(options.rootDir);
  const userDir = options.userDir || path.dirname(selfStock.cachePath);
  const custom = parseCustomBlockCatalog(userDir, catalog);
  return {
    available: true,
    cachePath: selfStock.cachePath,
    fileUpdatedAt: selfStock.fileUpdatedAt,
    modifyTime: selfStock.modifyTime,
    sourceCount: selfStock.sourceCount,
    supportedCount: selfStock.items.length,
    ignoredCount: selfStock.ignoredCodes.length,
    customGroupCount: custom.groupCount,
    customFileUpdatedAt: custom.fileUpdatedAt,
    groups: [{
      id: 'default-self-stock',
      name: '同花顺自选',
      items: selfStock.items,
      ignoredCodes: selfStock.ignoredCodes,
      sourcePath: selfStock.cachePath
    }].concat(custom.groups)
  };
}

function getStatus(options = {}) {
  try {
    const result = readLocalCatalog(options);
    return {
      available: true,
      cachePath: result.cachePath,
      fileUpdatedAt: result.fileUpdatedAt,
      modifyTime: result.modifyTime,
      sourceCount: result.sourceCount,
      supportedCount: result.supportedCount,
      ignoredCount: result.ignoredCount,
      customGroupCount: result.customGroupCount,
      customFileUpdatedAt: result.customFileUpdatedAt
    };
  } catch (error) {
    return { available: false, error: error.message };
  }
}

function previewLocalDiff(options = {}) {
  const localCatalog = options.localCatalog || readLocalCatalog(options);
  const groups = Array.isArray(localCatalog.groups) ? localCatalog.groups : [];
  const groupId = String(options.groupId || 'default-self-stock').trim();
  const group = groups.find(function(item) { return String(item.id || '') === groupId; });
  if (!group) throw new Error('未找到指定的同花顺自选分组');

  const tonghuashunItems = Array.isArray(group.items) ? group.items : [];
  const webstockItems = Array.isArray(options.webstockItems)
    ? options.webstockItems
    : portfolio.listWatchlist({});
  const tonghuashunCodes = new Set(tonghuashunItems.map(function(item) { return String(item.code); }));
  const webstockCodes = new Set(webstockItems.map(function(item) { return String(item.code); }));

  return {
    schema: 'webstock.tonghuashun-watchlist-diff.v1',
    readOnly: true,
    checkedAt: new Date().toISOString(),
    source: {
      path: String(group.sourcePath || localCatalog.cachePath || ''),
      fileUpdatedAt: String(localCatalog.fileUpdatedAt || '')
    },
    group: {
      id: String(group.id || ''),
      name: String(group.name || ''),
      tonghuashunCount: tonghuashunCodes.size,
      webstockCount: webstockCodes.size
    },
    onlyInTonghuashun: tonghuashunItems.filter(function(item) {
      return !webstockCodes.has(String(item.code));
    }),
    onlyInWebStock: webstockItems.filter(function(item) {
      return !tonghuashunCodes.has(String(item.code));
    }).map(function(item) {
      return { code: String(item.code), name: String(item.name || item.code) };
    }),
    shared: tonghuashunItems.filter(function(item) {
      return webstockCodes.has(String(item.code));
    })
  };
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
  parseSelfStockInfo,
  parseCustomBlockCatalog,
  findNewestSelfStockCache,
  findNewestSelfStockFile,
  readLocalSelfStock,
  readLocalCatalog,
  getStatus,
  previewLocalDiff,
  syncLocalSelfStock
};
