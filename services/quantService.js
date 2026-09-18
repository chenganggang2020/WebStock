const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const researchRuns = require('./researchRunService');
const expertChannels = require('./expertChannelService');
const strategyDaily = require('./strategyDailyService');
const tonghuashunWatchlist = require('./tonghuashunWatchlistService');
const { defaultRecommendationGroupName } = require('./tonghuashunRecommendationService');
const {
  createRuntimeInstaller,
  loadRuntimeManifest,
  runtimePythonPath
} = require('./quantRuntimeInstaller');
const {
  normalizePythonPath,
  readRuntimeLink,
  saveRuntimeLink
} = require('./quantRuntimeLink');
const {
  validateDatasetManifest,
  validateQuantResult,
  validateFactorLabResult,
  validateStrategyLabResult,
  validateSignalScanResult,
  sha256File,
  manifestSha256
} = require('./quantContractService');

const jobs = new Map();
const children = new Map();
const resultSummaryCaches = {
  runs: new Map(),
  'factor-runs': new Map(),
  'strategy-runs': new Map(),
  'signal-scans': new Map()
};
const manifestSummaryCache = new Map();
let runtimeCache = null;
let runtimeInstallInfoCache = null;

function asUnpacked(filePath) {
  return filePath.includes('app.asar') ? filePath.replace('app.asar', 'app.asar.unpacked') : filePath;
}

function quantRoot() {
  return asUnpacked(path.join(__dirname, '..', 'quant'));
}

function runnerPath() {
  return path.join(quantRoot(), 'runner.py');
}

function universePath() {
  return asUnpacked(path.join(__dirname, '..', 'stocks.json'));
}

function workspacePath() {
  return path.resolve(process.env.WEBSTOCK_QUANT_WORKSPACE || path.join(__dirname, '..', 'quant', 'workspace'));
}

function runtimeCandidate() {
  if (process.env.WEBSTOCK_QUANT_PYTHON) {
    return { python: path.resolve(process.env.WEBSTOCK_QUANT_PYTHON), source: 'environment', link: null, linkError: '' };
  }
  let link = null;
  let linkError = '';
  try {
    link = readRuntimeLink(workspacePath());
  } catch (error) {
    linkError = error.message;
  }
  if (link) return { python: link.pythonPath, source: 'linked', link, linkError: '' };
  const local = path.join(quantRoot(), '.venv', 'Scripts', 'python.exe');
  if (fs.existsSync(local)) return { python: local, source: 'development', link: null, linkError };
  const managed = runtimePythonPath(workspacePath());
  if (fs.existsSync(managed)) return { python: managed, source: 'managed', link: null, linkError };
  return { python: null, source: '', link: null, linkError };
}

function ensureWorkspace() {
  const workspace = workspacePath();
  fs.mkdirSync(path.join(workspace, 'jobs'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'datasets'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'runs'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'factor-runs'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'strategy-runs'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'signal-scans'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'expert-inputs'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'expert-runs'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'watchlist-inputs'), { recursive: true });
  return workspace;
}

function getRuntimeInstallInfo() {
  if (runtimeInstallInfoCache) return runtimeInstallInfoCache;
  try {
    const manifest = loadRuntimeManifest(quantRoot());
    runtimeInstallInfoCache = {
      available: true,
      platform: manifest.platform,
      arch: manifest.arch,
      python: manifest.python,
      uvVersion: manifest.uv.version,
      estimatedBytes: manifest.estimatedBytes,
      indexModes: ['official', 'china'],
      reason: '可安装到 WebStock 独立数据目录，不修改系统 PATH。'
    };
  } catch (error) {
    runtimeInstallInfoCache = { available: false, reason: error.message };
  }
  return runtimeInstallInfoCache;
}

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return !!relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function compactUtcTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function getRuntimeStatus() {
  const candidate = runtimeCandidate();
  const python = candidate.python;
  const runner = runnerPath();
  const installer = getRuntimeInstallInfo();
  if (!python || !fs.existsSync(python)) {
    return {
      status: 'not_configured',
      verified: false,
      reason: candidate.linkError || '尚未关联或安装 Python 3.12 量化运行环境。',
      python: python || '',
      runner,
      runtimeSource: candidate.source,
      installer
    };
  }
  if (!fs.existsSync(runner)) {
    return { status: 'unavailable', verified: false, reason: '量化运行脚本缺失。', python, runner, runtimeSource: candidate.source, installer };
  }
  if (runtimeCache) return Object.assign({ python, runner, runtimeSource: candidate.source, installer }, runtimeCache);
  return {
    status: 'configured',
    verified: false,
    reason: candidate.source === 'linked'
      ? '已关联已有量化环境，请执行环境检测后再开始训练。'
      : '已找到独立运行环境，请执行环境检测后再开始训练。',
    python,
    runner,
    runtimeSource: candidate.source,
    linkedAt: candidate.link && candidate.link.linkedAt || '',
    installer
  };
}

function parseProtocolLine(line, state) {
  if (line.startsWith('WEBSTOCK_EVENT=')) {
    try { state.event = JSON.parse(line.slice('WEBSTOCK_EVENT='.length)); } catch (error) {}
  }
  if (line.startsWith('WEBSTOCK_RESULT=')) {
    try { state.result = JSON.parse(line.slice('WEBSTOCK_RESULT='.length)); } catch (error) {}
  }
  if (line.startsWith('WEBSTOCK_ERROR=')) {
    try { state.error = JSON.parse(line.slice('WEBSTOCK_ERROR='.length)); } catch (error) {}
  }
}

function quantProcessEnvironment(baseEnvironment = {}) {
  const configured = Number(baseEnvironment.WEBSTOCK_QUANT_THREADS || 1);
  const threads = String(Number.isFinite(configured) ? Math.min(Math.max(Math.round(configured), 1), 4) : 1);
  return Object.assign({}, baseEnvironment, {
    OMP_NUM_THREADS: threads,
    MKL_NUM_THREADS: threads,
    OPENBLAS_NUM_THREADS: threads,
    NUMEXPR_NUM_THREADS: threads,
    PYTHONFAULTHANDLER: '1'
  });
}

function runProtocolWithPython(python, args, options = {}) {
  const workspace = ensureWorkspace();
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(python, [runnerPath()].concat(args), {
      cwd: workspace,
      windowsHide: true,
      env: Object.assign(quantProcessEnvironment(process.env), {
        PYTHONUTF8: '1',
        PYTHONPATH: quantRoot(),
        MLFLOW_ALLOW_FILE_STORE: 'true'
      })
    });
    if (options.onChild) options.onChild(child);
    const state = { result: null, event: null, error: null, stderr: '', stdoutBuffer: '' };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      state.stdoutBuffer += chunk;
      const lines = state.stdoutBuffer.split(/\r?\n/);
      state.stdoutBuffer = lines.pop();
      lines.forEach(line => {
        parseProtocolLine(line, state);
        if (state.event && options.onEvent) options.onEvent(state.event);
        state.event = null;
      });
    });
    child.stderr.on('data', chunk => {
      state.stderr = (state.stderr + chunk).slice(-12000);
    });
    child.on('error', reject);
    child.on('close', code => {
      if (state.stdoutBuffer) parseProtocolLine(state.stdoutBuffer, state);
      if (code === 0 && state.result) return resolve(state.result);
      const message = state.error && state.error.message
        ? state.error.message
        : state.stderr.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || '量化进程异常退出，代码：' + code;
      const error = new Error(message);
      error.detail = state.stderr;
      error.exitCode = code;
      reject(error);
    });
  });
}

async function retryNativeCrash(operation, options = {}) {
  const retryLimit = Math.min(Math.max(Number(options.retries == null ? 1 : options.retries), 0), 2);
  let attempt = 0;
  while (true) {
    try {
      return await operation(attempt);
    } catch (error) {
      const exitCode = Number(error && error.exitCode);
      const nativeAccessViolation = exitCode === 3221225477 || exitCode === -1073741819;
      if (!nativeAccessViolation || attempt >= retryLimit) throw error;
      attempt += 1;
      if (typeof options.onRetry === 'function') options.onRetry(error, attempt);
    }
  }
}

function runProtocol(args, options = {}) {
  const runtime = getRuntimeStatus();
  if (!['configured', 'available'].includes(runtime.status)) {
    const error = new Error(runtime.reason);
    error.status = 409;
    return Promise.reject(error);
  }
  return runProtocolWithPython(runtime.python, args, options);
}

function verifiedRuntimeCache(result, reason) {
  return {
    status: result.status === 'available' ? 'available' : 'configured',
    verified: !!result.verified,
    reason,
    versions: Object.assign({ python: result.python }, result.packages || {}),
    checkedAt: result.checkedAt
  };
}

async function verifyRuntime() {
  try {
    const candidate = runtimeCandidate();
    const result = await runProtocol(['health', '--verify']);
    runtimeCache = verifiedRuntimeCache(result,
      result.verified
        ? (candidate.source === 'linked'
          ? '已复用本机已有量化环境，Qlib、LightGBM 与 PyTorch 导入检测通过。'
          : 'Qlib、LightGBM 与 PyTorch 导入检测通过。')
        : '已读取运行环境信息。');
  } catch (error) {
    runtimeCache = { status: 'unavailable', verified: false, reason: error.message, checkedAt: new Date().toISOString() };
  }
  return getRuntimeStatus();
}

async function linkExistingRuntime(input = {}) {
  const existing = activeJob();
  if (existing) {
    const error = new Error('已有量化任务正在运行：' + existing.id);
    error.status = 409;
    throw error;
  }
  const python = normalizePythonPath(input.pythonPath);
  const manifest = loadRuntimeManifest(quantRoot());
  const result = await runProtocolWithPython(python, ['health', '--verify']);
  if (!result.verified || result.status !== 'available') throw new Error('已有量化环境健康检查未通过。');
  if (String(result.python) !== String(manifest.python)) {
    throw new Error('已有环境 Python 版本为 ' + result.python + '，程序要求 ' + manifest.python + '。');
  }
  const packages = result.packages || {};
  const missing = ['qlib', 'lightgbm', 'pandas', 'pyarrow', 'baostock', 'faster_whisper', 'torch'].filter(name => !packages[name]);
  if (missing.length) throw new Error('已有环境缺少量化依赖：' + missing.join('、') + '。');
  saveRuntimeLink(workspacePath(), {
    pythonPath: python,
    linkedAt: result.checkedAt || new Date().toISOString(),
    versions: Object.assign({ python: result.python }, packages)
  });
  runtimeCache = verifiedRuntimeCache(result, '已复用本机已有量化环境，依赖导入检测通过。');
  return getRuntimeStatus();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function fileIdentity(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return { exists: true, size: stat.size, mtimeMs: stat.mtimeMs };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { exists: false, size: 0, mtimeMs: 0 };
    throw error;
  }
}

