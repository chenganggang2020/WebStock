const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const axios = require('axios');
const OpenCC = require('opencc-js');
const { readRuntimeLink } = require('./quantRuntimeLink');
const { runtimePythonPath } = require('./quantRuntimeInstaller');

const toSimplifiedChinese = OpenCC.Converter({ from: 'tw', to: 'cn' });
const DEFAULT_FINANCE_HOTWORDS = [
  'A股', '科创板', '创业板', '净利润', '中报', '招股书', '估值', '科技股',
  '人形机器人', '宇树科技', '股价腰斩', '炒概念'
];

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
  const canonicalModelName = modelName === 'turbo' ? 'large-v3-turbo' : modelName;
  function isCompleteModelDirectory(candidate) {
    try {
      const requiredFiles = ['config.json', 'model.bin', 'tokenizer.json'];
      const hasVocabulary = ['vocabulary.txt', 'vocabulary.json'].some(function(name) {
        try {
          const stat = fs.statSync(path.join(candidate, name));
          return stat.isFile() && stat.size > 0;
        } catch (error) {
          return false;
        }
      });
      return hasVocabulary && requiredFiles.every(function(name) {
        const stat = fs.statSync(path.join(candidate, name));
        return stat.isFile() && stat.size > 0;
      });
    } catch (error) {
      return false;
    }
  }
  const flatModel = path.join(path.resolve(modelRoot), 'faster-whisper-' + canonicalModelName);
  if (isCompleteModelDirectory(flatModel)) return flatModel;
  const repositoryName = canonicalModelName === 'large-v3-turbo'
    ? 'models--mobiuslabsgmbh--faster-whisper-large-v3-turbo'
    : 'models--Systran--faster-whisper-' + canonicalModelName;
  const repository = path.join(path.resolve(modelRoot), repositoryName);
  try {
    const revision = fs.readFileSync(path.join(repository, 'refs', 'main'), 'utf8').trim();
    if (!/^[0-9A-Za-z._-]+$/.test(revision)) return '';
    const snapshot = path.join(repository, 'snapshots', revision);
    if (!isCompleteModelDirectory(snapshot)) return '';
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
  const maxBytes = Math.max(Number(options.maxBytes) || 1024 * 1024 * 1024, 1024);
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
  const durationMs = Math.max(Number(options.durationSeconds) || 0, 0) * 1000;
  const adaptive = Math.min(6 * 60 * 60 * 1000, Math.max(30 * 60 * 1000, durationMs * 4 + 10 * 60 * 1000));
  return Math.max(Number(options.timeoutMs) || adaptive, 1000);
}

function buildRecognitionPrompt(prompt, hotwords = []) {
  const context = String(prompt || '').replace(/\s+/g, ' ').trim();
  const instruction = '请使用中国大陆简体中文逐字转写视频中的普通话语音，不要改写、总结或补充原文。';
  const initialPrompt = (instruction + (context ? ' 上下文：' + context : '')).slice(0, 1000);
  const uniqueHotwords = [];
  (Array.isArray(hotwords) ? hotwords : String(hotwords || '').split(/[\s,，;；]+/)).forEach(function(value) {
    const word = String(value || '').replace(/\s+/g, '').trim().slice(0, 40);
    if (word && !uniqueHotwords.includes(word)) uniqueHotwords.push(word);
  });
  return {
    initialPrompt,
    hotwords: uniqueHotwords.join(' ').slice(0, 500)
  };
}

function resolveTranscriptionProvider(value) {
  const provider = String(value || 'local').trim().toLowerCase();
  if (!['local', 'openai'].includes(provider)) {
    throw new Error('不支持的语音识别提供方：' + provider);
  }
  return provider;
}

function resolveOpenAITranscriptionUrl(value) {
  const baseUrl = String(value || 'https://api.openai.com/v1').replace(/\/+$/, '');
  let parsed;
  try { parsed = new URL(baseUrl); } catch (error) { throw new Error('OpenAI API 地址无效。'); }
  const localHost = ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && localHost)) {
    throw new Error('OpenAI API 地址必须使用 HTTPS；仅本机代理允许 HTTP。');
  }
  if (parsed.username || parsed.password) throw new Error('OpenAI API 地址不能包含凭据。');
  return baseUrl + '/audio/transcriptions';
}

