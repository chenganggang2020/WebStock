const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadHelpers() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'modules', 'expertTracker.js'), 'utf8');
  const context = vm.createContext({
    window: {}, console, URL, setInterval() { return 1; }, clearInterval() {}
  });
  vm.runInContext(source + '\nthis.helpers = { expertDisplayTitle, expertCreatorVideoCard, expertCreatorCommentsHtml, expertCommentCache };', context, {
    filename: 'expertTracker.js'
  });
  return context.helpers;
}

test('generic Douyin titles use a clearly labelled content-extracted title', () => {
  const { expertDisplayTitle } = loadHelpers();
  const title = expertDisplayTitle({
    title: '模型先生于20211009发布的作品',
    transcript: '近期科技股进入分化。后续需要关注产业增量。'
  });

  assert.equal(title.text, '近期科技股进入分化');
  assert.equal(title.sourceLabel, '内容提取标题');
  assert.equal(title.originalTitle, '模型先生于20211009发布的作品');
});

test('creator video cards render saved covers and identify the title source', () => {
  const { expertCreatorVideoCard } = loadHelpers();
  const html = expertCreatorVideoCard({
    id: 7,
    externalContentId: '7674168772814676657',
    sourceUrl: 'https://www.douyin.com/video/7674168772814676657',
    title: '明确的平台标题',
    publishedAt: '2026-08-15T08:00:00.000Z',
    mediaMetadata: { coverUrl: 'https://p3-sign.douyinpic.com/cover.jpeg' }
  }, false, false);

  assert.match(html, /creator-video-cover/);
  assert.match(html, /cover\.jpeg/);
  assert.match(html, /来源标题/);
  assert.match(html, /data-video-source="douyin"/);
});

test('creator detail highlights verified replies without claiming complete comment coverage', () => {
  const { expertCreatorCommentsHtml, expertCommentCache } = loadHelpers();
  expertCommentCache.set(8, {
    status: 'complete',
    data: {
      coverage: { status: 'visible_partial', message: '仅采集当前页面可见范围' },
      comments: [{ commentId: 'q1', authorName: '读者', text: '怎么看？' }, {
        commentId: 'r1', parentCommentId: 'q1', authorName: '模型先生', text: '先看分化。',
        creatorStatus: 'verified'
      }]
    }
  });
  const html = expertCreatorCommentsHtml({ id: 8 });
  assert.match(html, /仅采集时页面可见范围/);
  assert.match(html, /作者本人 · 主页一致/);
  assert.match(html, /回复 读者：怎么看？/);
  assert.match(html, /先看分化/);
});
