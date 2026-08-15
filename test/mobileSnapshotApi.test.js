const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const iconv = require('iconv-lite');
const os = require('node:os');
const path = require('node:path');
const axios = require('axios');

const testDbPath = path.join(os.tmpdir(), 'webstock-mobile-snapshot-' + process.pid + '.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
}
process.env.WEBSTOCK_DB_PATH = testDbPath;

const db = require('../db');
const portfolio = require('../services/portfolioService');
const experts = require('../services/expertChannelService');
const { classifyChinaQuoteStatus } = require('../services/quoteSnapshotService');
const app = require('../server');

function requestJson(server, requestPath) {
  const port = server.address().port;
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path: requestPath }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        headers: response.headers,
        body,
        json: JSON.parse(body)
      }));
    }).on('error', reject);
  });
}

function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

test('GET /api/mobile/snapshot returns fresh account and research summaries without private content', async (t) => {
  const beijingDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const originalGet = axios.get;
  axios.get = async function() {
    const fields = new Array(32).fill('0');
    fields[0] = '长电科技';
    fields[2] = '57.00';
    fields[3] = '58.05';
    fields[4] = '58.50';
    fields[5] = '56.80';
    fields[8] = '123456';
    fields[9] = '7100000';
    fields[30] = beijingDate;
    fields[31] = '09:35:00';
    return { data: iconv.encode('var hq_str_sh600584="' + fields.join(',') + '";\n', 'gbk') };
  };
  t.after(function() { axios.get = originalGet; });

  portfolio.createTrade({
    accountId: 1,
    code: '600584',
    name: '长电科技',
    side: 'buy',
    tradeDate: '2026-08-10',
    price: 56,
    quantity: 200,
    fee: 5,
    tax: 0
  });
  portfolio.createAccount({
    accountKey: 'broker-7280',
    name: '广发证券 **7280',
    broker: '广发证券',
    maskedNumber: '**7280',
    cashBalance: 10000
  });

  const channel = experts.createChannel({
    channelKey: 'douyin-model-mr',
    displayName: '模型先生',
    platform: 'douyin'
  });
  experts.recordObservation(channel.id, {
    externalContentId: 'sample-video-1',
    sourceUrl: 'https://www.douyin.com/video/sample-video-1',
    title: '示例公开视频',
    evidenceLevel: 'primary',
    contentRole: 'transcript',
    mediaType: 'video',
    archiveStatus: 'downloaded',
    rightsBasis: 'user_owned',
    localAssetPath: 'D:\\private\\model-mr.mp4',
    transcript: '这一段正文不得发送到移动快照。'
  });

  const server = await listen(app);
  t.after(() => server.close());
  const result = await requestJson(server, '/api/mobile/snapshot');

  assert.equal(result.statusCode, 200);
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(result.json.success, true);
  assert.equal(result.json.data.accounts.length, 2);
  assert.equal(result.json.data.accounts[0].positions[0].currentPrice, 58.05);
  assert.equal(result.json.data.accounts[0].valuationStatus,
    classifyChinaQuoteStatus(beijingDate, Date.now()) === 'live' ? 'live' : 'stale');
  assert.equal(result.json.data.research.channels[0].videoCount, 1);
  assert.equal(result.json.data.research.channels[0].transcriptCount, 1);
  assert.equal(result.json.data.research.channels[0].archiveCount, 1);
  assert.equal(result.body.includes('这一段正文'), false);
  assert.equal(result.body.includes('model-mr.mp4'), false);
});

test.after(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
  }
});
