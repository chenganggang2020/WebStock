const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createDouyinAutoSync,
  ensureDouyinSyncJobs,
  summarizeObservationCoverage
} = require('../electron/douyinAutoSync');

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
    { externalContentId: '', mediaType: 'article', summary: '第三方文章' }
  ]);

  assert.deepEqual(summary, {
    videoCount: 3,
    transcribedCount: 1,
    pendingTranscriptionCount: 1,
    failedTranscriptionCount: 1,
    transcriptCoverage: 0.3333
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
  assert.equal(imported.length, 3);
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
      importCapturedPage() { imports += 1; return {}; }
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
  const applied = [];
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
            mediaUrl: 'https://v3-dy-o.zjcdn.com/video/sample.mp4?token=signed'
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
      importCapturedPage() {
        return { addedCount: 1, items: [{ id: 60, externalContentId: '7671834569137647601', mediaMetadata: {} }] };
      },
      applyTranscription(channelId, contentId, result) { applied.push({ channelId, contentId, result }); }
    },
    transcriber: {
      async transcribe(input) {
        assert.match(input.mediaUrl, /token=signed/);
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
  assert.doesNotMatch(JSON.stringify(applied), /token=signed/);
});

test('automatic sync caps failed transcription attempts per run', async () => {
  const profileUrl = 'https://www.douyin.com/user/model-mr';
  const items = ['7671834569137647601', '7671834569137647602'].map(function(contentId) {
    return { sourceUrl: 'https://www.douyin.com/video/' + contentId, contentId, title: contentId };
  });
  let attempts = 0;
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
          items: [Object.assign({}, item, { mediaUrl: 'https://v3-dy-o.zjcdn.com/video/sample.mp4' })]
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
      applyTranscription() {}, recordTranscriptionError() {}
    },
    transcriber: { async transcribe() { attempts += 1; throw new Error('planned ASR failure'); } },
    syncState: { markRunning() {}, markCompleted() {}, markFailed() {} },
    maxDetailsPerRun: 2,
    maxTranscriptionsPerRun: 1
  });

  const result = await sync.syncChannel(13);
  assert.equal(attempts, 1);
  assert.equal(result.transcriptionAttemptedCount, 1);
  assert.equal(result.transcriptErrors.length, 1);
});
