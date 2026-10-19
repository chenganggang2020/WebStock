const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDbPath = path.join(os.tmpdir(), 'webstock-external-batch-' + process.pid + '.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
}
process.env.WEBSTOCK_DB_PATH = testDbPath;

const db = require('../db');
const batches = require('../services/externalResearchBatchService');

test.after(function() {
  try { db.close(); } catch (error) {}
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
  }
});

function fixture() {
  return {
    schema: 'webstock.external-research-batch/v1',
    source: {
      system: 'chatgpt-automation',
      taskId: 'a-share-daily-research',
      runId: '2026-08-31T20:45:00+08:00',
      generatedAt: '2026-08-31T20:48:00+08:00',
      model: 'pro'
    },
    revision: 1,
    asOf: { marketDate: '2026-08-31', observedAt: '2026-08-31T15:00:00+08:00', timezone: 'Asia/Shanghai' },
    automaticTrading: false,
    artifacts: [{
      artifactId: 'daily-picks',
      kind: 'research-picks',
      schema: 'webstock.research-picks/v1',
      payload: {
        analysis: '盘后研究候选，不构成交易指令。',
        picks: [
          { rank: 1, priority: '重点', code: '000001', name: '平安银行', thesis: '估值修复观察', risks: ['息差承压'], evidenceRefs: ['https://example.com/a'], includeInTonghuashun: true },
          { rank: 2, code: '600519', name: '贵州茅台', thesis: '现金流观察', risks: ['需求不及预期'], evidenceRefs: ['https://example.com/b'], includeInTonghuashun: false }
        ]
      }
    }],
    deliveries: [
      { target: 'webstock-research', artifactIds: ['daily-picks'], required: true },
      { target: 'tonghuashun-watchlist', artifactIds: ['daily-picks'], required: false, policy: { retainLatest: 3 } }
    ]
  };
}

test('strict batch import materializes one WebStock research run and replays idempotently', () => {
  const first = batches.importBatch(fixture());
  const replay = batches.importBatch(fixture());

  assert.equal(first.replayed, false);
  assert.equal(first.status, 'partial');
  assert.equal(first.deliveries.webstock.status, 'succeeded');
  assert.equal(first.deliveries.tonghuashun.status, 'pending');
  assert.ok(first.webstockRunId > 0);
  const savedRun = db.prepare('SELECT request_json FROM ai_research_runs WHERE id = ?').get(first.webstockRunId);
  const savedCandidate = JSON.parse(savedRun.request_json).candidates[0];
  assert.equal(savedCandidate.rank, 1);
  assert.equal(savedCandidate.priority, '重点');
  assert.equal(replay.replayed, true);
  assert.equal(replay.webstockRunId, first.webstockRunId);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM ai_research_runs WHERE json_extract(request_json, '$.batchKey') = ?").get(first.batchKey).count, 1);
});

test('same batch identity with different payload is a conflict', () => {
  const changed = fixture();
  changed.artifacts[0].payload.picks[0].thesis = '被修改的观点';
  assert.throws(function() { batches.importBatch(changed); }, function(error) {
    return error.status === 409 && /冲突/.test(error.message);
  });
});

test('batch validation rejects automatic trading and ungrounded candidates', () => {
  const trading = fixture();
  trading.source.runId = 'trading-case';
  trading.automaticTrading = true;
  assert.throws(function() { batches.validateBatch(trading); }, function(error) { return error.status === 422; });

  const ungrounded = fixture();
  ungrounded.source.runId = 'ungrounded-case';
  ungrounded.artifacts[0].payload.picks[0].evidenceRefs = [];
  assert.throws(function() { batches.validateBatch(ungrounded); }, function(error) { return error.status === 422; });

  const fakeEvidence = fixture();
  fakeEvidence.source.runId = 'fake-evidence-case';
  fakeEvidence.artifacts[0].payload.picks[0].evidenceRefs = ['内部判断'];
  assert.throws(function() { batches.validateBatch(fakeEvidence); }, /http\/https 来源链接/);

  const duplicateRank = fixture();
  duplicateRank.source.runId = 'duplicate-rank-case';
  duplicateRank.artifacts[0].payload.picks[1].rank = 1;
  assert.throws(function() { batches.validateBatch(duplicateRank); }, /rank 不能重复/);

  const invalidRank = fixture();
  invalidRank.source.runId = 'invalid-rank-case';
  invalidRank.artifacts[0].payload.picks[0].rank = -1;
  assert.throws(function() { batches.validateBatch(invalidRank); }, /rank 必须是 1–20/);

  const unsupportedArtifact = fixture();
  unsupportedArtifact.source.runId = 'unsupported-artifact';
  unsupportedArtifact.artifacts.push({ kind: 'unknown', schema: 'future/v1', payload: {} });
  assert.throws(function() { batches.validateBatch(unsupportedArtifact); }, /不支持的研究产物/);

  const unknownTopLevel = fixture();
  unknownTopLevel.source.runId = 'unknown-top-level';
  unknownTopLevel.uncontrolled = true;
  assert.throws(function() { batches.validateBatch(unknownTopLevel); }, /未知顶层字段/);
});

