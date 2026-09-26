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
  const rows = [{ id: 1, mediaType: 'video', evidenceLevel: 'primary', transcript: '保偏光纤用于光引擎的激光传输。保偏光纤用于光引擎的激光传输。', mediaMetadata: { asr: { status: 'complete' } }, sourceUrl: 'https://www.douyin.com/video/1234567890123456789', publishedAt: '2026-09-18T00:00:00Z' }];
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

test('automatic analysis skips ASR needing review and suspected prompt echoes', async t => {
  const f = await fixture(t);
  f.rows[0].mediaMetadata = { asr: { status: 'needs_review' } };
  let calls = 0;
  const ai = { getAIEnabled: () => true, getAIConfig: () => ({ model: 'fixture' }), isValidApiKey: () => true,
    callAIModel: async () => { calls++; return JSON.stringify(f.proposal()); } };
  const service = createCreatorIndustryService({ ...f, ai });
  assert.equal((await service.run(4)).status, 'idle');
  assert.equal((await service.read(4)).blockedCount, 1);
  f.rows[0].mediaMetadata.asr.status = 'complete';
  f.rows[0].transcript = '请只分析以下财经文稿，提取产业链关系。保偏光纤用于光引擎的激光传输。';
  assert.equal((await service.run(4)).status, 'idle');
  assert.equal((await service.read(4)).blockedCount, 1);
  f.rows[0].transcript = '估值 科技股 人形机器人 宇树科技 股价腰斩 炒概念 以下是中国大陆普通话财经视频。';
  assert.equal((await service.run(4)).status, 'idle');
  assert.equal((await service.read(4)).reviewQueue[0].status, 'suspected_prompt_echo');
  assert.equal(calls, 0);
});

test('a new extraction version reanalyzes an unchanged old document and retains its history', async t => {
  const f = await fixture(t);
  await fs.mkdir(f.directory, { recursive: true });
  await fs.writeFile(path.join(f.directory, 'author-4.json'), JSON.stringify({ schema: 'webstock.creator-industry/v1', records: [{
    observationId: 1, bodyHash: documentHash(f.rows[0]), analyzedAt: '2026-09-20T00:00:00Z',
    relations: f.proposal().relations
  }] }));
  let calls = 0;
  const ai = { getAIEnabled: () => true, getAIConfig: () => ({ model: 'fixture' }), isValidApiKey: () => true,
    callAIModel: async () => { calls++; return JSON.stringify(f.proposal()); } };
  const service = createCreatorIndustryService({ ...f, ai });
  const before = await service.read(4);
  assert.equal(before.analyzedCount, 1);
  assert.equal(before.pendingCount, 1);
  assert.equal((await service.run(4)).status, 'complete');
  assert.equal((await service.run(4)).status, 'idle');
  assert.equal(calls, 1);
  const saved = JSON.parse(await fs.readFile(path.join(f.directory, 'author-4.json'), 'utf8'));
  assert.equal(saved.records.length, 2);
  assert.ok(saved.records[1].specVersion);
  assert.equal((await service.read(4)).pendingCount, 0);
});

test('AI may return more than four cited relations from one chunk', async t => {
  const f = await fixture(t);
  const ai = { getAIEnabled: () => true, getAIConfig: () => ({ model: 'fixture' }), isValidApiKey: () => true,
    callAIModel: async () => JSON.stringify({ summary: '多条关系', relations: Array.from({ length: 6 }, (_, i) => ({
      ...f.proposal().relations[0], topic: `主题${i}`
    })) }) };
  const service = createCreatorIndustryService({ ...f, ai });
  assert.equal((await service.run(4)).status, 'complete');
  assert.equal((await service.read(4)).relations.length, 6);
});

