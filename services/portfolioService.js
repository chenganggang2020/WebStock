const db = require('../db');

const VALID_SIDES = new Set(['buy', 'sell', 'dividend', 'fee']);
const DEFAULT_ESTIMATED_EXIT_FEE = 0;
const DEFAULT_ESTIMATED_EXIT_TAX = 0;
const TRADE_LOT_SIZE = 100;
const TRADE_FEE_PER_LOT = 5;

function round(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = Math.pow(10, digits);
  return Math.round(n * factor) / factor;
}

function normalizeNullableNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeNumber(value, defaultValue = 0) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultValue;
}

function lotBasedTradeFee(side, quantity) {
  if (side !== 'buy' && side !== 'sell') return 0;
  const q = Math.trunc(normalizeNumber(quantity, 0));
  if (q <= 0) return 0;
  return round(Math.ceil(q / TRADE_LOT_SIZE) * TRADE_FEE_PER_LOT, 2);
}

function normalizeTradeFee(side, quantity, fee) {
  const actual = normalizeNumber(fee, 0);
  const lotFee = lotBasedTradeFee(side, quantity);
  return Math.max(actual, lotFee);
}

function assertCode(code) {
  if (!/^\d{6}$/.test(String(code || ''))) {
    throw new Error('股票代码必须是 6 位数字');
  }
}

function assertDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    throw new Error('交易日期必须是 YYYY-MM-DD');
  }
  const date = new Date(value + 'T00:00:00');
  if (Number.isNaN(date.getTime())) throw new Error('交易日期不合法');
}