function sameFileIdentity(left, right) {
  return !!left && !!right && left.exists === right.exists &&
    left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function readManifestSummary(manifestPath) {
  const identity = fileIdentity(manifestPath);
  if (!identity.exists) throw new Error('Dataset manifest is missing.');
  const cached = manifestSummaryCache.get(manifestPath);
  if (cached && sameFileIdentity(cached.identity, identity)) {
    if (cached.error) throw new Error(cached.error);
    return cached;
  }
  try {
    const manifest = validateDatasetManifest(readJson(manifestPath));
    if (manifestSha256(manifest) !== manifest.manifestSha256.toLowerCase()) {
      throw new Error('Dataset manifest SHA256 does not match its content.');
    }
    const entry = { identity, manifest, error: '' };
    manifestSummaryCache.set(manifestPath, entry);
    return entry;
  } catch (error) {
    manifestSummaryCache.set(manifestPath, { identity, manifest: null, error: error.message });
    throw error;
  }
}

function summaryCacheIsCurrent(cached) {
  if (!cached || !sameFileIdentity(cached.resultIdentity, fileIdentity(cached.resultPath))) return false;
  if (!sameFileIdentity(cached.manifestIdentity, fileIdentity(cached.manifestPath))) return false;
  return cached.artifactIdentities.every(artifact =>
    sameFileIdentity(artifact.identity, fileIdentity(artifact.path)));
}

function verifyStoredResultSummary(resultPath, kind) {
  const workspace = ensureWorkspace();
  const runsRoot = path.join(workspace, kind);
  const datasetsRoot = path.join(workspace, 'datasets');
  const resolvedResultPath = path.resolve(resultPath);
  if (!isInside(runsRoot, resolvedResultPath)) throw new Error('Result file is outside the quant run directory.');

  const cache = resultSummaryCaches[kind];
  const cached = cache.get(resolvedResultPath);
  if (summaryCacheIsCurrent(cached)) return cached.verified;

  const resultIdentity = fileIdentity(resolvedResultPath);
  if (!resultIdentity.exists) throw new Error('Result file is missing.');
  const result = readJson(resolvedResultPath);
  const datasetId = String(result.dataManifest && result.dataManifest.datasetId || '');
  const manifestPath = path.resolve(datasetsRoot, datasetId, 'manifest.json');
  if (!isInside(datasetsRoot, manifestPath)) throw new Error('Result dataset path is invalid.');
  const manifestEntry = readManifestSummary(manifestPath);
  const validator = kind === 'factor-runs'
    ? validateFactorLabResult
    : (kind === 'strategy-runs'
      ? validateStrategyLabResult
      : (kind === 'signal-scans' ? validateSignalScanResult : validateQuantResult));
  validator(result, manifestEntry.manifest);

  const runRoot = path.dirname(resolvedResultPath);
  const artifactIdentities = result.artifacts.map(artifact => {
    const target = path.resolve(runRoot, artifact.path);
    if (!isInside(runRoot, target)) throw new Error('Result artifact is outside the current run directory.');
    const identity = fileIdentity(target);
    if (!identity.exists) throw new Error('Result artifact is missing: ' + artifact.path);
    return { path: target, identity };
  });
  const verified = { manifest: manifestEntry.manifest, result, manifestPath, resultPath: resolvedResultPath };
  cache.set(resolvedResultPath, {
    resultPath: resolvedResultPath,
    resultIdentity,
    manifestPath,
    manifestIdentity: manifestEntry.identity,
    artifactIdentities,
    verified
  });
  return verified;
}

function verifyManifest(manifestPath, options = {}) {
  const manifest = validateDatasetManifest(readJson(manifestPath));
  if (manifestSha256(manifest) !== manifest.manifestSha256.toLowerCase()) {
    throw new Error('数据清单哈希与内容不一致。');
  }
  const verifyHashes = options.verifyHashes !== false;
  const root = path.dirname(manifestPath);
  manifest.files.forEach(file => {
    const target = path.resolve(root, file.path);
    if (!isInside(root, target)) throw new Error('数据文件路径超出数据集目录。');
    if (!fs.existsSync(target)) throw new Error('数据文件缺失：' + file.path);
    if (verifyHashes && sha256File(target) !== file.sha256.toLowerCase()) {
      throw new Error('数据文件哈希不一致：' + file.path);
    }
  });
  return manifest;
}

function verifyStoredResult(resultPath, options = {}) {
  const verifyHashes = options.verifyHashes !== false;
  const workspace = ensureWorkspace();
  const runsRoot = path.join(workspace, 'runs');
  const datasetsRoot = path.join(workspace, 'datasets');
  const resolvedResultPath = path.resolve(resultPath);
  if (!isInside(runsRoot, resolvedResultPath)) throw new Error('结果文件超出量化运行目录。');

  const result = readJson(resolvedResultPath);
  const datasetId = String(result.dataManifest && result.dataManifest.datasetId || '');
  const manifestPath = path.resolve(datasetsRoot, datasetId, 'manifest.json');
  if (!isInside(datasetsRoot, manifestPath)) throw new Error('结果引用的数据集路径无效。');
  const manifestCache = options.manifestCache instanceof Map ? options.manifestCache : null;
  const manifestCacheKey = manifestPath + '\0' + String(verifyHashes);
  let manifest = manifestCache ? manifestCache.get(manifestCacheKey) : null;
  if (!manifest) {
    manifest = verifyManifest(manifestPath, { verifyHashes });
    if (manifestCache) manifestCache.set(manifestCacheKey, manifest);
  }
  validateQuantResult(result, manifest);

  const runRoot = path.dirname(resolvedResultPath);
  result.artifacts.forEach(artifact => {
    const target = path.resolve(runRoot, artifact.path);
    if (!isInside(runRoot, target)) throw new Error('结果产物路径超出当前运行目录。');
    if (!fs.existsSync(target)) throw new Error('结果产物缺失：' + artifact.path);
    if (verifyHashes && sha256File(target) !== artifact.sha256.toLowerCase()) {
      throw new Error('结果产物哈希不一致：' + artifact.path);
    }
  });
  return { manifest, result, manifestPath, resultPath: resolvedResultPath };
}

function verifyStoredFactorResult(resultPath, options = {}) {
  const verifyHashes = options.verifyHashes !== false;
  const workspace = ensureWorkspace();
  const runsRoot = path.join(workspace, 'factor-runs');
  const datasetsRoot = path.join(workspace, 'datasets');
  const resolvedResultPath = path.resolve(resultPath);
  if (!isInside(runsRoot, resolvedResultPath)) throw new Error('因子结果文件超出因子实验目录。');

  const result = readJson(resolvedResultPath);
  const datasetId = String(result.dataManifest && result.dataManifest.datasetId || '');
  const manifestPath = path.resolve(datasetsRoot, datasetId, 'manifest.json');
  if (!isInside(datasetsRoot, manifestPath)) throw new Error('因子结果引用的数据集路径无效。');
  const manifestCache = options.manifestCache instanceof Map ? options.manifestCache : null;
  const manifestCacheKey = manifestPath + '\0' + String(verifyHashes);
  let manifest = manifestCache ? manifestCache.get(manifestCacheKey) : null;
  if (!manifest) {
    manifest = verifyManifest(manifestPath, { verifyHashes });
    if (manifestCache) manifestCache.set(manifestCacheKey, manifest);
  }
  validateFactorLabResult(result, manifest);

  const runRoot = path.dirname(resolvedResultPath);
  result.artifacts.forEach(artifact => {
    const target = path.resolve(runRoot, artifact.path);
    if (!isInside(runRoot, target)) throw new Error('因子产物路径超出当前实验目录。');
    if (!fs.existsSync(target)) throw new Error('因子产物缺失：' + artifact.path);
    if (verifyHashes && sha256File(target) !== artifact.sha256.toLowerCase()) {
      throw new Error('因子产物哈希不一致：' + artifact.path);
    }
  });
  return { manifest, result, manifestPath, resultPath: resolvedResultPath };
}

function verifyStoredStrategyResult(resultPath, options = {}) {
  const verifyHashes = options.verifyHashes !== false;
  const workspace = ensureWorkspace();
  const runsRoot = path.join(workspace, 'strategy-runs');
  const datasetsRoot = path.join(workspace, 'datasets');
  const resolvedResultPath = path.resolve(resultPath);
  if (!isInside(runsRoot, resolvedResultPath)) throw new Error('策略结果文件超出批量策略研究目录。');

  const result = readJson(resolvedResultPath);
  const datasetId = String(result.dataManifest && result.dataManifest.datasetId || '');
  const manifestPath = path.resolve(datasetsRoot, datasetId, 'manifest.json');
  if (!isInside(datasetsRoot, manifestPath)) throw new Error('策略结果引用的数据集路径无效。');
  const manifestCache = options.manifestCache instanceof Map ? options.manifestCache : null;
  const manifestCacheKey = manifestPath + '\0' + String(verifyHashes);
  let manifest = manifestCache ? manifestCache.get(manifestCacheKey) : null;
  if (!manifest) {
    manifest = verifyManifest(manifestPath, { verifyHashes });
    if (manifestCache) manifestCache.set(manifestCacheKey, manifest);
  }
  validateStrategyLabResult(result, manifest);

  const runRoot = path.dirname(resolvedResultPath);
  result.artifacts.forEach(artifact => {
    const target = path.resolve(runRoot, artifact.path);
    if (!isInside(runRoot, target)) throw new Error('策略产物路径超出当前研究目录。');
    if (!fs.existsSync(target)) throw new Error('策略产物缺失：' + artifact.path);
    if (verifyHashes && sha256File(target) !== artifact.sha256.toLowerCase()) {
      throw new Error('策略产物哈希不一致：' + artifact.path);
    }
  });
  return { manifest, result, manifestPath, resultPath: resolvedResultPath };
}

function verifyStoredSignalScanResult(resultPath, options = {}) {
  const verifyHashes = options.verifyHashes !== false;
  const workspace = ensureWorkspace();
  const runsRoot = path.join(workspace, 'signal-scans');
  const datasetsRoot = path.join(workspace, 'datasets');
  const resolvedResultPath = path.resolve(resultPath);
  if (!isInside(runsRoot, resolvedResultPath)) throw new Error('信号扫描结果超出量化扫描目录。');

  const result = readJson(resolvedResultPath);
  const datasetId = String(result.dataManifest && result.dataManifest.datasetId || '');
  const manifestPath = path.resolve(datasetsRoot, datasetId, 'manifest.json');
  if (!isInside(datasetsRoot, manifestPath)) throw new Error('信号扫描引用的数据集路径无效。');
  const manifestCache = options.manifestCache instanceof Map ? options.manifestCache : null;
  const manifestCacheKey = manifestPath + '\0' + String(verifyHashes);
  let manifest = manifestCache ? manifestCache.get(manifestCacheKey) : null;
  if (!manifest) {
    manifest = verifyManifest(manifestPath, { verifyHashes });
    if (manifestCache) manifestCache.set(manifestCacheKey, manifest);
  }
  validateSignalScanResult(result, manifest);

  const runRoot = path.dirname(resolvedResultPath);
  result.artifacts.forEach(artifact => {
    const target = path.resolve(runRoot, artifact.path);
    if (!isInside(runRoot, target)) throw new Error('信号扫描产物超出当前扫描目录。');
    if (!fs.existsSync(target)) throw new Error('信号扫描产物缺失：' + artifact.path);
    if (verifyHashes && sha256File(target) !== artifact.sha256.toLowerCase()) {
      throw new Error('信号扫描产物哈希不一致：' + artifact.path);
    }
  });
  return { manifest, result, manifestPath, resultPath: resolvedResultPath };
}

function verifyResult(output) {
  if (!output || !output.manifestPath || !output.resultPath) throw new Error('量化任务没有返回完整的输出路径。');
  const manifestPath = path.resolve(output.manifestPath);
  const resultPath = path.resolve(output.resultPath);
  const workspace = ensureWorkspace();
  if (!isInside(workspace, manifestPath) || !isInside(workspace, resultPath)) {
    throw new Error('量化输出超出已配置的工作区。');
  }
  const verified = verifyStoredResult(resultPath);
  if (verified.manifestPath !== manifestPath) throw new Error('任务返回的数据清单与结果引用不一致。');
  return verified;
}

function verifyFactorResult(output) {
  if (!output || !output.manifestPath || !output.resultPath) throw new Error('因子任务没有返回完整的输出路径。');
  const manifestPath = path.resolve(output.manifestPath);
  const resultPath = path.resolve(output.resultPath);
  const workspace = ensureWorkspace();
  if (!isInside(workspace, manifestPath) || !isInside(workspace, resultPath)) {
    throw new Error('因子输出超出已配置的工作区。');
  }
  const verified = verifyStoredFactorResult(resultPath);
  if (verified.manifestPath !== manifestPath) throw new Error('因子任务返回的数据清单与结果引用不一致。');
  return verified;
}

function verifyStrategyResult(output, options = {}) {
  if (!output || !output.manifestPath || !output.resultPath) throw new Error('策略任务没有返回完整的输出路径。');
  const manifestPath = path.resolve(output.manifestPath);
  const resultPath = path.resolve(output.resultPath);
  const workspace = ensureWorkspace();
  if (!isInside(workspace, manifestPath) || !isInside(workspace, resultPath)) {
    throw new Error('策略输出超出已配置的工作区。');
  }
  const verified = verifyStoredStrategyResult(resultPath, options);
  if (verified.manifestPath !== manifestPath) throw new Error('策略任务返回的数据清单与结果引用不一致。');
  return verified;
}

function verifySignalScanResult(output, options = {}) {
  if (!output || !output.manifestPath || !output.resultPath) throw new Error('信号扫描没有返回完整的输出路径。');
  const manifestPath = path.resolve(output.manifestPath);
  const resultPath = path.resolve(output.resultPath);
  const workspace = ensureWorkspace();
  if (!isInside(workspace, manifestPath) || !isInside(workspace, resultPath)) {
    throw new Error('信号扫描输出超出已配置的工作区。');
  }
  const verified = verifyStoredSignalScanResult(resultPath, options);
  if (verified.manifestPath !== manifestPath) throw new Error('信号扫描返回的数据清单与结果引用不一致。');
  return verified;
}

function verifyExpertResult(output) {
  if (!output || !output.manifestPath || !output.resultPath || !output.signalsPath) {
    throw new Error('创作者回测没有返回完整的输出路径。');
  }
  const workspace = ensureWorkspace();
  const resultPath = path.resolve(output.resultPath);
  const runsRoot = path.join(workspace, 'expert-runs');
  const inputsRoot = path.join(workspace, 'expert-inputs');
  const datasetsRoot = path.join(workspace, 'datasets');
  if (!isInside(runsRoot, resultPath)) throw new Error('创作者回测结果超出量化工作区。');
  const result = readJson(resultPath);
  if (result.schema !== 'webstock.expert-backtest.v1') throw new Error('创作者回测结果格式无效。');
  const manifestPath = path.resolve(output.manifestPath);
  if (!isInside(datasetsRoot, manifestPath)) throw new Error('创作者回测数据清单超出量化工作区。');
  const manifest = verifyManifest(manifestPath, { verifyHashes: false });
  if (!result.dataManifest || result.dataManifest.datasetId !== manifest.datasetId ||
      result.dataManifest.sha256 !== manifest.manifestSha256) {
    throw new Error('创作者回测引用的数据清单不一致。');
  }
  const signalsPath = path.resolve(output.signalsPath);
  if (!isInside(inputsRoot, signalsPath) || !fs.existsSync(signalsPath)) {
    throw new Error('创作者回测输入超出量化工作区或已经缺失。');
  }
  if (sha256File(signalsPath) !== String(result.inputSha256 || '').toLowerCase()) {
    throw new Error('创作者回测输入哈希不一致。');
  }
  const runRoot = path.dirname(resultPath);
  (result.artifacts || []).forEach(artifact => {
    const target = path.resolve(runRoot, artifact.path);
    if (!isInside(runRoot, target) || !fs.existsSync(target)) throw new Error('创作者回测产物缺失。');
    if (sha256File(target) !== String(artifact.sha256 || '').toLowerCase()) {
      throw new Error('创作者回测产物哈希不一致。');
    }
  });
  return { manifest, result, manifestPath, resultPath, signalsPath };
}

function jobFile(id) {
  return path.join(ensureWorkspace(), 'jobs', id + '.json');
}

function publicJob(job) {
  const copy = Object.assign({}, job);
  delete copy.stderr;
  if (copy.kind === 'runtime-install' && copy.output) {
    copy.output = {
      verified: !!copy.output.verified,
      installedAt: copy.output.installedAt || '',
      versions: copy.output.versions || {}
    };
    return copy;
  }
  if (copy.kind === 'research-suite' && copy.output) {
    copy.output = {
      suiteId: copy.output.suiteId || '',
      datasetId: copy.output.datasetId || '',
      completedSteps: Array.isArray(copy.output.completedSteps) ? copy.output.completedSteps : []
    };
    return copy;
  }
  if (copy.kind === 'watchlist-research' && copy.output) {
    const report = copy.output.report || {};
    copy.output = {
      suiteId: copy.output.suiteId || '',
      datasetId: copy.output.datasetId || report.datasetId || '',
      asOf: copy.output.asOf || report.asOf || '',
      group: copy.output.group || null,
      manifest: copy.output.manifest || null,
      completedSteps: Array.isArray(copy.output.completedSteps) ? copy.output.completedSteps : [],
      report: {
        schema: report.schema || '',
        status: report.status || '',
        automaticTrading: false,
        datasetId: report.datasetId || '',
        asOf: report.asOf || '',
        comparisons: Array.isArray(report.comparisons) ? report.comparisons : [],
        missingFamilies: Array.isArray(report.missingFamilies) ? report.missingFamilies : [],
        candidateCount: Number(report.candidateCount || 0),
        storedCount: Number(report.storedCount || 0),
        truncated: !!report.truncated,
        candidates: Array.isArray(report.candidates) ? report.candidates.slice(0, 200) : [],
        warnings: Array.isArray(report.warnings) ? report.warnings : []
      },
      localSummary: buildWatchlistResearchSummary(
        report,
        copy.output.manifest || {},
        copy.output.group || { name: '同花顺分组' },
        { failures: Array.isArray(copy.output.manifest && copy.output.manifest.failures) ? copy.output.manifest.failures : [] }
      ),
      handoffPrompt: copy.output.handoffPrompt || '',
      recommendationPreview: buildRecommendationPreview({
        asOf: copy.output.asOf || report.asOf || '',
        candidates: Array.isArray(report.candidates) ? report.candidates : []
      })
    };
    return copy;
  }
  if (copy.kind === 'strategy-daily' && copy.output) {
    const report = copy.output.report || {};
    copy.output = {
      suiteId: copy.output.suiteId || '',
      datasetId: copy.output.datasetId || report.datasetId || '',
      asOf: copy.output.asOf || report.asOf || '',
      completedSteps: Array.isArray(copy.output.completedSteps) ? copy.output.completedSteps : [],
      report: {
        schema: report.schema || '',
        status: report.status || '',
        automaticTrading: false,
        datasetId: report.datasetId || '',
        asOf: report.asOf || '',
        comparisons: Array.isArray(report.comparisons) ? report.comparisons : [],
        missingFamilies: Array.isArray(report.missingFamilies) ? report.missingFamilies : [],
        candidateCount: Number(report.candidateCount || 0),
        storedCount: Number(report.storedCount || 0),
        truncated: !!report.truncated,
        candidates: Array.isArray(report.candidates) ? report.candidates.slice(0, 200) : [],
        warnings: Array.isArray(report.warnings) ? report.warnings : []
      }
    };
    return copy;
  }
  if (copy.output) {
    const factorCount = copy.output.factorCount;
    const parameterCount = copy.output.parameterCount;
    const stableParameterCount = copy.output.stableParameterCount;
    const manifest = copy.output.manifest || {};
    const result = copy.output.result || {};
    copy.output = {
      manifestPath: copy.output.manifestPath || '',
      resultPath: copy.output.resultPath || '',
      datasetId: copy.output.datasetId || manifest.datasetId || (result.dataManifest && result.dataManifest.datasetId) || '',
      runId: copy.output.runId || result.runId || '',
      modelId: copy.output.modelId || result.modelId || '',
      validationStatus: copy.output.validationStatus || result.validationStatus || '',
      asOf: copy.output.asOf || result.asOf || manifest.asOf || '',
      coverage: copy.output.coverage || manifest.coverage || null,
      metrics: copy.output.metrics || result.metrics || null
    };
    if (factorCount != null) copy.output.factorCount = Number(factorCount);
    if (parameterCount != null) copy.output.parameterCount = Number(parameterCount);
    if (stableParameterCount != null) copy.output.stableParameterCount = Number(stableParameterCount);
  }
  return copy;
}

function persistJob(job) {
  const target = jobFile(job.id);
  const temporary = target + '.tmp-' + process.pid;
  fs.writeFileSync(temporary, JSON.stringify(publicJob(job), null, 2), 'utf8');
  fs.renameSync(temporary, target);
}

function newJobId(kind) {
  return kind + '-' + compactUtcTimestamp() + '-' + crypto.randomBytes(3).toString('hex');
}

function activeJob() {
  return Array.from(jobs.values()).find(job => ['queued', 'running'].includes(job.status)) || null;
}

function numeric(value, fallback, min, max) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(Math.max(next, min), max);
}

