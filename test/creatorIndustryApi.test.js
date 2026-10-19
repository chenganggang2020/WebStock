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

test('legacy review imports are not mislabeled as complete V2 analysis', async t => {
  const versions=[];
  const app=express();app.use(express.json());
  app.use('/api',createIndustryChainRouter({creatorService:{importReviews:async (_id,_items,options)=>{versions.push(options.specVersion);return {ok:true};}}}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const base='http://127.0.0.1:'+server.address().port+'/api/industry-chain/creators/4/import';
  for (const schema of ['webstock.creator-industry-review/v1','webstock.creator-industry-review/v2']) {
    const response=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({schema,items:[{}]})});
    assert.equal(response.status,200);
  }
  assert.deepEqual(versions,['legacy-review/v1','creator-industry-graph/v2']);
});

test('single creator transcript is read-only and returned only for the requested work', async t => {
  const calls=[];
  const app=express();app.use('/api',createIndustryChainRouter({creatorService:{readDocument:async (id,observationId)=>{
    calls.push([id,observationId]);return {observationId:Number(observationId),text:'原始文稿',asr:{status:'complete',segments:[]}};
  }}}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/industry-chain/creators/4/observations/34321');
  assert.equal(response.status,200);
  assert.equal((await response.json()).data.text,'原始文稿');
  assert.deepEqual(calls,[['4','34321']]);
});

test('creator GET reevaluates quality and returns no withdrawn claims without mutating history', async t => {
  const { createCreatorIndustryService, documentHash } = require('../services/creatorIndustryService');
  const row = { id: 8, mediaType: 'video', evidenceLevel: 'primary',
    transcript: '保偏光纤用于光引擎的激光传输。保偏光纤用于光引擎的激光传输。',
    mediaMetadata: { asr: { status: 'complete' } } };
  const storage = path.join(directory, 'projection');
  const creatorService = createCreatorIndustryService({ directory: storage, channels: {
    getChannel: () => ({ id: 4, displayName: '隔离测试作者' }), listCollectionObservations: () => [row]
  } });
  const app = express(); app.use(express.json());
  app.use('/api', createIndustryChainRouter({ creatorService }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = 'http://127.0.0.1:'+server.address().port+'/api/industry-chain/creators/4';
  const imported = await fetch(base+'/import', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schema: 'webstock.creator-industry-review/v2', items: [{ observationId: 8,
      bodyHash: documentHash(row), relations: [{ topic: 'CPO', from: '保偏光纤', to: '光引擎', relation: '使用',
        quote: '保偏光纤用于光引擎的激光传输。', polarity: 'supports' }] }] }) });
  assert.equal(imported.status, 200);
  assert.equal((await imported.json()).data.currentAnalyzedCount, 1);
  const before = fs.readFileSync(path.join(storage, 'author-4.json'), 'utf8');
  row.mediaMetadata.asr.status = 'needs_review';
  const response = await fetch(base);
  assert.equal(response.status, 200);
  const result = (await response.json()).data;
  assert.deepEqual(result.relations, []);
  assert.equal(result.currentAnalyzedCount, 0);
  assert.equal(result.historicalAnalyzedCount, 1);
  assert.equal(result.reviewQueue[0].currentRelationCount, 0);
  assert.equal(result.reviewQueue[0].status, 'asr_review_required');
  assert.equal(result.documents[0].currentEligible, false);
  assert.equal(fs.readFileSync(path.join(storage, 'author-4.json'), 'utf8'), before);
  row.mediaMetadata.asr.status = 'complete';
  assert.equal((await (await fetch(base)).json()).data.relations.length, 1);
});
