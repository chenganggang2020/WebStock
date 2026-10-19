const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const iconv = require('iconv-lite');

const portfolio = require('./portfolioService');
const { loadSecurityCatalog } = require('./tonghuashunWatchlistService');

const SYNC_ACCOUNT_KEY = 'tonghuashun-local-sync';
const HOLDING_EXPORT_NAME = /^(?:webstock[-_ ]?)?(?:同花顺)?(?:持仓|持仓导出|holding|holdings|position|positions).*\.(?:csv|tsv|txt|json)$/i;
let latestWindowCaptureStatus = null;

const FIELD_ALIASES = {
  code: ['code', '证券代码', '股票代码', '代码'],
  name: ['name', '证券名称', '股票名称', '名称'],
  quantity: ['quantity', '股票余额', '持仓数量', '当前持仓', '证券数量', '股份余额', '数量'],
  avgCost: ['avgcost', 'costprice', '成本价', '成本价格', '持仓成本价', '参考成本'],
  costValue: ['costvalue', '持仓成本', '成本金额', '成本市值'],
  currentPrice: ['currentprice', 'price', '当前价', '市价', '现价', '最新价'],
  marketValue: ['marketvalue', '市值', '股票市值'],
  pnl: ['pnl', '浮动盈亏', '盈亏', '参考盈亏', '总盈亏'],
  pnlRate: ['pnlrate', '盈亏比例', '盈亏比', '收益率']
};

function round(value, digits = 4) {
  const factor = Math.pow(10, digits);
  return Math.round(Number(value) * factor) / factor;
}

function heading(value) {
  return String(value == null ? '' : value).replace(/^\uFEFF/, '').replace(/[\s_()（）%％/]/g, '').toLowerCase();
}

function number(value) {
  if (value === undefined || value === null || value === '') return null;
  const clean = String(value).trim().replace(/[,，￥¥元股%％+]/g, '');
  if (!clean || clean === '--' || clean === '-') return null;
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : null;
}

function valueFor(row, field) {
  const aliases = new Set(FIELD_ALIASES[field].map(heading));
  const key = Object.keys(row || {}).find(function(name) { return aliases.has(heading(name)); });
  return key === undefined ? undefined : row[key];
}

function normalizeHolding(row, catalog) {
  const code = String(valueFor(row, 'code') || '').trim().replace(/\D/g, '').slice(-6);
  if (!/^\d{6}$/.test(code)) return null;
  const quantity = Math.trunc(number(valueFor(row, 'quantity')) || 0);
  const avgCost = number(valueFor(row, 'avgCost'));
  const explicitCostValue = number(valueFor(row, 'costValue'));
  const costValue = explicitCostValue !== null ? explicitCostValue : avgCost !== null ? avgCost * quantity : 0;
  const explicitCurrentPrice = number(valueFor(row, 'currentPrice'));
  const explicitMarketValue = number(valueFor(row, 'marketValue'));
  const currentPrice = explicitCurrentPrice !== null
    ? explicitCurrentPrice
    : explicitMarketValue !== null && quantity > 0 ? explicitMarketValue / quantity : null;
  const marketValue = explicitMarketValue !== null
    ? explicitMarketValue
    : currentPrice !== null ? currentPrice * quantity : null;
  const name = String(valueFor(row, 'name') || catalog.get(code) || '').trim();
  if (!name) throw new Error(code + ' 缺少证券名称');
  if (quantity <= 0 || costValue <= 0) throw new Error(code + ' 的持仓数量或成本无效');
  return {
    code,
    name,
    quantity,
    costValue: round(costValue),
    currentPrice: currentPrice === null ? null : round(currentPrice, 3),
    marketValue: marketValue === null ? null : round(marketValue, 2),
    pnl: number(valueFor(row, 'pnl')),
    pnlRate: number(valueFor(row, 'pnlRate'))
  };
}

function splitDelimitedLine(line, delimiter) {
  if (delimiter === '\t') return line.split('\t').map(function(value) { return value.trim(); });
  const cells = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      cells.push(value.trim());
      value = '';
    } else {
      value += char;
    }
  }
  cells.push(value.trim());
  return cells;
}

