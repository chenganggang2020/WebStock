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
const expertChannels = require('../services/expertChannelService');
const backupService = require('../services/backupService');
const portfolio = require('../services/portfolioService');
const db = require('../db');

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
  paperPortfolios.updateStatus(paperPortfolio.id, 'active');
  paperPortfolios.refreshPortfolio(paperPortfolio.id, {
    '600879': { price: 12.5, tradeDate: '2026-08-08', tradeTime: '15:00:00' }
  }, { source: 'test-quotes', capturedAt: '2026-08-08T07:00:00.000Z' });
  const expertChannel = expertChannels.createChannel({
    channelKey: 'backup-model-mr', displayName: '模型先生', subjectType: 'creator', platform: 'douyin',
    profileUrl: 'https://www.douyin.com/user/backup-model-mr',
    description: '公开创作者资料备份测试。'
  });
  const expertObservation = expertChannels.recordObservation(expertChannel.id, {
    externalKey: 'public-video-backup', title: '公开页面记录',
    sourceUrl: 'https://www.douyin.com/video/7533142185677114684',
    publishedAt: '2025-07-31T15:19', evidenceLevel: 'primary',
    contentRole: 'direct_quote', mediaType: 'chart', archiveStatus: 'local_reference',
    rightsBasis: 'user_owned', curveData: '起点,10\n终点,12', analysisNotes: '测试曲线。',
    transcript: '这是需要随备份恢复的本地逐字稿。',
    engagement: { likes: 88, comments: 2, observedAt: '2026-08-15T08:00:00.000Z' },
    mediaMetadata: { asr: { status: 'complete', engine: 'faster-whisper' } },
    stockCodes: ['688041'], stance: 'bullish'
  });
  expertChannels.recordObservationComments(expertChannel.id, expertObservation.id, [{
    commentId: 'backup-question', authorName: '读者', text: '怎么看后续？'
  }, {
    commentId: 'backup-reply', parentCommentId: 'backup-question', authorName: '模型先生',
    authorProfileUrl: expertChannel.profileUrl, text: '继续核对证据。', isCreatorLabel: true
  }], {
    status: 'visible_partial', observedAt: '2026-08-15T08:00:00.000Z', message: '仅当前页面可见范围'
  });
  expertChannels.recordBacktest(expertChannel.id, {
    runId: 'backup-expert-run', datasetId: 'dataset-demo',
    result: { coverage: { strictEligibleObservations: 1 } }
  });
  const brokerAccount = portfolio.createAccount({
    accountKey: 'backup-broker-account', name: '备份券商账户', broker: '测试券商', cashBalance: 1000
  });
  portfolio.importHoldingSnapshot(brokerAccount.id, {
    snapshotDate: '2026-08-08', sourceLabel: '备份测试截图', cashBalance: 1000,
    totalMarketValue: 1250, totalAssets: 2250, totalPnl: 250,
    holdings: [{ code: '600879', name: '航天电子', quantity: 100, costValue: 1000, currentPrice: 12.5, pnl: 250 }]
  });

  const backup = backupService.exportUserData();
  assert.equal(backup.version, 6);
  assert.equal(backup.tables.portfolioAccounts.length, 2);
  assert.equal(backup.tables.portfolioSnapshots.length, 1);
  assert.equal(backup.tables.trades[0].accountKey, 'backup-broker-account');
  assert.equal(backup.tables.knowledgeSources.length, 2);
  assert.equal(backup.tables.researchRuns.length, 1);
  assert.equal(backup.tables.paperPortfolios.length, 1);
  assert.equal(backup.tables.paperPortfolios[0].items[0].code, '600879');
  assert.equal(backup.tables.paperPortfolios[0].positions.length, 1);
  assert.equal(backup.tables.paperPortfolios[0].snapshots.length, 1);
  assert.equal(backup.tables.knowledgeSources[0].sourceKey, source.sourceKey);
  assert.equal(backup.tables.expertChannels.length, 1);
  assert.equal(backup.tables.expertChannels[0].description, '公开创作者资料备份测试。');
  assert.equal(backup.tables.expertChannels[0].observations[0].publishedTimePrecision, 'minute');
  assert.equal(backup.tables.expertChannels[0].observations[0].curveData[1].y, 12);
  assert.match(backup.tables.expertChannels[0].observations[0].transcript, /本地逐字稿/);
  assert.equal(backup.tables.expertChannels[0].observations[0].commentData.comments[1].creatorStatus, 'verified');
  assert.equal(backup.tables.expertChannels[0].backtests[0].runId, 'backup-expert-run');

  paperPortfolios.deletePortfolio(paperPortfolio.id);
  knowledge.deleteSource(source.id);
  researchRuns.listRuns().forEach(run => researchRuns.deleteRun(run.id));
  db.prepare('DELETE FROM expert_channels').run();
  assert.equal(knowledge.search({ query: '商业航天' }).items.length, 0);

  const preview = backupService.previewUserDataImport(backup);
  assert.equal(preview.incoming.knowledgeSources, 2);
  assert.equal(preview.incoming.researchRuns, 1);
  assert.equal(preview.incoming.paperPortfolios, 1);
  assert.equal(preview.incoming.expertChannels, 1);

  const imported = backupService.importUserData(backup, { mode: 'replace' });
  assert.equal(imported.knowledgeSources, 2);
  assert.equal(imported.researchRuns, 1);
  assert.equal(imported.paperPortfolios, 1);
  assert.equal(imported.expertChannels, 1);
  assert.equal(imported.portfolioAccounts, 2);
  assert.equal(imported.portfolioSnapshots, 1);
  const restored = knowledge.search({ query: '商业航天' });
  assert.ok(restored.items.length >= 1);
  assert.equal(restored.items[0].evidenceId, evidenceId);
  assert.equal(researchRuns.listRuns()[0].evidence[0].evidenceId, evidenceId);
  const restoredPaper = paperPortfolios.listPortfolios()[0];
  assert.equal(restoredPaper.name, '商业航天纸面组合');
  assert.equal(restoredPaper.items[0].code, '600879');
  assert.equal(restoredPaper.positions[0].code, '600879');
  assert.equal(restoredPaper.snapshots.length, 1);
  assert.equal(restoredPaper.sourceRunId, null);
  const restoredExpert = expertChannels.listChannels({ query: '模型先生' })[0];
  assert.equal(restoredExpert.description, '公开创作者资料备份测试。');
  const restoredObservation = expertChannels.listObservations(restoredExpert.id)[0];
  assert.equal(restoredObservation.publishedTimePrecision, 'minute');
  assert.equal(restoredObservation.mediaType, 'chart');
  assert.equal(restoredObservation.curveData[1].y, 12);
  assert.match(restoredObservation.transcript, /本地逐字稿/);
  assert.equal(restoredObservation.engagement.likes, 88);
  assert.equal(restoredObservation.mediaMetadata.asr.engine, 'faster-whisper');
  const restoredComments = expertChannels.listObservationComments(restoredExpert.id, restoredObservation.id);
  assert.equal(restoredComments.comments[1].creatorStatus, 'verified');
  assert.equal(restoredComments.comments[1].parentCommentId, 'backup-question');
  assert.equal(expertChannels.listBacktests(restoredExpert.id)[0].runId, 'backup-expert-run');
  const restoredBroker = portfolio.listAccounts().find(account => account.accountKey === 'backup-broker-account');
  assert.ok(restoredBroker);
  assert.equal(portfolio.getPositions({}, { accountId: restoredBroker.id })[0].code, '600879');
  assert.equal(portfolio.getLatestSnapshot(restoredBroker.id).sourceLabel, '备份测试截图');
});
