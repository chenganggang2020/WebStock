const DISCLAIMER = '人工维护候选，仅供观察；系统未自动确认为板块龙头。';

function text(value) {
  return String(value == null ? '' : value).trim();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function userClaim(value, fallback) {
  return {
    label: text(value) || fallback || '',
    provenance: 'user-supplied',
    verified: false
  };
}

function buildSectorWatchCandidate(input = {}) {
  return {
    id: input.id == null ? null : input.id,
    code: text(input.code),
    name: text(input.name) || text(input.code),
    sectorName: text(input.sectorName),
    candidateKind: 'manual-sector-watch',
    selectionSource: 'manual-maintained',
    reviewStatus: 'unverified',
    autoConfirmed: false,
    isConfirmedLeader: false,
    roleClaim: userClaim(input.role, '观察候选'),
    reasonClaim: userClaim(input.reason),
    noteClaim: userClaim(input.note),
    weight: numberOrNull(input.weight),
    quote: {
      price: numberOrNull(input.price),
      change: numberOrNull(input.change),
      amount: numberOrNull(input.amount),
      strength: text(input.strength) || '未知'
    },
    dataCoverage: {
      code: /^\d{6}$/.test(text(input.code)),
      quote: [input.price, input.change, input.amount].some(function(value) {
        return numberOrNull(value) !== null;
      })
    },
    researchActions: ['review-evidence', 'track-data-gaps'],
    disclaimer: DISCLAIMER
  };
}

module.exports = {
  DISCLAIMER,
  buildSectorWatchCandidate
};
