const test = require('node:test');
const assert = require('node:assert/strict');

const RealtimeChartModel = require('../js/modules/realtimeChartModel');

test('minute series keeps missing provider samples empty instead of carrying prices forward', () => {
  const result = RealtimeChartModel.buildMinuteSeries(
    ['09:30', '09:35', '09:40'],
    [
      { time: '2026-08-12 09:30:00', price: 10, volume: 100, amount: 1000 },
      { time: '2026-08-12 09:40:00', price: 10.2, volume: 100, amount: 1020 }
    ],
    { cutoffMinutes: 10 * 60, previousClose: 9.9 }
  );

  assert.deepEqual(result.prices, [10, null, 10.2]);
  assert.deepEqual(result.averagePrices, [10, null, 10.1]);
  assert.deepEqual(result.volumes, [100, null, 100]);
  assert.equal(result.observedSamples, 2);
  assert.equal(result.missingSamples, 1);
});

test('minute series rejects invalid prices and leaves future slots empty', () => {
  const result = RealtimeChartModel.buildMinuteSeries(
    ['09:30', '09:35', '09:40'],
    [
      { time: '2026-08-12 09:30:00', price: 0, volume: 100, amount: 1000 },
      { time: '2026-08-12 09:35:00', price: 10.1, volume: 120, amount: 1212 }
    ],
    { cutoffMinutes: 9 * 60 + 35, previousClose: 10 }
  );

  assert.deepEqual(result.prices, [null, 10.1, null]);
  assert.deepEqual(result.averagePrices, [null, 10.1, null]);
  assert.deepEqual(result.volumes, [100, 120, null]);
  assert.equal(result.invalidPriceSamples, 1);
});

test('average line stays empty until observed volume establishes a real average', () => {
  const result = RealtimeChartModel.buildMinuteSeries(
    ['09:30', '09:35'],
    [
      { time: '2026-08-12 09:30:00', price: 10, volume: 0, amount: 0 },
      { time: '2026-08-12 09:35:00', price: 10.1, volume: 100, amount: 1010 }
    ],
    { cutoffMinutes: 10 * 60, previousClose: 9.9 }
  );

  assert.deepEqual(result.averagePrices, [null, 10.1]);
});

test('refresh policy prioritizes the visible market, holdings and watchlist during China trading sessions', () => {
  const morning = new Date('2026-08-12T02:00:00.000Z'); // 10:00 Asia/Shanghai
  const lunch = new Date('2026-08-12T04:00:00.000Z'); // 12:00 Asia/Shanghai
  const weekend = new Date('2026-08-15T02:00:00.000Z');

  assert.equal(RealtimeChartModel.isChinaTradingSession(morning), true);
  assert.equal(RealtimeChartModel.refreshDelayMs(morning), 3000);
  assert.equal(RealtimeChartModel.activeViewRefreshDelayMs('portfolio', morning), 3000);
  assert.equal(RealtimeChartModel.activeViewRefreshDelayMs('watchlist', morning), 3000);
  assert.equal(RealtimeChartModel.activeViewRefreshDelayMs('recent', morning), 3000);
  assert.equal(RealtimeChartModel.activeViewRefreshDelayMs('dashboard', morning), 15000);
  assert.equal(RealtimeChartModel.isChinaTradingSession(lunch), false);
  assert.equal(RealtimeChartModel.refreshDelayMs(lunch), 60000);
  assert.equal(RealtimeChartModel.activeViewRefreshDelayMs('portfolio', lunch), 60000);
  assert.equal(RealtimeChartModel.isChinaTradingSession(weekend), false);
  assert.equal(RealtimeChartModel.refreshDelayMs(weekend), 60000);
});

test('snapshot key ignores response metadata churn but changes with curve data', () => {
  const rows = [
    { time: '2026-08-12 09:30:00', price: 10, volume: 100, amount: 1000 },
    { time: '2026-08-12 09:35:00', price: 10.1, volume: 120, amount: 1212 }
  ];
  const quote = { code: '000001', prevClose: 9.9, price: 10.1 };

  const first = RealtimeChartModel.snapshotKey(rows, quote, { fetchedAt: '2026-08-12T01:35:00Z' });
  const sameCurve = RealtimeChartModel.snapshotKey(
    rows.slice().reverse().map(row => Object.assign({}, row)),
    Object.assign({}, quote),
    { fetchedAt: '2026-08-12T01:35:15Z', cache: 'miss' }
  );
  const changedCurve = RealtimeChartModel.snapshotKey(
    [rows[0], Object.assign({}, rows[1], { price: 10.12 })],
    quote,
    { fetchedAt: '2026-08-12T01:35:15Z' }
  );

  assert.equal(first, sameCurve);
  assert.notEqual(first, changedCurve);
});