function parseTabular(text, catalog) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(function(line) { return line.trim(); });
  if (!lines.length) throw new Error('同花顺持仓表至少需要表头');
  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const headers = splitDelimitedLine(lines[0], delimiter);
  const normalizedHeaders = headers.map(heading);
  ['code', 'quantity'].forEach(function(field) {
    const found = FIELD_ALIASES[field].some(function(alias) { return normalizedHeaders.includes(heading(alias)); });
    if (!found) throw new Error('同花顺持仓表缺少“' + FIELD_ALIASES[field][1] + '”列');
  });
  const hasCost = FIELD_ALIASES.avgCost.concat(FIELD_ALIASES.costValue).some(function(alias) {
    return normalizedHeaders.includes(heading(alias));
  });
  if (!hasCost) throw new Error('同花顺持仓表缺少成本价或持仓成本列');

  const holdings = [];
  const seen = new Set();
  lines.slice(1).forEach(function(line) {
    const cells = splitDelimitedLine(line, delimiter);
    const row = {};
    headers.forEach(function(header, index) { row[header] = cells[index]; });
    const holding = normalizeHolding(row, catalog);
    if (!holding || seen.has(holding.code)) return;
    seen.add(holding.code);
    holdings.push(holding);
  });
  if (!holdings.length) throw new Error('没有从同花顺持仓表中识别出有效持仓；空仓需要完整 JSON 及账户资产对账');
  return { holdings, sourceCount: lines.length - 1 };
}

function parseJson(text, catalog) {
  const payload = JSON.parse(String(text || ''));
  const rows = Array.isArray(payload) ? payload : payload && payload.holdings;
  if (!Array.isArray(rows)) throw new Error('同花顺持仓 JSON 缺少 holdings 数组');
  const seen = new Set();
  const holdings = [];
  rows.forEach(function(row, index) {
    const holding = normalizeHolding(row, catalog);
    if (!holding) throw new Error('同花顺持仓 JSON 第 ' + (index + 1) + ' 行无法识别为有效持仓');
    if (seen.has(holding.code)) throw new Error(holding.code + ' 在同花顺持仓 JSON 中重复');
    seen.add(holding.code);
    holdings.push(holding);
  });
  const explicitHoldingList = payload && !Array.isArray(payload) && Array.isArray(payload.holdings);
  if (!holdings.length && (!explicitHoldingList || rows.length)) throw new Error('同花顺持仓 JSON 中没有识别出有效持仓');
  const parsed = {
    holdings,
    holdingsComplete: payload && payload.holdingsComplete === true,
    sourceCount: rows.length,
    snapshotDate: String(payload && payload.snapshotDate || ''),
    cashBalance: number(payload && payload.cashBalance),
    totalMarketValue: number(payload && payload.totalMarketValue),
    totalAssets: number(payload && payload.totalAssets),
    todayPnl: number(payload && payload.todayPnl),
    totalPnl: number(payload && payload.totalPnl)
  };
  if (!holdings.length) portfolio.validateEmptyHoldingSnapshot(parsed);
  return parsed;
}

