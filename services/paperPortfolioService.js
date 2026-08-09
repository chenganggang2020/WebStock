const db = require('../db');

const STATUSES = new Set(['draft', 'active', 'archived']);
const RISK_DEFAULTS = {
  conservative: { maxPositions: 8, maxSingleWeight: 0.10, cashReserve: 0.30 },
  balanced: { maxPositions: 8, maxSingleWeight: 0.15, cashReserve: 0.20 },
  aggressive: { maxPositions: 10, maxSingleWeight: 0.20, cashReserve: 0.10 }
};

function text(value, maxLength = 2000) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function finite(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch (error) { return fallback; }
}

function normalizeConstraints(input = {}, riskProfile = 'balanced') {
  const defaults = RISK_DEFAULTS[riskProfile] || RISK_DEFAULTS.balanced;
  return {
    maxPositions: Math.round(finite(input.maxPositions, defaults.maxPositions, 1, 20)),
    maxSingleWeight: finite(input.maxSingleWeight, defaults.maxSingleWeight, 0.03, 0.5),
    cashReserve: finite(input.cashReserve, defaults.cashReserve, 0, 0.9),
    minSignalCount: Math.round(finite(input.minSignalCount, 1, 1, 5))
  };
}

function allocateWeights(candidates, constraints) {
  const selected = (candidates || []).filter(item => /^\d{6}$/.test(String(item.code || '')))
    .filter(item => !/(^|\*)ST/i.test(String(item.name || '')))
    .filter(item => Number(item.signalCount || 0) >= constraints.minSignalCount)
    .sort((left, right) => Number(right.consensusScore || 0) - Number(left.consensusScore || 0))
    .slice(0, constraints.maxPositions)
    .map(item => Object.assign({}, item));
  let remaining = 1 - constraints.cashReserve;
  const pending = selected.slice();
  const weights = new Map();
  while (pending.length && remaining > 1e-10) {
    const totalScore = pending.reduce((sum, item) => sum + Math.max(Number(item.consensusScore) || 0, 1), 0);
    let cappedAny = false;
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const item = pending[index];
      const proposed = remaining * Math.max(Number(item.consensusScore) || 0, 1) / totalScore;
      if (proposed >= constraints.maxSingleWeight - 1e-10) {
        weights.set(item.code, constraints.maxSingleWeight);
        remaining -= constraints.maxSingleWeight;
        pending.splice(index, 1);
        cappedAny = true;
      }
    }
    if (!cappedAny) {
      pending.forEach(item => {
        weights.set(item.code, remaining * Math.max(Number(item.consensusScore) || 0, 1) / totalScore);
      });
      remaining = 0;
    }
  }
  const items = selected.map(item => Object.assign({}, item, {
    targetWeight: Number((weights.get(item.code) || 0).toFixed(6))
  })).filter(item => item.targetWeight > 0);
  const invested = items.reduce((sum, item) => sum + item.targetWeight, 0);
  return { items, cashWeight: Number(Math.max(1 - invested, 0).toFixed(6)) };
}

