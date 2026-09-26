const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-local-task-'));
test.after(() => fs.rmSync(mediaRoot, {recursive:true,force:true}));
function fixture() {
  const item = { id: 7, channelId: 1, externalContentId: '7000000000000000001',
    sourceUrl: 'https://www.douyin.com/video/7000000000000000001', evidenceLevel: 'primary',
    localAssetPath: path.join(mediaRoot, '7000000000000000001.mp4'), title: 'test', mediaMetadata: {} };
  fs.writeFileSync(item.localAssetPath, 'isolated media fixture');
  const calls = [];
  return { item, calls, deps: {
    mediaRoot,
    channels: { getChannel() { return { platform: 'douyin' }; }, getObservation() { return item; } },
    sessionManager: { async captureUrl(url) { calls.push(url); return { loggedIn: true, items: [{ contentId: item.externalContentId }] }; } },
    sources: { verifyCapturedIdentity() { return { matched: true }; }, importCapturedPage() { calls.push('import'); },
      applyMediaArchive() {}, applyTranscription() { calls.push('transcribed'); } },
    transcriber: { async transcribe() { calls.push('ASR'); return { transcript: 'text', status: 'complete' }; } }
  } };
}
test('single-video transcription uses its local archive without browsing profiles or other videos', async () => {
  const f = fixture();
  const { runDouyinVideoTask } = require('../electron/douyinVideoTask');
  await runDouyinVideoTask(f.deps, 1, 7, 'transcribe');
  assert.deepEqual(f.calls, ['ASR', 'transcribed']);
});

test('a stale saved pathname is not mistaken for a usable local archive', async () => {
  const f = fixture();
  f.item.localAssetPath = path.join(mediaRoot, 'missing', f.item.externalContentId+'.mp4');
  f.deps.sessionManager.captureUrl = async () => { throw Error('login needed for new download'); };
  const {runDouyinVideoTask} = require('../electron/douyinVideoTask');
  await assert.rejects(runDouyinVideoTask(f.deps,1,7,'transcribe'),/login needed/);
  assert.deepEqual(f.calls,[]);
});

test('fully archived note can be re-read without an online login and reports OCR outcome', async () => {
  const f = fixture();
  f.item.mediaType='note'; f.item.sourceUrl=f.item.sourceUrl.replace('/video/','/note/');
  const {createDouyinNoteService} = require('../services/douyinNoteService');
  const png=Buffer.from('89504e470d0a1a0a0000000d49484452','hex');
  const service=createDouyinNoteService({root:mediaRoot,download:async()=>png,recognize:async()=>({text:'原图文字'})});
  f.item.mediaMetadata.note=await service.process({channelId:1,contentId:f.item.externalContentId,
    images:[{url:'https://p3.douyinpic.com/1.png'}],imageCount:1});
  f.deps.sessionManager.captureUrl=async()=>{throw Error('must not need login');};
  let applied;
  f.deps.noteProcessor=createDouyinNoteService({root:mediaRoot,download:async()=>{throw Error('must not download');},recognize:async()=>({text:'重新识别的原图文字'})});
  f.deps.sources.applyNoteResult=(_channel,_id,result)=>{applied=result;};
  const {runDouyinVideoTask}=require('../electron/douyinVideoTask');
  const result=await runDouyinVideoTask(f.deps,1,7,'transcribe');
  assert.equal(applied.pages[0].text,'重新识别的原图文字');
  assert.equal(result.transcriptionStatus,'ocr_complete');
});

test('single-video processing returns review-needed instead of false complete',async()=>{
  const f=fixture();
  f.deps.transcriber.transcribe=async()=>({transcript:'不确定的语音',status:'needs_review'});
  const {runDouyinVideoTask}=require('../electron/douyinVideoTask');
  const result=await runDouyinVideoTask(f.deps,1,7,'transcribe');
  assert.equal(result.transcriptionStatus,'needs_review');
});
test('comment update captures only the selected video and never invokes transcription', async () => {
  const f = fixture();
  const { runDouyinVideoTask } = require('../electron/douyinVideoTask');
  await runDouyinVideoTask(f.deps, 1, 7, 'comments');
  assert.deepEqual(f.calls, [f.item.sourceUrl, 'import']);
});
test('single-video actions reject unsafe source identity and unknown stages before navigation', async () => {
  const f = fixture();
  const { runDouyinVideoTask } = require('../electron/douyinVideoTask');
  f.item.sourceUrl = 'https://example.com/video/7000000000000000001';
  await assert.rejects(runDouyinVideoTask(f.deps, 1, 7, 'comments'));
  await assert.rejects(runDouyinVideoTask(f.deps, 1, 7, 'delete'));
  assert.equal(f.calls.length, 0);
});

test('single-video retry forwards the chosen local model and real duration', async () => {
  const f = fixture();
  f.item.mediaMetadata.durationSeconds = 3800;
  f.item.mediaMetadata.asr = {mediaSha256:'a'.repeat(64)};
  f.item.mediaMetadata.archive = {mediaSha256:'invalid-legacy-hash'};
  let input;
  f.deps.transcriber.transcribe = async value => { input = value; return {transcript:'文本',status:'complete'}; };
  const { runDouyinVideoTask } = require('../electron/douyinVideoTask');
  await runDouyinVideoTask(f.deps, 1, 7, 'transcribe', () => {}, {model:'large-v3-turbo'});
  assert.equal(input.model, 'large-v3-turbo');
  assert.equal(input.provider, 'local');
  assert.equal(input.durationSeconds, 3800);
  assert.equal(input.expectedSha256, 'a'.repeat(64));
  await assert.rejects(runDouyinVideoTask(f.deps, 1, 7, 'transcribe', () => {}, {model:'unexpected'}), /不支持/);
});
