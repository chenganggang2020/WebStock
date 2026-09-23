const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup() {
  const nodes = new Map();
  function element() {
    const children = new Map();
    let html = '';
    return { writes:0, style:{setProperty(){}}, dataset:{}, classList:{toggle(){}},
      get innerHTML(){return html;}, set innerHTML(value){html=value;this.writes++;children.clear();},
      paused:true, replaceWith(){}, addEventListener(){}, querySelector(key){if(!children.has(key))children.set(key,element());return children.get(key);}
    };
  }
  const node = id => {if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  node('expertChannelSelect').value='1';
  const item={id:1,channelId:1,externalContentId:'70000000000000001',sourceUrl:'https://www.douyin.com/video/70000000000000001',
    title:'测试视频',publishedAt:'2026-09-18T08:00:00Z',localAssetPath:'local.mp4',transcript:'这是原始逐字稿。',
    topics:[],stockCodes:[],sectors:[],mediaMetadata:{asr:{status:'complete',segments:[]}},signal:{keyPoints:['测试规则摘句']}};
  const context=vm.createContext({window:{},document:{getElementById:node},console,Date,Intl,URL,item});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/modules/expertTracker.js'),'utf8'),context);
  const run=code=>vm.runInContext(code,context);
  run(`expertChannels=[{id:1,platform:'douyin'}];expertCreatorTaskDateMode='all';
    expertLoadCreatorComments=function(){};expertObservations=[item];expertSelectedVideoId=1;`);
  return {node,run,context,item};
}

test('same-video status redraws keep the player attached and leave unchanged reading DOM intact',()=>{
  const {node,run}=setup();
  run('expertRenderCreatorDetail(item)');
  const target=node('expertCreatorVideoDetail');
  const body=target.querySelector('.creator-reading-body');
  const firstWrites=target.writes, bodyWrites=body.writes;
  run('expertRenderCreatorDetail(item)');
  assert.equal(target.writes,firstWrites,'polling must not detach and reinsert the media player');
  assert.equal(body.writes,bodyWrites,'unchanged transcript must preserve selection and scroll');
  run("expertCreatorDetailTab='comments';expertRenderCreatorDetail(item)");
  assert.equal(target.writes,firstWrites,'switching reader tabs must not recreate the video');
  assert.match(body.innerHTML,/公开评论/);
  assert.doesNotMatch(body.innerHTML,/这是原始逐字稿/);
});

test('transcript, signals, comments and provenance have separate accessible tabs',()=>{
  const {node,run}=setup();run('expertRenderCreatorDetail(item)');
  const target=node('expertCreatorVideoDetail');
  assert.match(target.innerHTML,/creator-detail-workspace/);
  const tabs=target.querySelector('.creator-detail-tabs');
  for(const label of ['逐字稿','观点线索','评论','来源'])assert.ok(tabs.innerHTML.includes(label));
  assert.match(tabs.innerHTML,/aria-selected="true"/);
  assert.doesNotMatch(target.querySelector('.creator-reading-body').innerHTML,/规则摘句/);
});

test('large creator library renders the first 40 entries and retains them on status-only polls',()=>{
  const {node,run}=setup();
  run(`expertObservations=Array.from({length:419},(_,i)=>({...item,id:i+1,externalContentId:String(70000000000000000n+BigInt(i)),title:'样本'+i}));
    expertRenderCreatorDetail=function(){};expertRenderCreatorWorkbench();`);
  const list=node('expertCreatorVideoList');
  assert.equal((list.innerHTML.match(/data-video-id=/g)||[]).length,40);
  assert.match(list.innerHTML,/creator-load-more/);
  const paints=list.writes;
  run('expertRenderCreatorWorkbench()');
  assert.equal(list.writes,paints,'progress polling should not recreate covers and rows');
  run('expertCreatorVisibleLimit+=40;expertRenderCreatorWorkbench()');
  assert.equal((list.innerHTML.match(/data-video-id=/g)||[]).length,80);
});

test('image-text works appear in the creator list and show image pages with OCR, not a video player',()=>{
  const {node,run,item}=setup();
  item.mediaType='note';item.sourceUrl='https://www.douyin.com/note/'+item.externalContentId;
  item.localAssetPath='';item.transcript='';item.description='作者配文';
  item.mediaMetadata={note:{status:'needs_review',imageCount:1,pages:[{index:1,localAssetPath:'page.webp',
    sha256:'a'.repeat(64),text:'图片原文 <script>alert(1)</script>'}]}};
  assert.equal(run('expertCreatorVideos().length'),1);
  run('expertRenderCreatorDetail(item)');
  const target=node('expertCreatorVideoDetail');
  assert.match(target.querySelector('.creator-player-slot').innerHTML,/\/images\/1/);
  assert.doesNotMatch(target.querySelector('.creator-player-slot').innerHTML,/<video/);
  assert.match(target.querySelector('.creator-reading-body').innerHTML,/图片 1/);
  assert.match(target.querySelector('.creator-reading-body').innerHTML,/&lt;script&gt;/);
  assert.doesNotMatch(target.querySelector('.creator-media-actions').innerHTML,/下载视频|重新转写/);
});
