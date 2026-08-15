const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const axios = require('axios');

const testDbPath = path.join(os.tmpdir(), 'webstock-news-discovery-api-' + process.pid + '.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
}
process.env.WEBSTOCK_DB_PATH = testDbPath;
process.env.NODE_ENV = 'test';
process.env.WEBSTOCK_DISABLE_SINA_NEWS = '1';
process.env.WEBSTOCK_HOT_MARKET_OFFLINE = '1';
process.env.WEBSTOCK_SENTIMENT_OFFLINE = '1';
process.env.WEBSTOCK_STOCK_PROFILE_OFFLINE = '1';

const newsService = require('../services/newsService');
newsService.registerAsyncProvider({
  name: 'news-discovery-api-fixture',
  async list() {
    return [{
      title: 'Semiconductor earnings expansion',
      source: 'Fixture Wire',
      time: '2026-08-12T06:00:00.000Z',
      summary: 'Company 000001 expands advanced packaging capacity.',
      link: 'https://example.com/semiconductor',
      image_url: 'https://cdn.example.com/semiconductor.jpg',
      type: 'stock',
      relatedStocks: ['000001'],
      relatedSectors: ['Semiconductor']
    }];
  }
});
newsService.registerAsyncProvider({
  name: 'news-discovery-planned-failure',
  async list() {
    throw new Error('planned provider outage');
  }
});

const app = require('../server');

function requestJson(server, pathname) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const request = http.get({
      hostname: '127.0.0.1',
      port: address.port,
      path: pathname
    }, response => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { raw += chunk; });
      response.on('end', () => resolve({
        statusCode: response.statusCode,
        json: JSON.parse(raw)
      }));
    });
    request.on('error', reject);
  });
}

test('GET /api/news/discovery returns source-grounded images, explainable signals and coverage', async t => {
  const server = app.listen(0);
  t.after(() => server.close());
  const originalGet = axios.get;
  let externalRequests = 0;
  axios.get = async function() {
    externalRequests += 1;
    throw new Error('unexpected external request');
  };
  t.after(function() { axios.get = originalGet; });

  const query = new URLSearchParams({
    codes: '000001',
    sectors: 'Semiconductor',
    keywords: 'earnings',
    cacheBust: 'news-discovery-api-test'
  });
  const response = await requestJson(server, '/api/news/discovery?' + query.toString());

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.success, true);
  assert.equal(response.json.data.schema, 'webstock.news-discovery/v1');
  assert.equal(response.json.data.items.length, 1);
  assert.equal(response.json.data.items[0].imageUrl, 'https://cdn.example.com/semiconductor.jpg');
  assert.equal(response.json.data.items[0].imageSourceField, 'image_url');
  assert.equal(response.json.data.items[0].imageProvenance.provider, 'news-discovery-api-fixture');
  assert.equal(response.json.data.items[0].imageProvenance.sourceField, 'image_url');
  assert.equal(response.json.data.items[0].importance.method, 'local-research-priority-v1');
  assert.equal(response.json.data.items[0].relevance.score, 100);
  assert.equal(response.json.data.coverage.upstreamImageCount, 1);
  assert.equal(response.json.data.coverage.relevanceMatchedCount, 1);
  assert.ok(response.json.data.sourceMeta.providers.some(provider => provider.name === 'news-discovery-api-fixture' && provider.ok));
  assert.ok(response.json.data.sourceMeta.providers.some(provider => provider.name === 'news-discovery-planned-failure' && !provider.ok));
  assert.equal(response.json.data.degraded, true);
  assert.equal(Object.prototype.hasOwnProperty.call(response.json.data.items[0], 'globalHeat'), false);
  assert.equal(externalRequests, 0);

  const empty = await requestJson(server, '/api/news/discovery?keywords=definitely-no-match&cacheBust=news-discovery-empty');
  assert.equal(empty.statusCode, 200);
  assert.equal(empty.json.success, true);
  assert.equal(empty.json.data.items.length, 0);
  assert.equal(empty.json.data.coverage.itemCount, 0);
});
