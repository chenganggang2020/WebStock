const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  createLocalThirtySecondBarService,
  createLocalFiveSecondBarService,
  parseProviderTime,
  auctionIndicativeFields
} = require('../services/localThirtySecondBarService');

test('local five-second bars retain distinct public quote snapshots without claiming exchange ticks', () => {
  const database = new Database(':memory:');
  const service = createLocalFiveSecondBarService({ db: database });

  service.recordQuotes([{
    code: '000001', price: 10, volume: 1000, amount: 10000,
    providerObservedAt: '2026-08-14 09:30:01'
  }]);
  service.recordQuotes([{
    code: '000001', price: 10.05, volume: 1100, amount: 11050,
    providerObservedAt: '2026-08-14 09:30:05'
  }]);
  service.recordQuotes([{
    code: '000001', price: 10.02, volume: 1200, amount: 12052,
    providerObservedAt: '2026-08-14 09:30:06'
  }]);

  const result = service.list('000001');
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].time, '2026-08-14 09:30:05');
  assert.equal(result.rows[0].observedCount, 2);
  assert.equal(result.rows[1].time, '2026-08-14 09:30:10');
  assert.equal(result.meta.dataSource, 'local-public-quote-5s');
  assert.equal(result.meta.sampling.intervalSeconds, 5);
  assert.equal(result.meta.exchangeGroundTruth, false);
  assert.equal(result.meta.realtimeGuaranteed, false);

  database.close();
});

test('local thirty-second bars aggregate only new public quote snapshots', () => {
  const database = new Database(':memory:');
  const service = createLocalThirtySecondBarService({
    db: database,
    now: function() { return new Date('2026-08-14T01:31:00.000Z').getTime(); }
  });

  const first = {
    code: '000001', price: 10, volume: 1000, amount: 10000,
    providerObservedAt: '2026-08-14 09:30:01'
  };
  assert.equal(service.recordQuotes([first]).recorded, 1);
  assert.equal(service.recordQuotes([first]).recorded, 0);
  service.recordQuotes([{
    code: '000001', price: 10.05, volume: 1100, amount: 11050,
    providerObservedAt: '2026-08-14 09:30:05'
  }]);
  service.recordQuotes([{
    code: '000001', price: 10.02, volume: 1200, amount: 12052,
    providerObservedAt: '2026-08-14 09:30:35'
  }]);

  const result = service.list('000001');
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows[0], {
    time: '2026-08-14 09:30:30',
    open: 10,
    price: 10.05,
    high: 10.05,
    low: 10,
    volume: 100,
    amount: 1050,
    observedCount: 2
  });
  assert.equal(result.rows[1].time, '2026-08-14 09:31:00');
  assert.equal(result.rows[1].volume, 100);
  assert.equal(result.meta.dataSource, 'local-public-quote-30s');
  assert.equal(result.meta.sampling.intervalSeconds, 30);
  assert.equal(result.meta.exchangeGroundTruth, false);
  assert.equal(result.meta.volumeCoverage, 'sample-window');
  assert.equal(result.meta.providerObservedAt, '2026-08-14 09:30:35');

  database.close();
});

test('local thirty-second bars ignore lunch snapshots and never carry cumulative volume across days', () => {
  const database = new Database(':memory:');
  const service = createLocalThirtySecondBarService({ db: database });

  service.recordQuotes([{
    code: '600000', price: 8, volume: 5000, amount: 40000,
    providerObservedAt: '2026-08-14 11:30:00'
  }]);
  assert.equal(service.recordQuotes([{
    code: '600000', price: 8.01, volume: 5100, amount: 40801,
    providerObservedAt: '2026-08-14 12:00:00'
  }]).recorded, 0);
  service.recordQuotes([{
    code: '600000', price: 8.2, volume: 200, amount: 1640,
    providerObservedAt: '2026-08-15 09:30:01'
  }]);

  const latest = service.list('600000');
  assert.equal(latest.tradingDate, '2026-08-15');
  assert.equal(latest.rows.length, 1);
  assert.equal(latest.rows[0].volume, null);
  assert.equal(latest.rows[0].amount, null);

  database.close();
});

test('local thirty-second aggregation resumes its cumulative baseline after a service restart', () => {
  const database = new Database(':memory:');
  const firstService = createLocalThirtySecondBarService({ db: database });
  firstService.recordQuotes([{
    code: '300750', price: 200, volume: 1000, amount: 200000,
    providerObservedAt: '2026-08-14 13:00:01'
  }]);

  const resumedService = createLocalThirtySecondBarService({ db: database });
  resumedService.recordQuotes([{
    code: '300750', price: 201, volume: 1050, amount: 210050,
    providerObservedAt: '2026-08-14 13:00:05'
  }]);

  const result = resumedService.list('300750', { tradingDate: '2026-08-14' });
  assert.equal(result.rows[0].volume, 50);
  assert.equal(result.rows[0].amount, 10050);
  assert.equal(result.rows[0].observedCount, 2);

  database.close();
});

