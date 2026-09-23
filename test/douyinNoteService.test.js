const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-note-service-'));
test.after(() => fs.rmSync(root, {recursive:true,force:true}));
const {createDouyinNoteService} = require('../services/douyinNoteService');
const id='7681478827298291658';
const png=Buffer.from('89504e470d0a1a0a0000000d49484452','hex');

test('archives ordered pages and keeps OCR text separate from a voice transcript', async () => {
  const service=createDouyinNoteService({root, download:async()=>png, recognize:async()=>({text:'本地识别的原图文字',engine:'windows-ocr'})});
  const result=await service.process({channelId:5,contentId:id,imageCount:2,
    images:[{url:'https://p3.douyinpic.com/1.png'},{url:'https://p3.douyinpic.com/2.png'}]});
  assert.equal(result.status,'needs_review');
  assert.deepEqual(result.pages.map(p=>p.index),[1,2]);
  assert.ok(result.pages.every(p=>fs.existsSync(p.localAssetPath)&&p.sha256.length===64));
  assert.ok(result.pages[0].localAssetPath.includes(path.join('notes','5',id)));
  assert.equal(result.transcript,undefined);
  assert.ok(!JSON.stringify(result).includes('douyinpic.com'));
});

test('unsafe or missing image pages produce a partial result and do not shift page order', async () => {
  let requests=0;
  const service=createDouyinNoteService({root,download:async()=>{requests++;return png;},recognize:async()=>({text:''})});
  const result=await service.process({channelId:6,contentId:id,imageCount:3,
    images:[{url:'http://127.0.0.1/internal'},{url:'https://p3.douyinpic.com/2.png'}]});
  assert.equal(requests,1);
  assert.equal(result.status,'partial');
  assert.deepEqual(result.pages.map(p=>p.status),['error','no_text','error']);
});

test('OCR failure retains the original image and never claims no text', async () => {
  const service=createDouyinNoteService({root,download:async()=>png,recognize:async()=>{throw Error('test OCR missing');}});
  const result=await service.process({channelId:7,contentId:id,imageCount:1,images:[{url:'https://p3.douyinpic.com/1.png'}]});
  assert.equal(result.status,'partial');
  assert.equal(result.pages[0].status,'error');
  assert.ok(fs.existsSync(result.pages[0].localAssetPath));
  await assert.rejects(service.process({channelId:'../5',contentId:id}),/作者/);
});

test('Han spacing is normalized for search while untouched OCR evidence is retained',async()=>{
  const service=createDouyinNoteService({root,download:async()=>png,recognize:async()=>({text:'铝 电 解 电 容 器\nAI Server 70 80'})});
  const result=await service.process({channelId:8,contentId:id,imageCount:1,images:[{url:'https://p3.douyinpic.com/1.png'}]});
  assert.equal(result.pages[0].text,'铝电解电容器\nAI Server 70 80');
  assert.equal(result.pages[0].rawText,'铝 电 解 电 容 器\nAI Server 70 80');
});
