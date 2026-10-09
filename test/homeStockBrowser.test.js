const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture() {
  const nodes=new Map(),events={};
  for(const id of ['homeChartHost','homeGroups','homeWatchSearch','homeWatchRows','homeWatchStatus','homeLoadMore','homeAddWatchlist','homeManageWatchlist','homeMarketMore','homeStockMore','dashboardView']) {
    nodes.set(id,{innerHTML:'',value:'',textContent:'',listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}});
  }
  const selected=[],added=[],timers=[],navigation=[];
  const window={document:{addEventListener:(name,fn)=>events[name]=fn,getElementById:id=>nodes.get(id)||null,querySelector:()=>null},State:{currentMainView:'market',allStocks:[{code:'600519',name:'贵州茅台',pinyin:'gzmt'},...Array.from({length:100},(_,i)=>({code:String(300000+i),name:'样本'+i}))],watchlist:[],currentStock:{code:'600519',name:'贵州茅台'}},
    Watchlist:{watchlistGroups:()=>[{key:'local:a',name:'a',source:'local'}],getGroupItems:()=>[{code:'000001',name:'平安银行'}],addStock:async s=>{added.push(s);}},
    StockList:{selectStock:async (s,options)=>{selected.push(s);navigation.push(options && options.navigation);window.State.currentStock=s;}},requestAnimationFrame(){},addEventListener(){},
    ApiClient:{fetchJsonData:async()=>({stocks:[]})}};
  const context={window,console,setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){}};
  for(const file of ['search','homeTerminal'])vm.runInNewContext(fs.readFileSync('js/modules/'+file+'.js','utf8'),context);
  window.HomeTerminal.bind();
  const choose=key=>nodes.get('homeGroups').listeners.click({target:{closest:()=>({dataset:{homeGroup:key}})}});
  return {window,nodes,selected,added,timers,navigation,events,choose};
}

test('home can browse the full catalog outside watchlist groups with bounded rendering and refresh', async()=>{
  const r=fixture(),groups=r.nodes.get('homeGroups');
  r.choose(':market');
  assert.match(groups.innerHTML,/data-home-group=":market"/);
  assert.match(r.nodes.get('homeWatchRows').innerHTML,/600519/);
  assert.ok((r.nodes.get('homeWatchRows').innerHTML.match(/data-home-stock=/g)||[]).length<=60);
  assert.ok(r.window.HomeTerminal.groupItems().length<=60,'do not request quotes for the whole market');
  assert.equal(r.nodes.get('homeLoadMore').hidden,false);
  r.nodes.get('homeLoadMore').listeners.click();
  assert.match(r.nodes.get('homeWatchRows').innerHTML,/300099/);
});

test('home searches by pinyin, opens catalog stocks and adds through the existing group dialog',async()=>{
  const r=fixture(),groups=r.nodes.get('homeGroups');r.choose(':market');
  r.window.State.currentMainView='settings';
  r.window.switchMainView=view=>{r.window.State.currentMainView=view;};
  const input=r.nodes.get('homeWatchSearch');input.value='gzmt';input.listeners.input();
  assert.match(r.nodes.get('homeWatchRows').innerHTML,/600519/);
  assert.doesNotMatch(r.nodes.get('homeWatchRows').innerHTML,/000001/);
  await r.events.click({target:{closest:sel=>sel==='[data-home-stock]'?{dataset:{homeStock:'600519'}}:null}});
  assert.equal(r.selected[0].code,'600519');
  assert.equal(r.window.State.currentMainView,'dashboard');
  assert.deepEqual(Array.from(r.navigation[0].items,item=>item.code),['600519']);
  assert.equal(r.navigation[0].label,'全市场搜索');
  await r.nodes.get('homeAddWatchlist').listeners.click();
  assert.equal(r.added[0].code,'600519');
});

test('continuous browsing remembers the originating full matched list, not the 60-row quote polling cap',async()=>{
  const r=fixture(),groups=r.nodes.get('homeGroups');r.choose(':market');
  await r.events.click({target:{closest:sel=>sel==='[data-home-stock]'?{dataset:{homeStock:'600519'}}:null}});
  assert.equal(r.navigation[0].items.length,101);
  assert.ok(r.window.HomeTerminal.groupItems().length<=60,'continuous browsing must not enlarge background quote batches');
});

test('home discards late online results after changing query or group',async()=>{
  const r=fixture(),groups=r.nodes.get('homeGroups');r.choose(':market');
  let resolve;r.window.Search.searchStocksDeep=()=>new Promise(done=>{resolve=done;});
  const input=r.nodes.get('homeWatchSearch');input.value='920001';input.listeners.input();
  const pending=r.timers.at(-1)();
  r.choose(':watchlist');
  resolve([{code:'920001',name:'过时结果'}]);await pending;
  assert.doesNotMatch(r.nodes.get('homeWatchRows').innerHTML,/过时结果/);
});

test('home index cards expose the existing index detail click target',()=>{
  const r=fixture();
  r.nodes.set('homeIndices',{innerHTML:''});
  r.window.document.body={classList:{contains:()=>false}};
  r.window.MarketComparison={indexCardDisplayQuote:item=>({price:item.price,changePct:item.changePct}),indexCardIntradayStatus:()=>''};
  r.window.HomeTerminal.renderIndices({indices:[{key:'sse',name:'上证指数',code:'000001',price:3800,changePct:1}]},{series:[]});
  assert.match(r.nodes.get('homeIndices').innerHTML,/data-index-key="sse"[^>]*role="button"[^>]*tabindex="0"/);
});
