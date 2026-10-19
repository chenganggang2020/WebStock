'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const express = require('express');
const http = require('node:http');

const { createIndustryResearchService } = require('../services/industryResearchService');
const { createIndustryConceptDiscoveryService } = require('../services/industryConceptDiscoveryService');
const { createIndustryChainRouter } = require('../routes/industryChain');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'init.sql'), 'utf8'));
  return db;
}

function catalog(items, options = {}) {
  return {
    schema: 'webstock.market-boards/v1',
    status: options.status || 'available',
    fetchedAt: options.fetchedAt || '2026-09-09T01:00:00.000Z',
    stale: options.stale === true,
    coverageComplete: options.coverageComplete !== false,
    coverage: [{
      provider: 'sina-public-concept',
      taxonomy: 'concept',
      status: options.status || 'available',
      count: items.length,
      fetchedAt: options.fetchedAt || '2026-09-09T01:00:00.000Z',
      stale: options.stale === true,
      coverageComplete: options.coverageComplete !== false,
      reason: options.reason || null
    }],
    items: items.map((item, index) => ({
      key: 'sina-concept:' + item.code,
      code: item.code,
      providerId: item.code,
      provider: 'sina-public-concept',
      taxonomy: 'concept',
      kind: 'concept',
      name: item.name,
      classification: '热门概念',
      status: 'available',
      stale: false,
      coverageComplete: true,
      fetchedAt: options.fetchedAt || '2026-09-09T01:00:00.000Z',
      rank: index + 1
    }))
  };
}

function setup(initialCatalog) {
  const db = freshDb();
  let current = initialCatalog;
  let now = '2026-09-09T01:00:00.000Z';
  const researchService = createIndustryResearchService({
    db,
    sourceService: { fetch: async () => { throw new Error('not used'); } },
    ai: { generateAIResponse: async () => { throw new Error('not used'); } },
    now: () => now
  });
  const service = createIndustryConceptDiscoveryService({
    db,
    researchService,
    marketBoardService: { fetchCatalog: async () => current },
    now: () => now
  });
  return {
    db,
    service,
    setCatalog(value) { current = value; },
    setNow(value) { now = value; }
  };
}

function requestJson(server, method, requestPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      path: requestPath,
      method,
      headers: {
        host: '127.0.0.1:' + server.address().port,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload)
      }
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, json: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

test('first concept sync establishes a baseline without labelling every concept new', async () => {
  const fixture = setup(catalog([
    { code: 'chgn_730629', name: '湖北国资' },
    { code: 'chgn_730628', name: '盾构机' }
  ]));

  const result = await fixture.service.syncAndList();

  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.baselineInitialized, true);
  assert.equal(result.summary.newCount, 0);
  assert.deepEqual(result.items.map(item => item.name), ['湖北国资', '盾构机']);
  assert.ok(result.items.every(item => item.isNew === false));
  assert.ok(result.items.every(item => item.source.provider === 'sina-public-concept'));
  fixture.db.close();
});

test('later complete sync detects additions and marks disappeared concepts inactive', async () => {
  const fixture = setup(catalog([
    { code: 'chgn_730629', name: '湖北国资' },
    { code: 'chgn_730628', name: '盾构机' }
  ]));
  await fixture.service.syncAndList();
  fixture.setNow('2026-09-10T01:00:00.000Z');
  fixture.setCatalog(catalog([
    { code: 'chgn_730629', name: '湖北国资' },
    { code: 'chgn_730630', name: '新发现概念' }
  ], { fetchedAt: '2026-09-10T01:00:00.000Z' }));

  const result = await fixture.service.syncAndList();

  assert.equal(result.summary.newCount, 1);
  assert.equal(result.items.find(item => item.name === '新发现概念').isNew, true);
  assert.equal(result.items.some(item => item.name === '盾构机'), false);
  const inactive = fixture.db.prepare('SELECT active FROM industry_concept_discovery WHERE provider_id = ?').get('chgn_730628');
  assert.equal(inactive.active, 0);
  fixture.db.close();
});

test('tracking a discovered concept creates one disabled research topic and is idempotent', async () => {
  const fixture = setup(catalog([{ code: 'chgn_730628', name: '盾构机' }]));
  await fixture.service.syncAndList();

  const first = fixture.service.trackConcept({ provider: 'sina-public-concept', providerId: 'chgn_730628' });
  const second = fixture.service.trackConcept({ provider: 'sina-public-concept', providerId: 'chgn_730628' });

  assert.equal(first.created, true);
  assert.equal(first.topic.name, '盾构机');
  assert.equal(first.topic.enabled, false);
  assert.equal(first.topic.config.origin, 'concept-directory');
  assert.equal(second.created, false);
  assert.equal(second.topic.id, first.topic.id);
  assert.equal(fixture.service.list({ query: '盾构' }).items[0].trackedTopicId, first.topic.id);
  fixture.db.close();
});

test('partial provider response never retires concepts missing from that response', async () => {
  const fixture = setup(catalog([
    { code: 'chgn_730629', name: '湖北国资' },
    { code: 'chgn_730628', name: '盾构机' }
  ]));
  await fixture.service.syncAndList();
  fixture.setNow('2026-09-10T01:00:00.000Z');
  fixture.setCatalog(catalog([
    { code: 'chgn_730629', name: '湖北国资' }
  ], { fetchedAt: '2026-09-10T01:00:00.000Z', status: 'partial', coverageComplete: false }));

  await fixture.service.syncAndList();

  assert.equal(fixture.service.list().items.some(item => item.name === '盾构机'), true);
  fixture.db.close();
});

test('concept discovery API lists the provider directory and tracks a selected concept locally', async () => {
  const fixture = setup(catalog([{ code: 'chgn_730628', name: '盾构机' }]));
  const app = express();
  app.use(express.json());
  app.use('/api', createIndustryChainRouter({
    researchService: createIndustryResearchService({
      db: fixture.db,
      sourceService: { fetch: async () => { throw new Error('not used'); } },
      ai: { generateAIResponse: async () => { throw new Error('not used'); } }
    }),
    conceptDiscoveryService: fixture.service
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const listed = await requestJson(server, 'GET', '/api/industry-chain/research/concepts?refresh=1&q=%E7%9B%BE%E6%9E%84');
    assert.equal(listed.status, 200);
    assert.equal(listed.json.data.items[0].name, '盾构机');

    const tracked = await requestJson(server, 'POST', '/api/industry-chain/research/concepts/track', {
      provider: 'sina-public-concept',
      providerId: 'chgn_730628'
    });
    assert.equal(tracked.status, 200);
    assert.equal(tracked.json.data.created, true);
    assert.equal(tracked.json.data.topic.name, '盾构机');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fixture.db.close();
  }
});
