const {test}=require('node:test'),assert=require('node:assert/strict');
const model=require('../web/chart-model');
const bar=(date,close)=>({date,open:close,close,high:close+1,low:close-1,volume:100});
const page=rows=>({symbol:'sh600000',period:'day',source:'tencent-public-kline',adjustment:'qfq',checkedAt:'2026-10-03T00:00:00Z',rows});
test('verified overlap extends history without replacing current rows or their timestamp',()=>{
  const now=page([bar('2026-01-02',10),bar('2026-01-03',11)]),old=page([bar('2026-01-01',9),bar('2026-01-02',10)]);
  old.checkedAt='2026-09-01T00:00:00Z';
  const result=model.mergeHistory(now,old);
  assert.deepEqual(result.rows.map(r=>r.date),['2026-01-01','2026-01-02','2026-01-03']);
  assert.equal(result.rows[1],now.rows[0]);assert.equal(result.checkedAt,now.checkedAt);
});
test('incompatible adjustment, source, symbol, period, or overlap cannot silently mix',()=>{
  const now=page([bar('2026-01-02',10),bar('2026-01-03',11)]),old=page([bar('2026-01-01',9),bar('2026-01-02',10)]);
  for(const change of [{adjustment:'none'},{source:'other'},{symbol:'sz000001'},{period:'week'},{rows:[bar('2026-01-01',9)]},{rows:[bar('2026-01-02',12)]}])assert.throws(()=>model.mergeHistory(now,{...old,...change}));
});
test('regular refresh retains older loaded history if overlap is consistent',()=>{
  const loaded=page([bar('2026-01-01',9),bar('2026-01-02',10)]),fresh=page([bar('2026-01-02',10),bar('2026-01-03',11)]);
  assert.equal(model.mergeHistory(fresh,loaded).rows.length,3);
});
test('live candle updates do not invalidate older history when closed anchors match',()=>{
  const old=page([bar('2026-01-01',9),bar('2026-01-02',10),bar('2026-01-03',11)]),fresh=page([bar('2026-01-02',10),bar('2026-01-03',12)]);
  fresh.checkedAt=old.checkedAt='2026-01-03T02:00:00Z';
  const result=model.mergeHistory(fresh,old,{asOf:'2026-01-03T02:00:00Z'});
  assert.equal(result.rows.length,3);assert.equal(result.rows.at(-1).close,12);
});
test('an old 14:59 snapshot cannot become a final close anchor after 15:00',()=>{
  const old=page([bar('2026-01-01',9),bar('2026-01-02',10),bar('2026-01-03',11)]),fresh=page([bar('2026-01-02',10),bar('2026-01-03',12)]);
  old.checkedAt='2026-01-03T06:59:00Z';fresh.checkedAt='2026-01-03T07:01:00Z';
  const result=model.mergeHistory(fresh,old,{asOf:'2026-01-03T08:00:00Z'});
  assert.equal(result.rows.length,3);assert.equal(result.rows.at(-1).close,12);
});
