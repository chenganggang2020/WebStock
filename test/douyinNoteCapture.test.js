const test = require('node:test');
const assert = require('node:assert/strict');
const capture = require('../electron/douyinPageCapture');
const { observationNeedsTranscription } = require('../electron/douyinAutoSync');
const { planIncrementalCandidates } = require('../services/douyinSyncPlanningService');
const { planFullArchiveQueue } = require('../services/douyinArchiveQueueService');
const { summarizeArchiveQueue } = require('../services/douyinArchiveQueueService');
const id = '7681478827298291658';
const detail = { awemeId: id, awemeType: 68, createTime: 1788483660,
  authorInfo: { nickname: '测试图文作者', secUid: 'MS4wLjABAAAAtestcreator' }, desc: '图文配文',
  images: [{ width: 1320, height: 2868, urlList: ['https://p9.douyinpic.com/a.webp?sign=temporary'] }] };

test('reads work-bound streamed SSR detail as JSON, without executing page scripts', () => {
  const script = 'self.__pace_f.push(' + JSON.stringify([1, '7:' + JSON.stringify(['$', '$L9', null,
    { awemeId: id, aweme: { statusCode: 0, detail } }]) + '\n']) + ')';
  const result = capture.extractDouyinEmbeddedDetail([script], id);
  assert.equal(result.profile.displayName, '测试图文作者');
  assert.equal(result.images.length, 1);
  assert.equal(result.publishedAt, '2026-09-04T01:01:00.000Z');
  assert.equal(capture.extractDouyinEmbeddedDetail([script], '7681478827298291699'), null);
  assert.equal(capture.extractDouyinEmbeddedDetail(['self.__pace_f.push(alert(1))'], id), null);
});

test('keeps ordered image slots, rejecting unsafe URLs rather than shifting page numbers', () => {
  const raw = { aweme_detail: { aweme_id: id, aweme_type: 68, author: {sec_uid:'MS4wLjABAAAAauthor'},
    images: [{url_list:['http://127.0.0.1/private']}, {url_list:['https://p3.douyinpic.com/p2.jpg']}] } };
  const result = capture.extractDouyinDetail(raw, id);
  assert.equal(result.images[0].url, '');
  assert.equal(result.images[1].index, 2);
  assert.equal(result.imageCount, 2);
  const normalized = capture.normalizeDouyinPageSnapshot({pageUrl:'https://www.douyin.com/note/'+id,
    pageType:'note', items:[{contentId:id, sourceUrl:'https://www.douyin.com/note/'+id,...result}]});
  assert.equal(normalized.items[0].imageCount, 2);
  assert.equal(normalized.items[0].images[1].index, 2);
});

test('notes never enter audio transcription and completed OCR is not polled again', () => {
  const note = {externalContentId:id,sourceUrl:'https://www.douyin.com/note/'+id, mediaType:'note',
    evidenceLevel:'primary',mediaMetadata:{incrementalPending:true,note:{status:'needs_review',imageCount:1,
      pages:[{index:1,status:'recognized',localAssetPath:'a.png',text:'已识别图片文字'}]}}};
  assert.equal(observationNeedsTranscription(note), false);
  assert.equal(planIncrementalCandidates([note]).length, 0);
  assert.equal(planFullArchiveQueue([note]).length, 0);
  note.mediaMetadata.note = {status:'partial',imageCount:2,pages:[]};
  assert.equal(planFullArchiveQueue([note]).length, 1);
});

test('archive queue reports outstanding note work after the first five-item batch',()=>{
  const works=Array.from({length:7},(_,index)=>({externalContentId:String(BigInt(id)+BigInt(index)),
    mediaType:'note',evidenceLevel:'primary',mediaMetadata:index<5 ? {note:{status:'needs_review',imageCount:1,
      pages:[{index:1,status:'recognized',localAssetPath:'image.png',text:'真实图文正文'}]}} : {}}));
  const summary=summarizeArchiveQueue(works);
  assert.equal(summary.videoCount,0);
  assert.equal(summary.noteCount,7);
  assert.equal(summary.pendingCount,2);
  assert.equal(summary.completedCount,5);
});
