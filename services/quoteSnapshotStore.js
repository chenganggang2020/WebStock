function createQuoteSnapshotStore(db) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('database is required');
  const upsert = db.prepare(`
    INSERT INTO market_quote_snapshots (code, payload_json, fetched_at, updated_at)
    VALUES (@code, @payloadJson, @fetchedAt, CURRENT_TIMESTAMP)
    ON CONFLICT(code) DO UPDATE SET
      payload_json = excluded.payload_json,
      fetched_at = excluded.fetched_at,
      updated_at = CURRENT_TIMESTAMP
  `);
  const saveMany = db.transaction(function(rows, fetchedAt) {
    rows.forEach(function(quote) {
      if (!quote || !/^\d{6}$/.test(String(quote.code || '')) || !(Number(quote.price) > 0)) return;
      upsert.run({
        code: String(quote.code),
        payloadJson: JSON.stringify(quote),
        fetchedAt: String(fetchedAt)
      });
    });
  });

  function saveAll(quotes, fetchedAt) {
    const timestamp = fetchedAt || new Date().toISOString();
    saveMany(Array.isArray(quotes) ? quotes : [], timestamp);
  }

  function loadAll() {
    return db.prepare('SELECT payload_json, fetched_at FROM market_quote_snapshots ORDER BY code').all()
      .map(function(row) {
        try {
          return Object.assign({}, JSON.parse(row.payload_json), { fetchedAt: row.fetched_at });
        } catch (error) {
          return null;
        }
      }).filter(Boolean);
  }

  return { saveAll, loadAll };
}

module.exports = { createQuoteSnapshotStore };
