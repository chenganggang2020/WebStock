const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createDouyinAutoSync,
  ensureDouyinSyncJobs,
  isDouyinDetailCandidate,
  observationNeedsTranscription,
  summarizeObservationCoverage,
  planArchiveMediaUrls
} = require('../electron/douyinAutoSync');

test('detail queue accepts only direct Douyin works with matching numeric ids', () => {
  assert.equal(isDouyinDetailCandidate({
    externalContentId: '7674168772814676657',
    sourceUrl: 'https://www.douyin.com/video/7674168772814676657'
  }), true);
  assert.equal(isDouyinDetailCandidate({
    externalContentId: '7641362696420887025',
    sourceUrl: 'https://jingxuan.douyin.com/m/video/7641362696420887025'
  }), true);
  assert.equal(isDouyinDetailCandidate({
    externalContentId: 'douyin:22f8d0d09280a1025063c7cd13c9497b',
    sourceUrl: 'https://xueqiu.com/9437762706/393709860/411211227'
  }), false);
  assert.equal(isDouyinDetailCandidate({
    externalContentId: '7674168772814676657',
    sourceUrl: 'https://www.douyin.com/video/7674045651054929894'
  }), false);
});

test('scheduled detail planning never opens third-party historical sources', async () => {
  const profileUrl = 'https://www.douyin.com/user/direct-only';
  const contentId = '7674168772814676657';
  const sourceUrl = 'https://www.douyin.com/video/' + contentId;
  const thirdParty = {
    externalContentId: 'douyin:third-party-research',
    sourceUrl: 'https://xueqiu.com/9437762706/393709860',
    title: '第三方研究资料',
    mediaType: 'video',
    mediaMetadata: {}
  };
  const opened = [];
  const direct = { externalContentId: contentId, sourceUrl, title: '抖音直链', mediaMetadata: {} };
  const sync = createDouyinAutoSync({
    sessionManager: {
      async captureUrl(url) {
        opened.push(url);
        if (url === profileUrl) return {
          pageType: 'profile', pageUrl: profileUrl, loggedIn: true,
          profile: { displayName: '模型先生', profileUrl, workCount: 1 },
          items: [{ contentId, sourceUrl, title: '抖音直链' }]
        };
        return {
          pageType: 'video', pageUrl: sourceUrl, loggedIn: true,
          profile: { displayName: '模型先生', profileUrl },
          items: [{ contentId, sourceUrl, title: '抖音直链', summary: '详情' }]
        };
      }
    },
    channels: {
      getChannel() { return { id: 92, displayName: '模型先生', platform: 'douyin', profileUrl }; },
      listObservations() { return [direct, thirdParty]; }
    },
    sources: {
      reanalyzeChannelObservations() { return { updatedCount: 0 }; },
      verifyCapturedIdentity() { return { matched: true }; },
      importCapturedPage() {
        return { addedCount: 0, updatedCount: 0, unchangedCount: 1, items: [direct] };
      },
      recordTranscriptionUnavailable() {}
    },
    syncState: { markRunning() {}, markCompleted() {}, markFailed() {} },
    maxDetailsPerRun: 8
  });

  const result = await sync.syncChannel(92, { trigger: 'scheduled' });

  assert.deepEqual(opened, [profileUrl, sourceUrl]);
  assert.equal(result.candidateCount, 1);
});

test('completed ASR without a persisted transcript is still queued for transcription', () => {
  assert.equal(observationNeedsTranscription({
    transcript: '',
    localAssetPath: 'D:\\archive\\missing-transcript.mp4',
    mediaMetadata: {
      asr: { status: 'complete', localAssetPath: 'D:\\archive\\missing-transcript.mp4' }
    }
  }), true);
  assert.equal(observationNeedsTranscription({
    transcript: 'persisted transcript',
    mediaMetadata: { asr: { status: 'complete' } }
  }), false);
});

test('a permanently archived no-speech video is not repeatedly queued for transcription', () => {
  assert.equal(observationNeedsTranscription({
    transcript: '',
    localAssetPath: 'D:\\archive\\quiet.mp4',
    mediaMetadata: { asr: { status: 'no_speech' } }
  }), false);
});

test('coverage excludes identity-rejected details from pending transcription', () => {
  const summary = summarizeObservationCoverage([{
    externalContentId: '7930000000000000008', mediaType: 'video', transcript: '',
    mediaMetadata: { remote: { status: 'identity_rejected' } }
  }, {
    externalContentId: '7930000000000000009', mediaType: 'note', transcript: '', mediaMetadata: {}
  }, {
    externalContentId: '7930000000000000010', mediaType: 'video', evidenceLevel: 'commentary',
    transcript: '', mediaMetadata: {}
  }]);

  assert.equal(summary.videoCount, 1);
  assert.equal(summary.unavailableCount, 1);
  assert.equal(summary.pendingTranscriptionCount, 0);
});

test('automatic sync stores an empty ASR result as no-speech instead of an error', async () => {
  const profileUrl = 'https://www.douyin.com/user/no-speech-auto-sync';
  const contentId = '7940000000000000001';
  const sourceUrl = 'https://www.douyin.com/video/' + contentId;
  const observation = {
    externalContentId: contentId, sourceUrl, mediaType: 'video', evidenceLevel: 'primary',
    transcript: '', mediaMetadata: { detailCapturedAt: '2026-08-12T00:00:00.000Z' }
  };
  const stored = [];
  const errors = [];
  const sync = createDouyinAutoSync({
    sessionManager: {
      async captureProfileArchive() {
        return { pageType: 'profile', pageUrl: profileUrl, loggedIn: true,
          profile: { displayName: 'no speech creator', profileUrl, workCount: 1 },
          items: [{ contentId, sourceUrl, title: 'quiet clip' }],
          archive: { complete: true, discoveredCount: 1, reportedWorkCount: 1 } };
      },
      async captureUrl() {
        return { pageType: 'video', pageUrl: sourceUrl, loggedIn: true,
          profile: { displayName: 'no speech creator', profileUrl },
          items: [{ contentId, sourceUrl, title: 'quiet clip',
            mediaUrl: 'https://v3-dy-o.zjcdn.com/video/quiet.mp4?token=temporary' }] };
      }
    },
    channels: {
      getChannel() { return { id: 91, displayName: 'no speech creator', platform: 'douyin', profileUrl }; },
      listObservations() { return [observation]; }
    },
    sources: {
      reanalyzeChannelObservations() { return { updatedCount: 0 }; },
      verifyCapturedIdentity() { return { matched: true }; },
      importCapturedPage() { return { addedCount: 0, updatedCount: 0, unchangedCount: 1, items: [observation] }; },
      applyNoSpeechResult(_channelId, id, result) { stored.push({ id, result }); },
      applyTranscription() { throw new Error('must not invent a transcript'); },
      recordTranscriptionError(_channelId, _id, error) { errors.push(error); }
    },
    transcriber: {
      async transcribe() { return { status: 'no_speech', transcript: '', segments: [], mediaBytes: 123 }; }
    },
    syncState: { markRunning() {}, markCompleted() {}, markFailed() {}, getJob() { return { lastResult: {} }; } }
  });

  const result = await sync.syncChannel(91, { trigger: 'archive', mode: 'archive' });

  assert.equal(stored.length, 1);
  assert.equal(stored[0].id, contentId);
  assert.equal(errors.length, 0);
  assert.equal(result.transcriptErrors.length, 0);
  assert.equal(result.transcribedCount, 0);
  assert.equal(result.transcriptionAttemptedCount, 1);
});

