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
const researchRuns = require('../services/researchRunService');
const backupService = require('../services/backupService');

test('backup roundtrip restores knowledge sources, stable evidence IDs and research runs', () => {
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
  researchRuns.createRun({
    runType: 'knowledge-analysis',
    modelId: 'chatgpt-handoff',
    title: '商业航天验证',
    question: '商业航天要验证什么？',
    prompt: context.prompt,
    result: '需要核对订单、频次、产能与回款。',
    evidence: context.evidence
  });

  const backup = backupService.exportUserData();
  assert.equal(backup.version, 2);
  assert.equal(backup.tables.knowledgeSources.length, 1);
  assert.equal(backup.tables.researchRuns.length, 1);
  assert.equal(backup.tables.knowledgeSources[0].sourceKey, source.sourceKey);

  knowledge.deleteSource(source.id);
  researchRuns.listRuns().forEach(run => researchRuns.deleteRun(run.id));
  assert.equal(knowledge.search({ query: '商业航天' }).items.length, 0);

  const preview = backupService.previewUserDataImport(backup);
  assert.equal(preview.incoming.knowledgeSources, 1);
  assert.equal(preview.incoming.researchRuns, 1);

  const imported = backupService.importUserData(backup, { mode: 'replace' });
  assert.equal(imported.knowledgeSources, 1);
  assert.equal(imported.researchRuns, 1);
  const restored = knowledge.search({ query: '商业航天' });
  assert.ok(restored.items.length >= 1);
  assert.equal(restored.items[0].evidenceId, evidenceId);
  assert.equal(researchRuns.listRuns()[0].evidence[0].evidenceId, evidenceId);
});