function parseHoldingText(text, options = {}) {
  const source = String(text || '').trim();
  if (!source) throw new Error('同花顺持仓内容为空');
  if (source.length > 2 * 1024 * 1024) throw new Error('同花顺持仓内容超过 2MB，已拒绝读取');
  const catalog = options.catalog || loadSecurityCatalog(options.rootDir);
  return /^[\[{]/.test(source) ? parseJson(source, catalog) : parseTabular(source, catalog);
}

function holdingFileCandidates(root) {
  if (!root || !fs.existsSync(root)) return [];
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (error) { return []; }
  return entries.filter(function(entry) {
    return entry.isFile() && HOLDING_EXPORT_NAME.test(entry.name);
  }).map(function(entry) { return path.join(root, entry.name); });
}

function findNewestHoldingFile(roots) {
  const override = String(process.env.WEBSTOCK_THS_HOLDINGS_FILE || '').trim();
  if (override && fs.existsSync(override)) return override;
  const files = (roots || []).flatMap(holdingFileCandidates).map(function(filename) {
    return { filename, mtimeMs: fs.statSync(filename).mtimeMs };
  }).sort(function(left, right) { return right.mtimeMs - left.mtimeMs; });
  return files.length ? files[0].filename : null;
}

function defaultHoldingRoots() {
  const override = String(process.env.WEBSTOCK_THS_HOLDINGS_DIR || '').trim();
  if (override) return override.split(path.delimiter).filter(Boolean);
  const installRoot = path.join('D:\\', '同花顺软件', '同花顺');
  const roots = [path.join(installRoot, 'download')];
  if (fs.existsSync(installRoot)) {
    let entries = [];
    try { entries = fs.readdirSync(installRoot, { withFileTypes: true }); } catch (error) {}
    entries.filter(function(entry) { return entry.isDirectory(); }).forEach(function(entry) {
      const profile = path.join(installRoot, entry.name);
      if (fs.existsSync(path.join(profile, 'SelfStockInfo.json')) || fs.existsSync(path.join(profile, 'SelfStockCache.json'))) {
        roots.push(profile);
      }
    });
  }
  return roots;
}

function decodeHoldingFile(filename) {
  const buffer = fs.readFileSync(filename);
  const utf8 = buffer.toString('utf8');
  if (!utf8.includes('\uFFFD') && (/^[\s\uFEFF]*[\[{]/.test(utf8) || /证券代码|股票代码|持仓数量|股票余额/.test(utf8))) return utf8;
  return iconv.decode(buffer, 'gb18030');
}

function readLocalHoldingSnapshot(options = {}) {
  const filename = options.filename || findNewestHoldingFile(options.roots || defaultHoldingRoots());
  if (!filename) {
    throw new Error('未找到同花顺持仓导出文件；交易持仓没有以可安全读取的明文文件落盘');
  }
  const decoded = decodeHoldingFile(filename);
  const parsed = parseHoldingText(decoded, options);
  return Object.assign(parsed, {
    filename,
    fileUpdatedAt: fs.statSync(filename).mtime.toISOString(),
    fileFingerprint: crypto.createHash('sha256').update(decoded).digest('hex')
  });
}

function getStatus(options = {}) {
  try {
    const parsed = readLocalHoldingSnapshot(options);
    return {
      available: true,
      method: 'export-file',
      filename: parsed.filename,
      fileUpdatedAt: parsed.fileUpdatedAt,
      holdingCount: parsed.holdings.length,
      manualCopySupported: true
    };
  } catch (error) {
    return {
      available: false,
      method: 'manual-copy',
      manualCopySupported: true,
      error: error.message
    };
  }
}

function preview(parsed) {
  return {
    holdingCount: parsed.holdings.length,
    sourceCount: parsed.sourceCount,
    snapshotDate: parsed.snapshotDate || '',
    cashBalance: parsed.cashBalance,
    totalMarketValue: parsed.totalMarketValue,
    totalAssets: parsed.totalAssets,
    holdings: parsed.holdings,
    filename: parsed.filename || null,
    fileUpdatedAt: parsed.fileUpdatedAt || null
  };
}

function previewHoldingText(text, options = {}) {
  return preview(parseHoldingText(text, options));
}

function previewLocalHolding(options = {}) {
  return preview(readLocalHoldingSnapshot(options));
}

function beijingDateString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function shanghaiDate(value) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(value instanceof Date ? value : new Date(value));
}

function recordWindowCaptureStatus(result, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  latestWindowCaptureStatus = {
    available: Boolean(result && result.available),
    ready: Boolean(result && result.ready),
    method: 'windows-ocr',
    source: result && result.source || 'tonghuashun-window-ocr',
    observedAt: result && result.observedAt || '',
    checkedAt: now.toISOString(),
    error: String(result && result.error || '')
  };
  return latestWindowCaptureStatus;
}

function recentWindowCaptureStatus(now, options = {}) {
  if (!latestWindowCaptureStatus) return null;
  const checkedAt = new Date(latestWindowCaptureStatus.checkedAt);
  const configuredMaxAge = Number(options.windowStatusMaxAgeMs);
  const maxAgeMs = Number.isFinite(configuredMaxAge) && configuredMaxAge > 0
    ? configuredMaxAge
    : 60 * 1000;
  if (!Number.isFinite(checkedAt.getTime()) || now.getTime() - checkedAt.getTime() > maxAgeMs) return null;
  return latestWindowCaptureStatus;
}

function unavailableHoldingResult(automaticError, now, options = {}) {
  const windowStatus = recentWindowCaptureStatus(now, options);
  const exportError = automaticError ? automaticError.message : '没有本交易日可验证的同花顺持仓快照';
  return {
    available: false,
    ready: false,
    method: windowStatus ? 'windows-ocr' : 'manual-copy',
    source: '',
    snapshotDate: '',
    observedAt: '',
    holdings: [],
    holdingCount: 0,
    manualCopySupported: true,
    error: windowStatus && windowStatus.error
      ? windowStatus.error + '；导出文件备选：' + exportError
      : exportError
  };
}

function validateMonitorExport(parsed, now, options = {}) {
  const expectedDate = shanghaiDate(now);
  const snapshotDate = String(parsed.snapshotDate || shanghaiDate(parsed.fileUpdatedAt));
  if (snapshotDate !== expectedDate) {
    throw new Error('同花顺持仓导出不是本交易日：当前 ' + snapshotDate + '，需要 ' + expectedDate);
  }
  const configuredMaxAge = Number(options.maxAgeMs || process.env.WEBSTOCK_THS_HOLDINGS_MAX_AGE_MS);
  const maxAgeMs = Number.isFinite(configuredMaxAge) && configuredMaxAge > 0
    ? configuredMaxAge
    : 5 * 60 * 1000;
  const ageMs = now.getTime() - new Date(parsed.fileUpdatedAt).getTime();
  if (ageMs > maxAgeMs) {
    throw new Error('同花顺持仓导出已超过 ' + Math.ceil(maxAgeMs / 60000) + ' 分钟未更新，不能作为实时持仓');
  }
  return snapshotDate;
}

function ensureSyncAccount() {
  const existing = portfolio.listAccounts().find(function(account) { return account.accountKey === SYNC_ACCOUNT_KEY; });
  if (existing) return existing;
  return portfolio.createAccount({
    accountKey: SYNC_ACCOUNT_KEY,
    name: '同花顺同步账户',
    broker: '同花顺本地客户端',
    note: '只读持仓快照同步；不连接委托，不执行交易。'
  });
}

function syncParsedHolding(parsed, options = {}) {
  const account = options.accountId ? portfolio.getAccount(options.accountId) : ensureSyncAccount();
  const cashBalance = number(options.cashBalance);
  const dedupeKey = String(options.dedupeKey || '').trim();
  const sourceLabel = String(options.sourceLabel || '同花顺本地持仓同步') +
    (dedupeKey ? ' #' + dedupeKey.slice(0, 16) : '');
  const input = {
    snapshotDate: String(options.snapshotDate || parsed.snapshotDate || beijingDateString()),
    cashBalance: cashBalance === null ? (parsed.cashBalance === null || parsed.cashBalance === undefined ? account.cashBalance : parsed.cashBalance) : cashBalance,
    sourceLabel,
    holdings: parsed.holdings,
    holdingsComplete: parsed.holdingsComplete === true
  };
  ['totalMarketValue', 'totalAssets', 'todayPnl', 'totalPnl'].forEach(function(field) {
    const value = number(options[field]);
    const resolved = value === null ? parsed[field] : value;
    if (resolved !== null && resolved !== undefined) input[field] = resolved;
  });
  const latest = dedupeKey ? portfolio.getLatestSnapshot(account.id) : null;
  if (latest && latest.snapshotDate === input.snapshotDate && latest.sourceLabel === sourceLabel) {
    return { account, snapshot: latest, importedCount: parsed.holdings.length, unchanged: true };
  }
  return Object.assign(portfolio.syncHoldingSnapshot(account.id, input), { unchanged: false });
}

function syncHoldingText(text, options = {}) {
  return syncParsedHolding(parseHoldingText(text, options), options);
}

function syncLocalHolding(options = {}) {
  const parsed = readLocalHoldingSnapshot(options);
  return Object.assign(syncParsedHolding(parsed, Object.assign({
    sourceLabel: '同花顺持仓导出文件',
    dedupeKey: parsed.fileFingerprint
  }, options)), {
    filename: parsed.filename,
    fileUpdatedAt: parsed.fileUpdatedAt
  });
}

function sqliteUtcDate(value) {
  const text = String(value || '').trim();
  return new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? text.replace(' ', 'T') + 'Z' : text);
}

function latestSyncedHoldingContext(expectedDate, now = new Date(), options = {}) {
  const account = portfolio.listAccounts().find(function(item) { return item.accountKey === SYNC_ACCOUNT_KEY; });
  if (!account) return null;
  const snapshot = portfolio.getLatestSnapshot(account.id);
  if (!snapshot || snapshot.snapshotDate !== expectedDate || !Array.isArray(snapshot.holdings)) return null;
  if (String(snapshot.sourceLabel || '').startsWith('同花顺持仓导出文件')) return null;
  const windowCapture = String(snapshot.sourceLabel || '').startsWith('同花顺窗口只读采集');
  if (windowCapture) {
    const configuredMaxAge = Number(options.maxAgeMs || process.env.WEBSTOCK_THS_HOLDINGS_MAX_AGE_MS);
    const maxAgeMs = Number.isFinite(configuredMaxAge) && configuredMaxAge > 0 ? configuredMaxAge : 5 * 60 * 1000;
    const createdAt = sqliteUtcDate(snapshot.createdAt);
    if (!Number.isFinite(createdAt.getTime()) || now.getTime() - createdAt.getTime() > maxAgeMs) return null;
  }
  return {
    available: true,
    method: windowCapture ? 'windows-ocr-snapshot' : 'manual-copy-snapshot',
    source: windowCapture ? 'tonghuashun-window-ocr' : 'tonghuashun-manual-copy',
    observedAt: snapshot.createdAt || '',
    snapshotDate: snapshot.snapshotDate,
    cashBalance: snapshot.cashBalance,
    totalMarketValue: snapshot.totalMarketValue,
    totalAssets: snapshot.totalAssets,
    holdings: snapshot.holdings,
    account,
    snapshot,
    automaticSource: windowCapture
  };
}

function getMonitorHoldingContext(options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const expectedDate = shanghaiDate(now);
  let automaticError = null;
  try {
    const parsed = readLocalHoldingSnapshot(options);
    const snapshotDate = validateMonitorExport(parsed, now, options);
    const synced = syncParsedHolding(parsed, Object.assign({}, options, {
      snapshotDate,
      sourceLabel: '同花顺持仓导出文件',
      dedupeKey: parsed.fileFingerprint
    }));
    return {
      available: true,
      method: 'export-file',
      source: 'tonghuashun-export-file',
      filename: parsed.filename,
      observedAt: parsed.fileUpdatedAt,
      fileUpdatedAt: parsed.fileUpdatedAt,
      snapshotDate,
      cashBalance: synced.snapshot.cashBalance,
      totalMarketValue: synced.snapshot.totalMarketValue,
      totalAssets: synced.snapshot.totalAssets,
      holdings: parsed.holdings,
      account: synced.account,
      snapshot: synced.snapshot,
      automaticSource: true,
      unchanged: synced.unchanged
    };
  } catch (error) {
    automaticError = error;
  }

  if (options.fallbackToSnapshot !== false) {
    const fallback = latestSyncedHoldingContext(expectedDate, now, options);
    if (fallback) return Object.assign(fallback, { automaticSyncError: automaticError.message });
  }
  return unavailableHoldingResult(automaticError, now, options);
}

function getMonitorStatus(options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const expectedDate = shanghaiDate(now);
  let automaticError = null;
  try {
    const parsed = readLocalHoldingSnapshot(options);
    const snapshotDate = validateMonitorExport(parsed, now, options);
    return {
      available: true,
      ready: true,
      method: 'export-file',
      source: 'tonghuashun-export-file',
      filename: parsed.filename,
      fileUpdatedAt: parsed.fileUpdatedAt,
      observedAt: parsed.fileUpdatedAt,
      snapshotDate,
      holdingCount: parsed.holdings.length,
      manualCopySupported: true
    };
  } catch (error) {
    automaticError = error;
  }
  const fallback = latestSyncedHoldingContext(expectedDate, now, options);
  if (fallback) {
    return {
      available: true,
      ready: true,
      method: fallback.method,
      source: fallback.source,
      observedAt: fallback.observedAt,
      snapshotDate: fallback.snapshotDate,
      holdingCount: fallback.holdings.length,
      manualCopySupported: true,
      automaticSource: fallback.automaticSource,
      automaticSyncError: automaticError.message
    };
  }
  return unavailableHoldingResult(automaticError, now, options);
}

module.exports = {
  SYNC_ACCOUNT_KEY,
  parseHoldingText,
  findNewestHoldingFile,
  readLocalHoldingSnapshot,
  getStatus,
  previewHoldingText,
  previewLocalHolding,
  syncHoldingText,
  syncLocalHolding,
  recordWindowCaptureStatus,
  getMonitorHoldingContext,
  getMonitorStatus
};
