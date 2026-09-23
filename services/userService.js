const db = require('../db');

function assertCode(code) {
  if (!/^\d{6}$/.test(String(code || ''))) {
    throw new Error('股票代码必须是 6 位数字');
  }
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function beijingNowSql() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(new Date()).reduce(function(acc, item) {
    if (item.type !== 'literal') acc[item.type] = item.value;
    return acc;
  }, {});
  return parts.year + '-' + parts.month + '-' + parts.day + ' ' + parts.hour + ':' + parts.minute + ':' + parts.second;
}

function rowToRecent(row) {
  return {
    code: row.code,
    name: row.name,
    lastViewedAt: row.last_viewed_at,
    viewCount: row.view_count,
    lastPrice: row.last_price,
    lastChange: row.last_change,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function listRecentStocks(limit = 20) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  return db.prepare('SELECT * FROM recent_stocks ORDER BY datetime(last_viewed_at) DESC LIMIT ?')
    .all(safeLimit)
    .map(rowToRecent);
}

function upsertRecentStock(input) {
  assertCode(input.code);
  const name = String(input.name || input.code).trim();
  if (!name) throw new Error('股票名称不能为空');

  const payload = {
    code: String(input.code),
    name,
    lastPrice: numberOrNull(input.lastPrice !== undefined ? input.lastPrice : input.price),
    lastChange: numberOrNull(input.lastChange !== undefined ? input.lastChange : input.change),
    now: beijingNowSql()
  };

  db.prepare(`
    INSERT INTO recent_stocks (code, name, last_viewed_at, last_price, last_change)
    VALUES (@code, @name, @now, @lastPrice, @lastChange)
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name,
      last_viewed_at = @now,
      view_count = recent_stocks.view_count + 1,
      last_price = COALESCE(excluded.last_price, recent_stocks.last_price),
      last_change = COALESCE(excluded.last_change, recent_stocks.last_change),
      updated_at = @now
  `).run(payload);

  return rowToRecent(db.prepare('SELECT * FROM recent_stocks WHERE code = ?').get(payload.code));
}

function deleteRecentStock(code) {
  assertCode(code);
  return db.prepare('DELETE FROM recent_stocks WHERE code = ?').run(String(code)).changes > 0;
}

function clearRecentStocks() {
  return db.prepare('DELETE FROM recent_stocks').run().changes;
}

module.exports = {
  listRecentStocks,
  upsertRecentStock,
  deleteRecentStock,
  clearRecentStocks
};
