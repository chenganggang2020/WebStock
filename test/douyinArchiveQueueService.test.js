const test = require('node:test');
const assert = require('node:assert/strict');

const {
  planFullArchiveQueue,
  summarizeArchiveQueue
} = require('../services/douyinArchiveQueueService');

test('archive queue summary requires transcript, completed ASR, and a permanent video path', () => {
  const completeAsr = { status: 'complete', mediaSha256: 'a'.repeat(64) };
  const summary = summarizeArchiveQueue([
    {
      externalContentId: 'top-path', mediaType: 'video', transcript: '完整逐字稿',
      localAssetPath: 'D:/media/top-path.mp4', mediaMetadata: { asr: completeAsr }
    },
    {
      externalContentId: 'archive-path', mediaType: 'video', transcript: '完整逐字稿',
      mediaMetadata: { asr: completeAsr, archive: { localAssetPath: 'D:/media/archive-path.mp4' } }
    },
    {
      externalContentId: 'asr-path', mediaType: 'video', transcript: '完整逐字稿',
      mediaMetadata: { asr: Object.assign({}, completeAsr, { localAssetPath: 'D:/media/asr-path.mp4' }) }
    },
    {
      externalContentId: 'historical-no-file', mediaType: 'video', transcript: '已有历史逐字稿',
      mediaMetadata: { asr: completeAsr }
    },
    {
      externalContentId: 'empty-transcript', mediaType: 'video', transcript: '  ',
      localAssetPath: 'D:/media/empty-transcript.mp4', mediaMetadata: { asr: completeAsr }
    },
    {
      externalContentId: 'media-missing', mediaType: 'video', transcript: '',
      mediaMetadata: { asr: { status: 'media_missing' } }
    },
    {
      externalContentId: 'asr-error', mediaType: 'video', transcript: '',
      mediaMetadata: { asr: { status: 'error' } }
    },
    {
      externalContentId: 'no-asr', mediaType: 'video', transcript: '', mediaMetadata: {}
    },
    {
      externalContentId: 'article', mediaType: 'article', transcript: '文章',
      localAssetPath: 'D:/media/article.mp4', mediaMetadata: { asr: completeAsr }
    },
    { externalContentId: 'note', mediaType: 'note', transcript: '', mediaMetadata: {} },
    { externalContentId: '', mediaType: 'video', transcript: '', mediaMetadata: {} }
  ]);

  assert.deepEqual(summary, {
    videoCount: 8,
    transcribedCount: 4,
    noSpeechCount: 0,
    unavailableCount: 0,
    archivedCount: 4,
    completedCount: 3,
    pendingCount: 5,
    archivePendingCount: 1,
    transcriptionPendingCount: 4,
    completionRate: 0.375
  });
});

test('full archive queue plans every unfinished video and ignores manual-run throttles', () => {
  const observations = [
    {
      externalContentId: 'completed', mediaType: 'video', transcript: '已完成',
      localAssetPath: 'D:/media/completed.mp4',
      mediaMetadata: { detailCapturedAt: '2026-08-11T01:00:00.000Z', asr: { status: 'complete', mediaSha256: 'a'.repeat(64) } }
    },
    {
      externalContentId: 'archive-with-hash', mediaType: 'video', transcript: '历史逐字稿',
      localAssetPath: '',
      mediaMetadata: { detailCapturedAt: '2026-08-11T02:00:00.000Z', asr: { status: 'complete', mediaSha256: 'b'.repeat(64) } }
    },
    {
      externalContentId: 'archive-without-hash', mediaType: 'video', transcript: '历史逐字稿',
      localAssetPath: '',
      mediaMetadata: { detailCapturedAt: '2026-08-11T03:00:00.000Z', asr: { status: 'complete' } }
    },
    {
      externalContentId: 'new-video', mediaType: 'video', transcript: '', mediaMetadata: {}
    },
    {
      externalContentId: 'media-missing', mediaType: 'video', transcript: '',
      mediaMetadata: { detailCapturedAt: '2026-08-11T04:00:00.000Z', asr: { status: 'media_missing' } }
    },
    {
      externalContentId: 'failed-recently', mediaType: 'video', transcript: '',
      mediaMetadata: { detailCapturedAt: '2026-08-11T05:00:00.000Z', asr: { status: 'error' } }
    },
    {
      externalContentId: 'empty-transcript', mediaType: 'video', transcript: '',
      localAssetPath: 'D:/media/empty-transcript.mp4',
      mediaMetadata: { detailCapturedAt: '2026-08-11T06:00:00.000Z', asr: { status: 'complete' } }
    },
    { externalContentId: 'article', mediaType: 'article', transcript: '', mediaMetadata: {} }
  ];
  const state = {
    'failed-recently': {
      failureCount: 5,
      lastFailureAt: '2026-08-11T11:59:59.900Z',
      lastDetailCheckedAt: '2026-08-11T05:00:00.000Z'
    }
  };

  const planned = planFullArchiveQueue(observations, state, {
    now: '2026-08-11T12:00:00.000Z'
  });

  assert.equal(planned.length, 6);
  assert.deepEqual(planned.slice(0, 2).map(item => item.contentId), [
    'archive-with-hash', 'archive-without-hash'
  ]);
  assert.deepEqual(planned.slice(0, 2).map(item => item.reason), [
    'archive_pending', 'archive_pending'
  ]);
  assert.ok(planned.some(item => item.contentId === 'new-video' && item.reason === 'new'));
  assert.ok(planned.some(item => item.contentId === 'media-missing' && item.reason === 'transcription_pending'));
  assert.ok(planned.some(item => item.contentId === 'failed-recently' && item.reason === 'transcription_pending'));
  assert.ok(planned.some(item => item.contentId === 'empty-transcript' && item.reason === 'transcription_pending'));
  assert.equal(planned.some(item => item.contentId === 'completed'), false);
  assert.equal(planned.some(item => item.contentId === 'article'), false);
});

