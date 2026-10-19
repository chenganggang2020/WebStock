const test=require('node:test');
const assert=require('node:assert/strict');
const {createDarkStockService}=require('../services/capitalFlow/darkStockService');
const date='2026-09-17';
const input={date,codes:['sh600487']};
function snapshot(request,receivedAt='2026-09-17T02:00:00Z') {
  return {tradingDay:request.date,scope:'stock',source:{name:'fixture'},receivedAt,
    coverage:{page:1,pageSize:100,totalReported:2},
    rows:[{venue:'SH',code:'600487',darkNetCents:'100'}, {venue:'SZ',code:'000001',darkNetCents:'200'}]};
}
function deferred() {let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
async function immediateResult(promise) {
  const blocked=Symbol('still waiting');
  const value=await Promise.race([promise,new Promise(resolve=>setImmediate(()=>resolve(blocked)))]);
  assert.notEqual(value,blocked,'cached read must finish without waiting for the source');
  return value;
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('expired same-date snapshot returns before the shared background source completes',async()=>{
  let now=0,calls=0;const next=deferred();
  const service=createDarkStockService({now:()=>now,load:async request=>++calls===1?snapshot(request):next.promise});
  await service.get(input);now=300001;
  const old=await immediateResult(service.get(input));
  assert.equal(old.stale,true);assert.equal(old.refreshing,true);assert.equal(old.cache.hit,true);
  assert.equal(old.receivedAt,'2026-09-17T02:00:00Z');
  const other=await immediateResult(service.get({...input,codes:['sz000001']}));
  assert.deepEqual(other.rows.map(row=>row.key),['sz000001']);assert.equal(calls,2);
  next.resolve(snapshot(input,'2026-09-17T02:05:01Z'));await flush();
  const updated=await service.get(input);
  assert.equal(updated.receivedAt,'2026-09-17T02:05:01Z');assert.equal(updated.stale,false);assert.equal(updated.refreshing,false);
});

test('background failure retains original timestamps, consumes rejection and respects retry cooldown',async()=>{
  let now=0,calls=0;const next=deferred();
  const service=createDarkStockService({now:()=>now,load:async request=>++calls===1?snapshot(request):next.promise});
  await service.get(input);now=300001;
  const old=await immediateResult(service.get(input));assert.equal(old.refreshing,true);
  next.reject(Error('private upstream error'));await flush();
  const failed=await service.get(input);
  assert.equal(failed.stale,true);assert.equal(failed.refreshing,false);assert.equal(calls,2);
  assert.equal(failed.receivedAt,'2026-09-17T02:00:00Z');assert.doesNotMatch(JSON.stringify(failed),/private/);
});

test('cold-start callers share one source and never borrow another date snapshot',async()=>{
  let calls=0;const next=deferred();
  const service=createDarkStockService({now:()=>0,load:async()=>{calls++;return next.promise;}});
  const first=service.get(input),second=service.get({...input,codes:['sz000001']});
  let finished=false;first.then(()=>{finished=true;});await flush();assert.equal(finished,false);assert.equal(calls,1);
  await assert.rejects(service.get({...input,date:'2026-09-18'}),/unavailable/);
  next.resolve(snapshot(input));const [a,b]=await Promise.all([first,second]);
  assert.equal(a.cache.hit,false);assert.equal(b.rows[0].key,'sz000001');
});

test('explicit force waits for a new result and joins an already running refresh',async()=>{
  let now=0,calls=0;const next=deferred();
  const service=createDarkStockService({now:()=>now,load:async request=>++calls===1?snapshot(request):next.promise});
  await service.get(input);
  const forced=service.get({...input,force:true});let finished=false;forced.then(()=>{finished=true;});
  await flush();assert.equal(calls,2);assert.equal(finished,false);
  const alsoForced=service.get({...input,force:true});
  const ordinary=await immediateResult(service.get(input));assert.equal(ordinary.refreshing,true);assert.equal(calls,2);
  next.resolve(snapshot(input,'2026-09-17T02:05:01Z'));
  for(const result of await Promise.all([forced,alsoForced])) {
    assert.equal(result.receivedAt,'2026-09-17T02:05:01Z');assert.equal(result.cache.hit,false);
  }
});

test('another-date refresh cannot leak its rows or update flag into the cached date',async()=>{
  let calls=0;const next=deferred();
  const service=createDarkStockService({now:()=>0,load:async request=>++calls===1?snapshot(request):next.promise});
  await service.get(input);
  const nextInput={...input,date:'2026-09-18'},pending=service.get(nextInput);
  const old=await immediateResult(service.get(input));assert.equal(old.tradingDay,date);assert.equal(old.refreshing,false);
  await assert.rejects(service.get({...input,force:true}),/busy/);
  next.resolve(snapshot(nextInput));assert.equal((await pending).tradingDay,'2026-09-18');
});
