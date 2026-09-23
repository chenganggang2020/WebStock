const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createSectorRotationService}=require('../services/capitalFlow/sectorRotationService');
async function fixture(fn) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'webstock-rotation-test-'));
  let at=new Date('2026-09-17T10:00:00+08:00'),calls=0,fail=false;
  const load=async q=>{
    calls++;if(fail) throw Error('secret provider failure');
    const total=q.scope==='industry'?2:102, count=Math.min(100,total-(q.page-1)*100);
    return {scope:q.scope,tradingDay:q.date,receivedAt:at.toISOString(),source:{id:'test',fieldMapping:'v1'},
      coverage:{page:q.page,pageSize:100,totalReported:total},
      rows:Array.from({length:count},(_,i)=>({code:'BK'+String((q.page-1)*100+i).padStart(4,'0'),name:'板块'+i,
        combinedNetCents:String(at.getMinutes()*10000000),darkNetCents:'100',visibleNetCents:String(at.getMinutes()*10000000-100),reconciled:true}))};
  };
  const options={directory:dir,load,now:()=>at,pause:async()=>{}};
  try {await fn({dir,options,load,calls:()=>calls,time:v=>{at=new Date(v);},fail:()=>{fail=true;}});}
  finally {await fs.rm(dir,{recursive:true,force:true});}
}
test('GET performs no collection or writes; explicit collection has full scopes and survives restart',()=>fixture(async f=>{
  const s=createSectorRotationService(f.options);
  assert.equal((await s.get()).total,0);assert.equal(f.calls(),0);assert.deepEqual(await fs.readdir(f.dir),[]);
  await s.collect();assert.equal(f.calls(),3);
  assert.equal((await s.get()).total,2);assert.equal((await s.get({scope:'concept'})).total,102);
  const restarted=createSectorRotationService(f.options);assert.equal((await restarted.get()).total,2);
  await restarted.collect();assert.equal(f.calls(),3,'restart respects last persisted sampling time');
}));
test('concurrent and rapid refresh share one collection; failure preserves and marks prior snapshots',()=>fixture(async f=>{
  const s=createSectorRotationService(f.options);await Promise.all([s.collect(),s.collect(),s.collect()]);assert.equal(f.calls(),3);
  f.time('2026-09-17T10:01:01+08:00');f.fail();await s.collect();
  const r=await s.get();assert.equal(r.total,2);assert.equal(r.stale,true);assert.match(r.collector.errors.industry,/更新失败/);
  assert.doesNotMatch(JSON.stringify(r),/secret/);
}));
test('duplicate or missing pages never persist partial ranking snapshots',()=>fixture(async f=>{
  const s=createSectorRotationService({...f.options,load:async q=>{
    const r=await f.load(q);if(q.scope==='concept' && q.page===2) r.rows[0].code='BK0000';return r;
  }});await s.collect();assert.equal((await s.get()).total,2);assert.equal((await s.get({scope:'concept'})).total,0);
}));
test('scheduler runs in background, pauses lunch/weekend and can stop',()=>fixture(async f=>{
  let callback,cleared=false;
  const s=createSectorRotationService({...f.options,setInterval:fn=>{callback=fn;return 1;},clearInterval:()=>{cleared=true;}});
  await s.tick();assert.equal(f.calls(),3);
  f.time('2026-09-17T12:00:00+08:00');await s.tick();assert.equal(f.calls(),3);
  f.time('2026-09-19T10:00:00+08:00');await s.tick();assert.equal(f.calls(),3);
  s.start();assert.equal(typeof callback,'function');s.stop();assert.equal(cleared,true);
  f.time('2026-09-21T10:00:00+08:00');await s.tick();assert.equal(f.calls(),3);
}));
test('source cannot substitute a different day or cross a lunch boundary mid-scan',()=>fixture(async f=>{
  const s=createSectorRotationService({...f.options,load:async q=>({...await f.load(q),tradingDay:'2026-09-16'})});
  await s.collect();assert.equal((await s.get()).total,0);
}));
test('torn final history record is marked and does not get overwritten by later collection',()=>fixture(async f=>{
  const s=createSectorRotationService(f.options);await s.collect();
  const file=path.join(f.dir,'2026-09-17.jsonl');await fs.appendFile(file,'{"torn":');
  const size=(await fs.stat(file)).size;f.time('2026-09-17T10:05:00+08:00');
  const restarted=createSectorRotationService(f.options);assert.equal((await restarted.get()).total,2);
  await restarted.collect();assert.equal((await fs.stat(file)).size,size);assert.equal(f.calls(),3);
  assert.match((await restarted.get()).collector.errors.storage,/未完整/);
}));
test('a collection spanning lunch is rejected, and automatic collection is opt-out',()=>fixture(async f=>{
  f.time('2026-09-17T11:29:58+08:00');
  const s=createSectorRotationService({...f.options,enabled:false,load:async q=>{
    f.time('2026-09-17T11:30:02+08:00');return f.load(q);
  }});
  await s.tick();assert.equal(f.calls(),0);await s.collect();assert.equal((await s.get()).total,0);
}));
test('disk append failure stops further writes and never publishes an unpersisted snapshot',()=>fixture(async f=>{
  let writes=0;
  const s=createSectorRotationService({...f.options,appendFile:async()=>{writes++;throw Error('disk full');}});
  await s.collect();assert.equal(writes,1);assert.equal((await s.get()).total,0);
  assert.match((await s.get()).collector.errors.storage,/写入/);
}));

test('dated replay reads an older saved day without collecting and returns available dates',()=>fixture(async f=>{
  const s=createSectorRotationService(f.options);await s.collect();
  f.time('2026-09-18T10:00:00+08:00');await s.collect();
  const count=f.calls(),r=await s.get({date:'2026-09-17'});
  assert.equal(r.date,'2026-09-17');assert.equal(r.total,2);
  assert.deepEqual(r.availableDates,['2026-09-18','2026-09-17']);assert.equal(f.calls(),count);
  assert.equal((await s.get({date:'2026-09-16'})).total,0);
}));

test('historical day ranking is complete, cached separately and cannot contaminate intraday samples',()=>fixture(async f=>{
  const s=createSectorRotationService(f.options);
  const q={scope:'concept',date:'2026-09-16'};
  assert.equal((await s.getDaily(q)).snapshot,null);assert.equal(f.calls(),0);
  const r=await s.refreshDaily(q);
  assert.equal(r.snapshot.rows.length,102);assert.equal(r.snapshot.date,q.date);
  assert.equal(r.snapshot.kind,'historical-daily-ranking');assert.equal((await s.get()).sampleCount,0);
  const count=f.calls();await s.refreshDaily(q);assert.equal(f.calls(),count);
  const restarted=createSectorRotationService(f.options);assert.equal((await restarted.getDaily(q)).snapshot.rows.length,102);
  f.time('2026-09-17T10:02:00+08:00');f.fail();
  const old=await s.refreshDaily(q);assert.equal(old.snapshot.rows.length,102);assert.equal(old.refreshFailed,true);
  await assert.rejects(()=>s.getDaily({scope:'industry',date:'../../x'}));
  await assert.rejects(()=>s.refreshDaily({scope:'industry',date:'2026-09-20'}));
}));
