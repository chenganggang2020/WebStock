const test=require('node:test');
const assert=require('node:assert/strict');
test('global daily trend preserves null gaps, verified identity, date and source',()=>{
  const {parseIndexChart}=require('../services/globalIndexTrendService');
  const definition={key:'nikkei225',symbol:'^N225',name:'日经225',zone:'Asia/Tokyo'};
  const input={chart:{result:[{meta:{symbol:'^N225'},timestamp:[1789516800,1789603200,1789689600],indicators:{quote:[{close:[100,null,103]}]}}]}};
  const result=parseIndexChart(input,definition);
  assert.equal(result.trend.length,3);assert.equal(result.trend[1].close,null);
  assert.equal(result.value,103);assert.equal(result.changePct,null,'missing previous close must not become a multi-day daily change');
  assert.match(result.observedAt,/2026-09-18/);assert.equal(result.source,'Yahoo Finance · 日线');
  input.chart.result[0].meta.symbol='WRONG';assert.throws(()=>parseIndexChart(input,definition));
});

test('daily index K lines preserve OHLC and leave an incomplete latest session blank',()=>{
  const {parseIndexChart}=require('../services/globalIndexTrendService');
  const result=parseIndexChart({chart:{result:[{meta:{symbol:'^N225'},timestamp:[1789603200,1789689600],
    indicators:{quote:[{open:[99,104],high:[102,105],low:[98,102],close:[100,null],volume:[1000,0]}]}}]}},
    {key:'nikkei225',symbol:'^N225',name:'日经225',zone:'Asia/Tokyo'});
  assert.deepEqual(result.candles[0],{date:'2026-09-17',open:99,high:102,low:98,close:100,volume:1000});
  assert.equal(result.candles[1].close,null);
  assert.equal(result.candles[1].volume,null,'zero source volume must not imply no trading');
  assert.equal(result.value,100);
  assert.equal(result.validCandleCount,1);
});

test('Sina futures JSONP supplies real OHLC, not executable code or zero-filled volume',()=>{
  const {parseSinaDaily}=require('../services/globalIndexTrendService');
  const result=parseSinaDaily('/*<script>ignored source prefix</script>*/\nvar _globalK=([{"date":"2026-10-08","open":"31403","high":"31466","low":"31119.75","close":"31281.75","volume":"0"}]);',
    {key:'nasdaq100-future',symbol:'NQ',name:'纳指100期货 CFD',kind:'futures'});
  assert.deepEqual(result.candles[0],{date:'2026-10-08',open:31403,high:31466,low:31119.75,close:31281.75,volume:null});
  assert.equal(result.volumeStatus,'unavailable');
  assert.throws(()=>parseSinaDaily('var _globalK=(process.exit());',{kind:'futures'}));
});

test('Sina offshore FX format is date, open, low, high, close and has no volume',()=>{
  const {parseSinaDaily}=require('../services/globalIndexTrendService');
  const result=parseSinaDaily('var _globalK=("2026-10-07,6.70140,6.69970,6.70990,6.70250");',
    {key:'usd-cnh',symbol:'fx_susdcnh',name:'美元/离岸人民币',kind:'fx'});
  assert.deepEqual(result.candles[0],{date:'2026-10-07',open:6.7014,high:6.7099,low:6.6997,close:6.7025,volume:null});
  assert.equal(result.value,6.7025);
});

test('invalid OHLC is a visible gap, never a candle made from a close alone',()=>{
  const {parseSinaDaily}=require('../services/globalIndexTrendService');
  const result=parseSinaDaily('var _globalK=([{"date":"2026-10-07","open":10,"high":12,"low":9,"close":11},{"date":"2026-10-08","open":10,"high":8,"low":9,"close":11}]);',
    {key:'wti-future',symbol:'CL',name:'纽约原油 CFD',kind:'futures'});
  assert.equal(result.candles[1].open,null);
  assert.equal(result.validCandleCount,1);
});

test('all home external instruments have exact history symbol mappings',()=>{
  const {DEFINITIONS}=require('../services/globalIndexTrendService');
  assert.equal(DEFINITIONS.length,11);
  assert.equal(new Set(DEFINITIONS.map(row=>row.key)).size,11);
  assert.equal(DEFINITIONS.find(row=>row.key==='usd-cnh').symbol,'fx_susdcnh');
  assert.equal(DEFINITIONS.find(row=>row.key==='china-a50-future').symbol,'CHA50CFD');
  assert.equal(DEFINITIONS.find(row=>row.key==='nasdaq100-future').symbol,'NQ');
});

test('failed refresh and process restart retain last good history and its original fetch time',async()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const {createGlobalIndexTrendService}=require('../services/globalIndexTrendService');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'global-kline-test-'));
  const cacheFile=path.join(directory,'history.json');
  let clock=Date.UTC(2026,9,8),fail=false,calls=0;
  const http={get:async url=>{
    calls++;
    if(fail || !url.includes('symbol=NQ'))throw Error('source timeout');
    return {data:'var _globalK=([{"date":"2026-10-07","open":10,"high":12,"low":9,"close":11}]);'};
  }};
  try {
    const service=createGlobalIndexTrendService({http,now:()=>clock,cacheFile});
    const first=await service.fetch();
    const original=first.items.find(row=>row.key==='nasdaq100-future');
    assert.ok(original.candles.length);
    await service.fetch();
    assert.equal(calls,11,'normal repeated reads use cached history');
    clock+=360000;fail=true;
    const second=await service.fetch({force:true});
    const retained=second.items.find(row=>row.key===original.key);
    assert.deepEqual(retained.candles,original.candles);
    assert.equal(retained.fetchedAt,original.fetchedAt);
    assert.equal(retained.historyStatus,'cached');
    assert.match(retained.refreshError,/timeout/);
    const restarted=createGlobalIndexTrendService({http,now:()=>clock,cacheFile});
    const restored=(await restarted.fetch({force:true})).items.find(row=>row.key===original.key);
    assert.deepEqual(restored.candles,original.candles);
    assert.equal(restored.fetchedAt,original.fetchedAt);
    assert.equal(restored.historyStatus,'cached');
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
