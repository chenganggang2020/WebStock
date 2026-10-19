const test = require('node:test');
const assert = require('node:assert/strict');
process.env.WEBSTOCK_DB_PATH = ':memory:';
const db = require('../db');
const channels = require('../services/expertChannelService');
const sync = require('../services/douyinSyncStateService');
const app = require('../server');
test.after(() => db.close());

function channel(key) {
  return channels.createChannel({ channelKey: key, displayName: key, platform: 'douyin' });
}
function runAt(id, time, contentId) {
  const run = sync.startRun(id, { trigger: 'manual' });
  sync.completeRun(run.id);
  db.prepare('UPDATE expert_sync_runs SET started_at=? WHERE id=?').run(time, run.id);
  if (contentId) sync.upsertRunItem(run.id, { contentId, title: contentId });
  return run.id;
}

test('task dates use Beijing start date, independent from video publish or completion date', () => {
  const owner = channel('date-boundaries');
  runAt(owner.id, '2026-09-09T15:59:59Z', 'previous-day');
  const midnight = runAt(owner.id, '2026-09-09T16:00:00Z', 'older-video-processed-today');
  const evening = runAt(owner.id, '2026-09-10T15:59:59Z', 'same-day');
  runAt(owner.id, '2026-09-10T16:00:00Z', 'next-day');
  const rows = sync.listRuns(owner.id, { date: '2026-09-10', includeItems: true });
  assert.deepEqual(rows.map(r => r.id), [evening, midnight]);
  assert.deepEqual(rows[1].items.map(i => i.contentId), ['older-video-processed-today']);
});

test('date filtering happens before limit and never includes another author or all historical videos', () => {
  const owner = channel('date-filter-before-limit');
  const other = channel('date-other-author');
  const selected = runAt(owner.id, '2026-09-09T18:00:00Z', 'selected');
  for (let i = 0; i < 8; i++) runAt(owner.id, '2026-09-11T00:00:00Z', 'newer-' + i);
  runAt(other.id, '2026-09-09T18:00:00Z', 'other-author');
  assert.deepEqual(sync.listRuns(owner.id, { date: '2026-09-10', limit: 1 }).map(r => r.id), [selected]);
  assert.deepEqual(sync.listRuns(owner.id, { date: '2026-09-08' }), []);
  const empty = runAt(owner.id, '2026-09-12T00:00:00Z');
  assert.deepEqual(sync.listRuns(owner.id, { date: '2026-09-12', includeItems: true })[0].items, []);
  assert.ok(empty);
});

test('invalid date filters are rejected rather than silently returning every run', () => {
  const owner = channel('date-validation');
  for (const date of ['2026-02-30', '2026-9-10', 'garbage', ['2026-09-10']]) {
    assert.throws(() => sync.listRuns(owner.id, { date }), /日期/);
  }
});

test('HTTP run date filter is forwarded and invalid dates return 400', async () => {
  const owner = channel('date-http');
  const today = runAt(owner.id, '2026-09-09T16:00:00Z', 'today');
  runAt(owner.id, '2026-09-10T16:00:00Z', 'tomorrow');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = 'http://127.0.0.1:' + server.address().port + '/api/expert/channels/' + owner.id + '/sync/runs';
  try {
    const response = await fetch(url + '?date=2026-09-10');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual((await response.json()).data.map(r => r.id), [today]);
    assert.equal((await fetch(url + '?date=2026-02-30')).status, 400);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
