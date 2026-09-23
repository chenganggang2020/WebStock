const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createCreatorIndustryService, documentHash } = require('../services/creatorIndustryService');
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'creator-industry-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const channel = { id: 4, displayName: 'Fioona', industryAnalysisEnabled: true };
  const rows = [{ id: 1, mediaType: 'video', evidenceLevel: 'primary', transcript: '保偏光纤用于光引擎的激光传输。保偏光纤用于光引擎的激光传输。', mediaMetadata: { asr: { status: 'complete', segments: [{ text: '保偏光纤用于光引擎的激光传输。' }] } }, sourceUrl: 'https://www.douyin.com/video/1234567890123456789', publishedAt: '2026-09-18T00:00:00Z' }];
  const channels = { getChannel: () => channel, listChannels: () => [channel], listCollectionObservations: () => rows };
  const proposal = () => ({ observationId: 1, bodyHash: documentHash(rows[0]), summary: '光互联关系', relations: [{ topic: 'AI算力与CPO', from: '保偏光纤', to: '光引擎', relation: '使用', quote: '保偏光纤用于光引擎的激光传输。', polarity: 'supports' }] });
  return { directory, channels, rows, proposal };
}
test('imports real cited relationships idempotently, with author/date and never verified status', async t => {
  const f = await fixture(t), service = createCreatorIndustryService(f);
  await service.importReviews(4, [f.proposal()], { model: 'Codex direct review' });
  await service.importReviews(4, [f.proposal()], { model: 'Codex direct review' });
  const result = await service.read(4);
  assert.equal(result.analyzedCount, 1); assert.equal(result.relations.length, 1);
  assert.equal(result.relations[0].status, 'author_claim');
  assert.equal(result.relations[0].publishedAt, f.rows[0].publishedAt);
  assert.equal(result.relations[0].author, 'Fioona');
  assert.equal(result.relations[0].quoteStart, 0);
  assert.equal(result.relations[0].quoteEnd, result.relations[0].quote.length);
});
test('rejects invented quotations, unmentioned endpoints, and outdated transcript identity', async t => {
  const f = await fixture(t), service = createCreatorIndustryService(f);
  const wrong = f.proposal(); wrong.relations[0].quote = '作者从未提到的供应合同';
  await assert.rejects(service.importReviews(4, [wrong]), /原文/);
  const endpoint = f.proposal(); endpoint.relations[0].to = '虚构公司';
  await assert.rejects(service.importReviews(4, [endpoint]), /实体/);
  const stale = f.proposal(); f.rows[0].transcript += '更新';
  await assert.rejects(service.importReviews(4, [stale]), /文稿/);
  assert.equal((await service.read(4)).analyzedCount, 0);
});
test('newest publication orders claims but preserves old and contradictory evidence', async t => {
  const f = await fixture(t), service = createCreatorIndustryService(f);
  await service.importReviews(4, [f.proposal()]);
  f.rows.push({ ...f.rows[0], id: 2, publishedAt: '2026-09-19T00:00:00Z' });
  await service.importReviews(4, [{ ...f.proposal(), observationId: 2, relations: [{ ...f.proposal().relations[0], polarity: 'contradicts' }] }]);
  const result = await service.read(4);
  assert.equal(result.relations.length, 2); assert.equal(result.relations[0].observationId, 2);
});
test('missing AI configuration reports blocked, does not call AI or mark documents analyzed', async t => {
  const f = await fixture(t); let called = 0;
  const service = createCreatorIndustryService({ ...f, ai: { getAIEnabled: () => true, getAIConfig: () => ({}), isValidApiKey: () => false, callAIModel: () => called++ } });
  const result = await service.run(4);
  assert.equal(result.status, 'ai_not_configured'); assert.equal(called, 0);
  assert.equal((await service.read(4)).analyzedCount, 0);
});
test('configured AI processes one complete document and unchanged documents are not recharged', async t => {
  const f = await fixture(t); let called = 0;
  const ai = { getAIEnabled: () => true, getAIConfig: () => ({ model: 'test' }), isValidApiKey: () => true,
    callAIModel: async () => { called++; return JSON.stringify(f.proposal()); } };
  const service = createCreatorIndustryService({ ...f, ai });
  assert.equal((await service.run(4)).status, 'complete');
  assert.equal((await service.run(4)).status, 'idle'); assert.equal(called, 1);
});
test('concurrent imports retain both documents instead of last-writer loss', async t => {
  const f = await fixture(t), service = createCreatorIndustryService(f);
  f.rows.push({ ...f.rows[0], id: 2 });
  await Promise.all([service.importReviews(4, [f.proposal()]), service.importReviews(4, [{ ...f.proposal(), observationId: 2 }])]);
  assert.equal((await service.read(4)).analyzedCount, 2);
});
test('automatic tick only processes enabled authors and records its result', async t => {
  const f = await fixture(t); let called = 0;
  const ai = { getAIEnabled: () => true, getAIConfig: () => ({ model: 'test' }), isValidApiKey: () => true,
    callAIModel: async () => { called++; return JSON.stringify(f.proposal()); } };
  const service = createCreatorIndustryService({ ...f, ai });
  await service.tick();
  assert.equal(called, 1);
  assert.equal((await service.read(4)).lastRun.status, 'complete');
  await service.tick(); assert.equal(called, 1);
});

