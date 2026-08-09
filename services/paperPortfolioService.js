const db = require('../db');

const STATUSES = new Set(['draft', 'active', 'archived']);
const RISK_DEFAULTS = {
  conservative: { maxPositions: 8, maxSingleWeight: 0.10, cashReserve: 0.30, feePerTrade: 5 },
  balanced: { maxPositions: 8, maxSingleWeight: 0.15, cashReserve: 0.20, feePerTrade: 5 },
  aggressive: { maxPositions: 10, maxSingleWeight: 0.20, cashReserve: 0.10, feePerTrade: 5 }
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

function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * scale) / scale;
}

function normalizeConstraints(input = {}, riskProfile = 'balanced') {
  const defaults = RISK_DEFAULTS[riskProfile] || RISK_DEFAULTS.balanced;
  return {
    maxPositions: Math.round(finite(input.maxPositions, defaults.maxPositions, 1, 20)),
    maxSingleWeight: finite(input.maxSingleWeight, defaults.maxSingleWeight, 0.03, 0.5),
    cashReserve: finite(input.cashReserve, defaults.cashReserve, 0, 0.9),
    minSignalCount: Math.round(finite(input.minSignalCount, 1, 1, 5)),
    feePerTrade: finite(input.feePerTrade, defaults.feePerTrade, 0, 1000)
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

function rowToPosition(row) {
  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    quantity: Number(row.quantity),
    entryPrice: Number(row.entry_price),
    entryValue: Number(row.entry_value),
    entryFee: Number(row.entry_fee),
    lastPrice: Number(row.last_price),
    lastMarketValue: Number(row.last_market_value),
    openedAt: row.opened_at,
    updatedAt: row.updated_at
  };
}

function rowToSnapshot(row) {
  return {
    id: Number(row.id),
    snapshotAt: row.snapshot_at,
    marketDate: row.market_date || '',
    marketTime: row.market_time || '',
    cashValue: Number(row.cash_value),
    marketValue: Number(row.market_value),
    totalValue: Number(row.total_value),
    dailyPnl: Number(row.daily_pnl),
    totalPnl: Number(row.total_pnl),
    totalReturn: Number(row.total_return),
    source: row.source || '',
    sourceMetadata: parseJson(row.source_metadata_json, {}),
    warnings: parseJson(row.warnings_json, []),
    createdAt: row.created_at
  };
}

function rowToPortfolio(row, items, positions, snapshots) {
  const snapshotList = (snapshots || []).map(rowToSnapshot);
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
    positions: (positions || []).map(rowToPosition),
    snapshots: snapshotList,
    latestSnapshot: snapshotList[0] || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function getPortfolio(id, options = {}) {
  const row = db.prepare('SELECT * FROM paper_portfolios WHERE id = ?').get(Number(id));
  if (!row) throw new Error('纸面组合不存在');
  const items = db.prepare('SELECT * FROM paper_portfolio_items WHERE portfolio_id = ? ORDER BY target_weight DESC, code ASC').all(row.id);
  const positions = db.prepare('SELECT * FROM paper_portfolio_positions WHERE portfolio_id = ? ORDER BY last_market_value DESC, code ASC').all(row.id);
  const snapshotLimit = Math.min(Math.max(Number(options.snapshotLimit) || 120, 1), 5000);
  const snapshots = db.prepare('SELECT * FROM paper_portfolio_snapshots WHERE portfolio_id = ? ORDER BY datetime(snapshot_at) DESC, id DESC LIMIT ?')
    .all(row.id, snapshotLimit);
  return rowToPortfolio(row, items, positions, snapshots);
}

function listPortfolios(limit = 30) {
  return db.prepare('SELECT * FROM paper_portfolios ORDER BY datetime(updated_at) DESC, id DESC LIMIT ?')
    .all(Math.min(Math.max(Number(limit) || 30, 1), 100))
    .map(row => getPortfolio(row.id, { snapshotLimit: 1 }));
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

function quoteFor(quoteMap, code) {
  const quote = quoteMap && typeof quoteMap === 'object' ? quoteMap[code] : null;
  const price = Number(quote && quote.price);
  return { quote: quote || {}, price: Number.isFinite(price) && price > 0 ? price : null };
}

function initializePositions(paper, quoteMap, snapshotAt, warnings) {
  const constraints = normalizeConstraints(paper.constraints, paper.riskProfile);
  const candidates = paper.items.map(item => {
    const current = quoteFor(quoteMap, item.code);
    if (current.price === null) {
      warnings.push(item.code + ' ' + item.name + '缺少可用价格，未建立模拟持仓');
      return null;
    }
    const budget = paper.capital * item.targetWeight;
    let quantity = Math.floor(budget / (current.price * 100)) * 100;
    if (quantity < 100) {
      warnings.push(item.code + ' ' + item.name + '按目标权重不足一手，未建立模拟持仓');
      return null;
    }
    return {
      code: item.code,
      name: item.name,
      quantity,
      entryPrice: current.price,
      entryValue: round(quantity * current.price),
      entryFee: constraints.feePerTrade,
      openedAt: snapshotAt
    };
  }).filter(Boolean);

  let requiredCash = candidates.reduce((sum, item) => sum + item.entryValue + item.entryFee, 0);
  for (let index = candidates.length - 1; requiredCash > paper.capital && index >= 0; index -= 1) {
    const item = candidates[index];
    while (requiredCash > paper.capital && item.quantity >= 100) {
      item.quantity -= 100;
      item.entryValue = round(item.quantity * item.entryPrice);
      requiredCash = candidates.reduce((sum, candidate) => sum + candidate.entryValue + (candidate.quantity ? candidate.entryFee : 0), 0);
    }
  }
  const funded = candidates.filter(item => item.quantity >= 100);
  if (!funded.length) throw new Error('当前价格与资金不足以建立一手模拟持仓');

  const insert = db.prepare(`
    INSERT INTO paper_portfolio_positions (
      portfolio_id, code, name, quantity, entry_price, entry_value, entry_fee,
      last_price, last_market_value, opened_at
    ) VALUES (@portfolioId, @code, @name, @quantity, @entryPrice, @entryValue, @entryFee,
      @entryPrice, @entryValue, @openedAt)
  `);
  db.transaction(() => funded.forEach(item => insert.run(Object.assign({ portfolioId: paper.id }, item))))();
  return round(paper.capital - funded.reduce((sum, item) => sum + item.entryValue + item.entryFee, 0));
}

function refreshPortfolio(id, quoteMap, metadata = {}) {
  let paper = getPortfolio(id);
  if (paper.status !== 'active') throw new Error('只有“观察中”的纸面组合才能刷新净值');
  const parsedTime = Date.parse(metadata.capturedAt || '');
  const snapshotAt = Number.isNaN(parsedTime) ? new Date().toISOString() : new Date(parsedTime).toISOString();
  const warnings = [];
  let cashValue = paper.latestSnapshot ? paper.latestSnapshot.cashValue : null;
  if (!paper.positions.length) {
    cashValue = initializePositions(paper, quoteMap, snapshotAt, warnings);
    paper = getPortfolio(id);
  }
  if (cashValue === null) {
    cashValue = round(paper.capital - paper.positions.reduce(function(sum, position) {
      return sum + position.entryValue + position.entryFee;
    }, 0));
  }

  let marketDate = '';
  let marketTime = '';
  let marketValue = 0;
  const markedPositions = paper.positions.map(position => {
    const current = quoteFor(quoteMap, position.code);
    const price = current.price === null ? position.lastPrice : current.price;
    if (current.price === null) warnings.push(position.code + ' ' + position.name + '缺少新价格，沿用上次价格');
    if (current.price !== null) {
      const tradeDate = text(current.quote.tradeDate, 20);
      const tradeTime = text(current.quote.tradeTime, 20);
      if (tradeDate > marketDate || (tradeDate === marketDate && tradeTime > marketTime)) {
        marketDate = tradeDate;
        marketTime = tradeTime;
      }
    }
    const value = round(position.quantity * price);
    marketValue += value;
    return { id: position.id, price, value };
  });

  marketValue = round(marketValue);
  if (!marketDate && paper.latestSnapshot) {
    marketDate = paper.latestSnapshot.marketDate;
    marketTime = paper.latestSnapshot.marketTime;
  }
  if (paper.latestSnapshot && marketDate && paper.latestSnapshot.marketDate && marketDate < paper.latestSnapshot.marketDate) {
    throw new Error('行情日期早于已保存的最新快照，未写入倒序数据');
  }
  const totalValue = round(cashValue + marketValue);
  const previousDay = marketDate ? db.prepare(`
    SELECT total_value FROM paper_portfolio_snapshots
    WHERE portfolio_id = ? AND market_date <> '' AND market_date < ?
    ORDER BY market_date DESC, datetime(snapshot_at) DESC, id DESC LIMIT 1
  `).get(paper.id, marketDate) : null;
  const dailyBaseline = previousDay ? Number(previousDay.total_value) : paper.capital;
  const dailyPnl = round(totalValue - dailyBaseline);
  const totalPnl = round(totalValue - paper.capital);
  const totalReturn = paper.capital ? round(totalPnl / paper.capital, 8) : 0;
  const source = text(metadata.source || 'sina-public-quote', 100);
  const sourceMetadata = metadata.sourceMetadata && typeof metadata.sourceMetadata === 'object' ? metadata.sourceMetadata : {};

  db.transaction(() => {
    const updatePosition = db.prepare(`
      UPDATE paper_portfolio_positions
      SET last_price = ?, last_market_value = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    markedPositions.forEach(position => updatePosition.run(position.price, position.value, position.id));
    db.prepare(`
      INSERT INTO paper_portfolio_snapshots (
        portfolio_id, snapshot_at, market_date, market_time, cash_value, market_value,
        total_value, daily_pnl, total_pnl, total_return, source, source_metadata_json, warnings_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(portfolio_id, snapshot_at) DO UPDATE SET
        market_date = excluded.market_date,
        market_time = excluded.market_time,
        cash_value = excluded.cash_value,
        market_value = excluded.market_value,
        total_value = excluded.total_value,
        daily_pnl = excluded.daily_pnl,
        total_pnl = excluded.total_pnl,
        total_return = excluded.total_return,
        source = excluded.source,
        source_metadata_json = excluded.source_metadata_json,
        warnings_json = excluded.warnings_json
    `).run(paper.id, snapshotAt, marketDate, marketTime, cashValue, marketValue, totalValue,
      dailyPnl, totalPnl, totalReturn, source, JSON.stringify(sourceMetadata), JSON.stringify(warnings));
    db.prepare('UPDATE paper_portfolios SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(paper.id);
  })();
  return getPortfolio(id);
}

function deletePortfolio(id) {
  return db.prepare('DELETE FROM paper_portfolios WHERE id = ?').run(Number(id)).changes > 0;
}

function exportPortfolios() {
  return db.prepare('SELECT id FROM paper_portfolios ORDER BY id ASC').all().map(row => getPortfolio(row.id, { snapshotLimit: 5000 }));
}

module.exports = {
  normalizeConstraints,
  allocateWeights,
  createFromPacket,
  getPortfolio,
  listPortfolios,
  updateStatus,
  refreshPortfolio,
  deletePortfolio,
  exportPortfolios
};
