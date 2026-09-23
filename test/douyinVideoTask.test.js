const test = require('node:test');
const assert = require('node:assert/strict');
function fixture() {
  const item = { id: 7, channelId: 1, externalContentId: '7000000000000000001',
    sourceUrl: 'https://www.douyin.com/video/7000000000000000001', evidenceLevel: 'primary',
    localAssetPath: 'saved.mp4', title: 'test', mediaMetadata: {} };
  const calls = [];
  return { item, calls, deps: {
    channels: { getChannel() { return { platform: 'douyin' }; }, getObservation() { return item; } },
    sessionManager: { async captureUrl(url) { calls.push(url); return { loggedIn: true, items: [{ contentId: item.externalContentId }] }; } },
    sources: { verifyCapturedIdentity() { return { matched: true }; }, importCapturedPage() { calls.push('import'); },
      applyMediaArchive() {}, applyTranscription() { calls.push('transcribed'); } },
    transcriber: { async transcribe() { calls.push('ASR'); return { transcript: 'text', status: 'complete' }; } }
  } };
}
test('single-video transcription uses its local archive without browsing profiles or other videos', async () => {
  const f = fixture();
  const { runDouyinVideoTask } = require('../electron/douyinVideoTask');
  await runDouyinVideoTask(f.deps, 1, 7, 'transcribe');
  assert.deepEqual(f.calls, ['ASR', 'transcribed']);
});
test('comment update captures only the selected video and never invokes transcription', async () => {
  const f = fixture();
  const { runDouyinVideoTask } = require('../electron/douyinVideoTask');
  await runDouyinVideoTask(f.deps, 1, 7, 'comments');
  assert.deepEqual(f.calls, [f.item.sourceUrl, 'import']);
});
test('single-video actions reject unsafe source identity and unknown stages before navigation', async () => {
  const f = fixture();
  const { runDouyinVideoTask } = require('../electron/douyinVideoTask');
  f.item.sourceUrl = 'https://example.com/video/7000000000000000001';
  await assert.rejects(runDouyinVideoTask(f.deps, 1, 7, 'comments'));
  await assert.rejects(runDouyinVideoTask(f.deps, 1, 7, 'delete'));
  assert.equal(f.calls.length, 0);
});

test('single-video retry forwards the chosen local model and real duration', async () => {
  const f = fixture();
  f.item.mediaMetadata.durationSeconds = 3800;
  let input;
  f.deps.transcriber.transcribe = async value => { input = value; return {transcript:'文本',status:'complete'}; };
  const { runDouyinVideoTask } = require('../electron/douyinVideoTask');
  await runDouyinVideoTask(f.deps, 1, 7, 'transcribe', () => {}, {model:'large-v3-turbo'});
  assert.equal(input.model, 'large-v3-turbo');
  assert.equal(input.provider, 'local');
  assert.equal(input.durationSeconds, 3800);
  await assert.rejects(runDouyinVideoTask(f.deps, 1, 7, 'transcribe', () => {}, {model:'unexpected'}), /不支持/);
});