test('a long document can retain more than forty validated relations without a post-charge limit failure', async t => {
  const f = await fixture(t);
  const quote = f.proposal().relations[0].quote;
  f.rows[0].transcript = quote.repeat(8000);
  let calls = 0;
  const ai = { getAIEnabled: () => true, getAIConfig: () => ({ model: 'fixture' }), isValidApiKey: () => true,
    callAIModel: async () => {
      calls++;
      return JSON.stringify({ summary: '分段原文关系', relations: Array.from({ length: 4 }, (_, index) => ({
        ...f.proposal().relations[0], topic: '分段主题 ' + calls + '-' + index
      })) });
    } };
  const service = createCreatorIndustryService({ ...f, ai });

  assert.equal((await service.run(4)).status, 'complete');
  const result = await service.read(4);
  assert.ok(calls > 10, 'the fixture must reproduce the former forty-relation limit');
  assert.equal(result.relations.length, calls * 4);
  assert.equal(result.analyzedCount, 1);
  assert.equal(result.documents[0].bodyHash, documentHash(f.rows[0]));
  assert.equal(result.documents[0].publishedAt, f.rows[0].publishedAt);
  assert.equal((await service.run(4)).status, 'idle');
  assert.equal(calls, 11, 'unchanged long documents must not incur more model calls');
});

test('over-limit documents are rejected before any model call or analyzed record is saved', async t => {
  const f = await fixture(t);
  f.rows[0].transcript = '文'.repeat(200001);
  let calls = 0;
  const ai = { getAIEnabled: () => true, getAIConfig: () => ({ model: 'fixture' }), isValidApiKey: () => true,
    callAIModel: async () => { calls++; return JSON.stringify({ summary: '', relations: [] }); } };
  const service = createCreatorIndustryService({ ...f, ai });

  await assert.rejects(service.run(4), /超过20万字/);
  assert.equal(calls, 0);
  assert.equal((await service.read(4)).analyzedCount, 0);
  assert.deepEqual(await fs.readdir(f.directory), []);
});

test('stopping an active tick aborts the request and prevents further segments, authors, and writes', async t => {
  const f = await fixture(t);
  f.rows[0].transcript = f.proposal().relations[0].quote.repeat(1000);
  const authors = [
    { id: 4, displayName: '作者甲', enabled: true, industryAnalysisEnabled: true },
    { id: 5, displayName: '作者乙', enabled: true, industryAnalysisEnabled: true }
  ];
  const channels = { getChannel: id => authors.find(author => author.id === Number(id)),
    listChannels: () => authors, listCollectionObservations: () => f.rows };
  let signal, releaseResponse, enteredRequest;
  const entered = new Promise(resolve => { enteredRequest = resolve; });
  const response = new Promise(resolve => { releaseResponse = resolve; });
  let calls = 0;
  const ai = { getAIEnabled: () => true, getAIConfig: () => ({ model: 'fixture' }), isValidApiKey: () => true,
    callAIModel: async (_prompt, options = {}) => {
      calls++;
      signal = options.signal;
      enteredRequest();
      return response;
    } };
  const service = createCreatorIndustryService({ ...f, channels, ai });
  t.after(() => service.stop());
  service.start();
  const running = service.tick();
  await entered;
  service.stop();
  releaseResponse(JSON.stringify(f.proposal()));
  await running;

  assert.equal(signal?.aborted, true);
  assert.equal(calls, 1);
  assert.equal((await service.read(4)).analyzedCount, 0);
  assert.equal((await service.read(5)).analyzedCount, 0);
  assert.deepEqual(await fs.readdir(f.directory), []);
  await service.tick();
  assert.equal(calls, 1, 'a stopped scheduler must not begin another tick');
});

test('a failed newest document is cooled down while an older document can finish', async t => {
  const f = await fixture(t);
  const older = { ...f.rows[0], id: 2, publishedAt: '2026-09-17T00:00:00Z' };
  f.rows[0].transcript = '最新失败文稿标识。' + f.rows[0].transcript;
  f.rows.push(older);
  let calls = 0;
  const ai = { getAIEnabled: () => true, getAIConfig: () => ({ model: 'fixture' }), isValidApiKey: () => true,
    callAIModel: async prompt => {
      calls++;
      if (prompt.includes('最新失败文稿标识')) throw new Error('fixture model failure');
      return JSON.stringify({ summary: '旧稿已分析', relations: f.proposal().relations });
    } };
  const service = createCreatorIndustryService({ ...f, ai });

  await service.tick();
  assert.equal((await service.read(4)).lastRun.status, 'failed');
  await service.tick();
  const result = await service.read(4);
  assert.equal(result.analyzedCount, 1);
  assert.equal(result.documents[0].observationId, older.id);
  assert.equal(result.documents[0].publishedAt, older.publishedAt);
  assert.equal(result.pendingCount, 1);
  assert.equal(result.lastRun.status, 'complete');
  await service.tick();
  assert.equal(calls, 2, 'the failed unchanged document must not be retried during cooldown');
});

