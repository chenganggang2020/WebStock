const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createDarkObservationStore}=require('../services/capitalFlow/darkObservationStore');
async function store(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'webstock-dark-observations-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return createDarkObservationStore({directory});}
const sample=()=>({tradingDay:'2026-09-17',receivedAt:'2026-09-17T01:35:00Z',source:{id:'eastmoney-darktrade-rank'},rows:[{key:'sh600000',code:'600000',name:'测试',receivedAt:'2026-09-17T01:34:59Z',darkNetCents:'100',visibleNetCents:'-30',combinedNetCents:'70',reconciled:true}]});
test('dark observations persist, deduplicate replay, and keep history after failures',async t=>{
 const s=await store(t);await s.append(sample());await s.append(sample());
 const data=await s.read({code:'sh600000',date:'2026-09-17'});assert.equal(data.points.length,1);assert.equal(data.points[0].darkNetCents,'100');
 assert.equal(data.points[0].sourceObservedAt,null);assert.equal(data.automaticTrading,false);
 const bad=sample();bad.rows[0].combinedNetCents='999';await assert.rejects(s.append(bad));
 assert.equal((await s.read({code:'sh600000',date:'2026-09-17'})).points.length,1);
});
test('dark history validates identity and reports missing as empty, never zero',async t=>{
 const s=await store(t);await assert.rejects(s.read({code:'../secret',date:'2026-09-17'}));
 await assert.rejects(s.read({code:'sh600000',date:'../secret'}));
 const r=await s.read({code:'sh600000',date:'2026-09-17'});assert.deepEqual(r.points,[]);assert.deepEqual(r.availableDates,[]);
});

test('two archived observations expose net changes without labeling them interval trades',async t=>{
 const s=await store(t);await s.append(sample());
 const next=sample();next.receivedAt='2026-09-17T01:40:00Z';next.rows[0].receivedAt='2026-09-17T01:39:59Z';
 next.rows[0].darkNetCents='170';next.rows[0].visibleNetCents='-20';next.rows[0].combinedNetCents='150';
 await s.append(next);
 const result=await s.compare({codes:['sh600000'],date:'2026-09-17'});
 assert.equal(result.sh600000.darkNetChangeCents,'70');
 assert.equal(result.sh600000.visibleNetChangeCents,'10');
 assert.equal(result.sh600000.fromAt,'2026-09-17T01:34:59Z');
 assert.equal(result.sh600000.toAt,'2026-09-17T01:39:59Z');
});

test('skipped stale and empty snapshots do not claim a successful archive write',async t=>{
 const s=await store(t);assert.equal(await s.append({...sample(),stale:true}),false);
 assert.equal(await s.append({...sample(),rows:[]}),false);
 assert.equal(await s.append(sample()),true);assert.equal(await s.append(sample()),true);
});

test('an interrupted archive tail prevents hidden future writes, preserving the original bytes',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'webstock-dark-tail-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const s=createDarkObservationStore({directory});await s.append(sample());
 const file=path.join(directory,'2026-09-17.jsonl');await fs.appendFile(file,'{"schema":');
 const before=await fs.readFile(file,'utf8'),next=sample();next.receivedAt='2026-09-17T01:40:00Z';
 await assert.rejects(s.append(next),/incomplete/i);assert.equal(await fs.readFile(file,'utf8'),before);
 const history=await s.read({code:'sh600000'});assert.equal(history.points.length,1);assert.ok(history.warning);
});