function dateValue(value, fallback) {
  const text = String(value || fallback || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text + 'T00:00:00Z'))) {
    throw new Error('日期必须使用 YYYY-MM-DD 格式。');
  }
  return text;
}

function commonEvaluationArgs(input) {
  const testDays = Math.round(numeric(input.testDays, 63, 21, 252));
  const stepDays = Math.round(numeric(input.stepDays, 63, 21, 252));
  if (stepDays < testDays) throw new Error('滚动步长不能小于测试窗口，否则样本外区间会重叠。');
  return [
    '--train-days', String(Math.round(numeric(input.trainDays, 504, 252, 2520))),
    '--validation-days', String(Math.round(numeric(input.validationDays, 126, 42, 504))),
    '--test-days', String(testDays),
    '--step-days', String(stepDays),
    '--label-horizon', String(Math.round(numeric(input.labelHorizon, 5, 1, 20))),
    '--max-folds', String(Math.round(numeric(input.maxFolds, 4, 1, 12))),
    '--top-k', String(Math.round(numeric(input.topK, 20, 3, 100))),
    '--cost-bps', String(numeric(input.costBps, 8, 0, 100))
  ];
}

function strategyWindowList(value, fallback, label) {
  const source = Array.isArray(value) ? value : String(value == null ? fallback : value).split(',');
  const values = Array.from(new Set(source.map(item => Number(String(item).trim())))).sort((a, b) => a - b);
  if (!values.length || values.some(item => !Number.isInteger(item) || item < 1 || item > 250)) {
    const error = new Error(label + '必须是 1—250 之间的整数列表。');
    error.status = 400;
    throw error;
  }
  if (values.length > 12) {
    const error = new Error(label + '最多填写 12 个周期。');
    error.status = 400;
    throw error;
  }
  return values;
}

function strategyDecimalList(value, fallback, label, minimum, maximum) {
  const source = Array.isArray(value) ? value : String(value == null ? fallback : value).split(',');
  const values = Array.from(new Set(source.map(item => Number(String(item).trim())))).sort((a, b) => a - b);
  if (!values.length || values.some(item => !Number.isFinite(item) || item < minimum || item > maximum)) {
    const error = new Error(label + '必须是 ' + minimum + '—' + maximum + ' 之间的数字列表。');
    error.status = 400;
    throw error;
  }
  if (values.length > 12) {
    const error = new Error(label + '最多填写 12 个值。');
    error.status = 400;
    throw error;
  }
  return values;
}

function strategyLabArgs(input = {}) {
  const supportedFamilies = [
    'moving-average-crossover', 'macd-crossover', 'rsi-rebound', 'volume-breakout',
    'low-position-volume-stagnation'
  ];
  const strategyFamily = String(input.strategyFamily || 'moving-average-crossover');
  if (!supportedFamilies.includes(strategyFamily)) {
    const error = new Error('不支持的策略家族。');
    error.status = 400;
    throw error;
  }
  let familyArgs = [];
  let combinationCount = 0;
  if (strategyFamily === 'moving-average-crossover') {
    const shortWindows = strategyWindowList(input.shortWindows, '5,10,20', '短期均线');
    const longWindows = strategyWindowList(input.longWindows, '20,40,60', '长期均线');
    combinationCount = shortWindows.reduce(function(total, short) {
      return total + longWindows.filter(long => short < long).length;
    }, 0);
    familyArgs = ['--short-windows', shortWindows.join(','), '--long-windows', longWindows.join(',')];
  } else if (strategyFamily === 'macd-crossover') {
    const fastWindows = strategyWindowList(input.fastWindows, '8,12', 'MACD快线');
    const slowWindows = strategyWindowList(input.slowWindows, '26', 'MACD慢线');
    const signalWindows = strategyWindowList(input.signalWindows, '9', 'MACD信号线');
    combinationCount = fastWindows.reduce(function(total, fast) {
      return total + slowWindows.filter(slow => fast < slow).length * signalWindows.length;
    }, 0);
    familyArgs = [
      '--fast-windows', fastWindows.join(','), '--slow-windows', slowWindows.join(','),
      '--signal-windows', signalWindows.join(',')
    ];
  } else if (strategyFamily === 'rsi-rebound') {
    const rsiPeriods = strategyWindowList(input.rsiPeriods, '6,14', 'RSI周期');
    const entryThresholds = strategyWindowList(input.entryThresholds, '30', 'RSI入场阈值');
    const exitThresholds = strategyWindowList(input.exitThresholds, '70', 'RSI退出阈值');
    if (entryThresholds.some(value => value > 99) || exitThresholds.some(value => value > 100)) {
      const error = new Error('RSI阈值必须是 1—100 之间的整数。');
      error.status = 400;
      throw error;
    }
    combinationCount = rsiPeriods.length * entryThresholds.reduce(function(total, entry) {
      return total + exitThresholds.filter(exit => entry < exit).length;
    }, 0);
    familyArgs = [
      '--rsi-periods', rsiPeriods.join(','), '--entry-thresholds', entryThresholds.join(','),
      '--exit-thresholds', exitThresholds.join(',')
    ];
  } else if (strategyFamily === 'volume-breakout') {
    const breakoutWindows = strategyWindowList(input.breakoutWindows, '20,40', '突破周期');
    const volumeMultipliers = strategyDecimalList(input.volumeMultipliers, '1.5,2', '成交量倍数', 1, 20);
    const breakoutMargins = strategyDecimalList(input.breakoutMargins, '0.005', '突破幅度', 0.001, 1);
    const breakoutMinCloseLocations = strategyDecimalList(
      input.breakoutMinCloseLocations, '0.7', '突破收盘位置下限', 0.001, 1
    );
    combinationCount = breakoutWindows.length * volumeMultipliers.length
      * breakoutMargins.length * breakoutMinCloseLocations.length;
    familyArgs = [
      '--breakout-windows', breakoutWindows.join(','), '--volume-multipliers', volumeMultipliers.join(','),
      '--breakout-margins', breakoutMargins.join(','),
      '--breakout-min-close-locations', breakoutMinCloseLocations.join(',')
    ];
  } else {
    const positionLookbackWindows = strategyWindowList(
      input.positionLookbackWindows, '120', '位置回看周期'
    );
    const maxRangePositions = strategyDecimalList(
      input.maxRangePositions, '0.35', '区间位置上限', 0.001, 1
    );
    const volumeWindows = strategyWindowList(input.volumeWindows, '20', '均量周期');
    const volumeMultipliers = strategyDecimalList(input.volumeMultipliers, '1.8', '成交量倍数', 1, 20);
    const maxAbsReturns = strategyDecimalList(input.maxAbsReturns, '0.02', '单日涨跌幅上限', 0.001, 1);
    const maxIntradayRanges = strategyDecimalList(
      input.maxIntradayRanges, '0.06', '日内振幅上限', 0.001, 1
    );
    const minCloseLocations = strategyDecimalList(
      input.minCloseLocations, '0.5', '收盘位置下限', 0.001, 1
    );
    combinationCount = positionLookbackWindows.length * maxRangePositions.length
      * volumeWindows.length * volumeMultipliers.length * maxAbsReturns.length
      * maxIntradayRanges.length * minCloseLocations.length;
    familyArgs = [
      '--position-lookback-windows', positionLookbackWindows.join(','),
      '--max-range-positions', maxRangePositions.join(','),
      '--volume-windows', volumeWindows.join(','),
      '--volume-multipliers', volumeMultipliers.join(','),
      '--max-abs-returns', maxAbsReturns.join(','),
      '--max-intraday-ranges', maxIntradayRanges.join(','),
      '--min-close-locations', minCloseLocations.join(',')
    ];
  }
  if (!combinationCount) {
    const error = new Error('当前规则卡没有有效参数组合。');
    error.status = 400;
    throw error;
  }
  if (combinationCount > 64) {
    const error = new Error('单次研究最多运行 64 组有效策略参数。');
    error.status = 400;
    throw error;
  }
  const testDays = Math.round(numeric(input.testDays, 63, 21, 252));
  const stepDays = Math.round(numeric(input.stepDays, 63, 21, 252));
  if (stepDays < testDays) {
    const error = new Error('滚动步长不能小于测试窗口，否则样本外区间会重叠。');
    error.status = 400;
    throw error;
  }
  const requestedFolds = input.maxFolds == null ? 4 : Number(input.maxFolds);
  if (!Number.isInteger(requestedFolds) || requestedFolds < 3 || requestedFolds > 12) {
    const error = new Error('参数稳定性研究至少需要 3 个、最多 12 个样本外窗口。');
    error.status = 400;
    throw error;
  }
  return ['--strategy-family', strategyFamily].concat(familyArgs, [
    '--train-days', String(Math.round(numeric(input.trainDays, 252, 63, 2520))),
    '--validation-days', String(Math.round(numeric(input.validationDays, 63, 21, 504))),
    '--test-days', String(testDays),
    '--step-days', String(stepDays),
    '--max-folds', String(requestedFolds),
    '--min-history-days', String(Math.round(numeric(input.minHistoryDays, 120, 20, 504))),
    '--max-instruments', String(Math.round(numeric(input.maxInstruments, 600, 50, 1200))),
    '--commission-bps', String(numeric(input.commissionBps, 2.5, 0, 100)),
    '--minimum-commission', String(numeric(input.minimumCommission, 5, 0, 100)),
    '--stamp-duty-bps', String(numeric(input.stampDutyBps, 5, 0, 100)),
    '--slippage-bps', String(numeric(input.slippageBps, 2, 0, 100)),
    '--capital-per-symbol', String(numeric(input.capitalPerSymbol, 100000, 1000, 10000000))
  ]);
}

