const THIRTY_SECONDS = 30;
const FIVE_SECONDS = 5;
const calendar = require('./marketTradingCalendar');

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

function bucketEnd(providerTime, intervalSeconds) {
  const bucketSeconds = intervalSeconds === FIVE_SECONDS ? FIVE_SECONDS : THIRTY_SECONDS;
  const auctionStart = 9 * 3600 + 15 * 60;
  const auctionEnd = 9 * 3600 + 25 * 60;
  const morningStart = 9 * 3600 + 30 * 60;
  const morningEnd = 11 * 3600 + 30 * 60;
  const afternoonStart = 13 * 3600;
  const afternoonEnd = 15 * 3600;
  let start;
  let end;
  if (providerTime.totalSeconds >= auctionStart && providerTime.totalSeconds <= auctionEnd) {
    start = auctionStart;
    end = auctionEnd;
  } else if (providerTime.totalSeconds >= morningStart && providerTime.totalSeconds <= morningEnd) {
    start = morningStart;
    end = morningEnd;
  } else if (providerTime.totalSeconds >= afternoonStart && providerTime.totalSeconds <= afternoonEnd) {
    start = afternoonStart;
    end = afternoonEnd;
  } else {
    return '';
  }
  const offset = providerTime.totalSeconds - start;
  const bucketOffset = Math.min(end - start, Math.max(bucketSeconds, Math.ceil(offset / bucketSeconds) * bucketSeconds));
  const seconds = start + bucketOffset;
  return providerTime.tradingDate + ' ' + two(Math.floor(seconds / 3600)) + ':' +
    two(Math.floor((seconds % 3600) / 60)) + ':' + two(seconds % 60);
}

function auctionIndicativeFields(quote, providerTime) {
  const auctionStart = 9 * 3600 + 15 * 60;
  const auctionEnd = 9 * 3600 + 25 * 60;
  const closingStart = 14 * 3600 + 57 * 60;
  const closingEnd = 15 * 3600;
  if (!providerTime || !((providerTime.totalSeconds >= auctionStart && providerTime.totalSeconds <= auctionEnd) ||
      (providerTime.totalSeconds >= closingStart && providerTime.totalSeconds <= closingEnd))) {
    return {
      auctionReferencePrice: null,
      auctionMatchedVolume: null,
      auctionUnmatchedBuyVolume: null,
      auctionUnmatchedSellVolume: null
    };
  }
  const referencePrice = finiteOrNull(quote && quote.auctionReferencePrice);
  const matchedVolume = finiteOrNull(quote && quote.auctionMatchedVolume);
  const unmatchedBuyVolume = finiteOrNull(quote && quote.auctionUnmatchedBuyVolume);
  const unmatchedSellVolume = finiteOrNull(quote && quote.auctionUnmatchedSellVolume);
  return {
    auctionReferencePrice: referencePrice > 0 ? referencePrice : null,
    auctionMatchedVolume: matchedVolume !== null && matchedVolume >= 0 ? matchedVolume : null,
    auctionUnmatchedBuyVolume: unmatchedBuyVolume !== null && unmatchedBuyVolume >= 0 ? unmatchedBuyVolume : null,
    auctionUnmatchedSellVolume: unmatchedSellVolume !== null && unmatchedSellVolume >= 0 ? unmatchedSellVolume : null
  };
}

function ensureColumn(db, table, column, type) {
  const exists = db.prepare('PRAGMA table_info(' + table + ')').all().some(function(row) {
    return row.name === column;
  });
  if (!exists) db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' ' + type);
}

