const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createDouyinTranscriptService,
  isAllowedDouyinMediaUrl,
  cleanupStaleTempFiles,
  buildTranscriptionEnvironment,
  prepareTranscriptionScript,
  resolveLocalModelSource,
  resolveTranscriptionTimeout,
  buildRecognitionPrompt,
  runOpenAITranscription,
  normalizeResult
} = require('../services/douyinTranscriptService');

test('ASR output keeps the raw evidence while publishing simplified Chinese', () => {
  const result = normalizeResult({
    engine: 'faster-whisper', model: 'small', language: 'zh',
    transcript: '長鑫科技發布中報，淨利潤超預期。',
    segments: [{
      start: 0.2, end: 3.4, text: '長鑫科技發布中報，淨利潤超預期。',
      avgLogProbability: -0.25, noSpeechProbability: 0.01, compressionRatio: 1.1
    }]
  }, {
    localAssetPath: 'D:/archive/7000000000000000002.mp4',
    sha256: 'b'.repeat(64), bytes: 2345, contentType: 'video/mp4'
  });

  assert.equal(result.rawTranscript, '長鑫科技發布中報，淨利潤超預期。');
  assert.equal(result.transcript, '长鑫科技发布中报，净利润超预期。');
  assert.equal(result.segments[0].rawText, '長鑫科技發布中報，淨利潤超預期。');
  assert.equal(result.segments[0].text, '长鑫科技发布中报，净利润超预期。');
  assert.equal(result.normalization.script, 'zh-Hans');
  assert.equal(result.normalization.sourceHadTraditional, true);
});

test('recognition prompt requests simplified Chinese and adds bounded finance hotwords', () => {
  const prompt = buildRecognitionPrompt('模型先生的观点', [
    '宇树科技', '人形机器人', '股价腰斩', '宇树科技'
  ]);

  assert.match(prompt.initialPrompt, /中国大陆简体中文/);
  assert.match(prompt.initialPrompt, /模型先生的观点/);
  assert.equal(prompt.hotwords, '宇树科技 人形机器人 股价腰斩');
  assert.ok(prompt.initialPrompt.length <= 1000);
  assert.ok(prompt.hotwords.length <= 500);
});

test('low-confidence ASR segments are retained but marked for review', () => {
  const result = normalizeResult({
    transcript: '宇宿科技上市一周国家摇转。',
    segments: [{
      start: 0, end: 4, text: '宇宿科技上市一周国家摇转。',
      avgLogProbability: -1.35, noSpeechProbability: 0.04, compressionRatio: 1.2
    }]
  }, {
    localAssetPath: 'D:/archive/7000000000000000003.mp4',
    sha256: 'c'.repeat(64), bytes: 3456, contentType: 'video/mp4'
  });

  assert.equal(result.status, 'needs_review');
  assert.equal(result.quality.needsReview, true);
  assert.ok(result.quality.reasons.includes('low_log_probability'));
  assert.equal(result.segments[0].avgLogProbability, -1.35);
});

test('one transcription can select local large-v3-turbo without changing the service default', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-asr-turbo-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const modelRoot = path.join(root, 'models');
  const modelPath = path.join(modelRoot, 'faster-whisper-large-v3-turbo');
  fs.mkdirSync(modelPath, { recursive: true });
  ['config.json', 'model.bin', 'tokenizer.json', 'vocabulary.json'].forEach(function(name) {
    fs.writeFileSync(path.join(modelPath, name), 'cached', 'utf8');
  });
  let selectedModel = '';
  const service = createDouyinTranscriptService({
    archiveRoot: root,
    modelRoot,
    pythonPath: process.execPath,
    async downloadMedia(_url, target) {
      fs.writeFileSync(target, 'turbo-test-media');
      return { bytes: 16, contentType: 'video/mp4' };
    },
    async runPython(input) {
      selectedModel = input.model;
      return {
        engine: 'faster-whisper', model: input.model, language: 'zh',
        transcript: '宇树科技上市一周，股价腰斩。', segments: []
      };
    }
  });

  const result = await service.transcribe({
    provider: 'local', model: 'large-v3-turbo',
    mediaUrl: 'https://v3-dy-o.zjcdn.com/video/turbo.mp4',
    contentId: '7679653054857277361'
  });

  assert.equal(selectedModel, 'large-v3-turbo');
  assert.equal(result.model, 'large-v3-turbo');
});