async function runOpenAITranscription(input, options = {}) {
  const mediaPath = path.resolve(String(input.mediaPath || ''));
  if (!fs.existsSync(mediaPath) || !fs.statSync(mediaPath).isFile()) {
    throw new Error('OpenAI 语音识别缺少已归档的本地媒体。');
  }
  const apiKey = String(options.openAIApiKey || process.env.OPENAI_API_KEY || '').trim();
  if (!/^sk-[A-Za-z0-9_-]{17,}$/.test(apiKey)) throw new Error('OpenAI API Key 缺失或无效。');
  const model = String(input.model || options.openAIModel || process.env.WEBSTOCK_ASR_OPENAI_MODEL ||
    'gpt-transcribe').trim();
  if (!/^[0-9A-Za-z._-]{1,80}$/.test(model)) throw new Error('OpenAI 语音识别模型名称无效。');
  const url = resolveOpenAITranscriptionUrl(options.openAIBaseUrl || process.env.OPENAI_BASE_URL);
  const request = options.openAIRequest || function(requestUrl, form, config) {
    return axios.postForm(requestUrl, form, config);
  };
  const started = Date.now();
  const mediaStream = fs.createReadStream(mediaPath);
  await new Promise(function(resolve, reject) {
    mediaStream.once('open', resolve);
    mediaStream.once('error', reject);
  });
  let response;
  try {
    response = await request(url, {
      file: mediaStream,
      model,
      language: 'zh',
      prompt: String(input.prompt || '').slice(0, 1000)
    }, {
      headers: { Authorization: 'Bearer ' + apiKey },
      timeout: Math.max(Number(options.openAITimeoutMs) || 10 * 60 * 1000, 1000),
      maxBodyLength: Infinity,
      maxContentLength: 8 * 1024 * 1024
    });
  } catch (error) {
    const data = error && error.response && error.response.data;
    const message = data && data.error && data.error.message || error && error.message || '未知错误';
    throw new Error('OpenAI 语音识别失败：' + String(message).slice(0, 500));
  } finally {
    mediaStream.destroy();
  }
  const data = response && response.data && typeof response.data === 'object' ? response.data : {};
  return {
    engine: 'openai-transcription',
    engineVersion: '',
    model,
    device: 'cloud',
    computeType: 'managed',
    language: 'zh',
    languageProbability: 0,
    durationSeconds: 0,
    elapsedSeconds: Number(((Date.now() - started) / 1000).toFixed(3)),
    transcript: String(data.text || '').trim(),
    segments: []
  };
}

