const test = require('node:test');
const assert = require('node:assert/strict');
const { createDouyinAutoSync } = require('../electron/douyinAutoSync');

function fixture(options = {}) {
  const profileUrl = 'https://www.douyin.com/user/login-state-fixture';
  const contentId = '7950000000000000001';
  const observation = { externalContentId: contentId, sourceUrl: 'https://www.douyin.com/video/' + contentId,
    mediaType: 'video', transcript: 'saved transcript', mediaMetadata: { asr: { status: 'complete' } } };
  if (options.pending) { observation.transcript = ''; observation.mediaMetadata = { incrementalPending: true }; }
  let capture = { loggedIn: true, pageUrl: profileUrl, pageType: 'profile',
    profile: { profileUrl, displayName: 'fixture' }, items: [{ contentId, sourceUrl: observation.sourceUrl, title: 'fixture' }] };
  let matched = true;
  const states = [], failures = [], runItems = [];
  const sync = createDouyinAutoSync({
    sessionManager: { async captureUrl(url) {
      if (capture instanceof Error) throw capture;
      return typeof capture === 'function' ? capture(url) : capture;
    } },
    channels: { getChannel: () => ({ id: 4, platform: 'douyin', profileUrl }),
      getObservation: () => observation, listObservations: () => [observation] },
    sources: { verifyCapturedIdentity: () => ({ matched }), importCapturedPage: () => ({ items: [observation] }),
      applyNoSpeechResult() {} },
    transcriber: options.transcriber,
    syncState: { markRunning() {}, markCompleted() {}, startRun: () => ({ id: 1 }),
      upsertRunItem(_id, item) { runItems.push(item); },
      markFailed(id, error) { failures.push({ id, code: error.code }); } },
    onSessionState: options.onSessionState || (state => states.push(state))
  });
  return { sync, states, failures, runItems, setCapture: value => { capture = value; },
    setMatched: value => { matched = value; }, goodCapture: capture };
}

test('explicit login loss emits a classified state and an identity-matched recovery resets it', async () => {
  const f = fixture();
  f.setCapture({ loggedIn: false, profile: {}, items: [] });
  await assert.rejects(f.sync.syncChannel(4), { code: 'DOUYIN_LOGIN_REQUIRED' });
  assert.equal(f.states[0].status, 'login_required');
  assert.equal(f.states[0].channelId, 4);
  assert.equal(f.failures[0].code, 'DOUYIN_LOGIN_REQUIRED');
  f.setCapture(f.goodCapture);
  await f.sync.syncChannel(4);
  assert.equal(f.states.at(-1).status, 'authenticated');
});

test('network failures, load-error snapshots and wrong author identities do not emit login state', async () => {
  for (const failure of [new Error('network timeout'), { loggedIn: false, loadError: true, profile: {}, items: [] }]) {
    const f = fixture(); f.setCapture(failure);
    await assert.rejects(f.sync.syncChannel(4));
    assert.deepEqual(f.states, []);
  }
  const f = fixture(); f.setMatched(false);
  await assert.rejects(f.sync.syncChannel(4), /身份/);
  assert.deepEqual(f.states, []);
});

test('native notice transport failure never changes the collection failure or its persistence', async () => {
  const f = fixture({ onSessionState() { throw new Error('private IPC unavailable'); } });
  f.setCapture({ loggedIn: false, profile: {}, items: [] });
  await assert.rejects(f.sync.syncChannel(4), { code: 'DOUYIN_LOGIN_REQUIRED' });
  assert.equal(f.failures.length, 1);
});

test('manual work capture reports login loss through the same native-notice channel', async () => {
  const f = fixture(); f.setCapture({ loggedIn: false, profile: {}, items: [] });
  await assert.rejects(f.sync.runVideo(4, 1, 'capture'), { code: 'DOUYIN_LOGIN_REQUIRED' });
  assert.equal(f.states[0].status, 'login_required');
});

test('login loss during work details is not replaced by a generic detail failure', async () => {
  const f = fixture({ pending: true });
  f.setCapture(url => url === f.goodCapture.pageUrl ? f.goodCapture : { loggedIn: false, profile: {}, items: [] });
  await assert.rejects(f.sync.syncChannel(4), { code: 'DOUYIN_LOGIN_REQUIRED' });
  assert.deepEqual(f.states.map(state => state.status), ['authenticated', 'login_required']);
  assert.equal(f.failures[0].code, 'DOUYIN_LOGIN_REQUIRED');
});

test('manual work audit preserves its actual processing outcome instead of claiming a transcript', async () => {
  const f = fixture({ transcriber: { async transcribe() { return { status: 'no_speech', transcript: '' }; } } });
  await f.sync.runVideo(4, 1, 'transcribe');
  assert.equal(f.runItems.at(-1).transcriptionStatus, 'no_speech');
});