test('stop issued before the first request prevents a pending context read from starting AI work', async t => {
  const f = await fixture(t);
  let calls = 0;
  const ai = { getAIEnabled: () => true, getAIConfig: () => ({ model: 'fixture' }), isValidApiKey: () => true,
    callAIModel: async () => { calls++; return JSON.stringify(f.proposal()); } };
  const service = createCreatorIndustryService({ ...f, ai });
  service.start();
  const running = service.tick();
  service.stop();
  await running;

  assert.equal(calls, 0, 'stop must also cover time spent awaiting the initial context');
  assert.equal((await service.read(4)).analyzedCount, 0);
  assert.deepEqual(await fs.readdir(f.directory), []);
});

test('quarantines a prompt-echo transcript before AI or manual relation import', async t => {
  const f = await fixture(t); let called = 0;
  f.rows[0].transcript = '请对以下音频进行逐字转写，不要添加解释。请对以下音频进行逐字转写，不要添加解释。';
  const service = createCreatorIndustryService({ ...f, ai: { getAIEnabled: () => true,
    getAIConfig: () => ({ model: 'fixture' }), isValidApiKey: () => true, callAIModel: async () => { called++; return '{}'; } } });
  const state = await service.read(4);
  assert.equal(state.readyCount, 0);
  assert.equal(state.reviewQueue[0].status, 'suspected_prompt_echo');
  assert.equal((await service.run(4)).status, 'idle');
  assert.equal(called, 0);
  await assert.rejects(service.importReviews(4, [{ ...f.proposal(), bodyHash: documentHash(f.rows[0]), relations: [] }]), /文稿.*复核/);
});

test('keeps unreviewed ASR and notes without OCR out of relation extraction', async t => {
  const f = await fixture(t); let called = 0;
  f.rows[0].mediaMetadata.asr.status = 'needs_review';
  f.rows.push({ id: 2, mediaType: 'note', evidenceLevel: 'primary', content: '图文正文暂未提取，但这个标题和简介有足够长的文字，不能被当成已读取的图文原文。' });
  const service = createCreatorIndustryService({ ...f, ai: { getAIEnabled: () => true,
    getAIConfig: () => ({ model: 'fixture' }), isValidApiKey: () => true, callAIModel: async () => { called++; return '{}'; } } });
  const state = await service.read(4);
  assert.equal(state.readyCount, 0);
  assert.deepEqual(state.reviewQueue.map(item => item.status), ['asr_review_required', 'note_ocr_required']);
  assert.equal((await service.run(4)).status, 'idle');
  assert.equal(called, 0);
});

test('ASR completion alone does not bypass an explicit quality-review flag', async t => {
  const f = await fixture(t);
  f.rows[0].mediaMetadata.asr.quality = { needsReview: true, reasons: ['low_confidence'] };
  const service = createCreatorIndustryService(f);
  const state = await service.read(4);
  assert.equal(state.readyCount, 0);
  assert.equal(state.reviewQueue[0].status, 'asr_review_required');
});

test('recognized note OCR remains a review item until the source text is approved', async t => {
  const f = await fixture(t);
  f.rows[0] = { ...f.rows[0], mediaType: 'note', transcript: '',
    content: '作者配文：保偏光纤用于光引擎。图片文字：保偏光纤用于光引擎的激光传输。',
    mediaMetadata: { note: { status: 'needs_review', pages: [{ status: 'recognized', text: '保偏光纤用于光引擎的激光传输。' }] } } };
  const state = await createCreatorIndustryService(f).read(4);
  assert.equal(state.readyCount, 0);
  assert.equal(state.reviewQueue[0].status, 'note_review_required');
});

test('reads the original transcript and marks pre-gate records as legacy without discarding evidence', async t => {
  const f = await fixture(t), service = createCreatorIndustryService(f);
  const legacy = { observationId: 1, bodyHash: documentHash(f.rows[0]), title: '旧稿', relations: f.proposal().relations };
  await fs.writeFile(path.join(f.directory, 'author-4.json'), JSON.stringify({ schema: 'webstock.creator-industry/v1', records: [legacy] }));
  const state = await service.read(4);
  assert.equal(state.analyzedCount, 0);
  assert.equal(state.legacyCount, 1);
  assert.equal(state.pendingCount, 1);
  assert.equal(state.relations.length, 0);
  const document = await service.readDocument(4, 1);
  assert.equal(document.transcript, f.rows[0].transcript);
  assert.equal(document.bodyHash, documentHash(f.rows[0]));
  assert.equal(document.segments.length, 1);
});
