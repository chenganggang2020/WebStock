'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');
const { createIndustryResearchService } = require('../services/industryResearchService');
const { createIndustryResearchSourceService } = require('../services/industryResearchSourceService');
const { createIndustryResearchScheduler } = require('../services/industryResearchScheduler');

function fakeSource(text) {
  return createIndustryResearchSourceService({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async url => ({ statusCode: 200, headers: { 'content-type': 'text/html' }, body: '<html><body>' + text + '</body></html>', finalUrl: url }),
    now: () => '2026-09-08T01:00:00.000Z'
  });
}

function freshService(source, ai) {
  db.exec('DELETE FROM industry_research_runs; DELETE FROM industry_research_versions; DELETE FROM industry_research_evidence; DELETE FROM industry_research_topics;');
  return createIndustryResearchService({ db, sourceService: source, ai, now: () => '2026-09-08T01:00:00.000Z' });
}

test('explicit AI adds only quote-validated candidate relations and hashes analysis', async () => {
  const url = 'https://example.com/ai-candidate';
  const service = freshService(fakeSource('The product supports optical coupling.'), {
    getAIEnabled: () => true,
    getAIConfig: () => ({ apiKey: 'sk-valid', model: 'test-model' }),
    isValidApiKey: () => true,
    callAIModel: async () => JSON.stringify({ relations: [{ stage: 'components', product: 'optical coupling product', claim: 'The product supports optical coupling.', polarity: 'supports', evidenceId: url, quote: 'supports optical coupling' }] })
  });
  const result = await service.updateTopic('bellows', { sourceUrls: [url], useAi: true });
  assert.equal(result.currentVersion.relations.length, 1);
  assert.equal(result.currentVersion.relations[0].status, 'candidate');
  assert.equal(result.currentVersion.analysis.kind, 'ai_inference');
  assert.ok(result.currentVersion.analysis.evidenceIds.length >= 1);
  assert.ok(result.currentVersion.contentHash);
});

test('AI failure does not block fetched evidence and is not presented as verification', async () => {
  const url = 'https://example.com/ai-failure';
  const service = freshService(fakeSource('A product statement.'), {
    getAIEnabled: () => true,
    getAIConfig: () => ({ apiKey: 'sk-valid', model: 'test-model' }),
    isValidApiKey: () => true,
    callAIModel: async () => { throw new Error('model unavailable'); }
  });
  const result = await service.updateTopic('bellows', { sourceUrls: [url], useAi: true });
  assert.equal(result.currentVersion.relations.length, 0);
  assert.equal(result.currentVersion.analysis.kind, 'none');
  assert.equal(result.currentVersion.run.ai, 'failed');
  assert.equal(result.currentVersion.evidence.length, 1);
});

test('AI is skipped when no source succeeds and a timed out AI call preserves evidence', async () => {
  let noSourceCalls = 0;
  const noSource = freshService({ fetch: async () => { throw new Error('blocked'); } }, {
    getAIEnabled: () => true, getAIConfig: () => ({ apiKey: 'sk-valid', model: 'test-model' }), isValidApiKey: () => true,
    callAIModel: async () => { noSourceCalls += 1; return '{}'; }
  });
  const noSourceResult = await noSource.updateTopic('bellows', { sourceUrls: ['https://example.com/blocked'], useAi: true });
  assert.equal(noSourceCalls, 0);
  assert.equal(noSourceResult.run.ai, 'skipped');

  const url = 'https://example.com/ai-timeout';
  const timedOutAI = {
    getAIEnabled: () => true, getAIConfig: () => ({ apiKey: 'sk-valid', model: 'test-model' }), isValidApiKey: () => true,
    callAIModel: async (_prompt, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
  };
  const timedOut = createIndustryResearchService({ db, sourceService: fakeSource('A timed product statement.'), ai: timedOutAI, roundTimeoutMs: 5000, now: () => '2026-09-08T01:00:00.000Z' });
  const timedOutResult = await timedOut.updateTopic('bellows', { sourceUrls: [url], useAi: true });
  assert.equal(timedOutResult.run.ai, 'failed');
  assert.equal(timedOutResult.currentVersion.evidence.length, 1);
});

test('research scheduler starts idempotently, does not collect immediately, and serially runs due topics', async () => {
  let timerCount = 0;
  let cleared = 0;
  const calls = [];
  let topics = [{ id: 'bellows', enabled: true, nextDueAt: '2026-09-08T00:00:00.000Z' }, { id: 'diamond-thermal', enabled: false, nextDueAt: '2026-09-08T00:00:00.000Z' }];
  const service = { listTopics: () => topics, updateTopic: async id => { calls.push(id); if (id === 'bellows') topics = [{ id: 'bellows', enabled: true, nextDueAt: '2026-09-08T00:00:00.000Z' }, { id: 'diamond-thermal', enabled: false, nextDueAt: '2026-09-08T00:00:00.000Z' }]; await Promise.resolve(); } };
  const scheduler = createIndustryResearchScheduler({ service, now: () => new Date('2026-09-08T01:00:00.000Z'), pollMs: 1000, setInterval: () => { timerCount += 1; return timerCount; }, clearInterval: () => { cleared += 1; } });
  assert.equal(scheduler.start(), true);
  assert.equal(scheduler.start(), false);
  assert.equal(calls.length, 0);
  await scheduler.tick();
  assert.deepEqual(calls, ['bellows']);
  scheduler.stop();
  assert.equal(cleared, 1);
  topics = [{ id: 'bellows', enabled: true, nextDueAt: '2026-09-08T00:00:00.000Z' }];
  await scheduler.tick();
  assert.deepEqual(calls, ['bellows']);
});

test('Node and Electron lifecycle wire the research scheduler without import-time startup', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const electron = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  assert.match(server, /createIndustryResearchScheduler/);
  assert.match(server, /industryResearchScheduler\.start\(\)/);
  assert.match(server, /industryResearchScheduler\.stop\(\)/);
  assert.match(electron, /createIndustryResearchScheduler/);
  assert.match(electron, /industryResearchScheduler\.start\(\)/);
  assert.match(electron, /industryResearchScheduler\.stop\(\)/);
});

test('enabled research config receives a persisted future due time and survives service recreation', () => {
  const source = fakeSource('unused');
  const first = freshService(source);
  const enabled = first.updateTopicConfig('bellows', { enabled: true });
  assert.ok(enabled.nextDueAt);
  assert.ok(Date.parse(enabled.nextDueAt) > Date.parse('2026-09-08T01:00:00.000Z'));
  const changed = first.updateTopicConfig('bellows', { intervalMinutes: 120 });
  assert.equal(Date.parse(changed.nextDueAt), Date.parse('2026-09-08T03:00:00.000Z'));
  const recreated = createIndustryResearchService({ db, sourceService: source, now: () => '2026-09-08T02:00:00.000Z' });
  assert.equal(recreated.listTopics().find(topic => topic.id === 'bellows').nextDueAt, changed.nextDueAt);
  const disabled = recreated.updateTopicConfig('bellows', { enabled: false });
  assert.equal(disabled.nextDueAt, null);
});
