const test = require('node:test');
const assert = require('node:assert/strict');

test('bar-end axes do not invent an empty session-start bucket or a lunch gap', () => {
  const model = require('../js/modules/realtimeChartModel');
  for (const seconds of [5,30]) {
    const axis=model.buildCompressedTradingAxis([], {intervalSeconds:seconds,timestampMeaning:'bar-end'});
    assert.equal(axis.times.includes('09:30'),false);
    assert.equal(axis.times.includes('13:00'),false);
    const noon=axis.times.indexOf('11:30');
    assert.equal(axis.times[noon+1],seconds===5?'13:00:05':'13:00:30');
    // Real intraday gaps remain on the expected axis.
    assert.ok(axis.times.includes(seconds===5?'13:46:20':'13:46:30'));
  }
});

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
  const auction = new Date('2026-08-12T01:20:00.000Z'); // 09:20 Asia/Shanghai
  const morning = new Date('2026-08-12T02:00:00.000Z'); // 10:00 Asia/Shanghai
  const lunch = new Date('2026-08-12T04:00:00.000Z'); // 12:00 Asia/Shanghai
  const weekend = new Date('2026-08-15T02:00:00.000Z');

  assert.equal(RealtimeChartModel.isChinaTradingSession(morning), true);
  assert.equal(RealtimeChartModel.isChinaTradingSession(auction), false);
  assert.equal(RealtimeChartModel.isChinaMarketDataSession(auction), true);
  assert.equal(RealtimeChartModel.refreshDelayMs(auction), 3000);
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

  assert.equal(axis.times[morningEnd + 1], '13:00');
  assert.equal(axis.times.includes('12:00'), false);
  assert.equal(axis.times.includes('13:00'), true);
  assert.deepEqual(axis.observedTimes, ['11:25', '11:30', '13:05', '13:10']);
  assert.equal(axis.firstAfternoonIndex, morningEnd + 1);
});

test('intraday axis keeps the complete fixed trading-day frame for sparse live samples', () => {
  const rows = [
    { time: '2026-09-01 09:45:05', price: 10 },
    { time: '2026-09-01 10:30:00', price: 10.2 }
  ];
  const axis = RealtimeChartModel.buildCompressedTradingAxis(rows, {
    intervalSeconds: 5,
    intervalMinutes: 5 / 60
  });

  assert.equal(axis.times[0], '09:30');
  assert.equal(axis.times[axis.times.length - 1], '15:00');
  assert.equal(axis.times.includes('13:00'), true);
  assert.deepEqual(RealtimeChartModel.buildFixedTradingViewport(), {
    start: 0, end: 100, focused: false
  });
});

