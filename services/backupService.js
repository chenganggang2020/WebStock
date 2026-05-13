const db = require('../db');

const BACKUP_VERSION = 1;
const MAX_ITEMS_PER_TABLE = 5000;

function text(value, fallback = '', maxLength = 2000) {
  const next = String(value == null ? fallback : value).trim();
  return next.slice(0, maxLength);
}

function code(value) {
  const next = String(value == null ? '' : value).trim();
  if (!/^\d{6}$/.test(next)) throw new Error('Invalid stock code in backup');
  return next;
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function numberOrZero(value) {
  const next = numberOrNull(value);
  return next == null ? 0 : next;
}

function integerOrZero(value) {
  const next = Number(value);
  return Number.isFinite(next) ? Math.trunc(next) : 0;
}

function arrayFromBackup(backup, key) {
  const tables = backup && backup.tables ? backup.tables : backup;
  const items = tables && Array.isArray(tables[key]) ? tables[key] : [];
  if (items.length > MAX_ITEMS_PER_TABLE) {
    throw new Error(key + ' exceeds import limit');
  }
  return items;
}

function exportUserData() {
  const recentStocks = db.prepare(`
    SELECT code, name, last_viewed_at AS lastViewedAt, view_count AS viewCount,
      last_price AS lastPrice, last_change AS lastChange
    FROM recent_stocks
    ORDER BY datetime(last_viewed_at) DESC
  `).all();

  const watchlist = db.prepare(`
    SELECT code, name, group_name AS groupName, note, alert_high AS alertHigh,
      alert_low AS alertLow, sort_order AS sortOrder
    FROM watchlist
    ORDER BY sort_order ASC, updated_at DESC
  `).all();

  const trades = db.prepare(`
    SELECT code, name, side, trade_date AS tradeDate, price, quantity, fee, tax, amount, note
    FROM trades
    ORDER BY trade_date DESC, id DESC
  `).all();

  const sectors = db.prepare(`
    SELECT id, name, description, sort_order AS sortOrder
    FROM sectors
    ORDER BY sort_order ASC, id ASC
  `).all();

  const sectorLeaders = db.prepare(`
    SELECT sector_id AS sectorId, code, name, role, reason, weight, note
    FROM sector_leaders
    ORDER BY sector_id ASC, weight DESC, id ASC
  `).all();

  const sectorLeaderSnapshots = db.prepare(`
    SELECT leader_id AS leaderId, sector_id AS sectorId, sector_name AS sectorName,
      code, name, price, change, amount, captured_at AS capturedAt
    FROM sector_leader_snapshots
    ORDER BY datetime(captured_at) DESC, id DESC
  `).all();

  const screenerResults = db.prepare(`
    SELECT id, task_name AS taskName, strategy, demand, result_json AS resultJson, ai_result AS aiResult
    FROM ai_screener_results
    ORDER BY datetime(created_at) DESC, id DESC
  `).all().map(item => {
    let result = null;
    try {
      result = JSON.parse(item.resultJson || '{}');
    } catch (error) {
      result = null;
    }
    return {
      id: item.id,
      taskName: item.taskName,
      strategy: item.strategy,
      demand: item.demand,
      result,
      aiResult: item.aiResult || ''
    };
  });

  const screenerCandidateNotes = db.prepare(`
    SELECT result_id AS resultId, code, status, note
    FROM screener_candidate_notes
    ORDER BY result_id ASC, code ASC
  `).all();

  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    tables: { recentStocks, watchlist, trades, sectors, sectorLeaders, sectorLeaderSnapshots, screenerResults, screenerCandidateNotes }
  };
}

function normalizeRecent(item) {
  return {
    code: code(item.code),
    name: text(item.name || item.code, item.code, 80),
    lastViewedAt: text(item.lastViewedAt, new Date().toISOString(), 40),
    viewCount: Math.max(integerOrZero(item.viewCount), 1),
    lastPrice: numberOrNull(item.lastPrice),
    lastChange: numberOrNull(item.lastChange)
  };
}

