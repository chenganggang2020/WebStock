const test=require('node:test'),assert=require('node:assert/strict');
const rules=require('../js/modules/auctionRules');
function fixture() {
  const date='2026-09-17',start=Date.parse(date+'T09:20:00+08:00');
  const meta={auctionFieldContractVerified:true,auctionTimestampMeaning:'source-event',auctionExpectedIntervalMs:5000,volumeUnit:'shares',priceUnit:'CNY',sourceId:'test',code:'600000'};
  const rows=Array.from({length:13},(_,i)=>({time:new Date(start+i*5000).toISOString(),availableAt:new Date(start+i*5000).toISOString(),
    auctionReferencePrice:10+i*.01,auctionMatchedVolume:10000+i*100,
    auctionUnmatchedBuyVolume:20000,auctionUnmatchedSellVolume:0}));
  const history=Array.from({length:20},(_,i)=>({date:'2026-08-'+String(i+1).padStart(2,'0'),phase:'opening',clock:'09:21:00',sourceId:'test',code:'600000',
    availableAt:'2026-09-16T07:00:00Z',qualityPassed:true,matchedAmount:1000+i*10,moveAbsPercent60s:.1,gapAbsPercent:.1,imbalanceAbs:.1}));
  return {date,phase:'opening',baseline:10,baselineAvailableAt:'2026-09-16T07:00:00Z',rows,meta,history,asOf:rows.at(-1).availableAt};
}
test('ordinary quotes never become auction evidence; zero unmatched volume stays zero',()=>{
  assert.equal(rules.analyze({...fixture(),meta:{}}).dataLevel,'D0');
  const r=rules.analyze(fixture());assert.equal(r.dataLevel,'D2');
  assert.equal(r.latest.matchedAmount,10.12*11200);assert.equal(r.latest.unmatchedSell,0);
  assert.equal(r.patterns.some(p=>p.id==='sustained-buy'),true);
  assert.equal(r.automaticTrading,false);
});
test('missing source fields and gaps cannot produce a directional pattern',()=>{
  for(const change of [f=>{f.rows[6].auctionMatchedVolume=null;},f=>{f.rows.splice(5,4);}]) {
    const f=fixture();change(f);const r=rules.analyze(f);
    assert.equal(r.patternStatus,'insufficient-data');assert.deepEqual(r.patterns,[]);
  }
});
test('future current samples and current-day baselines do not enter earlier signals',()=>{
  const f=fixture();f.asOf=f.rows[6].availableAt;f.history=f.history.map(h=>({...h,date:f.date}));
  const r=rules.analyze(f);assert.equal(r.points.length,7);assert.equal(r.historyCount,0);assert.deepEqual(r.patterns,[]);
});
test('unverified history, duplicate days and wrong stock/clock never satisfy minimum history',()=>{
  const f=fixture();f.history=f.history.map((h,i)=>i%2?{...h,code:'600001'}:{...h,date:'2026-08-01'});
  const r=rules.analyze(f);assert.equal(r.patternStatus,'insufficient-history');assert.deepEqual(r.patterns,[]);
});
test('closing phase uses its own baseline and leaves unavailable quantities blank',()=>{
  const f=fixture();f.phase='closing';f.baselineEventTime=f.date+'T14:56:59+08:00';f.baselineAvailableAt=f.date+'T14:57:00+08:00';f.rows=f.rows.map((r,i)=>({...r,time:new Date(Date.parse(f.date+'T14:57:00+08:00')+i*5000).toISOString(),availableAt:new Date(Date.parse(f.date+'T14:57:00+08:00')+i*5000).toISOString()}));
  f.asOf=f.rows.at(-1).availableAt;f.baseline=null;
  const r=rules.analyze(f);assert.equal(r.points.length,13);assert.equal(r.dataLevel,'D2');assert.deepEqual(r.patterns,[]);assert.equal(r.latest.changePercent,null);
  f.baseline=10;f.history=f.history.map(h=>({...h,phase:'closing',clock:'14:58:00'}));
  const qualified=rules.analyze(f);assert.equal(qualified.patterns.some(p=>p.id==='closing-pressure'),true);
  assert.deepEqual(rules.analyze({...f,baselineEventTime:f.date+'T14:57:00+08:00'}).patterns,[]);
  f.baseline=f.rows.at(-1).auctionReferencePrice;
  assert.equal(rules.analyze(f).patterns.some(p=>p.id==='closing-pressure'),false);
});

test('fractional shares and invalid historical dates cannot qualify as verified evidence',()=>{
  const f=fixture();f.rows[6].auctionMatchedVolume=1.5;
  assert.equal(rules.analyze(f).patternStatus,'insufficient-data');
  const bad=fixture();bad.history=bad.history.map((h,i)=>({...h,date:'bad-'+i}));
  assert.equal(rules.analyze(bad).historyCount,0);
});

test('verified process needs at least 90 percent declared cadence coverage',()=>{
  const f=fixture();f.rows=f.rows.filter((r,i)=>i%3===0);
  assert.equal(rules.analyze(f).patternStatus,'insufficient-data');
  const unknown=fixture();delete unknown.meta.auctionExpectedIntervalMs;
  assert.equal(rules.analyze(unknown).patternStatus,'insufficient-data');
});

test('signal availability includes delayed earlier samples and historical features',()=>{
  const f=fixture();f.asOf='2026-09-17T01:21:05Z';f.rows[1].availableAt=f.asOf;
  const r=rules.analyze(f);assert.ok(r.patterns.length);assert.equal(r.patterns[0].availableAt,f.asOf);
  const future=fixture();future.history=future.history.map(h=>({...h,availableAt:'2026-09-18T00:00:00Z'}));
  assert.equal(rules.analyze(future).historyCount,0);
  const futureBaseline=fixture();futureBaseline.baselineAvailableAt='2026-09-18T00:00:00Z';
  assert.deepEqual(rules.analyze(futureBaseline).patterns,[]);
});

test('auction chart has independent price, matched amount and unmatched-side panes',()=>{
  const r=rules.analyze(fixture()),chart=rules.chartOption(r,'2026-09-17');
  assert.equal(chart.grid.length,3);assert.equal(chart.xAxis[0].min,Date.parse('2026-09-17T09:15:00+08:00'));
  assert.equal(chart.xAxis[0].max,Date.parse('2026-09-17T09:25:00+08:00'));
  assert.equal(chart.series[0].connectNulls,false);
  assert.match(chart.series[1].name,/虚拟匹配/);
  assert.ok(chart.series[0].markPoint.data.length>0);
});
