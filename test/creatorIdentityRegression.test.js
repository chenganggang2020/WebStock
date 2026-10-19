const test = require('node:test');
const assert = require('node:assert/strict');
process.env.WEBSTOCK_DB_PATH = ':memory:';
const channels = require('../services/expertChannelService');
test('same-name Douyin authors have separate profile identities while repeated profiles reuse the channel', () => {
  const a = channels.createChannel({ displayName: '同名作者', platform: 'douyin', profileUrl: 'https://www.douyin.com/user/author-a' });
  const b = channels.createChannel({ displayName: '同名作者', platform: 'douyin', profileUrl: 'https://www.douyin.com/user/author-b' });
  assert.notEqual(a.id, b.id);
  const renamed = channels.createChannel({ displayName: '新名称', platform: 'douyin', profileUrl: 'https://www.douyin.com/user/author-a/?from=share' });
  assert.equal(renamed.id, a.id);
  assert.equal(channels.getChannel(b.id).profileUrl, b.profileUrl);
});
test.after(() => require('../db').close());
