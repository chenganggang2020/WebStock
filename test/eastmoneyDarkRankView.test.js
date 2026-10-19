const test = require('node:test');
const assert = require('node:assert/strict');
const {formatMoney, renderRows, createDarkRankView} = require('../js/modules/eastmoneyDarkRank');
const {normalizeDarkRank} = require('../services/capitalFlow/eastmoneyDarkRank');
const fixture = require('./fixtures/eastmoney-dark-rank-20260916.json');
const data = normalizeDarkRank(fixture,{date:'2026-09-16',scope:'stock',page:1},'2026-09-17T08:20:00Z');
function documentFake() {
  const elements = new Map();
  return {getElementById(id) {
    if (!elements.has(id)) elements.set(id,{value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,
      events:{},addEventListener(name,fn){this.events[name]=fn;}});
    return elements.get(id);
  }};
}
const ok = x => ({ok:true,json:async()=>({success:true,data:x})});
test('dark rank money is exact before display rounding; unavailable is not zero',()=>{
  assert.equal(formatMoney(null),'--');assert.equal(formatMoney('0'),'0.00 元');
  assert.equal(formatMoney('91597433600'),'+9.16 亿元');assert.equal(formatMoney('-1'),'-0.01 元');
  assert.equal(formatMoney('900719925474099301'),'+90071992.55 亿元');
});
test('provider text is escaped and amount, ratio, opposite signs and quality are explicit',()=>{
  const rows=structuredClone(data.rows);rows[0].name='<img src=x onerror=alert(1)>';
  rows[0].visibleNetCents='-100';rows[0].reconciled=false;
  const html=renderRows(rows);
  assert.doesNotMatch(html,/<img/);assert.match(html,/6\.35%/);assert.match(html,/明暗反向/);assert.match(html,/合计待核验/);
});
test('binding does not fetch; first query is explicit and carries only selected page',async()=>{
  const doc=documentFake();let calls=0,url;
  const view=createDarkRankView({document:doc,fetch:async u=>{calls++;url=u;return ok(data);},now:()=>new Date('2026-09-16T08:00:00Z')});
  view.bind();assert.equal(calls,0);await view.run(1);
  assert.match(url,/date=2026-09-16/);assert.match(url,/page=1/);assert.equal(calls,1);
  assert.match(doc.getElementById('darkRankStatus').textContent,/5350/);
  assert.equal(doc.getElementById('darkRankOutput').hidden,false);
});
test('same-query failure keeps explicitly old data; changing date clears it immediately',async()=>{
  const doc=documentFake();let fail=false;
  const view=createDarkRankView({document:doc,fetch:async()=>{if(fail)throw Error('network');return ok(data);},now:()=>new Date('2026-09-16T08:00:00Z')});
  view.bind();await view.run(1);fail=true;await view.run(1);
  assert.equal(doc.getElementById('darkRankOutput').hidden,false);
  assert.match(doc.getElementById('darkRankStatus').textContent,/旧数据/);
  doc.getElementById('darkRankDate').value='2026-09-17';view.invalidate();
  assert.equal(doc.getElementById('darkRankOutput').hidden,true);
  await view.run(1);assert.equal(doc.getElementById('darkRankOutput').hidden,true);
});
test('older response cannot restore rows after selection changes',async()=>{
  const doc=documentFake();let release;
  const view=createDarkRankView({document:doc,fetch:()=>new Promise(r=>{release=r;}),now:()=>new Date('2026-09-16T08:00:00Z')});
  view.bind();const pending=view.run(1);
  doc.getElementById('darkRankScope').value='industry';view.invalidate();release(ok(data));await pending;
  assert.equal(doc.getElementById('darkRankOutput').hidden,true);
  assert.match(doc.getElementById('darkRankStatus').textContent,/点击/);
});
test('wrong returned selection is rejected rather than relabeled',async()=>{
  const doc=documentFake();const view=createDarkRankView({document:doc,fetch:async()=>ok({...data,tradingDay:'2026-09-15'}),now:()=>new Date('2026-09-16T08:00:00Z')});
  view.bind();await view.run(1);assert.equal(doc.getElementById('darkRankOutput').hidden,true);
  assert.match(doc.getElementById('darkRankStatus').textContent,/不一致/);
});
test('clicking a row updates focus; page controls carry selected page and mark last page',async()=>{
  const doc=documentFake(),pages=[];
  const view=createDarkRankView({document:doc,now:()=>new Date('2026-09-16T08:00:00Z'),fetch:async url=>{
    const page=Number(new URL(url,'http://localhost').searchParams.get('page'));pages.push(page);
    return ok({...data,coverage:{...data.coverage,page,totalReported:60}});
  }});
  view.bind();await view.run(1);
  doc.getElementById('darkRankRows').events.click({target:{closest:()=>({dataset:{darkFocus:'1'}})}});
  assert.match(doc.getElementById('darkRankFocus').textContent,/中际旭创/);
  assert.equal(doc.getElementById('darkRankPrevious').disabled,true);
  await view.run(2);assert.deepEqual(pages,[1,2]);
  assert.equal(doc.getElementById('darkRankPrevious').disabled,false);
  assert.equal(doc.getElementById('darkRankNext').disabled,true);
});
test('automatic polling respects pause, historical dates and session; retains selected stock across ranking changes',async()=>{
  const doc=documentFake();let calls=0;
  const view=createDarkRankView({document:doc,now:()=>new Date('2026-09-16T02:00:00Z'),fetch:async()=>{
    calls++;return ok({...data,rows:calls===1?data.rows:[...data.rows].reverse()});
  }});
  view.bind();await view.run();
  doc.getElementById('darkRankRows').events.click({target:{closest:()=>({dataset:{darkFocus:'1'}})}});
  const session={today:'2026-09-16',pollAllowed:true,reason:'盘中'};
  await view.autoTick(session);assert.equal(calls,2);
  assert.match(doc.getElementById('darkRankFocus').textContent,/中际旭创/);
  await view.autoTick({...session,pollAllowed:false});assert.equal(calls,2);
  doc.getElementById('darkRankAuto').checked=false;await view.autoTick(session);assert.equal(calls,2);
  doc.getElementById('darkRankAuto').checked=true;doc.getElementById('darkRankDate').events.change();
  await view.autoTick({...session,today:'2026-09-17'});assert.equal(calls,2);
});
test('default date follows a new trading day; an explicitly chosen historical date stays fixed',async()=>{
  const doc=documentFake();let calls=0;
  const view=createDarkRankView({document:doc,now:()=>new Date('2026-09-16T02:00:00Z'),fetch:async url=>{
    calls++;const date=new URL(url,'http://local').searchParams.get('date');return ok({...data,tradingDay:date});
  }});
  view.bind();await view.autoTick({today:'2026-09-17',pollAllowed:true});
  assert.equal(doc.getElementById('darkRankDate').value,'2026-09-17');assert.equal(calls,1);
  doc.getElementById('darkRankDate').value='2026-09-16';doc.getElementById('darkRankDate').events.change();
  await view.autoTick({today:'2026-09-18',pollAllowed:true});assert.equal(calls,1);
  assert.equal(doc.getElementById('darkRankDate').value,'2026-09-16');
});
