const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'creator-media-test-'));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
test('media resolution accepts only a matching recorded MP4 under the real archive root', () => {
  const { resolveVideo } = require('../services/creatorMediaService');
  const filename = path.join(root, '7000000000000000001.mp4');
  fs.writeFileSync(filename, Buffer.from('0000ftypisom0000'));
  const observation = { externalContentId: '7000000000000000001', localAssetPath: filename };
  assert.equal(resolveVideo(observation, root), fs.realpathSync(filename));
  assert.throws(() => resolveVideo({ ...observation, localAssetPath: __filename }, root));
  assert.throws(() => resolveVideo({ ...observation, externalContentId: '7000000000000000002' }, root));
});
test('cover URLs exclude arbitrary hosts, insecure schemes and credentials', () => {
  const { allowedCoverUrl } = require('../services/creatorMediaService');
  assert.equal(allowedCoverUrl('https://p3-sign.douyinpic.com/cover.jpeg'), true);
  for (const url of ['http://p3-sign.douyinpic.com/x', 'https://127.0.0.1/x', 'https://douyinpic.com.evil.test/x',
    'https://user:password@p3-sign.douyinpic.com/x']) assert.equal(allowedCoverUrl(url), false);
});
