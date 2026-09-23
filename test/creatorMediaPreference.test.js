const test = require('node:test');
const assert = require('node:assert/strict');

const { createDouyinAutoSync } = require('../electron/douyinAutoSync');

const VIDEO_ID = '7681478827298291601';
const NOTE_ID = '7681478827298291602';
const PROFILE_URL = 'https://www.douyin.com/user/media-preference-fixture';

function completedNote() {
  return {
    status: 'needs_review',
    imageCount: 1,
    pages: [{ index: 1, status: 'recognized', localAssetPath: 'fixture/note-1.jpg', text: '原图文字' }]
  };
}

// Only storage, browser, OCR and ASR boundaries are in memory. The real sync and
// queue-planning implementations decide which works get processed and reported.
function createFixture(collectionMediaType, options = {}) {
  const channel = { id: 5, displayName: '图文作者', platform: 'douyin', profileUrl: PROFILE_URL };
  if (collectionMediaType !== undefined) channel.collectionMediaType = collectionMediaType;
  const observations = new Map([
    [VIDEO_ID, {
      id: 51, externalKey: 'fixture-video', externalContentId: VIDEO_ID,
      sourceUrl: 'https://www.douyin.com/video/' + VIDEO_ID,
      title: '作者的视频', mediaType: 'video', evidenceLevel: 'primary',
      publishedAt: '2026-09-20T03:00:00.000Z', transcript: '',
      mediaMetadata: { incrementalPending: true, incrementalReason: 'new' }
    }],
    [NOTE_ID, {
      id: 52, externalKey: 'fixture-note', externalContentId: NOTE_ID,
      sourceUrl: 'https://www.douyin.com/note/' + NOTE_ID,
      title: '作者的图文', mediaType: 'note', evidenceLevel: 'primary',
      publishedAt: '2026-09-20T02:00:00.000Z', content: '',
      mediaMetadata: { incrementalPending: true, incrementalReason: 'new' }
    }]
  ]);
  if (options.noteComplete) {
    Object.assign(observations.get(NOTE_ID), { content: '已保存的图文原文' });
    Object.assign(observations.get(NOTE_ID).mediaMetadata, {
      detailCapturedAt: '2026-09-20T04:00:00.000Z',
      note: completedNote(), incrementalPending: false
    });
  }
  const visibleIds = options.visibleIds || [VIDEO_ID, NOTE_ID];
  const openedDetails = [];
  const ocrInputs = [];
  const asrInputs = [];
  const mediaArchiveInputs = [];
  const completedRuns = [];
  const failedRuns = [];
  function captureItem(observation) {
    return {
      contentId: observation.externalContentId,
      sourceUrl: observation.sourceUrl,
      title: observation.title,
      mediaType: observation.mediaType,
      publishedAt: observation.publishedAt
    };
  }
  function profileCapture() {
    return {
      pageType: 'profile', pageUrl: PROFILE_URL, loggedIn: true,
      profile: { displayName: channel.displayName, profileUrl: PROFILE_URL, workCount: observations.size },
      items: visibleIds.map(id => captureItem(observations.get(id))),
      archive: { complete: true, discoveredCount: visibleIds.length, reportedWorkCount: observations.size }
    };
  }
  const sync = createDouyinAutoSync({
    sessionManager: {
      async captureProfileRecent() { return profileCapture(); },
      async captureProfileArchive() { return profileCapture(); },
      async captureUrl(url) {
        const observation = Array.from(observations.values()).find(item => item.sourceUrl === url);
        assert.ok(observation, 'capture must refer to a known fixture work');
        openedDetails.push(observation.externalContentId);
        const item = Object.assign(captureItem(observation), {
          summary: '作者作品详情',
          // A note may have background music; that must never become a video ASR job.
          mediaUrl: 'https://v3-dy-o.zjcdn.com/fixture/' + observation.externalContentId + '.mp4'
        });
        if (observation.mediaType === 'note') {
          item.imageCount = 1;
          item.images = [{ index: 1, url: 'https://p3-sign.douyinpic.com/fixture/page-1.jpg' }];
        }
        return {
          pageType: observation.mediaType, pageUrl: url, loggedIn: true,
          profile: { displayName: channel.displayName, profileUrl: PROFILE_URL }, items: [item]
        };
      }
    },
    channels: {
      getChannel() { return channel; },
      listCollectionObservations() { return Array.from(observations.values()).map(item => structuredClone(item)); },
      recordObservation(_channelId, input) {
        const saved = Array.from(observations.values()).find(item => item.externalKey === input.externalKey);
        if (saved && input.mediaMetadata) saved.mediaMetadata = structuredClone(input.mediaMetadata);
      }
    },
    sources: {
      reanalyzeChannelObservations() { return { updatedCount: 0 }; },
      verifyCapturedIdentity() { return { matched: true }; },
      importCapturedPage(_channelId, capture) {
        const items = capture.items.map(item => {
          const saved = observations.get(item.contentId);
          if (capture.pageType !== 'profile') {
            saved.summary = item.summary;
            saved.mediaMetadata.detailCapturedAt = '2026-09-21T01:00:00.000Z';
          }
          return structuredClone(saved);
        });
        return { addedCount: 0, updatedCount: 0, unchangedCount: items.length, items };
      },
      applyNoteResult(_channelId, id, result) {
        const saved = observations.get(id);
        saved.content = result.pages.map(page => page.text).join('\n');
        saved.mediaMetadata.note = structuredClone(result);
      },
      applyTranscription(_channelId, id, result) {
        const saved = observations.get(id);
        saved.transcript = result.transcript;
        saved.localAssetPath = result.localAssetPath;
        saved.mediaMetadata.asr = structuredClone(result);
      }
    },
    noteProcessor: {
      async process(input) { ocrInputs.push(input.contentId); return completedNote(); }
    },
    transcriber: {
      async transcribe(input) {
        asrInputs.push(input.contentId);
        return { status: 'complete', transcript: '已保存的视频逐字稿', localAssetPath: 'fixture/video.mp4' };
      },
      async archive(input) { mediaArchiveInputs.push(input.contentId); throw new Error('unexpected archive backfill'); }
    },
    syncState: {
      markRunning() {},
      markCompleted(_id, result) { completedRuns.push(result); },
      markFailed(_id, error) { failedRuns.push(error.message); },
      getJob() { return { lastResult: {} }; },
      getPlanningState() { return {}; }
    },
    maxDetailsPerRun: 8,
    maxTranscriptionsPerRun: 5
  });
  return { sync, channel, observations, openedDetails, ocrInputs, asrInputs,
    mediaArchiveInputs, completedRuns, failedRuns };
}

