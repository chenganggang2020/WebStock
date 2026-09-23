(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ScreenerCandidateModel = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function finiteScore(value) {
    const number = Number(value);
    return value === null || value === undefined || value === '' || !Number.isFinite(number)
      ? null : Math.max(0, Math.min(number, 100));
  }

  function firstItems(items, limit) {
    return (Array.isArray(items) ? items : []).map(text).filter(Boolean).slice(0, limit);
  }

  function leaderContext(candidate) {
    const context = candidate && candidate.leaderCandidate;
    if (!context || context.candidateKind !== 'manual-sector-watch') return null;
    const role = text(context.roleClaim && context.roleClaim.label) || '观察候选';
    return {
      label: '人工观察名单 · ' + role + '（未核验）',
      status: 'unverified',
      autoConfirmed: false
    };
  }

  function toCandidateCard(candidate = {}) {
    const coverage = candidate.dataCoverage || {};
    const score = finiteScore(candidate.score);
    return {
      identity: {
        code: text(candidate.code),
        name: text(candidate.name) || text(candidate.code),
        marketLabel: text(candidate.marketLabel)
      },
      score: {
        label: '本地候选筛选分',
        value: score,
        status: score === null ? 'missing' : 'available'
      },
      strategy: text(candidate.strategy),
      coverage: [
        { key: 'code', label: '代码', available: coverage.code === true },
        { key: 'quote', label: '行情数据', available: coverage.quote === true },
        { key: 'technical', label: '技术数据', available: coverage.technical === true },
        { key: 'profile', label: '主营资料', available: coverage.profile === true }
      ],
      reasons: firstItems(candidate.reasons, 2),
      risks: firstItems(candidate.risks, 2),
      leaderContext: leaderContext(candidate),
      decisionScope: 'research-candidate',
      notInvestmentAdvice: true,
      researchActions: ['review-evidence', 'track-data-gaps']
    };
  }

  return { toCandidateCard };
});
