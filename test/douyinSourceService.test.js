const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractDouyinShareLinks,
  douyinPlayerUrl
} = require('../services/douyinSourceService');

test('Douyin share links are canonicalized and deduplicated without accepting other sites', () => {
  const parsed = extractDouyinShareLinks([
    '模型先生新视频 https://www.douyin.com/video/7533142185677114684?previous_page=web_code_link',
    '重复链接：https://www.douyin.com/video/7533142185677114684/',
    '短链接 https://v.douyin.com/AbCdEfGh/',
    '第三方 https://example.com/video/7533142185677114684'
  ].join('\n'));

  assert.deepEqual(parsed.items, [{
    sourceUrl: 'https://www.douyin.com/video/7533142185677114684',
    videoId: '7533142185677114684',
    kind: 'video'
  }, {
    sourceUrl: 'https://v.douyin.com/AbCdEfGh/',
    videoId: '',
    kind: 'short_link'
  }]);
  assert.equal(parsed.duplicateCount, 1);
  assert.equal(parsed.ignoredCount, 1);
  assert.equal(douyinPlayerUrl('7533142185677114684'),
    'https://open.douyin.com/player/video?vid=7533142185677114684&autoplay=0');
});

test('Douyin parser accepts official player and selected-video URLs only', () => {
  const parsed = extractDouyinShareLinks([
    'https://open.douyin.com/player/video?vid=7533142185677114684&autoplay=1',
    'https://jingxuan.douyin.com/m/video/7641362696420887025',
    'https://www.douyin.com/user/example?modal_id=7512345678901234567',
    'https://www.douyin.com/user/not-a-video'
  ].join('\n'));

  assert.deepEqual(parsed.items.map(item => item.videoId), [
    '7533142185677114684',
    '7641362696420887025',
    '7512345678901234567'
  ]);
  assert.equal(parsed.ignoredCount, 1);
});
