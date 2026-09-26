const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture() {
  const nodes=new Map();
  for(const id of ['homeChartHost','homeGroups','homeWatchSearch','homeWatchRows','homeWatchStatus','homeLoadMore','homeAddWatchlist','homeManageWatchlist','homeMarketMore','homeStockMore','dashboardView']) {
    nodes.set(id,{innerHTML:'',value:'',textContent:'',listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}});
  }
  const selected=[],added=[],timers=[];
  const window={document:{getElementById:id=>nodes.get(id)||null,querySelector:()=>null},State:{currentMainView:'market',allStocks:[{code:'600519',name:'贵州茅台',pinyin:'gzmt'},...Array.from({length:100},(_,i)=>({code:String(300000+i),name:'样本'+i}))],watchlist:[],currentStock:{code:'600519',name:'贵州茅台'}},
    Watchlist:{watchlistGroups:()=>[{key:'local:a',name:'a',source:'local'}],getGroupItems:()=>[{code:'000001',name:'平安银行'}],addStock:async s=>{added.push(s);}},
    StockList:{selectStock:async s=>{selected.push(s);window.State.currentStock=s;}},requestAnimationFrame(){},addEventListener(){},
    ApiClient:{fetchJsonData:async()=>({stocks:[]})}};
  const context={window,console,setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){}};
  for(const file of ['search','homeTerminal'])vm.runInNewContext(fs.readFileSync('js/modules/'+file+'.js','utf8'),context);
  window.HomeTerminal.bind();
  return {window,nodes,selected,added,timers};
}

test('home can browse the full catalog outside watchlist groups with bounded rendering and refresh', async()=>{
  const r=fixture(),groups=r.nodes.get('homeGroups');
  groups.value=':market';groups.listeners.change({target:groups});
  assert.match(groups.innerHTML,/A股.*ETF/);
  assert.match(r.nodes.get('homeWatchRows').innerHTML,/600519/);
  assert.ok((r.nodes.get('homeWatchRows').innerHTML.match(/data-home-stock=/g)||[]).length<=60);
  assert.ok(r.window.HomeTerminal.groupItems().length<=60,'do not request quotes for the whole market');
  assert.equal(r.nodes.get('homeLoadMore').hidden,false);
  r.nodes.get('homeLoadMore').listeners.click();
  assert.match(r.nodes.get('homeWatchRows').innerHTML,/300099/);
});

test('home searches by pinyin, opens catalog stocks and adds through the existing group dialog',async()=>{
  const r=fixture(),groups=r.nodes.get('homeGroups');groups.value=':market';groups.listeners.change({target:groups});
  const input=r.nodes.get('homeWatchSearch');input.value='gzmt';input.listeners.input();
  assert.match(r.nodes.get('homeWatchRows').innerHTML,/600519/);
  assert.doesNotMatch(r.nodes.get('homeWatchRows').innerHTML,/000001/);
  await r.nodes.get('dashboardView').listeners.click({target:{closest:sel=>sel==='[data-home-stock]'?{dataset:{homeStock:'600519'}}:null}});
  assert.equal(r.selected[0].code,'600519');
  await r.nodes.get('homeAddWatchlist').listeners.click();
  assert.equal(r.added[0].code,'600519');
});

test('home discards late online results after changing query or group',async()=>{
  const r=fixture(),groups=r.nodes.get('homeGroups');groups.value=':market';groups.listeners.change({target:groups});
  let resolve;r.window.Search.searchStocksDeep=()=>new Promise(done=>{resolve=done;});
  const input=r.nodes.get('homeWatchSearch');input.value='920001';input.listeners.input();
  const pending=r.timers.at(-1)();
  groups.value='local:a';groups.listeners.change({target:groups});
  resolve([{code:'920001',name:'过时结果'}]);await pending;
  assert.doesNotMatch(r.nodes.get('homeWatchRows').innerHTML,/过时结果/);
});
