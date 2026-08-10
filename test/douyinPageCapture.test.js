const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isAllowedDouyinUrl,
  parseDouyinItemUrl,
  parseVisibleWorkCount,
  parseVisibleMetricCount,
  inferVisibleLoggedIn,
  selectVisibleProfileCandidate,
  normalizeDouyinPageSnapshot,
  buildDouyinPageSnapshotScript
} = require('../electron/douyinPageCapture');

test('Douyin page capture accepts only HTTPS Douyin pages and canonicalizes public items', () => {
  assert.equal(isAllowedDouyinUrl('https://www.douyin.com/user/example'), true);
  assert.equal(isAllowedDouyinUrl('https://jingxuan.douyin.com/m/video/7641362696420887025'), true);
  assert.equal(isAllowedDouyinUrl('http://www.douyin.com/video/7533142185677114684'), false);
  assert.equal(isAllowedDouyinUrl('https://douyin.com.example.com/video/7533142185677114684'), false);

  assert.deepEqual(parseDouyinItemUrl('https://www.douyin.com/video/7533142185677114684?from=copy'), {
    sourceUrl: 'https://www.douyin.com/video/7533142185677114684',
    contentId: '7533142185677114684',
    mediaType: 'video'
  });
  assert.deepEqual(parseDouyinItemUrl('https://www.douyin.com/note/7641362696420887025/'), {
    sourceUrl: 'https://www.douyin.com/note/7641362696420887025',
    contentId: '7641362696420887025',
    mediaType: 'note'
  });
  assert.equal(parseDouyinItemUrl('https://example.com/video/7533142185677114684'), null);
});

test('visible profile metrics support the live Douyin label order and login placeholder', () => {
  assert.equal(parseVisibleWorkCount('作品 368 推荐 喜欢'), 368);
  assert.equal(parseVisibleWorkCount('368 作品'), 368);
  assert.equal(parseVisibleWorkCount('作品 1.2万'), 12000);
  assert.equal(inferVisibleLoggedIn('最新作品 登录 置顶视频', false), false);
  assert.equal(inferVisibleLoggedIn('搜索 充钻石 通知 消息 投稿 模型先生', false), true);
  assert.equal(inferVisibleLoggedIn('搜索 充钻石 通知 消息 投稿', true), false);
});

test('visible engagement counts support Chinese compact units', () => {
  assert.equal(parseVisibleMetricCount('1.2万'), 12000);
  assert.equal(parseVisibleMetricCount('3.4w'), 34000);
  assert.equal(parseVisibleMetricCount('892'), 892);
  assert.equal(parseVisibleMetricCount('--'), null);
});

test('video detail profile selection skips the signed-in user and keeps the creator link', () => {
  assert.deepEqual(selectVisibleProfileCandidate([
    { href: 'https://www.douyin.com/user/self', text: '' },
    { href: 'https://www.douyin.com/user/model-mr', text: '' },
    { href: 'https://www.douyin.com/user/model-mr', text: '模型先生' },
    { href: 'https://www.douyin.com/user/commenter?from=comment', text: '评论用户' }
  ], 'https://www.douyin.com/video/7672339420096779953', true), {
    profileUrl: 'https://www.douyin.com/user/model-mr',
    displayName: '模型先生'
  });
});

test('Douyin page snapshots are sanitized, deduplicated and bounded before leaving Electron', () => {
  const normalized = normalizeDouyinPageSnapshot({
    pageType: 'profile',
    pageUrl: 'https://www.douyin.com/user/MS4wLjABAAAA-test?from=web',
    loggedIn: true,
    capturedAt: '2026-08-11T10:00:00.000Z',
    profile: {
      displayName: '  模型先生  ',
      profileUrl: 'https://www.douyin.com/user/MS4wLjABAAAA-test?from=web',
      douyinId: 'moxingxiansheng',
      workCount: 368,
      ignoredSecret: 'must not cross the bridge'
    },
    items: [
      {
        sourceUrl: 'https://www.douyin.com/video/7533142185677114684?from=copy',
        title: ' 科创芯片观察 ',
        description: ' 半导体设备与先进封装的产业观察 ',
        transcript: '先进封装仍需观察订单兑现。',
        publishedAt: '2025-07-31 15:19',
        summary: '页面上可见的章节摘要',
        author: '模型先生',
        hashtags: ['半导体', '先进封装', '半导体'],
        engagement: { likes: 12000, comments: 86, favorites: 520, shares: 41, plays: 95000 },
        coverUrl: 'https://p3-sign.douyinpic.com/cover.jpeg',
        durationSeconds: 73
      },
      {
        sourceUrl: 'https://jingxuan.douyin.com/m/video/7533142185677114684',
        title: '重复项'
      },
      {
        sourceUrl: 'https://www.douyin.com/note/7641362696420887025',
        title: '图文记录'
      },
      {
        sourceUrl: 'https://example.com/video/9999999999999999999',
        title: '外站内容'
      }
    ]
  });

  assert.equal(normalized.pageType, 'profile');
  assert.equal(normalized.pageUrl, 'https://www.douyin.com/user/MS4wLjABAAAA-test?from=web');
  assert.equal(normalized.loggedIn, true);
  assert.deepEqual(normalized.profile, {
    displayName: '模型先生',
    profileUrl: 'https://www.douyin.com/user/MS4wLjABAAAA-test?from=web',
    douyinId: 'moxingxiansheng',
    workCount: 368
  });
  assert.equal(normalized.items.length, 2);
  assert.equal(normalized.items[0].contentId, '7533142185677114684');
  assert.equal(normalized.items[0].mediaType, 'video');
  assert.equal(normalized.items[0].transcript, '先进封装仍需观察订单兑现。');
  assert.deepEqual(normalized.items[0].hashtags, ['半导体', '先进封装']);
  assert.deepEqual(normalized.items[0].engagement, {
    likes: 12000,
    comments: 86,
    favorites: 520,
    shares: 41,
    plays: 95000
  });
  assert.equal(normalized.items[0].durationSeconds, 73);
  assert.equal(normalized.items[1].mediaType, 'note');
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.profile, 'ignoredSecret'), false);
});

test('page snapshot script only reads visible DOM data, not browser credentials or storage', () => {
  const script = buildDouyinPageSnapshotScript();
  assert.match(script, /querySelector/);
  assert.match(script, /user-post-list/);
  assert.match(script, /video-player-digg/);
  assert.match(script, /feed-comment-icon/);
  assert.doesNotMatch(script, /cookie/i);
  assert.doesNotMatch(script, /localStorage/i);
  assert.doesNotMatch(script, /sessionStorage/i);
});
