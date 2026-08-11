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

function runPythonTranscription(input, options = {}) {
  const timeoutMs = Math.max(Number(options.timeoutMs) || 15 * 60 * 1000, 1000);
  return new Promise(function(resolve, reject) {
    const args = [
      path.join(quantRoot(), 'douyin_transcribe.py'),
      '--media', input.mediaPath,
      '--model-root', input.modelRoot,
      '--model', input.model || 'small'
    ];
    if (input.prompt) args.push('--prompt', String(input.prompt).slice(0, 1000));
    const child = childProcess.spawn(input.pythonPath, args, {
      windowsHide: true,
      env: Object.assign({}, process.env, { PYTHONUTF8: '1' })
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
  if (!transcript) throw new Error('本地语音识别没有提取到可用文字。');
  return {
    status: 'complete',
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
    mediaSha256: String(download.sha256 || '').toLowerCase(),
    mediaBytes: Math.max(Number(download.bytes) || 0, 0),
    mediaContentType: String(download.contentType || '').slice(0, 120),
    transcribedAt: new Date().toISOString()
  };
}

function createDouyinTranscriptService(options = {}) {
  const tempRoot = path.resolve(options.tempRoot || path.join(path.dirname(workspacePath()), 'asr-temp'));
  const modelRoot = path.resolve(options.modelRoot || path.join(path.dirname(workspacePath()), 'asr-models'));
  const downloadMedia = options.downloadMedia || downloadMediaFile;
  const runPython = options.runPython || runPythonTranscription;

  async function transcribe(input = {}) {
    const mediaUrl = String(input.mediaUrl || '');
    if (!isAllowedDouyinMediaUrl(mediaUrl)) throw new Error('视频媒体地址不属于允许的抖音 CDN。');
    fs.mkdirSync(tempRoot, { recursive: true });
    fs.mkdirSync(modelRoot, { recursive: true });
    const contentId = String(input.contentId || '').replace(/[^0-9A-Za-z_-]/g, '').slice(0, 80) || 'media';
    const mediaPath = path.join(tempRoot, contentId + '-' + crypto.randomBytes(6).toString('hex') + '.mp4');
    try {
      const download = await downloadMedia(mediaUrl, mediaPath, options);
      const raw = await runPython({
        pythonPath: resolvePython(options.pythonPath),
        mediaPath,
        modelRoot,
        model: options.model || 'small',
        prompt: String(input.prompt || '').slice(0, 1000)
      }, options);
      return normalizeResult(raw, download);
    } finally {
      try { fs.rmSync(mediaPath, { force: true }); } catch (_) {}
    }
  }

  return { transcribe };
}

module.exports = {
  createDouyinTranscriptService,
  isAllowedDouyinMediaUrl,
  downloadMediaFile,
  runPythonTranscription,
  normalizeResult
};