test('scheduled archive recovery caps exact mirrors and never appends other renditions', () => {
  const candidates = [0, 1, 2, 3].map(function(index) {
    return {
      url: `https://v3-dy-o.zjcdn.com/video/exact-${index}.mp4?token=fresh`,
      bytes: 500,
      source: 'bit_rate',
      quality: '720p'
    };
  }).concat([{
    url: 'https://v3-dy-o.zjcdn.com/video/other.mp4?token=fresh',
    bytes: 501,
    source: 'download_addr',
    quality: '540p'
  }]);

  const plan = planArchiveMediaUrls(candidates, 500, { deepRecovery: false });
  const noExact = planArchiveMediaUrls([candidates[candidates.length - 1]], 500, { deepRecovery: true });

  assert.equal(plan.exactCandidateCount, 4);
  assert.deepEqual(plan.mediaUrls, candidates.slice(0, 2).map(function(candidate) { return candidate.url; }));
  assert.deepEqual(noExact.mediaUrls, []);
});

test('manual deep recovery sorts and de-duplicates at most twenty-four alternate renditions', () => {
  const exact = Array.from({ length: 15 }, function(_value, index) {
    return {
      url: `https://v3-dy-o.zjcdn.com/video/exact-${index}.mp4?token=fresh`,
      bytes: 1000,
      source: 'bit_rate',
      quality: '720p'
    };
  });
  const alternates = Array.from({ length: 30 }, function(_value, index) {
    return {
      url: `https://v3-dy-o.zjcdn.com/video/alternate-${index}.mp4?token=fresh`,
      bytes: 1001 + index,
      source: index % 2 ? 'play_addr' : 'bit_rate',
      quality: `quality-${index}`
    };
  });
  alternates.splice(5, 0, {
    url: 'https://v9-dy-o.douyinvod.com/video/duplicate-rendition.mp4?token=fresh',
    bytes: alternates[0].bytes,
    source: alternates[0].source,
    quality: alternates[0].quality
  });

  const plan = planArchiveMediaUrls(exact.concat(alternates), 1000, { deepRecovery: true });
  const fallbackUrls = plan.mediaUrls.slice(12);

  assert.equal(plan.exactCandidateCount, 15);
  assert.deepEqual(plan.mediaUrls.slice(0, 12), exact.slice(0, 12).map(function(candidate) { return candidate.url; }));
  assert.equal(fallbackUrls.length, 24);
  assert.equal(fallbackUrls[0], alternates[0].url);
  assert.equal(fallbackUrls.includes('https://v9-dy-o.douyinvod.com/video/duplicate-rendition.mp4?token=fresh'), false);
});

test('automatic sync initializes every enabled Douyin creator with a profile URL', () => {
  const ensured = [];
  const count = ensureDouyinSyncJobs({
    listChannels() {
      return [
        { id: 1, enabled: true, platform: 'douyin', profileUrl: 'https://www.douyin.com/user/one' },
        { id: 2, enabled: false, platform: 'douyin', profileUrl: 'https://www.douyin.com/user/two' },
        { id: 3, enabled: true, platform: 'book', profileUrl: 'https://example.com/book' },
        { id: 4, enabled: true, platform: 'douyin', profileUrl: '' },
        { id: 5, enabled: true, platform: 'douyin', profileUrl: 'https://www.douyin.com/user/five' }
      ];
    }
  }, {
    ensureJob(id, settings) { ensured.push([id, settings]); }
  }, { intervalMinutes: 10 });

  assert.equal(count, 2);
  assert.deepEqual(ensured, [
    [1, { enabled: true, intervalMinutes: 10 }],
    [5, { enabled: true, intervalMinutes: 10 }]
  ]);
});

test('automatic sync summarizes transcript coverage and pending work', () => {
  const summary = summarizeObservationCoverage([
    { externalContentId: '1', mediaType: 'video', transcript: '完整逐字稿', mediaMetadata: { asr: { status: 'complete' } } },
    { externalContentId: '2', mediaType: 'video', summary: '只有页面摘要', mediaMetadata: {} },
    { externalContentId: '3', mediaType: 'video', summary: '转写失败', mediaMetadata: { asr: { status: 'error' } } },
    { externalContentId: '4', mediaType: 'video', summary: '缺少媒体地址', mediaMetadata: { asr: { status: 'media_missing' } } },
    { externalContentId: '', mediaType: 'article', summary: '第三方文章' }
  ]);

  assert.deepEqual(summary, {
    videoCount: 4,
    transcribedCount: 1,
    noSpeechCount: 0,
    unavailableCount: 0,
    pendingTranscriptionCount: 2,
    mediaMissingCount: 1,
    waitingTranscriptionCount: 1,
    failedTranscriptionCount: 1,
    transcriptCoverage: 0.25
  });
});

test('automatic sync runs every enabled job without one failure blocking the queue', async () => {
  const profiles = {
    21: 'https://www.douyin.com/user/working',
    22: 'https://www.douyin.com/user/login-expired'
  };
  const itemUrl = 'https://www.douyin.com/video/7000000000000000021';
  const sync = createDouyinAutoSync({
    sessionManager: {
      async captureUrl(url) {
        if (url === profiles[22]) return { loggedIn: false, profile: {}, items: [] };
        if (url === profiles[21]) return {
          pageType: 'profile', pageUrl: url, loggedIn: true,
          profile: { displayName: '可采集作者', profileUrl: url },
          items: [{ sourceUrl: itemUrl, contentId: '7000000000000000021', title: '新视频' }]
        };
        return {
          pageType: 'video', pageUrl: itemUrl, loggedIn: true,
          profile: { displayName: '可采集作者', profileUrl: profiles[21] },
          items: [{ sourceUrl: itemUrl, contentId: '7000000000000000021', title: '新视频', summary: '已提取摘要' }]
        };
      }
    },
    channels: {
      getChannel(id) { return { id, displayName: id === 21 ? '可采集作者' : '登录失效作者', platform: 'douyin', profileUrl: profiles[id] }; },
      listObservations() { return []; }
    },
    sources: {
      reanalyzeChannelObservations() { return { updatedCount: 0 }; },
      verifyCapturedIdentity() { return { matched: true }; },
      importCapturedPage() { return { addedCount: 1, updatedCount: 0, unchangedCount: 0, items: [] }; }
    },
    syncState: {
      listEnabled() { return [{ channelId: 21 }, { channelId: 22 }]; },
      markRunning() {}, markCompleted() {}, markFailed() {}
    },
    maxDetailsPerRun: 1
  });

  const result = await sync.syncAll();
  assert.equal(result.attemptedCount, 2);
  assert.equal(result.succeededCount, 1);
  assert.equal(result.failedCount, 1);
  assert.equal(result.items[1].channelId, 22);
  assert.match(result.items[1].error, /登录/);
});