for (const mode of ['incremental', 'archive']) {
  test(mode + ' collection honors note-only preference and never downloads or transcribes videos', async () => {
    const fixture = createFixture('note');
    const result = await fixture.sync.syncChannel(5, { mode, trigger: 'manual' });

    assert.deepEqual(fixture.openedDetails, [NOTE_ID]);
    assert.equal(result.candidateCount, 1);
    assert.deepEqual(fixture.ocrInputs, [NOTE_ID]);
    assert.deepEqual(fixture.asrInputs, []);
    assert.deepEqual(fixture.mediaArchiveInputs, []);
    assert.equal(result.transcriptionAttemptedCount, 0);
    assert.equal(fixture.observations.size, 2, 'changing collection preference must not delete historical works');
    assert.equal(fixture.observations.get(VIDEO_ID).title, '作者的视频');
    assert.deepEqual(fixture.failedRuns, []);
  });

  test(mode + ' collection honors video-only preference without OCR of historical notes', async () => {
    const fixture = createFixture('video');
    const result = await fixture.sync.syncChannel(5, { mode, trigger: 'manual' });

    assert.deepEqual(fixture.openedDetails, [VIDEO_ID]);
    assert.equal(result.candidateCount, 1);
    assert.deepEqual(fixture.asrInputs, [VIDEO_ID]);
    assert.deepEqual(fixture.ocrInputs, []);
    assert.equal(fixture.observations.size, 2);
    assert.equal(fixture.observations.get(NOTE_ID).title, '作者的图文');
  });
}

