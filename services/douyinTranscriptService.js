const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const { readRuntimeLink } = require('./quantRuntimeLink');
const { runtimePythonPath } = require('./quantRuntimeInstaller');

const MEDIA_HOST_SUFFIXES = [
  'douyinvod.com',
  'zjcdn.com',
  'bytecdn.cn',
  'douyin.com',
  'amemv.com',
  'snssdk.com'
];

function isAllowedDouyinMediaUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === 'https:' && MEDIA_HOST_SUFFIXES.some(function(suffix) {
      return host === suffix || host.endsWith('.' + suffix);
    });
  } catch (error) {
    return false;
  }
}

function asUnpacked(filePath) {
  return filePath.includes('app.asar') ? filePath.replace('app.asar', 'app.asar.unpacked') : filePath;
}

function quantRoot() {
  return asUnpacked(path.join(__dirname, '..', 'quant'));
}

function workspacePath() {
  return path.resolve(process.env.WEBSTOCK_QUANT_WORKSPACE || path.join(quantRoot(), 'workspace'));
}

function prepareTranscriptionScript(options = {}) {
  const source = path.resolve(options.source || path.join(quantRoot(), 'douyin_transcribe.py'));
  const packaged = source.includes('app.asar.unpacked');
  if (!packaged && !options.durable) {
    if (!fs.existsSync(source)) throw new Error('本地语音识别脚本缺失：' + source);
    return source;
  }
  const durable = path.resolve(options.durable ||
    path.join(path.dirname(workspacePath()), 'asr-runtime', 'douyin_transcribe.py'));
  if (fs.existsSync(source)) {
    fs.mkdirSync(path.dirname(durable), { recursive: true });
    const changed = !fs.existsSync(durable) || !fs.readFileSync(source).equals(fs.readFileSync(durable));
    if (changed) fs.copyFileSync(source, durable);
  }
  if (!fs.existsSync(durable)) throw new Error('本地语音识别脚本缺失：' + source);
  return durable;
}

function resolveLocalModelSource(modelRoot, model = 'small') {
  const modelName = String(model || '').trim();
  if (!/^[0-9A-Za-z._-]+$/.test(modelName)) return '';
  const repository = path.join(path.resolve(modelRoot), 'models--Systran--faster-whisper-' + modelName);
  try {
    const revision = fs.readFileSync(path.join(repository, 'refs', 'main'), 'utf8').trim();
    if (!/^[0-9A-Za-z._-]+$/.test(revision)) return '';
    const snapshot = path.join(repository, 'snapshots', revision);
    const requiredFiles = ['config.json', 'model.bin', 'tokenizer.json', 'vocabulary.txt'];
    if (!requiredFiles.every(function(name) {
      const stat = fs.statSync(path.join(snapshot, name));
      return stat.isFile() && stat.size > 0;
    })) return '';
    return snapshot;
  } catch (error) {
    return '';
  }
}

function resolvePython(explicitPath) {
  const candidates = [];
  if (explicitPath) candidates.push(path.resolve(explicitPath));
  if (process.env.WEBSTOCK_QUANT_PYTHON) candidates.push(path.resolve(process.env.WEBSTOCK_QUANT_PYTHON));
  try {
    const link = readRuntimeLink(workspacePath());
    if (link) candidates.push(link.pythonPath);
  } catch (error) {}
  candidates.push(path.join(quantRoot(), '.venv', 'Scripts', 'python.exe'));
  candidates.push(runtimePythonPath(workspacePath()));
  const python = candidates.find(function(candidate) { return candidate && fs.existsSync(candidate); });
  if (!python) throw new Error('未找到可复用的 WebStock Python 3.12 环境，无法执行本地语音识别。');
  return python;
}