test('automatic sync discovers new videos, fills incomplete details and refreshes recent metrics', async () => {
  const calls = [];
  const imported = [];
  const reanalyzed = [];
  const states = [];
  const profileUrl = 'https://www.douyin.com/user/model-mr';
  const captures = {
    [profileUrl]: {
      pageType: 'profile', pageUrl: profileUrl, loggedIn: true,
      profile: { displayName: '模型先生', profileUrl, workCount: 368 },
      items: [
        { sourceUrl: 'https://www.douyin.com/video/1000000000000000001', contentId: '1000000000000000001', title: '完整旧视频' },
        { sourceUrl: 'https://www.douyin.com/video/1000000000000000002', contentId: '1000000000000000002', title: '新增视频' },
        { sourceUrl: 'https://www.douyin.com/video/1000000000000000003', contentId: '1000000000000000003', title: '待补详情' }
      ]
    },
    'https://www.douyin.com/video/1000000000000000001': {
      pageType: 'video', pageUrl: 'https://www.douyin.com/video/1000000000000000001', loggedIn: true,
      profile: { displayName: '模型先生', profileUrl },
      items: [{ sourceUrl: 'https://www.douyin.com/video/1000000000000000001', contentId: '1000000000000000001', title: '完整旧视频', summary: '完整摘要', engagement: { likes: 120 } }]
    },
    'https://www.douyin.com/video/1000000000000000002': {
      pageType: 'video', pageUrl: 'https://www.douyin.com/video/1000000000000000002', loggedIn: true,
      profile: { displayName: '模型先生', profileUrl },
      items: [{ sourceUrl: 'https://www.douyin.com/video/1000000000000000002', contentId: '1000000000000000002', title: '新增视频', summary: '看好先进封装。' }]
    },
    'https://www.douyin.com/video/1000000000000000003': {
      pageType: 'video', pageUrl: 'https://www.douyin.com/video/1000000000000000003', loggedIn: true,
      profile: { displayName: '模型先生', profileUrl },
      items: [{ sourceUrl: 'https://www.douyin.com/video/1000000000000000003', contentId: '1000000000000000003', title: '待补详情', transcript: '风险来自订单不及预期。' }]
    }
  };
  const sync = createDouyinAutoSync({
    sessionManager: {
      async captureUrl(url) { calls.push(url); return captures[url]; }
    },
    channels: {
      getChannel() { return { id: 1, displayName: '模型先生', platform: 'douyin', profileUrl }; },
      listObservations() {
        return [
          { externalContentId: '1000000000000000001', publishedAt: '2026-08-01T00:00:00.000Z', summary: '完整摘要', engagement: { observedAt: '2026-08-01T00:00:00.000Z' } },
          { externalContentId: '1000000000000000003', publishedAt: '', summary: '', engagement: {} }
        ];
      }
    },
    sources: {
      reanalyzeChannelObservations(channelId) { reanalyzed.push(channelId); return { updatedCount: 2 }; },
      verifyCapturedIdentity() { return { matched: true, matchType: 'profile_url' }; },
      importCapturedPage(_channelId, capture) {
        imported.push(capture);
        if (capture.pageType === 'profile') {
          return { addedCount: 0, updatedCount: 0, unchangedCount: capture.items.length, items: [] };
        }
        const contentId = capture.items[0] && capture.items[0].contentId;
        return {
          addedCount: contentId === '1000000000000000002' ? 1 : 0,
          updatedCount: contentId === '1000000000000000002' ? 0 : 1,
          unchangedCount: 0
        };
      }
    },
    syncState: {
      markRunning(id) { states.push(['running', id]); },
      markCompleted(id, result) { states.push(['completed', id, result]); return result; },
      markFailed(id, error) { states.push(['failed', id, error.message]); }
    },
    maxDetailsPerRun: 5
  });

  const result = await sync.syncChannel(1);

  assert.deepEqual(calls, [
    profileUrl,
    'https://www.douyin.com/video/1000000000000000001',
    'https://www.douyin.com/video/1000000000000000002',
    'https://www.douyin.com/video/1000000000000000003'
  ]);
  assert.equal(imported.length, 4);
  assert.equal(imported[0].pageType, 'profile');
  assert.equal(result.discoveredCount, 3);
  assert.equal(result.detailedCount, 3);
  assert.equal(result.addedCount, 1);
  assert.equal(result.updatedCount, 2);
  assert.equal(result.reanalyzedCount, 2);
  assert.deepEqual(reanalyzed, [1]);
  assert.equal(states.at(-1)[0], 'completed');
});

test('automatic sync records login failures without importing unverified page cards', async () => {
  const states = [];
  const sync = createDouyinAutoSync({
    sessionManager: {
      async captureUrl() {
        return { pageType: 'profile', pageUrl: 'https://www.douyin.com/user/model-mr', loggedIn: false,
          profile: {}, items: [] };
      }
    },
    channels: {
      getChannel() { return { id: 9, displayName: '模型先生', platform: 'douyin', profileUrl: 'https://www.douyin.com/user/model-mr' }; },
      listObservations() { return []; }
    },
    sources: { importCapturedPage() { throw new Error('should not import'); } },
    syncState: {
      markRunning() {},
      markCompleted() {},
      markFailed(id, error) { states.push([id, error.message]); }
    }
  });

  await assert.rejects(() => sync.syncChannel(9), /登录/);
  assert.match(states[0][1], /登录/);
});

test('automatic sync rejects an empty profile snapshot instead of reporting false success', async () => {
  const failures = [];
  const sync = createDouyinAutoSync({
    sessionManager: {
      async captureUrl() {
        return { pageType: 'profile', pageUrl: 'https://www.douyin.com/user/model-mr', loggedIn: true,
          profile: {}, items: [] };
      }
    },
    channels: {
      getChannel() { return { id: 10, displayName: '模型先生', platform: 'douyin', profileUrl: 'https://www.douyin.com/user/model-mr' }; },
      listObservations() { return []; }
    },
    sources: { importCapturedPage() { throw new Error('should not import'); } },
    syncState: {
      markRunning() {}, markCompleted() {},
      markFailed(_id, error) { failures.push(error.message); }
    }
  });

  await assert.rejects(() => sync.syncChannel(10), /尚未加载出作品/);
  assert.match(failures[0], /尚未加载出作品/);
});

test('automatic sync never imports a recommendation whose detail author does not match the channel', async () => {
  let imports = 0;
  const profileUrl = 'https://www.douyin.com/user/model-mr';
  const itemUrl = 'https://www.douyin.com/video/7699999999999999999';
  const sync = createDouyinAutoSync({
    sessionManager: {
      async captureUrl(url) {
        if (url === profileUrl) return {
          pageType: 'profile', pageUrl: profileUrl, loggedIn: true,
          profile: { displayName: '模型先生', profileUrl },
          items: [{ sourceUrl: itemUrl, contentId: '7699999999999999999', title: '推荐视频' }]
        };
        return {
          pageType: 'video', pageUrl: itemUrl, loggedIn: true,
          profile: { displayName: '其他作者', profileUrl: 'https://www.douyin.com/user/other' },
          items: [{ sourceUrl: itemUrl, contentId: '7699999999999999999', description: '其他作者内容' }]
        };
      }
    },
    channels: {
      getChannel() { return { id: 11, displayName: '模型先生', platform: 'douyin', profileUrl }; },
      listObservations() { return []; }
    },
    sources: {
      verifyCapturedIdentity(_id, capture) {
        return { matched: capture.pageType === 'profile' };
      },
      importCapturedPage(_id, capture) {
        if (capture.pageType === 'video') imports += 1;
        return {};
      }
    },
    syncState: { markRunning() {}, markCompleted() {}, markFailed() {} },
    maxDetailsPerRun: 1
  });

  await assert.rejects(() => sync.syncChannel(11), /未能提取任何身份匹配/);
  assert.equal(imports, 0);
});

