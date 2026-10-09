const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/modules/desktopWidget.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const nodes = new Map(), events = {}, timers = new Map(), calls = [];
  let timerId = 0;
  const document = {hidden:false, getElementById(id) {
    if (!nodes.has(id)) {
      let html = '';
      nodes.set(id, {id, writes:0, value:'', textContent:'', checked:false, events:{},
        get innerHTML() {return html;}, set innerHTML(value) {html=value;this.writes++;},
        addEventListener(key, fn) {this.events[key]=fn;}, setAttribute() {}});
    }
    return nodes.get(id);
  }, addEventListener(key, fn) {events[key]=fn;}};
  const preferences = {widgetKey:'test',read:()=>null,
    widget:()=>({showQuotes:true,showPnl:true,showPositions:true,hideAmounts:false,keys:['fixture-index'],accountId:0}),
    spark:()=>'<svg></svg>'};
  const fetch = url => new Promise((resolve,reject) => calls.push({url,
    resolve(data) {resolve({ok:true,json:async()=>({success:true,data})});},reject}));
  const sandbox = {window:{MarketBoardPreferences:preferences}, document, localStorage:{setItem(){}},
    fetch, AbortSignal, setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},
    clearTimeout(id){timers.delete(id);}, console};
  vm.runInNewContext(source,sandbox,{filename:'desktopWidget.js'});
  return {document,events,timers,calls,node:id=>document.getElementById(id),
    call(part){const call=calls.find(c=>!c.used && c.url.includes(part));assert.ok(call,part);call.used=true;return call;},
    async tick(){const entry=[...timers][0];assert.ok(entry,'timer');timers.delete(entry[0]);entry[1].fn();await flush();},
    async settle() {
      this.call('global-board').resolve(market());this.call('accounts/overview').resolve(accounts());
      await flush();this.call('/positions?').resolve(positions());await flush();
    }};
}
function market(){return {catalog:[{key:'fixture-index',name:'测试指数',group:'指数'}],
  items:[{key:'fixture-index',name:'测试指数',value:123.45,changePct:1,status:'available',observedAt:'2026-09-17T02:00:00Z',group:'指数',source:'fixture',points:[]}]};}
function accounts(){return [{id:1,name:'测试账户',summary:{todayPnl:12,unrealizedPnl:34,valuationStatus:'live'}}];}
function positions(){return [{code:'000001',name:'测试持仓',currentPrice:10,change:1,unrealizedPnl:2}];}
test('widget paints market while the account request remains unresolved',async()=>{
  const h=harness();h.call('global-board').resolve(market());await flush();
  assert.match(h.node('widgetQuotes').innerHTML,/123\.45/);
  assert.equal(h.calls.some(c=>c.url.includes('/positions?')),false);
});
test('widget paints account summary before slow market and positions finish',async()=>{
  const h=harness();h.call('accounts/overview').resolve(accounts());await flush();
  assert.match(h.node('widgetPnl').innerHTML,/12\.00/);
  assert.equal(h.calls.some(c=>c.url.includes('/positions?')),true);
  assert.doesNotMatch(h.node('widgetPositions').innerHTML,/测试持仓/);
});
test('a market failure cannot discard an account/positions success',async()=>{
  const h=harness();h.call('global-board').reject(Error('market offline'));
  h.call('accounts/overview').resolve(accounts());await flush();
  h.call('/positions?').resolve(positions());await flush();
  assert.match(h.node('widgetPositions').innerHTML,/测试持仓/);
  assert.match(h.node('widgetStatus').textContent,/行情.*market offline/);
});
test('identical refresh does not rewrite quotes, positions or configuration DOM',async()=>{
  const h=harness();await h.settle();
  const ids=['widgetQuotes','widgetPnl','widgetPositions','widgetQuoteChoices','widgetAccount'];
  const counts=ids.map(id=>h.node(id).writes);await h.tick();await h.settle();
  assert.deepEqual(ids.map(id=>h.node(id).writes),counts);
});
test('account failure preserves matching previous data and permits new market quotes',async()=>{
  const h=harness();await h.settle();await h.tick();
  const newer=market();newer.items[0].value=124;
  h.call('accounts/overview').reject(Error('account offline'));h.call('global-board').resolve(newer);await flush();
  assert.match(h.node('widgetQuotes').innerHTML,/124\.00/);
  assert.match(h.node('widgetPositions').innerHTML,/测试持仓/);
  assert.match(h.node('widgetStatus').textContent,/账户.*account offline/);
});
test('changing accounts clears old positions; an older response cannot repopulate them',async()=>{
  const h=harness();await h.settle();await h.tick();
  h.call('accounts/overview').resolve(accounts());await flush();
  const latePositions=h.call('/positions?');
  h.node('widgetSettings').events.change({target:{id:'widgetAccount',value:'2',dataset:{}}});
  latePositions.resolve(positions());h.call('global-board').resolve(market());await flush();
  assert.doesNotMatch(h.node('widgetPositions').innerHTML,/测试持仓/);
});
test('hidden widget performs no polling until visible; polling interval is not increased',async()=>{
  const h=harness();await h.settle();
  assert.equal([...h.timers.values()][0].delay,30000);
  h.document.hidden=true;const before=h.calls.length;await h.tick();
  assert.equal(h.calls.length,before);
  h.document.hidden=false;h.events.visibilitychange();await flush();
  assert.ok(h.calls.length>before);
});
