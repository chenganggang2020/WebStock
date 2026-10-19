const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function view(overview) {
  const box={innerHTML:''};
  const status={textContent:''};
  const context=vm.createContext({window:{State:{},WebStockTime:{formatDateTime:x=>x}},document:{getElementById:id=>id==='hotMarketBoard'?box:id==='hotReadingStatus'?status:null},console,URLSearchParams});
  vm.runInContext(fs.readFileSync(require.resolve('../js/modules/hotMarket.js'),'utf8'),context);
  context.fixture=overview;
  vm.runInContext('hotMarketOverview=fixture;renderHotBoard()',context);
  return {box,context};
}
test('hot board keeps missing constituents separate from unrelated global hot stocks',()=>{
  const {box}=view({boards:{day:[{code:'BK0001',name:'板块甲',stocks:[],dailyChangePct:1}]},hotStocks:[{code:'000002',name:'不属于甲',changePct:2}]});
  assert.doesNotMatch(box.innerHTML,/不属于甲/);
  assert.match(box.innerHTML,/当日增强/);
  assert.match(box.innerHTML,/多日持续/);
  assert.match(box.innerHTML,/全部板块/);
});
test('empty constituent refresh preserves previously available members',async()=>{
  const {box,context}=view({boards:{day:[{code:'A',name:'板块甲',stocks:[{code:'000001',name:'原有成分股'}]}]}});
  context.window.ApiClient={fetchJsonData:async()=>({items:[],status:'unavailable'})};
  await vm.runInContext('hotLoadMembers()',context);
  assert.match(box.innerHTML,/原有成分股/);
  assert.match(context.document.getElementById('hotReadingStatus').textContent,/保留/);
});
test('missing multi-day data does not acquire a numbered rank',()=>{
  const {box,context}=view({boards:{day:[{code:'A',name:'无日线板块',monthChangePct:null,stocks:[]}]}});
  vm.runInContext("hotReadingMode='month';renderHotBoard()",context);
  assert.doesNotMatch(box.innerHTML,/1\. 无日线板块/);
});
test('missing hot metrics render unknown, never zero',()=>{
  const {context}=view({boards:{day:[]}});
  assert.equal(vm.runInContext('hotFmtPct(null)',context),'--');
  assert.equal(vm.runInContext('hotFmtYi(null)',context),'--');
});
test('multi-day view sorts available period return, with sample window visible',()=>{
  const {box,context}=view({boards:{day:[{code:'A',name:'弱持续',monthChangePct:1,sampleDays:2,stocks:[]},{code:'B',name:'强持续',monthChangePct:8,sampleDays:14,monthStart:'2026-09-01',monthEnd:'2026-09-18',stocks:[]}]}});
  vm.runInContext("hotReadingMode='month';renderHotBoard()",context);
  assert.ok(box.innerHTML.indexOf('强持续')<box.innerHTML.indexOf('弱持续'));
  assert.match(box.innerHTML,/14/);
});