test('automatic sync transcribes one identity-matched video and persists the result', async () => {
  const profileUrl = 'https://www.douyin.com/user/model-mr';
  const itemUrl = 'https://www.douyin.com/video/7671834569137647601';
  const primaryMediaUrl = 'https://v3-dy-o.zjcdn.com/video/primary.mp4?token=primary-signed';
  const fallbackMediaUrl = 'https://v3-dy-o.zjcdn.com/video/fallback.mp4?token=fallback-signed';
  const lastMediaUrl = 'https://v9-dy-o.douyinvod.com/video/last.mp4?token=last-signed';
  const applied = [];
  const importedCaptures = [];
  const sync = createDouyinAutoSync({
    sessionManager: {
      async captureUrl(url) {
        if (url === profileUrl) return {
          pageType: 'profile', pageUrl: profileUrl, loggedIn: true,
          profile: { displayName: '模型先生', profileUrl, workCount: 1 },
          items: [{ sourceUrl: itemUrl, contentId: '7671834569137647601', title: '有色板块' }]
        };
        return {
          pageType: 'video', pageUrl: itemUrl, loggedIn: true,
          profile: { displayName: '模型先生', profileUrl },
          items: [{
            sourceUrl: itemUrl, contentId: '7671834569137647601', title: '有色板块',
            mediaUrl: primaryMediaUrl,
            mediaCandidates: [
              { url: primaryMediaUrl, bytes: 101 },
              { url: fallbackMediaUrl, bytes: 102 },
              { url: 'http://v3-dy-o.zjcdn.com/video/insecure.mp4?token=insecure', bytes: 103 },
              { url: 'https://v3-dy-o.zjcdn.com/video/unmeasured.mp4?token=unmeasured' },
              { url: lastMediaUrl, bytes: 104 },
              { url: 'https://v3-dy-o.zjcdn.com/video/over-limit.mp4?token=over-limit', bytes: 105 }
            ]
          }]
        };
      }
    },
    channels: {
      getChannel() { return { id: 12, displayName: '模型先生', platform: 'douyin', profileUrl }; },
      listObservations() { return []; }
    },
    sources: {
      verifyCapturedIdentity() { return { matched: true }; },
      importCapturedPage(_channelId, capture) {
        importedCaptures.push(capture);
        return { addedCount: 1, items: [{ id: 60, externalContentId: '7671834569137647601', mediaMetadata: {} }] };
      },
      applyTranscription(channelId, contentId, result) { applied.push({ channelId, contentId, result }); }
    },
    transcriber: {
      async transcribe(input) {
        assert.equal(input.mediaUrl, primaryMediaUrl);
        assert.deepEqual(input.mediaUrls, [primaryMediaUrl, fallbackMediaUrl, lastMediaUrl]);
        return {
          transcript: '有色板块现在还处于早期。',
          segments: [{ start: 0.5, end: 3.2, text: '有色板块现在还处于早期。' }]
        };
      }
    },
    syncState: { markRunning() {}, markCompleted() {}, markFailed() {} },
    maxDetailsPerRun: 1,
    maxTranscriptionsPerRun: 1
  });

  const result = await sync.syncChannel(12);
  assert.equal(result.transcribedCount, 1);
  assert.deepEqual(result.transcriptErrors, []);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].contentId, '7671834569137647601');
  assert.doesNotMatch(JSON.stringify(importedCaptures), /token=/);
  assert.doesNotMatch(JSON.stringify(applied), /token=/);
});

test('complete archive scan backfills an existing transcript without running ASR again', async () => {
  const profileUrl = 'https://www.douyin.com/user/model-mr';
  const contentId = '7666656007661215217';
  const itemUrl = 'https://www.douyin.com/video/' + contentId;
  const expectedSha256 = 'c'.repeat(64);
  const expectedBytes = 100;
  const matchingPrimary = 'https://v3-dy-o.zjcdn.com/video/exact-primary.mp4?token=exact-primary';
  const matchingFallback = 'https://v3-dy-o.zjcdn.com/video/exact-fallback.mp4?token=exact-fallback';
  const archived = [];
  const captureCalls = [];
  const importedCaptures = [];
  let transcriptionCount = 0;
  const existing = {
    id: 90,
    externalContentId: contentId,
    sourceUrl: itemUrl,
    title: '历史逐字稿',
    transcript: '已有完整逐字稿，不应重新识别。',
    archiveStatus: 'linked',
    localAssetPath: '',
    mediaMetadata: {
      detailCapturedAt: '2026-08-01T00:00:00.000Z',
      asr: { status: 'complete', mediaSha256: expectedSha256, mediaBytes: expectedBytes }
    }
  };
  const sync = createDouyinAutoSync({
    sessionManager: {
      async captureUrl(url, captureOptions) {
        captureCalls.push({ url, options: captureOptions });
        if (url === profileUrl) return {
          pageType: 'profile', pageUrl: profileUrl, loggedIn: true,
          profile: { displayName: '模型先生', profileUrl, workCount: 1 },
          items: [{ sourceUrl: itemUrl, contentId, title: '历史逐字稿' }]
        };
        return {
          pageType: 'video', pageUrl: itemUrl, loggedIn: true,
          profile: { displayName: '模型先生', profileUrl },
          items: [{
            sourceUrl: itemUrl, contentId, title: '历史逐字稿',
            mediaCandidates: [
              { url: 'https://v3-dy-o.zjcdn.com/video/wrong-rendition.mp4?token=wrong', bytes: 250, source: 'play_addr', quality: '1080p' },
              { url: matchingPrimary, bytes: expectedBytes, source: 'bit_rate', quality: '720p' },
              { url: matchingFallback, bytes: expectedBytes, source: 'play_addr', quality: '720p' }
            ]
          }]
        };
      }
    },
    channels: {
      getChannel() { return { id: 19, displayName: '模型先生', platform: 'douyin', profileUrl }; },
      listObservations() { return [existing]; }
    },
    sources: {
      verifyCapturedIdentity() { return { matched: true }; },
      importCapturedPage(_id, capture) {
        importedCaptures.push(JSON.parse(JSON.stringify(capture)));
        if (capture.pageType === 'profile') return { addedCount: 0, updatedCount: 0, unchangedCount: 1, items: [existing] };
        return { addedCount: 0, updatedCount: 0, unchangedCount: 1, items: [existing] };
      },
      applyMediaArchive(channelId, archivedContentId, evidence) {
        archived.push({ channelId, contentId: archivedContentId, evidence });
      }
    },
    transcriber: {
      async archive(input) {
        assert.equal(input.expectedSha256, expectedSha256);
        assert.equal(input.mediaUrl, matchingPrimary);
        assert.deepEqual(input.mediaUrls, [
          matchingPrimary,
          matchingFallback,
          'https://v3-dy-o.zjcdn.com/video/wrong-rendition.mp4?token=wrong'
        ]);
        const evidence = {
          localAssetPath: 'D:/archive/' + contentId + '.mp4',
          mediaSha256: expectedSha256,
          mediaBytes: 100,
          mediaContentType: 'video/mp4'
        };
        await input.onArchived(evidence);
        return evidence;
      },
      async transcribe() { transcriptionCount += 1; throw new Error('must not rerun ASR'); }
    },
    syncState: { markRunning() {}, markCompleted() {}, markFailed() {} },
    maxDetailsPerRun: 1,
    maxTranscriptionsPerRun: 1
  });

  const result = await sync.syncChannel(19, { trigger: 'archive', mode: 'archive' });

  assert.equal(result.archivedCount, 1);
  assert.deepEqual(result.archiveErrors, []);
  assert.equal(transcriptionCount, 0);
  assert.equal(archived.length, 1);
  assert.equal(archived[0].contentId, contentId);
  assert.deepEqual(captureCalls.find(call => call.url === itemUrl).options, { preferMediaUrl: true });
  assert.doesNotMatch(JSON.stringify(importedCaptures), /token=/);
  assert.doesNotMatch(JSON.stringify(result), /token=/);
});