function downloadMediaFile(mediaUrl, target, options = {}) {
  const maxBytes = Math.max(Number(options.maxBytes) || 250 * 1024 * 1024, 1024);
  const timeoutMs = Math.max(Number(options.timeoutMs) || 120000, 1000);

  function request(currentUrl, redirectCount) {
    if (!isAllowedDouyinMediaUrl(currentUrl)) return Promise.reject(new Error('视频媒体地址不属于允许的抖音 CDN。'));
    if (redirectCount > 5) return Promise.reject(new Error('视频媒体地址重定向次数过多。'));
    return new Promise(function(resolve, reject) {
      let output = null;
      let settled = false;
      function fail(error) {
        if (settled) return;
        settled = true;
        if (output) output.destroy();
        try { fs.rmSync(target, { force: true }); } catch (_) {}
        reject(error);
      }
      const req = https.get(currentUrl, { timeout: timeoutMs, headers: { 'User-Agent': 'Mozilla/5.0 WebStock/1.0' } }, function(response) {
        const status = Number(response.statusCode || 0);
        if (status >= 300 && status < 400 && response.headers.location) {
          settled = true;
          const redirected = new URL(response.headers.location, currentUrl).href;
          response.resume();
          request(redirected, redirectCount + 1).then(resolve, reject);
          return;
        }
        if (status !== 200) {
          response.resume();
          fail(new Error('视频媒体下载失败，HTTP ' + status + '。'));
          return;
        }
        const contentType = String(response.headers['content-type'] || '').toLowerCase();
        if (contentType && !/^(video|audio)\//.test(contentType) && !contentType.startsWith('application/octet-stream')) {
          response.resume();
          fail(new Error('视频媒体响应类型无效：' + contentType));
          return;
        }
        const announced = Number(response.headers['content-length'] || 0);
        if (announced > maxBytes) {
          response.resume();
          fail(new Error('视频媒体超过允许的大小上限。'));
          return;
        }
        output = fs.createWriteStream(target, { flags: 'wx' });
        const hash = crypto.createHash('sha256');
        let bytes = 0;
        response.on('data', function(chunk) {
          bytes += chunk.length;
          if (bytes > maxBytes) {
            response.destroy(new Error('视频媒体超过允许的大小上限。'));
            return;
          }
          hash.update(chunk);
        });
        response.on('error', fail);
        output.on('error', fail);
        output.on('finish', function() {
          if (settled) return;
          settled = true;
          output.close(function() {
            resolve({ sha256: hash.digest('hex'), bytes, contentType });
          });
        });
        response.pipe(output);
      });
      req.on('timeout', function() { req.destroy(new Error('视频媒体下载超时。')); });
      req.on('error', fail);
    });
  }

  return request(mediaUrl, 0);
}

function cleanupStaleTempFiles(tempRoot, options = {}) {
  const maxAgeMs = Math.max(Number(options.maxAgeMs) || 6 * 60 * 60 * 1000, 60 * 1000);
  const nowMs = Number(options.nowMs) || Date.now();
  let scannedCount = 0;
  let removedCount = 0;
  let entries = [];
  try { entries = fs.readdirSync(tempRoot, { withFileTypes: true }); } catch (error) { return { scannedCount, removedCount }; }
  entries.forEach(function(entry) {
    if (!entry.isFile() || !/^[0-9A-Za-z_-]+-[a-f0-9]{12}\.mp4\.part$/i.test(entry.name)) return;
    scannedCount += 1;
    const filePath = path.join(tempRoot, entry.name);
    try {
      const stat = fs.statSync(filePath);
      if (nowMs - stat.mtimeMs < maxAgeMs) return;
      fs.rmSync(filePath, { force: true });
      removedCount += 1;
    } catch (error) {}
  });
  return { scannedCount, removedCount };
}

function inspectArchivedMedia(mediaPath, contentType) {
  const stat = fs.statSync(mediaPath);
  if (!stat.isFile() || stat.size <= 0) throw new Error('本地媒体归档无效，请人工检查：' + mediaPath);
  return new Promise(function(resolve, reject) {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(mediaPath);
    input.on('data', function(chunk) { hash.update(chunk); });
    input.on('error', reject);
    input.on('end', function() {
      resolve({
        sha256: hash.digest('hex'),
        bytes: stat.size,
        contentType: String(contentType || 'video/mp4'),
        localAssetPath: mediaPath
      });
    });
  });
}

function buildTranscriptionEnvironment(baseEnvironment = process.env) {
  return Object.assign({}, baseEnvironment, {
    PYTHONUTF8: '1',
    OMP_NUM_THREADS: '2',
    MKL_NUM_THREADS: '1',
    OPENBLAS_NUM_THREADS: '1',
    NUMEXPR_NUM_THREADS: '1'
  });
}

function resolveTranscriptionTimeout(options = {}) {
  return Math.max(Number(options.timeoutMs) || 30 * 60 * 1000, 1000);
}