function createLocalThirtySecondBarService(options = {}) {
  const db = options.db;
  const now = options.now || Date.now;
  if (!db || typeof db.prepare !== 'function') throw new TypeError('db is required');
  const intervalSeconds = Number(options.intervalSeconds) === FIVE_SECONDS ? FIVE_SECONDS : THIRTY_SECONDS;
  const tableName = intervalSeconds === FIVE_SECONDS ? 'market_quote_bars_5s' : 'market_quote_bars_30s';
  const indexName = intervalSeconds === FIVE_SECONDS ? 'idx_market_quote_bars_5s_date' : 'idx_market_quote_bars_30s_date';
  const sourceName = intervalSeconds === FIVE_SECONDS ? 'local-public-quote-5s' : 'local-public-quote-30s';
  const unavailableSource = intervalSeconds === FIVE_SECONDS ? 'local-5s-unavailable' : 'local-30s-unavailable';
  const samplingLabel = intervalSeconds === FIVE_SECONDS ? '\u672c\u57305\u79d2\u6d3e\u751f' : '\u672c\u573030\u79d2\u5feb\u7167';
  const expectedFullDayPoints = intervalSeconds === FIVE_SECONDS ? 3000 : 500;

  db.exec(`CREATE TABLE IF NOT EXISTS ${tableName} (
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
    auction_reference_price REAL,
    auction_matched_volume REAL,
    auction_unmatched_buy_volume REAL,
    auction_unmatched_sell_volume REAL,
    provider_last_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'sina-public-quote',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (code, bar_time)
  )`);
  ensureColumn(db, tableName, 'auction_reference_price', 'REAL');
  ensureColumn(db, tableName, 'auction_matched_volume', 'REAL');
  ensureColumn(db, tableName, 'auction_unmatched_buy_volume', 'REAL');
  ensureColumn(db, tableName, 'auction_unmatched_sell_volume', 'REAL');
  db.exec(`CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName}(code, trading_date, bar_time)`);

  // Bucket ends preserve provider timestamp order, including session/day boundaries.
  // The existing (code, bar_time) primary key avoids sorting a stock's entire history.
  const latestStatement = db.prepare(`SELECT close, last_cumulative_volume, last_cumulative_amount, provider_last_at
    FROM ${tableName} WHERE code = ? ORDER BY bar_time DESC LIMIT 1`);
  const upsertStatement = db.prepare(`INSERT INTO ${tableName}
    (code, trading_date, bar_time, open, high, low, close, volume, amount, observed_count,
     last_cumulative_volume, last_cumulative_amount, auction_reference_price, auction_matched_volume,
     auction_unmatched_buy_volume, auction_unmatched_sell_volume, provider_last_at, source)
    VALUES (@code, @tradingDate, @barTime, @price, @price, @price, @price, @volumeDelta, @amountDelta, 1,
      @cumulativeVolume, @cumulativeAmount, @auctionReferencePrice, @auctionMatchedVolume,
      @auctionUnmatchedBuyVolume, @auctionUnmatchedSellVolume, @providerObservedAt, @source)
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
      auction_reference_price = COALESCE(excluded.auction_reference_price, auction_reference_price),
      auction_matched_volume = COALESCE(excluded.auction_matched_volume, auction_matched_volume),
      auction_unmatched_buy_volume = COALESCE(excluded.auction_unmatched_buy_volume, auction_unmatched_buy_volume),
      auction_unmatched_sell_volume = COALESCE(excluded.auction_unmatched_sell_volume, auction_unmatched_sell_volume),
      provider_last_at = excluded.provider_last_at,
      source = excluded.source,
      updated_at = CURRENT_TIMESTAMP`);
  const listStatement = db.prepare(`SELECT bar_time AS time, open, close AS price, high, low, volume, amount,
      observed_count AS observedCount, provider_last_at AS providerLastAt,
      auction_reference_price AS auctionReferencePrice,
      auction_matched_volume AS auctionMatchedVolume,
      auction_unmatched_buy_volume AS auctionUnmatchedBuyVolume,
      auction_unmatched_sell_volume AS auctionUnmatchedSellVolume
    FROM ${tableName} WHERE code = ? AND trading_date = ? ORDER BY bar_time`);
  const lastProviderStatement = db.prepare(`SELECT provider_last_at AS providerLastAt
    FROM ${tableName} WHERE code = ? AND trading_date = ? ORDER BY bar_time DESC LIMIT 1`);
  const latestDateStatement = db.prepare(`SELECT MAX(trading_date) AS tradingDate FROM ${tableName} WHERE code = ?`);
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

  const recordQuoteBatch = db.transaction(function(quotes, nextStates) {
    let recorded = 0;
    quotes.forEach(function(quote) {
      const code = normalizeCode(quote && quote.code);
      const price = finiteOrNull(quote && quote.price);
      const providerTime = parseProviderTime(quote && quote.providerObservedAt);
      const barTime = providerTime && bucketEnd(providerTime, intervalSeconds);
      if (!code || price === null || price <= 0 || !providerTime || !barTime) return;
      const providerMs = Date.parse(providerTime.value.replace(' ', 'T') + '+08:00');
      if (!Number.isFinite(providerMs) || providerMs > Number(now())) return;

      const cumulativeVolume = finiteOrNull(quote.volume);
      const cumulativeAmount = finiteOrNull(quote.amount);
      const previous = nextStates.has(code) ? nextStates.get(code) : stateFor(code);
      if (previous && providerTime.value <= previous.providerObservedAt) return;
      const sameDay = previous && previous.providerObservedAt.slice(0, 10) === providerTime.tradingDate;
      const previousTime = previous && parseProviderTime(previous.providerObservedAt);
      // A cumulative change over a collection gap is not one short bar's turnover.
      const continuous = sameDay && previousTime &&
        providerTime.totalSeconds - previousTime.totalSeconds <= intervalSeconds;
      const volumeDelta = continuous && cumulativeVolume !== null && previous.cumulativeVolume !== null &&
        cumulativeVolume >= previous.cumulativeVolume ? cumulativeVolume - previous.cumulativeVolume : null;
      const amountDelta = continuous && cumulativeAmount !== null && previous.cumulativeAmount !== null &&
        cumulativeAmount >= previous.cumulativeAmount ? cumulativeAmount - previous.cumulativeAmount : null;
      const auctionFields = auctionIndicativeFields(quote, providerTime);

      upsertStatement.run({
        code,
        tradingDate: providerTime.tradingDate,
        barTime,
        price,
        volumeDelta,
        amountDelta,
        cumulativeVolume,
        cumulativeAmount,
        auctionReferencePrice: auctionFields.auctionReferencePrice,
        auctionMatchedVolume: auctionFields.auctionMatchedVolume,
        auctionUnmatchedBuyVolume: auctionFields.auctionUnmatchedBuyVolume,
        auctionUnmatchedSellVolume: auctionFields.auctionUnmatchedSellVolume,
        providerObservedAt: providerTime.value,
        source: String(quote.source || 'sina-public-quote')
      });
      nextStates.set(code, { providerObservedAt: providerTime.value, price, cumulativeVolume, cumulativeAmount });
      recorded += 1;
    });
    return { recorded };
  });

  function recordQuotes(quotes) {
    const nextStates = new Map();
    const result = recordQuoteBatch(Array.isArray(quotes) ? quotes : [], nextStates);
    nextStates.forEach(function(state, code) { states.set(code, state); });
    return result;
  }

  // A caller combining multiple writers must invalidate after its outer rollback.
  function clearStateCache() {
    states.clear();
  }

  function list(codeValue, listOptions = {}) {
    const code = normalizeCode(codeValue);
    const latest = code ? latestDateStatement.get(code) : null;
    const tradingDate = String(listOptions.tradingDate || latest && latest.tradingDate || '');
    const rows = code && tradingDate ? listStatement.all(code, tradingDate).map(function(row) {
      const mapped = {
        time: row.time,
        open: row.open,
        price: row.price,
        high: row.high,
        low: row.low,
        volume: row.volume,
        amount: row.amount,
        observedCount: row.observedCount
      };
      if (row.auctionReferencePrice !== null) mapped.auctionReferencePrice = row.auctionReferencePrice;
      if (row.auctionMatchedVolume !== null) mapped.auctionMatchedVolume = row.auctionMatchedVolume;
      if (row.auctionUnmatchedBuyVolume !== null) mapped.auctionUnmatchedBuyVolume = row.auctionUnmatchedBuyVolume;
      if (row.auctionUnmatchedSellVolume !== null) mapped.auctionUnmatchedSellVolume = row.auctionUnmatchedSellVolume;
      return mapped;
    }) : [];
    const providerRow = rows.length ? lastProviderStatement.get(code, tradingDate) : null;
    const lastProviderAt = providerRow ? providerRow.providerLastAt : null;
    const checkedAt = Number(now());
    const providerMs = lastProviderAt ? Date.parse(lastProviderAt.replace(' ', 'T') + '+08:00') : NaN;
    const snapshotAgeSeconds = Number.isFinite(providerMs) ? Math.max(0, (checkedAt - providerMs) / 1000) : null;
    const clock = calendar.clock(checkedAt);
    const opening = calendar.tradingDay(clock.date).open && clock.time >= '09:15:00' && clock.time <= '09:30:00';
    const expected = opening ? Math.min(checkedAt, Date.parse(clock.date + 'T09:25:00+08:00'))
      : Date.parse(calendar.expectedObservation(checkedAt) || '');
    const lag = Number.isFinite(expected) && Number.isFinite(providerMs) ? (expected - providerMs) / 1000 : null;
    const stale = rows.length > 0 && (providerMs > checkedAt || lag === null || lag > Math.max(60, intervalSeconds * 3));
    const marketState = listOptions.tradingDate ? 'historical' : stale ? 'delayed'
      : opening || calendar.isContinuousSession(checkedAt) ? 'live' : 'latest-close';
    return {
      tradingDate,
      rows,
      meta: {
        dataSource: rows.length ? sourceName : unavailableSource,
        provider: 'Sina public Level-1 snapshot aggregation',
        derived: true,
        synthetic: false,
        exchangeGroundTruth: false,
        volumeCoverage: 'sample-window',
        auctionCoverage: 'local-observed-opening-and-closing',
        auctionFieldContractVerified: false,
        auctionIndicativeFields: rows.some(function(row) {
          return row.auctionReferencePrice != null || row.auctionMatchedVolume != null ||
            row.auctionUnmatchedBuyVolume != null || row.auctionUnmatchedSellVolume != null;
        }),
        stale,
        marketState,
        snapshotAgeSeconds,
        reason: rows.length ? (stale ? 'last-observed-snapshot' : null) : 'not-yet-collected',
        tradingDate: tradingDate || null,
        fetchedAt: new Date(checkedAt).toISOString(),
        providerObservedAt: lastProviderAt,
        sampling: {
          intervalSeconds,
          intervalMinutes: intervalSeconds / 60,
          label: samplingLabel,
          timestampMeaning: 'bar-end',
          expectedFullDayPoints
        },
        limitations: ['Derived from public quote snapshots; not exchange tick-by-tick data.', 'Volume covers only the locally observed sample window.', 'Opening auction snapshots exist only while WebStock is running and refreshing the stock from 09:15 to 09:25.', 'Generic five-level order-book fields are never relabeled as official auction matched or unmatched volume.'],
        realtimeGuaranteed: false
      }
    };
  }

  return { recordQuotes, list, clearStateCache };
}

function createLocalFiveSecondBarService(options = {}) {
  return createLocalThirtySecondBarService(Object.assign({}, options, { intervalSeconds: FIVE_SECONDS }));
}

module.exports = {
  createLocalThirtySecondBarService,
  createLocalFiveSecondBarService,
  parseProviderTime,
  bucketEnd,
  auctionIndicativeFields
};