test('local large-v3-turbo fails fast when its model is incomplete instead of starting a hidden download', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-asr-turbo-missing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let pythonRuns = 0;
  const service = createDouyinTranscriptService({
    archiveRoot: root,
    modelRoot: path.join(root, 'models'),
    pythonPath: process.execPath,
    async downloadMedia(_url, target) {
      fs.writeFileSync(target, 'turbo-test-media');
      return { bytes: 16, contentType: 'video/mp4' };
    },
    async runPython() { pythonRuns += 1; }
  });

  await assert.rejects(() => service.transcribe({
    provider: 'local', model: 'large-v3-turbo',
    mediaUrl: 'https://v3-dy-o.zjcdn.com/video/turbo-missing.mp4',
    contentId: '7679653054857277399'
  }), /large-v3-turbo.*未完整下载/);
  assert.equal(pythonRuns, 0);
});

test('one transcription can use GPT Transcribe while preserving the same local archive evidence', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-asr-openai-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let cloudInput = null;
  const service = createDouyinTranscriptService({
    archiveRoot: root,
    pythonPath: process.execPath,
    async downloadMedia(_url, target) {
      fs.writeFileSync(target, 'cloud-test-media');
      return { bytes: 16, contentType: 'video/mp4' };
    },
    async runPython() { throw new Error('cloud selection must not invoke local Whisper'); },
    async runOpenAI(input) {
      cloudInput = input;
      return {
        engine: 'openai-transcription', model: input.model, language: 'zh',
        transcript: '宇树科技上市一周，股价腰斩。', segments: []
      };
    }
  });
  const progressEvents = [];

  const result = await service.transcribe({
    provider: 'openai', model: 'gpt-transcribe',
    prompt: '模型先生讨论人形机器人', hotwords: ['宇树科技', '股价腰斩'],
    mediaUrl: 'https://v3-dy-o.zjcdn.com/video/openai.mp4',
    contentId: '7679653054857277362',
    onProgress(event) { progressEvents.push(event); }
  });

  assert.equal(cloudInput.model, 'gpt-transcribe');
  assert.match(cloudInput.prompt, /中国大陆简体中文/);
  assert.match(cloudInput.prompt, /宇树科技/);
  assert.equal(fs.existsSync(cloudInput.mediaPath), true);
  assert.equal(result.engine, 'openai-transcription');
  assert.equal(result.model, 'gpt-transcribe');
  assert.match(result.localAssetPath, /7679653054857277362\.mp4$/);
  assert.match(result.mediaSha256, /^[a-f0-9]{64}$/);
  assert.match(progressEvents.at(-1).message, /GPT Transcribe/);
});

test('GPT Transcribe uploads the archived file with Chinese context and returns a normalizable result', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-openai-request-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const mediaPath = path.join(root, 'sample.mp4');
  fs.writeFileSync(mediaPath, 'openai-audio-fixture');
  let requestEvidence = null;

  const result = await runOpenAITranscription({
    mediaPath,
    model: 'gpt-transcribe',
    prompt: '请使用简体中文。重点术语：宇树科技 股价腰斩'
  }, {
    openAIApiKey: 'sk-' + 'a'.repeat(40),
    openAIBaseUrl: 'https://api.openai.test/v1/',
    async openAIRequest(url, form, config) {
      requestEvidence = { url, form, config };
      return { data: { text: '宇树科技上市一周，股价腰斩。' } };
    }
  });

  assert.equal(requestEvidence.url, 'https://api.openai.test/v1/audio/transcriptions');
  assert.equal(requestEvidence.form.model, 'gpt-transcribe');
  assert.equal(requestEvidence.form.language, 'zh');
  assert.match(requestEvidence.form.prompt, /宇树科技/);
  assert.equal(requestEvidence.form.file.path, mediaPath);
  assert.equal(requestEvidence.config.headers.Authorization, 'Bearer sk-' + 'a'.repeat(40));
  assert.equal(result.engine, 'openai-transcription');
  assert.equal(result.model, 'gpt-transcribe');
  assert.equal(result.transcript, '宇树科技上市一周，股价腰斩。');
  assert.doesNotMatch(JSON.stringify(result), /sk-/);
});

