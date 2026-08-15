const test = require('node:test');
const assert = require('node:assert/strict');

const candidateModel = require('../js/modules/screenerCandidateModel');

test('compact screener card model separates identity, evidence coverage, reasons and risks', () => {
  const card = candidateModel.toCandidateCard({
    code: '688362',
    name: '甬矽电子',
    score: 82,
    marketLabel: '科创板',
    strategy: 'breakout',
    dataCoverage: { code: true, quote: true, technical: false, profile: true },
    reasons: ['主营资料匹配', '人工观察名单命中', '第三条次要理由'],
    risks: ['技术数据缺失', '走势需要复核'],
    leaderCandidate: {
      candidateKind: 'manual-sector-watch',
      reviewStatus: 'unverified',
      roleClaim: { label: '趋势龙头', provenance: 'user-supplied', verified: false }
    }
  });

  assert.deepEqual(card.identity, { code: '688362', name: '甬矽电子', marketLabel: '科创板' });
  assert.equal(card.score.label, '本地候选筛选分');
  assert.equal(card.score.value, 82);
  assert.deepEqual(card.coverage.map(item => [item.key, item.available]), [
    ['code', true],
    ['quote', true],
    ['technical', false],
    ['profile', true]
  ]);
  assert.deepEqual(card.reasons, ['主营资料匹配', '人工观察名单命中']);
  assert.deepEqual(card.risks, ['技术数据缺失', '走势需要复核']);
  assert.equal(card.leaderContext.label, '人工观察名单 · 趋势龙头（未核验）');
  assert.equal(card.decisionScope, 'research-candidate');
  assert.equal(card.notInvestmentAdvice, true);
  assert.deepEqual(card.researchActions, ['review-evidence', 'track-data-gaps']);
});

test('compact screener card model keeps missing scores and coverage explicit', () => {
  const card = candidateModel.toCandidateCard({ code: '', name: '未知候选', dataCoverage: {} });

  assert.equal(card.score.value, null);
  assert.equal(card.score.status, 'missing');
  assert.equal(card.coverage.every(item => item.available === false), true);
  assert.equal(card.leaderContext, null);
});
