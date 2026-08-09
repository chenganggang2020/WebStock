const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const researchRuns = require('./researchRunService');
const {
  createRuntimeInstaller,
  loadRuntimeManifest,
  runtimePythonPath
} = require('./quantRuntimeInstaller');
const {
  validateDatasetManifest,
  validateQuantResult,
  validateFactorLabResult,
  sha256File,
  manifestSha256
} = require('./quantContractService');

const jobs = new Map();
const children = new Map();
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

function pythonPath() {
  if (process.env.WEBSTOCK_QUANT_PYTHON) return path.resolve(process.env.WEBSTOCK_QUANT_PYTHON);
  const local = path.join(quantRoot(), '.venv', 'Scripts', 'python.exe');
  if (fs.existsSync(local)) return local;
  const managed = runtimePythonPath(workspacePath());
  return fs.existsSync(managed) ? managed : null;
}

function ensureWorkspace() {
  const workspace = workspacePath();
  fs.mkdirSync(path.join(workspace, 'jobs'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'datasets'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'runs'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'factor-runs'), { recursive: true });
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
  const python = pythonPath();
  const runner = runnerPath();
  const installer = getRuntimeInstallInfo();
  if (!python || !fs.existsSync(python)) {
    return {
      status: 'not_configured',
      verified: false,
      reason: '尚未安装独立的 Python 3.12 量化运行环境。',
      python: python || '',
      runner,
      installer
    };
  }
  if (!fs.existsSync(runner)) {
    return { status: 'unavailable', verified: false, reason: '量化运行脚本缺失。', python, runner, installer };
  }
  if (runtimeCache) return Object.assign({ python, runner, installer }, runtimeCache);
  return {
    status: 'configured',
    verified: false,
    reason: '已找到独立运行环境，请执行环境检测后再开始训练。',
    python,
    runner,
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

function runProtocol(args, options = {}) {
  const runtime = getRuntimeStatus();
  if (!['configured', 'available'].includes(runtime.status)) {
    const error = new Error(runtime.reason);
    error.status = 409;
    return Promise.reject(error);
  }
  const workspace = ensureWorkspace();
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(runtime.python, [runtime.runner].concat(args), {
      cwd: workspace,
      windowsHide: true,
      env: Object.assign({}, process.env, {
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
      reject(error);
    });
  });
}

async function verifyRuntime() {
  try {
    const result = await runProtocol(['health', '--verify']);
    runtimeCache = {
      status: result.status === 'available' ? 'available' : 'configured',
      verified: !!result.verified,
      reason: result.verified ? 'Qlib、LightGBM 与 PyTorch 导入检测通过。' : '已读取运行环境信息。',
      versions: Object.assign({ python: result.python }, result.packages || {}),
      checkedAt: result.checkedAt
    };
  } catch (error) {
    runtimeCache = { status: 'unavailable', verified: false, reason: error.message, checkedAt: new Date().toISOString() };
  }
  return getRuntimeStatus();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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
  const manifest = verifyManifest(manifestPath, { verifyHashes });
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
  const manifest = verifyManifest(manifestPath, { verifyHashes });
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
  if (copy.output) {
    const factorCount = copy.output.factorCount;
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
    '--sleep-ms', String(Math.round(numeric(input.sleepMs, 160, 50, 2000))),
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

function listResults(limit = 30) {
  const dir = path.join(ensureWorkspace(), 'runs');
  return fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => {
    const resultPath = path.join(dir, entry.name, 'result.json');
    try {
      const verified = verifyStoredResult(resultPath, { verifyHashes: false });
      const createdAt = verified.result.createdAt || fs.statSync(resultPath).mtime.toISOString();
      return { resultPath, result: verified.result, createdAt, valid: true, error: '' };
    } catch (error) {
      const timestampTarget = fs.existsSync(resultPath) ? resultPath : path.dirname(resultPath);
      return { resultPath, result: null, createdAt: fs.statSync(timestampTarget).mtime.toISOString(), valid: false, error: error.message };
    }
  }).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).slice(0, Math.min(Math.max(Number(limit) || 30, 1), 100));
}

function listFactorResults(limit = 30) {
  const dir = path.join(ensureWorkspace(), 'factor-runs');
  return fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => {
    const resultPath = path.join(dir, entry.name, 'result.json');
    try {
      const verified = verifyStoredFactorResult(resultPath, { verifyHashes: false });
      const createdAt = verified.result.createdAt || fs.statSync(resultPath).mtime.toISOString();
      return { resultPath, result: verified.result, createdAt, valid: true, error: '' };
    } catch (error) {
      const timestampTarget = fs.existsSync(resultPath) ? resultPath : path.dirname(resultPath);
      return { resultPath, result: null, createdAt: fs.statSync(timestampTarget).mtime.toISOString(), valid: false, error: error.message };
    }
  }).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, Math.min(Math.max(Number(limit) || 30, 1), 100));
}

loadPersistedJobs();

module.exports = {
  getRuntimeStatus,
  verifyRuntime,
  startRuntimeInstall,
  startPilot,
  startCollection,
  startRun,
  startFactorLab,
  startResearchSuite,
  collectionDatasetId,
  defaultMasterMaxInstruments,
  researchSuiteSteps,
  listJobs,
  getJob,
  cancelJob,
  listDatasets,
  listResults,
  listFactorResults,
  commonEvaluationArgs,
  workspacePath
};
