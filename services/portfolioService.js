const db = require('../db');

const VALID_SIDES = new Set(['buy', 'sell', 'dividend', 'fee']);
const DEFAULT_ESTIMATED_EXIT_FEE = 0;
const DEFAULT_ESTIMATED_EXIT_TAX = 0;

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

function beijingDateString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
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
    accountId: row.account_id,
    sourceType: row.source_type || 'manual',
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
  const accountId = normalizeAccountId(filters.accountId);
  getAccount(accountId);
  const where = ['account_id = @accountId'];
  const params = { accountId };
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
  const accountId = normalizeAccountId(input.accountId !== undefined ? input.accountId : existing.accountId);
  getAccount(accountId);
  const sourceType = String(input.sourceType !== undefined ? input.sourceType : (existing.sourceType || 'manual')).trim() || 'manual';
  const code = input.code !== undefined ? String(input.code) : existing.code;
  const name = input.name !== undefined ? String(input.name).trim() : existing.name;
  const side = input.side !== undefined ? String(input.side) : existing.side;
  const tradeDate = input.tradeDate !== undefined ? String(input.tradeDate) : existing.tradeDate;
  const price = normalizeNumber(input.price !== undefined ? input.price : existing.price, 0);
  const quantity = Math.trunc(normalizeNumber(input.quantity !== undefined ? input.quantity : existing.quantity, 0));
  const fee = normalizeNumber(input.fee !== undefined ? input.fee : existing.fee, 0);
  const tax = normalizeNumber(input.tax !== undefined ? input.tax : existing.tax, 0);
  const note = input.note !== undefined ? String(input.note || '') : (existing.note || '');
  const explicitAmount = input.amount !== undefined ? normalizeNumber(input.amount, 0) : undefined;

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

  let amount = explicitAmount;
  if (amount === undefined) {
    if (side === 'buy') amount = price * quantity + fee;
    else if (side === 'sell') amount = price * quantity - fee - tax;
    else if (side === 'dividend') amount = price * quantity;
    else amount = fee;
  }
  if (amount < 0 && side !== 'fee') throw new Error('金额不能小于 0');

  return { accountId, sourceType, code, name, side, tradeDate, price, quantity, fee, tax, amount: round(amount, 4), note };
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
        totalFee: 0,
        investedCapital: 0
      });
    }
    const pos = positions.get(trade.code);
    pos.name = trade.name || pos.name;
    if (trade.side !== 'fee') pos.totalFee += Number(trade.fee || 0) + Number(trade.tax || 0);

    if (trade.side === 'buy') {
      pos.quantity += trade.quantity;
      pos.costValue += trade.price * trade.quantity + trade.fee;
      pos.investedCapital += Number(trade.amount || (trade.price * trade.quantity + trade.fee));
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

function calculateTodayPnl(trades, code, quote, currentPrice) {
  if (currentPrice === null) return { value: null, date: null };

  const quoteDate = String(quote.tradeDate || quote.quoteDate || beijingDateString());
  const previousClose = Number.isFinite(Number(quote.prevClose)) && Number(quote.prevClose) > 0
    ? Number(quote.prevClose)
    : null;
  let startQuantity = 0;
  let endQuantity = 0;
  let dayCashFlow = 0;

  trades.forEach(function(trade) {
    if (trade.code !== code || trade.tradeDate > quoteDate) return;
    if (trade.tradeDate < quoteDate || trade.sourceType === 'holding_snapshot') {
      if (trade.side === 'buy') startQuantity += trade.quantity;
      else if (trade.side === 'sell') startQuantity -= trade.quantity;
      return;
    }

    const amount = Number(trade.amount || 0);
    if (trade.side === 'buy') dayCashFlow -= amount;
    else if (trade.side === 'sell' || trade.side === 'dividend') dayCashFlow += amount;
    else if (trade.side === 'fee') dayCashFlow -= amount || Number(trade.fee || 0);
  });

  endQuantity = startQuantity;
  trades.forEach(function(trade) {
    if (trade.code !== code || trade.tradeDate !== quoteDate || trade.sourceType === 'holding_snapshot') return;
    if (trade.side === 'buy') endQuantity += trade.quantity;
    else if (trade.side === 'sell') endQuantity -= trade.quantity;
  });

  if (startQuantity > 0 && previousClose === null) return { value: null, date: quoteDate };
  const startMarketValue = startQuantity * (previousClose || 0);
  const endMarketValue = endQuantity * currentPrice;
  return {
    value: round(endMarketValue + dayCashFlow - startMarketValue, 2),
    date: quoteDate
  };
}

function rowToAccount(row) {
  return {
    id: row.id,
    accountKey: row.account_key,
    name: row.name,
    broker: row.broker || '',
    maskedNumber: row.masked_number || '',
    cashBalance: round(row.cash_balance, 2),
    isDefault: row.is_default === 1,
    enabled: row.enabled === 1,
    note: row.note || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeAccountId(value) {
  const id = Number(value || 1);
  if (!Number.isInteger(id) || id <= 0) throw new Error('账户编号不合法');
  return id;
}

function getAccount(id = 1) {
  const row = db.prepare('SELECT * FROM portfolio_accounts WHERE id = ? AND enabled = 1').get(normalizeAccountId(id));
  if (!row) throw new Error('持仓账户不存在');
  return rowToAccount(row);
}

function listAccounts() {
  return db.prepare('SELECT * FROM portfolio_accounts WHERE enabled = 1 ORDER BY is_default DESC, id ASC')
    .all()
    .map(rowToAccount);
}

function createAccount(input = {}) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('账户名称不能为空');
  const broker = String(input.broker || '').trim();
  const maskedNumber = String(input.maskedNumber || '').trim();
  const cashBalance = normalizeNumber(input.cashBalance, 0);
  if (cashBalance < 0) throw new Error('可用资金不能小于 0');
  const accountKey = String(input.accountKey || ('account-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8))).trim();
  const info = db.prepare(`
    INSERT INTO portfolio_accounts (account_key, name, broker, masked_number, cash_balance, note)
    VALUES (@accountKey, @name, @broker, @maskedNumber, @cashBalance, @note)
  `).run({
    accountKey,
    name,
    broker,
    maskedNumber,
    cashBalance: round(cashBalance, 2),
    note: String(input.note || '').trim()
  });
  return getAccount(info.lastInsertRowid);
}

function updateAccount(id, input = {}) {
  const existing = getAccount(id);
  const name = input.name === undefined ? existing.name : String(input.name || '').trim();
  const cashBalance = input.cashBalance === undefined ? existing.cashBalance : normalizeNumber(input.cashBalance, 0);
  if (!name) throw new Error('账户名称不能为空');
  if (cashBalance < 0) throw new Error('可用资金不能小于 0');
  db.prepare(`
    UPDATE portfolio_accounts
    SET name = @name, broker = @broker, masked_number = @maskedNumber,
        cash_balance = @cashBalance, note = @note, updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({
    id: existing.id,
    name,
    broker: input.broker === undefined ? existing.broker : String(input.broker || '').trim(),
    maskedNumber: input.maskedNumber === undefined ? existing.maskedNumber : String(input.maskedNumber || '').trim(),
    cashBalance: round(cashBalance, 2),
    note: input.note === undefined ? existing.note : String(input.note || '').trim()
  });
  return getAccount(existing.id);
}

function deleteAccount(id) {
  const account = getAccount(id);
  if (account.isDefault) throw new Error('默认账户不能删除');
  const tradeCount = db.prepare('SELECT COUNT(*) AS count FROM trades WHERE account_id = ?').get(account.id).count;
  if (tradeCount > 0) throw new Error('账户已有交易或持仓，不能直接删除');
  return db.prepare('UPDATE portfolio_accounts SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(account.id).changes > 0;
}

function calculatePositions(trades, quoteMap = {}) {
  const positions = calculatePositionStates(trades);

  return Array.from(positions.values())
    .filter(pos => pos.quantity > 0)
    .map(pos => {
      const quote = quoteMap[pos.code] || {};
      const currentPrice = Number.isFinite(Number(quote.price)) && Number(quote.price) > 0 ? Number(quote.price) : null;
      const previousClose = Number.isFinite(Number(quote.prevClose)) && Number(quote.prevClose) > 0 ? Number(quote.prevClose) : null;
      const marketValue = currentPrice === null ? null : currentPrice * pos.quantity;
      const grossUnrealizedPnl = marketValue === null ? null : marketValue - pos.costValue;
      const estimatedExitFee = marketValue === null ? 0 : DEFAULT_ESTIMATED_EXIT_FEE;
      const estimatedExitTax = marketValue === null ? 0 : DEFAULT_ESTIMATED_EXIT_TAX;
      const unrealizedPnl = grossUnrealizedPnl === null ? null : grossUnrealizedPnl - estimatedExitFee - estimatedExitTax;
      const netPnl = unrealizedPnl;
      const symbolTotalPnl = unrealizedPnl === null ? null : pos.realizedPnl + unrealizedPnl;
      const todayResult = calculateTodayPnl(trades, pos.code, quote, currentPrice);
      const todayPnl = todayResult.value;
      const avgCost = pos.quantity > 0 ? pos.costValue / pos.quantity : 0;
      return {
        code: pos.code,
        name: pos.name,
        quantity: pos.quantity,
        avgCost: round(avgCost, 4),
        currentPrice: currentPrice === null ? null : round(currentPrice, 3),
        price: currentPrice === null ? null : round(currentPrice, 3),
        open: Number.isFinite(Number(quote.open)) ? round(quote.open, 3) : null,
        high: Number.isFinite(Number(quote.high)) ? round(quote.high, 3) : null,
        low: Number.isFinite(Number(quote.low)) ? round(quote.low, 3) : null,
        prevClose: previousClose === null ? null : round(previousClose, 3),
        change: Number.isFinite(Number(quote.change)) ? Number(quote.change) : null,
        marketValue: marketValue === null ? null : round(marketValue, 2),
        costValue: round(pos.costValue, 2),
        grossUnrealizedPnl: grossUnrealizedPnl === null ? null : round(grossUnrealizedPnl, 2),
        estimatedExitFee: round(estimatedExitFee, 2),
        estimatedExitTax: round(estimatedExitTax, 2),
        totalFee: round(pos.totalFee, 2),
        investedCapital: round(pos.investedCapital, 2),
        unrealizedPnl: unrealizedPnl === null ? null : round(unrealizedPnl, 2),
        unrealizedPnlRate: unrealizedPnl === null || pos.costValue === 0 ? null : round(unrealizedPnl / pos.costValue * 100, 2),
        realizedPnl: round(pos.realizedPnl, 2),
        netPnl: netPnl === null ? null : round(netPnl, 2),
        netPnlRate: netPnl === null || pos.costValue === 0 ? null : round(netPnl / pos.costValue * 100, 2),
        symbolTotalPnl: symbolTotalPnl === null ? null : round(symbolTotalPnl, 2),
        symbolTotalPnlRate: symbolTotalPnl === null || pos.investedCapital === 0 ? null : round(symbolTotalPnl / pos.investedCapital * 100, 2),
        todayChange: Number.isFinite(Number(quote.change)) ? Number(quote.change) : null,
        todayReferencePnl: todayPnl,
        todayPnl,
        todayPnlDate: todayResult.date,
        todayPnlMethod: 'transaction-adjusted',
        quoteDate: String(quote.tradeDate || quote.quoteDate || ''),
        quoteTime: String(quote.tradeTime || quote.quoteTime || ''),
        quoteStatus: quote.quoteStatus || (currentPrice === null ? 'unavailable' : 'live')
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
  const candidateTrades = listTradesAscending({ accountId: payload.accountId }).concat([{ ...payload, id: Number.MAX_SAFE_INTEGER }]);
  validateTradeSet(candidateTrades);

  const info = db.prepare(`
    INSERT INTO trades (account_id, source_type, code, name, side, trade_date, price, quantity, fee, tax, amount, note)
    VALUES (@accountId, @sourceType, @code, @name, @side, @tradeDate, @price, @quantity, @fee, @tax, @amount, @note)
  `).run(payload);

  return rowToTrade(db.prepare('SELECT * FROM trades WHERE id = ?').get(info.lastInsertRowid));
}

function updateTrade(id, input) {
  const existingRow = db.prepare('SELECT * FROM trades WHERE id = ?').get(id);
  if (!existingRow) throw new Error('交易记录不存在');
  const existing = rowToTrade(existingRow);
  const payload = normalizeTradeInput(input, existing);
  if (payload.accountId !== existing.accountId) throw new Error('交易记录不能跨账户移动');

  const candidateTrades = listTradesAscending({ accountId: existing.accountId })
    .map(trade => trade.id === Number(id) ? { ...payload, id: Number(id) } : trade);
  validateTradeSet(candidateTrades);

  db.prepare(`
    UPDATE trades
    SET account_id = @accountId,
        source_type = @sourceType,
        code = @code,
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
  const existing = db.prepare('SELECT * FROM trades WHERE id = ?').get(id);
  if (!existing) return false;

  const existingTrade = rowToTrade(existing);
  const candidateTrades = listTradesAscending({ accountId: existingTrade.accountId }).filter(trade => trade.id !== Number(id));
  validateTradeSet(candidateTrades);
  const result = db.prepare('DELETE FROM trades WHERE id = ?').run(id);
  return result.changes > 0;
}

function getPositions(quoteMap = {}, filters = {}) {
  return calculatePositions(listTradesAscending(filters), quoteMap);
}

function getClosedPositions(filters = {}) {
  return calculateClosedPositions(listTradesAscending(filters));
}

function getSummary(positions, filters = {}) {
  const accountId = normalizeAccountId(filters.accountId);
  const account = getAccount(accountId);
  const resolvedPositions = positions || getPositions({}, { accountId });
  const trades = listTradesAscending({ accountId });
  const totalMarketValue = resolvedPositions.reduce((sum, pos) => sum + (pos.marketValue === null ? pos.costValue : pos.marketValue), 0);
  const totalCost = resolvedPositions.reduce((sum, pos) => sum + pos.costValue, 0);
  const unrealizedPnl = resolvedPositions.reduce((sum, pos) => sum + (pos.unrealizedPnl || 0), 0);
  const todayPnl = resolvedPositions.reduce((sum, pos) => {
    const value = pos.todayPnl !== undefined && pos.todayPnl !== null ? pos.todayPnl : pos.todayReferencePnl;
    return sum + (value || 0);
  }, 0);
  const realizedPnl = calculatePositionStates(trades).reduce((sum, pos) => sum + pos.realizedPnl, 0);
  const totalPnl = realizedPnl + unrealizedPnl;
  const lifetimeBuyCost = trades.reduce((sum, trade) => trade.side === 'buy' ? sum + Number(trade.amount || 0) : sum, 0);

  return {
    accountId,
    accountName: account.name,
    cashBalance: round(account.cashBalance, 2),
    totalAssets: round(totalMarketValue + account.cashBalance, 2),
    totalMarketValue: round(totalMarketValue, 2),
    totalCost: round(totalCost, 2),
    unrealizedPnl: round(unrealizedPnl, 2),
    todayReferencePnl: round(todayPnl, 2),
    todayPnl: round(todayPnl, 2),
    realizedPnl: round(realizedPnl, 2),
    totalPnl: round(totalPnl, 2),
    lifetimeBuyCost: round(lifetimeBuyCost, 2),
    totalPnlRate: lifetimeBuyCost > 0 ? round(totalPnl / lifetimeBuyCost * 100, 2) : 0,
    positionCount: resolvedPositions.length,
    winCount: resolvedPositions.filter(pos => (pos.unrealizedPnl || 0) > 0).length,
    lossCount: resolvedPositions.filter(pos => (pos.unrealizedPnl || 0) < 0).length
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

function rowToPortfolioSnapshot(row) {
  let holdings = [];
  try { holdings = JSON.parse(row.holdings_json || '[]'); } catch (error) {}
  return {
    id: row.id,
    accountId: row.account_id,
    snapshotDate: row.snapshot_date,
    totalMarketValue: round(row.total_market_value, 2),
    cashBalance: round(row.cash_balance, 2),
    totalAssets: round(row.total_assets, 2),
    totalCost: round(row.total_cost, 2),
    unrealizedPnl: round(row.unrealized_pnl, 2),
    realizedPnl: round(row.realized_pnl, 2),
    totalPnl: round(row.total_pnl, 2),
    todayPnl: round(row.today_pnl, 2),
    sourceLabel: row.source_label || '',
    holdings,
    createdAt: row.created_at
  };
}

function getLatestSnapshot(accountId = 1) {
  const id = normalizeAccountId(accountId);
  getAccount(id);
  const row = db.prepare(`
    SELECT * FROM portfolio_snapshots
    WHERE account_id = ?
    ORDER BY snapshot_date DESC, id DESC
    LIMIT 1
  `).get(id);
  return row ? rowToPortfolioSnapshot(row) : null;
}

function importHoldingSnapshot(accountId, input = {}, options = {}) {
  const id = normalizeAccountId(accountId);
  getAccount(id);
  assertDate(input.snapshotDate);
  const holdings = Array.isArray(input.holdings) ? input.holdings : [];
  if (!holdings.length) throw new Error('截图持仓不能为空');
  const seenCodes = new Set();
  const normalizedHoldings = holdings.map(function(holding) {
    const code = String(holding.code || '');
    const name = String(holding.name || '').trim();
    const quantity = Math.trunc(normalizeNumber(holding.quantity, 0));
    const costValue = normalizeNumber(holding.costValue, 0);
    const currentPrice = normalizeNumber(holding.currentPrice, 0);
    assertCode(code);
    if (!name) throw new Error(code + ' 股票名称不能为空');
    if (quantity <= 0 || costValue <= 0) throw new Error(code + ' 的数量和持仓成本必须大于 0');
    if (seenCodes.has(code)) throw new Error(code + ' 在截图持仓中重复');
    seenCodes.add(code);
    return {
      code,
      name,
      quantity,
      costValue: round(costValue, 4),
      avgCost: round(costValue / quantity, 6),
      currentPrice: currentPrice > 0 ? round(currentPrice, 3) : null,
      marketValue: currentPrice > 0 ? round(currentPrice * quantity, 2) : null,
      pnl: holding.pnl === undefined || holding.pnl === null ? null : round(holding.pnl, 2),
      pnlRate: holding.pnlRate === undefined || holding.pnlRate === null ? null : round(holding.pnlRate, 3)
    };
  });
  const cashBalance = normalizeNumber(input.cashBalance, 0);
  const totalCost = round(normalizedHoldings.reduce((sum, item) => sum + item.costValue, 0), 2);
  const calculatedMarketValue = round(normalizedHoldings.reduce((sum, item) => sum + (item.marketValue || 0), 0), 2);
  const totalMarketValue = input.totalMarketValue === undefined
    ? calculatedMarketValue : round(input.totalMarketValue, 2);
  const totalAssets = input.totalAssets === undefined
    ? round(totalMarketValue + cashBalance, 2) : round(input.totalAssets, 2);
  if (calculatedMarketValue > 0 && Math.abs(totalMarketValue - calculatedMarketValue) > 0.05) {
    throw new Error('截图持仓市值合计与账户总市值不一致');
  }
  if (Math.abs(totalAssets - totalMarketValue - cashBalance) > 0.05) {
    throw new Error('截图总资产与总市值、可用资金不一致');
  }

  const transaction = db.transaction(function() {
    const existingCount = db.prepare('SELECT COUNT(*) AS count FROM trades WHERE account_id = ?').get(id).count;
    if (existingCount > 0) {
      if (!options.replaceSnapshotBaseline) throw new Error('目标账户已有交易，不能重复导入持仓基线');
      const manualCount = db.prepare(`
        SELECT COUNT(*) AS count FROM trades
        WHERE account_id = ? AND source_type <> 'holding_snapshot'
      `).get(id).count;
      if (manualCount > 0) throw new Error('目标账户包含手工交易，不能替换截图持仓基线');
      db.prepare("DELETE FROM trades WHERE account_id = ? AND source_type = 'holding_snapshot'").run(id);
    }
    updateAccount(id, { cashBalance });
    normalizedHoldings.forEach(function(holding) {
      createTrade({
        accountId: id,
        sourceType: 'holding_snapshot',
        code: holding.code,
        name: holding.name,
        side: 'buy',
        tradeDate: input.snapshotDate,
        price: holding.costValue / holding.quantity,
        quantity: holding.quantity,
        fee: 0,
        tax: 0,
        amount: holding.costValue,
        note: '截图持仓基线导入；成本价采用券商口径，历史手续费不重复计算。'
      });
    });
    const totalPnl = input.totalPnl === undefined ? round(totalMarketValue - totalCost, 2) : round(input.totalPnl, 2);
    const info = db.prepare(`
      INSERT INTO portfolio_snapshots (
        account_id, snapshot_date, total_market_value, cash_balance, total_assets,
        total_cost, unrealized_pnl, realized_pnl, total_pnl, today_pnl, source_label, holdings_json
      ) VALUES (
        @accountId, @snapshotDate, @totalMarketValue, @cashBalance, @totalAssets,
        @totalCost, @totalPnl, 0, @totalPnl, @todayPnl, @sourceLabel, @holdingsJson
      )
    `).run({
      accountId: id,
      snapshotDate: input.snapshotDate,
      totalMarketValue,
      cashBalance: round(cashBalance, 2),
      totalAssets,
      totalCost,
      totalPnl,
      todayPnl: round(input.todayPnl, 2),
      sourceLabel: String(input.sourceLabel || '持仓截图导入').trim(),
      holdingsJson: JSON.stringify(normalizedHoldings)
    });
    return info.lastInsertRowid;
  });

  const snapshotId = transaction();
  const snapshot = rowToPortfolioSnapshot(db.prepare('SELECT * FROM portfolio_snapshots WHERE id = ?').get(snapshotId));
  return { account: getAccount(id), snapshot, importedCount: normalizedHoldings.length };
}

function syncHoldingSnapshot(accountId, input = {}) {
  return importHoldingSnapshot(accountId, input, { replaceSnapshotBaseline: true });
}

module.exports = {
  VALID_SIDES,
  listAccounts,
  getAccount,
  createAccount,
  updateAccount,
  deleteAccount,
  getLatestSnapshot,
  importHoldingSnapshot,
  syncHoldingSnapshot,
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