function rowToPortfolio(row, items) {
  return {
    id: Number(row.id),
    name: row.name,
    status: row.status,
    asOf: row.as_of,
    capital: Number(row.capital),
    cashWeight: Number(row.cash_weight),
    riskProfile: row.risk_profile,
    constraints: parseJson(row.constraints_json, {}),
    rationale: row.rationale || '',
    sourceRunId: row.source_run_id == null ? null : Number(row.source_run_id),
    items: (items || []).map(item => ({
      id: Number(item.id),
      code: item.code,
      name: item.name,
      targetWeight: Number(item.target_weight),
      consensusScore: Number(item.consensus_score),
      signalCount: Number(item.signal_count),
      rationale: item.rationale || '',
      risks: parseJson(item.risks_json, []),
      evidence: parseJson(item.evidence_json, [])
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function getPortfolio(id) {
  const row = db.prepare('SELECT * FROM paper_portfolios WHERE id = ?').get(Number(id));
  if (!row) throw new Error('纸面组合不存在');
  const items = db.prepare('SELECT * FROM paper_portfolio_items WHERE portfolio_id = ? ORDER BY target_weight DESC, code ASC').all(row.id);
  return rowToPortfolio(row, items);
}

function listPortfolios(limit = 30) {
  return db.prepare('SELECT * FROM paper_portfolios ORDER BY datetime(updated_at) DESC, id DESC LIMIT ?')
    .all(Math.min(Math.max(Number(limit) || 30, 1), 100))
    .map(row => getPortfolio(row.id));
}

function createFromPacket(input = {}) {
  const packet = input.packet && typeof input.packet === 'object' ? input.packet : {};
  if (packet.schema !== 'webstock.research.decision-packet.v1' || !Array.isArray(packet.candidates)) {
    throw new Error('需要先生成有效的研究决策包');
  }
  const riskProfile = RISK_DEFAULTS[input.riskProfile] ? input.riskProfile : (RISK_DEFAULTS[packet.riskProfile] ? packet.riskProfile : 'balanced');
  const constraints = normalizeConstraints(input.constraints || {}, riskProfile);
  const allocation = allocateWeights(packet.candidates, constraints);
  if (!allocation.items.length) throw new Error('没有满足最低来源数和组合约束的候选');
  const capital = finite(input.capital, 100000, 1000, 1000000000);
  const name = text(input.name || ('纸面组合 ' + new Date().toISOString().slice(0, 10)), 160);
  const asOf = text(packet.generatedAt || new Date().toISOString(), 40);
  const sourceRunId = Number(packet.researchRunId) || null;
  const evidence = Array.isArray(packet.evidence) ? packet.evidence : [];
  const transaction = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO paper_portfolios (
        name, status, as_of, capital, cash_weight, risk_profile, constraints_json, rationale, source_run_id
      ) VALUES (?, 'draft', ?, ?, ?, ?, ?, ?, ?)
    `).run(name, asOf, capital, allocation.cashWeight, riskProfile, JSON.stringify(constraints),
      text(input.rationale || packet.question || '', 4000), sourceRunId);
    const portfolioId = info.lastInsertRowid;
    const insertItem = db.prepare(`
      INSERT INTO paper_portfolio_items (
        portfolio_id, code, name, target_weight, consensus_score, signal_count, rationale, risks_json, evidence_json
      ) VALUES (@portfolioId, @code, @name, @targetWeight, @consensusScore, @signalCount, @rationale, @risksJson, @evidenceJson)
    `);
    allocation.items.forEach(item => {
      const relatedEvidence = evidence.filter(entry => {
        const content = [entry.title, entry.content].concat(entry.stockCodes || [], entry.relatedStocks || []).join(' ');
        return content.includes(item.code) || (item.name && content.includes(item.name));
      }).map(entry => entry.evidenceId).filter(Boolean).slice(0, 20);
      insertItem.run({
        portfolioId,
        code: item.code,
        name: text(item.name || item.code, 100),
        targetWeight: item.targetWeight,
        consensusScore: finite(item.consensusScore, 0, 0, 100),
        signalCount: Math.max(Math.round(Number(item.signalCount) || 0), 0),
        rationale: text((item.signals || []).map(signal => signal.sourceLabel).join(' / '), 2000),
        risksJson: JSON.stringify(item.modelDisagreement >= 50 ? ['模型来源内排名分歧较大'] : []),
        evidenceJson: JSON.stringify(relatedEvidence)
      });
    });
    return portfolioId;
  });
  return getPortfolio(transaction());
}

function updateStatus(id, status) {
  const next = text(status, 20).toLowerCase();
  if (!STATUSES.has(next)) throw new Error('纸面组合状态无效');
  getPortfolio(id);
  db.prepare('UPDATE paper_portfolios SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(next, Number(id));
  return getPortfolio(id);
}

function deletePortfolio(id) {
  return db.prepare('DELETE FROM paper_portfolios WHERE id = ?').run(Number(id)).changes > 0;
}

function exportPortfolios() {
  return db.prepare('SELECT id FROM paper_portfolios ORDER BY id ASC').all().map(row => getPortfolio(row.id));
}

module.exports = {
  normalizeConstraints,
  allocateWeights,
  createFromPacket,
  getPortfolio,
  listPortfolios,
  updateStatus,
  deletePortfolio,
  exportPortfolios
};