function rowToWatchlist(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    groupName: row.group_name,
    note: row.note || '',
    alertHigh: row.alert_high,
    alertLow: row.alert_low,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToTrade(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    side: row.side,
    tradeDate: row.trade_date,
    price: row.price,
    quantity: row.quantity,
    fee: row.fee,
    tax: row.tax,
    amount: row.amount,
    note: row.note || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function listWatchlist(filters = {}) {
  if (filters.group) {
    return db.prepare('SELECT * FROM watchlist WHERE group_name = ? ORDER BY sort_order ASC, id DESC')
      .all(filters.group)
      .map(rowToWatchlist);
  }
  return db.prepare('SELECT * FROM watchlist ORDER BY sort_order ASC, id DESC').all().map(rowToWatchlist);
}

function addWatchlistItem(input) {
  assertCode(input.code);
  if (!input.name || !String(input.name).trim()) throw new Error('股票名称不能为空');

  const existing = db.prepare('SELECT * FROM watchlist WHERE code = ?').get(input.code);
  if (existing) throw new Error('该股票已在自选股中');

  const info = db.prepare(`
    INSERT INTO watchlist (code, name, group_name, note, alert_high, alert_low, sort_order)
    VALUES (@code, @name, @groupName, @note, @alertHigh, @alertLow, @sortOrder)
  `).run({
    code: String(input.code),
    name: String(input.name).trim(),
    groupName: input.groupName || '默认分组',
    note: input.note || '',
    alertHigh: normalizeNullableNumber(input.alertHigh),
    alertLow: normalizeNullableNumber(input.alertLow),
    sortOrder: normalizeNumber(input.sortOrder, 0)
  });

  return rowToWatchlist(db.prepare('SELECT * FROM watchlist WHERE id = ?').get(info.lastInsertRowid));
}

function updateWatchlistItem(id, input) {
  const existing = db.prepare('SELECT * FROM watchlist WHERE id = ?').get(id);
  if (!existing) throw new Error('自选股不存在');

  db.prepare(`
    UPDATE watchlist
    SET group_name = @groupName,
        note = @note,
        alert_high = @alertHigh,
        alert_low = @alertLow,
        sort_order = @sortOrder,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({
    id,
    groupName: input.groupName !== undefined ? input.groupName : existing.group_name,
    note: input.note !== undefined ? input.note : existing.note,
    alertHigh: input.alertHigh !== undefined ? normalizeNullableNumber(input.alertHigh) : existing.alert_high,
    alertLow: input.alertLow !== undefined ? normalizeNullableNumber(input.alertLow) : existing.alert_low,
    sortOrder: input.sortOrder !== undefined ? normalizeNumber(input.sortOrder, 0) : existing.sort_order
  });

  return rowToWatchlist(db.prepare('SELECT * FROM watchlist WHERE id = ?').get(id));
}

function deleteWatchlistItem(id) {
  const result = db.prepare('DELETE FROM watchlist WHERE id = ?').run(id);
  return result.changes > 0;
}

function removeWatchlistByCode(code) {
  assertCode(code);
  const result = db.prepare('DELETE FROM watchlist WHERE code = ?').run(code);
  return result.changes > 0;
}

function buildTradeWhere(filters = {}) {
  const where = [];
  const params = {};
  if (filters.code) {
    where.push('(code = @code OR name LIKE @nameLike)');
    params.code = String(filters.code);
    params.nameLike = `%${filters.code}%`;
  }
  if (filters.side) {
    where.push('side = @side');
    params.side = filters.side;
  }
  if (filters.startDate) {
    where.push('trade_date >= @startDate');
    params.startDate = filters.startDate;
  }
  if (filters.endDate) {
    where.push('trade_date <= @endDate');
    params.endDate = filters.endDate;
  }
  return { where, params };
}

function listTrades(filters = {}) {
  const { where, params } = buildTradeWhere(filters);
  const sql = `SELECT * FROM trades ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY trade_date DESC, id DESC`;
  return db.prepare(sql).all(params).map(rowToTrade);
}

function listTradesAscending(filters = {}) {
  const { where, params } = buildTradeWhere(filters);
  const sql = `SELECT * FROM trades ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY trade_date ASC, id ASC`;
  return db.prepare(sql).all(params).map(rowToTrade);
}

function normalizeTradeInput(input, existing = {}) {
  const code = input.code !== undefined ? String(input.code) : existing.code;
  const name = input.name !== undefined ? String(input.name).trim() : existing.name;
  const side = input.side !== undefined ? String(input.side) : existing.side;
  const tradeDate = input.tradeDate !== undefined ? String(input.tradeDate) : existing.tradeDate;
  const price = normalizeNumber(input.price !== undefined ? input.price : existing.price, 0);
  const quantity = Math.trunc(normalizeNumber(input.quantity !== undefined ? input.quantity : existing.quantity, 0));
  let fee = normalizeNumber(input.fee !== undefined ? input.fee : existing.fee, 0);
  const tax = normalizeNumber(input.tax !== undefined ? input.tax : existing.tax, 0);
  const note = input.note !== undefined ? String(input.note || '') : (existing.note || '');
  const explicitAmount = input.amount !== undefined && side !== 'buy' && side !== 'sell'
    ? normalizeNumber(input.amount, 0)
    : undefined;

  assertCode(code);
  if (!name) throw new Error('股票名称不能为空');
  if (!VALID_SIDES.has(side)) throw new Error('交易类型不合法');
  assertDate(tradeDate);
  if (price < 0) throw new Error('价格不能小于 0');
  if (quantity < 0) throw new Error('数量不能小于 0');
  if (fee < 0) throw new Error('手续费不能小于 0');
  if (tax < 0) throw new Error('印花税不能小于 0');
  if ((side === 'buy' || side === 'sell') && (price <= 0 || quantity <= 0)) {
    throw new Error('买入和卖出必须填写大于 0 的价格和数量');
  }
  fee = normalizeTradeFee(side, quantity, fee);

  let amount = explicitAmount;
  if (amount === undefined) {
    if (side === 'buy') amount = price * quantity + fee;
    else if (side === 'sell') amount = price * quantity - fee - tax;
    else if (side === 'dividend') amount = price * quantity;
    else amount = fee;
  }
  if (amount < 0 && side !== 'fee') throw new Error('金额不能小于 0');

  return { code, name, side, tradeDate, price, quantity, fee, tax, amount: round(amount, 4), note };
}

function normalizeStoredLotFees() {
  const rows = db.prepare(`
    SELECT id, side, price, quantity, fee, tax
    FROM trades
    WHERE side IN ('buy', 'sell')
  `).all();
  if (!rows.length) return 0;

  const update = db.prepare(`
    UPDATE trades
    SET fee = @fee,
        amount = @amount,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `);
  const run = db.transaction(function() {
    let changed = 0;
    rows.forEach(function(row) {
      const fee = normalizeTradeFee(row.side, row.quantity, row.fee);
      if (fee <= Number(row.fee || 0)) return;
      const gross = Number(row.price || 0) * Number(row.quantity || 0);
      const tax = Number(row.tax || 0);
      const amount = row.side === 'buy' ? gross + fee : gross - fee - tax;
      update.run({ id: row.id, fee: round(fee, 2), amount: round(amount, 4) });
      changed += 1;
    });
    return changed;
  });
  return run();
}

function calculatePositionStates(trades) {
  const positions = new Map();

  trades.slice().sort((a, b) => {
    const dateCompare = a.tradeDate.localeCompare(b.tradeDate);
    if (dateCompare !== 0) return dateCompare;
    return (a.id || 0) - (b.id || 0);
  }).forEach((trade) => {
    if (!positions.has(trade.code)) {
      positions.set(trade.code, {
        code: trade.code,
        name: trade.name,
        quantity: 0,
        costValue: 0,
        realizedPnl: 0,
        totalFee: 0
      });
    }
    const pos = positions.get(trade.code);
    pos.name = trade.name || pos.name;
    if (trade.side !== 'fee') pos.totalFee += Number(trade.fee || 0) + Number(trade.tax || 0);

    if (trade.side === 'buy') {
      pos.quantity += trade.quantity;
      pos.costValue += trade.price * trade.quantity + trade.fee;
    } else if (trade.side === 'sell') {
      if (trade.quantity > pos.quantity) {
        throw new Error(`${trade.code} 卖出数量超过当前持仓`);
      }
      const avgCost = pos.quantity > 0 ? pos.costValue / pos.quantity : 0;
      const sellCost = avgCost * trade.quantity;
      const income = trade.price * trade.quantity - trade.fee - trade.tax;
      pos.realizedPnl += income - sellCost;
      pos.quantity -= trade.quantity;
      pos.costValue -= sellCost;
      if (pos.quantity === 0) pos.costValue = 0;
    } else if (trade.side === 'dividend') {
      pos.realizedPnl += trade.amount || trade.price * trade.quantity;
    } else if (trade.side === 'fee') {
      pos.realizedPnl -= trade.amount || trade.fee;
      pos.totalFee += Number(trade.amount || trade.fee || 0);
    }
  });

  return Array.from(positions.values());
}

function calculatePositions(trades, quoteMap = {}) {
  const positions = calculatePositionStates(trades);

  return Array.from(positions.values())
    .filter(pos => pos.quantity > 0)
    .map(pos => {
      const quote = quoteMap[pos.code] || {};
      const currentPrice = Number.isFinite(Number(quote.price)) && Number(quote.price) > 0 ? Number(quote.price) : null;
      const marketValue = currentPrice === null ? null : currentPrice * pos.quantity;
      const grossUnrealizedPnl = marketValue === null ? null : marketValue - pos.costValue;
      const estimatedExitFee = marketValue === null ? 0 : DEFAULT_ESTIMATED_EXIT_FEE;
      const estimatedExitTax = marketValue === null ? 0 : DEFAULT_ESTIMATED_EXIT_TAX;
      const unrealizedPnl = grossUnrealizedPnl === null ? null : grossUnrealizedPnl - estimatedExitFee - estimatedExitTax;
      const netPnl = unrealizedPnl;
      const symbolTotalPnl = unrealizedPnl === null ? null : pos.realizedPnl + unrealizedPnl;
      const avgCost = pos.quantity > 0 ? pos.costValue / pos.quantity : 0;
      return {
        code: pos.code,
        name: pos.name,
        quantity: pos.quantity,
        avgCost: round(avgCost, 4),
        currentPrice: currentPrice === null ? null : round(currentPrice, 3),
        marketValue: marketValue === null ? null : round(marketValue, 2),
        costValue: round(pos.costValue, 2),
        grossUnrealizedPnl: grossUnrealizedPnl === null ? null : round(grossUnrealizedPnl, 2),
        estimatedExitFee: round(estimatedExitFee, 2),
        estimatedExitTax: round(estimatedExitTax, 2),
        totalFee: round(pos.totalFee, 2),
        unrealizedPnl: unrealizedPnl === null ? null : round(unrealizedPnl, 2),
        unrealizedPnlRate: unrealizedPnl === null || pos.costValue === 0 ? null : round(unrealizedPnl / pos.costValue * 100, 2),
        realizedPnl: round(pos.realizedPnl, 2),
        netPnl: netPnl === null ? null : round(netPnl, 2),
        netPnlRate: netPnl === null || pos.costValue === 0 ? null : round(netPnl / pos.costValue * 100, 2),
        symbolTotalPnl: symbolTotalPnl === null ? null : round(symbolTotalPnl, 2),
        symbolTotalPnlRate: symbolTotalPnl === null || pos.costValue === 0 ? null : round(symbolTotalPnl / pos.costValue * 100, 2),
        todayChange: Number.isFinite(Number(quote.change)) ? Number(quote.change) : null,
        todayPnl: marketValue === null || !Number.isFinite(Number(quote.change)) ? null : round(marketValue * Number(quote.change) / 100, 2)
      };
    });
}

function calculateClosedPositions(trades) {
  const stats = new Map();
  trades.slice().sort((a, b) => {
    const dateCompare = a.tradeDate.localeCompare(b.tradeDate);
    if (dateCompare !== 0) return dateCompare;
    return (a.id || 0) - (b.id || 0);
  }).forEach(trade => {
    if (!stats.has(trade.code)) {
      stats.set(trade.code, {
        code: trade.code,
        name: trade.name,
        firstTradeDate: trade.tradeDate,
        lastTradeDate: trade.tradeDate,
        tradeCount: 0
      });
    }
    const item = stats.get(trade.code);
    item.name = trade.name || item.name;
    item.firstTradeDate = item.firstTradeDate < trade.tradeDate ? item.firstTradeDate : trade.tradeDate;
    item.lastTradeDate = item.lastTradeDate > trade.tradeDate ? item.lastTradeDate : trade.tradeDate;
    item.tradeCount += 1;
  });

  return calculatePositionStates(trades)
    .filter(pos => pos.quantity === 0 && stats.has(pos.code))
    .map(pos => {
      const item = stats.get(pos.code);
      return {
        code: pos.code,
        name: pos.name || item.name,
        realizedPnl: round(pos.realizedPnl, 2),
        totalFee: round(pos.totalFee, 2),
        tradeCount: item.tradeCount,
        firstTradeDate: item.firstTradeDate,
        lastTradeDate: item.lastTradeDate
      };
    })
    .sort((a, b) => b.lastTradeDate.localeCompare(a.lastTradeDate) || a.code.localeCompare(b.code));
}

function validateTradeSet(candidateTrades) {
  calculatePositions(candidateTrades);
}

function createTrade(input) {
  const payload = normalizeTradeInput(input);
  const candidateTrades = listTradesAscending().concat([{ ...payload, id: Number.MAX_SAFE_INTEGER }]);
  validateTradeSet(candidateTrades);

  const info = db.prepare(`
    INSERT INTO trades (code, name, side, trade_date, price, quantity, fee, tax, amount, note)
    VALUES (@code, @name, @side, @tradeDate, @price, @quantity, @fee, @tax, @amount, @note)
  `).run(payload);

  return rowToTrade(db.prepare('SELECT * FROM trades WHERE id = ?').get(info.lastInsertRowid));
}

function updateTrade(id, input) {
  const existingRow = db.prepare('SELECT * FROM trades WHERE id = ?').get(id);
  if (!existingRow) throw new Error('交易记录不存在');
  const existing = rowToTrade(existingRow);
  const payload = normalizeTradeInput(input, existing);

  const candidateTrades = listTradesAscending().map(trade => trade.id === Number(id) ? { ...payload, id: Number(id) } : trade);
  validateTradeSet(candidateTrades);

  db.prepare(`
    UPDATE trades
    SET code = @code,
        name = @name,
        side = @side,
        trade_date = @tradeDate,
        price = @price,
        quantity = @quantity,
        fee = @fee,
        tax = @tax,
        amount = @amount,
        note = @note,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({ id, ...payload });

  return rowToTrade(db.prepare('SELECT * FROM trades WHERE id = ?').get(id));
}

function deleteTrade(id) {
  const result = db.prepare('DELETE FROM trades WHERE id = ?').run(id);
  return result.changes > 0;
}

function getPositions(quoteMap = {}) {
  return calculatePositions(listTradesAscending(), quoteMap);
}

function getClosedPositions() {
  return calculateClosedPositions(listTradesAscending());
}

function getSummary(positions = getPositions()) {
  const totalMarketValue = positions.reduce((sum, pos) => sum + (pos.marketValue === null ? pos.costValue : pos.marketValue), 0);
  const totalCost = positions.reduce((sum, pos) => sum + pos.costValue, 0);
  const unrealizedPnl = positions.reduce((sum, pos) => sum + (pos.unrealizedPnl || 0), 0);
  const realizedPnl = calculatePositionStates(listTradesAscending()).reduce((sum, pos) => sum + pos.realizedPnl, 0);
  const totalPnl = realizedPnl + unrealizedPnl;

  return {
    totalMarketValue: round(totalMarketValue, 2),
    totalCost: round(totalCost, 2),
    unrealizedPnl: round(unrealizedPnl, 2),
    realizedPnl: round(realizedPnl, 2),
    totalPnl: round(totalPnl, 2),
    totalPnlRate: totalCost > 0 ? round(totalPnl / totalCost * 100, 2) : 0,
    positionCount: positions.length,
    winCount: positions.filter(pos => (pos.unrealizedPnl || 0) > 0).length,
    lossCount: positions.filter(pos => (pos.unrealizedPnl || 0) < 0).length
  };
}

function getAllocation(positions = getPositions()) {
  const total = positions.reduce((sum, pos) => sum + (pos.marketValue === null ? pos.costValue : pos.marketValue), 0);
  return positions.map(pos => {
    const marketValue = pos.marketValue === null ? pos.costValue : pos.marketValue;
    return {
      code: pos.code,
      name: pos.name,
      marketValue: round(marketValue, 2),
      ratio: total > 0 ? round(marketValue / total * 100, 2) : 0
    };
  });
}

normalizeStoredLotFees();

module.exports = {
  VALID_SIDES,
  lotBasedTradeFee,
  normalizeTradeFee,
  normalizeStoredLotFees,
  listWatchlist,
  addWatchlistItem,
  updateWatchlistItem,
  deleteWatchlistItem,
  removeWatchlistByCode,
  listTrades,
  listTradesAscending,
  createTrade,
  updateTrade,
  deleteTrade,
  calculatePositionStates,
  calculatePositions,
  calculateClosedPositions,
  getPositions,
  getClosedPositions,
  getSummary,
  getAllocation
};