test('local thirty-second bars persist each quote batch atomically', () => {
  const database = new Database(':memory:');
  const service = createLocalThirtySecondBarService({ db: database });
  database.exec(`CREATE TRIGGER reject_second_quote
    BEFORE INSERT ON market_quote_bars_30s
    WHEN NEW.code = '000002'
    BEGIN
      SELECT RAISE(ABORT, 'forced batch failure');
    END`);

  assert.throws(() => service.recordQuotes([{
    code: '000001', price: 10, volume: 1000, amount: 10000,
    providerObservedAt: '2026-08-14 09:30:01'
  }, {
    code: '000002', price: 20, volume: 2000, amount: 40000,
    providerObservedAt: '2026-08-14 09:30:01'
  }]), /forced batch failure/);

  const rows = database.prepare('SELECT code FROM market_quote_bars_30s ORDER BY code').all();
  assert.deepEqual(rows, []);

  database.exec('DROP TRIGGER reject_second_quote');
  assert.equal(service.recordQuotes([{
    code: '000001', price: 10, volume: 1000, amount: 10000,
    providerObservedAt: '2026-08-14 09:30:01'
  }, {
    code: '000002', price: 20, volume: 2000, amount: 40000,
    providerObservedAt: '2026-08-14 09:30:01'
  }]).recorded, 2);

  database.close();
});

test('local snapshots retain the 09:15-09:25 opening auction window without accepting 09:26 noise', () => {
  const database = new Database(':memory:');
  const service = createLocalThirtySecondBarService({ db: database });

  assert.equal(service.recordQuotes([{
    code: '000001', price: 10.1, volume: 1000, amount: 10100,
    providerObservedAt: '2026-08-14 09:15:01'
  }]).recorded, 1);
  assert.equal(service.recordQuotes([{
    code: '000001', price: 10.2, volume: 1200, amount: 12240,
    providerObservedAt: '2026-08-14 09:24:59'
  }]).recorded, 1);
  assert.equal(service.recordQuotes([{
    code: '000001', price: 10.15, volume: 1300, amount: 13195,
    providerObservedAt: '2026-08-14 09:26:00'
  }]).recorded, 0);

  const result = service.list('000001');
  assert.deepEqual(result.rows.map(function(row) { return row.time; }), [
    '2026-08-14 09:15:30',
    '2026-08-14 09:25:00'
  ]);
  assert.equal(result.meta.sampling.expectedFullDayPoints, 500);
  assert.equal(result.meta.auctionCoverage, 'local-observed-opening-and-closing');
  assert.equal(result.meta.auctionFieldContractVerified, false);
  database.close();
});

test('opening auction snapshots retain explicit provider indicative fields without inferring from order-book levels', () => {
  const database = new Database(':memory:');
  const service = createLocalThirtySecondBarService({ db: database });

  service.recordQuotes([{
    code: '601138', price: 63.8, volume: 0, amount: 0,
    auctionReferencePrice: 64.1,
    auctionMatchedVolume: 32000,
    auctionUnmatchedBuyVolume: 8000,
    auctionUnmatchedSellVolume: 0,
    providerObservedAt: '2026-08-27 09:24:30'
  }]);

  const result = service.list('601138', { tradingDate: '2026-08-27' });
  assert.equal(result.rows[0].auctionReferencePrice, 64.1);
  assert.equal(result.rows[0].auctionMatchedVolume, 32000);
  assert.equal(result.rows[0].auctionUnmatchedBuyVolume, 8000);
  assert.equal(result.rows[0].auctionUnmatchedSellVolume, 0);
  assert.equal(result.meta.auctionIndicativeFields, true);
  assert.equal(result.meta.exchangeGroundTruth, false);

  const genericOrderBook = auctionIndicativeFields({
    buy1Price: 64.1, sell1Price: 64.1,
    buy1Vol: 32000, sell1Vol: 32000,
    buy2Vol: 8000, sell2Vol: 0
  }, parseProviderTime('2026-08-27 09:24:31'));
  assert.equal(genericOrderBook.auctionReferencePrice, null);
  assert.equal(genericOrderBook.auctionMatchedVolume, null);
  assert.equal(genericOrderBook.auctionUnmatchedBuyVolume, null);
  assert.equal(genericOrderBook.auctionUnmatchedSellVolume, null);
  database.close();
});

test('existing thirty-second bar tables gain nullable auction columns without losing rows', () => {
  const database = new Database(':memory:');
  database.exec(`CREATE TABLE market_quote_bars_30s (
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
  );
  INSERT INTO market_quote_bars_30s
    (code, trading_date, bar_time, open, high, low, close, provider_last_at)
    VALUES ('000001', '2026-08-26', '2026-08-26 15:00:00', 10, 10.2, 9.9, 10.1, '2026-08-26 15:00:00')`);

  const service = createLocalThirtySecondBarService({ db: database });
  const columns = database.prepare('PRAGMA table_info(market_quote_bars_30s)').all().map(function(row) {
    return row.name;
  });
  assert.deepEqual([
    'auction_reference_price',
    'auction_matched_volume',
    'auction_unmatched_buy_volume',
    'auction_unmatched_sell_volume'
  ].every(function(column) { return columns.includes(column); }), true);
  assert.equal(service.list('000001', { tradingDate: '2026-08-26' }).rows.length, 1);
  database.close();
});
