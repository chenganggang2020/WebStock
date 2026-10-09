const {test}=require('node:test'),assert=require('node:assert/strict');
const model=require('../web/chart-model');
const settings={type:'kline',period:'day'};
const rows=Array.from({length:20},(_,index)=>({date:'2026-09-'+String(index+1).padStart(2,'0'),open:30-index,high:31-index,low:29-index,close:30-index,volume:100}));

test('stale pre-close snapshot remains provisional even when rendered after close',()=>{
  const data={rows,checkedAt:'2026-09-20T06:59:00Z'};
  const result=model.chartSignals(data,settings,'2026-09-20T08:00:00Z');
  assert.equal(result.series.at(-1).confirmed,false);
  assert.equal(model.reviewHistory(data,settings,'2026-09-20T08:00:00Z').confirmedBarCount,19);
});

test('new post-close snapshot can confirm the last bar',()=>{
  const data={rows,checkedAt:'2026-09-20T07:01:00Z'};
  assert.equal(model.chartSignals(data,settings,'2026-09-20T08:00:00Z').series.at(-1).confirmed,true);
});

test('missing snapshot time does not silently confirm its last bar or mutate raw data',()=>{
  const data={rows};
  assert.equal(model.chartSignals(data,settings).series.at(-1).confirmed,false);
  assert.equal(model.reviewHistory(data,settings).confirmedBarCount,19);
  assert.equal(rows.at(-1).incomplete,undefined);
});
