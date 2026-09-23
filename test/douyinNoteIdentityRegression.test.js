const test = require('node:test');
const assert = require('node:assert/strict');

const { selectVisibleProfileCandidate } = require('../electron/douyinPageCapture');

const noteUrl = 'https://www.douyin.com/note/7687442139320759150';
const unknownProfile = { profileUrl: '', displayName: '' };

test('note detail does not mistake the first recommended or comment account for its author', () => {
  const result = selectVisibleProfileCandidate([
    { href: 'https://www.douyin.com/user/recommended-account', text: '推荐作者' },
    { href: 'https://www.douyin.com/user/actual-note-author', text: '图文作者' },
    { href: 'https://www.douyin.com/user/commenter', text: '评论用户' }
  ], noteUrl, true);

  // None of these global links proves ownership of the current work.
  assert.deepEqual(result, unknownProfile);
});

test('one unbound profile link on a note page still does not establish work ownership', () => {
  assert.deepEqual(selectVisibleProfileCandidate([
    { href: 'https://www.douyin.com/user/recommended-account', text: '唯一可见推荐作者' }
  ], noteUrl, true), unknownProfile);
});

test('video detail uses the same unknown-author boundary for unbound global profile links', () => {
  assert.deepEqual(selectVisibleProfileCandidate([
    { href: 'https://www.douyin.com/user/self', text: '自己的账号' },
    { href: 'https://www.douyin.com/user/commenter', text: '评论用户' }
  ], 'https://www.douyin.com/video/7672339420096779953', true), unknownProfile);
});

test('author profile page keeps its own URL identity despite earlier unrelated profile links', () => {
  assert.deepEqual(selectVisibleProfileCandidate([
    { href: 'https://www.douyin.com/user/recommended-account', text: '推荐作者' },
    { href: 'https://www.douyin.com/user/note-author', text: '图文作者' }
  ], 'https://www.douyin.com/user/note-author?from=share', false), {
    profileUrl: 'https://www.douyin.com/user/note-author',
    displayName: '图文作者'
  });
});

test('invalid or self profile links cannot establish a note author', () => {
  assert.deepEqual(selectVisibleProfileCandidate([
    { href: 'https://www.douyin.com/user/self', text: '自己' },
    { href: 'https://douyin.com.example.com/user/not-douyin', text: '外站' },
    { href: 'http://www.douyin.com/user/insecure', text: '非 HTTPS' }
  ], noteUrl, true), unknownProfile);
});