test('full archive queue applies an explicit limit after archive-pending priority', () => {
  const observations = [
    {
      externalContentId: 'new-video', mediaType: 'video', transcript: '', mediaMetadata: {}
    },
    {
      externalContentId: 'archive-a', mediaType: 'video', transcript: '历史逐字稿',
      mediaMetadata: { detailCapturedAt: '2026-08-11T02:00:00.000Z', asr: { status: 'complete', mediaSha256: 'a'.repeat(64) } }
    },
    {
      externalContentId: 'archive-b', mediaType: 'video', transcript: '历史逐字稿',
      mediaMetadata: { detailCapturedAt: '2026-08-11T03:00:00.000Z', asr: { status: 'complete' } }
    },
    {
      externalContentId: 'pending', mediaType: 'video', transcript: '',
      mediaMetadata: { detailCapturedAt: '2026-08-11T04:00:00.000Z', asr: { status: 'media_missing' } }
    }
  ];

  const planned = planFullArchiveQueue(observations, {}, {
    now: '2026-08-11T12:00:00.000Z',
    limit: 2
  });

  assert.deepEqual(planned.map(item => item.contentId), ['archive-a', 'archive-b']);
});

test('archive queue excludes commentary pollution and validates identity for explicit primary evidence', () => {
  const observations = [
    {
      externalContentId: '', externalKey: 'ai-research-commentary-7533142185677114684',
      mediaType: 'video', evidenceLevel: 'commentary', transcript: 'third-party commentary',
      mediaMetadata: {}
    },
    {
      externalContentId: 'synthetic-primary-key', mediaType: 'video', evidenceLevel: 'primary',
      transcript: 'not a verified Douyin work', mediaMetadata: {}
    },
    {
      externalContentId: '7533142185677114684', mediaType: 'video', evidenceLevel: 'secondary_quote',
      transcript: 'quoted by another source', mediaMetadata: {}
    },
    {
      externalContentId: '7641362696420887025', mediaType: 'video', evidenceLevel: 'archive',
      transcript: 'archive metadata', mediaMetadata: {}
    },
    {
      externalContentId: '7671834569137647601', mediaType: 'video', evidenceLevel: 'primary',
      transcript: '', mediaMetadata: {}
    },
    {
      externalContentId: '', contentId: '', externalKey: 'captured-video', mediaType: 'video',
      evidenceLevel: 'primary', sourceUrl: 'https://www.douyin.com/video/7672552250465095499?from=profile',
      transcript: '', mediaMetadata: {}
    },
    {
      externalContentId: 'legacy-video-fixture', mediaType: 'video', transcript: '', mediaMetadata: {}
    }
  ];

  const summary = summarizeArchiveQueue(observations);
  const planned = planFullArchiveQueue(observations);

  assert.equal(summary.videoCount, 3);
  assert.equal(summary.pendingCount, 3);
  assert.deepEqual(planned.map(item => item.contentId).sort(), [
    '7671834569137647601', '7672552250465095499', 'legacy-video-fixture'
  ].sort());
});

test('a permanently archived no-speech video is complete and is not queued forever', () => {
  const observation = {
    externalContentId: '7930000000000000004', mediaType: 'video', transcript: '',
    localAssetPath: 'D:/archive/7930000000000000004.mp4',
    mediaMetadata: {
      asr: { status: 'no_speech', mediaSha256: 'd'.repeat(64) },
      archive: { status: 'complete', localAssetPath: 'D:/archive/7930000000000000004.mp4' }
    }
  };

  const summary = summarizeArchiveQueue([observation]);
  const planned = planFullArchiveQueue([observation]);

  assert.equal(summary.completedCount, 1);
  assert.equal(summary.transcribedCount, 0);
  assert.equal(summary.noSpeechCount, 1);
  assert.equal(summary.pendingCount, 0);
  assert.deepEqual(planned, []);
});

test('an identity-rejected remote detail is preserved but excluded from repeated full runs', () => {
  const observation = {
    externalContentId: '7930000000000000005', mediaType: 'video', evidenceLevel: 'primary',
    availabilityStatus: 'unavailable', transcript: '', localAssetPath: '',
    mediaMetadata: {
      remote: { status: 'identity_rejected', checkedAt: '2026-08-12T05:00:00.000Z' }
    }
  };

  const summary = summarizeArchiveQueue([observation]);
  const planned = planFullArchiveQueue([observation]);

  assert.equal(summary.unavailableCount, 1);
  assert.equal(summary.pendingCount, 0);
  assert.equal(summary.transcriptionPendingCount, 0);
  assert.deepEqual(planned, []);
});
