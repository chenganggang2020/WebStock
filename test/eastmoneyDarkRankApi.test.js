const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {createCapitalFlowRouter} = require('../routes/capitalFlow');
const {normalizeDarkRank} = require('../services/capitalFlow/eastmoneyDarkRank');
const fixture = require('./fixtures/eastmoney-dark-rank-20260916.json');
const input = {date:'2026-09-16',scope:'stock',page:1};
const sample = normalizeDarkRank(fixture,input,'2026-09-17T08:20:00Z');
async function withApi(loader, fn) {
  const app=express();
  app.use('/api',createCapitalFlowRouter({service:{},darkRankLoader:loader}));
  const server=app.listen(0,'127.0.0.1');
  await new Promise(r=>server.once('listening',r));
  try {await fn('http://127.0.0.1:'+server.address().port);} finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
}
test('dark rank API is explicit, validates inputs and removes raw provider payload',()=>withApi(async x=>{
  assert.deepEqual(x,input);return {...sample,raw:fixture};
},async base=>{
  const r=await fetch(base+'/api/capital-flow/dark-rank?date=2026-09-16&scope=stock&page=1');
  assert.equal(r.status,200);
  const p=await r.json();assert.equal(p.data.rows[0].darkNetCents,'100977344600');
  assert.equal(p.data.raw,undefined);assert.equal(p.data.source.classification,'provider-model-estimate');
  assert.equal(r.headers.get('cache-control'),'no-store');
}));
test('invalid dates, duplicate params, concepts and unbounded pages never reach provider',()=>withApi(async()=>{throw Error('must not call');},async base=>{
  for(const q of ['','date=2026-02-30&scope=stock','date=2026-09-16&scope=concept','date=2026-09-16&scope=stock&page=1001','date=2026-09-16&scope=stock&scope=industry','date=2026-09-16&scope=stock&page=1.5']) {
    const r=await fetch(base+'/api/capital-flow/dark-rank?'+q);assert.equal(r.status,400);
  }
}));
test('provider failures are explicit, do not leak internal messages or substitute ordinary capital flows',()=>withApi(async()=>{throw Error('private-provider-host secret');},async base=>{
  const r=await fetch(base+'/api/capital-flow/dark-rank?date=2026-09-16&scope=stock');
  assert.equal(r.status,502);const p=await r.json();assert.equal(p.success,false);
  assert.doesNotMatch(JSON.stringify(p),/private-provider-host|secret/);
}));
test('bounded cache shares inflight requests, expires and never changes capture time',async()=>{
  const {createDarkRankService}=require('../services/capitalFlow/darkRankService');
  let now=0,calls=0,release;
  const service=createDarkRankService({now:()=>now,load:()=>{calls++;return new Promise(r=>{release=r;});}});
  const a=service.get(input),b=service.get(input);await Promise.resolve();
  assert.equal(calls,1);release(sample);const [x,y]=await Promise.all([a,b]);
  assert.equal(x.receivedAt,y.receivedAt);assert.equal((await service.get(input)).cache.hit,true);
  assert.equal(calls,1);now=60001;
  const c=service.get(input);await Promise.resolve();release(sample);await c;assert.equal(calls,2);
});
test('only two distinct provider requests can run simultaneously; failures release slots',async()=>{
  const {createDarkRankService}=require('../services/capitalFlow/darkRankService');
  const releases=[];
  const service=createDarkRankService({load:()=>new Promise((resolve,reject)=>releases.push({resolve,reject}))});
  const a=service.get(input),b=service.get({...input,page:2});await Promise.resolve();
  await assert.rejects(service.get({...input,page:3}),{code:'DARK_RANK_BUSY'});
  releases[0].resolve(sample);releases[1].reject(Error('offline'));
  await a;await assert.rejects(b,/offline/);
  const c=service.get({...input,page:3});await Promise.resolve();releases[2].resolve(sample);await c;
});
test('expired cache is not served as new data on failure; oldest cached pages are evicted',async()=>{
  const {createDarkRankService}=require('../services/capitalFlow/darkRankService');
  let now=0,fail=false,calls=0;
  const service=createDarkRankService({now:()=>now,load:async()=>{calls++;if(fail)throw Error('offline');return sample;}});
  for(let page=1;page<=33;page++) await service.get({...input,page});
  await service.get(input);assert.equal(calls,34);
  now=60001;fail=true;await assert.rejects(service.get(input),/offline/);
});