function normalizeWatchlist(item) {
  return {
    code: code(item.code),
    name: text(item.name || item.code, item.code, 80),
    groupName: text(item.groupName, 'Default', 80),
    note: text(item.note, '', 1000),
    alertHigh: numberOrNull(item.alertHigh),
    alertLow: numberOrNull(item.alertLow),
    sortOrder: integerOrZero(item.sortOrder)
  };
}

function normalizeTrade(item) {
  const side = text(item.side, '', 20);
  if (!['buy', 'sell', 'dividend', 'fee'].includes(side)) throw new Error('Invalid trade side in backup');
  const price = numberOrZero(item.price);
  const quantity = Math.max(integerOrZero(item.quantity), 0);
  const fee = Math.max(numberOrZero(item.fee), 0);
  const tax = Math.max(numberOrZero(item.tax), 0);
  const fallbackAmount = side === 'buy' ? price * quantity + fee + tax
    : side === 'sell' ? price * quantity - fee - tax
      : numberOrZero(item.amount);

  return {
    code: code(item.code),
    name: text(item.name || item.code, item.code, 80),
    side,
    tradeDate: text(item.tradeDate, new Date().toISOString().slice(0, 10), 20),
    price,
    quantity,
    fee,
    tax,
    amount: item.amount === undefined || item.amount === null || item.amount === '' ? fallbackAmount : numberOrZero(item.amount),
    note: text(item.note, '', 1000)
  };
}

function normalizeSector(item) {
  return {
    oldId: integerOrZero(item.id),
    name: text(item.name, '', 80),
    description: text(item.description, '', 1000),
    sortOrder: integerOrZero(item.sortOrder)
  };
}

function normalizeLeader(item) {
  return {
    oldSectorId: integerOrZero(item.sectorId),
    code: code(item.code),
    name: text(item.name || item.code, item.code, 80),
    role: text(item.role, 'Observation', 80),
    reason: text(item.reason, '', 1000),
    weight: numberOrZero(item.weight) || 1,
    note: text(item.note, '', 1000)
  };
}

function normalizeLeaderSnapshot(item) {
  return {
    leaderId: integerOrZero(item.leaderId) || null,
    sectorId: integerOrZero(item.sectorId) || null,
    sectorName: text(item.sectorName, '', 120),
    code: code(item.code),
    name: text(item.name || item.code, item.code, 80),
    price: numberOrNull(item.price),
    change: numberOrNull(item.change),
    amount: numberOrNull(item.amount),
    capturedAt: text(item.capturedAt, new Date().toISOString(), 40)
  };
}

function normalizeScreenerResult(item) {
  const result = item.result || {};
  if (!result || !Array.isArray(result.candidates)) throw new Error('Invalid screener result in backup');
  return {
    oldId: integerOrZero(item.id),
    taskName: text(item.taskName || result.demand || result.strategy || 'Screener task', 'Screener task', 120),
    strategy: text(item.strategy || result.strategy || 'stable', 'stable', 80),
    demand: text(item.demand || result.demand || '', '', 1000),
    resultJson: JSON.stringify(result),
    aiResult: text(item.aiResult, '', 20000)
  };
}

function normalizeScreenerCandidateNote(item) {
  const status = text(item.status, 'watch', 20).toLowerCase();
  return {
    oldResultId: integerOrZero(item.resultId),
    code: code(item.code),
    status: ['watch', 'priority', 'risk', 'skip', 'done'].includes(status) ? status : 'watch',
    note: text(item.note, '', 2000)
  };
}

