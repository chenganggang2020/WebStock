const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createDouyinTranscriptService,
  isAllowedDouyinMediaUrl
} = require('../services/douyinTranscriptService');

test('Douyin transcription accepts only HTTPS ByteDance media CDN URLs', () => {
  assert.equal(isAllowedDouyinMediaUrl('https://v3-dy-o.zjcdn.com/video/sample.mp4'), true);
  assert.equal(isAllowedDouyinMediaUrl('https://www.douyinvod.com/video/sample.mp4'), true);
  assert.equal(isAllowedDouyinMediaUrl('http://v3-dy-o.zjcdn.com/video/sample.mp4'), false);
  assert.equal(isAllowedDouyinMediaUrl('https://example.com/video/sample.mp4'), false);
  assert.equal(isAllowedDouyinMediaUrl('https://zjcdn.com.example.com/video/sample.mp4'), false);
});

test('transcription deletes temporary media and never returns its signed URL', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-asr-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let mediaPath = '';
  const service = createDouyinTranscriptService({
    tempRoot: root,
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
  assert.equal(result.mediaSha256, 'a'.repeat(64));
  assert.equal(result.segments.length, 1);
  assert.equal(fs.existsSync(mediaPath), false);
  assert.doesNotMatch(JSON.stringify(result), /token=secret/);
});
