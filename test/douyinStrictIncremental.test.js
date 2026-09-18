const test = require('node:test');
const assert = require('node:assert/strict');
const { planIncrementalCandidates } = require('../services/douyinSyncPlanningService');
const now = '2026-09-08T02:10:00Z';
test('new discoveries take the limited detail slots before old transcription retries', () => {
  const retry = item('old-retry', true);
  const fresh = { externalContentId: 'fresh', mediaMetadata: { incrementalPending: true, incrementalReason: 'new' } };
  assert.equal(planIncrementalCandidates([retry, fresh], {}, { now, limit: 1 })[0].contentId, 'fresh');
});
test('latest dated discoveries beat old newly discovered history when detail slots are limited', () => {
  const older = { externalContentId: 'old-first-seen-today', publishedAt: '2026-08-01T02:00:00Z',
    mediaMetadata: { incrementalPending: true, incrementalReason: 'new' } };
  const latest = { externalContentId: 'today', publishedAt: '2026-09-08T02:00:00Z',
    mediaMetadata: { incrementalPending: true, incrementalReason: 'new' } };
  const unknown = { externalContentId: 'unknown-date', mediaMetadata: { incrementalPending: true } };
  const rows = planIncrementalCandidates([older, unknown, latest], {}, { now, limit: 2 });
  assert.deepEqual(rows.map(row => row.contentId), ['today', 'old-first-seen-today']);
});
function item(id, pending, asr = 'error') {
  return { externalContentId: id, mediaMetadata: { incrementalPending: pending,
    detailCapturedAt: '2026-09-08T02:00:00Z', asr: { status: asr } } };
}
test('strict incrementality excludes historical stale and unmarked unfinished videos', () => {
  assert.deepEqual(planIncrementalCandidates([item('old', false), item('legacy', undefined)], {}, { now }), []);
});
test('transcription retry has independent backoff and a bounded retry count', () => {
  const observation = item('new', true);
  assert.equal(planIncrementalCandidates([observation], { new: {
    transcriptionFailureCount: 1, lastTranscriptionFailureAt: '2026-09-08T02:00:00Z'
  } }, { now }).length, 0);
  assert.equal(planIncrementalCandidates([observation], { new: {
    transcriptionFailureCount: 5, lastTranscriptionFailureAt: '2026-09-01T02:00:00Z'
  } }, { now }).length, 0);
  assert.equal(planIncrementalCandidates([observation], {}, { now }).length, 1);
});
test('no-speech is terminal for automatic work', () => {
  assert.equal(planIncrementalCandidates([item('silent', true, 'no_speech')], {}, { now }).length, 0);
});

test('a completion flag without saved transcript cannot silently end pending work', () => {
  assert.equal(planIncrementalCandidates([item('missing', true, 'complete')], {}, { now }).length, 1);
});