test('compressed trading axis keeps every real sample and removes the lunch wall-clock gap', () => {
  const rows = [
    { time: '2026-08-12 11:25:00', price: 10.1 },
    { time: '2026-08-12 11:30:00', price: 10.2 },
    { time: '2026-08-12 13:05:00', price: 10.15 },
    { time: '2026-08-12 13:10:00', price: 10.25 }
  ];

  const axis = RealtimeChartModel.buildCompressedTradingAxis(rows, { intervalMinutes: 5 });
  const morningEnd = axis.times.indexOf('11:30');

  assert.equal(axis.times[morningEnd + 1], '13:05');
  assert.equal(axis.times.includes('12:00'), false);
  assert.equal(axis.times.includes('13:00'), false);
  assert.deepEqual(axis.observedTimes, ['11:25', '11:30', '13:05', '13:10']);
  assert.equal(axis.firstAfternoonIndex, morningEnd + 1);
});

test('sampling metadata reports the real provider interval without inventing one-minute points', () => {
  const rows = [
    { time: '2026-08-12 09:35:00', price: 10 },
    { time: '2026-08-12 09:40:00', price: 10.1 },
    { time: '2026-08-12 09:45:00', price: 10.2 },
    { time: '2026-08-12 13:05:00', price: 10.3 }
  ];

  const sampling = RealtimeChartModel.describeSampling(rows, {
    dataSource: 'sina-5m',
    sampling: { intervalMinutes: 5, timestampMeaning: 'bar-end' }
  });

  assert.equal(sampling.intervalMinutes, 5);
  assert.equal(sampling.label, '5分钟采样');
  assert.equal(sampling.observedPoints, 4);
  assert.equal(sampling.timestampMeaning, 'bar-end');
  assert.equal(sampling.inferred, false);
});

test('thirty-second local bars keep both half-minute samples and compress lunch', () => {
  const rows = [
    { time: '2026-08-14 09:30:30', price: 10, volume: 100, amount: 1000 },
    { time: '2026-08-14 09:31:00', price: 10.05, volume: 50, amount: 502.5 },
    { time: '2026-08-14 13:00:30', price: 10.1, volume: null, amount: null }
  ];
  const meta = {
    dataSource: 'local-public-quote-30s',
    sampling: {
      intervalSeconds: 30,
      intervalMinutes: 0.5,
      label: '\u672c\u573030\u79d2\u5feb\u7167',
      timestampMeaning: 'bar-end',
      expectedFullDayPoints: 480
    }
  };

  const sampling = RealtimeChartModel.describeSampling(rows, meta);
  const axis = RealtimeChartModel.buildCompressedTradingAxis(rows, sampling);
  const series = RealtimeChartModel.buildMinuteSeries(axis.times, rows, {
    cutoffMinutes: 15 * 60,
    previousClose: 9.9
  });

  assert.equal(sampling.intervalSeconds, 30);
  assert.equal(sampling.label, '\u672c\u573030\u79d2\u5feb\u7167');
  assert.deepEqual(axis.observedTimes, ['09:30:30', '09:31', '13:00:30']);
  assert.equal(axis.times.includes('12:00'), false);
  assert.equal(series.prices[axis.times.indexOf('09:30:30')], 10);
  assert.equal(series.prices[axis.times.indexOf('09:31')], 10.05);
  assert.equal(series.volumes[axis.times.indexOf('13:00:30')], null);
});

test('price range is expressed against the real previous close for compact labels', () => {
  const range = RealtimeChartModel.priceRangePercent([9.9, 10.2, 10.05], 10);

  assert.deepEqual(range, {
    highPrice: 10.2,
    lowPrice: 9.9,
    highPercent: 2,
    lowPercent: -1
  });
  assert.equal(RealtimeChartModel.priceRangePercent([], 10), null);
});
