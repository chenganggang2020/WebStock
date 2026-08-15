const test = require('node:test');
const assert = require('node:assert/strict');

const {
  materialFingerprint,
  materiallyEquivalent,
  planDetailCandidates,
  summarizeDiscovery
} = require('../services/douyinSyncPlanningService');

test('material fingerprint ignores capture timestamps and expiring media URLs', () => {
  const before = {
    externalContentId: '1001',
    title: '储能行业观察',
    publishedAt: '2026-08-01T00:00:00.000Z',
    description: '需求仍在增长',
    transcript: '先看需求，再看供给。',
    lastSeenAt: '2026-08-10T00:00:00.000Z',
    engagement: { likes: 120, comments: 8, observedAt: '2026-08-10T00:00:00.000Z', delta: { likes: 2 } },
    mediaMetadata: {
      durationSeconds: 73,
      detailCapturedAt: '2026-08-10T00:00:00.000Z',
      observedAt: '2026-08-10T00:00:00.000Z',
      mediaUrl: 'https://example.test/video.mp4?token=old&expires=1',
      coverUrl: 'https://example.test/cover.jpg?x-sign=old'
    }
  };
  const after = {
    ...before,
    lastSeenAt: '2026-08-11T00:00:00.000Z',
    engagement: { likes: 120, comments: 8, observedAt: '2026-08-11T00:00:00.000Z', delta: {} },
    mediaMetadata: {
      ...before.mediaMetadata,
      detailCapturedAt: '2026-08-11T00:00:00.000Z',
      observedAt: '2026-08-11T00:00:00.000Z',
      mediaUrl: 'https://example.test/video.mp4?token=new&expires=2',
      coverUrl: 'https://example.test/cover.jpg?x-sign=new'
    }
  };

  assert.equal(materialFingerprint(before), materialFingerprint(after));
  assert.equal(materiallyEquivalent(before, after), true);
});

test('material fingerprint changes when the visible body changes', () => {
  const before = { externalContentId: '1001', title: '行业观察', description: '需求增长' };
  const after = { ...before, description: '需求放缓' };

  assert.notEqual(materialFingerprint(before), materialFingerprint(after));
  assert.equal(materiallyEquivalent(before, after), false);
});

test('material fingerprint includes stable engagement and transcript segment text', () => {
  const before = {
    externalContentId: '1001',
    engagement: { likes: 120 },
    mediaMetadata: { asr: { segments: [{ start: 0, end: 2, text: '关注现金流' }], attemptedAt: '2026-08-10' } }
  };
  const after = {
    externalContentId: '1001',
    engagement: { likes: 121 },
    mediaMetadata: { asr: { segments: [{ start: 0, end: 2, text: '关注利润率' }], attemptedAt: '2026-08-11' } }
  };

  assert.notEqual(materialFingerprint(before), materialFingerprint(after));
});

test('discovery summary separates added, materially updated, and unchanged records', () => {
  const previous = [
    { externalContentId: '1', title: '旧标题', description: '原正文' },
    { externalContentId: '2', title: '保持不变', lastSeenAt: '2026-08-10T00:00:00Z' }
  ];
  const current = [
    { contentId: '2', title: '保持不变', lastSeenAt: '2026-08-11T00:00:00Z' },
    { contentId: '1', title: '旧标题', description: '正文已修订' },
    { contentId: '3', title: '新作品' }
  ];

  const summary = summarizeDiscovery(previous, current);

  assert.equal(summary.addedCount, 1);
  assert.equal(summary.updatedCount, 1);
  assert.equal(summary.unchangedCount, 1);
  assert.deepEqual(summary.added.map(item => item.contentId), ['3']);
  assert.deepEqual(summary.updated.map(item => item.contentId), ['1']);
  assert.deepEqual(summary.unchanged.map(item => item.contentId), ['2']);
});

test('detail planner prioritizes new discoveries and rotates stale records by oldest check', () => {
  const observations = [
    { externalContentId: 'new', title: '新发现' },
    { externalContentId: 'recent', title: '刚检查' },
    { externalContentId: 'old-a', title: '最久未检查' },
    { externalContentId: 'old-b', title: '次久未检查' }
  ];
  const state = {
    recent: { lastDetailCheckedAt: '2026-08-11T11:30:00.000Z' },
    'old-a': { lastDetailCheckedAt: '2026-08-01T00:00:00.000Z' },
    'old-b': { lastDetailCheckedAt: '2026-08-02T00:00:00.000Z' }
  };

  const planned = planDetailCandidates(observations, state, {
    now: '2026-08-11T12:00:00.000Z',
    limit: 3,
    recentTtlMs: 6 * 60 * 60 * 1000
  });

  assert.deepEqual(planned.map(item => item.contentId), ['new', 'old-a', 'old-b']);
  assert.deepEqual(planned.map(item => item.reason), ['new', 'stale', 'stale']);
});

test('failed record observes exponential backoff and cannot starve other historical records', () => {
  const observations = [
    { externalContentId: 'failed', title: '连续失败' },
    { externalContentId: 'history-a', title: '历史 A' },
    { externalContentId: 'history-b', title: '历史 B' }
  ];
  const state = {
    failed: {
      lastDetailCheckedAt: '2026-08-01T00:00:00.000Z',
      lastFailureAt: '2026-08-11T11:30:00.000Z',
      failureCount: 3
    },
    'history-a': { lastDetailCheckedAt: '2026-08-02T00:00:00.000Z' },
    'history-b': { lastDetailCheckedAt: '2026-08-03T00:00:00.000Z' }
  };

  const planned = planDetailCandidates(observations, state, {
    now: '2026-08-11T12:00:00.000Z',
    limit: 2,
    recentTtlMs: 60 * 60 * 1000,
    retryBaseMs: 30 * 60 * 1000
  });

  assert.deepEqual(planned.map(item => item.contentId), ['history-a', 'history-b']);
});