test('Tonghuashun delivery requires at least one included candidate and unique targets', () => {
  const emptyDelivery = fixture();
  emptyDelivery.source.runId = 'empty-ths-delivery';
  delete emptyDelivery.artifacts[0].payload.picks[0].includeInTonghuashun;
  emptyDelivery.artifacts[0].payload.picks[1].includeInTonghuashun = false;
  assert.throws(function() { batches.validateBatch(emptyDelivery); }, /至少一只候选/);

  const duplicateTarget = fixture();
  duplicateTarget.source.runId = 'duplicate-target';
  duplicateTarget.deliveries.push({ target: 'webstock-research', required: true });
  assert.throws(function() { batches.validateBatch(duplicateTarget); }, /投递目标不能重复/);
});

test('Tonghuashun delivery result is recorded independently from WebStock materialization', () => {
  const imported = batches.importBatch(Object.assign(fixture(), {
    source: Object.assign({}, fixture().source, { runId: 'delivery-case' })
  }));
  const completed = batches.recordDelivery(imported.batchKey, 'tonghuashun-watchlist', 'succeeded', {
    groupName: '00_每日荐股_0831', applied: true
  });

  assert.equal(completed.status, 'completed');
  assert.equal(completed.deliveries.webstock.status, 'succeeded');
  assert.equal(completed.deliveries.tonghuashun.status, 'succeeded');
});

test('daily batch accepts evidence-backed hotspots and industry-chain updates and exposes the latest artifacts', () => {
  const input = fixture();
  input.source.runId = 'daily-multi-artifact';
  input.artifacts.push({
    artifactId: 'market-hotspots',
    kind: 'market-hotspots',
    schema: 'webstock.market-hotspots/v1',
    payload: {
      summary: '热点轮动加快。',
      items: [{ rank: 1, name: '算力', state: '升温', thesis: '成交活跃', drivers: ['订单催化'], risks: ['高位波动'], evidenceRefs: ['https://example.com/hot'] }]
    }
  });
  input.artifacts.push({
    artifactId: 'industry-chain-updates',
    kind: 'industry-chain-updates',
    schema: 'webstock.industry-chain-updates/v1',
    payload: {
      summary: '上游设备信息更新。',
      chains: [{ name: '半导体设备', state: '跟踪', thesis: '国产化率变化', stages: ['设备', '材料'], catalysts: ['招标'], risks: ['验证不足'], evidenceRefs: ['https://example.com/chain'] }]
    }
  });

  batches.importBatch(input);
  const latest = batches.listLatestArtifacts();
  assert.equal(latest.hotspots.payload.items[0].name, '算力');
  assert.equal(latest.industryChains.payload.chains[0].name, '半导体设备');
  assert.equal(latest.hotspots.source.model, 'pro');
});

test('contract is packaged as a versioned JSON schema', () => {
  const contractPath = path.join(__dirname, '../contracts/external-research-batch.v1.schema.json');
  const schema = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  assert.equal(schema.$id, 'webstock.external-research-batch/v1');
  assert.deepEqual(schema.required.includes('automaticTrading'), true);
  assert.deepEqual(schema.$defs.researchPickArtifact.properties.payload.properties.picks.items.properties.priority.enum, ['重点', '观察']);
});