function signalScanArgs(input = {}) {
  const strategyFamily = String(input.strategyFamily || 'low-position-volume-stagnation');
  const single = function(values, label) {
    if (values.length !== 1) {
      const error = new Error(label + '在单次扫描中必须且只能填写一个值。');
      error.status = 400;
      throw error;
    }
    return values[0];
  };
  if (strategyFamily === 'low-position-volume-stagnation') {
    const lookback = single(strategyWindowList(input.positionLookbackWindows, '120', '位置回看周期'), '位置回看周期');
    const maxPosition = single(strategyDecimalList(input.maxRangePositions, '0.35', '区间位置上限', 0.001, 1), '区间位置上限');
    const volumeWindow = single(strategyWindowList(input.volumeWindows, '20', '均量周期'), '均量周期');
    const multiplier = single(strategyDecimalList(input.volumeMultipliers, '1.8', '成交量倍数', 1, 20), '成交量倍数');
    const maxReturn = single(strategyDecimalList(input.maxAbsReturns, '0.02', '单日涨跌幅上限', 0.001, 1), '单日涨跌幅上限');
    const maxRange = single(strategyDecimalList(input.maxIntradayRanges, '0.06', '日内振幅上限', 0.001, 1), '日内振幅上限');
    const minClose = single(strategyDecimalList(input.minCloseLocations, '0.5', '收盘位置下限', 0.001, 1), '收盘位置下限');
    return [
      '--strategy-family', strategyFamily,
      '--position-lookback-windows', String(lookback), '--max-range-positions', String(maxPosition),
      '--volume-windows', String(volumeWindow), '--volume-multipliers', String(multiplier),
      '--max-abs-returns', String(maxReturn), '--max-intraday-ranges', String(maxRange),
      '--min-close-locations', String(minClose)
    ];
  }
  if (strategyFamily === 'volume-breakout') {
    const window = single(strategyWindowList(input.breakoutWindows, '20', '突破周期'), '突破周期');
    const multiplier = single(strategyDecimalList(input.volumeMultipliers, '1.5', '成交量倍数', 1, 20), '成交量倍数');
    const margin = single(strategyDecimalList(input.breakoutMargins, '0.005', '突破幅度', 0.001, 1), '突破幅度');
    const minClose = single(strategyDecimalList(input.breakoutMinCloseLocations, '0.7', '突破收盘位置下限', 0.001, 1), '突破收盘位置下限');
    return [
      '--strategy-family', strategyFamily,
      '--breakout-windows', String(window), '--volume-multipliers', String(multiplier),
      '--breakout-margins', String(margin), '--breakout-min-close-locations', String(minClose)
    ];
  }
  const error = new Error('首期扫描仅支持“低位放量滞涨”和“放量突破前高”。');
  error.status = 400;
  throw error;
}

function defaultMasterMaxInstruments(totalMemory = os.totalmem()) {
  const gib = Number(totalMemory) / (1024 ** 3);
  if (gib >= 24) return 600;
  if (gib >= 12) return 350;
  return 200;
}

function commonModelArgs(input) {
  return commonEvaluationArgs(input).concat([
    '--num-boost-round', String(Math.round(numeric(input.numBoostRound, 300, 20, 2000))),
    '--early-stopping-rounds', String(Math.round(numeric(input.earlyStoppingRounds, 30, 5, 200))),
    '--master-lookback', String(Math.round(numeric(input.masterLookback, 8, 4, 60))),
    '--master-epochs', String(Math.round(numeric(input.masterEpochs, 20, 1, 200))),
    '--master-patience', String(Math.round(numeric(input.masterPatience, 4, 1, 40))),
    '--master-learning-rate', String(numeric(input.masterLearningRate, 0.001, 0.00001, 0.1)),
    '--master-d-model', String(Math.round(numeric(input.masterDModel, 32, 8, 256))),
    '--master-temporal-heads', String(Math.round(numeric(input.masterTemporalHeads, 2, 1, 8))),
    '--master-cross-stock-heads', String(Math.round(numeric(input.masterCrossStockHeads, 2, 1, 8))),
    '--master-dropout', String(numeric(input.masterDropout, 0.1, 0, 0.8)),
    '--master-gate-temperature', String(numeric(input.masterGateTemperature, 1, 0.05, 20)),
    '--master-batch-days', String(Math.round(numeric(input.masterBatchDays, 16, 1, 64))),
    '--master-max-instruments', String(Math.round(numeric(
      input.masterMaxInstruments,
      defaultMasterMaxInstruments(),
      50,
      1200
    )))
  ]);
}

function modelValue(value) {
  const model = String(value || 'lightgbm').trim().toLowerCase();
  if (!['lightgbm', 'master'].includes(model)) {
    const error = new Error('请选择已注册的量化模型。');
    error.status = 400;
    throw error;
  }
  return model;
}

function previousWeekday(dateText) {
  const value = new Date(String(dateText) + 'T00:00:00Z');
  do { value.setUTCDate(value.getUTCDate() - 1); } while ([0, 6].includes(value.getUTCDay()));
  return value.toISOString().slice(0, 10);
}

function latestCompletedMarketDate(now = new Date()) {
  const clock = strategyDaily.beijingClock(now);
  if ([0, 6].includes(clock.weekday)) return previousWeekday(clock.date);
  const close = new Date(clock.date + 'T15:05:00');
  return clock.pseudoLocal >= close ? clock.date : previousWeekday(clock.date);
}

function subtractYears(dateText, years) {
  const match = String(dateText).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error('研究截止日期格式无效。');
  const year = Number(match[1]) - Number(years);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return [year, String(month).padStart(2, '0'), String(Math.min(day, lastDay)).padStart(2, '0')].join('-');
}

function safeResearchId(value) {
  const safe = String(value || 'self-stock').replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-');
  return safe.replace(/^-|-$/g, '').slice(0, 24) || 'self-stock';
}

function watchlistResearchPlan(input = {}, options = {}) {
  const catalog = options.catalog || tonghuashunWatchlist.readLocalCatalog();
  const groups = Array.isArray(catalog && catalog.groups) ? catalog.groups : [];
  const requestedId = String(input.groupId || 'default-self-stock').trim();
  const requestedName = String(input.groupName || '').trim();
  const group = groups.find(item => String(item.id || '') === requestedId) ||
    (requestedName && groups.find(item => String(item.name || '') === requestedName));
  if (!group) {
    const error = new Error('未找到指定的同花顺自选分组。');
    error.status = 404;
    throw error;
  }
  const seen = new Set();
  const items = [];
  (Array.isArray(group.items) ? group.items : []).forEach(function(item) {
    const code = String(item && item.code || '').trim();
    if (!/^\d{6}$/.test(code)) {
      const error = new Error('同花顺分组包含不支持的证券代码：' + code);
      error.status = 400;
      throw error;
    }
    if (seen.has(code)) return;
    seen.add(code);
    items.push({ code, name: String(item && item.name || code).trim() || code });
  });
  if (items.length < 8 || items.length > 120) {
    const error = new Error('自选研究分组需要包含 8—120 只证券，当前为 ' + items.length + ' 只。');
    error.status = 400;
    throw error;
  }
  const endDate = dateValue(input.endDate, latestCompletedMarketDate(options.now || new Date()));
  const startDate = dateValue(input.startDate, subtractYears(endDate, 5));
  if (startDate > endDate) throw new Error('开始日期不能晚于结束日期。');
  const codes = items.map(item => item.code);
  const selectionHash = crypto.createHash('sha256').update(codes.join(','), 'utf8').digest('hex');
  const datasetId = [
    'ths', safeResearchId(group.id || group.name),
    startDate.replace(/\D/g, ''), endDate.replace(/\D/g, ''), selectionHash.slice(0, 8)
  ].join('-');
  const workspace = ensureWorkspace();
  const inputPath = path.join(workspace, 'watchlist-inputs', datasetId + '.json');
  const workers = Math.round(numeric(input.workers, 3, 1, 6));
  const collectArgs = [
    'collect', '--workspace', workspace, '--universe-file', inputPath, '--dataset-id', datasetId,
    '--limit', String(items.length), '--codes', codes.join(','),
    '--start-date', startDate, '--end-date', endDate,
    '--adjustment-mode', 'forward-adjusted',
    '--sleep-ms', String(Math.round(numeric(input.sleepMs, 600, 100, 5000))),
    '--workers', String(workers)
  ];
  return {
    datasetId,
    startDate,
    endDate,
    codes,
    items,
    inputPath,
    collectArgs,
    group: {
      id: String(group.id || ''),
      name: String(group.name || ''),
      count: items.length,
      sourcePath: String(group.sourcePath || catalog.cachePath || ''),
      fileUpdatedAt: String(catalog.fileUpdatedAt || '')
    },
    request: Object.assign({}, input, {
      groupId: String(group.id || ''),
      groupName: String(group.name || ''),
      securityCount: items.length,
      datasetId,
      startDate,
      endDate,
      adjustmentMode: 'forward-adjusted',
      automaticTrading: false,
      readOnlyTonghuashun: true
    })
  };
}

function listWatchlistResearchGroups() {
  try {
    const catalog = tonghuashunWatchlist.readLocalCatalog();
    return {
      available: true,
      fileUpdatedAt: catalog.fileUpdatedAt || '',
      cachePath: catalog.cachePath || '',
      groups: (catalog.groups || []).map(function(group) {
        return {
          id: String(group.id || ''),
          name: String(group.name || ''),
          count: Array.isArray(group.items) ? group.items.length : 0,
          sourcePath: String(group.sourcePath || '')
        };
      })
    };
  } catch (error) {
    return { available: false, error: error.message, groups: [] };
  }
}

function writeJsonAtomic(filename, value) {
  const temporary = filename + '.tmp-' + process.pid;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temporary, filename);
}

function verifyWatchlistSelection(manifest, plan) {
  if (manifest.adjustmentMode !== 'forward-adjusted') {
    throw new Error('自选研究数据没有使用明确的前复权口径。');
  }
  if (Number(manifest.coverage && manifest.coverage.requested) !== plan.codes.length) {
    throw new Error('数据清单的请求数量与同花顺分组不一致。');
  }
  const universeFile = (manifest.files || []).find(file => file.kind === 'universe');
  if (!universeFile) throw new Error('数据集缺少证券池清单。');
  const universePathValue = path.join(ensureWorkspace(), 'datasets', manifest.datasetId, universeFile.path);
  const universe = readJson(universePathValue);
  const selectedCodes = (universe.selected || []).map(item => String(item.code || '')).sort();
  const expectedCodes = plan.codes.slice().sort();
  if (selectedCodes.join(',') !== expectedCodes.join(',')) {
    throw new Error('实际采集证券列表与同花顺分组不一致。');
  }
  if (Number(manifest.coverage && manifest.coverage.succeeded) < 8) {
    throw new Error('可用历史数据少于 8 只，无法运行自选策略研究。');
  }
  return {
    requestedCodes: plan.codes,
    includedCodes: (universe.selected || []).filter(item =>
      !(universe.failures || []).some(failure => failure.code === item.code)
    ).map(item => item.code),
    failures: Array.isArray(universe.failures) ? universe.failures : []
  };
}

function buildWatchlistResearchSummary(report, manifest, group, selection) {
  const comparisons = Array.isArray(report.comparisons) ? report.comparisons : [];
  const candidates = Array.isArray(report.candidates) ? report.candidates : [];
  const lines = [
    group.name + '量化研究已完成：请求 ' + manifest.coverage.requested + ' 只，成功 ' + manifest.coverage.succeeded +
      ' 只，失败 ' + manifest.coverage.failed + ' 只；数据截至 ' + manifest.asOf + '，口径为前复权。',
    '四类策略结果：' + comparisons.map(item => item.label + '（稳定参数 ' + item.stableParameterCount +
      '，当前候选 ' + item.candidateCount + '）').join('；') + '。',
    candidates.length
      ? '本次研究候选 ' + candidates.length + ' 只：' + candidates.slice(0, 10).map(item => item.code + ' ' + item.name).join('、') + '。'
      : '本次没有满足当前样本外门槛和收盘信号的研究候选。',
    '限制：使用当前同花顺分组成分，仍有幸存者偏差；公开数据源条款未独立验证；结果不自动下单。'
  ];
  if (selection.failures.length) {
    lines.push('采集失败：' + selection.failures.map(function(item) {
      const reason = String(item.reason || '未知原因');
      if (/\b501\b|not implemented|returned no rows/i.test(reason)) {
        return item.code + ' 前复权公开数据源未返回可用记录';
      }
      return item.code + ' ' + reason.split(/\s+for url:/i)[0].slice(0, 120);
    }).join('；') + '。完整错误保留在“数据限制与失败项”。');
  }
  return lines.join('\n');
}