function prepareImport(backup) {
  if (!backup || typeof backup !== 'object') throw new Error('Backup JSON is required');
  const recentStocks = arrayFromBackup(backup, 'recentStocks').map(normalizeRecent);
  const watchlist = arrayFromBackup(backup, 'watchlist').map(normalizeWatchlist);
  const trades = arrayFromBackup(backup, 'trades').map(normalizeTrade);
  const sectors = arrayFromBackup(backup, 'sectors').map(normalizeSector).filter(item => item.name);
  const sectorLeaders = arrayFromBackup(backup, 'sectorLeaders').map(normalizeLeader);
  const sectorLeaderSnapshots = arrayFromBackup(backup, 'sectorLeaderSnapshots').map(normalizeLeaderSnapshot);
  const screenerResults = arrayFromBackup(backup, 'screenerResults').map(normalizeScreenerResult);
  const screenerCandidateNotes = arrayFromBackup(backup, 'screenerCandidateNotes').map(normalizeScreenerCandidateNote);
  return { recentStocks, watchlist, trades, sectors, sectorLeaders, sectorLeaderSnapshots, screenerResults, screenerCandidateNotes };
}

function countsForPrepared(prepared) {
  return {
    recentStocks: prepared.recentStocks.length,
    watchlist: prepared.watchlist.length,
    trades: prepared.trades.length,
    sectors: prepared.sectors.length,
    sectorLeaders: prepared.sectorLeaders.length,
    sectorLeaderSnapshots: prepared.sectorLeaderSnapshots.length,
    screenerResults: prepared.screenerResults.length,
    screenerCandidateNotes: prepared.screenerCandidateNotes.length
  };
}

function currentCounts() {
  return {
    recentStocks: db.prepare('SELECT COUNT(*) AS count FROM recent_stocks').get().count,
    watchlist: db.prepare('SELECT COUNT(*) AS count FROM watchlist').get().count,
    trades: db.prepare('SELECT COUNT(*) AS count FROM trades').get().count,
    sectors: db.prepare('SELECT COUNT(*) AS count FROM sectors').get().count,
    sectorLeaders: db.prepare('SELECT COUNT(*) AS count FROM sector_leaders').get().count,
    sectorLeaderSnapshots: db.prepare('SELECT COUNT(*) AS count FROM sector_leader_snapshots').get().count,
    screenerResults: db.prepare('SELECT COUNT(*) AS count FROM ai_screener_results').get().count,
    screenerCandidateNotes: db.prepare('SELECT COUNT(*) AS count FROM screener_candidate_notes').get().count
  };
}

function previewUserDataImport(backup) {
  const prepared = prepareImport(backup);
  return {
    mode: 'replace',
    incoming: countsForPrepared(prepared),
    current: currentCounts()
  };
}