test('historical archive refuses an unmeasured DOM media URL instead of downloading blindly', async () => {
  const profileUrl = 'https://www.douyin.com/user/model-mr';
  const contentId = '7666704768191241445';
  const itemUrl = 'https://www.douyin.com/video/' + contentId;
  const expectedSha256 = 'd'.repeat(64);
  const auditItems = [];
  let archiveAttempts = 0;
  const existing = {
    externalContentId: contentId,
    sourceUrl: itemUrl,
    transcript: '已有逐字稿。',
    localAssetPath: '',
    mediaMetadata: {
      detailCapturedAt: '2026-08-01T00:00:00.000Z',
      asr: { status: 'complete', mediaSha256: expectedSha256, mediaBytes: 500 }
    }
  };
  const sync = createDouyinAutoSync({
    sessionManager: {
      async captureUrl(url) {
        if (url === profileUrl) return {
          pageType: 'profile', pageUrl: profileUrl, loggedIn: true,
          profile: { displayName: '模型先生', profileUrl, workCount: 1 },
          items: [{ sourceUrl: itemUrl, contentId, title: '历史逐字稿' }]
        };
        return {
          pageType: 'video', pageUrl: itemUrl, loggedIn: true,
          profile: { displayName: '模型先生', profileUrl },
          items: [{
            sourceUrl: itemUrl, contentId, title: '历史逐字稿',
            mediaUrl: 'https://v3-dy-o.zjcdn.com/video/primary.mp4?token=unmeasured',
            mediaCandidates: []
          }]
        };
      }
    },
    channels: {
      getChannel() { return { id: 20, displayName: '模型先生', platform: 'douyin', profileUrl }; },
      listObservations() { return [existing]; }
    },
    sources: {
      verifyCapturedIdentity() { return { matched: true }; },
      importCapturedPage() { return { addedCount: 0, updatedCount: 0, unchangedCount: 1, items: [existing] }; }
    },
    transcriber: {
      async archive() { archiveAttempts += 1; throw new Error('must not download an unmatched rendition'); }
    },
    syncState: {
      markRunning() {}, markCompleted() {}, markFailed() {},
      upsertRunItem(_runId, item) { auditItems.push(item); }
    },
    maxDetailsPerRun: 1
  });

  const result = await sync.syncChannel(20, { trigger: 'archive', mode: 'archive' });

  assert.equal(archiveAttempts, 0);
  assert.equal(result.archivedCount, 0);
  assert.equal(result.archiveErrors.length, 1);
  assert.match(result.archiveErrors[0].message, /HTTPS/);
  assert.ok(auditItems.some(item => item.contentId === contentId && item.transcriptionStatus === 'archive_missing'));
  assert.doesNotMatch(JSON.stringify(result), /token=/);
});

test('full archive requests media probing for every unfinished media item', async () => {
  const profileUrl = 'https://www.douyin.com/user/reason-routing';
  const ids = {
    fresh: '7800000000000000201',
    pending: '7800000000000000202',
    archive: '7800000000000000203',
    stale: '7800000000000000204'
  };
  const profileItems = Object.entries(ids).map(function([name, contentId]) {
    return { contentId, sourceUrl: 'https://www.douyin.com/video/' + contentId, title: name };
  });
  const existing = [
    {
      externalContentId: ids.pending, sourceUrl: 'https://www.douyin.com/video/' + ids.pending,
      mediaMetadata: { detailCapturedAt: '2020-01-01T00:00:00.000Z', asr: { status: 'media_missing' } }
    },
    {
      externalContentId: ids.archive, sourceUrl: 'https://www.douyin.com/video/' + ids.archive,
      transcript: '已有逐字稿', localAssetPath: '',
      mediaMetadata: { detailCapturedAt: '2020-01-01T00:00:00.000Z', asr: { status: 'complete', mediaSha256: 'e'.repeat(64), mediaBytes: 123 } }
    },
    {
      externalContentId: ids.stale, sourceUrl: 'https://www.douyin.com/video/' + ids.stale,
      transcript: '普通旧详情',
      mediaMetadata: { detailCapturedAt: '2020-01-01T00:00:00.000Z', asr: { status: 'complete' } }
    }
  ];
  const detailCalls = [];
  const sync = createDouyinAutoSync({
    sessionManager: {
      async captureUrl(url, captureOptions) {
        if (url === profileUrl) return {
          pageType: 'profile', pageUrl: profileUrl, loggedIn: true,
          profile: { displayName: '模型先生', profileUrl, workCount: 4 }, items: profileItems
        };
        detailCalls.push({ url, options: captureOptions });
        const item = profileItems.find(candidate => candidate.sourceUrl === url);
        return {
          pageType: 'video', pageUrl: url, loggedIn: true,
          profile: { displayName: '模型先生', profileUrl },
          items: [Object.assign({}, item, { summary: '详情已加载' })]
        };
      }
    },
    channels: {
      getChannel() { return { id: 21, displayName: '模型先生', platform: 'douyin', profileUrl }; },
      listObservations() { return existing.slice(); }
    },
    sources: {
      reanalyzeChannelObservations() { return { updatedCount: 0 }; },
      verifyCapturedIdentity() { return { matched: true }; },
      importCapturedPage(_channelId, capture) {
        const items = capture.items.map(function(item) {
          return existing.find(observation => observation.externalContentId === item.contentId) || {
            externalContentId: item.contentId, sourceUrl: item.sourceUrl, mediaMetadata: {}
          };
        });
        return { addedCount: 0, updatedCount: 0, unchangedCount: items.length, items };
      }
    },
    syncState: { markRunning() {}, markCompleted() {}, markFailed() {} },
    maxDetailsPerRun: 4
  });

  const result = await sync.syncChannel(21, { trigger: 'archive', mode: 'archive' });
  const optionsById = new Map(detailCalls.map(call => [call.url.split('/').pop(), call.options]));

  assert.equal(result.candidateCount, 4);
  assert.deepEqual(optionsById.get(ids.fresh), { preferMediaUrl: true });
  assert.deepEqual(optionsById.get(ids.pending), { preferMediaUrl: true });
  assert.deepEqual(optionsById.get(ids.archive), { preferMediaUrl: true });
  assert.deepEqual(optionsById.get(ids.stale), { preferMediaUrl: true });
});

test('automatic sync caps failed transcription attempts per run', async () => {
  const profileUrl = 'https://www.douyin.com/user/model-mr';
  const signedMediaUrl = 'https://v3-dy-o.zjcdn.com/video/sample.mp4?token=must-not-persist&signature=secret';
  const items = ['7671834569137647601', '7671834569137647602'].map(function(contentId) {
    return { sourceUrl: 'https://www.douyin.com/video/' + contentId, contentId, title: contentId };
  });
  let attempts = 0;
  const auditItems = [];
  const recordedErrors = [];
  const sync = createDouyinAutoSync({
    sessionManager: {
      async captureUrl(url) {
        if (url === profileUrl) return {
          pageType: 'profile', pageUrl: profileUrl, loggedIn: true,
          profile: { displayName: '模型先生', profileUrl }, items
        };
        const item = items.find(candidate => candidate.sourceUrl === url);
        return {
          pageType: 'video', pageUrl: url, loggedIn: true,
          profile: { displayName: '模型先生', profileUrl },
          items: [Object.assign({}, item, { mediaUrl: signedMediaUrl })]
        };
      }
    },
    channels: {
      getChannel() { return { id: 13, displayName: '模型先生', platform: 'douyin', profileUrl }; },
      listObservations() { return []; }
    },
    sources: {
      verifyCapturedIdentity() { return { matched: true }; },
      importCapturedPage(_id, capture) {
        return { addedCount: 1, items: [{ externalContentId: capture.items[0].contentId, mediaMetadata: {} }] };
      },
      applyTranscription() {},
      recordTranscriptionError(_channelId, _contentId, error) { recordedErrors.push(error.message); }
    },
    transcriber: {
      async transcribe(input) {
        attempts += 1;
        throw new Error('planned ASR failure while downloading ' + input.mediaUrl);
      }
    },
    syncState: {
      markRunning() {}, markCompleted() {}, markFailed() {},
      upsertRunItem(_runId, item) { auditItems.push(item); }
    },
    maxDetailsPerRun: 2,
    maxTranscriptionsPerRun: 1
  });

  const result = await sync.syncChannel(13);
  assert.equal(attempts, 1);
  assert.equal(result.transcriptionAttemptedCount, 1);
  assert.equal(result.transcriptErrors.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /token=|signature=/);
  assert.doesNotMatch(JSON.stringify(auditItems), /token=|signature=/);
  assert.doesNotMatch(JSON.stringify(recordedErrors), /token=|signature=/);
});

