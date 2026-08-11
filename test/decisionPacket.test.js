const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-decision-'));
process.env.WEBSTOCK_DB_PATH = path.join(root, 'webstock.db');
process.env.WEBSTOCK_QUANT_WORKSPACE = path.join(root, 'quant-workspace');
process.env.WEBSTOCK_QUANT_PYTHON = path.join(root, 'missing-python.exe');
process.env.WEBSTOCK_DISABLE_SINA_NEWS = '1';
process.env.WEBSTOCK_HOT_MARKET_OFFLINE = '1';
process.env.WEBSTOCK_SENTIMENT_OFFLINE = '1';
process.env.WEBSTOCK_STOCK_PROFILE_OFFLINE = '1';

const backup = require('../services/backupService');
const decisions = require('../services/decisionPacketService');
const knowledge = require('../services/knowledgeService');
const papers = require('../services/paperPortfolioService');
const screener = require('../services/screenerService');

test('decision packet ranks source consensus without comparing raw model scores', () => {
  const map = new Map();
  decisions.addRankedCandidates(map, {
    sourceId: 'model-a', sourceLabel: 'Model A', sourceType: 'quant-model', asOf: '2026-08-07'
  }, [{ code: '000001', name: '平安银行', score: 0.001 }, { code: '300750', name: '宁德时代', score: -20 }]);
  decisions.addRankedCandidates(map, {
    sourceId: 'model-b', sourceLabel: 'Model B', sourceType: 'quant-model', asOf: '2026-08-07'
  }, [{ code: '000001', name: '平安银行', score: 9999 }]);

  const first = map.get('000001');
  const second = map.get('300750');
  assert.ok(decisions.consensusScore(first.signals) > decisions.consensusScore(second.signals));
  assert.equal(first.signals[0].rankPercentile, 100);
  assert.equal(first.signals[1].rankPercentile, 100);
});

test('decision packet defaults to one comparable dataset', () => {
  const entries = [
    { valid: true, result: { modelId: 'master', dataManifest: { datasetId: 'new-dataset' } } },
    { valid: true, result: { modelId: 'lightgbm', dataManifest: { datasetId: 'new-dataset' } } },
    { valid: true, result: { modelId: 'lightgbm', dataManifest: { datasetId: 'old-dataset' } } }
  ];
  const selected = decisions.latestPerModel(entries, '');
  assert.equal(selected.length, 2);
  assert.ok(selected.every(entry => entry.result.dataManifest.datasetId === 'new-dataset'));
});

test('factor ranking cannot bypass factor admission gates', () => {
  assert.equal(decisions.factorRankingEligible({ factors: [{ admission: 'watch' }, { admission: 'rejected' }] }), false);
  assert.equal(decisions.factorRankingEligible({ factors: [{ admission: 'candidate' }] }), true);
});

