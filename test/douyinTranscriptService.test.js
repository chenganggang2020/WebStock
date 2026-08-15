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
  normalizeResult
} = require('../services/douyinTranscriptService');

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