function importUserData(backup, options = {}) {
  const mode = options.mode === 'merge' ? 'merge' : 'replace';
  const prepared = prepareImport(backup);
  const { recentStocks, watchlist, trades, sectors, sectorLeaders, sectorLeaderSnapshots, screenerResults, screenerCandidateNotes } = prepared;

  const summary = {
    mode,
    ...countsForPrepared(prepared)
  };

  db.transaction(function() {
    if (mode === 'replace') {
      db.prepare('DELETE FROM sector_leaders').run();
      db.prepare('DELETE FROM sector_leader_snapshots').run();
      db.prepare('DELETE FROM sectors').run();
      db.prepare('DELETE FROM recent_stocks').run();
      db.prepare('DELETE FROM watchlist').run();
      db.prepare('DELETE FROM trades').run();
      db.prepare('DELETE FROM portfolio_snapshots').run();
      db.prepare('DELETE FROM screener_candidate_notes').run();
      db.prepare('DELETE FROM ai_screener_results').run();
    }

    const insertRecent = db.prepare(`
      INSERT INTO recent_stocks (code, name, last_viewed_at, view_count, last_price, last_change)
      VALUES (@code, @name, @lastViewedAt, @viewCount, @lastPrice, @lastChange)
      ON CONFLICT(code) DO UPDATE SET
        name = excluded.name,
        last_viewed_at = excluded.last_viewed_at,
        view_count = excluded.view_count,
        last_price = excluded.last_price,
        last_change = excluded.last_change,
        updated_at = CURRENT_TIMESTAMP
    `);

    const insertWatchlist = db.prepare(`
      INSERT INTO watchlist (code, name, group_name, note, alert_high, alert_low, sort_order)
      VALUES (@code, @name, @groupName, @note, @alertHigh, @alertLow, @sortOrder)
      ON CONFLICT(code) DO UPDATE SET
        name = excluded.name,
        group_name = excluded.group_name,
        note = excluded.note,
        alert_high = excluded.alert_high,
        alert_low = excluded.alert_low,
        sort_order = excluded.sort_order,
        updated_at = CURRENT_TIMESTAMP
    `);

    const insertTrade = db.prepare(`
      INSERT INTO trades (code, name, side, trade_date, price, quantity, fee, tax, amount, note)
      VALUES (@code, @name, @side, @tradeDate, @price, @quantity, @fee, @tax, @amount, @note)
    `);

    const upsertSector = db.prepare(`
      INSERT INTO sectors (name, description, sort_order)
      VALUES (@name, @description, @sortOrder)
      ON CONFLICT(name) DO UPDATE SET
        description = excluded.description,
        sort_order = excluded.sort_order,
        updated_at = CURRENT_TIMESTAMP
    `);

    const getSectorId = db.prepare('SELECT id FROM sectors WHERE name = ?');

    const insertLeader = db.prepare(`
      INSERT INTO sector_leaders (sector_id, code, name, role, reason, weight, note)
      VALUES (@sectorId, @code, @name, @role, @reason, @weight, @note)
      ON CONFLICT(sector_id, code, role) DO UPDATE SET
        name = excluded.name,
        reason = excluded.reason,
        weight = excluded.weight,
        note = excluded.note,
        updated_at = CURRENT_TIMESTAMP
    `);

    const insertLeaderSnapshot = db.prepare(`
      INSERT INTO sector_leader_snapshots (leader_id, sector_id, sector_name, code, name, price, change, amount, captured_at)
      VALUES (@leaderId, @sectorId, @sectorName, @code, @name, @price, @change, @amount, @capturedAt)
    `);

    const insertScreenerResult = db.prepare(`
      INSERT INTO ai_screener_results (task_name, strategy, demand, result_json, ai_result)
      VALUES (@taskName, @strategy, @demand, @resultJson, @aiResult)
    `);

    const insertScreenerCandidateNote = db.prepare(`
      INSERT INTO screener_candidate_notes (result_id, code, status, note)
      VALUES (@resultId, @code, @status, @note)
      ON CONFLICT(result_id, code) DO UPDATE SET
        status = excluded.status,
        note = excluded.note,
        updated_at = CURRENT_TIMESTAMP
    `);

    recentStocks.forEach(item => insertRecent.run(item));
    watchlist.forEach(item => insertWatchlist.run(item));
    trades.forEach(item => insertTrade.run(item));
    const screenerResultIdMap = new Map();
    screenerResults.forEach(item => {
      const info = insertScreenerResult.run({
        taskName: item.taskName,
        strategy: item.strategy,
        demand: item.demand,
        resultJson: item.resultJson,
        aiResult: item.aiResult
      });
      if (item.oldId) screenerResultIdMap.set(item.oldId, info.lastInsertRowid);
    });

    screenerCandidateNotes.forEach(item => {
      const resultId = screenerResultIdMap.get(item.oldResultId);
      if (!resultId) return;
      insertScreenerCandidateNote.run({
        resultId,
        code: item.code,
        status: item.status,
        note: item.note
      });
    });

    const sectorIdMap = new Map();
    sectors.forEach(item => {
      upsertSector.run(item);
      const row = getSectorId.get(item.name);
      if (row) sectorIdMap.set(item.oldId, row.id);
    });

    sectorLeaders.forEach(item => {
      const sectorId = sectorIdMap.get(item.oldSectorId);
      if (!sectorId) return;
      insertLeader.run({
        sectorId,
        code: item.code,
        name: item.name,
        role: item.role,
        reason: item.reason,
        weight: item.weight,
        note: item.note
      });
    });

    sectorLeaderSnapshots.forEach(item => insertLeaderSnapshot.run(item));
  })();

  return summary;
}

module.exports = {
  BACKUP_VERSION,
  exportUserData,
  importUserData,
  previewUserDataImport
};
