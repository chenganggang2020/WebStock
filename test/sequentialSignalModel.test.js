const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Model = require('../js/modules/sequentialSignalModel');

function candles(closes) {
  return closes.map((close, index) => ({
    date: new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10),
    open: close, high: close + 0.4, low: close - 0.4, close, incomplete: false
  }));
}
function buySetup() { return candles([100, 101, 102, 103, 104, 99, 98, 97, 96, 95, 94, 93, 92, 91]); }
function buyCycle() { return candles([100, 101, 102, 103, 104, ...Array.from({ length: 21 }, (_, i) => 99 - i)]); }

test('requires a strict price flip, preserves all Setup 1–9 marks, starts Countdown on Setup 9', () => {
  assert.equal(Model.calculateSeries(candles(Array.from({ length: 20 }, (_, i) => 100 - i))).some(x => x.setup.count), false);
  const result = Model.calculateSeries(buySetup());
  assert.deepEqual(result.slice(5).map(x => x.setup.count), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(result[13].setup.triggered, true);
  assert.equal(result[13].setup.perfected, true);
  assert.equal(result[13].countdown.count, 1);
  assert.equal(result[13].levels.resistance.price, 104);
});

test('sell rules mirror buy rules and include true lows in TDST', () => {
  const rows = buyCycle().map(row => ({ ...row, close: 220 - row.close, open: 220 - row.open,
    high: 220 - row.low, low: 220 - row.high }));
  const result = Model.calculateSeries(rows);
  assert.equal(result[13].setup.direction, 'sell');
  assert.equal(result[13].levels.support.price, 116);
  assert.equal(result.at(-1).countdown.count, 13);
  assert.equal(result.at(-1).countdown.triggered, true);
});

test('equality breaks Setup and does not invent a new strict flip', () => {
  const rows = buySetup();
  rows[8] = { ...rows[8], close: rows[4].close, open: rows[4].close, high: rows[4].close + 1, low: rows[4].close - 1 };
  const result = Model.calculateSeries(rows);
  assert.equal(result[8].setup.count, 0);
  assert.equal(result[9].setup.count, 0);
  assert.equal(result.some(x => x.setup.triggered), false);
});

test('imperfect 9 can perfect later without rewriting the historical 9', () => {
  const rows = buySetup();
  rows[10].low = 80; rows[11].low = 81;
  rows.push({ ...candles([90])[0], date: '2025-01-15', low: 79 });
  const result = Model.calculateSeries(rows);
  assert.equal(result[13].setup.perfected, false);
  assert.equal(result[14].events.some(x => x.type === 'setup-perfected'), true);
  assert.deepEqual(Model.calculateSeries(rows.slice(0, 14)), result.slice(0, 14));
});

test('Countdown is nonconsecutive and 13 vs 8 defers rather than falsely completes', () => {
  const closes = [100, 101, 102, 103, 104, ...Array.from({ length: 16 }, (_, i) => 99 - i), 100, 83, 95, 82, 94, 90, 93, 81];
  const result = Model.calculateSeries(candles(closes));
  assert.equal(result[20].countdown.count, 8);
  assert.equal(result[21].countdown.count, 8);
  assert.equal(result[21].countdown.qualified, false);
  assert.equal(result[27].countdown.count, 12);
  assert.equal(result[27].countdown.deferred, true);
  assert.equal(result[27].marks.some(x => x.label === '+'), true);
  assert.equal(result[28].countdown.triggered, true);
  assert.equal(result[28].countdown.count, 13);
});

test('opposite completed Setup cancels a pending Countdown, without erasing previous observations', () => {
  const rows = candles([100, 101, 102, 103, 104, ...Array.from({ length: 9 }, (_, i) => 99 - i),
    ...Array.from({ length: 14 }, (_, i) => 95 + i)]).map(row => ({ ...row, high: 150, low: 40 }));
  const result = Model.calculateSeries(rows);
  const cancellation = result.flatMap(x => x.events).find(x => x.reason === 'opposite-setup');
  assert.ok(cancellation);
  assert.equal(cancellation.direction, 'buy');
  assert.equal(result[cancellation.index].setup.direction, 'sell');
  assert.equal(result[13].setup.triggered, true);
});

test('a true-low breach cancels buy Countdown only after the prior close also clears TDST', () => {
  const rows = buySetup();
  rows.push(...candles([110, 111]).map((row, i) => ({ ...row, date: '2025-01-' + (15 + i) })));
  const result = Model.calculateSeries(rows);
  assert.equal(result[14].events.some(x => x.reason === 'tdst-breach'), false);
  assert.equal(result[15].events.some(x => x.reason === 'tdst-breach'), true);
});

test('an unfinished Countdown recycles at extended Setup 22; completed 13 is never deleted', () => {
  const pending = candles([100, 101, 102, 103, 104, ...Array.from({ length: 22 }, (_, i) => 99 - i)])
    .map(row => ({ ...row, low: 40 }));
  const result = Model.calculateSeries(pending);
  assert.equal(result[26].events.some(x => x.type === 'countdown-recycled' && x.reason === 'setup-22'), true);
  const complete = buyCycle();
  complete.push({ ...candles([78])[0], date: '2025-01-27' });
  const completed = Model.calculateSeries(complete);
  assert.equal(completed[25].countdown.triggered, true);
  assert.deepEqual(completed.slice(0, 26), Model.calculateSeries(complete.slice(0, 26)));
  assert.equal(completed[26].events.some(x => x.type === 'countdown-recycled'), false);
});

test('a later same-direction Setup with 100–200 percent true range recycles a pending count', () => {
  const closes = [100, 101, 102, 103, 104, ...Array.from({ length: 9 }, (_, i) => 99 - i), 97, 98, 99, 100,
    ...Array.from({ length: 14 }, (_, i) => 96 - i)];
  const rows = candles(closes).map((row, index) => ({ ...row, high: 110, low: index < 18 ? 80 : 70 }));
  const events = Model.calculateSeries(rows).flatMap(x => x.events);
  assert.ok(events.some(x => x.type === 'countdown-recycled' && x.reason === 'setup-range'));
});

test('null, invalid OHLC, missing-bar markers and out-of-order dates cannot be compressed into a 9', () => {
  for (const replacement of [null, { close: 96 }, { ...buySetup()[8], gap: true }, { ...buySetup()[8], high: 2 }]) {
    const rows = buySetup(); rows[8] = replacement;
    const result = Model.calculateSeries(rows);
    assert.equal(result.length, rows.length);
    assert.equal(result[8].available, false);
    assert.equal(result.some(x => x.setup.triggered), false);
  }
  const duplicate = buySetup(); duplicate[8].date = duplicate[7].date;
  assert.equal(Model.calculateSeries(duplicate)[8].available, false);
});

test('unfinished bars preview counts but never trigger or seed later confirmed counts', () => {
  const rows = buySetup(); rows[13].incomplete = true;
  const result = Model.calculateSeries(rows);
  assert.equal(result[13].setup.count, 9);
  assert.equal(result[13].setup.triggered, false);
  assert.equal(result[13].provisional, true);
  assert.equal(result[13].marks.every(x => !x.confirmed), true);
  rows.push({ ...candles([90])[0], date: '2025-01-15' });
  assert.equal(Model.calculateSeries(rows)[14].countdown.count, 0);
});

test('missing completion metadata is explicitly unknown rather than a confirmed historical signal', () => {
  const rows = buySetup().map(({ incomplete, ...row }) => row);
  const last = Model.calculateSeries(rows).at(-1);
  assert.equal(last.confirmation, 'unknown');
  assert.equal(last.setup.triggered, false);
  assert.equal(Model.evaluateHistory(rows).events.length, 0);
});

test('asOf distinguishes daily, weekly, monthly and minute completion; future inputs are excluded', () => {
  const daily = buySetup().map(row => { const { incomplete, ...other } = row; return other; });
  daily.at(-1).date = '2026-10-02';
  const options = { asOf: '2026-10-02T07:30:00Z' };
  assert.equal(Model.calculateSeries(daily, { ...options, timeframe: 'day' }).at(-1).provisional, false);
  assert.equal(Model.calculateSeries(daily, { ...options, timeframe: 'month' }).at(-1).provisional, true);
  daily.at(-1).date = '2026-10-01';
  assert.equal(Model.calculateSeries(daily, { asOf: '2026-10-01T08:00:00Z', timeframe: 'week' }).at(-1).provisional, true);
  daily.at(-1).date = '2026-10-03';
  assert.equal(Model.calculateSeries(daily, options).at(-1).available, false);
  daily.at(-1).date = '2026-10-02 10:00:00';
  assert.equal(Model.calculateSeries(daily, { asOf: '2026-10-02T02:00:30Z', timeframe: '1m' }).at(-1).provisional, true);
  assert.equal(Model.calculateSeries(daily, { asOf: '2026-10-02T02:01:00Z', timeframe: '1m' }).at(-1).provisional, false);
});

test('history outcomes expose pending and invalid horizons and exclude provisional signals', () => {
  const rows = buySetup();
  rows.push(...candles([90, 89, 88]).map((row, i) => ({ ...row, date: '2025-01-' + (15 + i) })));
  rows[15] = null;
  const result = Model.evaluateHistory(rows, { horizons: [1, 2, 5] });
  const event = result.events.find(x => x.type === 'setup-complete');
  assert.equal(event.outcomes[1].status, 'available');
  assert.equal(event.outcomes[1].returnPct, -1.1);
  assert.equal(event.outcomes[2].status, 'invalid');
  assert.equal(event.outcomes[5].status, 'invalid');
  assert.equal(Model.evaluateHistory(buySetup(), { horizons: [1] }).events[0].outcomes[1].status, 'pending');
  const provisional = buySetup(); provisional[13].incomplete = true;
  assert.equal(Model.evaluateHistory(provisional).events.length, 0);
  assert.equal(result.triggerUsesFutureData, false);
  assert.equal(result.isTradingBacktest, false);
});

test('history treats future observations as pending and duplicate bars as invalid', () => {
  const rows = buySetup(); rows.push({ ...candles([90])[0], date: '2025-01-15' });
  const history = Model.evaluateHistory(rows, { asOf: '2025-01-14T08:00:00Z', horizons: [1] });
  assert.equal(history.events[0].outcomes[1].status, 'pending');
  assert.equal(history.events[0].outcomes[1].returnPct, null);
  rows[14].date = rows[13].date;
  const series = Model.calculateSeries(rows);
  assert.equal(series[14].confirmed, false);
  assert.equal(Model.evaluateHistory(rows).confirmedBarCount, 14);
});

test('browser UMD and Node give identical results without mutating inputs', () => {
  const context = {}; vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('../js/modules/sequentialSignalModel'), 'utf8'), context);
  const rows = buyCycle(); const original = JSON.stringify(rows);
  assert.equal(JSON.stringify(context.SequentialSignalModel.calculateSeries(rows)), JSON.stringify(Model.calculateSeries(rows)));
  assert.equal(JSON.stringify(rows), original);
  const series = Model.calculateSeries(rows);
  for (let length = 1; length <= rows.length; length += 1) {
    assert.deepEqual(Model.calculateSeries(rows.slice(0, length)), series.slice(0, length));
  }
});