test('evidence packet and paper portfolio preserve provenance, caps and draft-only behavior', async () => {
  knowledge.createSource({
    sourceType: 'research',
    title: '银行经营观察',
    author: '测试研究员',
    publishedAt: '2026-08-01',
    stockCodes: ['000001'],
    tags: ['银行', '资产质量'],
    content: '000001 平安银行需要核对净息差、资产质量和拨备覆盖率。若不良率上升，应作为反证。'
  });
  screener.saveScreenerResult({
    taskName: '本地候选',
    result: {
      strategy: 'stable',
      demand: '银行和新能源候选',
      candidates: [
        { code: '000001', name: '平安银行', score: 88 },
        { code: '300750', name: '宁德时代', score: 82 },
        { code: '600000', name: '浦发银行', score: 76 }
      ]
    }
  });

  const packet = await decisions.buildDecisionPacket({
    question: '哪些候选值得继续研究？',
    riskProfile: 'balanced',
    maxCandidates: 6
  });

  assert.equal(packet.schema, 'webstock.research.decision-packet.v1');
  assert.ok(packet.researchRunId > 0);
  assert.ok(packet.candidates.some(item => item.code === '000001'));
  assert.ok(packet.evidence.some(item => item.evidenceId && item.content.includes('净息差')));
  assert.match(packet.prompt, /WEBSTOCK_RESULT_START/);
  assert.ok(packet.dataGaps.some(item => /量化/.test(item)));

  const paper = papers.createFromPacket({
    packet,
    name: '测试纸面组合',
    capital: 200000,
    constraints: { maxPositions: 3, maxSingleWeight: 0.2, cashReserve: 0.25 }
  });
  const invested = paper.items.reduce((sum, item) => sum + item.targetWeight, 0);
  assert.equal(paper.status, 'draft');
  assert.ok(paper.items.length >= 1);
  assert.ok(paper.items.every(item => item.targetWeight <= 0.2));
  assert.ok(invested + paper.cashWeight <= 1.000001);
  assert.equal(papers.updateStatus(paper.id, 'active').status, 'active');
  const firstMark = papers.refreshPortfolio(paper.id, {
    '000001': { price: 10, tradeDate: '2026-08-08', tradeTime: '15:00:00' },
    '300750': { price: 20, tradeDate: '2026-08-08', tradeTime: '15:00:00' },
    '600000': { price: 8, tradeDate: '2026-08-08', tradeTime: '15:00:00' }
  }, { source: 'test-quotes', capturedAt: '2026-08-08T07:00:00.000Z' });
  assert.equal(firstMark.positions.length, paper.items.length);
  assert.ok(firstMark.positions.every(position => position.quantity % 100 === 0));
  assert.equal(firstMark.latestSnapshot.totalPnl, -5 * firstMark.positions.length);
  const secondMark = papers.refreshPortfolio(paper.id, {
    '000001': { price: 10.5, tradeDate: '2026-08-09', tradeTime: '15:00:00' },
    '300750': { price: 19, tradeDate: '2026-08-09', tradeTime: '15:00:00' },
    '600000': { price: 8.2, tradeDate: '2026-08-09', tradeTime: '15:00:00' }
  }, { source: 'test-quotes', capturedAt: '2026-08-09T07:00:00.000Z' });
  assert.equal(secondMark.snapshots.length, 2);
  assert.equal(secondMark.latestSnapshot.dailyPnl,
    Number((secondMark.latestSnapshot.totalValue - firstMark.latestSnapshot.totalValue).toFixed(2)));
  const thirdMark = papers.refreshPortfolio(paper.id, {
    '000001': { price: 10.7, tradeDate: '2026-08-09', tradeTime: '15:01:00' },
    '300750': { price: 19.2, tradeDate: '2026-08-09', tradeTime: '15:01:00' },
    '600000': { price: 8.1, tradeDate: '2026-08-09', tradeTime: '15:01:00' }
  }, { source: 'test-quotes', capturedAt: '2026-08-09T07:01:00.000Z' });
  assert.equal(thirdMark.latestSnapshot.dailyPnl,
    Number((thirdMark.latestSnapshot.totalValue - firstMark.latestSnapshot.totalValue).toFixed(2)));
  assert.equal(papers.listPortfolios()[0].snapshots.length, 1);
  assert.throws(() => papers.refreshPortfolio(paper.id, {
    '000001': { price: 10.6, tradeDate: '2026-08-08', tradeTime: '15:02:00' },
    '300750': { price: 19.1, tradeDate: '2026-08-08', tradeTime: '15:02:00' },
    '600000': { price: 8.2, tradeDate: '2026-08-08', tradeTime: '15:02:00' }
  }, { source: 'test-quotes', capturedAt: '2026-08-09T07:02:00.000Z' }), /早于|倒序/);

  const exported = backup.exportUserData();
  assert.equal(exported.version, 6);
  assert.equal(exported.tables.paperPortfolios.length, 1);
  const preview = backup.previewUserDataImport(exported);
  assert.equal(preview.incoming.paperPortfolios, 1);
});

test('paper allocation excludes ST and leaves cash when caps prevent full investment', () => {
  const result = papers.allocateWeights([
    { code: '000001', name: '平安银行', consensusScore: 90, signalCount: 2 },
    { code: '600001', name: 'ST测试', consensusScore: 100, signalCount: 3 }
  ], papers.normalizeConstraints({ maxPositions: 5, maxSingleWeight: 0.1, cashReserve: 0.2 }, 'balanced'));

  assert.deepEqual(result.items.map(item => item.code), ['000001']);
  assert.equal(result.items[0].targetWeight, 0.1);
  assert.equal(result.cashWeight, 0.9);
});

test.after(() => {
  require('../db').close();
  fs.rmSync(root, { recursive: true, force: true });
});
