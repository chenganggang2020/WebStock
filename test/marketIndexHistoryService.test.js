const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function loadSubject() {
  try {
    return require('../services/marketIndexHistoryService');
  } catch (error) {
    assert.fail('marketIndexHistoryService contract is not implemented: ' + error.message);
  }
}

function approximately(actual, expected, tolerance = 1e-10) {
  assert.equal(Number.isFinite(actual), true, 'expected a finite number, got ' + actual);
  assert.ok(Math.abs(actual - expected) <= tolerance,
    'expected ' + actual + ' to be within ' + tolerance + ' of ' + expected);
}

test('index history identifiers keep Shanghai indices distinct from same-code Shenzhen stocks', () => {
  const { INDEX_HISTORY_DEFINITIONS } = loadSubject();
  const byKey = new Map(INDEX_HISTORY_DEFINITIONS.map(item => [item.key, item]));

  assert.equal(INDEX_HISTORY_DEFINITIONS.length, 8);
  assert.equal(byKey.get('sse').code, '000001');
  assert.equal(byKey.get('sse').sinaSymbol, 'sh000001');
  assert.equal(byKey.get('sse').eastmoneySecid, '1.000001');
  assert.notEqual(byKey.get('sse').sinaSymbol, 'sz000001');
  assert.equal(byKey.get('star50').sinaSymbol, 'sh000688');
  assert.equal(byKey.get('csi300').eastmoneySecid, '1.000300');
  assert.equal(byKey.get('szse').sinaSymbol, 'sz399001');
  assert.equal(byKey.get('chinext').sinaSymbol, 'sz399006');
});

test('index history only accepts 20, 60, or 120 trading-day windows and defaults to 60', () => {
  const { normalizeWindow } = loadSubject();

  assert.equal(normalizeWindow(), 60);
  assert.equal(normalizeWindow('20'), 20);
  assert.equal(normalizeWindow(60), 60);
  assert.equal(normalizeWindow('120'), 120);
  assert.equal(normalizeWindow('30'), 60);
  assert.equal(normalizeWindow('not-a-number'), 60);
});

test('weekly and yearly views have explicit raw coverage and display aggregation contracts', () => {
  const { historyRequest } = loadSubject();

  assert.deepEqual(historyRequest(60, 'daily'), {
    period: 'daily', rawDays: 60, outputPeriods: 60, aggregation: 'day'
  });
  assert.deepEqual(historyRequest(60, 'weekly'), {
    period: 'weekly', rawDays: 260, outputPeriods: 52, aggregation: 'week'
  });
  assert.deepEqual(historyRequest(60, 'yearly'), {
    period: 'yearly', rawDays: 1260, outputPeriods: 60, aggregation: 'month'
  });
});

test('weekly and long-range yearly views aggregate actual daily OHLC without inventing values', () => {
  const { aggregateHistoryPoints } = loadSubject();
  const points = [
    { date: '2026-01-02', open: 10, close: 11, high: 12, low: 9, volume: 100 },
    { date: '2026-01-05', open: 11, close: 12, high: 13, low: 10, volume: 120 },
    { date: '2026-01-06', open: 12, close: 11.5, high: 12.5, low: 11, volume: 80 },
    { date: '2026-02-02', open: 13, close: 14, high: 15, low: 12, volume: 200 }
  ];

  const weekly = aggregateHistoryPoints(points, 'weekly');
  assert.deepEqual(weekly.map(item => [item.date, item.open, item.close, item.high, item.low, item.volume]), [
    ['2026-01-02', 10, 11, 12, 9, 100],
    ['2026-01-06', 11, 11.5, 13, 10, 200],
    ['2026-02-02', 13, 14, 15, 12, 200]
  ]);

  const yearly = aggregateHistoryPoints(points, 'yearly');
  assert.deepEqual(yearly.map(item => [item.date, item.open, item.close, item.high, item.low, item.volume]), [
    ['2026-01-06', 10, 11.5, 13, 9, 300],
    ['2026-02-02', 13, 14, 15, 12, 200]
  ]);
});

