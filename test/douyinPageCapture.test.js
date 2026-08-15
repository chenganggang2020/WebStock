const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const {
  isAllowedDouyinUrl,
  parseDouyinItemUrl,
  parseVisibleWorkCount,
  parseVisibleMetricCount,
  inferVisibleLoggedIn,
  selectVisibleProfileCandidate,
  normalizeDouyinPageSnapshot,
  buildDouyinPageSnapshotScript,
  extractDouyinMediaCandidates,
  buildDouyinMediaProbeScript
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

test('detail snapshots retain only bounded public comment fields and visible-range coverage', () => {
  const normalized = normalizeDouyinPageSnapshot({
    pageType: 'video',
    pageUrl: 'https://www.douyin.com/video/7533142185677114684',
    capturedAt: '2026-08-15T08:00:00.000Z',
    profile: { displayName: '模型先生', profileUrl: 'https://www.douyin.com/user/model-mr' },
    items: [{
      sourceUrl: 'https://www.douyin.com/video/7533142185677114684',
      comments: [{
        commentId: 'comment-1', authorName: '提问者',
        authorProfileUrl: 'https://www.douyin.com/user/commenter?from=comment',
        text: '科技股反弹后怎么看？', publishedAt: '2026-08-15 15:00', likes: 12,
        ignoredSecret: 'must not leave Electron'
      }, {
        commentId: 'reply-1', parentCommentId: 'comment-1', authorName: '模型先生',
        authorProfileUrl: 'https://www.douyin.com/user/model-mr', text: '先看分化。', isCreatorLabel: true
      }],
      commentCoverage: { status: 'visible_partial', message: '仅采集当前页面可见范围' }
    }]
  });

  assert.equal(normalized.items[0].comments.length, 2);
  assert.deepEqual(normalized.items[0].comments[1], {
    commentId: 'reply-1', parentCommentId: 'comment-1', replyToCommentId: '',
    authorName: '模型先生', authorPlatformId: '',
    authorProfileUrl: 'https://www.douyin.com/user/model-mr',
    text: '先看分化。', publishedAt: '', likes: null, isCreatorLabel: true
  });
  assert.deepEqual(normalized.items[0].commentCoverage, {
    status: 'visible_partial', message: '仅采集当前页面可见范围',
    observedAt: '2026-08-15T08:00:00.000Z', visibleCount: 2
  });
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.items[0].comments[0], 'ignoredSecret'), false);
});

test('profile snapshots preserve up to one thousand distinct public works', () => {
  const items = Array.from({ length: 1005 }, function(_value, index) {
    const contentId = (7800000000000000000n + BigInt(index)).toString();
    return {
      sourceUrl: `https://www.douyin.com/video/${contentId}`,
      title: `作品 ${index + 1}`
    };
  });

  const normalized = normalizeDouyinPageSnapshot({
    pageType: 'profile',
    pageUrl: 'https://www.douyin.com/user/archive-profile',
    loggedIn: true,
    profile: { displayName: '模型先生', profileUrl: 'https://www.douyin.com/user/archive-profile', workCount: 1005 },
    items
  });

  assert.equal(normalized.items.length, 1000);
  assert.match(buildDouyinPageSnapshotScript(), /slice\(0, 1000\)/);
});

test('detail snapshots expose only an ephemeral HTTPS media URL for local transcription', () => {
  const detail = normalizeDouyinPageSnapshot({
    pageType: 'video',
    pageUrl: 'https://www.douyin.com/video/7533142185677114684',
    profile: { profileUrl: 'https://www.douyin.com/user/model-mr' },
    items: [{
      sourceUrl: 'https://www.douyin.com/video/7533142185677114684',
      mediaUrl: 'https://v3-dy-o.zjcdn.com/video/sample.mp4?token=signed'
    }]
  });
  assert.equal(detail.items[0].mediaUrl, 'https://v3-dy-o.zjcdn.com/video/sample.mp4?token=signed');

  const insecure = normalizeDouyinPageSnapshot({
    pageType: 'video',
    pageUrl: 'https://www.douyin.com/video/7533142185677114684',
    items: [{
      sourceUrl: 'https://www.douyin.com/video/7533142185677114684',
      mediaUrl: 'http://v3-dy-o.zjcdn.com/video/sample.mp4'
    }]
  });
  assert.equal(insecure.items[0].mediaUrl, '');

  const profile = normalizeDouyinPageSnapshot({
    pageType: 'profile',
    pageUrl: 'https://www.douyin.com/user/model-mr',
    items: [{
      sourceUrl: 'https://www.douyin.com/video/7533142185677114684',
      mediaUrl: 'https://v3-dy-o.zjcdn.com/video/sample.mp4?token=signed'
    }]
  });
  assert.equal(Object.prototype.hasOwnProperty.call(profile.items[0], 'mediaUrl'), false);
});

test('page snapshot script only reads visible DOM data, not browser credentials or storage', () => {
  const script = buildDouyinPageSnapshotScript();
  assert.match(script, /querySelector/);
  assert.match(script, /user-post-list/);
  assert.match(script, /video-player-digg/);
  assert.match(script, /feed-comment-icon/);
  assert.match(script, /currentSrc/);
  assert.doesNotMatch(script, /cookie/i);
  assert.doesNotMatch(script, /localStorage/i);
  assert.doesNotMatch(script, /sessionStorage/i);
  assert.doesNotMatch(script, /engagement:\s*plays/);
});