test('automatic sync records media-unavailable work instead of reporting a false transcription queue', async () => {
  const profileUrl = 'https://www.douyin.com/user/model-mr';
  const contentId = '7672552250465095409';
  const itemUrl = 'https://www.douyin.com/video/' + contentId;
  const unavailable = [];
  const auditItems = [];
  const completedRuns = [];
  const sync = createDouyinAutoSync({
    sessionManager: {
      async captureUrl(url) {
        if (url === profileUrl) return {
          pageType: 'profile', pageUrl: profileUrl, loggedIn: true,
          profile: { displayName: '模型先生', profileUrl, workCount: 368 },
          items: [{ sourceUrl: itemUrl, contentId, title: '最新视频' }]
        };
        return {
          pageType: 'video', pageUrl: itemUrl, loggedIn: true,
          profile: { displayName: '模型先生', profileUrl },
          items: [{ sourceUrl: itemUrl, contentId, title: '最新视频', summary: '只有页面摘要' }]
        };
      }
    },
    channels: {
      getChannel() { return { id: 14, displayName: '模型先生', platform: 'douyin', profileUrl }; },
      listObservations() { return []; }
    },
    sources: {
      verifyCapturedIdentity() { return { matched: true }; },
      importCapturedPage() {
        return { addedCount: 1, updatedCount: 0, unchangedCount: 0,
          items: [{ externalContentId: contentId, mediaMetadata: {} }] };
      },
      recordTranscriptionUnavailable(channelId, unavailableContentId, message) {
        unavailable.push({ channelId, contentId: unavailableContentId, message });
      }
    },
    transcriber: { async transcribe() { throw new Error('must not transcribe without media'); } },
    syncState: {
      markRunning() {}, markCompleted() {}, markFailed() {},
      startRun() { return { id: 41 }; },
      updateRun() {},
      upsertRunItem(_runId, item) { auditItems.push(item); },
      completeRun(runId, result) { completedRuns.push({ runId, result }); }
    },
    maxDetailsPerRun: 1,
    maxTranscriptionsPerRun: 1
  });

  const result = await sync.syncChannel(14, { trigger: 'manual' });
  assert.equal(result.candidateCount, 1);
  assert.equal(result.mediaMissingCount, 1);
  assert.equal(result.transcriptionAttemptedCount, 0);
  assert.deepEqual(unavailable, [{
    channelId: 14,
    contentId,
    message: '详情页未提供可下载的 HTTPS 媒体地址'
  }]);
  assert.ok(auditItems.some(item => item.contentId === contentId && item.transcriptionStatus === 'media_missing'));
  assert.equal(completedRuns[0].runId, 41);
  assert.equal(completedRuns[0].result.mediaMissingCount, 1);
});

test('automatic sync persists every discovered profile card before applying the detail limit', async () => {
  const profileUrl = 'https://www.douyin.com/user/archive-all-discoveries';
  const profileItems = Array.from({ length: 20 }, function(_value, index) {
    const contentId = String(7800000000000000000n + BigInt(index));
    return { contentId, sourceUrl: 'https://www.douyin.com/video/' + contentId, title: '作品 ' + (index + 1) };
  });
  const importedCaptures = [];
  const saved = [];
  const sync = createDouyinAutoSync({
    sessionManager: {
      async captureUrl(url) {
        if (url === profileUrl) return {
          pageType: 'profile', pageUrl: profileUrl, loggedIn: true,
          capturedAt: '2026-08-11T11:00:00.000Z',
          profile: { displayName: '模型先生', profileUrl, workCount: 20 },
          items: profileItems
        };
        const item = profileItems.find(function(candidate) { return candidate.sourceUrl === url; });
        return {
          pageType: 'video', pageUrl: url, loggedIn: true,
          capturedAt: '2026-08-11T11:01:00.000Z',
          profile: { displayName: '模型先生', profileUrl },
          items: [Object.assign({}, item, { summary: '详情 ' + item.contentId })]
        };
      }
    },
    channels: {
      getChannel() { return { id: 15, displayName: '模型先生', platform: 'douyin', profileUrl }; },
      listObservations() { return saved.slice(); }
    },
    sources: {
      reanalyzeChannelObservations() { return { updatedCount: 0 }; },
      verifyCapturedIdentity() { return { matched: true, matchType: 'profile_url' }; },
      importCapturedPage(_channelId, capture) {
        importedCaptures.push(capture.pageType);
        const results = capture.items.map(function(item) {
          let observation = saved.find(function(entry) { return entry.externalContentId === item.contentId; });
          if (!observation) {
            observation = { externalContentId: item.contentId, sourceUrl: item.sourceUrl, title: item.title,
              publishedAt: item.publishedAt || '', summary: item.summary || '', mediaMetadata: {} };
            saved.push(observation);
          } else if (item.summary) {
            observation.summary = item.summary;
            observation.mediaMetadata.detailCapturedAt = capture.capturedAt;
          }
          return observation;
        });
        return {
          addedCount: capture.pageType === 'profile' ? capture.items.length : 0,
          updatedCount: capture.pageType === 'video' ? 1 : 0,
          unchangedCount: 0,
          items: results
        };
      }
    },
    syncState: { markRunning() {}, markCompleted() {}, markFailed() {} },
    maxDetailsPerRun: 2
  });

  const result = await sync.syncChannel(15, { trigger: 'manual' });

  assert.equal(saved.length, 20, '本轮详情限额之外的作品也必须先进入本地数据库');
  assert.equal(importedCaptures[0], 'profile');
  assert.equal(result.discoveryAddedCount, 20);
  assert.equal(result.candidateCount, 2);
  assert.equal(result.detailedCount, 2);
});

test('complete archive request never masquerades as an already-running regular sync', async () => {
  let releaseCapture;
  const sync = createDouyinAutoSync({
    sessionManager: {
      captureUrl() {
        return new Promise(function(resolve) { releaseCapture = resolve; });
      }
    },
    channels: {
      getChannel() {
        return { id: 16, displayName: '并发任务作者', platform: 'douyin',
          profileUrl: 'https://www.douyin.com/user/concurrent-run' };
      },
      listObservations() { return []; }
    },
    sources: { reanalyzeChannelObservations() { return { updatedCount: 0 }; } },
    syncState: { markRunning() {}, markCompleted() {}, markFailed() {} }
  });

  const regular = sync.syncChannel(16, { trigger: 'manual' });
  await assert.rejects(() => sync.syncChannel(16, { trigger: 'archive', mode: 'archive' }), /已有采集任务/);
  releaseCapture({ loggedIn: false, profile: {}, items: [] });
  await assert.rejects(() => regular, /登录/);
});

test('complete archive persists each discovered batch before a later scroll interruption', async () => {
  const profileUrl = 'https://www.douyin.com/user/batch-checkpoint';
  const saved = [];
  const sync = createDouyinAutoSync({
    sessionManager: {
      async captureUrl() { throw new Error('regular capture should not run'); },
      async captureProfileArchive(_url, options) {
        const capture = function(contentId, scrollCount) {
          return {
            pageType: 'profile', pageUrl: profileUrl, loggedIn: true,
            profile: { displayName: '模型先生', profileUrl, workCount: 30 },
            items: [{ contentId, sourceUrl: 'https://www.douyin.com/video/' + contentId, title: contentId }],
            archive: { discoveredCount: scrollCount, scrollCount }
          };
        };
        options.onBatch(capture('7800000000000000101', 1));
        options.onBatch(capture('7800000000000000102', 2));
        throw new Error('planned scroll interruption');
      }
    },
    channels: {
      getChannel() { return { id: 17, displayName: '模型先生', platform: 'douyin', profileUrl }; },
      listObservations() { return saved; }
    },
    sources: {
      reanalyzeChannelObservations() { return { updatedCount: 0 }; },
      verifyCapturedIdentity() { return { matched: true }; },
      importCapturedPage(_channelId, capture) {
        capture.items.forEach(function(item) { saved.push({ externalContentId: item.contentId }); });
        return { addedCount: capture.items.length, updatedCount: 0, unchangedCount: 0, items: saved.slice(-capture.items.length) };
      }
    },
    syncState: { markRunning() {}, markCompleted() {}, markFailed() {}, getJob() { return { lastResult: {} }; } }
  });

  await assert.rejects(() => sync.syncChannel(17, { trigger: 'archive', mode: 'archive' }), /scroll interruption/);
  assert.deepEqual(saved.map(function(item) { return item.externalContentId; }), [
    '7800000000000000101', '7800000000000000102'
  ]);
});

