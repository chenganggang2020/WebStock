const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDbPath = path.join(os.tmpdir(), 'webstock-ai-research-api-' + process.pid + '.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
}
process.env.WEBSTOCK_DB_PATH = testDbPath;
process.env.OPENAI_API_KEY = '';
process.env.WEBSTOCK_DISABLE_SINA_NEWS = '1';
process.env.WEBSTOCK_HOT_MARKET_OFFLINE = '1';
process.env.WEBSTOCK_SENTIMENT_OFFLINE = '1';
process.env.WEBSTOCK_STOCK_PROFILE_OFFLINE = '1';

const app = require('../server');

function requestJson(server, options, body) {
  const address = server.address();
  const requestOptions = Object.assign({
    hostname: '127.0.0.1',
    port: address.port,
    method: 'GET',
    headers: {}
  }, typeof options === 'string' ? { path: options } : options);

  return new Promise((resolve, reject) => {
    const req = http.request(requestOptions, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, json: JSON.parse(raw) }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

test('expert knowledge API supports source, search, handoff and saved research runs', async t => {
  const server = app.listen(0);
  t.after(() => server.close());

  const created = await requestJson(server, {
    path: '/api/knowledge/sources',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    sourceType: 'book',
    title: '产业链研究方法',
    author: '测试作者',
    tags: ['先进封装', '半导体'],
    stockCodes: ['688981'],
    content: '先进封装研究需要核对产能利用率、客户验证、设备材料国产化率。不能只依据题材名称判断主营相关性。'
  });
  assert.equal(created.statusCode, 200);
  assert.equal(created.json.success, true);
  assert.ok(created.json.data.chunkCount >= 1);

  const searched = await requestJson(server, {
    path: '/api/knowledge/search',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { query: '先进封装', limit: 8 });
  assert.equal(searched.json.success, true);
  assert.equal(searched.json.data.items[0].sourceId, created.json.data.id);

  const analyzed = await requestJson(server, {
    path: '/api/knowledge/analyze',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { question: '先进封装股票要核对哪些条件？', mode: 'stock-fit' });
  assert.equal(analyzed.json.success, true);
  assert.equal(analyzed.json.data.handoffMode, true);
  assert.match(analyzed.json.data.prompt, /WEBSTOCK_RESULT_START/);
  assert.ok(analyzed.json.data.evidence.length >= 1);

  const saved = await requestJson(server, {
    path: '/api/research-runs',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    runType: 'knowledge-analysis',
    modelId: 'chatgpt-handoff',
    status: 'completed',
    title: '先进封装检查',
    question: '先进封装股票要核对哪些条件？',
    prompt: analyzed.json.data.prompt,
    result: '重点核对客户验证、利用率和国产化率。',
    evidence: analyzed.json.data.evidence
  });
  assert.equal(saved.json.success, true);
  assert.ok(saved.json.data.id > 0);

  const runs = await requestJson(server, '/api/research-runs?runType=knowledge-analysis');
  assert.ok(runs.json.data.some(item => item.id === saved.json.data.id));

  const models = await requestJson(server, '/api/ai-models');
  assert.equal(models.json.success, true);
  assert.ok(models.json.data.some(item => item.id === 'knowledge-fts-v1' && item.status === 'available'));
  assert.ok(models.json.data.some(item => item.id === 'master' && item.status !== 'planned'));
});

test('knowledge analysis refuses to invent an answer without matching evidence', async t => {
  const server = app.listen(0);
  t.after(() => server.close());

  const analyzed = await requestJson(server, {
    path: '/api/knowledge/analyze',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { question: '一个完全不存在的量子香蕉主题怎么看？' });
  assert.equal(analyzed.statusCode, 400);
  assert.equal(analyzed.json.success, false);
  assert.match(analyzed.json.error, /证据|知识库/);
});