function buildWatchlistHandoffPrompt(report, manifest, group, localSummary) {
  const packet = {
    group,
    data: {
      datasetId: manifest.datasetId,
      asOf: manifest.asOf,
      adjustmentMode: manifest.adjustmentMode,
      eligibility: manifest.eligibility,
      coverage: manifest.coverage,
      warnings: manifest.warnings
    },
    strategies: report.comparisons,
    candidates: report.candidates,
    reportWarnings: report.warnings,
    automaticTrading: false
  };
  return '请只依据以下 WebStock 结构化量化证据进行分析。先评价数据可信度，再逐策略说明样本外证据，' +
    '然后给出候选观察顺序、反证、缺失信息和人工核验步骤；不要补造行情、胜率或收益承诺。\n\n' +
    localSummary + '\n\n结构化证据：\n' + JSON.stringify(packet, null, 2);
}

function buildRecommendationPreview(report) {
  const candidates = Array.isArray(report.candidates) ? report.candidates : [];
  const shortlist = candidates.slice(0, 20);
  return {
    status: candidates.length ? 'ready' : 'blocked',
    automaticApply: false,
    reason: candidates.length ? '等待用户显式确认后才能写入同花顺每日荐股分组。' : '本次没有合格候选，禁止写入空荐股分组。',
    date: report.asOf || '',
    groupName: report.asOf ? defaultRecommendationGroupName(report.asOf) : '',
    totalCandidateCount: candidates.length,
    truncated: shortlist.length < candidates.length,
    items: shortlist.map(function(item) {
      return {
        code: item.code,
        name: item.name,
        tier: item.stableFamilyCount > 1 ? '多策略稳定' : (item.stableFamilyCount ? '单策略稳定' : '继续观察')
      };
    })
  };
}

