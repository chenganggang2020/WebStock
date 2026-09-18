const test = require('node:test');
const assert = require('node:assert/strict');

const MarketSignalModel = require('../js/modules/marketSignalModel');

function risingDailyRows() {
  const rows = [];
  for (let index = 0; index < 19; index += 1) {
    const close = Number((10 + (index + 1) * 0.1).toFixed(2));
    rows.push({
      date: '2026-07-' + String(index + 1).padStart(2, '0'),
      open: close - 0.05,
      close,
      high: close + 0.05,
      low: close - 0.1,
      volume: 100
    });
  }
  rows.push({
    date: '2026-08-26', open: 12, close: 12.2, high: 12.4, low: 11.8, volume: 200
  });
  return rows;
}

test('daily summary exposes change, gap, amplitude, volume ratio, moving averages and trend', () => {
  const result = MarketSignalModel.analyzeDaily(risingDailyRows());

  assert.equal(result.date, '2026-08-26');
  assert.equal(result.close, 12.2);
  assert.equal(result.changePercent, 2.52);
  assert.equal(result.gapPercent, 0.84);
  assert.equal(result.amplitudePercent, 5.04);
  assert.equal(result.volumeRatio5, 2);
  assert.equal(result.ma5, 11.84);
  assert.equal(result.ma10, 11.57);
  assert.equal(result.ma20, 11.06);
  assert.equal(result.trend, '多头排列');
});

test('simplified nine-turn counts close versus four sessions earlier and labels completed observations', () => {
  const result = MarketSignalModel.calculateNineTurn(risingDailyRows());

  assert.equal(result.direction, 'up');
  assert.equal(result.count >= 9, true);
  assert.equal(result.stage, 9);
  assert.equal(result.completed, true);
  assert.equal(result.label, '高9观察');
});

test('auction summary distinguishes opening proxy data from the 14:57-15:00 closing interval', () => {
  const minuteRows = [
    { time: '2026-08-26 09:30:00', price: 12, volume: 1000 },
    { time: '2026-08-26 10:00:00', price: 12.05, volume: 1000 },
    { time: '2026-08-26 14:57:00', price: 12.1, volume: 100 },
    { time: '2026-08-26 14:58:00', price: 12.15, volume: 200 },
    { time: '2026-08-26 14:59:00', price: 12.18, volume: 300 },
    { time: '2026-08-26 15:00:00', price: 12.2, volume: 400 }
  ];
  const result = MarketSignalModel.analyzeAuction(risingDailyRows(), minuteRows, {
    tradingDate: '2026-08-26', previousClose: 11.9, dataSource: 'tencent-1m'
  }, [
    { time: '2026-08-26 09:15:30', price: 11.8, volume: null },
    {
      time: '2026-08-26 09:25:00', price: 12, volume: 500,
      auctionReferencePrice: 12.01, auctionMatchedVolume: 36000,
      auctionUnmatchedBuyVolume: 6000, auctionUnmatchedSellVolume: null
    }
  ], { dataSource: 'local-public-quote-30s' });

  assert.equal(result.opening.openPrice, 12);
  assert.equal(result.opening.gapPercent, 0.84);
  assert.equal(result.opening.firstMinuteVolume, 1000);
  assert.equal(result.opening.volumeIsAuctionExact, false);
  assert.equal(result.opening.localObserved, true);
  assert.equal(result.opening.localSampleCount, 2);
  assert.equal(result.opening.localObservedChangePercent, 1.69);
  assert.equal(result.opening.localObservedVolume, 500);
  assert.equal(result.opening.dataStatus, 'local-public-auction-observed');
  assert.equal(result.opening.indicativePrice, 12.01);
  assert.equal(result.opening.indicativeMatchedVolume, 36000);
  assert.equal(result.opening.indicativeUnmatchedBuyVolume, 6000);
  assert.equal(result.closing.from, '14:57');
  assert.equal(result.closing.to, '15:00');
  assert.equal(result.closing.returnPercent, 0.83);
  assert.equal(result.closing.volumeSharePercent, 33.33);
  assert.equal(result.closing.dataStatus, 'public-minute-interval');
  assert.equal(result.source, 'tencent-1m');
});

test('local breakout observation uses an explicit 20-day high and 5-day volume threshold', () => {
  const result = MarketSignalModel.detectLocalSignals(risingDailyRows(), [], {});
  const breakout = result.find(function(item) { return item.key === 'breakout'; });

  assert.equal(breakout.active, true);
  assert.equal(breakout.label, '突·放量突破观察');
  assert.match(breakout.reason, /20日高点/);
  assert.match(breakout.rule, /1\.2倍/);
  assert.equal(breakout.proprietaryEquivalent, false);
});

test('missing inputs stay unavailable instead of inventing auction or signal values', () => {
  const auction = MarketSignalModel.analyzeAuction([], [], {});
  const daily = MarketSignalModel.analyzeDaily([]);

  assert.equal(daily.available, false);
  assert.equal(auction.available, false);
  assert.equal(auction.opening.gapPercent, null);
  assert.equal(auction.closing.returnPercent, null);
});

test('auction analysis does not combine an older minute day with the latest daily bar', () => {
  const result = MarketSignalModel.analyzeAuction(risingDailyRows(), [
    { time: '2026-08-20 09:30:00', price: 10, volume: 1000 },
    { time: '2026-08-20 15:00:00', price: 10.1, volume: 2000 }
  ], { tradingDate: '2026-08-20', previousClose: 9.8, dataSource: 'cache' });

  assert.equal(result.tradingDate, '2026-08-26');
  assert.equal(result.opening.previousClose, 11.9);
  assert.equal(result.opening.firstMinuteVolume, null);
  assert.equal(result.closing.returnPercent, null);
  assert.equal(result.minuteDateMatched, false);
});

test('intraday markers identify the open, closing auction interval and a triggered local breakout', () => {
  const minuteRows = [];
  for (let index = 0; index < 18; index += 1) {
    minuteRows.push({
      time: '2026-08-27 ' + (index === 0 ? '09:30' : '10:' + String(index).padStart(2, '0')) + ':00',
      price: index < 15 ? 10 + index * 0.01 : 10.5 + index * 0.02,
      volume: index < 15 ? 100 : 300
    });
  }
  minuteRows.push({ time: '2026-08-27 14:57:00', price: 10.9, volume: 120 });

  const markers = MarketSignalModel.buildIntradayMarkers(minuteRows);

  assert.ok(markers.some(marker => marker.value === '开' && marker.time === '09:30'));
  assert.ok(markers.some(marker => marker.value === '突' && marker.time === '10:17'));
  assert.ok(markers.some(marker => marker.value === '尾' && marker.time === '14:57'));
  assert.ok(markers.every(marker => marker.triggerUsesFutureData === false));
});
