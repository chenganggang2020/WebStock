const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/modules/expertTracker.js'), 'utf8');

test('multi-author selection is independent from the current video reader and safely escaped', () => {
  const target = {innerHTML:''};
  const context = {document:{getElementById:() => target},expertChannels:[{id:1,platform:'douyin',displayName:'<bad>',enabled:true},{id:2,platform:'douyin',displayName:'作者二',enabled:true}], expertBatchSelected:new Set([2]), expertEscape:value => String(value).replaceAll('<','&lt;').replaceAll('>','&gt;')};
  vm.createContext(context);
  const start = source.indexOf('function expertRenderBatchAuthors(');
  const end = source.indexOf('\nasync function expertLoadCollectionQueue', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start,end),context);
  context.expertRenderBatchAuthors();
  assert.match(target.innerHTML, /&lt;bad&gt;/);
  assert.match(target.innerHTML, /value="2" checked/);
  assert.doesNotMatch(source.slice(start,end), /expertActivateChannel/);
});

test('author form accepts share text and save-and-scan uses durable queue', () => {
  const html = fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  assert.match(html, /<textarea id="creatorAccountUrl"/);
  assert.match(html, /id="creatorSaveAndScan"/);
  assert.match(source, /\/api\/expert\/resolve-profile/);
  assert.match(source, /\/api\/expert\/collection-queue/);
  assert.match(source, /expertBatchSelected/);
  assert.match(source, /workerRunning/);
  assert.ok(source.includes("expertEnqueueCreators([channel.id], 'archive', model, selectionId)"), 'save-and-scan retains its submitted author, archive mode and model');
});

test('current-author queue parameters do not reuse the multi-author selection or its parameters', async () => {
  const calls=[];
  const context=vm.createContext({document:{getElementById:id=>({value:id==='creatorBatchMode'?'archive':'large-v3'})},
    expertAuthorSelectionId: 0, expertApi:async(url,options)=>{calls.push(options.body);return [{}];},expertSetStatus(){},expertLoadCollectionQueue:async()=>{}});
  const start=source.indexOf('async function expertEnqueueCreators('),end=source.indexOf('\nfunction expertResetCreatorFilters',start);
  vm.runInContext(source.slice(start,end),context);
  await context.expertEnqueueCreators([2],'incremental','small');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),{channelIds:[2],mode:'incremental',model:'small'});
  await context.expertEnqueueCreators([1,3]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1])),{channelIds:[1,3],mode:'archive',model:'large-v3'});
});
