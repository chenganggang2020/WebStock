const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDbPath = path.join(os.tmpdir(), 'webstock-knowledge-service-' + process.pid + '.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
}
process.env.WEBSTOCK_DB_PATH = testDbPath;
process.env.OPENAI_API_KEY = '';

const knowledge = require('../services/knowledgeService');
const researchRuns = require('../services/researchRunService');
const modelRegistry = require('../services/modelRegistryService');

test('knowledge sources are chunked, deduplicated and searchable in Chinese', () => {
  const source = knowledge.createSource({
    sourceType: 'blog',
    title: '张三的光模块产业链笔记',
    author: '张三',
    publishedAt: '2026-06-18',
    sourceUrl: 'https://example.com/zhangsan-cpo',
    tags: ['CPO', '光模块'],
    stockCodes: ['300308', '300502'],
    sectors: ['通信设备'],
    content: [
      '光模块产业链的核心变量包括高速率升级、海外云厂商资本开支和硅光渗透率。',
      '张三认为，选择公司时不能只看概念标签，还要核对主营业务收入、客户结构和产能兑现。',
      '如果行业订单不及预期，估值较高的公司会先承受回撤。'
    ].join('\n\n')
  });

  assert.ok(source.id > 0);
  assert.match(source.sourceKey, /^[a-f0-9-]{20,}$/i);
  assert.ok(source.chunkCount >= 1);

  const duplicate = knowledge.createSource({
    sourceType: 'blog',
    title: '重复导入',
    author: '张三',
    content: [
      '光模块产业链的核心变量包括高速率升级、海外云厂商资本开支和硅光渗透率。',
      '张三认为，选择公司时不能只看概念标签，还要核对主营业务收入、客户结构和产能兑现。',
      '如果行业订单不及预期，估值较高的公司会先承受回撤。'
    ].join('\n\n')
  });
  assert.equal(duplicate.id, source.id);
  assert.equal(duplicate.duplicate, true);

  const byTopic = knowledge.search({ query: '光模块', limit: 10 });
  assert.equal(byTopic.engine, 'fts5-trigram');
  assert.ok(byTopic.items.length >= 1);
  assert.equal(byTopic.items[0].sourceId, source.id);
  assert.match(byTopic.items[0].evidenceId, /^K[a-f0-9]+-\d+$/i);
  assert.match(byTopic.items[0].content, /主营业务|光模块/);

  const byQuestion = knowledge.search({ query: '张三怎么看光模块', limit: 10 });
  assert.ok(byQuestion.items.some(item => item.sourceId === source.id));

  const byStock = knowledge.search({ query: '300308', limit: 10 });
  assert.ok(byStock.items.some(item => item.sourceId === source.id));
});

test('knowledge analysis prompt is grounded in stable evidence blocks', () => {
  const context = knowledge.buildAnalysisContext({
    question: '根据张三的框架，光模块公司应该重点验证什么？',
    mode: 'stock-fit',
    limit: 6
  });

  assert.ok(context.evidence.length >= 1);
  assert.match(context.prompt, /来源证据/);
  assert.match(context.prompt, new RegExp('\\[' + context.evidence[0].evidenceId + '\\]'));
  assert.match(context.prompt, /来源支持|模型推断/);
  assert.match(context.prompt, /WEBSTOCK_RESULT_START/);
  assert.match(context.prompt, /WEBSTOCK_RESULT_END/);
});

test('selection analysis combines screener candidates with retrieved evidence', () => {
  const context = knowledge.buildAnalysisContext({
    question: 'Use the expert framework to review the current CPO candidates.',
    searchQuery: 'CPO 300308',
    mode: 'selection',
    candidateContext: [
      {
        code: '300308',
        name: 'Candidate A',
        score: 82,
        industry: 'Communication equipment',
        reasons: ['Strong relative trend'],
        risks: ['Valuation compression']
      }
    ],
    limit: 6
  });

  assert.ok(context.evidence.length >= 1);
  assert.match(context.prompt, /300308/);
  assert.match(context.prompt, /Candidate A/);
  assert.match(context.prompt, /82/);
  assert.match(context.prompt, /candidate|候选/i);
  assert.match(context.prompt, /not instructions|不执行/i);
});

test('research runs preserve prompts, evidence and results for review', () => {
  const context = knowledge.buildAnalysisContext({ question: '光模块的主要反证是什么？', mode: 'contradiction' });
  const run = researchRuns.createRun({
    runType: 'knowledge-analysis',
    modelId: 'chatgpt-handoff',
    status: 'completed',
    title: '光模块反证检查',
    question: '光模块的主要反证是什么？',
    prompt: context.prompt,
    result: '订单不及预期和估值压缩是主要风险。',
    evidence: context.evidence
  });

  assert.ok(run.id > 0);
  assert.equal(run.modelId, 'chatgpt-handoff');
  assert.equal(run.evidence[0].evidenceId, context.evidence[0].evidenceId);
  assert.match(researchRuns.getRun(run.id).result, /订单不及预期/);
  assert.ok(researchRuns.listRuns({ runType: 'knowledge-analysis' }).some(item => item.id === run.id));
});

test('model registry reports real availability instead of deployment names', () => {
  const models = modelRegistry.listModels();
  const byId = new Map(models.map(item => [item.id, item]));

  assert.equal(byId.get('local-factor-v1').status, 'available');
  assert.equal(byId.get('knowledge-fts-v1').status, 'available');
  assert.equal(byId.get('chatgpt-handoff').status, 'available');
  assert.equal(byId.get('openai-direct').status, 'not_configured');
  assert.equal(byId.get('qlib-lightgbm').status, 'planned');
  assert.equal(byId.get('master').status, 'planned');
  assert.equal(byId.get('rd-agent-q').status, 'planned');
  assert.ok(byId.get('master').requirements.length >= 1);
});

test('deleting a source removes its chunks from subsequent searches', () => {
  const source = knowledge.listSources({ query: '张三的光模块产业链笔记' })[0];
  assert.ok(source);
  assert.equal(knowledge.deleteSource(source.id), true);
  assert.equal(knowledge.search({ query: '硅光渗透率' }).items.length, 0);
});
