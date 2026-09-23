const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'douyin-note-pipeline-'));
process.env.WEBSTOCK_DB_PATH=path.join(dir,'test.db');
const db=require('../db');
const channels=require('../services/expertChannelService');
const sources=require('../services/douyinSourceService');
const knowledge=require('../services/knowledgeService');
const {createDouyinAutoSync}=require('../electron/douyinAutoSync');
const {createDouyinNoteService}=require('../services/douyinNoteService');
const {runDouyinVideoTask}=require('../electron/douyinVideoTask');
test.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
const id='7681478827298291658';

test('author collection and selected-work retry index actual ordered OCR without audio ASR',async()=>{
  const channel=channels.createChannel({channelKey:'note-pipeline',platform:'douyin',displayName:'图文作者',
    profileUrl:'https://www.douyin.com/user/MS4wLjABAAAAnoteauthor'});
  const work={contentId:id,sourceUrl:'https://www.douyin.com/note/'+id,mediaType:'note',title:'原图测试标题'};
  const profile={pageType:'profile',pageUrl:channel.profileUrl,loggedIn:true,profile:{profileUrl:channel.profileUrl,displayName:channel.displayName},items:[work]};
  const detail={...profile,pageType:'note',pageUrl:work.sourceUrl,items:[{...work,description:'作者配文，正文见图片',
    publishedAt:'2026-09-04T01:01:00.000Z',imageCount:1,images:[{index:1,url:'https://p3.douyinpic.com/1.png'}]}]};
  let speechAttempts=0;
  const deps={channels,sources,sessionManager:{captureUrl:async url=>url===channel.profileUrl?profile:detail},
    noteProcessor:createDouyinNoteService({root:dir,download:async()=>Buffer.from('89504e470d0a1a0a','hex'),
      recognize:async()=>({text:'原图核验关键词金属铟，江海股份（002484）的交期与库存的关联需要后续证据'})}),
    transcriber:{transcribe:async()=>{speechAttempts++;throw Error('must not call');}},
    syncState:{markRunning(){},markCompleted(){},markFailed(){}}};
  const result=await createDouyinAutoSync(deps).syncChannel(channel.id,{trigger:'manual'});
  let saved=channels.findObservationByIdentity(channel.id,{externalContentId:id});
  assert.equal(result.detailedCount,1);
  assert.equal(saved.mediaMetadata.note.status,'needs_review');
  assert.equal(saved.transcript,'');
  assert.ok(saved.content.includes('金属铟'));
  assert.ok(saved.stockCodes.includes('002484'));
  assert.ok(knowledge.getSource(saved.knowledgeSourceId).content.includes('金属铟'));
  assert.ok(!JSON.stringify(saved.mediaMetadata).includes('douyinpic.com/1.png'));
  // A metadata refresh must not replace full OCR content with the short description.
  sources.importCapturedPage(channel.id,detail);
  saved=channels.getObservation(channel.id,saved.id);
  assert.ok(saved.content.includes('金属铟'));
  assert.ok(saved.stockCodes.includes('002484'),'刷新配文必须保留来自图片正文的股票线索');
  await runDouyinVideoTask(deps,channel.id,saved.id,'transcribe');
  assert.equal(speechAttempts,0);
  sources.applyNoteResult(channel.id,id,{status:'partial',imageCount:1,pages:[{index:1,status:'error',text:''}]});
  assert.ok(channels.getObservation(channel.id,saved.id).content.includes('金属铟'));
});

test('partial retries accumulate successful pages without claiming a wholly fresh complete snapshot',()=>{
  const channel=channels.createChannel({channelKey:'partial-pages',platform:'douyin',displayName:'多页作者'});
  const observation=channels.recordObservation(channel.id,{externalContentId:id,title:'多页正文',mediaType:'note',evidenceLevel:'primary'});
  const page=(index,text)=>({index,status:'recognized',text,localAssetPath:'page'+index+'.png',sha256:'b'.repeat(64),mimeType:'image/png',bytes:123});
  sources.applyNoteResult(channel.id,id,{status:'partial',imageCount:2,pages:[page(1,'第一页已取得的完整原图正文'),{index:2,status:'error'}]});
  sources.applyNoteResult(channel.id,id,{status:'partial',imageCount:2,pages:[{index:1,status:'error'},page(2,'第二页重试得到的完整原图正文')]});
  const saved=channels.getObservation(channel.id,observation.id);
  assert.ok(saved.content.includes('第一页已取得'));
  assert.ok(saved.content.includes('第二页重试得到'));
  assert.equal(saved.mediaMetadata.note.status,'partial');
  assert.ok(saved.mediaMetadata.noteHistory.length>0);
});
