const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveDouyinProfile } = require('../services/douyinProfileResolver');

test('share text follows only approved redirects and preserves case-sensitive author identity', async () => {
  const visited = [];
  const result = await resolveDouyinProfile('0- 打开抖音 https://v.douyin.com/AbCd/ 5@5.com', {
    request: async url => { visited.push(url); return { status: 302, headers: {
      location: 'https://www.iesdouyin.com/share/user/MS4w.Ab_CD?sec_uid=tracking&iid=private'
    } }; }
  });
  assert.equal(result.profileUrl, 'https://www.douyin.com/user/MS4w.Ab_CD');
  assert.deepEqual(visited, ['https://v.douyin.com/AbCd/']);
  assert.equal(result.identityVerified, false);
});
test('a canonical profile needs no network and strips tracking only', async () => {
  const result = await resolveDouyinProfile('https://www.douyin.com/user/Ab_Cd/?iid=123');
  assert.equal(result.profileUrl, 'https://www.douyin.com/user/Ab_Cd');
});
test('rejects foreign redirects, credentials, multiple authors and video links', async () => {
  for (const value of ['https://evil.example/user/a', 'https://x@www.douyin.com/user/a',
    'https://www.douyin.com/video/1234567890123', 'https://www.douyin.com/user/a https://www.douyin.com/user/b']) {
    await assert.rejects(resolveDouyinProfile(value));
  }
  await assert.rejects(resolveDouyinProfile('https://v.douyin.com/abc/', {
    request: async () => ({status:302,headers:{location:'http://127.0.0.1:3000/private'}})
  }), /不允许/);
});
test('redirect loops stop with an explicit error', async () => {
  let count = 0;
  await assert.rejects(resolveDouyinProfile('https://v.douyin.com/abc/', {
    request: async () => { count++; return {status:302,headers:{location:'https://v.douyin.com/abc/'}}; }
  }), /重定向/);
  assert.ok(count <= 5);
});