test('GPT Transcribe stops before upload when the OpenAI key is missing', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-openai-no-key-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const mediaPath = path.join(root, 'sample.mp4');
  fs.writeFileSync(mediaPath, 'openai-audio-fixture');
  let requestCount = 0;

  await assert.rejects(() => runOpenAITranscription({ mediaPath, model: 'gpt-transcribe' }, {
    openAIApiKey: '',
    async openAIRequest() { requestCount += 1; }
  }), /OpenAI API Key/);
  assert.equal(requestCount, 0);
});

test('packaged transcription script survives cleanup of the portable extraction directory', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-asr-script-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const extractedRoot = path.join(root, 'resources', 'app.asar.unpacked', 'quant');
  const source = path.join(extractedRoot, 'douyin_transcribe.py');
  const durable = path.join(root, 'WebStockData', 'asr-runtime', 'douyin_transcribe.py');
  fs.mkdirSync(extractedRoot, { recursive: true });
  fs.writeFileSync(source, 'print("packaged ASR")\n', 'utf8');

  const prepared = prepareTranscriptionScript({ source, durable });
  fs.rmSync(path.join(root, 'resources'), { recursive: true, force: true });

  assert.equal(prepared, durable);
  assert.equal(fs.readFileSync(prepared, 'utf8'), 'print("packaged ASR")\n');
});

test('transcription service reports a missing local runtime before a collection run repeatedly fails', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-asr-readiness-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = path.join(root, 'douyin_transcribe.py');
  fs.writeFileSync(script, 'print("ready")\n', 'utf8');
  const priorWorkspace = process.env.WEBSTOCK_QUANT_WORKSPACE;
  process.env.WEBSTOCK_QUANT_WORKSPACE = path.join(root, 'workspace');
  t.after(() => {
    if (priorWorkspace === undefined) delete process.env.WEBSTOCK_QUANT_WORKSPACE;
    else process.env.WEBSTOCK_QUANT_WORKSPACE = priorWorkspace;
  });
  const service = createDouyinTranscriptService({
    scriptPath: script,
    archiveRoot: path.join(root, 'archive'),
    modelRoot: path.join(root, 'models'),
    pythonPath: path.join(root, 'missing-python.exe')
  });
  assert.equal(service.readiness().available, false);
  assert.equal(service.readiness().status, 'runtime_missing');
});

test('cached Whisper model resolves to a local snapshot without a remote lookup', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-asr-model-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const revision = '536b0662742c02347bc0e980a01041f333bce120';
  const repository = path.join(root, 'models--Systran--faster-whisper-small');
  const snapshot = path.join(repository, 'snapshots', revision);
  fs.mkdirSync(path.join(repository, 'refs'), { recursive: true });
  fs.mkdirSync(snapshot, { recursive: true });
  fs.writeFileSync(path.join(repository, 'refs', 'main'), revision + '\n', 'utf8');
  ['config.json', 'model.bin', 'tokenizer.json', 'vocabulary.txt'].forEach(function(name) {
    fs.writeFileSync(path.join(snapshot, name), 'cached', 'utf8');
  });

  assert.equal(resolveLocalModelSource(root, 'small'), snapshot);
  fs.rmSync(path.join(snapshot, 'model.bin'));
  assert.equal(resolveLocalModelSource(root, 'small'), '');
});

test('cached large-v3-turbo resolves the faster-whisper repository used by the runtime', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-asr-turbo-model-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const revision = '0a36b2f3f7e145e8bc21c81fffa72d84a2b1127b';
  const repository = path.join(root, 'models--mobiuslabsgmbh--faster-whisper-large-v3-turbo');
  const snapshot = path.join(repository, 'snapshots', revision);
  fs.mkdirSync(path.join(repository, 'refs'), { recursive: true });
  fs.mkdirSync(snapshot, { recursive: true });
  fs.writeFileSync(path.join(repository, 'refs', 'main'), revision + '\n', 'utf8');
  ['config.json', 'model.bin', 'tokenizer.json', 'vocabulary.json'].forEach(function(name) {
    fs.writeFileSync(path.join(snapshot, name), 'cached', 'utf8');
  });

  assert.equal(resolveLocalModelSource(root, 'large-v3-turbo'), snapshot);
  assert.equal(resolveLocalModelSource(root, 'turbo'), snapshot);
});

