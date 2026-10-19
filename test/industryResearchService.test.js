const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const https = require('node:https');
const { EventEmitter } = require('node:events');

const db = require('../db');
const {
  createIndustryResearchService,
  SEED_TOPICS
} = require('../services/industryResearchService');
const {
  createIndustryResearchSourceService,
  MAX_BYTES,
  nativeRequest
} = require('../services/industryResearchSourceService');
const { createIndustryChainRouter, parseLoopbackAuthority } = require('../routes/industryChain');

function fakeSource(responses) {
  return createIndustryResearchSourceService({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async url => {
      const item = responses[url];
      if (item instanceof Error) throw item;
      return Object.assign({
        statusCode: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: '<html><head><title>Source</title></head><body>' + (item || '') + '</body></html>',
        finalUrl: url
      }, typeof item === 'object' ? item : {});
    },
    now: () => '2026-09-08T01:00:00.000Z'
  });
}

function freshService(sourceService) {
  db.exec('DELETE FROM industry_research_runs; DELETE FROM industry_research_versions; DELETE FROM industry_research_evidence; DELETE FROM industry_research_topics;');
  return createIndustryResearchService({ db, sourceService, now: () => '2026-09-08T01:00:00.000Z' });
}

function requestJson(server, method, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path, method,
      headers: Object.assign({ host: '127.0.0.1:' + server.address().port, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }, extraHeaders) }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, json: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('extractDocument only accepts explicit published metadata and keeps extractorVersion', async () => {
  const html = [
    '<html><head>',
    '<meta property="article:published_time" content="2026-09-01T10:20:30+08:00" />',
    '<title>Source</title>',
    '</head><body>',
    'Published 2020-01-01 and update info.',
    '</body></html>'
  ].join('');
  const source = createIndustryResearchSourceService({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => ({
      statusCode: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: html,
      finalUrl: 'https://example.com/meta'
    })
  });
  const result = await source.fetch('https://example.com/meta');
  assert.equal(result.publishedAt, new Date('2026-09-01T10:20:30+08:00').toISOString());
  assert.equal(result.publishedTimePrecision, 'instant');
  assert.equal(result.extractorVersion, 'industry-research-source-v1');
  assert.equal(result.errorCode, null);
});

test('published meta tolerates attribute order and rejects timezone-free times', async () => {
  const source = createIndustryResearchSourceService({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => ({
      statusCode: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: '<html><head><meta content="2026-09-01T10:20:30" property="article:published_time" /><title>Source</title></head><body>body</body></html>',
      finalUrl: 'https://example.com/ambiguous'
    })
  });
  const result = await source.fetch('https://example.com/ambiguous');
  assert.equal(result.publishedAt, null);
  assert.equal(result.publishedTimePrecision, 'unknown');
  assert.equal(result.publishedAtSource, '2026-09-01T10:20:30');
  assert.equal(result.errorCode, null);
});

test('og updated time and generic time datetime are ignored as publish metadata', async () => {
  const source = createIndustryResearchSourceService({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => ({
      statusCode: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: '<html><head><meta property="og:updated_time" content="2026-09-01T10:20:30Z" /><time datetime="2026-09-01T10:20:30Z">2026-09-01</time><title>Source</title></head><body>body</body></html>',
      finalUrl: 'https://example.com/updated'
    })
  });
  const result = await source.fetch('https://example.com/updated');
  assert.equal(result.publishedAt, null);
  assert.equal(result.publishedTimePrecision, 'unknown');
  assert.equal(result.errorCode, 'SOURCE_DATE_UNKNOWN');
});

test('extractDocument ignores plain text dates without explicit meta/time labels', async () => {
  const source = createIndustryResearchSourceService({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => ({
      statusCode: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: '<html><head><title>Source</title></head><body>Published 2026-09-01 by text block.</body></html>',
      finalUrl: 'https://example.com/nodate'
    })
  });
  const result = await source.fetch('https://example.com/nodate');
  assert.equal(result.publishedAt, null);
  assert.equal(result.errorCode, 'SOURCE_DATE_UNKNOWN');
  assert.equal(result.publishedTimePrecision, 'unknown');
});