test('opening-auction frame is optional and remains separate from continuous trading', () => {
  const rows = [
    { time: '2026-09-01 09:15:00', price: 9.9 },
    { time: '2026-09-01 09:25:00', price: 10 },
    { time: '2026-09-01 09:31:00', price: 10.1 }
  ];
  const hidden = RealtimeChartModel.buildCompressedTradingAxis(rows, { intervalSeconds: 60 });
  const visible = RealtimeChartModel.buildCompressedTradingAxis(rows, {
    intervalSeconds: 60,
    includeAuction: true
  });

  assert.equal(hidden.times[0], '09:30');
  assert.equal(hidden.times.includes('09:15'), false);
  assert.equal(visible.times[0], '09:15');
  assert.equal(visible.times.includes('09:25'), true);
  assert.equal(visible.times.includes('09:26'), false);
  assert.equal(visible.times.includes('09:30'), true);
  assert.equal(visible.times[visible.times.length - 1], '15:00');
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

test('readable price domain keeps yesterday close visible without mirroring a large decline into empty upside space', () => {
  const domain = RealtimeChartModel.buildReadablePriceDomain([152, 147, 144, 146], 153.4);

  assert.ok(domain.min < 144);
  assert.ok(domain.max > 153.4);
  assert.ok(domain.max - 153.4 < 2, 'upside padding stays compact instead of mirroring the full decline');
  assert.ok(153.4 - domain.min > domain.max - 153.4);
});

test('stale quote is aligned to the trading date and previous close carried by minute data', () => {
  const rows = [
    { time: '2026-08-26 09:30:00', price: 11.55, volume: 100, amount: 1155 },
    { time: '2026-08-26 15:00:00', price: 11.73, volume: 200, amount: 2346 }
  ];
  const staleQuote = {
    code: '000001', name: '平安银行', price: 11.27, prevClose: 11.27,
    change: 0, tradeDate: '2026-08-20', stale: false, quoteStatus: 'latest-close'
  };

  const aligned = RealtimeChartModel.alignQuoteToMinute(staleQuote, rows, {
    dataSource: 'tencent-1m', tradingDate: '2026-08-26', previousClose: 11.59,
    latestPrice: 11.73, openPrice: 11.55, highPrice: 11.75, lowPrice: 11.52
  });

  assert.equal(aligned.price, 11.73);
  assert.equal(aligned.prevClose, 11.59);
  assert.equal(aligned.change, 1.21);
  assert.equal(aligned.tradeDate, '2026-08-26');
  assert.equal(aligned.open, 11.55);
  assert.equal(aligned.high, 11.75);
  assert.equal(aligned.low, 11.52);
  assert.equal(aligned.minuteAligned, true);
});

test('same-day live quote is not replaced by an older minute sample', () => {
  const liveQuote = {
    code: '000001', price: 11.76, prevClose: 11.59, change: 1.47,
    tradeDate: '2026-08-26', quoteStatus: 'live', stale: false
  };
  const aligned = RealtimeChartModel.alignQuoteToMinute(liveQuote, [
    { time: '2026-08-26 14:59:00', price: 11.73 }
  ], { tradingDate: '2026-08-26', previousClose: 11.59, latestPrice: 11.73 });

  assert.equal(aligned.price, 11.76);
  assert.equal(aligned.minuteAligned, undefined);
});

test('daily chart appends the current trading-day minute bar without pretending it is closed', () => {
  const daily = [
    { date: '2026-09-01', open: 9.8, high: 10.2, low: 9.7, close: 10, volume: 1000, amount: 10000 }
  ];
  const minute = [
    { time: '2026-09-02 09:30:00', open: 10.1, price: 10.1, high: 10.2, low: 10, volume: 100, amount: 1010 },
    { time: '2026-09-02 09:31:00', open: 10.1, price: 10.5, high: 10.8, low: 10.1, volume: 200, amount: 2100 }
  ];

  const merged = RealtimeChartModel.mergeCurrentDailyBar(daily, minute, {
    tradingDate: '2026-09-02', previousClose: 10, latestPrice: 10.5,
    openPrice: 10.1, highPrice: 10.8, lowPrice: 10,
    dataSource: 'tencent-1m', marketState: 'live', stale: false
  });

  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0], daily[0]);
  assert.deepEqual(merged[1], {
    date: '2026-09-02', open: 10.1, close: 10.5, high: 10.8, low: 10,
    volume: 300, amount: 3110, intraday: true, incomplete: true,
    observedAt: '2026-09-02 09:31:00', dataSource: 'tencent-1m', stale: false
  });
});

test('daily chart does not append an older minute session over newer historical bars', () => {
  const daily = [{ date: '2026-09-02', open: 10, high: 11, low: 9.8, close: 10.8, volume: 1000, amount: 10000 }];
  const merged = RealtimeChartModel.mergeCurrentDailyBar(daily, [
    { time: '2026-09-01 15:00:00', price: 9.9, volume: 100, amount: 990 }
  ], { tradingDate: '2026-09-01', dataSource: 'cache' });

  assert.deepEqual(merged, daily);
  assert.notEqual(merged, daily);
});

test('quote freshness uses the provider time, never a fresh HTTP fetch time', () => {
  const now = new Date('2026-10-09T10:03:00+08:00');
  const result = RealtimeChartModel.quoteFreshness({
    tradeDate: '2026-10-09', tradeTime: '10:00:00', quoteStatus: 'live',
    fetchedAt: now.toISOString()
  }, now);
  assert.equal(result.delayed, true);
  assert.equal(result.ageSeconds, 180);
  assert.match(result.label, /10:00:00.*滞后180秒/);
  assert.equal(RealtimeChartModel.quoteFreshness({ fetchedAt: now.toISOString() }, now).ageSeconds, null);
});

test('latest close, fresh quote, and malformed provider times have distinct freshness labels', () => {
  const quote = { providerObservedAt: '2026-10-09T02:00:00Z', quoteStatus: 'live' };
  assert.equal(RealtimeChartModel.quoteFreshness(quote, new Date('2026-10-09T10:00:03+08:00')).delayed, false);
  const closed = RealtimeChartModel.quoteFreshness({ tradeDate: '2026-10-09', tradeTime: '15:00:01',
    quoteStatus: 'latest-close' }, new Date('2026-10-09T15:35:00+08:00'));
  assert.equal(closed.delayed, false);
  assert.match(closed.label, /最近收盘/);
  const unknown = RealtimeChartModel.quoteFreshness({ providerObservedAt: '<img onerror=x>' });
  assert.match(unknown.label, /时间未提供/);
  assert.doesNotMatch(unknown.label, /img/);
});

test('daily tooltip metrics expose price change percentage and amplitude against prior close', () => {
  const metrics = RealtimeChartModel.dailyBarMetrics([
    { date: '2026-09-01', close: 10 },
    { date: '2026-09-02', open: 10.1, high: 10.8, low: 9.9, close: 10.5 }
  ], 1);

  assert.deepEqual(metrics, {
    previousClose: 10,
    changeAmount: 0.5,
    changePercent: 5,
    amplitudePercent: 9
  });
});
