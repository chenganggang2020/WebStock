const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Isolate the database before any application module can initialize it.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-douyin-incremental-'));
process.env.WEBSTOCK_DB_PATH = path.join(directory, 'test.db');
const db = require('../db');
const channels = require('../services/expertChannelService');
const syncState = require('../services/douyinSyncStateService');
const { planDetailCandidates } = require('../services/douyinSyncPlanningService');

test.after(() => {
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

function createChannel(key) {
  return channels.createChannel({
    channelKey: key,
    displayName: '隔离增量回归',
    platform: 'douyin'
  });
}

function recordItem(channelId, contentId, detailStatus, transcriptionStatus, sqliteUtc) {
  const run = syncState.startRun(channelId, { trigger: 'scheduled' });
  const item = syncState.upsertRunItem(run.id, { contentId, detailStatus, transcriptionStatus });
  // Match SQLite CURRENT_TIMESTAMP's UTC representation, without mocking the state reader.
  db.prepare('UPDATE expert_sync_run_items SET updated_at = ? WHERE id = ?').run(sqliteUtc, item.id);
  syncState.completeRun(run.id, {});
}

test('real SQLite completion timestamps become explicit UTC and do not immediately expire the six-hour detail TTL', () => {
  const channel = createChannel('incremental-sqlite-utc');
  const contentId = '7000000000000000001';
  recordItem(channel.id, contentId, 'complete', 'complete', '2026-09-08 02:00:00');

  const states = syncState.getPlanningState(channel.id);
  const lastCheckedAt = states[contentId].lastDetailCheckedAt;
  assert.match(lastCheckedAt, /Z$/, 'database UTC timestamps must carry a timezone outside SQLite');
  assert.equal(Date.parse(lastCheckedAt), Date.parse('2026-09-08T02:00:00.000Z'));
  const candidates = planDetailCandidates([{
    externalContentId: contentId,
    title: '未发生变化的已完成作品',
    transcript: '已完成逐字稿',
    mediaMetadata: {
      detailCapturedAt: '2026-09-08T02:00:00.000Z',
      asr: { status: 'complete' }
    }
  }], states, { now: '2026-09-08T02:10:00.000Z' });
  assert.deepEqual(candidates, [], 'ten-minute-old completed work must not be revisited as stale');
});

test('real SQLite detail failure timestamps retain their UTC instant for retry backoff', () => {
  const channel = createChannel('incremental-detail-failure-utc');
  const contentId = '7000000000000000002';
  recordItem(channel.id, contentId, 'error', 'not_ready', '2026-09-08 02:00:00');

  const state = syncState.getPlanningState(channel.id)[contentId];
  assert.equal(state.failureCount, 1);
  assert.match(state.lastFailureAt, /Z$/);
  assert.equal(Date.parse(state.lastFailureAt), Date.parse('2026-09-08T02:00:00.000Z'));
});

test('a completed detail with failed transcription exposes separate transcription retry evidence', () => {
  const channel = createChannel('incremental-transcription-failure');
  const contentId = '7000000000000000003';
  recordItem(channel.id, contentId, 'complete', 'error', '2026-09-08 02:00:00');

  const state = syncState.getPlanningState(channel.id)[contentId];
  assert.equal(state.failureCount, 0, 'a successful detail capture is not a detail failure');
  assert.equal(state.lastFailureAt, '');
  assert.equal(state.transcriptionFailureCount, 1, 'detail completion must not erase the ASR failure');
  assert.match(state.lastTranscriptionFailureAt, /Z$/);
  assert.equal(Date.parse(state.lastTranscriptionFailureAt), Date.parse('2026-09-08T02:00:00.000Z'));
});

test('consecutive transcription errors remain countable across runs whose detail stages completed', () => {
  const channel = createChannel('incremental-consecutive-transcription-errors');
  const contentId = '7000000000000000004';
  recordItem(channel.id, contentId, 'complete', 'complete', '2026-09-08 01:00:00');
  recordItem(channel.id, contentId, 'complete', 'error', '2026-09-08 02:00:00');
  recordItem(channel.id, contentId, 'complete', 'error', '2026-09-08 02:10:00');

  const state = syncState.getPlanningState(channel.id)[contentId];
  assert.equal(state.failureCount, 0);
  assert.equal(state.transcriptionFailureCount, 2);
  assert.match(state.lastTranscriptionFailureAt, /Z$/);
  assert.equal(Date.parse(state.lastTranscriptionFailureAt), Date.parse('2026-09-08T02:10:00.000Z'));
});
