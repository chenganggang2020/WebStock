const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const testDbPath = path.join(os.tmpdir(), 'webstock-expert-channel-api-' + process.pid + '.db');
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

function requestJson(server, requestPath, method = 'GET', body) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: address.port,
      path: requestPath,
      method,
      headers: body == null ? {} : { 'Content-Type': 'application/json' }
    }, res => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, json: JSON.parse(raw) }));
    });
    req.on('error', reject);
    if (body != null) req.write(JSON.stringify(body));
    req.end();
  });
}

test('expert channel API persists a timeline and creates a provenance-aware handoff', async t => {
  const server = app.listen(0);
  t.after(() => server.close());

  const created = await requestJson(server, '/api/expert/channels', 'POST', {
    channelKey: 'douyin-model-mr',
    displayName: '模型先生',
    platform: 'douyin'
  });
  assert.equal(created.statusCode, 200);
  const channelId = created.json.data.id;

  const observation = await requestJson(server, '/api/expert/channels/' + channelId + '/observations', 'POST', {
    externalContentId: 'public-video-1',
    sourceUrl: 'https://www.douyin.com/video/7533142185677114684',
    title: '科创芯片观察',
    publishedAt: '2025-07-31T15:19:00+08:00',
    evidenceLevel: 'primary',
    contentRole: 'transcript',
    content: '科创芯片需要持续关注，看有没有新的公司出现。',
    sectors: ['科创芯片']
  });
  assert.equal(observation.statusCode, 200);
  assert.equal(observation.json.data.evidenceLevel, 'primary');

  const timeline = await requestJson(server, '/api/expert/channels/' + channelId + '/observations');
  assert.equal(timeline.json.data.length, 1);

  require('../services/expertChannelService').recordBacktest(channelId, {
    runId: 'api-expert-run', datasetId: 'dataset-demo', result: { coverage: { strictEligibleObservations: 0 } }
  });
  const backtests = await requestJson(server, '/api/expert/channels/' + channelId + '/backtests');
  assert.equal(backtests.statusCode, 200);
  assert.equal(backtests.json.data[0].runId, 'api-expert-run');

  const analysis = await requestJson(server, '/api/expert/channels/' + channelId + '/intent-analysis', 'POST', {});
  assert.equal(analysis.statusCode, 200);
  assert.equal(analysis.json.data.handoffMode, true);
  assert.match(analysis.json.data.prompt, /第三方材料/);
  assert.match(analysis.json.data.prompt, /模型推断/);
  assert.match(analysis.json.data.prompt, /WEBSTOCK_RESULT_START/);
});

test.after(() => {
  require('../db').close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
  }
});