test('base-100 comparison aligns every index on shared dates before normalizing', () => {
  const { normalizeIndexedSeries } = loadSubject();
  const result = normalizeIndexedSeries([
    {
      key: 'alpha', name: '指数甲', points: [
        { date: '2026-08-01', close: 100 },
        { date: '2026-08-02', close: 110 },
        { date: '2026-08-03', close: 121 },
        { date: '2026-08-04', close: 133.1 }
      ]
    },
    {
      key: 'beta', name: '指数乙', points: [
        { date: '2026-08-02', close: 200 },
        { date: '2026-08-03', close: 180 },
        { date: '2026-08-04', close: 162 },
        { date: '2026-08-05', close: 145.8 }
      ]
    }
  ], 60);

  assert.deepEqual(result.dates, ['2026-08-02', '2026-08-03', '2026-08-04']);
  assert.deepEqual(result.series.map(item => [item.key, item.name]), [
    ['alpha', '指数甲'],
    ['beta', '指数乙']
  ]);
  assert.deepEqual(result.series[0].values, [100, 110, 121]);
  assert.deepEqual(result.series[1].values, [100, 90, 81]);
});

test('correlation matrix uses Pearson correlation of aligned daily log returns', () => {
  const { buildReturnCorrelationMatrix } = loadSubject();
  const result = buildReturnCorrelationMatrix([
    {
      key: 'alpha', points: [
        { date: '2026-08-01', close: 100 },
        { date: '2026-08-02', close: 110 },
        { date: '2026-08-03', close: 99 },
        { date: '2026-08-04', close: 108.9 }
      ]
    },
    {
      key: 'beta', points: [
        { date: '2026-08-01', close: 200 },
        { date: '2026-08-02', close: 220 },
        { date: '2026-08-03', close: 198 },
        { date: '2026-08-04', close: 217.8 }
      ]
    },
    {
      key: 'gamma', points: [
        { date: '2026-08-01', close: 300 },
        { date: '2026-08-02', close: 270 },
        { date: '2026-08-03', close: 297 },
        { date: '2026-08-04', close: 267.3 }
      ]
    }
  ], { minSamples: 3, window: 60 });

  assert.equal(result.method, 'pearson-log-return');
  assert.deepEqual(result.keys, ['alpha', 'beta', 'gamma']);
  assert.equal(result.sampleCounts[0][1], 3);
  approximately(result.values[0][0], 1);
  approximately(result.values[0][1], 1);
  approximately(result.values[1][0], 1);
  approximately(result.values[0][2], -1);
  approximately(result.values[2][0], -1);
});

test('correlation aligns common price dates before calculating returns', () => {
  const { buildReturnCorrelationMatrix } = loadSubject();
  const result = buildReturnCorrelationMatrix([
    { key: 'alpha', points: [
      { date: '2026-08-01', close: 100 },
      { date: '2026-08-02', close: 110 },
      { date: '2026-08-04', close: 90 },
      { date: '2026-08-05', close: 120 }
    ] },
    { key: 'beta', points: [
      { date: '2026-08-01', close: 100 },
      { date: '2026-08-02', close: 110 },
      { date: '2026-08-03', close: 200 },
      { date: '2026-08-04', close: 90 },
      { date: '2026-08-05', close: 120 }
    ] }
  ], { minSamples: 3, window: 60 });

  assert.equal(result.sampleCounts[0][1], 3);
  approximately(result.values[0][1], 1);
  approximately(result.values[1][0], 1);
});

