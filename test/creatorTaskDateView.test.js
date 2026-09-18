const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/modules/expertTracker.js'), 'utf8');
function setup() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', innerHTML: '', style: { display: '', setProperty() {} }, classList: { toggle() {} }, addEventListener() {} });
    return nodes.get(id);
  };
  node('expertChannelSelect').value = '1';
  node('creatorTaskDate').value = '2026-09-10';
  node('creatorTaskDateMode').value = 'published';
  const ctx = vm.createContext({ window: {}, document: { getElementById: node }, Date, Intl, URL, console });
  vm.runInContext(source, ctx);
  const run = code => vm.runInContext(code, ctx);
  run(`expertChannels = [{id:1,platform:'douyin'},{id:2,platform:'douyin'}];
    expertCreatorTaskDate = '2026-09-10';
    expertRenderDouyinSyncState = function() {};
    expertRenderCreatorWorkbench = function() {};
    expertRenderCreatorRunAudit = function() {};
    expertObservations = [
      {id:1, externalContentId:'old', publishedAt:'2026-09-03T03:00:00Z', firstSeenAt:'2026-09-10T03:00:00Z'},
      {id:2, externalContentId:'today', publishedAt:'2026-09-09T16:05:00Z'},
      {id:3, externalContentId:'unknown', firstSeenAt:'2026-09-10T03:00:00Z'}];`);
  const ids = () => JSON.parse(run('JSON.stringify(expertCreatorFilteredVideos(expertObservations).map(x=>x.id))'));
  return { node, ctx, run, ids };
}
test('publication day filters actual video list, never first-seen or unknown dates', () => {
  const { run, ids } = setup();
  assert.deepEqual(ids(), [2]);
  run("expertCreatorTaskDate = '2026-09-08'"); assert.deepEqual(ids(), []);
  run("expertCreatorTaskDateMode = 'all'"); assert.deepEqual(ids(), [1,2,3]);
});
test('task scope uses recorded run items, including historical videos; zero-item run is empty', () => {
  const { run, ids } = setup();
  run(`expertCreatorTaskDateMode='run'; expertCreatorTaskRuns=[{id:11,items:[{contentId:'old'}]},{id:12,items:[]}];
    expertCreatorTaskRunsKey='1:2026-09-10'; expertCreatorTaskRunsLoading=false;`);
  assert.deepEqual(ids(), [1]);
  run('expertCreatorSelectedRunId=12'); assert.deepEqual(ids(), []);
  run('expertCreatorSelectedRunId=11'); assert.deepEqual(ids(), [1]);
  run('expertCreatorTaskRunsLoading=true'); assert.deepEqual(ids(), []);
});
test('view-run action selects exact recorded items without changing publication records', () => {
  const { run, node, ids } = setup();
  run(`expertCreatorTaskRuns=[{id:11,items:[{contentId:'old'}]}]; expertCreatorTaskRunsKey='1:2026-09-10';
    expertSelectCreatorRun(11);`);
  assert.equal(node('creatorTaskDateMode').value, 'run'); assert.deepEqual(ids(), [1]);
  assert.equal(run('expertObservations[0].publishedAt'), '2026-09-03T03:00:00Z');
});
test('research view is not restricted by collection-page date controls', () => {
  const { node, ids } = setup(); node('creatorTasksView').style.display='none'; assert.deepEqual(ids(), [1,2,3]);
});
test('date requests keep latest status runs separate and reject late previous-date responses', async () => {
  const { run, ctx, node } = setup(); const pending=[];
  ctx.fetchTest = url => new Promise(resolve => pending.push({url,resolve})); run('expertApi=fetchTest');
  const old = run('expertLoadDouyinSyncState()');
  node('creatorTaskDate').value='2026-09-09'; const current=run('expertLoadDouyinSyncState()');
  for (const request of pending.slice(3)) request.resolve(request.url.endsWith('/sync') ? {lastCompletedAt:'new'} : [{id:request.url.includes('date=')?9:99,items:[]}]);
  await current;
  for (const request of pending.slice(0,3)) request.resolve(request.url.endsWith('/sync') ? {lastCompletedAt:'old'} : [{id:10,items:[]}]);
  await old;
  assert.equal(run('expertCreatorTaskRuns[0].id'),9); assert.equal(run('expertDouyinSyncRuns[0].id'),99);
  assert.equal(run('expertDouyinSyncState.lastCompletedAt'),'new');
  assert.equal(run('expertCreatorTaskRunsKey'),'1:2026-09-09');
});
test('run API failure clears task scope and never falls back to entire library', async () => {
  const { run, ctx, node, ids } = setup();
  node('creatorTaskDateMode').value='run'; ctx.failTest=async()=>{throw new Error('网络中断');}; run('expertApi=failTest');
  await assert.rejects(run('expertLoadDouyinSyncState()'), /网络中断/);
  assert.deepEqual(ids(), []); assert.match(run('expertCreatorTaskRunsError'),/网络中断/);
});
test('switching authors clears visible old videos before a pending or failed response', async () => {
  const {run,ctx,node}=setup(); let reject;
  node('expertCreatorVideoList').innerHTML='old author video'; node('expertCreatorVideoDetail').innerHTML='old author detail';
  ctx.fetchTest=()=>new Promise((resolve,fail)=>{reject=fail;});
  run('expertApi=fetchTest; expertResetAnalysisPacket=function(){};');
  const switching=run('expertActivateChannel(2)');
  assert.doesNotMatch(node('expertCreatorVideoList').innerHTML,/old author/);
  assert.equal(node('expertCreatorVideoDetail').innerHTML,'');
  reject(new Error('作者请求失败')); await assert.rejects(switching,/作者请求失败/);
  assert.doesNotMatch(node('expertCreatorVideoList').innerHTML,/old author/);
});
test('identical same-scope polls do not replace the current workbench DOM', async () => {
  const {run,ctx}=setup();
  ctx.fetchTest=async url=>url.endsWith('/sync')?{lastCompletedAt:'same'}:[{id:11,items:[]}];
  run('expertApi=fetchTest; var paints=0; expertRenderDouyinSyncState=function(){paints++;};');
  await run('expertLoadDouyinSyncState()'); assert.equal(run('paints'),1);
  await run('expertLoadDouyinSyncState()'); assert.equal(run('paints'),1);
});