test('future published date is preserved as metadata but blocked by update review logic', async () => {
  const url = 'https://example.com/future';
  const service = freshService(fakeSource({
    [url]: '<meta property="article:published_time" content="2099-01-01T00:00:00Z" /><title>Future</title><body>future statement</body>'
  }));
  const result = await service.updateTopic('bellows', { sourceUrls: [url] });
  assert.equal(result.run.status, 'failed');
  assert.equal(result.currentVersion, null);
  assert.ok(result.run.errors.some(item => item.code === 'SOURCE_FUTURE_PUBLISHED_AT'));
  assert.equal(service.getTopicDetail('bellows').currentVersion, null);
});

test('redirect keeps requestedUrl and checks each hop', async () => {
  const first = 'https://example.com/redirect-start';
  const second = 'https://example.com/final';
  const requestLog = [];
  const source = createIndustryResearchSourceService({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async (url) => {
      requestLog.push(String(url));
      if (url === first) {
        return {
          statusCode: 302,
          headers: { location: '/final' },
          body: '',
          finalUrl: first
        };
      }
      return {
        statusCode: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: '<html><head><title>Source</title></head><body>final page</body></html>',
        finalUrl: second
      };
    }
  });
  const result = await source.fetch(first);
  assert.equal(result.requestedUrl, first);
  assert.equal(result.finalUrl, second);
  assert.ok(requestLog.includes(first));
  assert.ok(requestLog.includes(second));
});

test('redirect to private host rejects and does not keep original request as final hit', async () => {
  const source = createIndustryResearchSourceService({
    lookup: async (hostname) => {
      if (hostname === 'example.com') return [{ address: '93.184.216.34', family: 4 }];
      if (hostname === '127.0.0.1') return [{ address: '127.0.0.1', family: 4 }];
      return [{ address: '93.184.216.34', family: 4 }];
    },
    request: async (url) => {
      if (url === 'https://example.com/redirect') {
        return {
          statusCode: 302,
          headers: { location: 'https://127.0.0.1/private' },
          body: '',
          finalUrl: url
        };
      }
      return {
        statusCode: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: '<html><head><title>Source</title></head><body>local</body></html>',
        finalUrl: url
      };
    }
  });
  await assert.rejects(() => source.fetch('https://example.com/redirect'), error => error.code === 'SOURCE_URL_UNSAFE' || error.code === 'SOURCE_DNS_PRIVATE' || error.code === 'SOURCE_DNS_UNSUPPORTED');
});

test('dns slow resolve fails fast and no request is emitted', async () => {
  let requestCalled = false;
  const source = createIndustryResearchSourceService({
    lookup: async () => { await delay(500); throw new Error('should timeout'); },
    request: async () => { requestCalled = true; return {}; }
  });
  await assert.rejects(() => source.fetch('https://example.com/slow-dns', { roundDeadline: Date.now() + 80 }), error => error.code === 'SOURCE_DNS_TIMEOUT');
  assert.equal(requestCalled, false);
});

test('request timeout aborts hanging response and cleans up', async () => {
  let aborted = false;
  const source = createIndustryResearchSourceService({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async (_url, _address, options = {}) => new Promise((_, reject) => {
      if (options.signal && options.signal.addEventListener) {
        options.signal.addEventListener('abort', () => {
          aborted = true;
          reject(options.signal.reason);
        }, { once: true });
      }
      setTimeout(() => reject(new Error('hanging reached')), 1000);
    })
  });
  await assert.rejects(() => source.fetch('https://example.com/hang', { roundDeadline: Date.now() + 80 }), error => error.code === 'SOURCE_TIMEOUT' || error.code === 'SOURCE_ROUND_TIMEOUT');
  assert.equal(aborted, true);
});

test('native request uses all-address lookup and destroys a timed-out request without network access', async () => {
  const originalRequest = https.request;
  let lookupOptions;
  let destroyed = false;
  https.request = (options) => {
    options.lookup('example.com', { all: true }, (error, addresses) => {
      assert.ifError(error);
      lookupOptions = addresses;
    });
    const request = new EventEmitter();
    request.destroyed = false;
    request.destroy = () => { destroyed = true; request.destroyed = true; };
    request.end = () => {};
    return request;
  };
  try {
    await assert.rejects(() => nativeRequest('https://example.com/', { address: '93.184.216.34', family: 4 }, { timeoutMs: 10 }), error => error.code === 'SOURCE_TIMEOUT');
    assert.deepEqual(lookupOptions, [{ address: '93.184.216.34', family: 4 }]);
    assert.equal(destroyed, true);
  } finally {
    https.request = originalRequest;
  }
});