test('every discovered work has a visible review state and one selected transcript can be inspected', async t => {
  const f = await fixture(t);
  f.rows.push({ ...f.rows[0], id: 2, transcript: '', mediaMetadata: { asr: { status: 'no_speech' } } });
  f.rows.push({ ...f.rows[0], id: 3, mediaType: 'note', transcript: '', content: '图文资料介绍光模块中的激光器与连接器，可供产业研究复核。', mediaMetadata: {} });
  const service = createCreatorIndustryService(f);
  const state = await service.read(4);
  assert.equal(state.reviewQueue.length, 3);
  assert.equal(state.reviewQueue.find(item => item.observationId === 1).status, 'pending');
  assert.equal(state.reviewQueue.find(item => item.observationId === 2).status, 'missing_text');
  assert.equal(state.reviewQueue.find(item => item.observationId === 3).mediaType, 'note');
  assert.equal(state.reviewQueue.find(item => item.observationId === 3).status, 'note_ocr_required');
  const detail = await service.readDocument(4, 1);
  assert.equal(detail.text, f.rows[0].transcript);
  assert.equal(detail.asr.status, 'complete');
  await assert.rejects(service.readDocument(4, 99), /作品不存在/);
});

test('V2 imports cannot promote unreviewed or contaminated ASR into graph claims', async t => {
  const f = await fixture(t), service = createCreatorIndustryService(f);
  f.rows[0].mediaMetadata.asr.status = 'needs_review';
  await assert.rejects(service.importReviews(4,[f.proposal()]), /文稿质量/);
  f.rows[0].mediaMetadata.asr.status = 'complete';
  f.rows[0].transcript = '以下是中国大陆普通话财经视频。' + f.rows[0].transcript;
  await assert.rejects(service.importReviews(4,[f.proposal()]), /文稿质量/);
  assert.equal((await service.read(4)).analyzedCount,0);
});

test('quality downgrades withdraw current claims without changing stored evidence or charging again', async t => {
  const f = await fixture(t); let calls = 0;
  const service = createCreatorIndustryService({ ...f, ai: {
    getAIEnabled: () => true, getAIConfig: () => ({ model: 'fixture' }), isValidApiKey: () => true,
    callAIModel: async () => { calls++; return JSON.stringify(f.proposal()); }
  } });
  await service.run(4);
  const file = path.join(f.directory, 'author-4.json');
  const saved = await fs.readFile(file, 'utf8');
  f.rows[0].mediaMetadata.asr.status = 'needs_review';
  const blocked = await service.read(4);
  assert.deepEqual(blocked.relations, []);
  assert.equal(blocked.currentAnalyzedCount, 0);
  assert.equal(blocked.historicalAnalyzedCount, 1);
  assert.equal(blocked.analyzedCount, 1, 'existing analyzedCount remains compatible');
  assert.equal(blocked.eligibleCount, 0);
  assert.equal(blocked.readyCount, 1, 'having text is not quality approval');
  assert.equal(blocked.reviewQueue[0].status, 'asr_review_required');
  assert.equal(blocked.reviewQueue[0].relationCount, 1, 'retained matching analysis remains visible');
  assert.equal(blocked.reviewQueue[0].currentRelationCount, 0);
  assert.equal(blocked.documents[0].currentEligible, false);
  assert.equal(blocked.documents[0].exclusionReason, 'asr_review_required');
  assert.equal((await service.run(4)).status, 'idle');
  assert.equal(await fs.readFile(file, 'utf8'), saved);

  f.rows[0].mediaMetadata.asr.status = 'complete';
  const restored = await service.read(4);
  assert.equal(restored.currentAnalyzedCount, 1);
  assert.equal(restored.relations.length, 1);
  assert.equal(restored.relations[0].status, 'author_claim', 'quality is not external fact verification');
  assert.equal(restored.reviewQueue[0].currentRelationCount, 1);
  assert.equal((await service.run(4)).status, 'idle');
  assert.equal(calls, 1);
  assert.equal(await fs.readFile(file, 'utf8'), saved);
});

