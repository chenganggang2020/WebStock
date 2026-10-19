const db = require('../db');
const paperPortfolios = require('./paperPortfolioService');
const { validateDecisionPayload, shanghaiDate } = require('./paperMonitorPromptService');
const calendar = require('./marketTradingCalendar');

const DEFAULT_SCHEDULE = ['09:35', '10:30', '14:50'];
const DEFAULT_COSTS = {
  commissionBps: 2.5,
  minimumCommission: 5,
  stampDutyBps: 5,
  slippageBps: 2,
  boardLot: 100
};

function text(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength || 4000);
}

function round(value, digits) {
  const scale = Math.pow(10, digits == null ? 2 : digits);
  return Math.round((Number(value) + Number.EPSILON) * scale) / scale;
}

function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch (error) { return fallback; }
}

function iso(value, fallback) {
  const parsed = Date.parse(value || '');
  if (Number.isNaN(parsed)) return fallback || new Date().toISOString();
  return new Date(parsed).toISOString();
}

function rowToSettings(row) {
  return {
    portfolioId: Number(row.portfolio_id),
    enabled: row.enabled === 1,
    startMode: row.start_mode,
    activatedAt: row.activated_at,
    schedule: parseJson(row.schedule_json, DEFAULT_SCHEDULE),
    holdingsSyncRequired: row.holdings_sync_required === 1,
    lastHoldingsSyncAt: row.last_holdings_sync_at || '',
    lastHoldingsSource: row.last_holdings_source || '',
    lastRunSlot: row.last_run_slot || '',
    lastError: row.last_error || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function ensureMonitorSettings(portfolioId, input = {}) {
  const paper = paperPortfolios.getPortfolio(portfolioId);
  const existing = db.prepare('SELECT * FROM paper_monitor_settings WHERE portfolio_id = ?').get(paper.id);
  if (!existing) {
    const startMode = input.startMode === 'next-trading-day' ? 'next-trading-day' : 'today';
    const enabled = input.enabled === false ? 0 : 1;
    const activatedAt = iso(input.now || input.activatedAt);
    db.prepare(`
      INSERT INTO paper_monitor_settings (
        portfolio_id, enabled, start_mode, activated_at, schedule_json, holdings_sync_required
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(paper.id, enabled, startMode, activatedAt, JSON.stringify(DEFAULT_SCHEDULE), input.holdingsSyncRequired === false ? 0 : 1);
  }
  return rowToSettings(db.prepare('SELECT * FROM paper_monitor_settings WHERE portfolio_id = ?').get(paper.id));
}

function updateMonitorSettings(portfolioId, input = {}) {
  const current = ensureMonitorSettings(portfolioId);
  if (input.holdingsSyncRequired !== undefined && typeof input.holdingsSyncRequired !== 'boolean') throw new Error('持仓参考模式必须是布尔值');
  const holdingsSyncRequired = input.holdingsSyncRequired === undefined ? current.holdingsSyncRequired : input.holdingsSyncRequired;
  const schedule = Array.isArray(input.schedule) ? input.schedule.map(function(value) {
    return text(value, 5);
  }).filter(function(value) { return /^(?:0\d|1\d|2[0-3]):[0-5]\d$/.test(value); }) : current.schedule;
  if (!schedule.length || schedule.length > 12) throw new Error('自动判断时点必须为 1–12 个 HH:MM');
  const startMode = input.startMode === undefined ? current.startMode : input.startMode;
  if (!['today', 'next-trading-day'].includes(startMode)) throw new Error('开始方式无效');
  const enabled = input.enabled === undefined ? current.enabled : input.enabled === true;
  const shouldReactivate = (input.startMode !== undefined && startMode !== current.startMode) ||
    (enabled && !current.enabled);
  const activatedAt = input.activatedAt !== undefined
    ? iso(input.activatedAt)
    : shouldReactivate ? iso(input.now) : current.activatedAt;
  db.transaction(function() {
    if (holdingsSyncRequired !== current.holdingsSyncRequired) {
      invalidateMonitorInputs(current.portfolioId, '模拟模式已改变，需要重新判断');
    }
    db.prepare(`
    UPDATE paper_monitor_settings
    SET enabled = ?, start_mode = ?, activated_at = ?, schedule_json = ?, holdings_sync_required = ?, updated_at = CURRENT_TIMESTAMP
    WHERE portfolio_id = ?
  `).run(
    enabled ? 1 : 0,
    startMode,
    activatedAt,
    JSON.stringify(Array.from(new Set(schedule)).sort()),
    holdingsSyncRequired ? 1 : 0,
    current.portfolioId
  );
  })();
  return rowToSettings(db.prepare('SELECT * FROM paper_monitor_settings WHERE portfolio_id = ?').get(current.portfolioId));
}

function invalidateMonitorInputs(portfolioId, reason) {
  // Only short-lived unused capabilities are removed; the audited decision ledger remains intact.
  db.prepare('DELETE FROM paper_monitor_preparations WHERE portfolio_id = ? AND decision_id IS NULL').run(Number(portfolioId));
  db.prepare("UPDATE paper_orders SET status = 'cancelled', status_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE portfolio_id = ? AND status = 'pending'")
    .run(reason, Number(portfolioId));
}

function addMonitorCandidates(portfolioId, input = {}) {
  const paper = paperPortfolios.getPortfolio(portfolioId);
  if (paper.status !== 'active') throw new Error('只有观察中的模拟账户才能添加候选');
  if (!Array.isArray(input.codes) || !input.codes.length || input.codes.length > 50) throw new Error('每次需提供 1–50 个股票代码');
  const known = new Map(require('../stocks.json').map(item => [item.code, item.name]));
  const codes = Array.from(new Set(input.codes));
  for (const code of codes) {
    if (typeof code !== 'string' || !/^(000|001|002|003|300|301|600|601|603|605|688)\d{3}$/.test(code) || !known.has(code)) {
      throw new Error('股票代码无效、未收录或板块暂不支持：' + text(code, 20));
    }
  }
  const additions = codes.filter(code => !paper.items.some(item => item.code === code));
  if (paper.items.length + additions.length > 50) throw new Error('模拟候选池最多 50 只；已有候选和研究记录不会被覆盖');
  db.transaction(function() {
    if (!additions.length) return;
    invalidateMonitorInputs(paper.id, '候选股票池已改变，需要重新判断');
    const insert = db.prepare(`INSERT INTO paper_portfolio_items
      (portfolio_id, code, name, target_weight, rationale, evidence_json) VALUES (?, ?, ?, 0, ?, ?)`);
    for (const code of additions) insert.run(paper.id, code, known.get(code), '用户明确添加的模拟候选，不代表买入建议', JSON.stringify([{ source: 'user-selected-code', addedAt: new Date().toISOString() }]));
  })();
  return { paper: paperPortfolios.getPortfolio(paper.id), addedCount: additions.length };
}

function rowToDecision(row) {
  return {
    id: Number(row.id),
    portfolioId: Number(row.portfolio_id),
    advisedAt: row.advised_at,
    marketAsOf: row.market_as_of,
    modelId: row.model_id,
    mode: row.mode,
    scheduleSlot: row.schedule_slot || '',
    promptHash: row.prompt_hash,
    prompt: row.prompt_text,
    inputContext: parseJson(row.input_context_json, {}),
    allowedUniverse: parseJson(row.allowed_universe_json, []),
    rawResponse: row.raw_response,
    decision: parseJson(row.decision_json, {}),
    validationStatus: row.validation_status,
    validationErrors: parseJson(row.validation_errors_json, []),
    createdAt: row.created_at
  };
}

function rowToOrder(row) {
  return {
    id: Number(row.id),
    portfolioId: Number(row.portfolio_id),
    decisionId: Number(row.decision_id),
    code: row.code,
    name: row.name,
    action: row.action,
    targetPositionPercent: Number(row.target_position_percent),
    confidence: Number(row.confidence),
    reason: row.reason,
    invalidation: row.invalidation,
    advisedAt: row.advised_at,
    status: row.status,
    statusReason: row.status_reason || '',
    filledQuantity: Number(row.filled_quantity),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToFill(row) {
  return {
    id: Number(row.id),
    portfolioId: Number(row.portfolio_id),
    orderId: Number(row.order_id),
    code: row.code,
    side: row.side,
    filledAt: row.filled_at,
    marketDate: row.market_date,
    marketTime: row.market_time,
    dataSource: row.data_source,
    rawPrice: Number(row.raw_price),
    executionPrice: Number(row.execution_price),
    quantity: Number(row.quantity),
    grossValue: Number(row.gross_value),
    commission: Number(row.commission),
    stampDuty: Number(row.stamp_duty),
    cashChange: Number(row.cash_change),
    createdAt: row.created_at
  };
}

function listDecisions(portfolioId, limit) {
  paperPortfolios.getPortfolio(portfolioId);
  return db.prepare(`
    SELECT * FROM paper_model_decisions WHERE portfolio_id = ?
    ORDER BY datetime(advised_at) DESC, id DESC LIMIT ?
  `).all(Number(portfolioId), Math.min(Math.max(Number(limit) || 50, 1), 500)).map(rowToDecision);
}

function listOrders(portfolioId, limit) {
  paperPortfolios.getPortfolio(portfolioId);
  return db.prepare(`
    SELECT * FROM paper_orders WHERE portfolio_id = ?
    ORDER BY datetime(advised_at) DESC, id DESC LIMIT ?
  `).all(Number(portfolioId), Math.min(Math.max(Number(limit) || 200, 1), 1000)).map(rowToOrder);
}

function listFills(portfolioId, limit) {
  paperPortfolios.getPortfolio(portfolioId);
  return db.prepare(`
    SELECT * FROM paper_fills WHERE portfolio_id = ?
    ORDER BY datetime(filled_at) DESC, id DESC LIMIT ?
  `).all(Number(portfolioId), Math.min(Math.max(Number(limit) || 200, 1), 1000)).map(rowToFill);
}

function recordModelDecision(portfolioId, input = {}) {
  const paper = paperPortfolios.getPortfolio(portfolioId);
  ensureMonitorSettings(paper.id, { now: input.advisedAt });
  const validation = validateDecisionPayload(input.rawResponse);
  const advisedAt = iso(input.advisedAt);
  const marketAsOf = iso(input.marketAsOf || advisedAt, advisedAt);
  if (validation.valid && (Date.parse(validation.value.asOf) !== Date.parse(marketAsOf) || Date.parse(marketAsOf) > Date.parse(advisedAt))) {
    validation.errors.push('模型回复截止时间与本次市场输入不一致或包含未来时间');
    validation.valid = false;
  }
  const mode = ['direct', 'manual', 'scheduled'].includes(input.mode) ? input.mode : 'manual';
  const allowed = Array.isArray(input.allowedUniverse) ? input.allowedUniverse.filter(function(item) {
    return /^\d{6}$/.test(String(item && item.code || ''));
  }) : [];
  const allowedByCode = new Map(allowed.map(function(item) { return [String(item.code), item]; }));
  const constraints = paper.constraints || {};
  if (input.scheduleSlot) {
    const existing = db.prepare("SELECT * FROM paper_model_decisions WHERE portfolio_id = ? AND schedule_slot = ? AND validation_status = 'valid'").get(paper.id, text(input.scheduleSlot, 40));
    if (existing) {
      if (validation.valid && existing.raw_response === text(input.rawResponse, 250000)) {
        return { decision: rowToDecision(existing), orders: db.prepare('SELECT * FROM paper_orders WHERE decision_id = ? ORDER BY id').all(existing.id).map(rowToOrder), deduplicated: true };
      }
      validation.valid = false;
      validation.errors.push('该时段已有已采用的有效建议，本次不同回复未采用');
    }
  }

  const save = db.transaction(function() {
    const decisionInfo = db.prepare(`
      INSERT INTO paper_model_decisions (
        portfolio_id, advised_at, market_as_of, model_id, mode, schedule_slot,
        prompt_hash, prompt_text, input_context_json, allowed_universe_json,
        raw_response, decision_json, validation_status, validation_errors_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      paper.id,
      advisedAt,
      marketAsOf,
      text(input.modelId || 'chatgpt-handoff', 120),
      mode,
      text(input.scheduleSlot, 40),
      text(input.promptHash, 128),
      text(input.prompt, 250000),
      JSON.stringify(input.inputContext && typeof input.inputContext === 'object' ? input.inputContext : {}),
      JSON.stringify(allowed),
      text(input.rawResponse, 250000),
      JSON.stringify(validation.value || {}),
      validation.valid ? 'valid' : 'invalid',
      JSON.stringify(validation.errors)
    );
    const decisionId = Number(decisionInfo.lastInsertRowid);
    if (!validation.valid) return decisionId;

    const totalTarget = validation.value.orders.reduce(function(sum, order) {
      return sum + Number(order.targetPositionPercent || 0);
    }, 0);
    const portfolioTargetInvalid = totalTarget + Number(validation.value.cashTargetPercent || 0) > 100.000001;
    const insertOrder = db.prepare(`
      INSERT INTO paper_orders (
        portfolio_id, decision_id, code, name, action, target_position_percent,
        confidence, reason, invalidation, advised_at, status, status_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    validation.value.orders.forEach(function(order) {
      const security = allowedByCode.get(order.code);
      let status = order.action === 'hold' ? 'held' : 'pending';
      let statusReason = order.action === 'hold' ? '模型建议保持，不生成模拟成交' : '';
      if (!security) {
        status = 'rejected';
        statusReason = '代码不在已审核股票池';
      } else if (Number(order.targetPositionPercent) > Number(constraints.maxSingleWeight || 0.15) * 100 + 1e-9) {
        status = 'rejected';
        statusReason = '目标仓位超过单股上限';
      } else if (portfolioTargetInvalid) {
        status = 'rejected';
        statusReason = '目标仓位与现金目标合计超过 100%';
      }
      if (status === 'pending' || status === 'held') {
        db.prepare(`
          UPDATE paper_orders SET status = 'cancelled', status_reason = '被较新的模型建议替代', updated_at = CURRENT_TIMESTAMP
          WHERE portfolio_id = ? AND code = ? AND status = 'pending'
        `).run(paper.id, order.code);
      }
      insertOrder.run(
        paper.id, decisionId, order.code, text(security && security.name || order.code, 100),
        order.action, Number(order.targetPositionPercent), Number(order.confidence),
        text(order.reason, 4000), text(order.invalidation, 4000), advisedAt, status, statusReason
      );
    });
    return decisionId;
  });

  const decisionId = save();
  return {
    decision: rowToDecision(db.prepare('SELECT * FROM paper_model_decisions WHERE id = ?').get(decisionId)),
    orders: db.prepare('SELECT * FROM paper_orders WHERE decision_id = ? ORDER BY id ASC').all(decisionId).map(rowToOrder)
  };
}

function marketRowTimestamp(row) {
  const value = text(row && row.time, 40);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return Date.parse(value.replace(' ', 'T') + '+08:00');
  }
  return Date.parse(value);
}

function nextMarketRow(market, advisedAt, now) {
  if (!market || !Array.isArray(market.rows) || market.meta && market.meta.stale) return null;
  const advisedTimestamp = Date.parse(advisedAt);
  const nowTimestamp = Date.parse(now);
  return market.rows.map(function(row) {
    return { row, timestamp: marketRowTimestamp(row) };
  }).filter(function(item) {
    return Number.isFinite(item.timestamp) && item.timestamp > advisedTimestamp && item.timestamp <= nowTimestamp && Number(item.row.price) > 0;
  }).sort(function(left, right) { return left.timestamp - right.timestamp; })[0] || null;
}

function limitRate(code, name) {
  if (/^(?:300|301|688|689)/.test(code)) return 0.20;
  if (/^(?:4|8|92)/.test(code)) return 0.30;
  return 0.10;
}

function limitPrice(previousClose, rate, direction) {
  return round(Number(previousClose) * (1 + rate * direction), 2);
}

function commission(gross) {
  return round(Math.max(Number(gross) * DEFAULT_COSTS.commissionBps / 10000, DEFAULT_COSTS.minimumCommission), 2);
}

function initialCash(paper) {
  if (paper.latestSnapshot) return Number(paper.latestSnapshot.cashValue);
  return round(Number(paper.capital) - paper.positions.reduce(function(sum, position) {
    return sum + Number(position.entryValue || 0) + Number(position.entryFee || 0);
  }, 0));
}

function executePendingOrders(portfolioId, marketByCode, options = {}) {
  const paper = paperPortfolios.getPortfolio(portfolioId, { snapshotLimit: 5000 });
  const now = iso(options.now);
  const pending = db.prepare(`
    SELECT * FROM paper_orders WHERE portfolio_id = ? AND status = 'pending'
    ORDER BY datetime(advised_at) ASC, id ASC
  `).all(paper.id).map(rowToOrder);
  if (!pending.length) return { paper, orders: listOrders(paper.id), fills: [] };

  let cash = initialCash(paper);
  const positions = new Map(paper.positions.map(function(position) {
    return [position.code, Object.assign({}, position)];
  }));
  const changedCodes = new Set();
  const orderUpdates = [];
  const fillPlans = [];
  const plannedBuysByDate = new Map();
  const prices = new Map(paper.positions.map(function(position) { return [position.code, Number(position.lastPrice)]; }));
  const selectedRows = new Map(pending.map(order => [order.id, nextMarketRow(marketByCode && marketByCode[order.code], order.advisedAt, now)]));
  pending.sort((left, right) => (selectedRows.get(left.id)?.timestamp ?? Infinity) - (selectedRows.get(right.id)?.timestamp ?? Infinity) || left.id - right.id);

  pending.forEach(function(order) {
    if (shanghaiDate(order.advisedAt) !== shanghaiDate(now) || Date.parse(now) - Date.parse(order.advisedAt) > 5 * 60000) {
      orderUpdates.push({ id: order.id, status: 'cancelled', reason: '建议超过 5 分钟有效期或交易日已切换，需重新判断' });
      return;
    }
    const market = marketByCode && marketByCode[order.code];
    const selected = selectedRows.get(order.id);
    if (!selected) {
      orderUpdates.push({ id: order.id, status: 'pending', reason: market && market.meta && market.meta.stale ? '分钟行情已过期，继续等待' : '等待建议后的下一根有效 1 分钟行情' });
      return;
    }
    const row = selected.row;
    if (paper.latestSnapshot && selected.timestamp < Date.parse(paper.latestSnapshot.snapshotAt)) {
      orderUpdates.push({ id: order.id, status: 'rejected', reason: '行情早于最新账户净值，禁止倒填历史成交，请重新判断' });
      return;
    }
    const rawPrice = Number(row.price);
    const volume = row.volume == null ? null : Number(row.volume);
    const previousClose = Number(market && market.meta && market.meta.previousClose);
    const marketDate = text(row.time, 10);
    const marketTime = text(row.time, 19).slice(11, 19);
    const filledAt = new Date(selected.timestamp).toISOString();
    if (!calendar.isContinuousSession(new Date(selected.timestamp))) {
      orderUpdates.push({ id: order.id, status: 'rejected', reason: '行情时间不在已验证的交易时段' });
      return;
    }
    if (!Number.isFinite(volume) || volume <= 0) {
      orderUpdates.push({ id: order.id, status: 'rejected', reason: '该分钟成交量缺失或为零，无法验证可成交性' });
      return;
    }
    if (/(^|\*)ST|退|^[NC]/i.test(order.name) || !/^(?:000|001|002|003|300|301|600|601|603|605|688)\d{3}$/.test(order.code)) {
      orderUpdates.push({ id: order.id, status: 'rejected', reason: '特殊风险、新股或未验证板块缺少适用交易规则，暂停模拟成交' });
      return;
    }
    if (!Number.isFinite(previousClose) || previousClose <= 0) {
      orderUpdates.push({ id: order.id, status: 'rejected', reason: '缺少昨收，无法验证涨跌停约束' });
      return;
    }
    const rate = limitRate(order.code, order.name);
    if (order.action === 'buy' && rawPrice >= limitPrice(previousClose, rate, 1) - 1e-9) {
      orderUpdates.push({ id: order.id, status: 'rejected', reason: '触及涨停，模拟买入不可成交' });
      return;
    }
    if (order.action === 'sell' && rawPrice <= limitPrice(previousClose, rate, -1) + 1e-9) {
      orderUpdates.push({ id: order.id, status: 'rejected', reason: '触及跌停，模拟卖出不可成交' });
      return;
    }

    const current = positions.get(order.code) || null;
    const currentQuantity = current ? Number(current.quantity) : 0;
    prices.set(order.code, rawPrice);
    const marketValue = Array.from(positions.values()).reduce(function(sum, position) {
      return sum + Number(position.quantity) * Number(prices.get(position.code) || position.lastPrice || position.entryPrice);
    }, 0);
    const equity = cash + marketValue;
    const targetValue = equity * Number(order.targetPositionPercent) / 100;
    const currentValue = currentQuantity * rawPrice;
    const side = order.action;
    const executionPrice = round(rawPrice * (side === 'buy'
      ? 1 + DEFAULT_COSTS.slippageBps / 10000
      : 1 - DEFAULT_COSTS.slippageBps / 10000), 4);
    let quantity = 0;
    const minimumQuantity = /^688/.test(order.code) ? 200 : DEFAULT_COSTS.boardLot;
    const quantityStep = /^688/.test(order.code) ? 1 : DEFAULT_COSTS.boardLot;

    if (side === 'buy') {
      if (!current && positions.size >= Number(paper.constraints.maxPositions)) {
        orderUpdates.push({ id: order.id, status: 'rejected', reason: '已达到模拟账户最大持股数量' });
        return;
      }
      quantity = Math.floor(Math.max(targetValue - currentValue, 0) / executionPrice / quantityStep) * quantityStep;
      const availableCash = Math.max(0, cash - equity * Number(paper.constraints.cashReserve || 0));
      while (quantity > 0) {
        const gross = round(quantity * executionPrice, 2);
        if (gross + commission(gross) <= availableCash + 1e-9) break;
        quantity -= quantityStep;
      }
      if (quantity < minimumQuantity) {
        orderUpdates.push({ id: order.id, status: 'rejected', reason: '不足最低 ' + minimumQuantity + ' 股，或扣除现金保留及费用后资金不足' });
        return;
      }
    } else {
      quantity = Number(order.targetPositionPercent) === 0 ? currentQuantity : Math.floor(Math.max(currentValue - targetValue, 0) / rawPrice / quantityStep) * quantityStep;
      quantity = Math.min(quantity, currentQuantity);
      const databaseBoughtToday = db.prepare(`
        SELECT COALESCE(SUM(quantity), 0) AS quantity FROM paper_fills
        WHERE portfolio_id = ? AND code = ? AND side = 'buy' AND market_date = ?
      `).get(paper.id, order.code, marketDate).quantity;
      const plannedKey = marketDate + ':' + order.code;
      let boughtToday = Number(databaseBoughtToday) + Number(plannedBuysByDate.get(plannedKey) || 0);
      if (!databaseBoughtToday && current && shanghaiDate(current.openedAt) === marketDate) boughtToday = Math.max(boughtToday, currentQuantity);
      const sellable = Math.max(currentQuantity - boughtToday, 0);
      quantity = Math.min(quantity, sellable);
      if (quantity <= 0 || (quantity < minimumQuantity && quantity !== sellable)) {
        orderUpdates.push({ id: order.id, status: 'rejected', reason: sellable <= 0 ? 'T+1：当日买入数量不可卖出' : '目标减仓不足一手' });
        return;
      }
    }

    const grossValue = round(quantity * executionPrice, 2);
    const fee = commission(grossValue);
    const stampDuty = side === 'sell' ? round(grossValue * DEFAULT_COSTS.stampDutyBps / 10000, 2) : 0;
    const cashChange = side === 'buy' ? round(-(grossValue + fee), 2) : round(grossValue - fee - stampDuty, 2);
    cash = round(cash + cashChange, 2);
    if (cash < -0.001) throw new Error('模拟成交后现金为负，已拒绝写入');

    if (side === 'buy') {
      const plannedKey = marketDate + ':' + order.code;
      plannedBuysByDate.set(plannedKey, Number(plannedBuysByDate.get(plannedKey) || 0) + quantity);
      const nextQuantity = currentQuantity + quantity;
      const entryValue = round(Number(current && current.entryValue || 0) + grossValue, 2);
      const entryFee = round(Number(current && current.entryFee || 0) + fee, 2);
      positions.set(order.code, {
        id: current && current.id,
        code: order.code,
        name: order.name,
        quantity: nextQuantity,
        entryPrice: round(entryValue / nextQuantity, 6),
        entryValue,
        entryFee,
        lastPrice: rawPrice,
        lastMarketValue: round(nextQuantity * rawPrice, 2),
        openedAt: current && current.openedAt || filledAt
      });
    } else {
      const remaining = currentQuantity - quantity;
      if (remaining <= 0) positions.delete(order.code);
      else positions.set(order.code, Object.assign({}, current, {
        quantity: remaining,
        entryValue: round(Number(current.entryValue) * remaining / currentQuantity, 2),
        entryFee: round(Number(current.entryFee) * remaining / currentQuantity, 2),
        lastPrice: rawPrice,
        lastMarketValue: round(remaining * rawPrice, 2)
      }));
    }
    changedCodes.add(order.code);
    orderUpdates.push({ id: order.id, status: 'filled', reason: '已按建议后的下一根有效 1 分钟行情模拟成交', quantity });
    fillPlans.push({
      orderId: order.id,
      code: order.code,
      side,
      filledAt,
      marketDate,
      marketTime,
      dataSource: text(market.meta && market.meta.dataSource || 'public-minute', 100),
      rawPrice: round(rawPrice, 4),
      executionPrice,
      quantity,
      grossValue,
      commission: fee,
      stampDuty,
      cashChange
    });
  });

  db.transaction(function() {
    const updateOrder = db.prepare(`
      UPDATE paper_orders SET status = ?, status_reason = ?, filled_quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `);
    orderUpdates.forEach(function(update) {
      updateOrder.run(update.status, update.reason, Number(update.quantity || 0), update.id);
    });
    const insertFill = db.prepare(`
      INSERT INTO paper_fills (
        portfolio_id, order_id, code, side, filled_at, market_date, market_time, data_source,
        raw_price, execution_price, quantity, gross_value, commission, stamp_duty, cash_change
      ) VALUES (@portfolioId, @orderId, @code, @side, @filledAt, @marketDate, @marketTime, @dataSource,
        @rawPrice, @executionPrice, @quantity, @grossValue, @commission, @stampDuty, @cashChange)
    `);
    fillPlans.forEach(function(fill) { insertFill.run(Object.assign({ portfolioId: paper.id }, fill)); });
    changedCodes.forEach(function(code) {
      const position = positions.get(code);
      const existing = paper.positions.find(function(item) { return item.code === code; });
      if (!position && existing) {
        db.prepare('DELETE FROM paper_portfolio_positions WHERE portfolio_id = ? AND code = ?').run(paper.id, code);
      } else if (existing) {
        db.prepare(`
          UPDATE paper_portfolio_positions SET name = ?, quantity = ?, entry_price = ?, entry_value = ?, entry_fee = ?,
            last_price = ?, last_market_value = ?, opened_at = ?, updated_at = CURRENT_TIMESTAMP
          WHERE portfolio_id = ? AND code = ?
        `).run(position.name, position.quantity, position.entryPrice, position.entryValue, position.entryFee,
          position.lastPrice, position.lastMarketValue, position.openedAt, paper.id, code);
      } else if (position) {
        db.prepare(`
          INSERT INTO paper_portfolio_positions (
            portfolio_id, code, name, quantity, entry_price, entry_value, entry_fee,
            last_price, last_market_value, opened_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(paper.id, code, position.name, position.quantity, position.entryPrice, position.entryValue,
          position.entryFee, position.lastPrice, position.lastMarketValue, position.openedAt);
      }
    });

    if (fillPlans.length) {
      const latestFill = fillPlans.reduce(function(latest, fill) { return fill.filledAt > latest.filledAt ? fill : latest; });
      const finalMarketValue = Array.from(positions.values()).reduce(function(sum, position) {
        const price = Number(prices.get(position.code) || position.lastPrice || position.entryPrice);
        return sum + Number(position.quantity) * price;
      }, 0);
      const totalValue = round(cash + finalMarketValue, 2);
      const previousDay = db.prepare(`
        SELECT total_value FROM paper_portfolio_snapshots
        WHERE portfolio_id = ? AND market_date <> '' AND market_date < ?
        ORDER BY market_date DESC, datetime(snapshot_at) DESC, id DESC LIMIT 1
      `).get(paper.id, latestFill.marketDate);
      const dailyBaseline = previousDay ? Number(previousDay.total_value) : Number(paper.capital);
      const priceObservedAt = Object.assign({}, paper.latestSnapshot && paper.latestSnapshot.sourceMetadata && paper.latestSnapshot.sourceMetadata.priceObservedAt);
      paper.positions.forEach(position => { if (!priceObservedAt[position.code]) priceObservedAt[position.code] = paper.latestSnapshot && paper.latestSnapshot.snapshotAt || position.openedAt; });
      fillPlans.forEach(fill => { priceObservedAt[fill.code] = fill.filledAt; });
      const filledCodes = new Set(fillPlans.map(fill => fill.code));
      const unpriced = Array.from(positions.keys()).filter(code => !filledCodes.has(code));
      db.prepare(`
        INSERT INTO paper_portfolio_snapshots (
          portfolio_id, snapshot_at, market_date, market_time, cash_value, market_value,
          total_value, daily_pnl, total_pnl, total_return, source, source_metadata_json, warnings_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(portfolio_id, snapshot_at) DO UPDATE SET
          cash_value = excluded.cash_value, market_value = excluded.market_value, total_value = excluded.total_value,
          daily_pnl = excluded.daily_pnl, total_pnl = excluded.total_pnl, total_return = excluded.total_return,
          source = excluded.source, source_metadata_json = excluded.source_metadata_json, warnings_json = excluded.warnings_json
      `).run(
        paper.id, latestFill.filledAt, latestFill.marketDate, latestFill.marketTime, cash,
        round(finalMarketValue, 2), totalValue, round(totalValue - dailyBaseline, 2),
        round(totalValue - Number(paper.capital), 2), round((totalValue - Number(paper.capital)) / Number(paper.capital), 8),
        'paper-monitor-public-minute', JSON.stringify({ fillCount: fillPlans.length, priceObservedAt, coverageComplete: unpriced.length === 0,
          pricedCount: positions.size - unpriced.length, positionCount: positions.size,
          sources: Array.from(new Set(fillPlans.map(function(fill) { return fill.dataSource; }))) }), JSON.stringify(unpriced.map(code => code + ' 成交快照尚未验证最新价格'))
      );
      db.prepare('UPDATE paper_portfolios SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(paper.id);
    }
  })();

  return {
    paper: paperPortfolios.getPortfolio(paper.id, { snapshotLimit: 5000 }),
    orders: listOrders(paper.id),
    fills: fillPlans.map(function(fill) {
      return rowToFill(db.prepare('SELECT * FROM paper_fills WHERE order_id = ?').get(fill.orderId));
    })
  };
}

function maxDrawdown(snapshots) {
  let peak = 0;
  let worst = 0;
  (snapshots || []).slice().reverse().forEach(function(snapshot) {
    const value = Number(snapshot.totalValue);
    if (value > peak) peak = value;
    if (peak > 0) worst = Math.min(worst, value / peak - 1);
  });
  return round(worst, 8);
}

function markToMarket(portfolioId, marketByCode, options = {}) {
  const paper = paperPortfolios.getPortfolio(portfolioId, { snapshotLimit: 5000 });
  if (paper.status !== 'active') return paper;
  const timestamp = Date.parse(iso(options.now));
  const quotes = {};
  const previous = paper.latestSnapshot;
  const priceObservedAt = Object.assign({}, previous && previous.sourceMetadata && previous.sourceMetadata.priceObservedAt);
  paper.positions.forEach(position => { if (!priceObservedAt[position.code]) priceObservedAt[position.code] = previous && previous.snapshotAt || position.openedAt; });
  let latestTimestamp = 0;
  for (const position of paper.positions) {
    const market = marketByCode[position.code];
    if (!market || market.meta && market.meta.stale) continue;
    const point = (market.rows || []).map(row => ({ row, timestamp: marketRowTimestamp(row) }))
      .filter(item => Number.isFinite(item.timestamp) && item.timestamp <= timestamp && Number(item.row.price) > 0)
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    if (!point || shanghaiDate(new Date(point.timestamp)) !== shanghaiDate(new Date(timestamp))) continue;
    if (point.timestamp < Date.parse(priceObservedAt[position.code])) continue;
    // A closed-session quote may remain current, but never fill gaps in a live session.
    const clock = new Date(timestamp + 8 * 3600000).toISOString().slice(11, 16);
    const live = clock >= '09:30' && clock <= '11:30' || clock >= '13:00' && clock <= '15:00';
    if (live && timestamp - point.timestamp > 5 * 60000) continue;
    latestTimestamp = Math.max(latestTimestamp, point.timestamp);
    priceObservedAt[position.code] = new Date(point.timestamp).toISOString();
    quotes[position.code] = { price: Number(point.row.price), tradeDate: point.row.time.slice(0, 10), tradeTime: point.row.time.slice(11, 19) };
  }
  const coverageComplete = Object.keys(quotes).length === paper.positions.length;
  const sameCoverage = previous && previous.sourceMetadata && previous.sourceMetadata.coverageComplete === coverageComplete && previous.sourceMetadata.pricedCount === Object.keys(quotes).length;
  const sameObservations = previous && previous.sourceMetadata && previous.sourceMetadata.priceObservedAt && paper.positions.every(position => previous.sourceMetadata.priceObservedAt[position.code] === priceObservedAt[position.code]);
  if (!latestTimestamp || previous && (latestTimestamp < Date.parse(previous.snapshotAt) ||
      latestTimestamp === Date.parse(previous.snapshotAt) && sameCoverage && sameObservations && paper.positions.every(position => !quotes[position.code] || quotes[position.code].price === position.lastPrice))) return paper;
  return paperPortfolios.refreshPortfolio(portfolioId, quotes, {
    initializePositions: false,
    capturedAt: new Date(latestTimestamp).toISOString(),
    source: 'paper-monitor-mark-to-market',
    sourceMetadata: { coverageComplete, priceObservedAt, pricedCount: Object.keys(quotes).length, positionCount: paper.positions.length }
  });
}

function monitorPerformance(paper, now = new Date()) {
  const decisions = db.prepare('SELECT COUNT(*) AS count FROM paper_model_decisions WHERE portfolio_id = ?').get(paper.id).count;
  const costs = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(commission),0) AS commission,
    COALESCE(SUM(stamp_duty),0) AS stampDuty, COALESCE(SUM(ABS(execution_price-raw_price)*quantity),0) AS slippageCost
    FROM paper_fills WHERE portfolio_id = ?`).get(paper.id);
  const latest = paper.latestSnapshot;
  const validPoints = paper.snapshots.filter(point => !(point.warnings || []).length && !(point.sourceMetadata && point.sourceMetadata.coverageComplete === false));
  const expected = calendar.expectedObservation(now);
  const stale = paper.positions.length > 0 && (!latest || !expected || Date.parse(latest.snapshotAt) < Date.parse(expected) - 5 * 60000);
  const totalCosts = round(costs.commission + costs.stampDuty + costs.slippageCost);
  const netPnl = latest ? latest.totalPnl : 0;
  return {
    status: !decisions ? 'not-started' : stale ? 'stale' : latest && ((latest.warnings || []).length || latest.sourceMetadata && latest.sourceMetadata.coverageComplete === false) ? 'partial' : 'recording',
    decisionCount: decisions, fillCount: costs.count, snapshotCount: paper.snapshots.length,
    validSnapshotCount: validPoints.length,
    tradingDays: new Set(validPoints.map(point => point.marketDate).filter(Boolean)).size,
    commission: round(costs.commission), stampDuty: round(costs.stampDuty), slippageCost: round(costs.slippageCost), totalCosts,
    netPnl, grossPnl: round(netPnl + totalCosts),
    totalReturn: latest ? latest.totalReturn : 0,
    observedMaxDrawdown: maxDrawdown(validPoints),
    valuationAt: latest ? latest.snapshotAt : null,
    limitation: '前向模拟；回撤仅基于可验证净值点，缺失时段不代表没有波动。公开分钟价与实际可成交价可能不同。'
  };
}

function getMonitorState(portfolioId) {
  const paper = paperPortfolios.getPortfolio(portfolioId, { snapshotLimit: 5000 });
  return {
    settings: ensureMonitorSettings(paper.id),
    paper,
    maxDrawdown: maxDrawdown(paper.snapshots),
    performance: monitorPerformance(paper),
    decisions: listDecisions(paper.id),
    orders: listOrders(paper.id),
    fills: listFills(paper.id),
    runs: listMonitorRuns(paper.id)
  };
}

function getMonitorRun(portfolioId, slot) {
  const row = db.prepare('SELECT * FROM paper_monitor_runs WHERE portfolio_id = ? AND slot = ?').get(Number(portfolioId), slot);
  return row ? { portfolioId: row.portfolio_id, slot: row.slot, status: row.status, attempts: row.attempts, lastAttemptAt: row.last_attempt_at, nextRetryAt: row.next_retry_at, error: row.error } : null;
}

function listMonitorRuns(portfolioId) {
  return db.prepare('SELECT slot FROM paper_monitor_runs WHERE portfolio_id = ? ORDER BY slot DESC LIMIT 60').all(Number(portfolioId))
    .map(row => getMonitorRun(portfolioId, row.slot));
}

function saveMonitorRun(portfolioId, slot, input) {
  const current = Object.assign({ attempts: 0, lastAttemptAt: '', nextRetryAt: '', error: '' }, getMonitorRun(portfolioId, slot), input);
  db.prepare(`INSERT INTO paper_monitor_runs (portfolio_id, slot, status, attempts, last_attempt_at, next_retry_at, error)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(portfolio_id, slot) DO UPDATE SET
    status=excluded.status, attempts=excluded.attempts, last_attempt_at=excluded.last_attempt_at, next_retry_at=excluded.next_retry_at, error=excluded.error`)
    .run(Number(portfolioId), slot, current.status, current.attempts, current.lastAttemptAt, current.nextRetryAt, text(current.error, 2000));
  return getMonitorRun(portfolioId, slot);
}

function exportMonitorState(portfolioId) {
  const paper = paperPortfolios.getPortfolio(portfolioId, { snapshotLimit: 1 });
  const settingsRow = db.prepare('SELECT * FROM paper_monitor_settings WHERE portfolio_id = ?').get(paper.id);
  const decisions = db.prepare('SELECT * FROM paper_model_decisions WHERE portfolio_id = ? ORDER BY id').all(paper.id).map(rowToDecision);
  const orders = db.prepare('SELECT * FROM paper_orders WHERE portfolio_id = ? ORDER BY id').all(paper.id).map(rowToOrder);
  const fills = db.prepare('SELECT * FROM paper_fills WHERE portfolio_id = ? ORDER BY id').all(paper.id).map(rowToFill);
  const runs = db.prepare('SELECT slot FROM paper_monitor_runs WHERE portfolio_id = ? ORDER BY slot').all(paper.id).map(row => getMonitorRun(paper.id, row.slot));
  if (!settingsRow && !decisions.length && !orders.length && !fills.length) return null;
  return {
    settings: settingsRow ? rowToSettings(settingsRow) : null,
    decisions,
    orders,
    fills,
    runs
  };
}

function listEnabledMonitorSettings() {
  return db.prepare(`
    SELECT settings.* FROM paper_monitor_settings AS settings
    INNER JOIN paper_portfolios AS portfolio ON portfolio.id = settings.portfolio_id
    WHERE settings.enabled = 1 AND portfolio.status = 'active'
    ORDER BY settings.portfolio_id ASC
  `).all().map(rowToSettings);
}

function updateMonitorRunStatus(portfolioId, input = {}) {
  const current = ensureMonitorSettings(portfolioId);
  db.prepare(`
    UPDATE paper_monitor_settings SET last_holdings_sync_at = ?, last_holdings_source = ?,
      last_run_slot = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE portfolio_id = ?
  `).run(
    input.lastHoldingsSyncAt === undefined ? current.lastHoldingsSyncAt : text(input.lastHoldingsSyncAt, 80),
    input.lastHoldingsSource === undefined ? current.lastHoldingsSource : text(input.lastHoldingsSource, 120),
    input.lastRunSlot === undefined ? current.lastRunSlot : text(input.lastRunSlot, 40),
    input.lastError === undefined ? current.lastError : text(input.lastError, 2000),
    Number(portfolioId)
  );
  return rowToSettings(db.prepare('SELECT * FROM paper_monitor_settings WHERE portfolio_id = ?').get(Number(portfolioId)));
}

module.exports = {
  DEFAULT_SCHEDULE,
  DEFAULT_COSTS,
  ensureMonitorSettings,
  updateMonitorSettings,
  addMonitorCandidates,
  updateMonitorRunStatus,
  recordModelDecision,
  executePendingOrders,
  markToMarket,
  listDecisions,
  listOrders,
  listFills,
  listEnabledMonitorSettings,
  getMonitorState,
  getMonitorRun,
  listMonitorRuns,
  saveMonitorRun,
  exportMonitorState,
  maxDrawdown
};