test('evidence insert and version pointer roll back together on version failure', async () => {
  const url = 'https://example.com/transactional';
  const service = freshService(fakeSource({ [url]: 'A transactional product statement.' }));
  db.exec("CREATE TEMP TRIGGER force_industry_version_failure BEFORE INSERT ON industry_research_versions BEGIN SELECT RAISE(ABORT, 'forced'); END;");
  try {
    const result = await service.updateTopic('bellows', { sourceUrls: [url], proposals: [{ stage: 'components', product: 'transactional product', claim: 'the source states this', evidenceRefs: [{ url, quote: 'transactional product statement' }] }] });
    assert.equal(result.run.status, 'failed');
    assert.equal(result.currentVersion, null);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM industry_research_evidence').get().count, 0);
  } finally {
    db.exec('DROP TRIGGER force_industry_version_failure');
  }
});

test('oversize body is rejected and unsupported encodings are blocked', async () => {
  const source = createIndustryResearchSourceService({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => ({
      statusCode: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'content-encoding': 'gzip' },
      body: 'text'.repeat(10),
      finalUrl: 'https://example.com/gzip'
    })
  });
  await assert.rejects(() => source.fetch('https://example.com/gzip'), error => error.code === 'SOURCE_ENCODING_UNSUPPORTED');

  const oversizeBody = 'a'.repeat(MAX_BYTES + 1);
  const source2 = createIndustryResearchSourceService({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => ({
      statusCode: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: oversizeBody,
      finalUrl: 'https://example.com/large'
    })
  });
  await assert.rejects(() => source2.fetch('https://example.com/large'), error => error.code === 'SOURCE_TOO_LARGE');
});

test('pure IPv6 source address is rejected without falling back', async () => {
  const source = createIndustryResearchSourceService({
    lookup: async () => [{ address: '2001:4860:4860::8888', family: 6 }],
    request: async () => ({})
  });
  await assert.rejects(() => source.fetch('https://example.com/ipv6'), error => error.code === 'SOURCE_DNS_UNSUPPORTED');
});

test('source service rejects non-HTTPS and private DNS before transport', async () => {
  let requested = false;
  const source = createIndustryResearchSourceService({
    lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    request: async () => { requested = true; }
  });
  await assert.rejects(() => source.fetch('http://example.com/a'), error => error.code === 'SOURCE_URL_UNSAFE');
  await assert.rejects(() => source.fetch('https://internal.example/a'), error => error.code === 'SOURCE_DNS_PRIVATE');
  assert.equal(requested, false);
});

test('loopback authority parser rejects malformed ports and bracket suffixes', () => {
  assert.equal(parseLoopbackAuthority('127.0.0.1:abc', 'http'), null);
  assert.equal(parseLoopbackAuthority('[::1]evil', 'http'), null);
  assert.deepEqual(parseLoopbackAuthority('[::1]:8080', 'http'), { hostname: '::1', port: 8080 });
});

test('source MIME allowlist is exact rather than substring based', async () => {
  const source = createIndustryResearchSourceService({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => ({ statusCode: 200, headers: { 'content-type': 'text/htmlish' }, body: 'body', finalUrl: 'https://example.com/mime' })
  });
  await assert.rejects(() => source.fetch('https://example.com/mime'), error => error.code === 'SOURCE_CONTENT_TYPE_UNSUPPORTED');
  const missingMime = createIndustryResearchSourceService({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => ({ statusCode: 200, headers: {}, body: 'body', finalUrl: 'https://example.com/mime-missing' })
  });
  await assert.rejects(() => missingMime.fetch('https://example.com/mime-missing'), error => error.code === 'SOURCE_CONTENT_TYPE_UNSUPPORTED');
});

test('first update persists fetched evidence and a zero-stock version', async () => {
  const url = 'https://example.com/bellows';
  const service = freshService(fakeSource({ [url]: 'Bellows product information. Published 2026-09-01.' }));
  const result = await service.updateTopic('bellows', { sourceUrls: [url], proposals: [] });
  assert.equal(result.currentVersion.relations.length, 0);
  assert.equal(result.currentVersion.evidenceIds.length, 1);
  assert.equal(result.run.status, 'succeeded');
  assert.equal(service.getTopicDetail('bellows').currentVersion.id, result.currentVersion.id);
});

