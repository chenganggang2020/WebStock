const test = require('node:test');
const assert = require('node:assert/strict');

const candidateModel = require('../services/sectorLeaderCandidateModel');

test('a manually maintained leader role remains an unverified observation candidate', () => {
  const input = {
    id: 7,
    code: '300750',
    name: '宁德时代',
    sectorName: '新能源车',
    role: '总龙头',
    reason: '动力电池代表',
    note: '人工维护',
    price: 238.5,
    change: 8.2,
    strength: '强'
  };
  const before = JSON.parse(JSON.stringify(input));

  const candidate = candidateModel.buildSectorWatchCandidate(input);

  assert.deepEqual(input, before);
  assert.equal(candidate.candidateKind, 'manual-sector-watch');
  assert.equal(candidate.selectionSource, 'manual-maintained');
  assert.equal(candidate.reviewStatus, 'unverified');
  assert.equal(candidate.autoConfirmed, false);
  assert.equal(candidate.isConfirmedLeader, false);
  assert.deepEqual(candidate.roleClaim, {
    label: '总龙头',
    provenance: 'user-supplied',
    verified: false
  });
  assert.equal(candidate.reasonClaim.provenance, 'user-supplied');
  assert.equal(candidate.noteClaim.provenance, 'user-supplied');
  assert.match(candidate.disclaimer, /人工维护候选.*未自动确认/);
});

test('market strength cannot turn a manual sector watch candidate into a confirmed leader', () => {
  const candidate = candidateModel.buildSectorWatchCandidate({
    code: '000001',
    name: '测试股票',
    price: 12.8,
    change: 10,
    amount: 5000000000,
    strength: '强'
  });

  assert.equal(candidate.roleClaim.label, '观察候选');
  assert.equal(candidate.autoConfirmed, false);
  assert.equal(candidate.isConfirmedLeader, false);
  assert.deepEqual(candidate.researchActions, ['review-evidence', 'track-data-gaps']);
  assert.doesNotMatch(JSON.stringify(candidate), /买入|卖出|buy|sell/i);
});