test('a durable flat large-v3-turbo download is preferred over a remote lookup', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-asr-flat-turbo-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const modelPath = path.join(root, 'faster-whisper-large-v3-turbo');
  fs.mkdirSync(modelPath, { recursive: true });
  ['config.json', 'model.bin', 'tokenizer.json', 'vocabulary.json'].forEach(function(name) {
    fs.writeFileSync(path.join(modelPath, name), 'cached', 'utf8');
  });

  assert.equal(resolveLocalModelSource(root, 'large-v3-turbo'), modelPath);
  assert.equal(resolveLocalModelSource(root, 'turbo'), modelPath);
});

test('transcription subprocess caps native CPU thread pools without mutating the parent environment', () => {
  const parentEnvironment = {
    PYTHONUTF8: '0',
    OMP_NUM_THREADS: '64',
    MKL_NUM_THREADS: '64',
    UNRELATED_SETTING: 'preserved'
  };

  const environment = buildTranscriptionEnvironment(parentEnvironment);

  assert.equal(environment.PYTHONUTF8, '1');
  assert.equal(environment.OMP_NUM_THREADS, '2');
  assert.equal(environment.MKL_NUM_THREADS, '1');
  assert.equal(environment.OPENBLAS_NUM_THREADS, '1');
  assert.equal(environment.NUMEXPR_NUM_THREADS, '1');
  assert.equal(environment.UNRELATED_SETTING, 'preserved');
  assert.equal(parentEnvironment.OMP_NUM_THREADS, '64');
});

test('cold local model loading has enough time to finish before transcription is terminated', () => {
  assert.equal(resolveTranscriptionTimeout({}), 30 * 60 * 1000);
  assert.equal(resolveTranscriptionTimeout({ timeoutMs: 45000 }), 45000);
});

test('Douyin transcription accepts only HTTPS ByteDance media CDN URLs', () => {
  assert.equal(isAllowedDouyinMediaUrl('https://v3-dy-o.zjcdn.com/video/sample.mp4'), true);
  assert.equal(isAllowedDouyinMediaUrl('https://www.douyinvod.com/video/sample.mp4'), true);
  assert.equal(isAllowedDouyinMediaUrl('http://v3-dy-o.zjcdn.com/video/sample.mp4'), false);
  assert.equal(isAllowedDouyinMediaUrl('https://example.com/video/sample.mp4'), false);
  assert.equal(isAllowedDouyinMediaUrl('https://zjcdn.com.example.com/video/sample.mp4'), false);
});

test('transcription permanently archives media and returns reusable local evidence metadata', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-asr-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let mediaPath = '';
  const service = createDouyinTranscriptService({
    archiveRoot: root,
    pythonPath: process.execPath,
    async downloadMedia(_url, target) {
      mediaPath = target;
      fs.writeFileSync(target, 'test-media');
      return { sha256: 'a'.repeat(64), bytes: 10, contentType: 'video/mp4' };
    },
    async runPython(input) {
      assert.equal(fs.existsSync(input.mediaPath), true);
      return {
        engine: 'faster-whisper', engineVersion: '1.2.1', model: 'small',
        language: 'zh', languageProbability: 0.99, durationSeconds: 67.7,
        elapsedSeconds: 19.1,
        transcript: '有色板块现在还处于早期。',
        segments: [{ start: 0.5, end: 3.2, text: '有色板块现在还处于早期。' }]
      };
    }
  });

  const signedUrl = 'https://v3-dy-o.zjcdn.com/video/sample.mp4?token=secret';
  const result = await service.transcribe({ mediaUrl: signedUrl, contentId: '7671834569137647601' });

  assert.equal(result.transcript, '有色板块现在还处于早期。');
  const expectedSha256 = crypto.createHash('sha256').update('test-media').digest('hex');
  assert.equal(result.mediaSha256, expectedSha256);
  assert.equal(result.sha256, expectedSha256);
  assert.equal(result.bytes, 10);
  assert.equal(result.mimeType, 'video/mp4');
  assert.equal(result.localAssetPath, path.join(root, '7671834569137647601.mp4'));
  assert.equal(result.segments.length, 1);
  assert.equal(mediaPath.endsWith('.part'), true);
  assert.equal(fs.existsSync(mediaPath), false);
  assert.equal(fs.existsSync(result.localAssetPath), true);
  assert.doesNotMatch(JSON.stringify(result), /token=secret/);
});