function runPythonTranscription(input, options = {}) {
  const timeoutMs = resolveTranscriptionTimeout(options);
  return new Promise(function(resolve, reject) {
    const args = [
      input.scriptPath || path.join(quantRoot(), 'douyin_transcribe.py'),
      '--media', input.mediaPath,
      '--model-root', input.modelRoot,
      '--model', input.model || 'small'
    ];
    if (input.modelSource) args.push('--model-source', input.modelSource);
    if (input.prompt) args.push('--prompt', String(input.prompt).slice(0, 1000));
    const child = childProcess.spawn(input.pythonPath, args, {
      windowsHide: true,
      env: buildTranscriptionEnvironment()
    });
    let stdout = '';
    let stderr = '';
    let timer = setTimeout(function() { child.kill(); }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', function(chunk) { stdout = (stdout + chunk).slice(-8 * 1024 * 1024); });
    child.stderr.on('data', function(chunk) { stderr = (stderr + chunk).slice(-12000); });
    child.on('error', function(error) { clearTimeout(timer); timer = null; reject(error); });
    child.on('close', function(code) {
      if (timer) clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || '本地语音识别进程异常退出，代码：' + code));
        return;
      }
      try { resolve(JSON.parse(stdout.trim())); } catch (error) {
        reject(new Error('本地语音识别没有返回有效 JSON。'));
      }
    });
  });
}

function normalizeResult(raw, download) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const segments = (Array.isArray(source.segments) ? source.segments : []).map(function(segment) {
    return {
      start: Math.max(Number(segment.start) || 0, 0),
      end: Math.max(Number(segment.end) || 0, 0),
      text: String(segment.text || '').trim().slice(0, 4000)
    };
  }).filter(function(segment) { return segment.text && segment.end >= segment.start; }).slice(0, 10000);
  const transcript = String(source.transcript || segments.map(function(item) { return item.text; }).join('')).trim().slice(0, 800000);
  const mediaEvidence = {
    localAssetPath: String(download.localAssetPath || ''),
    sha256: String(download.sha256 || '').toLowerCase(),
    bytes: Math.max(Number(download.bytes) || 0, 0),
    mimeType: String(download.contentType || '').slice(0, 120)
  };
  return {
    status: transcript ? 'complete' : 'no_speech',
    engine: String(source.engine || 'faster-whisper').slice(0, 80),
    engineVersion: String(source.engineVersion || '').slice(0, 80),
    model: String(source.model || 'small').slice(0, 80),
    device: String(source.device || 'cpu').slice(0, 40),
    computeType: String(source.computeType || 'int8').slice(0, 40),
    language: String(source.language || '').slice(0, 20),
    languageProbability: Math.min(Math.max(Number(source.languageProbability) || 0, 0), 1),
    durationSeconds: Math.max(Number(source.durationSeconds) || 0, 0),
    elapsedSeconds: Math.max(Number(source.elapsedSeconds) || 0, 0),
    transcript,
    segments,
    localAssetPath: mediaEvidence.localAssetPath,
    sha256: mediaEvidence.sha256,
    bytes: mediaEvidence.bytes,
    mimeType: mediaEvidence.mimeType,
    mediaMetadata: mediaEvidence,
    mediaSha256: mediaEvidence.sha256,
    mediaBytes: mediaEvidence.bytes,
    mediaContentType: mediaEvidence.mimeType,
    transcribedAt: new Date().toISOString()
  };
}

