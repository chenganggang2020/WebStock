const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {readFileSync} = require('node:fs');
const {createHash} = require('node:crypto');
const {createCapitalFlowRouter} = require('../routes/capitalFlow');
const fixture = readFileSync(require.resolve('./fixtures/cumulative-replay-demo.json'));
async function withApi(fn) {
  const app = express();
  app.use(express.json());
  app.use('/api', createCapitalFlowRouter({service: {getSeries() {throw Error('must not fetch quotes');}}}));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  try {await fn('http://127.0.0.1:' + server.address().port);} finally {server.closeAllConnections(); await new Promise(r => server.close(r));}
}
test('UI replay API shares CLI engine, hashes original bytes and marks evidence unverified', () => withApi(async base => {
  const r = await fetch(base + '/api/capital-flow/replay?maxGapMs=60000', {method:'POST', headers:{'Content-Type':'application/octet-stream'}, body:fixture});
  assert.equal(r.status, 200);
  const {data} = await r.json();
  assert.equal(data.provenance.inputSha256, createHash('sha256').update(fixture).digest('hex'));
  assert.equal(data.records[2].result.continuity, 'gap');
  assert.equal(data.records[4].result.status, 'LATE');
  assert.equal(data.automaticTrading, false);
}));
test('replay rejects wrong types, invalid data, excess input and invalid cadence', () => withApi(async base => {
  for (const [body, type, query, status] of [
    ['{}','application/json','',400], ['{','application/octet-stream','',400],
    [fixture,'application/octet-stream','?maxGapMs=-1',400],
    [Buffer.alloc(2*1024*1024+1),'application/octet-stream','',413]
  ]) {
    const r = await fetch(base+'/api/capital-flow/replay'+query,{method:'POST',headers:{'Content-Type':type},body});
    assert.equal(r.status,status); assert.equal((await r.json()).success,false);
  }
}));
test('demo is explicit synthetic data and cannot select a server file', () => withApi(async base => {
  const r = await fetch(base+'/api/capital-flow/replay-demo');
  assert.equal(r.status,200);
  const doc = await r.json();
  assert.match(doc.note,/合成/);
  assert.equal(doc.snapshots.length,6);
}));
