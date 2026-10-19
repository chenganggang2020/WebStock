const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveTranscriptionTimeout, normalizeResult, buildRecognitionPrompt, createDouyinTranscriptService } = require('../services/douyinTranscriptService');

test('long videos get a duration-aware bounded timeout; explicit timeout still wins', () => {
  assert.equal(resolveTranscriptionTimeout(), 1800000);
  assert.equal(resolveTranscriptionTimeout({ durationSeconds: 3600 }), 15000000);
  assert.equal(resolveTranscriptionTimeout({ durationSeconds: 86400 }), 21600000);
  assert.equal(resolveTranscriptionTimeout({ timeoutMs: 2000, durationSeconds: 3600 }), 2000);
});

test('unknown segment quality remains null rather than perfect zero', () => {
  const result = normalizeResult({ segments: [{ start: 0, end: 1, text: '测试', avgLogProbability: null, noSpeechProbability: '', compressionRatio: null }] }, {});
  assert.equal(result.quality.averageLogProbability, null);
  assert.equal(result.quality.averageNoSpeechProbability, null);
  assert.equal(result.quality.maximumCompressionRatio, null);
});

test('general creator prompt does not assume financial subject matter', () => {
  assert.doesNotMatch(buildRecognitionPrompt('生活记录').initialPrompt, /财经视频/);
});

test('uninstalled high quality model reports unavailable before scheduling transcription', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'creator-model-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = createDouyinTranscriptService({ modelRoot: root, archiveRoot: root, pythonPath: process.execPath });
  const status = service.readiness({ model: 'large-v3' });
  assert.equal(status.available, false);
  assert.equal(status.status, 'model_missing');
  assert.match(status.message, /large-v3/);
});