function createDouyinTranscriptService(options = {}) {
  const archiveRoot = path.resolve(options.archiveRoot || options.tempRoot || path.join(path.dirname(workspacePath()), 'media-library', 'douyin'));
  const modelRoot = path.resolve(options.modelRoot || path.join(path.dirname(workspacePath()), 'asr-models'));
  const scriptPath = prepareTranscriptionScript({
    source: options.scriptPath,
    durable: options.durableScriptPath
  });
  const downloadMedia = options.downloadMedia || downloadMediaFile;
  const runPython = options.runPython || runPythonTranscription;
  const cleanup = cleanupStaleTempFiles(archiveRoot, { maxAgeMs: options.staleTempMaxAgeMs });

  function report(input, progress) {
    if (typeof input.onProgress !== 'function') return;
    try { input.onProgress(progress); } catch (error) {}
  }

  async function archive(input = {}) {
    const mediaUrl = String(input.mediaUrl || '');
    const mediaUrls = [mediaUrl].concat(Array.isArray(input.mediaUrls) ? input.mediaUrls : [])
      .map(function(value) { return String(value || ''); })
      .filter(function(value, index, values) { return value && values.indexOf(value) === index; });
    fs.mkdirSync(archiveRoot, { recursive: true });
    const contentId = String(input.contentId || '').replace(/[^0-9A-Za-z_-]/g, '').slice(0, 80);
    if (!contentId) throw new Error('永久媒体归档缺少作品 ID。');
    const rawExpectedSha256 = String(input.expectedSha256 || '').trim().toLowerCase();
    if (rawExpectedSha256 && !/^[a-f0-9]{64}$/.test(rawExpectedSha256)) {
      throw new Error('历史媒体 SHA-256 格式无效，不能执行可核验回填。');
    }
    const mediaPath = path.join(archiveRoot, contentId + '.mp4');
    const partPath = path.join(archiveRoot, contentId + '-' + crypto.randomBytes(6).toString('hex') + '.mp4.part');
    try {
      let download;
      let reusedArchive = false;
      if (fs.existsSync(mediaPath)) {
        reusedArchive = true;
        download = await inspectArchivedMedia(mediaPath, 'video/mp4');
      } else {
        const allowedMediaUrls = mediaUrls.filter(isAllowedDouyinMediaUrl);
        if (!allowedMediaUrls.length) throw new Error('视频媒体地址不属于允许的抖音 CDN。');
        let lastDownloadError = null;
        for (let index = 0; index < allowedMediaUrls.length && !download; index += 1) {
          try {
            report(input, {
              stage: 'downloading',
              message: allowedMediaUrls.length > 1
                ? '正在下载视频媒体（候选 ' + (index + 1) + ' / ' + allowedMediaUrls.length + '）'
                : '正在下载视频媒体'
            });
            const downloaded = await downloadMedia(allowedMediaUrls[index], partPath, options);
            const inspectedPart = await inspectArchivedMedia(partPath, downloaded.contentType);
            if (rawExpectedSha256 && inspectedPart.sha256 !== rawExpectedSha256) {
              throw new Error('重新下载的视频与历史 SHA-256 不一致，未写入永久归档。');
            }
            if (fs.existsSync(mediaPath)) {
              fs.rmSync(partPath, { force: true });
              download = await inspectArchivedMedia(mediaPath, downloaded.contentType);
            } else {
              fs.renameSync(partPath, mediaPath);
              download = Object.assign({}, inspectedPart, { localAssetPath: mediaPath });
            }
          } catch (error) {
            lastDownloadError = error;
            try { fs.rmSync(partPath, { force: true }); } catch (_) {}
          }
        }
        if (!download) throw lastDownloadError || new Error('视频媒体下载失败。');
      }
      if (rawExpectedSha256 && download.sha256 !== rawExpectedSha256) {
        throw new Error('本地归档与历史 SHA-256 不一致，请人工检查现有文件。');
      }
      const archiveEvidence = {
        localAssetPath: download.localAssetPath,
        mediaSha256: download.sha256,
        mediaBytes: download.bytes,
        mediaContentType: download.contentType,
        archivedAt: new Date().toISOString()
      };
      if (typeof input.onArchived === 'function') await input.onArchived(archiveEvidence);
      report(input, {
        stage: 'archived', message: reusedArchive ? '已复用永久本地媒体归档' : '媒体已永久归档',
        mediaBytes: download.bytes
      });
      return archiveEvidence;
    } finally {
      try { fs.rmSync(partPath, { force: true }); } catch (_) {}
    }
  }

  async function transcribe(input = {}) {
    const archiveEvidence = await archive(input);
    fs.mkdirSync(modelRoot, { recursive: true });
    report(input, { stage: 'transcribing', message: '媒体归档完成，正在本地识别', mediaBytes: archiveEvidence.mediaBytes });
    const download = {
      localAssetPath: archiveEvidence.localAssetPath,
      sha256: archiveEvidence.mediaSha256,
      bytes: archiveEvidence.mediaBytes,
      contentType: archiveEvidence.mediaContentType
    };
    const model = options.model || 'small';
    const raw = await runPython({
      pythonPath: resolvePython(options.pythonPath),
      scriptPath,
      mediaPath: archiveEvidence.localAssetPath,
      modelRoot,
      model,
      modelSource: resolveLocalModelSource(modelRoot, model),
      prompt: String(input.prompt || '').slice(0, 1000)
    }, options);
    const result = normalizeResult(raw, download);
    report(input, {
      stage: 'complete', message: '本地语音识别完成', mediaBytes: result.mediaBytes,
      elapsedSeconds: result.elapsedSeconds
    });
    return result;
  }

  return { archive, transcribe, cleanup };
}

module.exports = {
  createDouyinTranscriptService,
  isAllowedDouyinMediaUrl,
  cleanupStaleTempFiles,
  downloadMediaFile,
  buildTranscriptionEnvironment,
  resolveTranscriptionTimeout,
  prepareTranscriptionScript,
  resolveLocalModelSource,
  runPythonTranscription,
  normalizeResult
};
