const test = require('node:test');
const assert = require('node:assert/strict');
const {createDarkStockService, darkSession, stockKeys} = require('../services/capitalFlow/darkStockService');
const {buildQuery, normalizeDarkRank} = require('../services/capitalFlow/eastmoneyDarkRank');
const fixture = require('./fixtures/eastmoney-dark-rank-20260916.json');
const date='2026-09-17';
function page(input, codes, total=101) {
  return normalizeDarkRank({...fixture,1:20260917,2:total,data:codes.map(code=>({...fixture.data[0],3:1,4:code}))},input,'2026-09-17T02:00:00.000Z');
}
const hundred=Array.from({length:100},(_,i)=>String(600000+i));
test('only observed page sizes are supported; public default stays 30',()=>{
  assert.equal(buildQuery({date}).NumPerPage,30);
  assert.equal(buildQuery({date,pageSize:100}).NumPerPage,100);
  assert.throws(()=>buildQuery({date,pageSize:1000}));
});
test('session uses Beijing exchange calendar, lunch, holidays, pre-open and close tail',()=>{
  assert.equal(darkSession(new Date(date+'T10:00:00+08:00')).pollAllowed,true);
  assert.equal(darkSession(new Date(date+'T12:00:00+08:00')).pollAllowed,false);
  assert.equal(darkSession(new Date(date+'T08:00:00+08:00')).dataDate,'2026-09-16');
  assert.equal(darkSession(new Date('2026-09-25T10:00:00+08:00')).pollAllowed,false);
  assert.equal(darkSession(new Date(date+'T15:03:00+08:00')).pollAllowed,true);
  assert.equal(darkSession(new Date(date+'T16:00:00+08:00')).pollAllowed,false);
  assert.equal(darkSession(new Date('2027-01-04T10:00:00+08:00')).dataDate,null);
});
test('lookup keys keep market identity and reject malformed or unbounded selections',()=>{
  assert.deepEqual(stockKeys('sh600487,sz000001,sh600487'),['sh600487','sz000001']);
  for(const value of ['', '000001', 'sh000001', ['sh600487'], Array(201).fill('sh600487').join(',')]) assert.throws(()=>stockKeys(value));
});
test('all requested stocks share one bounded scan and cache; missing is not zero',async()=>{
  let calls=0,now=0;
  const svc=createDarkStockService({now:()=>now,pause:async()=>{},load:async input=>{
    calls++;return page(input,input.page===1?hundred:['600487']);
  }});
  const [a,b]=await Promise.all([svc.get({date,codes:['sh600487']}),svc.get({date,codes:['sh600001','sz000001']})]);
  assert.equal(calls,2);assert.equal(a.rows[0].code,'600487');assert.equal(a.rows[0].receivedAt,'2026-09-17T02:00:00.000Z');
  assert.equal(b.rows.length,1);assert.deepEqual(b.missing,['sz000001']);
  assert.equal(a.coverage.receivedRows,101);assert.equal(a.coverage.paginationSnapshotConsistent,false);
  assert.equal(JSON.stringify(a).includes('"raw"'),false);
  await svc.get({date,codes:['sh600002']});assert.equal(calls,2);
  now=300001;await svc.get({date,codes:['sh600487']});assert.equal(calls,4);
});
test('failed refresh keeps explicitly stale same-day snapshot and backs off; no cross-date fallback',async()=>{
  let now=0,fail=false,calls=0;
  const svc=createDarkStockService({now:()=>now,pause:async()=>{},load:async input=>{calls++;if(fail)throw Error('secret');return page(input,['600487'],1);}});
  await svc.get({date,codes:['sh600487']});now=300001;fail=true;
  const old=await svc.get({date,codes:['sh600487']});assert.equal(old.stale,true);assert.equal(old.rows[0].receivedAt,'2026-09-17T02:00:00.000Z');
  await svc.get({date,codes:['sh600487']});assert.equal(calls,2);
  await assert.rejects(svc.get({date:'2026-09-18',codes:['sh600487']}));
});
test('moving ranks deduplicate explicitly; invalid/incomplete scans cannot overwrite prior snapshot',async()=>{
  let now=0,bad=false;
  const svc=createDarkStockService({now:()=>now,pause:async()=>{},load:async input=>{
    if(bad)throw Error('offline');return page(input,input.page===1?hundred:['600001']);
  }});
  const result=await svc.get({date,codes:['sh600001','sh600487']});
  assert.equal(result.coverage.duplicateRows,1);assert.equal(result.coverage.complete,false);assert.deepEqual(result.missing,['sh600487']);
  now=300001;bad=true;assert.equal((await svc.get({date,codes:['sh600001']})).stale,true);
});
test('first failure is throttled, total overflow and date drift are rejected',async()=>{
  let calls=0;
  const svc=createDarkStockService({pause:async()=>{},load:async input=>{calls++;return page(input,['600487'],6001);}});
  await assert.rejects(svc.get({date,codes:['sh600487']}));
  await assert.rejects(svc.get({date,codes:['sh600487']}));assert.equal(calls,1);
  const wrong=createDarkStockService({load:async input=>({...page(input,['600487'],1),tradingDay:'2026-09-16'})});
  await assert.rejects(wrong.get({date,codes:['sh600487']}));
});
