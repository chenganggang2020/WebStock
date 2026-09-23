// Read-only diagnostic reproductions against the actual frontend modules.
// These assert the requested behavior and are EXPECTED TO FAIL before a fix.
// No production API, database, collection, or AI task is called.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sourceRoot = path.resolve(__dirname, '..');
const source = name => fs.readFileSync(path.join(sourceRoot, 'js/modules', name + '.js'), 'utf8');

function creator(fetch) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value: '', textContent: '', innerHTML: '', dataset: {},
      style: {display: '', setProperty() {}},
      classList: {toggle() {}, remove() {}, add() {}, contains() {return true;}},
      setAttribute() {}, addEventListener() {}, querySelector() {return null;}
    });
    return nodes.get(id);
  };
  node('expertChannelSelect').value = '5';
  node('creatorTaskChannelSelect').value = '5';
  node('creatorTaskDate').value = '2026-09-22';
  node('creatorTaskDateMode').value = 'all';
  const context = vm.createContext({window: {apiFetch: fetch}, document: {getElementById: node}, console, URL, Date, Intl});
  vm.runInContext(source('expertTracker'), context);
  const run = code => vm.runInContext(code, context);
  run(`expertChannels = [
    {id:5, platform:'douyin', displayName:'开着坦克带你吃', observationCount:150, collectionMediaType:'note'},
    {id:4, platform:'douyin', displayName:'Fioona', observationCount:157, collectionMediaType:'video'}
  ]; expertRenderCreatorTaskPipeline();`);
  return {run, node};
}

test('switching author immediately updates BOTH visible author summaries', async () => {
  let fail;
  const waiting = new Promise((resolve, reject) => {fail = reject;});
  const r = creator(() => waiting);
  const activation = r.run('expertActivateChannel(4)');
  const settled = activation.catch(() => {});
  const primary = r.node('creatorActiveName').textContent;
  const summary = r.node('creatorTaskStatus').textContent;
  fail(new Error('fixture timeout'));
  await settled;
  assert.equal(primary, 'Fioona');
  assert.match(summary, /Fioona/, 'top-right summary still identifies previous author');
});

test('successful observations remain usable if the unrelated backtest request fails', async () => {
  const r = creator(async url => {
    if (url.includes('/observations?')) return [{id:1, channelId:4, title:'saved work'}];
    if (url.includes('/backtests?')) throw new Error('backtest timed out');
    throw new Error('unexpected fixture URL ' + url);
  });
  r.node('expertChannelSelect').value = '4';
  await r.run('expertLoadTimeline()').catch(() => {});
  assert.equal(r.run('expertObservations.length'), 1, 'Promise.all drops the successful observations response');
});

test('a status poll does not label pending observation requests as a genuine empty library', async () => {
  let fail;
  const waiting = new Promise((resolve, reject) => {fail = reject;});
  const r = creator(async url => {
    if (url.includes('/observations?') || url.includes('/backtests?')) return waiting;
    if (url.endsWith('/sync')) return {channelId:4, status:'idle'};
    if (url.includes('/sync/runs?')) return [];
    throw new Error('unexpected fixture URL ' + url);
  });
  const activation = r.run('expertActivateChannel(4)');
  const settled = activation.catch(() => {});
  await r.run('expertLoadDouyinSyncState()');
  const html = r.node('expertCreatorVideoList').innerHTML;
  fail(new Error('fixture timeout'));
  await settled;
  assert.doesNotMatch(html, /没有符合筛选条件/, 'a separate status poll painted an empty list while observations were pending');
});

test('poll recovery reloads previously failed observations even when no new collection completed', async () => {
  let observationReads = 0;
  const r = creator(async url => {
    if (url.includes('/observations?')) {observationReads++; return [{id:1, channelId:4}];}
    if (url.endsWith('/sync')) return {channelId:4, status:'idle', lastCompletedAt:'2026-09-22T10:00:00Z'};
    if (url.includes('/sync/runs?') || url.includes('/backtests?')) return [];
    throw new Error('unexpected fixture URL ' + url);
  });
  r.node('expertChannelSelect').value = '4';
  r.run(`expertCreatorTaskRunsKey='4:all'; expertObservations=[]; expertTimelineError='请求超时';
    expertDouyinSyncState={channelId:4,status:'idle',lastCompletedAt:'2026-09-22T10:00:00Z'};`);
  await r.run('expertPollDouyinSyncState()');
  await r.run('expertPollDouyinSyncState()');
  assert.ok(observationReads > 0, 'status polling never retries the failed material load');
});

test('reentering the industry workspace can display newly saved local data', async () => {
  let now = 100000;
  let storedRevision = 1;
  let visibleRevision = 0;
  const root = {
    ApiClient: {fetchJsonData: async () => []},
    IndustryWorkspace: {
      isMounted: () => true, setCatalog() {}, setTopics() {},
      loadSelected: async () => {visibleRevision = storedRevision;}
    }
  };
  class TestDate extends Date {static now() {return now;}}
  const context = vm.createContext({window:root, document:{getElementById:()=>null}, console, URLSearchParams, Date:TestDate, setTimeout, clearTimeout});
  vm.runInContext(source('industryChain'), context);
  await root.IndustryChain.load();
  assert.equal(visibleRevision, 1);
  storedRevision = 2;
  now += 16000;
  await root.IndustryChain.load();
  assert.equal(visibleRevision, 2, 'workspaceLoaded permanently short-circuits page reentry');
});

test('entering the selected individual capital page reads its current local series', () => {
  const app = fs.readFileSync(path.join(sourceRoot, 'js/app.js'), 'utf8');
  const branch = app.match(/if \(view === 'capitalFlow' && window\.CapitalFlow\) \{([\s\S]*?)\n  \}/);
  assert.ok(branch);
  assert.match(branch[1], /activePage === 'capitalFlow'[\s\S]*CapitalFlow\.ensureLoaded/);
});

test('individual capital series is checked again on a later page visit', async () => {
  const {createCapitalFlowModule} = require('../js/modules/capitalFlow');
  let now = 100000;
  const calls = [];
  const controls = {
    capitalFlowScope:{value:'stock',addEventListener(){}},
    capitalFlowCode:{value:'000001',addEventListener(){}},
    capitalFlowSource:{value:'vendor-classified',addEventListener(){}}
  };
  const page = createCapitalFlowModule({
    now:()=>now,
    document:{getElementById:id=>controls[id]||null},
    getChart:()=>null,
    renderMeta(){},
    fetchData:async path=>{calls.push(path);return {availability:'available',points:[],latest:null};}
  });
  await page.ensureLoaded();
  await page.ensureLoaded();
  assert.equal(calls.length,1,'rapid navigation shares recent data');
  now+=16000;
  await page.ensureLoaded();
  assert.equal(calls.length,2,'later visit reads the selected series again');
});

test('daily ETF and futures data is checked after a later visit', async () => {
  const {createModule} = require('../js/modules/marketInstitutionalFlow');
  let now=100000, reads=0;
  const page=createModule({
    now:()=>now,
    document:{getElementById:()=>null},
    fetchData:async()=>{reads++;return {etf:{availability:'unavailable'},futures:{availability:'unavailable'}};}
  });
  await page.ensureLoaded('daily');
  await page.ensureLoaded('daily');
  assert.equal(reads,1);
  now+=301000;
  await page.ensureLoaded('daily');
  assert.equal(reads,2,'later visit rechecks the daily report without forcing an upstream refresh');
});