test('proposal quote must match fetched text and remains candidate without client verification', async () => {
  const url = 'https://example.com/diamond';
  const service = freshService(fakeSource({ [url]: 'Diamond thermal spreader product for optical systems.' }));
  const result = await service.updateTopic('diamond-thermal', {
    sourceUrls: [url],
    proposals: [{ stage: 'components', product: 'diamond thermal spreader', company: { name: 'Example Materials' }, claim: 'offers thermal spreaders', polarity: 'supports', evidenceRefs: [{ url, quote: 'Diamond thermal spreader product' }] }]
  });
  assert.equal(result.currentVersion.relations.length, 1);
  assert.equal(result.currentVersion.relations[0].status, 'candidate');
  assert.equal(result.currentVersion.relations[0].company.stockCode, null);
  assert.equal(result.currentVersion.relations[0].evidenceIds.length, 1);
});

test('repeated unchanged source records a no-change run without creating a version', async () => {
  const url = 'https://example.com/v-groove';
  const service = freshService(fakeSource({ [url]: 'V-groove array product.' }));
  const first = await service.updateTopic('v-groove-fau', { sourceUrls: [url] });
  const second = await service.updateTopic('v-groove-fau', { sourceUrls: [url] });
  assert.equal(second.run.status, 'no_change');
  assert.equal(second.currentVersion.id, first.currentVersion.id);
  assert.equal(service.getTopicDetail('v-groove-fau').versions.length, 1);
});

test('failed update preserves the previous version and records failure', async () => {
  const url = 'https://example.com/lno';
  const source = fakeSource({ [url]: 'Thin film lithium niobate product.' });
  const service = freshService(source);
  const first = await service.updateTopic('thin-film-lithium-niobate', { sourceUrls: [url] });
  source.fetch = async () => { const error = new Error('timeout'); error.code = 'SOURCE_TIMEOUT'; throw error; };
  const failed = await service.updateTopic('thin-film-lithium-niobate', { sourceUrls: [url] });
  assert.equal(failed.currentVersion.id, first.currentVersion.id);
  assert.equal(failed.run.status, 'failed');
  assert.ok(failed.run.errors.some(item => item.code === 'SOURCE_TIMEOUT'));
});

test('manual review creates a new immutable version and is the only path to verified', async () => {
  const url = 'https://example.com/review';
  const service = freshService(fakeSource({ [url]: 'A reviewed product statement.' }));
  const first = await service.updateTopic('bellows', { sourceUrls: [url], proposals: [{ stage: 'components', product: 'reviewed product', claim: 'the source states this product', company: { name: 'A' }, evidenceRefs: [{ url, quote: 'reviewed product statement' }] }] });
  const relation = first.currentVersion.relations[0];
  const reviewed = service.reviewTopic('bellows', { baseVersionId: first.currentVersion.id, relationIds: [relation.id], decision: 'verify', note: 'Read the cited passage.' });
  assert.notEqual(reviewed.currentVersion.id, first.currentVersion.id);
  assert.equal(reviewed.currentVersion.relations[0].status, 'verified');
  assert.equal(reviewed.currentVersion.relations[0].review.source, 'local_manual');
});

test('metrics require every value and context token in the same evidence quote', async () => {
  const url = 'https://example.com/metric-context';
  const service = freshService(fakeSource({ [url]: 'The product has 999 units in China during 2026.' }));
  const result = await service.updateTopic('bellows', { sourceUrls: [url], proposals: [{ stage: 'components', product: 'metric product', claim: 'metric claim', evidenceRefs: [{ url, quote: 'The product has 999 units in China during 2026.' }], metrics: [{ name: 'unmatched', value: 999, rawValue: '999', unit: 'percent', scope: 'China' }] }] });
  assert.equal(result.currentVersion.relations.length, 1);
  assert.equal(result.currentVersion.relations[0].metrics[0].value, null);
  assert.equal(result.currentVersion.relations[0].metrics[0].reasonCode, 'METRIC_UNVERIFIED');
  assert.equal(result.currentVersion.relations[0].metrics[0].evidenceId, null);
});