test('transcription reuses a completed archive when the remote URL is no longer available', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-asr-reuse-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let downloadCount = 0;
  let transcriptionCount = 0;
  const service = createDouyinTranscriptService({
    archiveRoot: root,
    pythonPath: process.execPath,
    async downloadMedia(_url, target) {
      downloadCount += 1;
      fs.writeFileSync(target, 'permanent-media');
      return { sha256: 'b'.repeat(64), bytes: 15, contentType: 'video/mp4' };
    },
    async runPython(input) {
      transcriptionCount += 1;
      assert.equal(input.mediaPath, path.join(root, '7672552250465095409.mp4'));
      return { transcript: '这是可复用的本地转写。', segments: [] };
    }
  });

  const first = await service.transcribe({
    mediaUrl: 'https://v3-dy-o.zjcdn.com/video/sample.mp4?token=expired-later',
    contentId: '7672552250465095409'
  });
  const second = await service.transcribe({ mediaUrl: '', contentId: '7672552250465095409' });

  assert.equal(downloadCount, 1);
  assert.equal(transcriptionCount, 2);
  assert.equal(second.localAssetPath, first.localAssetPath);
  assert.equal(fs.readFileSync(second.localAssetPath, 'utf8'), 'permanent-media');
});

test('transcription reports permanent archive evidence before a later ASR failure', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-asr-failure-archive-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let archived = null;
  const service = createDouyinTranscriptService({
    archiveRoot: root,
    pythonPath: process.execPath,
    async downloadMedia(_url, target) {
      fs.writeFileSync(target, 'keep-even-when-asr-fails');
      return { bytes: 24, contentType: 'video/mp4' };
    },
    async runPython() { throw new Error('planned ASR failure after archive'); }
  });

  await assert.rejects(() => service.transcribe({
    mediaUrl: 'https://v3-dy-o.zjcdn.com/video/failure.mp4',
    contentId: '7672552250465095499',
    onArchived(evidence) { archived = evidence; }
  }), /planned ASR failure/);

  assert.ok(archived);
  assert.match(archived.localAssetPath, /7672552250465095499\.mp4$/);
  assert.match(archived.mediaSha256, /^[a-f0-9]{64}$/);
  assert.equal(archived.mediaBytes, 24);
  assert.equal(fs.existsSync(archived.localAssetPath), true);
});

test('an archived video with no detectable speech returns a terminal no-speech result', () => {
  const result = normalizeResult({
    engine: 'faster-whisper', model: 'small', durationSeconds: 18.4,
    transcript: '', segments: []
  }, {
    localAssetPath: 'D:/archive/7000000000000000001.mp4',
    sha256: 'a'.repeat(64), bytes: 1234, contentType: 'video/mp4'
  });

  assert.equal(result.status, 'no_speech');
  assert.equal(result.transcript, '');
  assert.deepEqual(result.segments, []);
  assert.equal(result.localAssetPath, 'D:/archive/7000000000000000001.mp4');
  assert.equal(result.mediaSha256, 'a'.repeat(64));
});