function startJob(kind, args, request) {
  const runtime = getRuntimeStatus();
  if (!['configured', 'available'].includes(runtime.status)) {
    const error = new Error(runtime.reason);
    error.status = 409;
    throw error;
  }
  const existing = activeJob();
  if (existing) {
    const error = new Error('已有量化任务正在运行：' + existing.id);
    error.status = 409;
    throw error;
  }
  const job = {
    id: newJobId(kind),
    kind,
    status: 'queued',
    request,
    progress: { stage: 'queued', message: '等待启动。' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    output: null,
    error: ''
  };
  jobs.set(job.id, job);
  persistJob(job);
  runProtocol(args, {
    onChild(child) {
      children.set(job.id, child);
      job.status = 'running';
      job.updatedAt = new Date().toISOString();
      persistJob(job);
    },
    onEvent(event) {
      job.progress = event;
      job.updatedAt = new Date().toISOString();
      persistJob(job);
    }
  }).then(output => {
    if (output.kind === 'dataset') {
      const manifestPath = path.resolve(output.manifestPath || '');
      const workspace = ensureWorkspace();
      if (!isInside(workspace, manifestPath)) throw new Error('数据集输出超出已配置的工作区。');
      const manifest = verifyManifest(manifestPath);
      job.status = 'completed';
      job.progress = { stage: 'completed', message: '数据集采集完成。' };
      job.output = {
        manifestPath,
        datasetId: manifest.datasetId,
        asOf: manifest.asOf,
        coverage: manifest.coverage
      };
      job.updatedAt = new Date().toISOString();
      persistJob(job);
      return;
    }
    if (output.kind === 'factor-lab') {
      const verified = verifyFactorResult(output);
      job.status = 'completed';
      job.progress = { stage: 'completed', message: '因子样本外体检完成。' };
      job.output = {
        manifestPath: verified.manifestPath,
        resultPath: verified.resultPath,
        datasetId: verified.manifest.datasetId,
        runId: verified.result.runId,
        modelId: 'local-factor-lab-v1',
        validationStatus: verified.result.validationStatus,
        asOf: verified.result.asOf,
        coverage: verified.manifest.coverage,
        metrics: verified.result.composite.metrics,
        factorCount: verified.result.factors.length
      };
      job.updatedAt = new Date().toISOString();
      researchRuns.createRun({
        runType: 'factor-lab',
        modelId: 'local-factor-lab-v1',
        status: 'completed',
        title: '因子样本外体检 ' + verified.manifest.datasetId,
        result: JSON.stringify({
          validationStatus: verified.result.validationStatus,
          factors: verified.result.factors.map(factor => ({
            factorId: factor.factorId,
            admission: factor.admission,
            testRankIc: factor.testRankIc,
            positiveFoldRate: factor.positiveFoldRate,
            reasons: factor.reasons
          })),
          candidates: verified.result.composite.candidates,
          warnings: verified.result.warnings
        }, null, 2),
        request: { jobId: job.id, manifestPath: verified.manifestPath, resultPath: verified.resultPath },
        metrics: verified.result.composite.metrics
      });
      persistJob(job);
      return;
    }
    if (output.kind === 'strategy-lab') {
      const verified = verifyStrategyResult(output);
      const best = verified.result.bestParameter || {};
      job.status = 'completed';
      job.progress = { stage: 'completed', message: '批量策略样本外研究完成。' };
      job.output = {
        manifestPath: verified.manifestPath,
        resultPath: verified.resultPath,
        datasetId: verified.manifest.datasetId,
        runId: verified.result.runId,
        modelId: 'local-ma-strategy-lab-v1',
        validationStatus: verified.result.validationStatus,
        asOf: verified.result.asOf,
        coverage: verified.result.universe,
        metrics: verified.result.selectedWalkForward,
        parameterCount: verified.result.parameters.length,
        stableParameterCount: verified.result.stableParameterIds.length
      };
      job.updatedAt = new Date().toISOString();
      researchRuns.createRun({
        runType: 'strategy-lab',
        modelId: 'local-ma-strategy-lab-v1',
        status: 'completed',
        title: String(verified.result.ruleCard.label || '受控策略') + '样本外研究 ' + verified.manifest.datasetId,
        result: JSON.stringify({
          automaticTrading: false,
          validationStatus: verified.result.validationStatus,
          bestParameter: best,
          stableParameterIds: verified.result.stableParameterIds,
          selectedWalkForward: verified.result.selectedWalkForward,
          warnings: verified.result.warnings
        }, null, 2),
        request: { jobId: job.id, manifestPath: verified.manifestPath, resultPath: verified.resultPath },
        metrics: verified.result.selectedWalkForward
      });
      persistJob(job);
      return;
    }
    if (output.kind === 'signal-scan') {
      const verified = verifySignalScanResult(output);
      job.status = 'completed';
      job.progress = { stage: 'completed', message: '全市场信号扫描完成。' };
      job.output = {
        manifestPath: verified.manifestPath,
        resultPath: verified.resultPath,
        datasetId: verified.manifest.datasetId,
        runId: verified.result.runId,
        modelId: 'local-signal-scan-v1',
        validationMode: verified.result.validationMode,
        asOf: verified.result.asOf,
        coverage: verified.result.universe,
        candidateCount: verified.result.candidateCount,
        storedCount: verified.result.storedCount,
        formalAllowed: verified.result.dataGate.formalAllowed
      };
      job.updatedAt = new Date().toISOString();
      researchRuns.createRun({
        runType: 'signal-scan',
        modelId: 'local-signal-scan-v1',
        status: 'completed',
        title: String(verified.result.ruleCard.label || '受控规则') + '全市场扫描 ' + verified.result.asOf,
        result: JSON.stringify({
          validationMode: verified.result.validationMode,
          dataGate: verified.result.dataGate,
          candidateCount: verified.result.candidateCount,
          candidates: verified.result.candidates,
          warnings: verified.result.warnings
        }, null, 2),
        request: { jobId: job.id, manifestPath: verified.manifestPath, resultPath: verified.resultPath },
        metrics: { candidateCount: verified.result.candidateCount, storedCount: verified.result.storedCount }
      });
      persistJob(job);
      return;
    }
    if (output.kind === 'expert-backtest') {
      const verified = verifyExpertResult(output);
      job.status = 'completed';
      job.progress = { stage: 'completed', message: '创作者语录事件回测完成。' };
      job.output = {
        manifestPath: verified.manifestPath,
        resultPath: verified.resultPath,
        datasetId: verified.manifest.datasetId,
        runId: verified.result.runId,
        modelId: 'expert-event-study-v1',
        validationStatus: verified.result.validationStatus,
        asOf: verified.result.asOf,
        metrics: verified.result.metrics
      };
      job.updatedAt = new Date().toISOString();
      expertChannels.recordBacktest(verified.result.channelId, {
        runId: verified.result.runId,
        datasetId: verified.manifest.datasetId,
        status: verified.result.validationStatus,
        signalAt: verified.result.createdAt,
        resultPath: path.relative(ensureWorkspace(), verified.resultPath),
        resultSha256: sha256File(verified.resultPath),
        methodology: verified.result.parameters,
        result: verified.result
      });
      researchRuns.createRun({
        runType: 'expert-event-backtest',
        modelId: 'expert-event-study-v1',
        status: 'completed',
        title: '创作者语录事件回测 ' + verified.manifest.datasetId,
        result: JSON.stringify(verified.result, null, 2),
        request: { jobId: job.id, channelId: verified.result.channelId, datasetId: verified.manifest.datasetId },
        metrics: verified.result.metrics
      });
      persistJob(job);
      return;
    }
    const verified = verifyResult(output);
    job.status = 'completed';
    job.progress = { stage: 'completed', message: '量化研究运行完成。' };
    job.output = {
      manifestPath: verified.manifestPath,
      resultPath: verified.resultPath,
      datasetId: verified.manifest.datasetId,
      runId: verified.result.runId,
      modelId: verified.result.modelId,
      validationStatus: verified.result.validationStatus,
      asOf: verified.result.asOf,
      coverage: verified.manifest.coverage,
      metrics: verified.result.metrics
    };
    job.updatedAt = new Date().toISOString();
    researchRuns.createRun({
      runType: 'quant-backtest',
      modelId: verified.result.modelId,
      status: 'completed',
      title: (String(verified.result.modelId).includes('master') ? 'MASTER ' : 'Qlib + LightGBM ') + verified.manifest.datasetId,
      result: JSON.stringify({
        validationStatus: verified.result.validationStatus,
        asOf: verified.result.asOf,
        candidates: verified.result.candidates,
        warnings: verified.result.warnings
      }, null, 2),
      request: { jobId: job.id, manifestPath: verified.manifestPath, resultPath: verified.resultPath },
      metrics: verified.result.metrics
    });
    persistJob(job);
  }).catch(error => {
    if (job.status !== 'cancelled') job.status = 'failed';
    job.error = error.message;
    job.progress = { stage: job.status, message: error.message };
    job.updatedAt = new Date().toISOString();
    persistJob(job);
  }).finally(() => children.delete(job.id));
  return publicJob(job);
}

function startRuntimeInstall(input = {}) {
  loadRuntimeManifest(quantRoot());
  const existing = activeJob();
  if (existing) {
    const error = new Error('已有量化任务正在运行：' + existing.id);
    error.status = 409;
    throw error;
  }
  const indexMode = input.indexMode === 'china' ? 'china' : 'official';
  const force = !!input.force;
  const job = {
    id: newJobId('runtime-install'),
    kind: 'runtime-install',
    status: 'queued',
    request: { indexMode, force },
    progress: { stage: 'queued', message: '等待安装量化运行环境。' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    output: null,
    error: ''
  };
  const controller = new AbortController();
  jobs.set(job.id, job);
  children.set(job.id, { kill() { controller.abort(); } });
  persistJob(job);
  job.status = 'running';
  job.updatedAt = new Date().toISOString();
  persistJob(job);
  const installer = createRuntimeInstaller({ workspace: ensureWorkspace(), quantRoot: quantRoot() });
  installer.install({
    force,
    indexMode,
    signal: controller.signal,
    onProgress(progress) {
      job.progress = progress;
      job.updatedAt = new Date().toISOString();
      persistJob(job);
    }
  }).then(async output => {
    runtimeCache = null;
    const verified = await verifyRuntime();
    if (!verified.verified || verified.status !== 'available') throw new Error(verified.reason || '量化环境安装后验证失败。');
    job.status = 'completed';
    job.progress = { stage: 'completed', message: '量化运行环境安装并验证完成。' };
    job.output = {
      verified: true,
      installedAt: output.installedAt,
      versions: verified.versions || output.versions || {}
    };
    job.updatedAt = new Date().toISOString();
    persistJob(job);
  }).catch(error => {
    if (job.status !== 'cancelled') {
      job.status = 'failed';
      job.error = error.message;
      job.progress = { stage: 'failed', message: error.message };
      job.updatedAt = new Date().toISOString();
      persistJob(job);
    }
  }).finally(() => children.delete(job.id));
  return publicJob(job);
}

function startPilot(input = {}) {
  const workspace = ensureWorkspace();
  const startDate = dateValue(input.startDate, '2019-01-01');
  const endDate = dateValue(input.endDate, new Date().toISOString().slice(0, 10));
  if (startDate > endDate) throw new Error('开始日期不能晚于结束日期。');
  const limit = Math.round(numeric(input.limit, 30, 8, 120));
  const model = modelValue(input.model);
  const args = [
    'pilot', '--workspace', workspace, '--universe-file', universePath(),
    '--limit', String(limit), '--start-date', startDate, '--end-date', endDate,
    '--sleep-ms', String(Math.round(numeric(input.sleepMs, 120, 0, 1000))),
    '--workers', String(Math.round(numeric(input.workers, 2, 1, 4))), '--model', model
  ].concat(commonModelArgs(input));
  return startJob('pilot', args, Object.assign({}, input, { model, limit, startDate, endDate }));
}

function collectionDatasetId(startDate, endDate) {
  return 'sina-a-share-' + String(startDate).replace(/\D/g, '') + '-' + String(endDate).replace(/\D/g, '');
}

function fullMarketDatasetId(startDate, endDate) {
  return 'a-share-qfq-' + String(startDate).replace(/\D/g, '') + '-' + String(endDate).replace(/\D/g, '');
}

function fullMarketSyncPlan(options = {}) {
  const dataHealth = require('./dataHealthService');
  const rootDir = options.rootDir || path.join(__dirname, '..');
  const expectedAsOf = String(options.expectedAsOf || dataHealth.latestCompletedMarketDate(options.now || new Date()));
  const expectedUniverseCount = Number(options.expectedUniverseCount || dataHealth.eligibleStockCount(rootDir));
  const status = dataHealth.fullMarketDatasetStatus(
    options.datasets || listDatasets(200),
    { expectedAsOf, expectedUniverseCount }
  );
  let action = status.action;
  const baselineSucceeded = Number(
    status.baseline && status.baseline.coverage && status.baseline.coverage.succeeded || 0
  );
  const minimumCoverage = Math.max(Math.floor(expectedUniverseCount * 0.9), 5000);
  if (
    options.repairIncomplete === true &&
    status.state === 'ready' &&
    status.baseline &&
    baselineSucceeded < minimumCoverage
  ) {
    const repairStartDate = status.baseline.requestedDateRange &&
      status.baseline.requestedDateRange.start ||
      status.baseline.dateRange && status.baseline.dateRange.start || '';
    action = {
      mode: 'repair',
      reason: '全市场基线覆盖不足，显式重试失败证券。',
      startDate: repairStartDate,
      endDate: expectedAsOf,
      baseDatasetId: '',
      fetchStartDate: repairStartDate
    };
  }
  const startDate = action.startDate || status.baseline && status.baseline.dateRange && status.baseline.dateRange.start || '';
  const endDate = action.endDate || expectedAsOf;
  return Object.assign({}, status, {
    action,
    schema: 'webstock.quant.full-market-sync-plan.v1',
    datasetId: action.mode === 'none' || action.mode === 'repair'
      ? String(status.baseline && status.baseline.datasetId || '')
      : fullMarketDatasetId(startDate, endDate),
    adjustmentMode: 'forward-adjusted',
    baseDatasetId: String(action.baseDatasetId || ''),
    fetchStartDate: String(action.fetchStartDate || startDate),
    expectedAsOf,
    expectedUniverseCount,
    automaticTrading: false
  });
}

function getFullMarketSyncStatus(options = {}) {
  const plan = fullMarketSyncPlan(options);
  const active = listJobs(200).find(function(job) {
    return job.kind === 'full-market-sync' && ['queued', 'running'].includes(job.status);
  }) || null;
  return Object.assign({}, plan, { activeJob: active });
}

function signalScanReadiness(options = {}) {
  const datasets = options.datasets || listDatasets(200);
  const plan = options.plan || fullMarketSyncPlan(Object.assign({}, options, { datasets }));
  const baseline = plan.baseline || null;
  const entry = baseline && datasets.find(function(item) {
    return item && item.valid === true && item.manifest && item.manifest.datasetId === baseline.datasetId;
  });
  const manifest = entry && entry.manifest || null;
  const minimumCoverage = Math.max(Math.floor(Number(plan.expectedUniverseCount || 0) * 0.9), 5000);
  const succeeded = Number(manifest && manifest.coverage && manifest.coverage.succeeded || 0);
  const fresh = !!(manifest && String(manifest.asOf || '') >= String(plan.expectedAsOf || ''));
  const adjusted = !!(manifest && manifest.adjustmentMode === 'forward-adjusted');
  const complete = succeeded >= minimumCoverage;
  const ready = plan.state === 'ready' && fresh && adjusted && complete;
  const formalAllowed = ready && manifest.eligibility === 'validation_eligible';
  const exploratoryAllowed = ready;
  let state = formalAllowed ? 'ready-formal' : (exploratoryAllowed ? 'ready-exploratory' : 'blocked');
  let reason = formalAllowed
    ? '数据集通过正式筛选资格门禁。'
    : (exploratoryAllowed
      ? '全市场数据可用于探索扫描，但当前名单不是点时成分，不能标记为正式结果。'
      : plan.action && plan.action.reason || '全市场前复权数据尚未达到扫描要求。');
  if (plan.state === 'ready' && !complete) {
    state = 'blocked';
    reason = '全市场成功覆盖仅 ' + succeeded + ' 只，低于门禁 ' + minimumCoverage + ' 只。';
  }
  return {
    schema: 'webstock.quant.signal-scan-readiness.v1',
    checkedAt: new Date().toISOString(),
    state,
    reason,
    datasetId: String(manifest && manifest.datasetId || ''),
    asOf: String(manifest && manifest.asOf || ''),
    expectedAsOf: String(plan.expectedAsOf || ''),
    coverage: manifest && manifest.coverage || null,
    minimumCoverage,
    eligibility: String(manifest && manifest.eligibility || ''),
    adjustmentMode: String(manifest && manifest.adjustmentMode || ''),
    membershipMode: String(manifest && manifest.universe && manifest.universe.membershipMode || ''),
    formalAllowed,
    exploratoryAllowed,
    defaultValidationMode: formalAllowed ? 'formal' : 'exploratory',
    automaticTrading: false,
    syncPlan: plan
  };
}

function fullMarketAutoSyncDecision(options = {}) {
  const plan = fullMarketSyncPlan(options);
  if (plan.action.mode === 'full') {
    return { action: 'baseline-required', reason: '首次全市场前复权基线需要用户显式启动。', plan };
  }
  if (plan.action.mode === 'none') {
    return { action: 'up-to-date', reason: plan.action.reason, plan };
  }
  const clock = strategyDaily.beijingClock(options.now || new Date());
  const dueAt = new Date(clock.date + 'T09:05:00');
  if ([0, 6].includes(clock.weekday) || clock.pseudoLocal < dueAt) {
    return { action: 'waiting', reason: '每日 09:05 后检查上一完成交易日的数据。', plan };
  }
  const runtimeAvailable = options.runtimeAvailable == null
    ? ['configured', 'available'].includes(getRuntimeStatus().status)
    : options.runtimeAvailable === true;
  if (!runtimeAvailable) {
    return { action: 'runtime-required', reason: '量化运行环境不可用，无法执行日线增量。', plan };
  }
  const knownJobs = Array.isArray(options.jobs) ? options.jobs : Array.from(jobs.values());
  const active = knownJobs.find(function(job) {
    return job && ['queued', 'running'].includes(job.status);
  });
  if (active) {
    return { action: 'busy', reason: '已有量化任务正在运行：' + active.id, plan };
  }
  const attempted = knownJobs.find(function(job) {
    return job && job.kind === 'full-market-sync' && job.request &&
      job.request.trigger === 'scheduled' && job.request.endDate === plan.expectedAsOf;
  });
  if (attempted) {
    return { action: 'already-attempted', reason: '今日自动增量已经执行或记录过结果。', plan };
  }
  return { action: 'run', reason: '基线早于上一完成交易日，开始每日增量。', plan };
}

function runScheduledFullMarketSync(options = {}) {
  const decision = fullMarketAutoSyncDecision(options);
  if (decision.action !== 'run') return decision;
  const job = startFullMarketSync({ trigger: 'scheduled', automaticTrading: false });
  return Object.assign({}, decision, { action: 'started', job });
}

function startFullMarketSync(input = {}) {
  // Dataset identity, cutoff and baseline always come from verified local state.
  // The request body may tune bounded execution settings only.
  const plan = fullMarketSyncPlan({ repairIncomplete: input.repairIncomplete === true });
  if (plan.action.mode === 'none') {
    return { started: false, reason: plan.action.reason, plan };
  }
  const workspace = ensureWorkspace();
  const workers = Math.round(numeric(input.workers, 3, 1, 6));
  const sleepMs = Math.round(numeric(input.sleepMs, 600, 100, 5000));
  const args = [
    'collect', '--workspace', workspace, '--universe-file', universePath(),
    '--dataset-id', plan.datasetId,
    '--limit', String(plan.expectedUniverseCount),
    '--start-date', plan.action.startDate,
    '--end-date', plan.expectedAsOf,
    '--adjustment-mode', 'forward-adjusted',
    '--sleep-ms', String(sleepMs), '--workers', String(workers)
  ];
  if (plan.baseDatasetId) args.push('--base-dataset-id', plan.baseDatasetId);
  return startJob('full-market-sync', args, Object.assign({}, input, {
    datasetId: plan.datasetId,
    baseDatasetId: plan.baseDatasetId,
    mode: plan.action.mode,
    startDate: plan.action.startDate,
    fetchStartDate: plan.fetchStartDate,
    endDate: plan.expectedAsOf,
    adjustmentMode: 'forward-adjusted',
    expectedUniverseCount: plan.expectedUniverseCount,
    workers,
    sleepMs,
    automaticTrading: false
  }));
}

function startCollection(input = {}) {
  const workspace = ensureWorkspace();
  const startDate = dateValue(input.startDate, '2019-01-01');
  const endDate = dateValue(input.endDate, new Date().toISOString().slice(0, 10));
  if (startDate > endDate) throw new Error('开始日期不能晚于结束日期。');
  const limit = Math.round(numeric(input.limit, 5510, 8, 6000));
  const datasetId = collectionDatasetId(startDate, endDate);
  const workers = Math.round(numeric(input.workers, 3, 1, 6));
  const args = [
    'collect', '--workspace', workspace, '--universe-file', universePath(), '--dataset-id', datasetId,
    '--limit', String(limit), '--start-date', startDate, '--end-date', endDate,
    '--sleep-ms', String(Math.round(numeric(input.sleepMs, 600, 100, 5000))),
    '--workers', String(workers)
  ];
  return startJob('collect', args, Object.assign({}, input, { datasetId, limit, startDate, endDate, workers }));
}

function startRun(input = {}) {
  const datasetId = String(input.datasetId || '').trim();
  if (!/^[A-Za-z0-9._-]{3,100}$/.test(datasetId)) throw new Error('请选择有效的数据集。');
  const model = modelValue(input.model);
  const workspace = ensureWorkspace();
  const runId = (model === 'master' ? 'master-' : 'qlib-lightgbm-') + compactUtcTimestamp();
  const args = [
    'run', '--workspace', workspace, '--dataset-id', datasetId, '--run-id', runId, '--model', model
  ].concat(commonModelArgs(input));
  return startJob('run', args, Object.assign({}, input, { model, datasetId, runId }));
}

function startFactorLab(input = {}) {
  const datasetId = String(input.datasetId || '').trim();
  if (!/^[A-Za-z0-9._-]{3,100}$/.test(datasetId)) throw new Error('请选择有效的数据集。');
  const workspace = ensureWorkspace();
  const runId = 'factor-lab-' + compactUtcTimestamp();
  const args = [
    'factor-lab', '--workspace', workspace, '--dataset-id', datasetId, '--run-id', runId
  ].concat(commonEvaluationArgs(input));
  return startJob('factor-lab', args, Object.assign({}, input, { datasetId, runId }));
}

function startStrategyLab(input = {}) {
  const datasetId = String(input.datasetId || '').trim();
  if (!/^[A-Za-z0-9._-]{3,100}$/.test(datasetId)) throw new Error('请选择有效的数据集。');
  const ruleArgs = strategyLabArgs(input);
  const workspace = ensureWorkspace();
  const runId = 'strategy-lab-' + compactUtcTimestamp();
  const args = [
    'strategy-lab', '--workspace', workspace, '--dataset-id', datasetId, '--run-id', runId
  ].concat(ruleArgs);
  return startJob('strategy-lab', args, Object.assign({}, input, {
    datasetId,
    runId,
    automaticTrading: false
  }));
}

function startSignalScan(input = {}) {
  const readiness = signalScanReadiness();
  if (!readiness.exploratoryAllowed) {
    const error = new Error(readiness.reason);
    error.status = 409;
    throw error;
  }
  const validationMode = String(input.validationMode || readiness.defaultValidationMode);
  if (!['exploratory', 'formal'].includes(validationMode)) {
    const error = new Error('扫描模式只能是 exploratory 或 formal。');
    error.status = 400;
    throw error;
  }
  if (validationMode === 'formal' && !readiness.formalAllowed) {
    const error = new Error('当前数据只具备探索扫描资格，不能标记为正式筛选结果。');
    error.status = 409;
    throw error;
  }
  const runId = 'signal-scan-' + compactUtcTimestamp();
  const maxCandidates = Math.round(numeric(input.maxCandidates, 500, 1, 2000));
  const args = [
    'signal-scan', '--workspace', ensureWorkspace(), '--dataset-id', readiness.datasetId,
    '--run-id', runId, '--validation-mode', validationMode,
    '--max-candidates', String(maxCandidates)
  ].concat(signalScanArgs(input));
  return startJob('signal-scan', args, Object.assign({}, input, {
    datasetId: readiness.datasetId,
    runId,
    validationMode,
    maxCandidates,
    automaticTrading: false,
    dataReadiness: readiness
  }));
}

function startExpertBacktest(input = {}) {
  const datasetId = String(input.datasetId || '').trim();
  if (!/^[A-Za-z0-9._-]{3,100}$/.test(datasetId)) throw new Error('请选择有效的数据集。');
  const channelId = Number(input.channelId);
  const channel = expertChannels.getChannel(channelId);
  const observations = expertChannels.listObservations(channel.id, { limit: 1000 });
  if (!observations.length) throw new Error('该创作者频道还没有可回测的观察记录。');
  const runtime = getRuntimeStatus();
  if (!['configured', 'available'].includes(runtime.status)) {
    const error = new Error(runtime.reason);
    error.status = 409;
    throw error;
  }
  const workspace = ensureWorkspace();
  const manifestPath = path.join(workspace, 'datasets', datasetId, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    const error = new Error('所选数据集不存在，请先完成历史数据同步。');
    error.status = 404;
    throw error;
  }
  verifyManifest(manifestPath, { verifyHashes: false });
  const runId = 'expert-backtest-' + compactUtcTimestamp();
  const signalsPath = path.join(workspace, 'expert-inputs', runId + '.json');
  const temporary = signalsPath + '.tmp-' + process.pid;
  fs.writeFileSync(temporary, JSON.stringify({
    schema: 'webstock.expert-signals.v1',
    channelId: channel.id,
    channelKey: channel.channelKey,
    createdAt: new Date().toISOString(),
    observations
  }, null, 2), 'utf8');
  fs.renameSync(temporary, signalsPath);
  const horizons = Array.isArray(input.horizons) ? input.horizons : [1, 5, 20, 60];
  const args = [
    'expert-backtest', '--workspace', workspace, '--dataset-id', datasetId,
    '--run-id', runId, '--signals-file', signalsPath,
    '--horizons', horizons.join(','), '--cost-bps', String(numeric(input.costBps, 8, 0, 100))
  ];
  return startJob('expert-backtest', args, {
    channelId: channel.id,
    datasetId,
    horizons,
    signalsPath: path.relative(workspace, signalsPath)
  });
}

function researchSuiteSteps(input = {}) {
  const datasetId = String(input.datasetId || '').trim();
  if (!/^[A-Za-z0-9._-]{3,100}$/.test(datasetId)) throw new Error('请选择有效的数据集。');
  const timestamp = String(input.suiteTimestamp || compactUtcTimestamp()).replace(/[^A-Za-z0-9_-]/g, '');
  const workspace = ensureWorkspace();
  const modelArgs = commonModelArgs(input);
  const evaluationArgs = commonEvaluationArgs(input);
  return [
    {
      kind: 'lightgbm',
      label: 'LightGBM 全市场基线',
      args: ['run', '--workspace', workspace, '--dataset-id', datasetId,
        '--run-id', 'qlib-lightgbm-suite-' + timestamp, '--model', 'lightgbm'].concat(modelArgs)
    },
    {
      kind: 'factor-lab',
      label: '因子样本外门禁',
      args: ['factor-lab', '--workspace', workspace, '--dataset-id', datasetId,
        '--run-id', 'factor-lab-suite-' + timestamp].concat(evaluationArgs)
    },
    {
      kind: 'master',
      label: 'MASTER 流动性股票池二筛',
      args: ['run', '--workspace', workspace, '--dataset-id', datasetId,
        '--run-id', 'master-suite-' + timestamp, '--model', 'master'].concat(modelArgs)
    }
  ];
}

function strategyDailySuiteSteps(input = {}) {
  const datasetId = String(input.datasetId || '').trim();
  if (!/^[A-Za-z0-9._-]{3,100}$/.test(datasetId)) throw new Error('请选择有效的数据集。');
  const timestamp = String(input.suiteTimestamp || compactUtcTimestamp()).replace(/[^A-Za-z0-9_-]/g, '');
  const workspace = ensureWorkspace();
  const definitions = [
    { strategyFamily: 'moving-average-crossover', label: '均线交叉' },
    { strategyFamily: 'macd-crossover', label: 'MACD交叉' },
    { strategyFamily: 'rsi-rebound', label: 'RSI超卖反弹' },
    { strategyFamily: 'volume-breakout', label: '放量突破' }
  ];
  return definitions.map(function(definition) {
    const request = Object.assign({}, input, {
      strategyFamily: definition.strategyFamily,
      automaticTrading: false
    });
    const shortName = definition.strategyFamily.replace(/-(crossover|rebound|breakout)$/i, '');
    return {
      kind: 'strategy-lab',
      strategyFamily: definition.strategyFamily,
      label: definition.label,
      args: [
        'strategy-lab', '--workspace', workspace, '--dataset-id', datasetId,
        '--run-id', 'strategy-daily-' + shortName + '-' + timestamp
      ].concat(strategyLabArgs(request))
    };
  });
}

function startResearchSuite(input = {}) {
  const runtime = getRuntimeStatus();
  if (!['configured', 'available'].includes(runtime.status)) {
    const error = new Error(runtime.reason);
    error.status = 409;
    throw error;
  }
  const existing = activeJob();
  if (existing) {
    const error = new Error('已有量化任务正在运行：' + existing.id);
    error.status = 409;
    throw error;
  }
  const datasetId = String(input.datasetId || '').trim();
  const steps = researchSuiteSteps(Object.assign({}, input, {
    datasetId,
    suiteTimestamp: compactUtcTimestamp()
  }));
  const manifestPath = path.join(ensureWorkspace(), 'datasets', datasetId, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    const error = new Error('所选数据集不存在，请先同步全市场数据。');
    error.status = 404;
    throw error;
  }
  verifyManifest(manifestPath, { verifyHashes: false });

  const job = {
    id: newJobId('research-suite'),
    kind: 'research-suite',
    status: 'queued',
    request: Object.assign({}, input, {
      datasetId,
      masterMaxInstruments: Math.round(numeric(
        input.masterMaxInstruments,
        defaultMasterMaxInstruments(),
        50,
        1200
      ))
    }),
    progress: { stage: 'queued', message: '等待启动完整研究流水线。' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    output: null,
    error: ''
  };
  jobs.set(job.id, job);
  persistJob(job);

  (async function executeSuite() {
    const completedSteps = [];
    job.status = 'running';
    job.updatedAt = new Date().toISOString();
    persistJob(job);
    for (let index = 0; index < steps.length; index += 1) {
      if (job.status === 'cancelled') throw new Error('完整研究流水线已停止。');
      const step = steps[index];
      job.progress = {
        stage: 'suite-step',
        current: index + 1,
        total: steps.length,
        message: '正在执行：' + step.label
      };
      job.updatedAt = new Date().toISOString();
      persistJob(job);
      const output = await retryNativeCrash(() => runProtocol(step.args, {
        onChild(child) { children.set(job.id, child); },
        onEvent(event) {
          job.progress = Object.assign({}, event, {
            suiteCurrent: index + 1,
            suiteTotal: steps.length,
            suiteLabel: step.label,
            message: step.label + '：' + (event.message || '运行中')
          });
          job.updatedAt = new Date().toISOString();
          persistJob(job);
        }
      }), {
        onRetry() {
          job.progress = {
            stage: 'native-retry', current: index + 1, total: steps.length,
            message: step.label + '的本地数值进程异常退出，正在自动重试一次。'
          };
          job.updatedAt = new Date().toISOString();
          persistJob(job);
        }
      });
      const verified = step.kind === 'factor-lab'
        ? verifyFactorResult(output)
        : verifyResult(output);
      const result = verified.result;
      completedSteps.push({
        kind: step.kind,
        label: step.label,
        runId: result.runId,
        modelId: result.modelId || 'local-factor-lab-v1',
        validationStatus: result.validationStatus,
        asOf: result.asOf,
        metrics: step.kind === 'factor-lab' ? result.composite.metrics : result.metrics
      });
    }
    job.status = 'completed';
    job.progress = { stage: 'completed', message: '完整研究流水线已完成。' };
    job.output = { suiteId: job.id, datasetId, completedSteps };
    job.updatedAt = new Date().toISOString();
    persistJob(job);
  })().catch(error => {
    if (job.status !== 'cancelled') job.status = 'failed';
    job.error = error.message;
    job.progress = { stage: job.status, message: error.message };
    job.updatedAt = new Date().toISOString();
    persistJob(job);
  }).finally(() => children.delete(job.id));

  return publicJob(job);
}

function startStrategyDailySuite(input = {}) {
  const runtime = getRuntimeStatus();
  if (!['configured', 'available'].includes(runtime.status)) {
    const error = new Error(runtime.reason);
    error.status = 409;
    throw error;
  }
  const existing = activeJob();
  if (existing) {
    const error = new Error('已有量化任务正在运行：' + existing.id);
    error.status = 409;
    throw error;
  }
  const datasetId = String(input.datasetId || '').trim();
  const steps = strategyDailySuiteSteps(Object.assign({}, input, {
    datasetId,
    suiteTimestamp: compactUtcTimestamp()
  }));
  const manifestPath = path.join(ensureWorkspace(), 'datasets', datasetId, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    const error = new Error('所选数据集不存在，请先同步全市场数据。');
    error.status = 404;
    throw error;
  }
  verifyManifest(manifestPath, { verifyHashes: false });

  const job = {
    id: newJobId('strategy-daily'),
    kind: 'strategy-daily',
    status: 'queued',
    request: Object.assign({}, input, { datasetId, automaticTrading: false }),
    progress: { stage: 'queued', message: '等待启动每日四策略研究。' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    output: null,
    error: ''
  };
  jobs.set(job.id, job);
  persistJob(job);

  (async function executeDailySuite() {
    const completedSteps = [];
    const verifiedEntries = [];
    const manifestCache = new Map();
    job.status = 'running';
    job.updatedAt = new Date().toISOString();
    persistJob(job);
    for (let index = 0; index < steps.length; index += 1) {
      if (job.status === 'cancelled') throw new Error('每日四策略研究已停止。');
      const step = steps[index];
      job.progress = {
        stage: 'daily-strategy-step', current: index + 1, total: steps.length,
        message: '正在执行：' + step.label
      };
      job.updatedAt = new Date().toISOString();
      persistJob(job);
      const output = await runProtocol(step.args, {
        onChild(child) { children.set(job.id, child); },
        onEvent(event) {
          job.progress = Object.assign({}, event, {
            suiteCurrent: index + 1,
            suiteTotal: steps.length,
            suiteLabel: step.label,
            message: step.label + '：' + (event.message || '运行中')
          });
          job.updatedAt = new Date().toISOString();
          persistJob(job);
        }
      });
      const verified = verifyStrategyResult(output, { manifestCache });
      const result = verified.result;
      completedSteps.push({
        strategyFamily: step.strategyFamily,
        label: step.label,
        runId: result.runId,
        asOf: result.asOf,
        stableParameterCount: result.stableParameterIds.length,
        candidateCount: result.currentSignals ? result.currentSignals.candidateCount : 0,
        resultPath: verified.resultPath
      });
      verifiedEntries.push({
        valid: true,
        resultPath: verified.resultPath,
        result,
        verification: {
          status: 'hash_verified', scope: 'full', hashesVerified: true,
          checkedAt: new Date().toISOString()
        }
      });
    }
    const report = strategyDaily.buildStrategyDailyReport(verifiedEntries, { datasetId });
    if (report.status !== 'complete') throw new Error('每日研究没有形成完整的四策略同源比较。');
    job.status = 'completed';
    job.progress = { stage: 'completed', message: '每日四策略研究与候选池已完成。' };
    job.output = { suiteId: job.id, datasetId, asOf: report.asOf, completedSteps, report };
    job.updatedAt = new Date().toISOString();
    researchRuns.createRun({
      runType: 'strategy-daily',
      modelId: 'local-strategy-daily-v1',
      status: 'completed',
      title: '每日四策略候选 ' + datasetId,
      result: JSON.stringify(report, null, 2),
      request: { jobId: job.id, datasetId, automaticTrading: false },
      metrics: {
        strategyCount: report.comparisons.length,
        candidateCount: report.candidateCount
      }
    });
    persistJob(job);
  })().catch(error => {
    if (job.status !== 'cancelled') job.status = 'failed';
    job.error = error.message;
    job.progress = { stage: job.status, message: error.message };
    job.updatedAt = new Date().toISOString();
    persistJob(job);
  }).finally(() => children.delete(job.id));

  return publicJob(job);
}

function startWatchlistResearch(input = {}) {
  const runtime = getRuntimeStatus();
  if (!['configured', 'available'].includes(runtime.status)) {
    const error = new Error(runtime.reason);
    error.status = 409;
    throw error;
  }
  const existing = activeJob();
  if (existing) {
    const error = new Error('已有量化任务正在运行：' + existing.id);
    error.status = 409;
    throw error;
  }
  const plan = watchlistResearchPlan(input);
  writeJsonAtomic(plan.inputPath, plan.items);
  const job = {
    id: newJobId('watchlist-research'),
    kind: 'watchlist-research',
    status: 'queued',
    request: plan.request,
    progress: { stage: 'queued', current: 0, total: 6, message: '等待读取自选历史数据。' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    output: null,
    error: ''
  };
  jobs.set(job.id, job);
  persistJob(job);

  (async function executeWatchlistResearch() {
    const completedSteps = [];
    const verifiedEntries = [];
    const manifestCache = new Map();
    job.status = 'running';
    job.progress = { stage: 'collect', current: 1, total: 6, message: '正在获取同花顺分组的前复权历史日线。' };
    job.updatedAt = new Date().toISOString();
    persistJob(job);
    const collected = await runProtocol(plan.collectArgs, {
      onChild(child) { children.set(job.id, child); },
      onEvent(event) {
        job.progress = Object.assign({}, event, {
          suiteCurrent: 1,
          suiteTotal: 6,
          message: '历史数据：' + (event.message || '采集中')
        });
        job.updatedAt = new Date().toISOString();
        persistJob(job);
      }
    });
    const manifestPath = path.resolve(collected.manifestPath || '');
    if (!isInside(ensureWorkspace(), manifestPath)) throw new Error('自选数据集输出超出量化工作区。');
    const manifest = verifyManifest(manifestPath);
    const selection = verifyWatchlistSelection(manifest, plan);
    completedSteps.push({ kind: 'dataset', label: '前复权历史数据', asOf: manifest.asOf });

    const strategySteps = strategyDailySuiteSteps(Object.assign({}, input, {
      datasetId: plan.datasetId,
      suiteTimestamp: compactUtcTimestamp(),
      maxFolds: input.maxFolds == null ? 4 : input.maxFolds,
      validationDays: input.validationDays == null ? 63 : input.validationDays,
      testDays: input.testDays == null ? 63 : input.testDays,
      stepDays: input.stepDays == null ? 63 : input.stepDays,
      maxInstruments: plan.codes.length,
      automaticTrading: false
    }));
    for (let index = 0; index < strategySteps.length; index += 1) {
      if (job.status === 'cancelled') throw new Error('自选量化研究已停止。');
      const step = strategySteps[index];
      job.progress = {
        stage: 'watchlist-strategy', current: index + 2, total: 6,
        message: '正在执行：' + step.label
      };
      job.updatedAt = new Date().toISOString();
      persistJob(job);
      const output = await retryNativeCrash(() => runProtocol(step.args, {
        onChild(child) { children.set(job.id, child); },
        onEvent(event) {
          job.progress = Object.assign({}, event, {
            suiteCurrent: index + 2,
            suiteTotal: 6,
            suiteLabel: step.label,
            message: step.label + '：' + (event.message || '运行中')
          });
          job.updatedAt = new Date().toISOString();
          persistJob(job);
        }
      }), {
        onRetry() {
          job.progress = {
            stage: 'native-retry', current: index + 2, total: 6,
            message: step.label + '的本地数值进程异常退出，正在自动重试一次。'
          };
          job.updatedAt = new Date().toISOString();
          persistJob(job);
        }
      });
      const verified = verifyStrategyResult(output, { manifestCache });
      const result = verified.result;
      completedSteps.push({
        kind: 'strategy-lab', strategyFamily: step.strategyFamily, label: step.label,
        runId: result.runId, asOf: result.asOf,
        stableParameterCount: result.stableParameterIds.length,
        candidateCount: result.currentSignals ? result.currentSignals.candidateCount : 0,
        resultPath: verified.resultPath
      });
      verifiedEntries.push({
        valid: true,
        resultPath: verified.resultPath,
        result,
        verification: {
          status: 'hash_verified', scope: 'full', hashesVerified: true,
          checkedAt: new Date().toISOString()
        }
      });
    }
    job.progress = { stage: 'summarize', current: 6, total: 6, message: '正在合并候选、反证和本地解读。' };
    job.updatedAt = new Date().toISOString();
    persistJob(job);
    const report = strategyDaily.buildStrategyDailyReport(verifiedEntries, { datasetId: plan.datasetId });
    if (report.status !== 'complete') throw new Error('自选研究没有形成完整的四策略同源比较。');
    const localSummary = buildWatchlistResearchSummary(report, manifest, plan.group, selection);
    const recommendationPreview = buildRecommendationPreview(report);
    job.status = 'completed';
    job.progress = { stage: 'completed', current: 6, total: 6, message: '自选量化研究闭环已完成。' };
    job.output = {
      suiteId: job.id,
      datasetId: plan.datasetId,
      asOf: report.asOf,
      group: plan.group,
      manifest: {
        manifestPath,
        manifestSha256: manifest.manifestSha256,
        asOf: manifest.asOf,
        adjustmentMode: manifest.adjustmentMode,
        eligibility: manifest.eligibility,
        source: manifest.source,
        coverage: manifest.coverage,
        quality: manifest.quality,
        failures: selection.failures,
        warnings: manifest.warnings
      },
      completedSteps,
      report,
      localSummary,
      handoffPrompt: buildWatchlistHandoffPrompt(report, manifest, plan.group, localSummary),
      recommendationPreview
    };
    job.updatedAt = new Date().toISOString();
    researchRuns.createRun({
      runType: 'watchlist-quant-research',
      modelId: 'local-watchlist-strategy-suite-v1',
      status: 'completed',
      title: plan.group.name + '量化研究 ' + report.asOf,
      result: JSON.stringify(job.output, null, 2),
      request: plan.request,
      metrics: {
        requestedCount: manifest.coverage.requested,
        succeededCount: manifest.coverage.succeeded,
        strategyCount: report.comparisons.length,
        candidateCount: report.candidateCount
      }
    });
    persistJob(job);
  })().catch(error => {
    if (job.status !== 'cancelled') job.status = 'failed';
    job.error = error.message;
    job.progress = { stage: job.status, message: error.message };
    job.updatedAt = new Date().toISOString();
    persistJob(job);
  }).finally(() => children.delete(job.id));

  return publicJob(job);
}

function getStrategyDailyReport(options = {}) {
  const verification = options.verification === 'full' ? 'full' : undefined;
  return strategyDaily.buildStrategyDailyReport(
    listStrategyResults(100, { verification }),
    { datasetId: options.datasetId, asOf: options.asOf, maxCandidates: options.maxCandidates }
  );
}

function latestCompletedStrategyDailyDate(datasets) {
  return strategyDaily.latestEligibleDailyCompletionDate(Array.from(jobs.values()), datasets, 1000, 7);
}

function getStrategyDailyScheduleStatus(options = {}) {
  const runtime = getRuntimeStatus();
  const datasets = listDatasets(200);
  return strategyDaily.strategyDailyScheduleDecision({
    now: options.now || new Date(),
    runtimeAvailable: ['configured', 'available'].includes(runtime.status),
    datasets,
    lastCompletedDate: latestCompletedStrategyDailyDate(datasets),
    hasActiveJob: !!activeJob(),
    minimumRequested: 1000,
    maxAgeDays: 7
  });
}

function runScheduledStrategyDaily(options = {}) {
  const decision = getStrategyDailyScheduleStatus(options);
  if (decision.action !== 'run') return decision;
  const job = startStrategyDailySuite({
    datasetId: decision.datasetId,
    trigger: 'scheduled',
    automaticTrading: false
  });
  return Object.assign({}, decision, { action: 'started', job });
}

function loadPersistedJobs() {
  const dir = path.join(ensureWorkspace(), 'jobs');
  fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.endsWith('.json')).forEach(entry => {
    try {
      const job = readJson(path.join(dir, entry.name));
      if (['queued', 'running'].includes(job.status)) {
        job.status = 'interrupted';
        job.progress = { stage: 'interrupted', message: '上次桌面程序退出时任务尚未完成。' };
        job.updatedAt = new Date().toISOString();
        persistJob(job);
      }
      jobs.set(job.id, job);
    } catch (error) {}
  });
}

function listJobs(limit = 30) {
  return Array.from(jobs.values()).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, Math.min(Math.max(Number(limit) || 30, 1), 200)).map(publicJob);
}

function getJob(id) {
  const job = jobs.get(String(id || ''));
  if (!job) {
    const error = new Error('未找到量化任务。');
    error.status = 404;
    throw error;
  }
  return publicJob(job);
}

function cancelJob(id) {
  const job = jobs.get(String(id || ''));
  if (!job) return false;
  const child = children.get(job.id);
  if (!child || !['queued', 'running'].includes(job.status)) return false;
  job.status = 'cancelled';
  job.progress = { stage: 'cancelled', message: '已由用户停止。' };
  job.updatedAt = new Date().toISOString();
  child.kill();
  persistJob(job);
  return true;
}

function listDatasets(limit = 50) {
  const dir = path.join(ensureWorkspace(), 'datasets');
  return fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => {
    const manifestPath = path.join(dir, entry.name, 'manifest.json');
    try {
      const manifest = validateDatasetManifest(readJson(manifestPath));
      const summary = {
        schema: manifest.schema,
        datasetId: manifest.datasetId,
        createdAt: manifest.createdAt,
        asOf: manifest.asOf,
        source: manifest.source,
        universe: manifest.universe,
        requestedDateRange: manifest.requestedDateRange,
        dateRange: manifest.dateRange,
        adjustmentMode: manifest.adjustmentMode,
        coverage: manifest.coverage,
        eligibility: manifest.eligibility,
        warnings: manifest.warnings,
        fileCount: manifest.files.length,
        manifestSha256: manifest.manifestSha256
      };
      return { manifestPath, manifest: summary, valid: manifestSha256(manifest) === manifest.manifestSha256.toLowerCase(), error: '' };
    } catch (error) {
      return { manifestPath, manifest: null, valid: false, error: error.message };
    }
  }).sort((a, b) => String(b.manifest && b.manifest.createdAt || '').localeCompare(String(a.manifest && a.manifest.createdAt || ''))).slice(0, Math.min(Math.max(Number(limit) || 50, 1), 200));
}

function listStoredResults(kind, limit, options = {}) {
  const dir = path.join(ensureWorkspace(), kind);
  const maxItems = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const fullVerification = options.verification === 'full';
  const manifestCache = fullVerification ? new Map() : null;
  const candidates = fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const resultPath = path.join(dir, entry.name, 'result.json');
      const resultIdentity = fileIdentity(resultPath);
      const identity = resultIdentity.exists ? resultIdentity : fileIdentity(path.dirname(resultPath));
      return { resultPath, identity };
    })
    .sort((a, b) => b.identity.mtimeMs - a.identity.mtimeMs)
    .slice(0, maxItems);

  return candidates.map(candidate => {
    const checkedAt = new Date().toISOString();
    const scope = fullVerification ? 'full' : 'metadata';
    try {
      const verified = fullVerification
        ? (kind === 'factor-runs'
          ? verifyStoredFactorResult(candidate.resultPath, { manifestCache })
          : (kind === 'strategy-runs'
            ? verifyStoredStrategyResult(candidate.resultPath, { manifestCache })
            : (kind === 'signal-scans'
              ? verifyStoredSignalScanResult(candidate.resultPath, { manifestCache })
              : verifyStoredResult(candidate.resultPath, { manifestCache }))))
        : verifyStoredResultSummary(candidate.resultPath, kind);
      return {
        resultPath: candidate.resultPath,
        result: verified.result,
        createdAt: verified.result.createdAt || new Date(candidate.identity.mtimeMs).toISOString(),
        valid: true,
        error: '',
        verification: {
          status: fullVerification ? 'hash_verified' : 'metadata_valid',
          scope,
          hashesVerified: fullVerification,
          checkedAt
        }
      };
    } catch (error) {
      return {
        resultPath: candidate.resultPath,
        result: null,
        createdAt: new Date(candidate.identity.mtimeMs).toISOString(),
        valid: false,
        error: error.message,
        verification: {
          status: fullVerification ? 'hash_failed' : 'metadata_invalid',
          scope,
          hashesVerified: false,
          checkedAt
        }
      };
    }
  });
}