test('correlation is unavailable for insufficient samples or a constant return series', () => {
  const { buildReturnCorrelationMatrix } = loadSubject();
  const constantReturn = {
    key: 'constant', points: [
      { date: '2026-08-01', close: 100 },
      { date: '2026-08-02', close: 110 },
      { date: '2026-08-03', close: 121 },
      { date: '2026-08-04', close: 133.1 }
    ]
  };
  const varyingReturn = {
    key: 'varying', points: [
      { date: '2026-08-01', close: 100 },
      { date: '2026-08-02', close: 105 },
      { date: '2026-08-03', close: 102 },
      { date: '2026-08-04', close: 111 }
    ]
  };
  const insufficient = {
    key: 'short', points: [
      { date: '2026-08-01', close: 100 },
      { date: '2026-08-02', close: 102 },
      { date: '2026-08-03', close: 101 }
    ]
  };

  const constantResult = buildReturnCorrelationMatrix(
    [constantReturn, varyingReturn],
    { minSamples: 3, window: 60 }
  );
  assert.equal(constantResult.values[0][0], null);
  assert.equal(constantResult.values[0][1], null);
  assert.equal(constantResult.values[1][0], null);

  const insufficientResult = buildReturnCorrelationMatrix(
    [varyingReturn, insufficient],
    { minSamples: 3, window: 60 }
  );
  assert.equal(insufficientResult.sampleCounts[0][1], 2);
  assert.equal(insufficientResult.values[0][1], null);
  assert.equal(insufficientResult.values[1][0], null);
});

test('market router exposes index history as a dedicated endpoint instead of reusing stock K-line inference', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/market.js'), 'utf8');

  assert.match(source, /router\.get\(['"]\/market\/index-history['"]/);
});

test('a requested window is unavailable when the provider returns only a tiny fragment', async () => {
  const { createMarketIndexHistoryService } = loadSubject();
  const service = createMarketIndexHistoryService({
    definitions: [{ key: 'tiny', code: '000001', name: '短历史', sinaSymbol: 'sh000001', eastmoneySecid: '1.000001' }],
    marketData: { get: async function() {
      return { data: [
        { day: '2026-08-27', open: '10', close: '10', high: '10', low: '10', volume: '1' },
        { day: '2026-08-28', open: '11', close: '11', high: '11', low: '11', volume: '1' }
      ] };
    } }
  });

  const result = await service.fetchIndexHistory(120);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.series[0].status, 'unavailable');
  assert.equal(result.series[0].requestedDays, 120);
  assert.equal(result.series[0].availableDays, 1);
  assert.match(result.series[0].reason, /实际 1 个收益日（2 个收盘点）/);
});

test('twenty close rows cannot claim a complete twenty-return window', async () => {
  const { createMarketIndexHistoryService } = loadSubject();
  const rows = Array.from({ length: 20 }, function(_, index) {
    const date = new Date(Date.UTC(2026, 6, index + 1)).toISOString().slice(0, 10);
    return { day: date, open: '10', close: String(10 + index), high: String(10 + index), low: '10', volume: '1' };
  });
  const service = createMarketIndexHistoryService({
    definitions: [{ key: 'short', code: '000001', name: '十九收益日', sinaSymbol: 'sh000001', eastmoneySecid: '1.000001' }],
    marketData: { get: async function() { return { data: rows }; } }
  });

  const result = await service.fetchIndexHistory(20);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.series[0].status, 'unavailable');
  assert.equal(result.series[0].requestedDays, 20);
  assert.equal(result.series[0].availableDays, 19);
  assert.equal(result.comparison.dates.length, 0);
  assert.equal(result.correlation.values.length, 0);
});

test('daily index history reuses a short-lived same-window result cache', async () => {
  const { createMarketIndexHistoryService } = loadSubject();
  let requests = 0;
  const rows = Array.from({ length: 21 }, function(_, index) {
    const date = new Date(Date.UTC(2026, 6, index + 1)).toISOString().slice(0, 10);
    return { day: date, open: '10', close: String(10 + index), high: String(10 + index), low: '10', volume: '1' };
  });
  const service = createMarketIndexHistoryService({
    definitions: [{ key: 'cached', code: '000001', name: '缓存指数', sinaSymbol: 'sh000001', eastmoneySecid: '1.000001' }],
    marketData: { get: async function() { requests += 1; return { data: rows }; } },
    cacheTtlMs: 60000,
    now: function() { return 1000; }
  });

  const first = await service.fetchIndexHistory(20);
  const second = await service.fetchIndexHistory(20);
  assert.equal(requests, 1);
  assert.equal(first.status, 'available');
  assert.equal(first.correlation.sampleCounts[0][0], 20);
  assert.equal(second, first);
});
