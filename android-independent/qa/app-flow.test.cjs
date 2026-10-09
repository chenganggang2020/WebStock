const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function app(){
  const nodes=new Map(),listeners={},timers=new Map(),requests=[],draws=[];let timerId=0,disposals=0;
  function node(selector){if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',textContent:'',hidden:false,value:'',dataset:{},style:{},addEventListener(type,fn){listeners[selector+':'+type]=fn;},querySelector:sub=>node(selector+' '+sub),querySelectorAll:()=>[],classList:{toggle(){},contains(){return false;}},setAttribute(){},removeAttribute(){}});return nodes.get(selector);}
  const body=node('body');body.dataset={};
  const document={body,hidden:false,querySelector:node,querySelectorAll:()=>[],addEventListener(type,fn){listeners[type]=fn;}};
  const chartObject={dispose(){disposals++;},resize(){}};
  const context={document,console,URL,Intl,Date,Map,Set,Promise,JSON,Number,String,Math,Array,Error,localStorage:{getItem(){return null;},setItem(){}},setTimeout(fn,ms){timers.set(++timerId,{fn,ms});return timerId;},clearTimeout(id){timers.delete(id);},requestAnimationFrame(fn){fn();},fetch(){return new Promise(()=>{});},PhoneChartModel:require('../web/chart-model.js'),PhoneCharts:{detach(){},draw(data){draws.push(data);return chartObject;},step(){},range(){}},addEventListener(type,fn){listeners['window:'+type]=fn;},scrollTo(){},scrollY:0,WebStockNative:{request(id,text){requests.push({id,...JSON.parse(text)});}}};
  context.window=context;
  const source=fs.readFileSync(path.join(__dirname,'../web/app.js'),'utf8').replace('  boot();',`  window.flowTest={openStock,refreshQuotes,loadChart,loadEarlier,render,call,navigate,getState:()=>state,getData:()=>chartData,setContext(code,type='kline',p='day'){currentStock=code;view='stock';chartType=type;period=p;},setData(value){chartData=value;},getChart:()=>chart,setCatalog(items){catalog=items.map(prepareCatalog);}};`);
  vm.runInNewContext(source,context,{filename:'app.js'});
  function respond(request,data,error){context.WebStockNativeDone(request.id,JSON.stringify(error?{success:false,error}:{success:true,data}));}
  const rows=[{date:'2026-09-30',open:10,close:11,high:12,low:9,volume:100}];
  const model=(code='000001',value=11)=>({symbol:'sz'+code,period:'day',source:'tencent-public-kline',adjustment:'qfq',checkedAt:'2026-09-30T07:00:00Z',rows:rows.map(r=>({...r,close:value}))});
  return{api:context.flowTest,context,node,requests,respond,draws,model,timers,listeners,disposals:()=>disposals};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('stock opens and asks for its chart before slow recent-history persistence completes',async()=>{
  const a=app();const opening=a.api.openStock('000001');await flush();
  assert.equal(a.context.document.body.dataset.page,'stock');
  assert.ok(a.requests.some(r=>r.path==='/kline?code=000001&period=day'));
  assert.match(a.node('#content').innerHTML,/000001/);
  void opening;
});
test('quote refresh does not replace a live stock chart or dispose its instance',async()=>{
  const a=app();a.api.setContext('000001');a.api.setData(a.model());a.api.render();const chart=a.api.getChart(),html=a.node('#content').innerHTML;
  const refreshing=a.api.refreshQuotes();a.respond(a.requests.at(-1),{quotes:{sz000001:{symbol:'sz000001',price:12,changePercent:2}},missing:[],stale:false});await refreshing;
  assert.equal(a.disposals(),0);assert.equal(a.api.getChart(),chart);assert.equal(a.node('#content').innerHTML,html);
});
test('late A response cannot replace newer A after A to B to A navigation',async()=>{
  const a=app();a.api.setContext('000001');const old=a.api.loadChart(),oldRequest=a.requests.at(-1);
  a.api.setContext('000002');const other=a.api.loadChart(),otherRequest=a.requests.at(-1);
  a.api.setContext('000001');const latest=a.api.loadChart(),newRequest=a.requests.at(-1);
  a.respond(newRequest,a.model('000001',15));await latest;
  a.respond(otherRequest,a.model('000002',30));await other;
  a.respond(oldRequest,a.model('000001',10));await old;
  assert.equal(a.api.getData().rows[0].close,15);
});
test('a chart refresh failure retains the last real rows and their original checked time',async()=>{
  const a=app();a.api.setContext('000001');const cached=a.model();a.api.setData(cached);const request=a.api.loadChart();
  a.respond(a.requests.at(-1),null,'fixture offline');await request;
  assert.equal(a.api.getData().rows[0].close,11);assert.equal(a.api.getData().checkedAt,cached.checkedAt);
  assert.equal(a.api.getData().stale,true);assert.match(a.api.getData().error,/fixture offline/);
});
test('local and quote reads have bounded operation-specific deadlines instead of two minutes',()=>{
  const a=app();void a.api.call('/state').catch(()=>{});void a.api.call('/quotes?symbols=sz000001').catch(()=>{});
  const delays=[...a.timers.values()].map(t=>t.ms);assert.ok(delays.includes(15000));assert.ok(delays.includes(30000));assert.ok(!delays.includes(120000));
});
test('saved native chart cache is shown while a fresh network request is still pending',async()=>{
  const a=app();a.api.setContext('000001');void a.api.loadChart();const cached=a.requests.find(r=>r.path.startsWith('/chart-cache?'));
  assert.ok(cached,'network request must not prevent reading saved chart rows');a.respond(cached,{...a.model(),available:true,cached:true,cacheRead:true});await flush();
  assert.equal(a.api.getData().rows[0].close,11);assert.equal(a.api.getData().checkedAt,'2026-09-30T07:00:00Z');
});
test('late persistent cache does not overwrite an already returned fresh chart',async()=>{
  const a=app();a.api.setContext('000001');const loading=a.api.loadChart(),cached=a.requests.find(r=>r.path.startsWith('/chart-cache?'));
  assert.ok(cached);a.respond(a.requests.find(r=>r.path.startsWith('/kline?')),a.model('000001',18));await loading;a.respond(cached,{...a.model('000001',5),available:true});await flush();assert.equal(a.api.getData().rows[0].close,18);
});
test('leaving visible market views cancels scheduled refresh and foreground resume performs a read',async()=>{
  const a=app();a.api.navigate('watch');await flush();
  assert.ok(a.requests.some(r=>r.path.startsWith('/quotes?')),'entering watchlist should request its latest quotes');
  assert.ok(a.timers.size>0);
  a.context.document.hidden=true;assert.equal(typeof a.listeners.visibilitychange,'function');a.listeners.visibilitychange();
  const networkCount=a.requests.length;for(const timer of [...a.timers.values()])if(timer.ms>=60000)timer.fn();await flush();assert.equal(a.requests.length,networkCount);
  a.api.navigate('docs');const before=a.requests.length;for(const timer of [...a.timers.values()])if(timer.ms>=60000)timer.fn();await flush();assert.equal(a.requests.length,before);
});
test('next-stock navigation preserves originating display order and the selected period',async()=>{
  const a=app();a.api.setContext('000001','kline','week');a.api.navigate('watch');
  a.node('#content').querySelectorAll=()=>[{dataset:{stock:'000002'}},{dataset:{stock:'000001'}}];
  const button={dataset:{stock:'000002'},hasAttribute(){return false;},closest(){return null;}};
  await a.listeners.click({target:{closest(){return button;}}});
  const next={dataset:{action:'stock-next'},hasAttribute(){return false;},closest(){return null;}};
  await a.listeners.click({target:{closest(){return next;}}});
  assert.ok(a.requests.some(r=>r.path==='/kline?code=000001&period=week'));assert.match(a.node('#content').innerHTML,/2 \/ 2/);
});
test('all-market search matches a provided pinyin index case-insensitively and supports an unlisted exact code',()=>{
  const a=app();a.api.setCatalog([{code:'600000',name:'浦发银行',pinyin:'pufayinhang',initials:'pfyh'}]);
  a.listeners['#search:input']({target:{value:'PFYH'}});assert.match(a.node('#searchResults').innerHTML,/600000/);
  a.listeners['#search:input']({target:{value:'920999'}});assert.match(a.node('#searchResults').innerHTML,/data-stock="920999"/);assert.match(a.node('#searchResults').innerHTML,/目录未收录/);
});
test('older history is merged with verified overlap and regular refresh retains it',async()=>{
  const a=app();a.api.setContext('000001');const current=a.model(),older={...current,rows:[{...current.rows[0],date:'2026-09-29'},...current.rows]};a.api.setData(current);
  const load=a.api.loadEarlier();a.respond(a.requests.at(-1),older);await load;assert.equal(a.api.getData().rows.length,2);
  const refresh=a.api.loadChart();a.respond(a.requests.at(-1),current);await refresh;assert.equal(a.api.getData().rows.length,2);assert.equal(a.api.getData().rows[0].date,'2026-09-29');
});
test('incompatible historical adjustment leaves original chart intact',async()=>{
  const a=app();a.api.setContext('000001');const current=a.model();a.api.setData(current);const load=a.api.loadEarlier();a.respond(a.requests.at(-1),{...current,adjustment:'none'});await assert.rejects(load,/历史口径不一致/);assert.equal(a.api.getData().rows[0].close,11);
});