test('due failed record joins fair rotation instead of jumping ahead forever', () => {
  const observations = [
    { externalContentId: 'failed' },
    { externalContentId: 'older' },
    { externalContentId: 'newer' }
  ];
  const state = {
    failed: {
      lastDetailCheckedAt: '2026-08-04T00:00:00.000Z',
      lastFailureAt: '2026-08-10T00:00:00.000Z',
      failureCount: 1
    },
    older: { lastDetailCheckedAt: '2026-08-01T00:00:00.000Z' },
    newer: { lastDetailCheckedAt: '2026-08-03T00:00:00.000Z' }
  };

  const planned = planDetailCandidates(observations, state, {
    now: '2026-08-11T12:00:00.000Z',
    limit: 2,
    recentTtlMs: 60 * 60 * 1000,
    retryBaseMs: 30 * 60 * 1000
  });

  assert.deepEqual(planned.map(item => item.contentId), ['older', 'newer']);
});

test('transcription-pending records remain eligible without filling the entire queue', () => {
  const observations = [
    { externalContentId: 'asr-a', mediaMetadata: { detailCapturedAt: '2026-07-01', asr: { status: 'media_missing' } } },
    { externalContentId: 'asr-b', mediaMetadata: { detailCapturedAt: '2026-07-02', asr: { status: 'error' } } },
    { externalContentId: 'stale-a', transcript: '已有逐字稿', mediaMetadata: { asr: { status: 'complete' } } },
    { externalContentId: 'stale-b', transcript: '已有逐字稿', mediaMetadata: { asr: { status: 'complete' } } }
  ];
  const state = {
    'asr-a': { lastDetailCheckedAt: '2026-08-01T00:00:00.000Z' },
    'asr-b': { lastDetailCheckedAt: '2026-08-02T00:00:00.000Z' },
    'stale-a': { lastDetailCheckedAt: '2026-08-03T00:00:00.000Z' },
    'stale-b': { lastDetailCheckedAt: '2026-08-04T00:00:00.000Z' }
  };

  const planned = planDetailCandidates(observations, state, {
    now: '2026-08-11T12:00:00.000Z',
    limit: 3,
    recentTtlMs: 60 * 60 * 1000,
    maxTranscriptionPending: 1
  });

  assert.equal(planned.filter(item => item.reason === 'transcription_pending').length, 1);
  assert.equal(planned.length, 3);
  assert.equal(planned.some(item => item.contentId === 'stale-a'), true);
  assert.equal(planned.some(item => item.contentId === 'stale-b'), true);
});

test('detail planner honors an explicit zero TTL for a complete archive pass', () => {
  const planned = planDetailCandidates([{
    externalContentId: 'archive-refresh',
    mediaMetadata: { detailCapturedAt: '2026-08-11T11:59:00.000Z', asr: { status: 'complete' } },
    transcript: '已完成逐字稿'
  }], {}, {
    now: '2026-08-11T12:00:00.000Z',
    limit: 1,
    recentTtlMs: 0
  });

  assert.equal(planned.length, 1);
  assert.equal(planned[0].reason, 'stale');
});

test('complete archive pass prioritizes historical transcripts missing their media archive', () => {
  const planned = planDetailCandidates([
    { externalContentId: 'new-video', title: '新作品' },
    {
      externalContentId: 'historical-asr',
      transcript: '已经存在的逐字稿',
      archiveStatus: 'linked',
      localAssetPath: '',
      mediaMetadata: {
        detailCapturedAt: '2026-08-11T01:00:00.000Z',
        asr: { status: 'complete', mediaSha256: 'a'.repeat(64) }
      }
    },
    {
      externalContentId: 'already-archived',
      transcript: '已经归档',
      archiveStatus: 'downloaded',
      localAssetPath: 'D:/archive/already-archived.mp4',
      mediaMetadata: { asr: { status: 'complete', mediaSha256: 'b'.repeat(64) } }
    }
  ], {}, {
    now: '2026-08-11T12:00:00.000Z',
    limit: 2,
    recentTtlMs: 0,
    prioritizeArchivePending: true
  });

  assert.deepEqual(planned.map(item => item.contentId), ['historical-asr', 'new-video']);
  assert.deepEqual(planned.map(item => item.reason), ['archive_pending', 'new']);
});

test('scheduled sync does not retry a recently checked archive backfill every ten minutes', () => {
  const planned = planDetailCandidates([{
    externalContentId: 'historical-asr',
    transcript: '已有逐字稿',
    localAssetPath: '',
    mediaMetadata: {
      detailCapturedAt: '2026-08-11T11:55:00.000Z',
      asr: { status: 'complete', mediaSha256: 'a'.repeat(64) }
    }
  }], {}, {
    now: '2026-08-11T12:00:00.000Z',
    limit: 1,
    recentTtlMs: 6 * 60 * 60 * 1000
  });

  assert.deepEqual(planned, []);
});
