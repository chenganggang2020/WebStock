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
  darkHistory:{append:async()=>true,compare:async()=>({sh600487:{fromAt:'2026-09-16T02:00:00Z',toAt:'2026-09-16T02:05:00Z',darkNetChangeCents:'120',visibleNetChangeCents:'-50'}})},
  darkStockLoader:async input=>{
    assert.equal(input.date,'2026-09-16');assert.equal(input.pageSize,100);
    return normalizeDarkRank({...fixture,2:1,data:[{...fixture.data[0],3:1,4:'600487'}]},input,'2026-09-17T00:00:00Z');
  }
},async base=>{
  const r=await fetch(base+'/api/capital-flow/dark-stocks?codes=sh600487,sz000001');
  assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
  const {data}=await r.json();assert.equal(data.rows.length,1);assert.equal(data.rows[0].key,'sh600487');
  assert.deepEqual(data.missing,['sz000001']);assert.equal(data.tradingDay,'2026-09-16');assert.equal(data.raw,undefined);
  assert.equal(data.comparisons.sh600487.darkNetChangeCents,'120');
}));
test('invalid symbols and duplicate query fields never invoke stock source',()=>withApi({
  darkStockLoader:async()=>{throw Error('must not run');}
},async base=>{
  for(const query of ['','codes=600487','codes=sh000001','codes=sh600487&codes=sz000001','codes=<script>',
    'codes=sh600487&force=bad','codes=sh600487&force=1&force=1']) {
    assert.equal((await fetch(base+'/api/capital-flow/dark-stocks?'+query)).status,400);
  }
}));
test('manual refresh explicitly bypasses a fresh cache while ordinary reads reuse it',async()=>{
  let calls=0;
  await withApi({now:()=>new Date('2026-09-17T08:00:00+08:00'),darkHistory:{append:async()=>true},darkCapLoader:async()=>new Map(),
    darkStockLoader:async input=>{
      calls++;
      return normalizeDarkRank({...fixture,2:1,data:[{...fixture.data[0],3:1,4:'600487'}]},input,'2026-09-17T00:00:00Z');
    }
  },async base=>{
    const url=base+'/api/capital-flow/dark-stocks?codes=sh600487';
    assert.equal((await fetch(url)).status,200);assert.equal((await fetch(url)).status,200);assert.equal(calls,1);
    const manual=await fetch(url+'&force=1');assert.equal(manual.status,200);assert.equal(calls,2);
    assert.equal((await manual.json()).data.cache.hit,false);
    const board=base+'/api/capital-flow/dark-rank-board?date=2026-09-16&metric=amount';
    assert.equal((await fetch(board)).status,200);assert.equal(calls,2);
    assert.equal((await fetch(board+'&force=1')).status,200);assert.equal(calls,3);
    assert.equal((await fetch(board+'&force=bad')).status,400);assert.equal(calls,3);
  });
});
test('stale cache keeps its available historical comparison during background refresh',async t=>{
  let clock=0,calls=0,release;
  t.mock.method(Date,'now',()=>clock);
  const comparison={sh600487:{fromAt:'2026-09-16T02:00:00Z',toAt:'2026-09-16T02:05:00Z',darkNetChangeCents:'120',visibleNetChangeCents:'-50'}};
  await withApi({now:()=>new Date('2026-09-17T08:00:00+08:00'),
    darkHistory:{append:async data=>!data.stale,compare:async()=>comparison},
    darkStockLoader:async input=>{
      calls++;
      const data=normalizeDarkRank({...fixture,2:1,data:[{...fixture.data[0],3:1,4:'600487'}]},input,'2026-09-17T00:00:00Z');
      if(calls===1)return data;
      return new Promise(resolve=>{release=()=>resolve(data);});
    }
  },async base=>{
    const url=base+'/api/capital-flow/dark-stocks?codes=sh600487';
    await fetch(url);clock=300001;
    try {
      const {data}=await (await fetch(url)).json();
      assert.equal(data.stale,true);assert.equal(data.historySaved,false);
      assert.deepEqual(data.comparisons,comparison);
    } finally {release();}
  });
});
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
