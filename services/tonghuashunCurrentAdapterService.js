const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const { defaultRecommendationGroupName } = require('./tonghuashunRecommendationService');
const {
  loadSecurityCatalog,
  parseCustomBlockCatalog
} = require('./tonghuashunWatchlistService');
const { applySafeFileDelivery, buildPlan: buildSafeFilePlan } = require('./tonghuashunSafeFileDeliveryService');

const CONFIG_KEYS = ['launcherPath', 'userDir', 'backupRoot', 'originalBackupDir', 'packageDir'];

function clean(value, maxLength) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength || 4000);
}

function safeMarketForCode(code) { return /^(6|68)/.test(String(code)) ? '17' : '33'; }

function csvCell(value) {
  return '"' + clean(value, 8000).replace(/"/g, '""') + '"';
}

function loadConfig(configPath) {
  const filename = path.resolve(String(configPath || ''));
  if (!configPath || !fs.existsSync(filename)) throw new Error('同花顺配置文件不存在：' + filename);
  const payload = JSON.parse(fs.readFileSync(filename, 'utf8'));
  const config = { configPath: filename };
  CONFIG_KEYS.forEach(function(key) {
    const value = path.resolve(clean(payload && payload[key], 1000));
    if (!payload || !payload[key] || !fs.existsSync(value)) throw new Error('同花顺配置路径不可用：' + key);
    config[key] = value;
  });
  config.runScript = path.join(config.packageDir, 'run_daily_import.ps1');
  if (!fs.existsSync(config.runScript)) throw new Error('同花顺当前格式导入脚本不存在：' + config.runScript);
  return config;
}

function includedPicks(validated) {
  const artifacts = validated && validated.normalized && validated.normalized.artifacts || [];
  const picks = artifacts[0] && artifacts[0].payload && artifacts[0].payload.picks || [];
  return picks.filter(function(item) { return item && item.includeInTonghuashun === true; })
    .sort(function(left, right) { return Number(left.rank) - Number(right.rank); });
}

function buildDailyCsv(validated) {
  const normalized = validated && validated.normalized;
  if (!normalized) throw new Error('缺少已验证的外部研究批次');
  const picks = includedPicks(validated);
  if (picks.length < 10 || picks.length > 20) {
    throw new Error('当前同花顺安全导入合约要求 10–20 只候选');
  }
  const marketDate = clean(normalized.asOf && normalized.asOf.marketDate, 20);
  const source = [normalized.source.system, normalized.source.taskId, normalized.source.model].filter(Boolean).join('/');
  const headers = ['priority', 'code', 'name', 'role', 'as_of', 'target_trade_date', 'source', 'reason', 'd1', 'd2', 'r1', 'reminder'];
  const lines = [headers.map(csvCell).join(',')];
  picks.forEach(function(item, index) {
    const rank = Number(item.rank) || index + 1;
    const role = item.priority === '重点' || item.priority === '观察'
      ? item.priority : (rank <= 5 ? '重点' : '观察');
    lines.push([
      rank,
      item.code,
      item.name,
      role,
      marketDate,
      marketDate,
      source,
      item.thesis,
      '',
      '',
      '',
      Array.isArray(item.risks) ? item.risks.join('；') : ''
    ].map(csvCell).join(','));
  });
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

function currentGroupState(config, groupName, picks) {
  const targetCodes = picks.map(function(item) { return item.code; });
  try {
    const custom = parseCustomBlockCatalog(config.userDir, loadSecurityCatalog());
    const group = custom.groups.find(function(item) { return item.name === groupName; });
    const currentCodes = group ? (group.rawCodes || group.items.map(function(item) { return item.code; })) : [];
    const currentSet = new Set(currentCodes);
    const targetSet = new Set(targetCodes);
    return {
      groupFound: Boolean(group),
      currentCodes,
      targetCodes,
      addedCodes: targetCodes.filter(function(code) { return !currentSet.has(code); }),
      removedCodes: currentCodes.filter(function(code) { return !targetSet.has(code); }),
      noChange: Boolean(group) && currentCodes.length === targetCodes.length && currentCodes.every(function(code, index) {
        return code === targetCodes[index];
      })
    };
  } catch (error) {
    return {
      groupFound: false,
      currentCodes: [],
      targetCodes,
      addedCodes: targetCodes.slice(),
      removedCodes: [],
      noChange: false,
      readError: clean(error && error.message, 500)
    };
  }
}

function planCurrentDelivery(validated, configPath) {
  const config = typeof configPath === 'object' ? configPath : loadConfig(configPath);
  const csv = buildDailyCsv(validated);
  const marketDate = validated.normalized.asOf.marketDate;
  const picks = includedPicks(validated);
  const groupName = defaultRecommendationGroupName(marketDate);
  return Object.assign({
    adapter: 'ths-current-selfstock-custom-block-v4',
    config,
    csv,
    csvPath: path.join(config.packageDir, 'daily_recommendations.csv'),
    groupName,
    candidateCount: picks.length,
    marketDate,
    automaticTrading: false
  }, currentGroupState(config, groupName, picks));
}

function planSafeFileDelivery(validated, configPath, options) {
  const config = typeof configPath === 'object' ? configPath : loadConfig(configPath);
  const catalog = loadSecurityCatalog();
  const plan = buildSafeFilePlan(validated, config, Object.assign({
    securityResolver: code => ({ name: catalog.get(code), market: safeMarketForCode(code) })
  }, options || {}));
  return Object.assign(plan, { adapter: 'ths-safe-file-v1', candidateCount: plan.picks.length, addedCodes: [], removedCodes: [] });
}

function atomicWrite(filename, content) {
  const temporary = filename + '.webstock-' + process.pid + '.tmp';
  fs.writeFileSync(temporary, content, 'utf8');
  try {
    fs.renameSync(temporary, filename);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch (cleanupError) {}
    throw error;
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}

function applyCurrentDelivery(validated, configPath, options) {
  options = options || {};
  if (options.mode === 'safe-file') {
    const config = typeof configPath === 'object' ? configPath : loadConfig(configPath);
    const catalog = loadSecurityCatalog();
    return applySafeFileDelivery(validated, config, Object.assign({
      securityResolver: code => ({ name: catalog.get(code), market: safeMarketForCode(code) })
    }, options));
  }
  const plan = planCurrentDelivery(validated, configPath);
  if (plan.noChange) {
    return {
      adapter: plan.adapter,
      groupName: plan.groupName,
      candidateCount: plan.candidateCount,
      currentCodes: plan.currentCodes,
      addedCodes: [],
      removedCodes: [],
      applied: false,
      noChange: true,
      nativeSyncRequested: false
    };
  }
  const hadCsv = fs.existsSync(plan.csvPath);
  const priorCsv = hadCsv ? fs.readFileSync(plan.csvPath) : null;
  const csvBackupPath = hadCsv ? plan.csvPath + '.bak-' + timestamp() : null;
  if (csvBackupPath) fs.copyFileSync(plan.csvPath, csvBackupPath);
  atomicWrite(plan.csvPath, plan.csv);
  const args = [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', plan.config.runScript,
    '-UserDir', plan.config.userDir,
    '-LauncherPath', plan.config.launcherPath,
    '-BackupRoot', plan.config.backupRoot,
    '-OriginalBackupDir', plan.config.originalBackupDir
  ];
  if (options.skipNativeSync === true) args.push('-SkipSync');
  try {
    const output = childProcess.execFileSync('powershell.exe', args, {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024
    });
    return {
      adapter: plan.adapter,
      groupName: plan.groupName,
      candidateCount: plan.candidateCount,
      csvPath: plan.csvPath,
      csvBackupPath,
      addedCodes: plan.addedCodes,
      removedCodes: plan.removedCodes,
      nativeSyncRequested: options.skipNativeSync !== true,
      output: clean(output, 16000),
      applied: true
    };
  } catch (error) {
    if (priorCsv) fs.writeFileSync(plan.csvPath, priorCsv);
    else fs.rmSync(plan.csvPath, { force: true });
    throw new Error('同花顺当前格式导入失败：' + clean(error && (error.stderr || error.message), 2000));
  }
}

module.exports = {
  loadConfig,
  includedPicks,
  buildDailyCsv,
  currentGroupState,
  planCurrentDelivery,
  planSafeFileDelivery,
  applyCurrentDelivery
};
