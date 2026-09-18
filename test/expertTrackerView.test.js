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
  vm.runInContext(source + '\nthis.helpers = { expertDisplayTitle, expertCreatorVideoCard, expertCreatorCommentsHtml, expertCommentCache, expertCreatorAsrStatus, expertCreatorAsrStatusLabel, expertCreatorVerificationStatus, expertCreatorStatusMessage, expertRunOutcome };', context, {
    filename: 'expertTracker.js'
  });
  return context.helpers;
}

test('finished collection with missing speech runtime is partial, not fully completed', () => {
  const helpers = loadHelpers();
  assert.match(helpers.expertRunOutcome({ status: 'completed', items: [
    { detailStatus: 'complete', transcriptionStatus: 'runtime_missing' }
  ] }).label, /待处理/);
  const item = { externalContentId: '7674168772814676657', sourceUrl: 'https://www.douyin.com/video/7674168772814676657',
    mediaMetadata: { asr: { status: 'runtime_missing' } } };
  assert.equal(helpers.expertCreatorAsrStatus(item), 'runtime_missing');
  assert.match(helpers.expertCreatorAsrStatusLabel('runtime_missing', true), /环境/);
});

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

test('low-confidence ASR has an explicit review status instead of looking complete', () => {
  const { expertCreatorAsrStatus, expertCreatorAsrStatusLabel, expertCreatorStatusMessage } = loadHelpers();
  const item = {
    externalContentId: '7930000000000000012',
    sourceUrl: 'https://www.douyin.com/video/7930000000000000012',
    transcript: '宇宿科技上市一周。',
    mediaMetadata: {
      detailCapturedAt: '2026-08-30T03:00:00.000Z',
      asr: { status: 'needs_review', quality: { reasons: ['low_log_probability'] } }
    }
  };

  const status = expertCreatorAsrStatus(item);
  assert.equal(status, 'needs_review');
  assert.equal(expertCreatorAsrStatusLabel(status, false), '转写待校对');
  assert.match(expertCreatorStatusMessage(item, status), /不应直接当作完整原话/);
});

test('a verified local archive stays verified when the original video later becomes unavailable', () => {
  const { expertCreatorVerificationStatus, expertCreatorVideoCard } = loadHelpers();
  const item = {
    id: 4618,
    channelId: 1,
    externalContentId: '7683835400880691953',
    sourceUrl: 'https://www.douyin.com/video/7683835400880691953',
    title: '已归档视频',
    availabilityStatus: 'available',
    transcript: '本地已保存的逐字稿',
    mediaMetadata: {
      archive: {
        status: 'complete',
        verificationMode: 'current_content_id',
        mediaSha256: 'a'.repeat(64),
        mediaBytes: 980657,
        localAssetPath: 'D:/archive/7683835400880691953.mp4'
      },
      asr: { status: 'needs_review' }
    }
  };

  let verification = expertCreatorVerificationStatus(item);
  assert.equal(verification.status, 'verified_archive');
  assert.equal(verification.label, '已核验归档');
  let html = expertCreatorVideoCard(item, false, false);
  assert.match(html, /已核验归档/);
  assert.match(html, /转写待校对/);
  assert.doesNotMatch(html, />待复核</);

  item.availabilityStatus = 'unavailable';
  item.mediaMetadata.remote = { status: 'unavailable', checkedAt: '2026-09-10T13:00:00.000Z' };
  verification = expertCreatorVerificationStatus(item);
  assert.equal(verification.status, 'verified_unavailable');
  assert.equal(verification.label, '已核验 · 原视频不可访问');
  html = expertCreatorVideoCard(item, false, false);
  assert.match(html, /已核验 · 原视频不可访问/);
  assert.match(html, /转写待校对/);
  assert.doesNotMatch(html, />待复核</);
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
