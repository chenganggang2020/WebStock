const test = require('node:test');
const assert = require('node:assert/strict');

const { createDouyinAutoSync } = require('../electron/douyinAutoSync');

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
