const test=require('node:test');
const assert=require('node:assert/strict');
const {stockKey,stockCell,renderStock,createDarkStockView}=require('../js/modules/eastmoneyDarkStocks');
const row={key:'sh600487',code:'600487',name:'亨通光电',darkNetCents:'91597433600',visibleNetCents:'-10000',combinedNetCents:'91597423600',darkActivityRatio:.05763,reconciled:true,receivedAt:'2026-09-17T02:00:00Z'};
const snapshot={tradingDay:'2026-09-17',rows:[row],missing:[],stale:false,receivedAt:row.receivedAt,coverage:{complete:true}};
const session={today:'2026-09-17',dataDate:'2026-09-17',pollAllowed:true,reason:'盘中'};
const response=data=>({ok:true,json:async()=>({success:true,data})});
function docFake() {
  const nodes=new Map();
  return {hidden:false,addEventListener(){},getElementById(id){if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',hidden:false,addEventListener(){},querySelectorAll:()=>[]});return nodes.get(id);}};
}
test('stock key keeps market identity and excludes indices, ETFs and unsafe input',()=>{
  assert.equal(stockKey({code:'000001',market:'sz'}),'sz000001');
  assert.equal(stockKey({code:'000001',market:'sh'}),null);
  for(const stock of [{code:'000001',type:'index'},{code:'510300'},{code:'600487" onclick="bad'}])assert.equal(stockKey(stock),null);
  assert.equal(stockKey({code:'600487'}),'sh600487');
  assert.doesNotMatch(stockCell({code:'<img>'}),/<img/);
});
test('stock card shows amounts, ratio, provenance and real missing/old states, escaping provider text',()=>{
  const html=renderStock({...row,name:'<img>'},snapshot,true);
  assert.match(html,/9\.16 亿元/);assert.match(html,/5\.76%/);assert.match(html,/明暗反向/);assert.doesNotMatch(html,/<img/);
  assert.match(renderStock(null,snapshot),/未匹配/);
  assert.match(renderStock(row,{...snapshot,stale:true}),/旧快照/);
  assert.match(renderStock({...row,darkNetCents:null},snapshot),/--/);
});
test('late stock response cannot paint new selection; old-day data clears before request',async()=>{
  const doc=docFake();let release;
  const view=createDarkStockView({document:doc,fetch:()=>new Promise(r=>release=r),formatMoney:require('../js/modules/eastmoneyDarkRank').formatMoney});
  view.select({code:'600487'});
  const a=view.load(session,'market');
  view.select({code:'600000'});release(response(snapshot));await a;
  assert.doesNotMatch(doc.getElementById('detailDarkStockData').innerHTML,/9\.16/);
  view.select({code:'600487'});const b=view.load(session,'market');release(response(snapshot));await b;
  assert.match(doc.getElementById('detailDarkStockData').innerHTML,/9\.16/);
  const c=view.load({...session,dataDate:'2026-09-18'},'market');
  assert.doesNotMatch(doc.getElementById('detailDarkStockData').innerHTML,/9\.16/);
  release(response(snapshot));await c;
  assert.match(doc.getElementById('detailDarkStockStatus').textContent,/失败/);
});
test('hidden view never polls and repeated automatic load uses cached snapshot',async()=>{
  const doc=docFake();let calls=0;
  const view=createDarkStockView({document:doc,fetch:async()=>{calls++;return response(snapshot);}});
  view.select({code:'600487'});doc.hidden=true;await view.load(session,'market');assert.equal(calls,0);
  doc.hidden=false;await view.load(session,'market');await view.load(session,'market');assert.equal(calls,1);
});
test('ordinary quote rerenders reuse already matched amounts instead of flashing waiting text',async()=>{
  const doc=docFake();
  const view=createDarkStockView({document:doc,fetch:async()=>response(snapshot)});
  view.select({code:'600487'});await view.load(session,'market');
  const cell=view.cell({code:'600487'});
  assert.match(cell,/data-dark-stock="sh600487"/);assert.match(cell,/9\.16 亿元/);
  assert.doesNotMatch(cell,/等待/);
});

test('history responses cannot overwrite another stock and gaps stay null',async()=>{
 const doc=docFake();let release,chartOptions;
 const view=createDarkStockView({document:doc,fetch:()=>new Promise(resolve=>{release=resolve;}),echarts:{init:()=>({dispose(){},setOption:option=>{chartOptions=option;}})}});
 view.select({code:'600487'});const old=view.history();view.select({code:'600000'});
 release(response({code:'sh600487',availableDates:[],points:[],note:'old'}));await old;
 assert.doesNotMatch(doc.getElementById('detailDarkHistoryStatus').textContent,/old/);
 const next=view.history();release(response({code:'sh600000',availableDates:['2026-09-17'],tradingDay:'2026-09-17',note:'本机记录',points:[
  {receivedAt:'2026-09-17T01:30:00Z',darkNetCents:'1000000',visibleNetCents:'-1000000',sourceKey:'same'},
  {receivedAt:'2026-09-17T02:30:00Z',darkNetCents:'2000000',visibleNetCents:'-2000000',sourceKey:'same'}]}));await next;
 assert.deepEqual(chartOptions.series[0].data,[1,null,2]);assert.equal(chartOptions.series[0].connectNulls,false);
});
test('coordinator schedules one minute ticks and stops for hidden or unrelated pages',async()=>{
  const fs=require('node:fs'),vm=require('node:vm');
  const doc=docFake(),scheduled=[];let sessionCalls=0,rankCalls=0;
  const root={document:doc,State:{currentMainView:'capitalFlow'},EastmoneyDarkRank:{autoTick:async()=>{rankCalls++;}},
    fetch:async()=>{sessionCalls++;return response(session);}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/modules/eastmoneyDarkStocks'),'utf8'),{
    window:root,setTimeout:(fn,ms)=>{scheduled.push({fn,ms});return 1;},clearTimeout:()=>{}
  });
  await root.EastmoneyDarkStocks.sync();assert.equal(sessionCalls,1);assert.equal(rankCalls,1);assert.equal(scheduled[0].ms,60000);
  await scheduled.shift().fn();assert.equal(sessionCalls,2);
  doc.hidden=true;await scheduled.shift().fn();assert.equal(sessionCalls,2);assert.equal(scheduled.length,0);
  doc.hidden=false;root.State.currentMainView='news';await root.EastmoneyDarkStocks.sync();assert.equal(sessionCalls,2);
});
