const THIRTY_SECONDS = 30;

function normalizeCode(value) {
  const code = String(value || '').replace(/\D/g, '');
  return /^\d{6}$/.test(code) ? code : '';
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseProviderTime(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return {
    tradingDate: match[1],
    hour,
    minute,
    second,
    totalSeconds: hour * 3600 + minute * 60 + second,
    value: match[0]
  };
}

function two(value) {
  return String(value).padStart(2, '0');
}

function bucketEnd(providerTime) {
  const morningStart = 9 * 3600 + 30 * 60;
  const morningEnd = 11 * 3600 + 30 * 60;
  const afternoonStart = 13 * 3600;
  const afternoonEnd = 15 * 3600;
  let start;
  let end;
  if (providerTime.totalSeconds >= morningStart && providerTime.totalSeconds <= morningEnd) {
    start = morningStart;
    end = morningEnd;
  } else if (providerTime.totalSeconds >= afternoonStart && providerTime.totalSeconds <= afternoonEnd) {
    start = afternoonStart;
    end = afternoonEnd;
  } else {
    return '';
  }
  const offset = providerTime.totalSeconds - start;
  const bucketOffset = Math.min(end - start, Math.max(THIRTY_SECONDS, Math.ceil(offset / THIRTY_SECONDS) * THIRTY_SECONDS));
  const seconds = start + bucketOffset;
  return providerTime.tradingDate + ' ' + two(Math.floor(seconds / 3600)) + ':' +
    two(Math.floor((seconds % 3600) / 60)) + ':' + two(seconds % 60);
}

function createLocalThirtySecondBarService(options = {}) {
  const db = options.db;
  const now = options.now || Date.now;
  if (!db || typeof db.prepare !== 'function') throw new TypeError('db is required');

  db.exec(`CREATE TABLE IF NOT EXISTS market_quote_bars_30s (
    code TEXT NOT NULL,
    trading_date TEXT NOT NULL,
    bar_time TEXT NOT NULL,
    open REAL NOT NULL,
    high REAL NOT NULL,
    low REAL NOT NULL,
    close REAL NOT NULL,
    volume REAL,
    amount REAL,
    observed_count INTEGER NOT NULL DEFAULT 1,
    last_cumulative_volume REAL,
    last_cumulative_amount REAL,
    provider_last_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'sina-public-quote',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (code, bar_time)
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_market_quote_bars_30s_date ON market_quote_bars_30s(code, trading_date, bar_time)');

  const latestStatement = db.prepare(`SELECT close, last_cumulative_volume, last_cumulative_amount, provider_last_at
    FROM market_quote_bars_30s WHERE code = ? ORDER BY provider_last_at DESC LIMIT 1`);
  const upsertStatement = db.prepare(`INSERT INTO market_quote_bars_30s
    (code, trading_date, bar_time, open, high, low, close, volume, amount, observed_count,
     last_cumulative_volume, last_cumulative_amount, provider_last_at, source)
    VALUES (@code, @tradingDate, @barTime, @price, @price, @price, @price, @volumeDelta, @amountDelta, 1,
      @cumulativeVolume, @cumulativeAmount, @providerObservedAt, @source)
    ON CONFLICT(code, bar_time) DO UPDATE SET
      high = CASE WHEN excluded.close > high THEN excluded.close ELSE high END,
      low = CASE WHEN excluded.close < low THEN excluded.close ELSE low END,
      close = excluded.close,
      volume = CASE WHEN excluded.volume IS NULL THEN volume
                    WHEN volume IS NULL THEN excluded.volume ELSE volume + excluded.volume END,
      amount = CASE WHEN excluded.amount IS NULL THEN amount
                    WHEN amount IS NULL THEN excluded.amount ELSE amount + excluded.amount END,
      observed_count = observed_count + 1,
      last_cumulative_volume = excluded.last_cumulative_volume,
      last_cumulative_amount = excluded.last_cumulative_amount,
      provider_last_at = excluded.provider_last_at,
      source = excluded.source,
      updated_at = CURRENT_TIMESTAMP`);
  const listStatement = db.prepare(`SELECT bar_time AS time, open, close AS price, high, low, volume, amount,
      observed_count AS observedCount, provider_last_at AS providerLastAt
    FROM market_quote_bars_30s WHERE code = ? AND trading_date = ? ORDER BY bar_time`);
  const lastProviderStatement = db.prepare(`SELECT provider_last_at AS providerLastAt
    FROM market_quote_bars_30s WHERE code = ? AND trading_date = ? ORDER BY provider_last_at DESC LIMIT 1`);
  const latestDateStatement = db.prepare('SELECT MAX(trading_date) AS tradingDate FROM market_quote_bars_30s WHERE code = ?');
  const states = new Map();

  function stateFor(code) {
    if (!states.has(code)) {
      const row = latestStatement.get(code);
      states.set(code, row ? {
        providerObservedAt: row.provider_last_at,
        price: row.close,
        cumulativeVolume: row.last_cumulative_volume,
        cumulativeAmount: row.last_cumulative_amount
      } : null);
    }
    return states.get(code);
  }

  function recordQuotes(quotes) {
    let recorded = 0;
    (Array.isArray(quotes) ? quotes : []).forEach(function(quote) {
      const code = normalizeCode(quote && quote.code);
      const price = finiteOrNull(quote && quote.price);
      const providerTime = parseProviderTime(quote && quote.providerObservedAt);
      const barTime = providerTime && bucketEnd(providerTime);
      if (!code || price === null || price <= 0 || !providerTime || !barTime) return;

      const cumulativeVolume = finiteOrNull(quote.volume);
      const cumulativeAmount = finiteOrNull(quote.amount);
      const previous = stateFor(code);
      if (previous && providerTime.value <= previous.providerObservedAt) return;
      const sameDay = previous && previous.providerObservedAt.slice(0, 10) === providerTime.tradingDate;
      const volumeDelta = sameDay && cumulativeVolume !== null && previous.cumulativeVolume !== null &&
        cumulativeVolume >= previous.cumulativeVolume ? cumulativeVolume - previous.cumulativeVolume : null;
      const amountDelta = sameDay && cumulativeAmount !== null && previous.cumulativeAmount !== null &&
        cumulativeAmount >= previous.cumulativeAmount ? cumulativeAmount - previous.cumulativeAmount : null;

      upsertStatement.run({
        code,
        tradingDate: providerTime.tradingDate,
        barTime,
        price,
        volumeDelta,
        amountDelta,
        cumulativeVolume,
        cumulativeAmount,
        providerObservedAt: providerTime.value,
        source: String(quote.source || 'sina-public-quote')
      });
      states.set(code, { providerObservedAt: providerTime.value, price, cumulativeVolume, cumulativeAmount });
      recorded += 1;
    });
    return { recorded };
  }

  function list(codeValue, listOptions = {}) {
    const code = normalizeCode(codeValue);
    const latest = code ? latestDateStatement.get(code) : null;
    const tradingDate = String(listOptions.tradingDate || latest && latest.tradingDate || '');
    const rows = code && tradingDate ? listStatement.all(code, tradingDate).map(function(row) {
      return {
        time: row.time,
        open: row.open,
        price: row.price,
        high: row.high,
        low: row.low,
        volume: row.volume,
        amount: row.amount,
        observedCount: row.observedCount
      };
    }) : [];
    const providerRow = rows.length ? lastProviderStatement.get(code, tradingDate) : null;
    const lastProviderAt = providerRow ? providerRow.providerLastAt : null;
    return {
      tradingDate,
      rows,
      meta: {
        dataSource: rows.length ? 'local-public-quote-30s' : 'local-30s-unavailable',
        provider: 'Sina public Level-1 snapshot aggregation',
        derived: true,
        synthetic: false,
        exchangeGroundTruth: false,
        volumeCoverage: 'sample-window',
        stale: false,
        reason: rows.length ? null : 'not-yet-collected',
        tradingDate: tradingDate || null,
        fetchedAt: new Date(now()).toISOString(),
        providerObservedAt: lastProviderAt,
        sampling: {
          intervalSeconds: 30,
          intervalMinutes: 0.5,
          label: '\u672c\u573030\u79d2\u5feb\u7167',
          timestampMeaning: 'bar-end',
          expectedFullDayPoints: 480
        },
        limitations: ['Derived from public quote snapshots; not exchange tick-by-tick data.', 'Volume covers only the locally observed sample window.'],
        realtimeGuaranteed: false
      }
    };
  }

  return { recordQuotes, list };
}

module.exports = {
  createLocalThirtySecondBarService,
  parseProviderTime,
  bucketEnd
};
