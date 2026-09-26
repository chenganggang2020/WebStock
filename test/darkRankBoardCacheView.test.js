const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const script=fs.readFileSync(require.resolve('../js/modules/darkRankBoardView'),'utf8');
function harness() {
  let now=100000,calls=0;
  const nodes=new Map(),timers=[],urls=[];
  const document={hidden:false,querySelectorAll:()=>[],getElementById:id=>{
    if(!nodes.has(id))nodes.set(id,{value:id==='darkRankDate'?'2026-09-17':id==='darkBoardMetric'?'amount':id==='darkBoardLimit'?'200':'',innerHTML:'',textContent:'',scrollTop:0,
      handlers:{},addEventListener(event,fn){this.handlers[event]=fn;}});
    return nodes.get(id);
  }};
  const root={document,State:{currentMainView:'capitalFlow'},EastmoneyDarkRank:{formatMoney:v=>v},WebStockTime:{formatDateTime:v=>v},fetch:async url=>{
    calls++;urls.push(url);return {ok:true,json:async()=>({success:true,data:{tradingDay:'2026-09-17',metric:'amount',rows:[],inflow:[],outflow:[],coverage:{totalReported:0},
      receivedAt:calls===1?'2026-09-17T02:00:00Z':'2026-09-17T02:05:00Z',stale:calls===1,refreshing:calls===1,capLoading:false,ratioMissing:0}})};
  }};
  vm.runInNewContext(script,{window:root,Date:{now:()=>now},AbortSignal,URLSearchParams,setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length;},clearTimeout(){}});
  return {root,timers,urls,nodes,clock:value=>{now=value;}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('rank board follows a background snapshot independently of market-cap loading',async()=>{
  const h=harness();await h.root.DarkRankBoard.refresh();
  assert.match(h.nodes.get('darkBoardStatus').textContent,/后台更新/);
  assert.equal(h.timers[0].delay,5000);h.clock(105000);h.timers[0].fn();await flush();
  assert.equal(h.urls.length,2);assert.doesNotMatch(h.urls[1],/force=/);
  assert.match(h.nodes.get('darkBoardStatus').textContent,/02:05:00/);
  h.nodes.get('darkBoardRefresh').handlers.click();await flush();assert.match(h.urls[2],/force=1/);
});
test('returning to the closed-session board completes a refresh that outlived the follow-up window',async()=>{
  const h=harness();await h.root.DarkRankBoard.refresh();h.root.document.hidden=true;h.clock(180000);
  if(h.timers[0])h.timers[0].fn();await flush();assert.equal(h.urls.length,1);
  h.root.document.hidden=false;
  await h.root.DarkRankBoard.enter({dataDate:'2026-09-17',today:'2026-09-17',pollAllowed:false});
  assert.equal(h.urls.length,2);assert.doesNotMatch(h.urls[1],/force=/);
});