test('complete archive resumes from an incomplete checkpoint after check-only reset progress', async () => {
  const profileUrl = 'https://www.douyin.com/user/resume-checkpoint';
  let receivedMaxScrolls = 0;
  const sync = createDouyinAutoSync({
    sessionManager: {
      async captureUrl() { throw new Error('regular capture should not run'); },
      async captureProfileArchive(_url, options) {
        receivedMaxScrolls = options.maxScrolls;
        return { pageType: 'profile', pageUrl: profileUrl, loggedIn: false, profile: {}, items: [] };
      }
    },
    channels: {
      getChannel() { return { id: 18, displayName: 'resume creator', platform: 'douyin', profileUrl }; },
      listObservations() { return []; }
    },
    sources: {
      reanalyzeChannelObservations() { return { updatedCount: 0 }; }
    },
    syncState: {
      getJob() {
        return {
          progress: { stage: 'idle', scrollCount: 0 },
          lastResult: {
            checkOnly: true,
            archiveCheckpoint: { complete: false, scrollCount: 42, scrollLimit: 80, stoppedReason: '' }
          }
        };
      },
      markRunning() {}, markCompleted() {}, markFailed() {}
    }
  });

  await assert.rejects(
    () => sync.syncChannel(18, { trigger: 'archive', mode: 'archive' }),
    /\u767b\u5f55/
  );
  assert.equal(receivedMaxScrolls, 122);
});

test('scheduled polling automatically downloads and transcribes a newly discovered video', async () => {
  const profileUrl = 'https://www.douyin.com/user/automatic-download';
  const contentId = '7900000000000000001';
  const itemUrl = 'https://www.douyin.com/video/' + contentId;
  const calls = [];
  const completed = [];
  const observations = [];
  const archived = [];
  const transcribed = [];
  let importCount = 0;
  let transcriptionCount = 0;
  const sync = createDouyinAutoSync({
    sessionManager: {
      async captureUrl(url) {
        calls.push(url);
        if (url === itemUrl) {
          return {
            pageType: 'video', pageUrl: itemUrl, loggedIn: true,
            profile: { displayName: 'automatic download creator', profileUrl },
            items: [{
              contentId, sourceUrl: itemUrl, title: 'new item',
              mediaUrl: 'https://v3-dy-o.zjcdn.com/video/' + contentId + '.mp4?token=fresh'
            }]
          };
        }
        return {
          pageType: 'profile', pageUrl: profileUrl, loggedIn: true,
          profile: { displayName: 'automatic download creator', profileUrl, workCount: 1 },
          items: [{ contentId, sourceUrl: itemUrl, title: 'new item' }]
        };
      }
    },
    channels: {
      getChannel() {
        return { id: 31, displayName: 'automatic download creator', platform: 'douyin', profileUrl };
      },
      listObservations() { return observations; }
    },
    sources: {
      importCapturedPage(_channelId, capture) {
        importCount += 1;
        if (capture.pageType === 'profile') {
          const observation = {
            externalContentId: contentId,
            sourceUrl: itemUrl,
            title: 'new item',
            mediaType: 'video',
            transcript: '',
            mediaMetadata: {}
          };
          observations.push(observation);
          return { addedCount: 1, updatedCount: 0, unchangedCount: 0, items: [observation] };
        }
        return {
          addedCount: 0, updatedCount: 1, unchangedCount: 0,
          items: [observations[0]]
        };
      },
      reanalyzeChannelObservations() { return { updatedCount: 0 }; },
      verifyCapturedIdentity() { return { matched: true }; },
      applyMediaArchive(_channelId, archivedContentId, archive) {
        archived.push(archivedContentId);
        observations[0].localAssetPath = archive.localAssetPath;
      },
      applyTranscription(_channelId, transcribedContentId, transcription) {
        transcribed.push(transcribedContentId);
        observations[0].transcript = transcription.transcript;
        observations[0].mediaMetadata.asr = { status: 'complete' };
      }
    },
    transcriber: {
      async transcribe(input) {
        transcriptionCount += 1;
        await input.onArchived({
          localAssetPath: 'D:\\archive\\' + contentId + '.mp4',
          mediaSha256: 'a'.repeat(64),
          mediaBytes: 123,
          mediaContentType: 'video/mp4'
        });
        return { status: 'complete', transcript: 'automatic transcript', segments: [] };
      }
    },
    syncState: {
      listDue() { return [{ channelId: 31 }]; },
      getPlanningState() { return {}; },
      markRunning() {},
      markCompleted(_id, result) { completed.push(result); },
      markFailed() {}
    }
  });

  await sync.runDue('scheduled');

  assert.deepEqual(calls, [profileUrl, itemUrl]);
  assert.equal(importCount, 2);
  assert.equal(transcriptionCount, 1);
  assert.deepEqual(archived, [contentId]);
  assert.deepEqual(transcribed, [contentId]);
  assert.equal(completed.length, 1);
  assert.equal(completed[0].candidateCount, 1);
  assert.equal(completed[0].detailedCount, 1);
  assert.equal(completed[0].archivedCount, 1);
  assert.equal(completed[0].transcribedCount, 1);
});

test('manual full archive processes every incomplete video and skips completed archives', async () => {
  const profileUrl = 'https://www.douyin.com/user/full-archive';
  const ids = ['7910000000000000001', '7910000000000000002', '7910000000000000003'];
  const itemUrl = function(id) { return 'https://www.douyin.com/video/' + id; };
  const observations = [
    {
      externalContentId: ids[0], sourceUrl: itemUrl(ids[0]), mediaType: 'video', transcript: 'already complete',
      localAssetPath: 'D:\\archive\\' + ids[0] + '.mp4',
      mediaMetadata: { asr: { status: 'complete' }, archive: { localAssetPath: 'D:\\archive\\' + ids[0] + '.mp4' } }
    },
    {
      externalContentId: ids[1], sourceUrl: itemUrl(ids[1]), mediaType: 'video', transcript: '',
      localAssetPath: 'D:\\archive\\' + ids[1] + '.mp4',
      mediaMetadata: { archive: { localAssetPath: 'D:\\archive\\' + ids[1] + '.mp4' } }
    },
    { externalContentId: ids[2], sourceUrl: itemUrl(ids[2]), mediaType: 'video', mediaMetadata: { asr: { status: 'media_missing' } } }
  ];
  const detailCalls = [];
  const transcribed = [];
  const sync = createDouyinAutoSync({
    sessionManager: {
      async captureUrl(url) {
        detailCalls.push(url);
        const id = url.split('/').pop();
        return {
          pageType: 'video', pageUrl: url, loggedIn: true,
          profile: { displayName: 'full archive creator', profileUrl },
          items: [{
            contentId: id, sourceUrl: url, title: id,
            mediaUrl: 'https://v3-dy-o.zjcdn.com/video/' + id + '.mp4?token=fresh'
          }]
        };
      },
      async captureProfileArchive() {
        return {
          pageType: 'profile', pageUrl: profileUrl, loggedIn: true,
          profile: { displayName: 'full archive creator', profileUrl, workCount: 3 },
          items: ids.map(function(id) { return { contentId: id, sourceUrl: itemUrl(id), title: id }; }),
          archive: { complete: true, discoveredCount: 3, reportedWorkCount: 3 }
        };
      }
    },
    channels: {
      getChannel() { return { id: 32, displayName: 'full archive creator', platform: 'douyin', profileUrl }; },
      listObservations() { return observations; }
    },
    sources: {
      reanalyzeChannelObservations() { return { updatedCount: 0 }; },
      verifyCapturedIdentity() { return { matched: true }; },
      importCapturedPage(_channelId, capture) {
        if (capture.pageType === 'profile') {
          return { addedCount: 0, updatedCount: 0, unchangedCount: 3, items: observations };
        }
        const id = capture.items[0].contentId;
        return { addedCount: 0, updatedCount: 1, unchangedCount: 0,
          items: [observations.find(function(item) { return item.externalContentId === id; })] };
      },
      applyMediaArchive(_channelId, contentId, archive) {
        const observation = observations.find(function(item) { return item.externalContentId === contentId; });
        observation.localAssetPath = archive.localAssetPath;
      },
      applyTranscription(_channelId, contentId) { transcribed.push(contentId); }
    },
    transcriber: {
      async transcribe(input) {
        await input.onArchived({
          localAssetPath: 'D:\\archive\\' + input.contentId + '.mp4',
          mediaSha256: 'a'.repeat(64),
          mediaBytes: 123,
          mediaContentType: 'video/mp4'
        });
        return { transcript: 'transcript ' + input.contentId, segments: [] };
      }
    },
    syncState: {
      markRunning() {}, markCompleted() {}, markFailed() {},
      getJob() { return { lastResult: {} }; },
      getPlanningState() { return {}; }
    },
    maxDetailsPerRun: 1,
    maxTranscriptionsPerRun: 1
  });

  const result = await sync.syncChannel(32, { trigger: 'archive', mode: 'archive' });

  assert.deepEqual(detailCalls, [itemUrl(ids[1]), itemUrl(ids[2])]);
  assert.deepEqual(transcribed, [ids[1], ids[2]]);
  assert.equal(result.candidateCount, 2);
  assert.equal(result.transcriptionAttemptedCount, 2);
  assert.equal(result.transcribedCount, 2);
  assert.equal(result.archivedCount, 1);
  assert.equal(result.coverage.videoCount, 3);
});