test('Douyin media candidates require the requested content ID and approved HTTPS CDN hosts', () => {
  const contentId = '7672552250465095409';
  const candidates = extractDouyinMediaCandidates({
    aweme_detail: {
      aweme_id: contentId,
      video: {
        ratio: '1080p',
        bit_rate: [{
          gear_name: 'adapt_1080_1',
          play_addr: {
            data_size: 1200,
            url_list: [
              'https://v3-dy-o.zjcdn.com/video/high.mp4?token=one',
              'https://v3-dy-o.zjcdn.com/video/high.mp4?token=one',
              'http://v3-dy-o.zjcdn.com/video/insecure.mp4'
            ]
          }
        }, {
          quality_type: 14,
          play_addr: {
            data_size: '900',
            url_list: ['https://media.douyinvod.com/video/second.mp4']
          }
        }],
        play_addr_h264: {
          data_size: 800,
          url_list: [
            'https://v3-dy-o.zjcdn.com/video/high.mp4?token=one',
            'https://media.amemv.com/video/h264.mp4'
          ]
        },
        play_addr: {
          data_size: 700,
          url_list: ['https://video.snssdk.com/video/default.mp4']
        },
        download_addr: {
          data_size: 600,
          url_list: [
            'https://www.douyin.com/video/download.mp4',
            'https://zjcdn.com.example.com/video/host-confusion.mp4'
          ]
        }
      }
    }
  }, contentId);

  assert.deepEqual(candidates, [
    {
      url: 'https://v3-dy-o.zjcdn.com/video/high.mp4?token=one',
      bytes: 1200,
      source: 'bit_rate',
      quality: 'adapt_1080_1'
    },
    {
      url: 'https://media.douyinvod.com/video/second.mp4',
      bytes: 900,
      source: 'bit_rate',
      quality: '14'
    },
    {
      url: 'https://media.amemv.com/video/h264.mp4',
      bytes: 800,
      source: 'play_addr_h264',
      quality: '1080p'
    },
    {
      url: 'https://video.snssdk.com/video/default.mp4',
      bytes: 700,
      source: 'play_addr',
      quality: '1080p'
    },
    {
      url: 'https://www.douyin.com/video/download.mp4',
      bytes: 600,
      source: 'download_addr',
      quality: '1080p'
    }
  ]);
  assert.deepEqual(extractDouyinMediaCandidates({
    aweme_detail: {
      aweme_id: '7672552250465095410',
      video: { play_addr: { url_list: ['https://video.snssdk.com/video/wrong.mp4'] } }
    }
  }, contentId), []);
  assert.deepEqual(extractDouyinMediaCandidates({
    aweme_detail: {
      aweme_id: contentId,
      video: {
        data_size: 456,
        play_addr: { url_list: ['https://media.bytecdn.cn/video/fallback-size.mp4'] }
      }
    }
  }, contentId), [{
    url: 'https://media.bytecdn.cn/video/fallback-size.mp4',
    bytes: 456,
    source: 'play_addr',
    quality: 'default'
  }]);
});

test('media probe re-fetches the matching performance detail request with page credentials', async () => {
  const contentId = '7672552250465095409';
  const detailUrl = 'https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=' + contentId + '&aid=6383';
  const fetchCalls = [];
  const script = buildDouyinMediaProbeScript(contentId);
  const result = await vm.runInNewContext(script, {
    URL,
    performance: {
      getEntriesByType(type) {
        assert.equal(type, 'resource');
        return [
          { name: 'https://www.douyin.com/aweme/v1/web/comment/list/?aweme_id=' + contentId },
          { name: detailUrl },
          { name: detailUrl },
          { name: 'https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=7672552250465095410' },
          { name: 'https://www.douyin.com.example.com/aweme/v1/web/aweme/detail/?aweme_id=' + contentId }
        ];
      }
    },
    async fetch(url, options) {
      fetchCalls.push({ url, options });
      return {
        ok: true,
        async json() {
          return {
            aweme_detail: {
              aweme_id: contentId,
              video: {
                play_addr_h264: {
                  data_size: 321,
                  url_list: ['https://v3-dy-o.zjcdn.com/video/probed.mp4?token=fresh']
                }
              }
            }
          };
        }
      };
    }
  });

  assert.deepEqual(JSON.parse(JSON.stringify(fetchCalls)), [{
    url: detailUrl,
    options: { credentials: 'include' }
  }]);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [{
    url: 'https://v3-dy-o.zjcdn.com/video/probed.mp4?token=fresh',
    bytes: 321,
    source: 'play_addr_h264',
    quality: 'h264'
  }]);
  assert.doesNotMatch(script, /cookie|localStorage|sessionStorage/i);
});

test('media probe waits locally for a delayed detail performance entry before fetching once', async () => {
  const contentId = '7666704768191241445';
  const detailUrl = 'https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=' + contentId + '&aid=6383';
  let polls = 0;
  const fetchCalls = [];
  const result = await vm.runInNewContext(buildDouyinMediaProbeScript(contentId), {
    URL,
    setTimeout(callback) { callback(); return 1; },
    performance: {
      getEntriesByType() {
        polls += 1;
        return polls < 3 ? [] : [{ name: detailUrl }];
      }
    },
    async fetch(url, options) {
      fetchCalls.push({ url, options });
      return {
        ok: true,
        async json() {
          return {
            aweme_detail: {
              aweme_id: contentId,
              video: {
                bit_rate: [{
                  gear_name: 'normal_720_0',
                  play_addr: {
                    data_size: 41854598,
                    url_list: ['https://v5-dy-ov-experiment.zjcdn.com/video/delayed']
                  }
                }]
              }
            }
          };
        }
      };
    }
  });

  assert.equal(polls, 3);
  assert.equal(fetchCalls.length, 1);
  assert.equal(result[0].bytes, 41854598);
  assert.equal(result[0].quality, 'normal_720_0');
});