function listResults(limit = 30, options = {}) {
  return listStoredResults('runs', limit, options);
}

function listFactorResults(limit = 30, options = {}) {
  return listStoredResults('factor-runs', limit, options);
}

function listStrategyResults(limit = 30, options = {}) {
  return listStoredResults('strategy-runs', limit, options);
}

function listSignalScanResults(limit = 30, options = {}) {
  return listStoredResults('signal-scans', limit, options);
}

loadPersistedJobs();

module.exports = {
  getRuntimeStatus,
  verifyRuntime,
  linkExistingRuntime,
  startRuntimeInstall,
  startPilot,
  startCollection,
  startFullMarketSync,
  startRun,
  startFactorLab,
  startStrategyLab,
  startSignalScan,
  startStrategyDailySuite,
  startWatchlistResearch,
  startExpertBacktest,
  startResearchSuite,
  collectionDatasetId,
  fullMarketDatasetId,
  fullMarketSyncPlan,
  getFullMarketSyncStatus,
  signalScanReadiness,
  fullMarketAutoSyncDecision,
  runScheduledFullMarketSync,
  defaultMasterMaxInstruments,
  researchSuiteSteps,
  strategyDailySuiteSteps,
  watchlistResearchPlan,
  listWatchlistResearchGroups,
  buildRecommendationPreview,
  buildWatchlistResearchSummary,
  getStrategyDailyReport,
  getStrategyDailyScheduleStatus,
  runScheduledStrategyDaily,
  listJobs,
  getJob,
  cancelJob,
  listDatasets,
  listResults,
  listFactorResults,
  listStrategyResults,
  listSignalScanResults,
  commonEvaluationArgs,
  strategyLabArgs,
  signalScanArgs,
  quantProcessEnvironment,
  retryNativeCrash,
  workspacePath
};
