const test = require('node:test');
const assert = require('node:assert/strict');
const { rotationResult } = require('../services/capitalFlow/sectorRotationModel');
function samples(count = 11) {
  return Array.from({length: count}, (_, i) => ({
    date: '2026-09-17', scope: 'industry', sourceKey: 'eastmoney:test',
    receivedAt: new Date(Date.parse('2026-09-17T10:00:00+08:00') + i * 60000).toISOString(),
    coverage: {totalReported: 2, complete: true},
    rows: ['BK0001','BK0002'].map((code, n) => ({code, name: n ? '流出板块' : '流入板块', reconciled: true,
      combinedNetCents: String((n ? -1 : 1) * (i <= 5 ? i : 5 + (i - 5) * 2) * 100000000),
      darkNetCents: String(i * 10000000), visibleNetCents: String(-i * 5000000), changeRatio: 0.01}))
  }));
}
const calculate = (s, options = {}) => rotationResult(s, {scope:'industry',minutes:5,metric:'combined',now:Date.parse('2026-09-17T10:10:00+08:00'),...options});
test('window delta, speed, prior-window speed change and signed ranks', () => {
  const r = calculate(samples());
  assert.equal(r.inflow[0].code, 'BK0001'); assert.equal(r.outflow[0].code, 'BK0002');
  assert.equal(r.inflow[0].deltaCents, '1000000000');
  assert.equal(r.inflow[0].speedYuanPerMinute, 2000000);
  assert.equal(r.inflow[0].speedChange, 1000000);
  assert.equal(r.inflow[0].darkDeltaCents, '50000000');
  assert.equal(r.inflow[0].visibleDeltaCents, '-25000000');
  assert.equal(r.inflow[0].divergence, true);
});
test('warmup keeps cumulative rows but no fabricated ranks', () => {
  const r = calculate(samples(2)); assert.equal(r.eligible, 0); assert.equal(r.inflow.length, 0);
  assert.equal(r.rows[0].deltaCents, null);
});
test('missing amount, missing board, source changes, long gaps and reconciliation errors exclude affected rows', () => {
  for (const mutate of [s=>s[7].rows[0].combinedNetCents=null,s=>s[7].rows.splice(0,1),
    s=>s[7].sourceKey='other',s=>s.splice(6,3),s=>s[7].rows[0].reconciled=false]) {
    const s=samples(); mutate(s); assert.equal(calculate(s).inflow.length,0);
  }
});
test('does not bridge lunch or dates', () => {
  for (const time of ['2026-09-17T13:00:00+08:00','2026-09-18T10:10:00+08:00']) {
    const s=samples();s.at(-1).receivedAt=new Date(time).toISOString();
    s.at(-1).date=time.slice(0,10);
    assert.equal(calculate(s,{now:Date.parse(time)}).eligible,0);
  }
});

test('after-hours refresh preserves the last continuous window separately from the daily snapshot', () => {
  const s=samples(), night={...s.at(-1),receivedAt:'2026-09-17T14:54:00Z'};
  const r=calculate([...s,night],{now:Date.parse(night.receivedAt)});
  assert.equal(r.eligible,2);
  assert.equal(r.displayMode,'historical-window');
  assert.equal(r.windowEndAt,s.at(-1).receivedAt);
  assert.equal(r.receivedAt,night.receivedAt);
  assert.equal(r.inflow[0].deltaCents,'1000000000');
  assert.equal(r.stale,true);
});

test('night-only snapshots never warm up; closing auction is not a continuous window', () => {
  const s=samples().map((p,i)=>({...p,receivedAt:new Date(Date.parse('2026-09-17T22:00:00+08:00')+i*60000).toISOString()}));
  const r=calculate(s,{now:Date.parse(s.at(-1).receivedAt)});
  assert.equal(r.eligible,0);assert.equal(r.displayMode,'no-intraday-window');
  const {session}=require('../services/capitalFlow/sectorRotationModel');
  assert.equal(session('2026-09-17T14:57:00+08:00'),null);
});

test('dated replay stops at the requested observation time and rejects malformed dates', () => {
  const r=calculate(samples(),{date:'2026-09-17',at:'10:05:00'});
  assert.equal(r.windowEndAt,'2026-09-17T02:05:00.000Z');
  assert.equal(r.inflow[0].deltaCents,'500000000');
  for(const date of ['../x','2026-02-30']) assert.throws(()=>calculate(samples(),{date}));
  assert.throws(()=>calculate(samples(),{at:'10:00:00'}));
});
test('duplicate sampling timestamps never become extra observations', () => {
  const s=samples(); s.splice(6,0,{...s[5]}); assert.equal(calculate(s).inflow[0].deltaCents,'1000000000');
});
test('stale and future snapshots are flagged, never represented as live', () => {
  assert.equal(calculate(samples(),{now:Date.parse('2026-09-17T10:20:00+08:00')}).stale,true);
  assert.equal(calculate(samples(),{now:Date.parse('2026-09-17T10:00:00+08:00')}).eligible,0);
});
test('invalid scope, metric, interval and code rejected', () => {
  for (const options of [{minutes:1},{metric:'main'},{scope:'stock'},{code:'../x'}]) assert.throws(()=>calculate(samples(),options));
});
test('window does not extrapolate missing endpoint or turn after-hours records into intraday data',()=>{
  const s=samples();s.splice(0,8);assert.equal(calculate(s).eligible,0);
});
