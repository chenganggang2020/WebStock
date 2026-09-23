function normalizeCode(code) {
  return String(code || '').trim();
}

function getSinaMarketPrefix(code) {
  const normalized = normalizeCode(code);
  if (/^(5|6|9)/.test(normalized)) return 'sh';
  return 'sz';
}

function toSinaSymbol(code) {
  const normalized = normalizeCode(code);
  return getSinaMarketPrefix(normalized) + normalized;
}

function getEastmoneyMarketId(code) {
  return getSinaMarketPrefix(code) === 'sh' ? '1' : '0';
}

module.exports = {
  normalizeCode,
  getSinaMarketPrefix,
  toSinaSymbol,
  getEastmoneyMarketId
};
