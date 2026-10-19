'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const iconv = require('iconv-lite');

const DAILY_PREFIX = '00_每日荐股_';
const BLOCK_NAME_SECTION = '[BLOCK_NAME_MAP_TABLE]';
const BLOCK_CONTEXT_SECTION = '[BLOCK_STOCK_CONTEXT]';
const PROTECTED_PROCESSES = /^(hexin|happ|hexinlauncher)(?:\.exe)?$/i;

function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function text(value) { return String(value == null ? '' : value).trim(); }
function dailyCode(name) { const match = text(name).match(/^00_每日荐股_(\d{4})$/); return match ? Number(match[1]) : null; }
function readJson(filename) { const value = JSON.parse(fs.readFileSync(filename, 'utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('同花顺分组 JSON 格式错误：' + filename); return value; }
function decodeIni(buffer) { const utf8 = buffer.toString('utf8'); if (!utf8.includes('\uFFFD')) return { text: utf8, encoding: 'utf8' }; const value = iconv.decode(buffer, 'gbk'); if (value.includes('\uFFFD')) throw new Error('同花顺 stockblock.ini 编码无法确认'); return { text: value, encoding: 'gbk' }; }
function encodeIni(value, encoding) { return encoding === 'utf8' ? Buffer.from(value, 'utf8') : iconv.encode(value, 'gbk'); }

function sections(textValue) {
  const lines = String(textValue).split(/\r?\n/);
  const output = new Map(); let current = '';
  lines.forEach((line, index) => {
    const match = line.trim().match(/^\[([^\]]+)\]$/);
    if (match) { current = match[1].toUpperCase(); if (!output.has(current)) output.set(current, []); }
    else if (current) output.get(current).push({ index, line });
  });
  return { lines, output };
}

function sectionEntries(parsed, name) {
  const rows = parsed.output.get(name.toUpperCase());
  if (!rows) throw new Error('同花顺 stockblock.ini 缺少 [' + name + ']');
  const map = new Map();
  rows.forEach(row => { const match = row.line.trim().match(/^([0-9A-F]+)=(.*)$/i); if (match) map.set(match[1].toUpperCase(), { row, value: match[2] }); });
  return map;
}

function contextValue(codes, markets) {
  return codes.join('|') + '|,' + markets.join('|') + '|';
}

function iniContextValue(codes, markets) { return codes.map((code, index) => markets[index] + ':' + code).join(',') + ',,'; }

function parseContext(value, filename) {
  const parts = text(value).split(',', 2);
  const codes = String(parts[0] || '').replace(/\|$/, '').split('|').filter(Boolean);
  const markets = String(parts[1] || '').replace(/\|$/, '').split('|').filter(Boolean);
  if (!codes.length || codes.length !== markets.length || codes.some(code => !/^\d{6}$/.test(code))) throw new Error('同花顺分组 context 格式错误：' + filename);
  return { codes, markets };
}

function parseIniContext(value, filename) {
  const pairs = text(value).split(',').filter(Boolean).map(item => item.split(':'));
  const codes = pairs.map(pair => pair[1]); const markets = pairs.map(pair => pair[0]);
  if (!codes.length || pairs.some(pair => pair.length !== 2 || !/^\d{6}$/.test(pair[1]) || !/^\d+$/.test(pair[0]))) throw new Error('同花顺 INI context 格式错误：' + filename);
  return { codes, markets };
}

function loadProcessNames(options) {
  if (Array.isArray(options.processNames)) return options.processNames.map(text);
  if (typeof options.processCheck === 'function') return options.processCheck();
  try { return childProcess.execFileSync('tasklist.exe', ['/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/).map(line => line.split(',')[0].replace(/^"|"$/g, '')); }
  catch (_) { throw new Error('无法确认 hexin、happ 和 hexinlauncher 是否已关闭'); }
}

function validatePicks(validated, options) {
  const picks = validated && validated.normalized && validated.normalized.artifacts && validated.normalized.artifacts[0] && validated.normalized.artifacts[0].payload && validated.normalized.artifacts[0].payload.picks;
  const included = Array.isArray(picks) ? picks.filter(item => item && item.includeInTonghuashun === true).sort((left, right) => Number(left.rank) - Number(right.rank)) : null;
  if (!included || included.length !== 20) throw new Error('安全文件投递要求恰好 20 只荐股');
  const resolver = options.securityResolver;
  const seen = new Set();
  return included.map(item => {
    const code = text(item && item.code); const name = text(item && item.name);
    if (!/^\d{6}$/.test(code) || !name || seen.has(code)) throw new Error('安全文件投递要求 20 只代码唯一且格式正确');
    seen.add(code);
    const resolved = typeof resolver === 'function' ? resolver(code) : null;
    if (!resolved || text(resolved.name) !== name || !text(resolved.market)) throw new Error('证券 code/name/market 未通过精确身份校验：' + code);
    return { code, name, market: text(resolved.market) };
  });
}

function buildPlan(validated, config, options = {}) {
  const iniPath = path.join(config.userDir, 'stockblock.ini');
  const orderPath = path.join(config.userDir, 'custom_block', '0');
  if (!fs.existsSync(iniPath) || !fs.existsSync(orderPath)) throw new Error('同花顺当前格式文件不完整');
  const iniBytes = fs.readFileSync(iniPath); const decoded = decodeIni(iniBytes); const ini = decoded.text; const parsed = sections(ini);
  const names = sectionEntries(parsed, 'BLOCK_NAME_MAP_TABLE');
  const contexts = sectionEntries(parsed, 'BLOCK_STOCK_CONTEXT');
  const orderBytes = fs.readFileSync(orderPath); const order = readJson(orderPath);
  const ids = text(order.sortstr).split(',').map(value => value.trim().toUpperCase()).filter(Boolean);
  const dateGroups = [];
  names.forEach((entry, id) => { const date = dailyCode(entry.value); if (date != null) dateGroups.push({ id, name: entry.value, date }); });
  dateGroups.sort((left, right) => right.date - left.date);
  dateGroups.forEach(group => {
    const filename = path.join(config.userDir, 'custom_block', String(parseInt(group.id, 16)));
    if (!fs.existsSync(filename)) throw new Error('同花顺日期分组文件缺失：' + filename);
    const payload = readJson(filename);
    if (typeof payload.ln !== 'string' || !contexts.has(group.id)) throw new Error('同花顺日期分组字段不完整：' + group.name);
    parseIniContext(contexts.get(group.id).value, filename);
  });
  const targetName = DAILY_PREFIX + text(validated.normalized.asOf.marketDate).slice(5).replace('-', '');
  const picks = validatePicks(validated, options);
  const target = dateGroups.find(group => group.name === targetName);
  const marketDate = text(validated.normalized.asOf.marketDate);
  const parsedMarketDate = new Date(marketDate + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(marketDate) || Number.isNaN(parsedMarketDate.getTime()) || parsedMarketDate.toISOString().slice(0, 10) !== marketDate || marketDate.slice(0, 4) !== String(new Date(typeof options.now === 'function' ? options.now() : Date.now()).getFullYear())) throw new Error('安全入口拒绝非当前年份或无法确认年份的荐股日期');
  if (dateGroups.length && Number(targetName.slice(-4)) < dateGroups[0].date) throw new Error('无法从 MMDD 判断跨年或历史荐股日期，安全入口拒绝写入');
  const remove = dateGroups.slice(target ? 3 : 2);
  let targetId = target && target.id;
  if (!targetId) {
    targetId = remove.length ? remove[remove.length - 1].id : (Math.max(0, ...Array.from(names.keys()).map(value => parseInt(value, 16) || 0)) + 1).toString(16).toUpperCase();
    if (!remove.length && (names.has(targetId) || contexts.has(targetId) || ids.includes(targetId))) throw new Error('安全入口无法分配未占用日期组 ID');
  }
  const blockPath = path.join(config.userDir, 'custom_block', String(parseInt(targetId, 16)));
  if (!target && !remove.length && fs.existsSync(blockPath)) throw new Error('安全入口分配的日期组 ID 已有孤立文件');
  const targetContext = contexts.get(targetId);
  let current = null;
  if (targetContext) current = parseIniContext(targetContext.value, blockPath);
  const targetFile = fs.existsSync(blockPath) ? readJson(blockPath) : null;
  const expectedLn = iconv.encode(targetName, 'gbk').toString('base64');
  const expectedOrder = Array.from(new Set([targetId].concat(ids.filter(id => id !== targetId && !remove.some(group => group.id === id))))).join(',');
  const noChange = Boolean(target && !remove.length && current && targetFile && targetFile.ln === expectedLn && targetFile.context === contextValue(picks.map(item => item.code), picks.map(item => item.market)) && ids.join(',') === expectedOrder && current.codes.join('|') === picks.map(item => item.code).join('|') && current.markets.join('|') === picks.map(item => item.market).join('|'));
  return { config, iniPath, orderPath, blockPath, iniBytes, orderBytes, iniEncoding: decoded.encoding, ini, parsed, names, contexts, order, ids, dateGroups, targetName, targetId, remove, picks, noChange };
}

function replaceEntry(ini, entry, id, value, sectionName) {
  if (entry) { ini[entry.row.index] = ini[entry.row.index].replace(entry.value, value); return; }
  const section = ini.findIndex(line => line.trim().toUpperCase() === sectionName);
  if (section < 0) throw new Error('同花顺 stockblock.ini 缺少目标 section');
  let end = section + 1; while (end < ini.length && !/^\s*\[[^\]]+\]\s*$/.test(ini[end])) end++;
  ini.splice(end, 0, id + '=' + value);
}

function applySafeFileDelivery(validated, config, options = {}) {
  if (!config || !config.backupRoot || !fs.existsSync(config.backupRoot)) throw new Error('安全文件投递必须配置有效 backupRoot');
  const processes = loadProcessNames(options);
  if (processes.some(name => PROTECTED_PROCESSES.test(name))) throw new Error('请先关闭 hexin、happ 和 hexinlauncher 后再投递');
  const plan = buildPlan(validated, config, options);
  if (plan.noChange) return { adapter: 'ths-safe-file-v1', groupName: plan.targetName, applied: false, noChange: true, cloudSync: 'pending', cloudVerified: false };
  const files = new Map([[plan.iniPath, plan.iniBytes], [plan.orderPath, plan.orderBytes]]);
  files.set(plan.blockPath, fs.existsSync(plan.blockPath) ? fs.readFileSync(plan.blockPath) : null);
  plan.remove.filter(group => group.id !== plan.targetId).forEach(group => { const filename = path.join(config.userDir, 'custom_block', String(parseInt(group.id, 16))); files.set(filename, fs.existsSync(filename) ? fs.readFileSync(filename) : null); });
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-ths-safe-'));
  const backupDir = path.join(config.backupRoot || temporaryRoot, 'safe-file-' + Date.now());
  fs.mkdirSync(backupDir, { recursive: true });
  const backupManifest = [];
  let backupIndex = 0;
  for (const [filename, bytes] of files) { if (bytes !== null) { const snapshot = path.join(backupDir, String(backupIndex++)); fs.writeFileSync(snapshot, bytes); backupManifest.push({ filename, originalExists: true, snapshot, sha256: digest(bytes) }); } else backupManifest.push({ filename, originalExists: false, snapshot: null, sha256: null }); }
  fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify({ adapter: 'ths-safe-file-v1', createdAt: new Date().toISOString(), files: backupManifest }, null, 2));
  const writeFile = options.writeFileSync || fs.writeFileSync;
  const rename = options.renameSync || fs.renameSync;
  try {
    const iniLines = plan.ini.split(/\r?\n/); const context = contextValue(plan.picks.map(item => item.code), plan.picks.map(item => item.market)); const iniContext = iniContextValue(plan.picks.map(item => item.code), plan.picks.map(item => item.market));
    plan.remove.filter(group => group.id !== plan.targetId).flatMap(group => [plan.names.get(group.id), plan.contexts.get(group.id)]).filter(Boolean).map(entry => entry.row.index).sort((a, b) => b - a).forEach(index => iniLines.splice(index, 1));
    let refreshed = sections(iniLines.join('\r\n'));
    replaceEntry(iniLines, sectionEntries(refreshed, 'BLOCK_NAME_MAP_TABLE').get(plan.targetId), plan.targetId, plan.targetName, BLOCK_NAME_SECTION);
    refreshed = sections(iniLines.join('\r\n'));
    replaceEntry(iniLines, sectionEntries(refreshed, 'BLOCK_STOCK_CONTEXT').get(plan.targetId), plan.targetId, iniContext, BLOCK_CONTEXT_SECTION);
    const targetJson = plan.blockPath && fs.existsSync(plan.blockPath) ? readJson(plan.blockPath) : {};
    targetJson.context = context;
    targetJson.ln = iconv.encode(plan.targetName, 'gbk').toString('base64');
    const nextOrder = Array.from(new Set([plan.targetId].concat(plan.ids.filter(id => id !== plan.targetId && !plan.remove.some(group => group.id === id))))).join(',');
    const blockBytes = Buffer.from(JSON.stringify(targetJson, null, 2), 'utf8');
    const nextIni = encodeIni(iniLines.join('\r\n'), plan.iniEncoding);
    const staged = [{ source: path.join(temporaryRoot, 'stockblock.ini'), target: plan.iniPath + '.safe-tmp', value: nextIni }, { source: path.join(temporaryRoot, 'order.json'), target: plan.orderPath + '.safe-tmp', value: JSON.stringify({ ...plan.order, sortstr: nextOrder }, null, 2) }, { source: path.join(temporaryRoot, 'target-block.json'), target: plan.blockPath + '.safe-tmp', value: blockBytes }];
    staged.forEach(item => writeFile(item.source, item.value));
    staged.forEach(item => { writeFile(item.target, fs.readFileSync(item.source)); rename(item.target, item.target.replace('.safe-tmp', '')); });
    plan.remove.filter(group => group.id !== plan.targetId).forEach(group => { const filename = path.join(config.userDir, 'custom_block', String(parseInt(group.id, 16))); if (filename !== plan.blockPath) fs.rmSync(filename, { force: true }); });
    if (digest(fs.readFileSync(plan.iniPath)) !== digest(nextIni) || JSON.parse(fs.readFileSync(plan.orderPath, 'utf8')).sortstr !== nextOrder || readJson(plan.blockPath).context !== context) throw new Error('同花顺安全投递写后校验失败');
    return { adapter: 'ths-safe-file-v1', groupName: plan.targetName, targetId: plan.targetId, applied: true, noChange: false, cloudSync: 'pending', cloudVerified: false, backupDir, originalFiles: [...files.keys()] };
  } catch (error) {
    for (const [filename, bytes] of files) { if (bytes === null) fs.rmSync(filename, { force: true }); else fs.writeFileSync(filename, bytes); }
    throw error;
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    for (const filename of [plan.iniPath + '.safe-tmp', plan.orderPath + '.safe-tmp', plan.blockPath + '.safe-tmp']) fs.rmSync(filename, { force: true });
  }
}

module.exports = { applySafeFileDelivery, buildPlan, parseContext, parseIniContext, iniContextValue };