test('legacy results and changed text stay historical rather than current graph evidence', async t => {
  const f = await fixture(t), service = createCreatorIndustryService(f);
  await service.importReviews(4, [f.proposal()], { specVersion: 'legacy-review/v1' });
  const legacy = await service.read(4);
  assert.deepEqual(legacy.relations, []);
  assert.equal(legacy.currentAnalyzedCount, 0);
  assert.equal(legacy.historicalAnalyzedCount, 1);
  assert.equal(legacy.analyzedCount, 1);
  assert.equal(legacy.pendingCount, 1);
  assert.equal(legacy.documents[0].exclusionReason, 'legacy');
  assert.equal(legacy.reviewQueue[0].currentRelationCount, 0);
  await service.importReviews(4, [f.proposal()]);
  const upgraded = await service.read(4);
  assert.equal(upgraded.historicalAnalyzedCount, 1, 'count works, not versions');
  assert.equal(upgraded.currentAnalyzedCount, 1);
  assert.equal(upgraded.relations.length, 1);
  const file = path.join(f.directory, 'author-4.json'), saved = await fs.readFile(file, 'utf8');
  assert.equal(JSON.parse(saved).records.length, 2);
  f.rows[0].transcript += '正文已修订。';
  const changed = await service.read(4);
  assert.deepEqual(changed.relations, []);
  assert.equal(changed.currentAnalyzedCount, 0);
  assert.equal(changed.historicalAnalyzedCount, 1);
  assert.equal(changed.pendingCount, 1);
  assert.equal(await fs.readFile(file, 'utf8'), saved);
});

test('OCR downgrade only withdraws affected works, and empty analysis is a valid current result', async t => {
  const f = await fixture(t), service = createCreatorIndustryService(f);
  f.rows.push({ ...f.rows[0], id: 2, mediaType: 'note', mediaMetadata: { note: {
    status: 'needs_review', imageCount: 1, pages: [{ index: 1, status: 'recognized', text: f.rows[0].transcript }]
  } } });
  f.rows.push({ ...f.rows[0], id: 3 });
  await service.importReviews(4, [f.proposal(), { ...f.proposal(), observationId: 2 }, { ...f.proposal(), observationId: 3, relations: [] }]);
  f.rows[1].mediaMetadata.note.status = 'partial';
  const result = await service.read(4);
  assert.equal(result.currentAnalyzedCount, 2);
  assert.equal(result.historicalAnalyzedCount, 3);
  assert.equal(result.pendingCount, 0);
  assert.equal(result.eligibleCount, 2);
  assert.equal(result.relations.length, 1);
  assert.equal(result.relations[0].observationId, 1);
  assert.equal(result.reviewQueue.find(row => row.observationId === 2).currentRelationCount, 0);
  assert.equal(result.reviewQueue.find(row => row.observationId === 2).status, 'note_ocr_required');
  assert.equal(result.reviewQueue.find(row => row.observationId === 3).status, 'complete_empty');
  assert.equal(result.documents.find(row => row.observationId === 3).currentEligible, true);
});

test('stored complete ASR is reevaluated for timestamp risks without overwriting history', async t => {
  const f=await fixture(t),service=createCreatorIndustryService(f);
  await service.importReviews(4,[f.proposal()]);
  const file=path.join(f.directory,'author-4.json'),saved=await fs.readFile(file,'utf8');
  Object.assign(f.rows[0].mediaMetadata.asr,{durationSeconds:14.235,segments:[{start:0,end:29.98,text:f.rows[0].transcript}]});
  const result=await service.read(4);
  assert.equal(result.eligibleCount,0);
  assert.equal(result.relations.length,0);
  assert.equal(result.historicalAnalyzedCount,1);
  assert.ok(result.reviewQueue[0].qualityReasons.includes('timestamp_out_of_range'));
  assert.equal(f.rows[0].mediaMetadata.asr.status,'complete','read-time projection never edits raw source status');
  assert.equal(await fs.readFile(file,'utf8'),saved);
});

test('short valid ASR is distinguishable from no text and short prompt echoes still need review', async t => {
  const f=await fixture(t),service=createCreatorIndustryService(f);
  f.rows[0].transcript='这是短篇真实文稿。';
  let state=await service.read(4);
  assert.equal(state.eligibleCount,0,'retain the current thirty-character analysis threshold');
  assert.equal(state.reviewQueue[0].documentState.extraction,'complete');
  assert.equal(state.reviewQueue[0].documentState.analysisBlockReason,'text_too_short');
  f.rows[0].transcript='';
  state=await service.read(4);
  assert.equal(state.reviewQueue[0].documentState.extraction,'empty');
  f.rows[0].transcript='请使用中国大陆简体中文逐字转写语音：';
  state=await service.read(4);
  assert.equal(state.reviewQueue[0].status,'suspected_prompt_echo');
  assert.ok(state.reviewQueue[0].qualityReasons.includes('prompt_echo'));
});