function runPythonTranscription(input, options = {}) {
  const timeoutMs = resolveTranscriptionTimeout(Object.assign({ durationSeconds: input.durationSeconds }, options));
  return new Promise(function(resolve, reject) {
    const args = [
      input.scriptPath || path.join(quantRoot(), 'douyin_transcribe.py'),
      '--media', input.mediaPath,
      '--model-root', input.modelRoot,
      '--model', input.model || 'small'
    ];
    if (input.modelSource) args.push('--model-source', input.modelSource);
    if (input.prompt) args.push('--prompt', String(input.prompt).slice(0, 1000));
    if (input.hotwords) args.push('--hotwords', String(input.hotwords).slice(0, 500));
    const child = childProcess.spawn(input.pythonPath, args, {
      windowsHide: true,
      env: buildTranscriptionEnvironment()
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let progressBuffer = '';
    let timer = setTimeout(function() { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', function(chunk) { stdout = (stdout + chunk).slice(-8 * 1024 * 1024); });
    child.stderr.on('data', function(chunk) {
      stderr = (stderr + chunk).slice(-12000);
      progressBuffer = (progressBuffer + chunk).slice(-24000);
      const lines = progressBuffer.split(/\r?\n/);
      progressBuffer = lines.pop();
      lines.forEach(function(line) {
        if (!line.startsWith('ASR_PROGRESS ')) return;
        try { if (typeof input.onProgress === 'function') input.onProgress(JSON.parse(line.slice(13))); } catch (_) {}
      });
    });
    child.on('error', function(error) { clearTimeout(timer); timer = null; reject(error); });
    child.on('close', function(code) {
      if (timer) clearTimeout(timer);
      if (code !== 0) {
        if (timedOut) { reject(new Error('本地转写超过 ' + Math.round(timeoutMs / 60000) + ' 分钟；视频已保留，可稍后重试。')); return; }
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
  const metric = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  const segments = (Array.isArray(source.segments) ? source.segments : []).map(function(segment) {
    const rawText = String(segment.text || '').trim().slice(0, 4000);
    return {
      start: Math.max(Number(segment.start) || 0, 0),
      end: Math.max(Number(segment.end) || 0, 0),
      rawText,
      text: toSimplifiedChinese(rawText),
      avgLogProbability: metric(segment.avgLogProbability),
      noSpeechProbability: metric(segment.noSpeechProbability),
      compressionRatio: metric(segment.compressionRatio)
    };
  }).filter(function(segment) { return segment.text && segment.end >= segment.start; }).slice(0, 10000);
  const rawTranscript = String(source.transcript || segments.map(function(item) { return item.rawText; }).join('')).trim().slice(0, 800000);
  const transcript = toSimplifiedChinese(rawTranscript).slice(0, 800000);
  const logProbabilities = segments.map(function(item) { return item.avgLogProbability; }).filter(Number.isFinite);
  const noSpeechProbabilities = segments.map(function(item) { return item.noSpeechProbability; }).filter(Number.isFinite);
  const compressionRatios = segments.map(function(item) { return item.compressionRatio; }).filter(Number.isFinite);
  const average = function(values) {
    return values.length ? values.reduce(function(sum, value) { return sum + value; }, 0) / values.length : null;
  };
  const averageLogProbability = average(logProbabilities);
  const averageNoSpeechProbability = average(noSpeechProbabilities);
  const maximumCompressionRatio = compressionRatios.length ? Math.max.apply(Math, compressionRatios) : null;
  const qualityReasons = [];
  if (averageLogProbability != null && averageLogProbability < -1) qualityReasons.push('low_log_probability');
  if (averageNoSpeechProbability != null && averageNoSpeechProbability > 0.35) qualityReasons.push('high_no_speech_probability');
  if (maximumCompressionRatio != null && maximumCompressionRatio > 2.4) qualityReasons.push('high_compression_ratio');
  const needsReview = Boolean(transcript && qualityReasons.length);
  const mediaEvidence = {
    localAssetPath: String(download.localAssetPath || ''),
    sha256: String(download.sha256 || '').toLowerCase(),
    bytes: Math.max(Number(download.bytes) || 0, 0),
    mimeType: String(download.contentType || '').slice(0, 120)
  };
  return {
    status: transcript ? (needsReview ? 'needs_review' : 'complete') : 'no_speech',
    engine: String(source.engine || 'faster-whisper').slice(0, 80),
    engineVersion: String(source.engineVersion || '').slice(0, 80),
    model: String(source.model || 'small').slice(0, 80),
    device: String(source.device || 'cpu').slice(0, 40),
    computeType: String(source.computeType || 'int8').slice(0, 40),
    language: String(source.language || '').slice(0, 20),
    languageProbability: Math.min(Math.max(Number(source.languageProbability) || 0, 0), 1),
    durationSeconds: Math.max(Number(source.durationSeconds) || 0, 0),
    elapsedSeconds: Math.max(Number(source.elapsedSeconds) || 0, 0),
    rawTranscript,
    transcript,
    segments,
    normalization: {
      script: 'zh-Hans',
      sourceHadTraditional: Boolean(rawTranscript && rawTranscript !== transcript),
      converter: 'opencc-js/tw-to-cn'
    },
    quality: {
      needsReview,
      reasons: qualityReasons,
      averageLogProbability,
      averageNoSpeechProbability,
      maximumCompressionRatio
    },
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
  const runOpenAI = options.runOpenAI || runOpenAITranscription;
  const cleanup = cleanupStaleTempFiles(archiveRoot, { maxAgeMs: options.staleTempMaxAgeMs });

  function report(input, progress) {
    if (typeof input.onProgress !== 'function') return;
    try { input.onProgress(progress); } catch (error) {}
  }

  function readiness(input = {}) {
    const provider = resolveTranscriptionProvider(input.provider || options.provider ||
      process.env.WEBSTOCK_ASR_PROVIDER || 'local');
    if (provider === 'openai') {
      const apiKey = String(options.openAIApiKey || process.env.OPENAI_API_KEY || '').trim();
      return apiKey ? { available: true, provider }
        : { available: false, provider, status: 'runtime_missing', message: 'GPT Transcribe 尚未配置 API Key，视频详情仍会保存。' };
    }
    try {
      const model = String(input.model || options.model || process.env.WEBSTOCK_ASR_MODEL || 'small');
      if (['turbo', 'large-v3-turbo', 'large-v3'].includes(model) && !resolveLocalModelSource(modelRoot, model)) {
        return { available: false, provider, status: 'model_missing', message: model + ' 模型尚未完整安装；视频详情仍会保存，请安装模型或改选 small。' };
      }
      return { available: true, provider, pythonPath: resolvePython(options.pythonPath) };
    } catch (error) {
      return {
        available: false,
        provider,
        status: 'runtime_missing',
        message: '本地转写环境尚未安装或关联；视频详情仍会保存，安装后可继续补转写。'
      };
    }
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
    const provider = resolveTranscriptionProvider(input.provider || options.provider ||
      process.env.WEBSTOCK_ASR_PROVIDER || 'local');
    report(input, {
      stage: 'transcribing',
      message: provider === 'openai' ? '媒体归档完成，正在使用 GPT Transcribe 识别' : '媒体归档完成，正在本地识别',
      mediaBytes: archiveEvidence.mediaBytes
    });
    const download = {
      localAssetPath: archiveEvidence.localAssetPath,
      sha256: archiveEvidence.mediaSha256,
      bytes: archiveEvidence.mediaBytes,
      contentType: archiveEvidence.mediaContentType
    };
    const model = String(input.model || (provider === 'openai'
      ? options.openAIModel || process.env.WEBSTOCK_ASR_OPENAI_MODEL || 'gpt-transcribe'
      : options.model || process.env.WEBSTOCK_ASR_MODEL || 'small'));
    const recognitionPrompt = buildRecognitionPrompt(input.prompt, input.hotwords || []);
    const transcriptionInput = {
      mediaPath: archiveEvidence.localAssetPath,
      model,
      durationSeconds: input.durationSeconds,
      onProgress: function(progress) { report(input, progress); },
      prompt: recognitionPrompt.initialPrompt + (recognitionPrompt.hotwords
        ? ' 重点术语：' + recognitionPrompt.hotwords : ''),
      hotwords: recognitionPrompt.hotwords
    };
    const localModelSource = provider === 'local' ? resolveLocalModelSource(modelRoot, model) : '';
    if (provider === 'local' && ['turbo', 'large-v3-turbo', 'large-v3'].includes(model) && !localModelSource) {
      throw new Error('本地 ' + model + ' 模型未完整下载；已停止识别，避免后台静默下载导致程序看似卡住。');
    }
    const raw = provider === 'openai'
      ? await runOpenAI(transcriptionInput, options)
      : await runPython(Object.assign(transcriptionInput, {
          pythonPath: resolvePython(options.pythonPath),
          scriptPath,
          modelRoot,
          modelSource: localModelSource
        }), options);
    const result = normalizeResult(raw, download);
    report(input, {
      stage: 'complete',
      message: provider === 'openai' ? 'GPT Transcribe 识别完成' : '本地语音识别完成',
      mediaBytes: result.mediaBytes,
      elapsedSeconds: result.elapsedSeconds
    });
    return result;
  }

  return { archive, transcribe, readiness, cleanup };
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
  runOpenAITranscription,
  buildRecognitionPrompt,
  resolveTranscriptionProvider,
  normalizeResult
};
