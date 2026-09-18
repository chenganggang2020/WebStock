const test = require('node:test');
const assert = require('node:assert/strict');
const {formatCents, renderRows, createReplayModule} = require('../js/modules/capitalFlowReplay');
const {replayDocument} = require('../services/capitalFlow/replayDocument');
const fs = require('node:fs');
const data = replayDocument(fs.readFileSync(require.resolve('./fixtures/cumulative-replay-demo.json')), {maxTradingGapMs:60000});
test('replay formats cents exactly and keeps unknown separate from zero', () => {
  assert.equal(formatCents(null), '--');
  assert.equal(formatCents('0'), '0.00 元');
  assert.equal(formatCents('-1'), '-0.01 元');
  assert.equal(formatCents('900719925474099301'), '9,007,199,254,740,993.01 元');
});
test('replay displays gaps, corrections, late rows and escapes source values', () => {
  const records = structuredClone(data.records);
  records[0].snapshot.sourceId = '<img src=x onerror=alert(1)>';
  const html = renderRows(records);
  assert.match(html, /采样缺口/); assert.match(html,/修订基线/); assert.match(html,/迟到隔离/);
  assert.ok(!html.includes('<img'));
});
test('a stale request cannot replace a newer replay or its error state', async () => {
  const elements = new Map();
  const doc = {getElementById(id) {
    if(!elements.has(id)) elements.set(id,{textContent:'',innerHTML:'',value:'',hidden:false,addEventListener(){}});
    return elements.get(id);
  }};
  const view = createReplayModule({document:doc,fetch:async()=>({ok:true,json:async()=>({success:true,data})})});
  let resolveOld;
  const older = view.run(()=>new Promise(r=>{resolveOld=r;}),'旧文件');
  await view.run(async()=>{throw Error('新文件错误');},'新文件');
  resolveOld(new ArrayBuffer(0)); await older;
  assert.match(doc.getElementById('flowReplayStatus').textContent,/新文件错误/);
  assert.equal(doc.getElementById('flowReplayOutput').hidden,true);
});
