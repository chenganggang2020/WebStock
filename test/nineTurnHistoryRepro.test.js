const test = require('node:test');
const assert = require('node:assert/strict');

const MarketSignalModel = require('../js/modules/marketSignalModel');

function dailyRows(closes) {
  return closes.map((close, index) => ({
    date: '2026-01-' + String(index + 1).padStart(2, '0'),
    open: close,
    high: close,
    low: close,
    close,
    volume: 100
  }));
}

function risingRows(length) {
  return dailyRows(Array.from({ length }, (_, index) => 10 + index));
}

function calculateSeries(rows) {
  assert.equal(typeof MarketSignalModel.calculateNineTurnSeries, 'function',
    'historical nine-turn observations need a same-length per-bar series, not only the latest bar');
  return MarketSignalModel.calculateNineTurnSeries(rows);
}

test('nine-turn history counts four-bar comparisons at their original bar dates', () => {
  const rows = risingRows(15);
  const series = calculateSeries(rows);

  assert.equal(series.length, rows.length);
  assert.deepEqual(series.map(item => item.index), rows.map((_, index) => index));
  assert.deepEqual(series.map(item => item.date), rows.map(row => row.date));
  assert.deepEqual(series.map(item => item.count), [0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.ok(series.slice(0, 4).every(item => item.available === false));
  assert.ok(series.slice(4).every(item => item.direction === 'up'));
  assert.equal(series[12].stage, 9);
  assert.equal(series[12].completed, true);
});

test('nine-turn completion stays visible in history and triggers once per same-direction run', () => {
  const rows = risingRows(18);
  const series = calculateSeries(rows);
  const events = series.filter(item => item.triggered);

  assert.deepEqual(events.map(item => ({ index: item.index, date: item.date, direction: item.direction })), [
    { index: 12, date: rows[12].date, direction: 'up' }
  ]);
  assert.equal(series[17].completed, true, 'latest observation may remain at stage nine');
  assert.equal(series[17].triggered, false, 'remaining at stage nine is not a second historical event');
});

test('nine-turn detects downward completion with the same four-bar comparison rule', () => {
  const rows = dailyRows(Array.from({ length: 15 }, (_, index) => 100 - index));
  const series = calculateSeries(rows);

  assert.equal(series[12].direction, 'down');
  assert.equal(series[12].count, 9);
  assert.equal(series[12].triggered, true);
  assert.equal(series[12].label, '低9观察');
  assert.equal(series[14].triggered, false);
});

test('equal closes reset the sequence instead of extending the previous direction', () => {
  const rows = risingRows(13);
  rows[9].close = rows[5].close;
  const series = calculateSeries(rows);

  assert.equal(series[8].count, 5);
  assert.equal(series[9].direction, null);
  assert.equal(series[9].count, 0);
  assert.equal(series[9].triggered, false);
  assert.equal(series[10].direction, 'up');
  assert.equal(series[10].count, 1);
});

test('a comparison direction flip starts a new sequence at one', () => {
  const rows = dailyRows([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 5, 4, 3, 2, 1]);
  const series = calculateSeries(rows);

  assert.equal(series[12].direction, 'up');
  assert.equal(series[12].triggered, true);
  assert.equal(series[13].direction, 'down');
  assert.equal(series[13].count, 1);
  assert.equal(series[13].completed, false);
  assert.equal(series[17].count, 5);
});

test('separate upward and downward runs each retain exactly one historical completion event', () => {
  const rows = dailyRows([50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62,
    30, 29, 28, 27, 26, 25, 24, 23, 22, 21]);
  const series = calculateSeries(rows);

  assert.deepEqual(series.filter(item => item.triggered).map(item => [item.index, item.direction]), [
    [12, 'up'], [21, 'down']
  ]);
  assert.equal(series[22].completed, true);
  assert.equal(series[22].triggered, false);
});

test('invalid closes retain their position and break the contiguous comparison window', () => {
  for (const invalidClose of [null, undefined, '', 0, -1, NaN, Infinity, 'not-a-price', true, false]) {
    const rows = risingRows(14);
    rows[8].close = invalidClose;
    const series = calculateSeries(rows);

    assert.equal(series.length, rows.length);
    assert.equal(series[8].date, rows[8].date);
    assert.ok(series.slice(8, 13).every(item => item.available === false && item.count === 0),
      'an invalid bar must not be filtered out or bridged by a comparison');
    assert.equal(series[13].index, 13);
    assert.equal(series[13].count, 1);
    assert.equal(series[13].completed, false);
  }
});

test('an absent row is a missing bar rather than a removable array entry', () => {
  const rows = risingRows(14);
  rows[8] = null;
  const series = calculateSeries(rows);

  assert.equal(series.length, rows.length);
  assert.equal(series[8].index, 8);
  assert.equal(series[8].available, false);
  assert.equal(series[13].count, 1);
});

test('boolean latest closes cannot be accepted as numeric price observations', () => {
  for (const close of [true, false]) {
    const rows = risingRows(14);
    rows[13].close = close;
    const latest = MarketSignalModel.calculateNineTurn(rows);

    assert.equal(latest.available, false);
    assert.equal(latest.count, 0);
    assert.equal(latest.completed, false);
  }
});

test('an invalid latest bar is not silently replaced with a completed previous observation', () => {
  const rows = risingRows(14);
  rows[13].close = null;
  const latest = MarketSignalModel.calculateNineTurn(rows);

  assert.equal(latest.available, false);
  assert.equal(latest.count, 0);
  assert.equal(latest.completed, false);
});

test('latest nine-turn summary cannot manufacture completion by dropping an interior missing bar', () => {
  const rows = risingRows(14);
  rows[8].close = null;
  const latest = MarketSignalModel.calculateNineTurn(rows);

  assert.equal(latest.available, true);
  assert.equal(latest.direction, 'up');
  assert.equal(latest.count, 1);
  assert.equal(latest.completed, false);
});

test('appending future rows never changes any existing historical observation', () => {
  const rows = dailyRows([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 5, 4, 3, 2, 1]);
  const completeSeries = calculateSeries(rows);

  for (let length = 1; length <= rows.length; length += 1) {
    assert.deepEqual(calculateSeries(rows.slice(0, length)), completeSeries.slice(0, length),
      'a historical event can use only information available at that bar');
  }
});

test('nine-turn history leaves caller rows unchanged and keeps empty history empty', () => {
  const rows = risingRows(14).map(row => Object.freeze(row));
  Object.freeze(rows);

  assert.equal(calculateSeries(rows).length, rows.length);
  assert.deepEqual(calculateSeries([]), []);
  assert.deepEqual(calculateSeries(null), []);
});

test('an unfinished current bar is a provisional count, never a confirmed historical event', () => {
  const rows = risingRows(13);
  rows[12].incomplete = true;
  const latest = MarketSignalModel.calculateNineTurn(rows);
  assert.equal(latest.count, 9);
  assert.equal(latest.provisional, true);
  assert.equal(latest.completed, false);
  assert.equal(latest.triggered, false);
});

test('historical nine-turn outcomes are post-event observations with complete horizons only', () => {
  const rows = risingRows(20);
  const result = MarketSignalModel.evaluateNineTurnHistory(rows);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].index, 12);
  assert.equal(result.events[0].outcomes[5].status, 'available');
  assert.equal(result.events[0].outcomes[5].returnPct, 22.73);
  assert.equal(result.events[0].outcomes[20].status, 'pending');
  assert.equal(result.events[0].outcomes[20].returnPct, null);
  assert.equal(result.triggerUsesFutureData, false);
  assert.equal(result.validationUsesFutureData, true);
  rows[14].close = null;
  assert.equal(MarketSignalModel.evaluateNineTurnHistory(rows).events[0].outcomes[5].status, 'invalid');
  rows[14] = null;
  assert.equal(MarketSignalModel.evaluateNineTurnHistory(rows).events[0].outcomes[5].status, 'invalid');
});

test('a provider daily bar without an incomplete flag is provisional before the session closes', () => {
  const rows = risingRows(13);
  const asOf = '2026-01-13T14:30:00+08:00';
  assert.equal(MarketSignalModel.calculateNineTurn(rows, { asOf }).completed, false);
  assert.equal(MarketSignalModel.evaluateNineTurnHistory(rows, { asOf }).events.length, 0);
  assert.equal(MarketSignalModel.evaluateNineTurnHistory(rows, { asOf: '2026-01-13T15:01:00+08:00' }).events.length, 1);
  const later = risingRows(18);
  assert.equal(MarketSignalModel.evaluateNineTurnHistory(later, { asOf: '2026-01-18T10:00:00+08:00' }).events[0].outcomes[5].status, 'pending');
});