test('missing metric values remain null instead of becoming zero', async () => {
  const url = 'https://example.com/metric-null';
  const service = freshService(fakeSource({ [url]: 'A product statement.' }));
  const result = await service.updateTopic('bellows', { sourceUrls: [url], proposals: [{ stage: 'components', product: 'null metric product', claim: 'null metric claim', evidenceRefs: [{ url, quote: 'product statement' }], metrics: [{ name: 'missing', value: null, rawValue: '999', unit: 'units', scope: 'China' }] }] });
  assert.equal(result.currentVersion.relations[0].metrics[0].value, null);
  assert.equal(result.currentVersion.relations[0].metrics[0].reasonCode, 'METRIC_CONTEXT_INSUFFICIENT');
});

test('polarity-conflicted relations cannot be verified directly', async () => {
  const url = 'https://example.com/conflict';
  const service = freshService(fakeSource({ [url]: 'The product supports the claim and contradicts the claim.' }));
  const result = await service.updateTopic('bellows', { sourceUrls: [url], proposals: [
    { stage: 'components', product: 'conflict product', claim: 'conflict claim', polarity: 'supports', evidenceRefs: [{ url, quote: 'supports the claim' }] },
    { stage: 'components', product: 'conflict product', claim: 'conflict claim', polarity: 'contradicts', evidenceRefs: [{ url, quote: 'contradicts the claim' }] }
  ] });
  assert.equal(result.currentVersion.relations.length, 2);
  assert.ok(result.currentVersion.relations.every(item => item.status === 'disputed'));
  assert.throws(() => service.reviewTopic('bellows', { baseVersionId: result.currentVersion.id, relationIds: [result.currentVersion.relations[0].id], decision: 'verify' }), error => error.code === 'RELATION_DISPUTED');
});

test('service startup marks abandoned runs interrupted', async () => {
  freshService(fakeSource({}));
  db.prepare('INSERT INTO industry_research_runs (id,topic_id,status,payload_json,started_at,completed_at) VALUES (?,?,?,?,?,NULL)').run('run_abandoned', 'bellows', 'running', '{}', '2026-09-08T00:00:00.000Z');
  createIndustryResearchService({ db, sourceService: fakeSource({}), now: () => '2026-09-08T02:00:00.000Z' });
  const row = db.prepare('SELECT status,payload_json,completed_at FROM industry_research_runs WHERE id = ?').get('run_abandoned');
  assert.equal(row.status, 'interrupted');
  assert.equal(JSON.parse(row.payload_json).reason, 'process_restart');
  assert.equal(row.completed_at, '2026-09-08T02:00:00.000Z');
});

test('research API exposes topics, update and detail while rejecting client status fields', async () => {
  const url = 'https://example.com/api-topic';
  const service = freshService(fakeSource({ [url]: 'A public product statement.' }));
  const app = express();
  app.use(express.json());
  app.use('/api', createIndustryChainRouter({ service, researchService: service }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const topics = await requestJson(server, 'GET', '/api/industry-chain/research/topics');
    assert.equal(topics.status, 200);
    assert.equal(topics.json.data.length, SEED_TOPICS.length);
    const update = await requestJson(server, 'POST', '/api/industry-chain/research/topics/bellows/update', { sourceUrls: [url], proposals: [{ stage: 'components', product: 'x', claim: 'x', status: 'verified', evidenceRefs: [] }] });
    assert.equal(update.status, 400);
    const ok = await requestJson(server, 'POST', '/api/industry-chain/research/topics/bellows/update', { sourceUrls: [url] });
    assert.equal(ok.status, 200);
    const detail = await requestJson(server, 'GET', '/api/industry-chain/research/topics/bellows');
    assert.equal(detail.status, 200);
    assert.equal(detail.json.data.currentVersion.id, ok.json.data.currentVersion.id);
    const oldVersion = await requestJson(server, 'GET', '/api/industry-chain/research/topics/bellows/versions/missing');
    assert.equal(oldVersion.status, 404);
    const forbiddenHost = await requestJson(server, 'POST', '/api/industry-chain/research/topics/bellows/update', { sourceUrls: [url] }, { host: 'evil.example:' + server.address().port });
    assert.equal(forbiddenHost.status, 403);
    const forbiddenOrigin = await requestJson(server, 'POST', '/api/industry-chain/research/topics/bellows/update', { sourceUrls: [url] }, { origin: 'http://127.0.0.1:' + (server.address().port + 1) });
    assert.equal(forbiddenOrigin.status, 403);
    const forwarded = await requestJson(server, 'POST', '/api/industry-chain/research/topics/bellows/update', { sourceUrls: [url] }, { 'x-forwarded-for': '8.8.8.8' });
    assert.equal(forwarded.status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
