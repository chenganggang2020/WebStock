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

test('research subject API stores chart material and supports deletion', async t => {
  const server = app.listen(0);
  t.after(() => server.close());

  const created = await requestJson(server, '/api/expert/channels', 'POST', {
    channelKey: 'method-chart-api',
    displayName: '图形分析方法',
    subjectType: 'method',
    platform: 'manual',
    description: '用户维护的方法资料。'
  });
  assert.equal(created.statusCode, 200);
  assert.equal(created.json.data.subjectType, 'method');
  const channelId = created.json.data.id;

  const saved = await requestJson(server, '/api/expert/channels/' + channelId + '/observations', 'POST', {
    externalKey: 'chart-api-1',
    title: '价格曲线样例',
    mediaType: 'chart',
    archiveStatus: 'local_reference',
    rightsBasis: 'user_owned',
    curveData: '09:30,10.2\n10:00,10.8',
    analysisNotes: '盘中曲线示例。',
    summary: '用于界面预览的自有曲线数据。'
  });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.json.data.curveData.map(item => item.y), [10.2, 10.8]);

  const removedObservation = await requestJson(server,
    '/api/expert/channels/' + channelId + '/observations/' + saved.json.data.id, 'DELETE');
  assert.equal(removedObservation.statusCode, 200);
  assert.equal(removedObservation.json.data.deleted, true);

  const removedChannel = await requestJson(server, '/api/expert/channels/' + channelId, 'DELETE');
  assert.equal(removedChannel.statusCode, 200);
  assert.equal(removedChannel.json.data.deleted, true);
});

test('Douyin link import stores direct candidates as unverified and skips duplicates', async t => {
  const server = app.listen(0);
  t.after(() => server.close());

  const created = await requestJson(server, '/api/expert/channels', 'POST', {
    channelKey: 'douyin-direct-import-api',
    displayName: '抖音测试作者',
    platform: 'douyin'
  });
  const channelId = created.json.data.id;
  const imported = await requestJson(server, '/api/expert/channels/' + channelId + '/douyin-links', 'POST', {
    text: [
      '公开视频 https://www.douyin.com/video/7533142185677114684?from=copy',
      '重复 https://www.douyin.com/video/7533142185677114684/',
      '无关 https://example.com/video/1'
    ].join('\n')
  });

  assert.equal(imported.statusCode, 200);
  assert.equal(imported.json.data.importedCount, 1);
  assert.equal(imported.json.data.duplicateCount, 1);
  assert.equal(imported.json.data.ignoredCount, 1);
  assert.equal(imported.json.data.items[0].externalContentId, '7533142185677114684');
  assert.equal(imported.json.data.items[0].availabilityStatus, 'unknown');
  assert.equal(imported.json.data.items[0].evidenceLevel, 'commentary');
  assert.deepEqual(imported.json.data.items[0].stockCodes, []);

  const channel = await requestJson(server, '/api/expert/channels/' + channelId);
  assert.equal(channel.json.data.directDouyinCount, 1);

  const repeated = await requestJson(server, '/api/expert/channels/' + channelId + '/douyin-links', 'POST', {
    text: 'https://open.douyin.com/player/video?vid=7533142185677114684&autoplay=0'
  });
  assert.equal(repeated.json.data.importedCount, 0);
  assert.equal(repeated.json.data.duplicateCount, 1);
});

