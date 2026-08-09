const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDbPath = path.join(os.tmpdir(), 'webstock-knowledge-backup-' + process.pid + '.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
}
process.env.WEBSTOCK_DB_PATH = testDbPath;

const knowledge = require('../services/knowledgeService');
const paperPortfolios = require('../services/paperPortfolioService');
const researchRuns = require('../services/researchRunService');
const backupService = require('../services/backupService');

test('backup roundtrip restores knowledge, research runs and paper portfolios', () => {
  const source = knowledge.createSource({
    sourceType: 'transcript',
    title: '商业航天访谈',
    author: '访谈嘉宾',
    tags: ['商业航天'],
    stockCodes: ['600879'],
    content: '商业航天的验证重点包括订单来源、发射频次、卫星制造产能和回款周期。'
  });
  const context = knowledge.buildAnalysisContext({ question: '商业航天要验证什么？' });
  const evidenceId = context.evidence[0].evidenceId;
  const researchRun = researchRuns.createRun({
    runType: 'knowledge-analysis',
    modelId: 'chatgpt-handoff',
    title: '商业航天验证',
    question: '商业航天要验证什么？',
    prompt: context.prompt,
    result: '需要核对订单、频次、产能与回款。',
    evidence: context.evidence
  });
  const paperPortfolio = paperPortfolios.createFromPacket({
    name: '商业航天纸面组合',
    packet: {
      schema: 'webstock.research.decision-packet.v1',
      generatedAt: new Date().toISOString(),
      researchRunId: researchRun.id,
      riskProfile: 'balanced',
      question: '商业航天候选验证',
      evidence: context.evidence,
      candidates: [{
        code: '600879',
        name: '航天电子',
        consensusScore: 80,
        signalCount: 2,
        modelDisagreement: 10,
        signals: [{ sourceLabel: '量化模型' }, { sourceLabel: '专家证据' }]
      }]
    }
  });

  const backup = backupService.exportUserData();
  assert.equal(backup.version, 3);
  assert.equal(backup.tables.knowledgeSources.length, 1);
  assert.equal(backup.tables.researchRuns.length, 1);
  assert.equal(backup.tables.paperPortfolios.length, 1);
  assert.equal(backup.tables.paperPortfolios[0].items[0].code, '600879');
  assert.equal(backup.tables.knowledgeSources[0].sourceKey, source.sourceKey);

  paperPortfolios.deletePortfolio(paperPortfolio.id);
  knowledge.deleteSource(source.id);
  researchRuns.listRuns().forEach(run => researchRuns.deleteRun(run.id));
  assert.equal(knowledge.search({ query: '商业航天' }).items.length, 0);

  const preview = backupService.previewUserDataImport(backup);
  assert.equal(preview.incoming.knowledgeSources, 1);
  assert.equal(preview.incoming.researchRuns, 1);
  assert.equal(preview.incoming.paperPortfolios, 1);

  const imported = backupService.importUserData(backup, { mode: 'replace' });
  assert.equal(imported.knowledgeSources, 1);
  assert.equal(imported.researchRuns, 1);
  assert.equal(imported.paperPortfolios, 1);
  const restored = knowledge.search({ query: '商业航天' });
  assert.ok(restored.items.length >= 1);
  assert.equal(restored.items[0].evidenceId, evidenceId);
  assert.equal(researchRuns.listRuns()[0].evidence[0].evidenceId, evidenceId);
  const restoredPaper = paperPortfolios.listPortfolios()[0];
  assert.equal(restoredPaper.name, '商业航天纸面组合');
  assert.equal(restoredPaper.items[0].code, '600879');
  assert.equal(restoredPaper.sourceRunId, null);
});
