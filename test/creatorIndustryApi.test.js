const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'creator-industry-api-'));
process.env.WEBSTOCK_DB_PATH = path.join(directory, 'test.db');
const { createIndustryChainRouter } = require('../routes/industryChain');
test.after(() => { require('../db').close(); fs.rmSync(directory, { recursive:true, force:true }); });

test('manual creator analysis acknowledges the background run without waiting for AI', async t => {
  let finish, calls = 0;
  const pending = new Promise(resolve => { finish = resolve; });
  const app = express(); app.use(express.json());
  app.use('/api', createIndustryChainRouter({ creatorService: {
    read: async () => ({ aiConfigured: true }),
    run: () => { calls++; return pending; }
  } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { finish({ status:'complete' }); server.closeAllConnections(); server.close(); });
  const response = await fetch('http://127.0.0.1:'+server.address().port+'/api/industry-chain/creators/4/analyze', { method:'POST', signal:AbortSignal.timeout(1000) });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).data.status, 'queued');
  assert.equal(calls, 1);
});

test('manual creator analysis does not queue when AI is unconfigured', async t => {
  let calls=0;
  const app=express();app.use(express.json());
  app.use('/api',createIndustryChainRouter({creatorService:{read:async()=>({aiConfigured:false}),run:()=>{calls++;}}}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/industry-chain/creators/4/analyze',{method:'POST'});
  assert.equal((await response.json()).data.status,'ai_not_configured');assert.equal(calls,0);
});

test('creator observation endpoint returns source text without running analysis', async t => {
  let calls=0;
  const app=express();app.use(express.json());
  app.use('/api',createIndustryChainRouter({creatorService:{readDocument:async (_id, observationId)=>{
    calls++;return {observationId:Number(observationId),transcript:'原始文稿',status:'ready'};
  }}}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/industry-chain/creators/4/observations/7');
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual((await response.json()).data,{observationId:7,transcript:'原始文稿',status:'ready'});
  assert.equal(calls,1);
});