test('Douyin desktop capture upgrades verified profile items and remains idempotent', async t => {
  const server = app.listen(0);
  t.after(() => server.close());

  const profileUrl = 'https://www.douyin.com/user/MS4wLjABAAAA-capture-test';
  const created = await requestJson(server, '/api/expert/channels', 'POST', {
    channelKey: 'douyin-desktop-capture-api',
    displayName: '模型先生',
    platform: 'douyin',
    profileUrl,
    aliases: ['抖音模型先生']
  });
  const channelId = created.json.data.id;

  await requestJson(server, '/api/expert/channels/' + channelId + '/douyin-links', 'POST', {
    text: '待核验 https://www.douyin.com/video/7533142185677114684'
  });

  const capture = {
    pageType: 'profile',
    pageUrl: profileUrl,
    loggedIn: true,
    capturedAt: '2026-08-11T10:00:00.000Z',
    profile: {
      displayName: '模型先生',
      profileUrl,
      douyinId: 'moxingxiansheng',
      workCount: 368
    },
    items: [{
      sourceUrl: 'https://www.douyin.com/video/7533142185677114684?from=profile',
      title: '科创芯片观察',
      publishedAt: '2025-07-31T15:19:00+08:00',
      summary: '当前登录页面中可见的内容摘要。',
      author: '模型先生'
    }, {
      sourceUrl: 'https://www.douyin.com/note/7641362696420887025',
      title: '产业曲线图文记录',
      author: '模型先生'
    }]
  };

  const imported = await requestJson(server, '/api/expert/channels/' + channelId + '/douyin-capture', 'POST', capture);
  assert.equal(imported.statusCode, 200);
  assert.equal(imported.json.data.identityMatched, true);
  assert.equal(imported.json.data.addedCount, 1);
  assert.equal(imported.json.data.updatedCount, 1);
  assert.equal(imported.json.data.unchangedCount, 0);

  const timeline = await requestJson(server, '/api/expert/channels/' + channelId + '/observations?limit=20');
  assert.equal(timeline.json.data.length, 2);
  const video = timeline.json.data.find(item => item.externalContentId === '7533142185677114684');
  const note = timeline.json.data.find(item => item.externalContentId === '7641362696420887025');
  assert.equal(video.title, '科创芯片观察');
  assert.equal(video.author, '模型先生');
  assert.equal(video.evidenceLevel, 'primary');
  assert.equal(video.availabilityStatus, 'available');
  assert.equal(video.summary, '当前登录页面中可见的内容摘要。');
  assert.equal(note.mediaType, 'note');
  assert.equal(note.evidenceLevel, 'primary');

  const repeated = await requestJson(server, '/api/expert/channels/' + channelId + '/douyin-capture', 'POST', capture);
  assert.equal(repeated.statusCode, 200);
  assert.equal(repeated.json.data.addedCount, 0);
  assert.equal(repeated.json.data.updatedCount, 0);
  assert.equal(repeated.json.data.unchangedCount, 2);

  const repeatedTimeline = await requestJson(server, '/api/expert/channels/' + channelId + '/observations?limit=20');
  assert.equal(repeatedTimeline.json.data.length, 2);
});

test('Douyin desktop capture keeps identity mismatches as unverified commentary', async t => {
  const server = app.listen(0);
  t.after(() => server.close());

  const created = await requestJson(server, '/api/expert/channels', 'POST', {
    channelKey: 'douyin-capture-mismatch-api',
    displayName: '目标作者',
    platform: 'douyin',
    profileUrl: 'https://www.douyin.com/user/target-author'
  });
  const response = await requestJson(server,
    '/api/expert/channels/' + created.json.data.id + '/douyin-capture', 'POST', {
      pageType: 'profile',
      pageUrl: 'https://www.douyin.com/user/different-author',
      loggedIn: true,
      profile: {
        displayName: '另一个作者',
        profileUrl: 'https://www.douyin.com/user/different-author'
      },
      items: [{
        sourceUrl: 'https://www.douyin.com/video/7641362696420887025',
        title: '来源身份不一致的视频'
      }]
    });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.data.identityMatched, false);
  assert.equal(response.json.data.items[0].evidenceLevel, 'commentary');
  assert.equal(response.json.data.items[0].availabilityStatus, 'unknown');
  assert.match(response.json.data.items[0].title, /^\[身份待核验\]/);
});

test.after(() => {
  require('../db').close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
  }
});