test('full archive labels current-identity media separately when no historical hash exists', async () => {
  const profileUrl = 'https://www.douyin.com/user/current-identity-archive';
  const contentId = '7920000000000000001';
  const sourceUrl = 'https://www.douyin.com/video/' + contentId;
  const existing = {
    externalContentId: contentId,
    sourceUrl,
    mediaType: 'video',
    transcript: 'existing transcript',
    localAssetPath: '',
    mediaMetadata: { asr: { status: 'complete' } }
  };
  const archivedEvidence = [];
  const auditItems = [];
  const sync = createDouyinAutoSync({
    sessionManager: {
      async captureProfileArchive() {
        return {
          pageType: 'profile', pageUrl: profileUrl, loggedIn: true,
          profile: { displayName: 'current identity creator', profileUrl, workCount: 1 },
          items: [{ contentId, sourceUrl, title: contentId }],
          archive: { complete: true, discoveredCount: 1, reportedWorkCount: 1 }
        };
      },
      async captureUrl() {
        return {
          pageType: 'video', pageUrl: sourceUrl, loggedIn: true,
          profile: { displayName: 'current identity creator', profileUrl },
          items: [{
            contentId, sourceUrl, title: contentId,
            mediaUrl: 'https://v3-dy-o.zjcdn.com/video/current-0.mp4?token=fresh',
            mediaCandidates: Array.from({ length: 10 }, function(_value, index) {
              return { url: 'https://v3-dy-o.zjcdn.com/video/current-' + index + '.mp4?token=fresh',
                bytes: 100 + index, source: 'play_addr', quality: String(index) };
            })
          }]
        };
      }
    },
    channels: {
      getChannel() { return { id: 33, displayName: 'current identity creator', platform: 'douyin', profileUrl }; },
      listObservations() { return [existing]; }
    },
    sources: {
      reanalyzeChannelObservations() { return { updatedCount: 0 }; },
      verifyCapturedIdentity() { return { matched: true }; },
      importCapturedPage() { return { addedCount: 0, updatedCount: 0, unchangedCount: 1, items: [existing] }; },
      applyMediaArchive(_channelId, _contentId, evidence) { archivedEvidence.push(evidence); }
    },
    transcriber: {
      async archive(input) {
        assert.equal(input.expectedSha256, '');
        assert.equal(input.mediaUrls.length, 3);
        const evidence = {
          localAssetPath: 'D:/archive/' + contentId + '.mp4',
          mediaSha256: 'f'.repeat(64),
          mediaBytes: 123,
          mediaContentType: 'video/mp4'
        };
        await input.onArchived(evidence);
        return evidence;
      }
    },
    syncState: {
      markRunning() {}, markCompleted() {}, markFailed() {},
      getJob() { return { lastResult: {} }; },
      upsertRunItem(_runId, item) { auditItems.push(item); }
    }
  });

  const result = await sync.syncChannel(33, { trigger: 'archive', mode: 'archive' });

  assert.equal(result.archivedCount, 1);
  assert.equal(archivedEvidence[0].verificationMode, 'current_content_id');
  assert.ok(auditItems.some(function(item) {
    return item.transcriptionStatus === 'archive_complete' && /当前作品身份/.test(item.message);
  }));
  assert.equal(auditItems.some(function(item) {
    return item.transcriptionStatus === 'archive_complete' && /通过 SHA-256 校验/.test(item.message);
  }), false);
});

test('a synchronous startup failure releases the channel for a later retry', async () => {
  let getChannelCount = 0;
  const sync = createDouyinAutoSync({
    sessionManager: { async captureUrl() { throw new Error('should not reach capture'); } },
    channels: {
      getChannel() { getChannelCount += 1; throw new Error('planned channel lookup failure'); },
      listObservations() { return []; }
    },
    sources: {},
    syncState: { markRunning() {}, markCompleted() {}, markFailed() {} }
  });

  await assert.rejects(() => sync.syncChannel(34), /planned channel lookup failure/);
  await assert.rejects(() => sync.syncChannel(34), /planned channel lookup failure/);
  assert.equal(getChannelCount, 2);
});

test('scheduled polling skips a running full archive and coalesces overlapping polls', async () => {
  function deferred() {
    let reject;
    const promise = new Promise(function(_resolve, rejectPromise) { reject = rejectPromise; });
    return { promise, reject };
  }
  const manualCapture = deferred();
  const scheduledCapture = deferred();
  const profileUrls = {
    35: 'https://www.douyin.com/user/running-manual-archive',
    36: 'https://www.douyin.com/user/scheduled-check'
  };
  const captureCalls = [];
  let listDueCount = 0;
  const sync = createDouyinAutoSync({
    sessionManager: {
      captureProfileArchive(url) {
        captureCalls.push(['archive', url]);
        return manualCapture.promise;
      },
      captureUrl(url) {
        captureCalls.push(['check', url]);
        return scheduledCapture.promise;
      }
    },
    channels: {
      getChannel(id) { return { id, platform: 'douyin', profileUrl: profileUrls[id] }; },
      listObservations() { return []; }
    },
    sources: {},
    syncState: {
      listDue() {
        listDueCount += 1;
        return [{ channelId: 35 }, { channelId: 36 }];
      },
      markRunning() {}, markCompleted() {}, markFailed() {}
    }
  });

  const manualTask = sync.syncChannel(35, { trigger: 'archive', mode: 'archive' });
  const firstPoll = sync.runDue('scheduled');
  const secondPoll = sync.runDue('scheduled');
  let secondPollSettled = false;
  secondPoll.then(function() { secondPollSettled = true; });
  await Promise.resolve();
  await Promise.resolve();

  const settledBeforeRelease = secondPollSettled;
  const callsBeforeRelease = captureCalls.slice();
  const listDueBeforeRelease = listDueCount;
  manualCapture.reject(new Error('release manual archive test task'));
  scheduledCapture.reject(new Error('release scheduled check test task'));
  await Promise.allSettled([manualTask, firstPoll, secondPoll]);

  assert.equal(settledBeforeRelease, true);
  assert.equal(listDueBeforeRelease, 1);
  assert.deepEqual(callsBeforeRelease, [
    ['archive', profileUrls[35]],
    ['check', profileUrls[36]]
  ]);
});