for (const preference of [undefined, 'all']) {
  test('collection preference ' + String(preference) + ' preserves both video and note collection', async () => {
    const fixture = createFixture(preference);
    const result = await fixture.sync.syncChannel(5, { mode: 'archive', trigger: 'manual' });

    assert.deepEqual(fixture.openedDetails.slice().sort(), [VIDEO_ID, NOTE_ID].sort());
    assert.equal(result.candidateCount, 2);
    assert.deepEqual(fixture.asrInputs, [VIDEO_ID]);
    assert.deepEqual(fixture.ocrInputs, [NOTE_ID]);
    assert.equal(result.archiveQueue.after.completedCount, 2);
    assert.equal(result.archiveQueue.after.pendingCount, 0);
  });
}

test('note-only archive completion is scoped to selected media despite unfinished historical videos', async () => {
  const fixture = createFixture('note', { noteComplete: true });
  const result = await fixture.sync.syncChannel(5, { mode: 'archive', trigger: 'manual' });

  assert.equal(result.archiveQueue.before.videoCount, 0);
  assert.equal(result.archiveQueue.before.pendingCount, 0);
  assert.equal(result.archiveQueue.after.videoCount, 0);
  assert.equal(result.archiveQueue.after.noteCompletedCount, 1);
  assert.equal(result.archiveQueue.after.completedCount, 1);
  assert.equal(result.archiveQueue.after.pendingCount, 0);
  assert.equal(result.archiveQueue.after.completionRate, 1);
  assert.equal(result.candidateCount, 0);
  assert.deepEqual(fixture.openedDetails, []);
  assert.equal(fixture.observations.get(VIDEO_ID).transcript, '');
});

test('note-only preference also excludes old videos absent from the current profile scan', async () => {
  const fixture = createFixture('note', { visibleIds: [NOTE_ID] });
  const result = await fixture.sync.syncChannel(5, { mode: 'archive', trigger: 'manual' });

  assert.deepEqual(fixture.openedDetails, [NOTE_ID]);
  assert.equal(result.archiveQueue.after.videoCount, 0);
  assert.equal(result.archiveQueue.after.noteCompletedCount, 1);
  assert.equal(fixture.observations.size, 2);
});

test('archiveQueue.after counts only requested media after a successful note collection', async () => {
  const fixture = createFixture('note');
  const result = await fixture.sync.syncChannel(5, { mode: 'archive', trigger: 'manual' });

  assert.equal(result.archiveQueue.after.videoCount, 0);
  assert.equal(result.archiveQueue.after.workCount, 1);
  assert.equal(result.archiveQueue.after.noteCompletedCount, 1);
  assert.equal(result.archiveQueue.after.completedCount, 1);
  assert.equal(result.archiveQueue.after.pendingCount, 0);
  assert.equal(result.archiveQueue.after.completionRate, 1);
});

test('a profile scan with no preferred works completes without processing the other media type', async () => {
  const fixture = createFixture('note', { noteComplete: true, visibleIds: [VIDEO_ID] });
  const result = await fixture.sync.syncChannel(5, { mode: 'incremental', trigger: 'manual' });

  assert.equal(result.candidateCount, 0);
  assert.deepEqual(fixture.openedDetails, []);
  assert.equal(fixture.completedRuns.length, 1);
  assert.deepEqual(fixture.failedRuns, []);
  assert.equal(fixture.observations.get(NOTE_ID).content, '已保存的图文原文');
});