test('archive-only backfill verifies the historical hash without running ASR', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-archive-backfill-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const media = Buffer.from('historical-video-bytes');
  const expectedSha256 = crypto.createHash('sha256').update(media).digest('hex');
  let transcriptionCount = 0;
  const service = createDouyinTranscriptService({
    archiveRoot: root,
    async downloadMedia(_url, target) {
      fs.writeFileSync(target, media);
      return { bytes: media.length, contentType: 'video/mp4' };
    },
    async runPython() { transcriptionCount += 1; throw new Error('archive backfill must not run ASR'); }
  });

  const result = await service.archive({
    mediaUrl: 'https://v3-dy-o.zjcdn.com/video/historical.mp4?token=current',
    contentId: '7666656007661215217',
    expectedSha256
  });

  assert.equal(transcriptionCount, 0);
  assert.equal(result.mediaSha256, expectedSha256);
  assert.equal(result.localAssetPath, path.join(root, '7666656007661215217.mp4'));
  assert.deepEqual(fs.readFileSync(result.localAssetPath), media);
});

test('archive-only backfill rejects a different remote video without publishing it', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-archive-backfill-mismatch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const expectedSha256 = crypto.createHash('sha256').update('historical-video').digest('hex');
  const service = createDouyinTranscriptService({
    archiveRoot: root,
    async downloadMedia(_url, target) {
      fs.writeFileSync(target, 'different-video');
      return { bytes: 15, contentType: 'video/mp4' };
    }
  });

  await assert.rejects(() => service.archive({
    mediaUrl: 'https://v3-dy-o.zjcdn.com/video/different.mp4',
    contentId: '7666656007661215217',
    expectedSha256
  }), /历史 SHA-256 不一致/);

  assert.equal(fs.existsSync(path.join(root, '7666656007661215217.mp4')), false);
  assert.equal(fs.readdirSync(root).some(name => name.endsWith('.part')), false);
});

test('archive-only backfill tries an equivalent backup URL before reporting a hash mismatch', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-archive-backfill-backup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const expectedMedia = Buffer.from('historical-video-from-backup');
  const expectedSha256 = crypto.createHash('sha256').update(expectedMedia).digest('hex');
  const attempts = [];
  const service = createDouyinTranscriptService({
    archiveRoot: root,
    async downloadMedia(url, target) {
      attempts.push(url);
      const media = url.includes('/primary/') ? Buffer.from('wrong-rendition') : expectedMedia;
      fs.writeFileSync(target, media);
      return { bytes: media.length, contentType: 'video/mp4' };
    }
  });

  const result = await service.archive({
    mediaUrl: 'https://v3-dy-o.zjcdn.com/video/primary/historical.mp4',
    mediaUrls: [
      'https://v3-dy-o.zjcdn.com/video/primary/historical.mp4',
      'https://v3-dy-o.zjcdn.com/video/backup/historical.mp4'
    ],
    contentId: '7666656007661215217',
    expectedSha256
  });

  assert.deepEqual(attempts, [
    'https://v3-dy-o.zjcdn.com/video/primary/historical.mp4',
    'https://v3-dy-o.zjcdn.com/video/backup/historical.mp4'
  ]);
  assert.equal(result.mediaSha256, expectedSha256);
  assert.deepEqual(fs.readFileSync(result.localAssetPath), expectedMedia);
  assert.equal(fs.readdirSync(root).some(name => name.endsWith('.part')), false);
});

test('startup cleanup removes only stale incomplete part files and preserves completed archives', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-asr-cleanup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stalePart = path.join(root, '7667364366095098361-5ff18364b1ee.mp4.part');
  const freshPart = path.join(root, '7672552250465095409-abcdef123456.mp4.part');
  const completed = path.join(root, '7667364366095098361.mp4');
  fs.writeFileSync(stalePart, 'stale');
  fs.writeFileSync(freshPart, 'fresh');
  fs.writeFileSync(completed, 'permanent');
  const now = new Date('2026-08-11T10:00:00.000Z');
  fs.utimesSync(stalePart, new Date(now.getTime() - 7 * 60 * 60 * 1000), new Date(now.getTime() - 7 * 60 * 60 * 1000));

  const result = cleanupStaleTempFiles(root, { maxAgeMs: 6 * 60 * 60 * 1000, nowMs: now.getTime() });

  assert.deepEqual(result, { scannedCount: 2, removedCount: 1 });
  assert.equal(fs.existsSync(stalePart), false);
  assert.equal(fs.existsSync(freshPart), true);
  assert.equal(fs.existsSync(completed), true);
});
