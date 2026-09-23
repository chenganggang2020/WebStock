const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {createCapitalFlowRouter}=require('../routes/capitalFlow');
const {normalizeDarkRank}=require('../services/capitalFlow/eastmoneyDarkRank');
const fixture=require('./fixtures/eastmoney-dark-rank-20260916.json');
async function withApi(options,fn) {
  const app=express();app.use('/api',createCapitalFlowRouter({service:{},...options}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try {await fn('http://127.0.0.1:'+server.address().port);} finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
}
test('stock route selects the exchange day, isolates requested symbols and returns no raw payload',()=>withApi({
  now:()=>new Date('2026-09-17T08:00:00+08:00'),
  darkStockLoader:async input=>{
    assert.equal(input.date,'2026-09-16');assert.equal(input.pageSize,100);
    return normalizeDarkRank({...fixture,2:1,data:[{...fixture.data[0],3:1,4:'600487'}]},input,'2026-09-17T00:00:00Z');
  }
},async base=>{
  const r=await fetch(base+'/api/capital-flow/dark-stocks?codes=sh600487,sz000001');
  assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
  const {data}=await r.json();assert.equal(data.rows.length,1);assert.equal(data.rows[0].key,'sh600487');
  assert.deepEqual(data.missing,['sz000001']);assert.equal(data.tradingDay,'2026-09-16');assert.equal(data.raw,undefined);
}));
test('invalid symbols and duplicate query fields never invoke stock source',()=>withApi({
  darkStockLoader:async()=>{throw Error('must not run');}
},async base=>{
  for(const query of ['','codes=600487','codes=sh000001','codes=sh600487&codes=sz000001','codes=<script>']) {
    assert.equal((await fetch(base+'/api/capital-flow/dark-stocks?'+query)).status,400);
  }
}));
test('unknown calendar and provider failure are explicit with sanitized messages',async()=>{
  await withApi({now:()=>new Date('2027-01-04T02:00:00Z')},async base=>{
    const r=await fetch(base+'/api/capital-flow/dark-stocks?codes=sh600487');assert.equal(r.status,503);
  });
  await withApi({now:()=>new Date('2026-09-17T02:00:00Z'),darkStockLoader:async()=>{throw Error('secret upstream token');}},async base=>{
    const r=await fetch(base+'/api/capital-flow/dark-stocks?codes=sh600487');assert.equal(r.status,502);
    assert.doesNotMatch(JSON.stringify(await r.json()),/secret|token/);
    const state=await (await fetch(base+'/api/capital-flow/dark-session')).json();assert.equal(state.data.pollAllowed,true);
  });
});
