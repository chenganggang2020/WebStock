const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const model = require('../js/modules/marketSignalModel');

function rows(closes) {
  return closes.map((close, index) => ({
    date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
    open: close, close, high: close + 1, low: close - 1, volume: 100
  }));
}

function marks(data) {
  const context = vm.createContext({
    window: { MarketSignalModel: model },
    localStorage: { getItem: () => null }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/klineChart.js'), 'utf8'), context);
  assert.equal(typeof context.buildNineTurnMarks, 'function');
  return JSON.parse(JSON.stringify(context.buildNineTurnMarks(data, { asOf: '2026-02-01T08:00:00Z' })));
}

test('chart marks every upward count 1–9 at its candle high, without repeating a capped nine', () => {
  const data = rows(Array.from({ length: 18 }, (_, i) => 20 + i));
  const result = marks(data);
  assert.deepEqual(result.map(mark => mark.value), ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  assert.deepEqual(result.map(mark => mark.coord), data.slice(4, 13).map(row => [row.date, row.high]));
  assert.ok(result.every(mark => mark.symbolOffset[1] < 0));
  assert.match(result[0].signal.basis, /1\/9.*未完成/);
  assert.match(result[8].signal.basis, /事后核对/);
  assert.ok(result.every(mark => mark.signal.triggerUsesFutureData === false));
});

test('downward sequence counts 1–9 below candle lows and explains the direction', () => {
  const data = rows(Array.from({ length: 15 }, (_, i) => 50 - i));
  const result = marks(data);
  assert.deepEqual(result.map(mark => mark.value), ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  assert.deepEqual(result.map(mark => mark.coord), data.slice(4, 13).map(row => [row.date, row.low]));
  assert.ok(result.every(mark => mark.symbolOffset[1] > 0));
  assert.match(result[0].signal.label, /下行1/);
});

test('interrupted sequences stay visible, reset at one, and are not backfilled to nine', () => {
  const data = rows([20, 21, 22, 23, 24, 25, 26, 27, 10, 9, 8, 7]);
  const result = marks(data);
  assert.deepEqual(result.map(mark => mark.value), ['1', '2', '3', '4', '1', '2', '3', '4']);
  assert.ok(result.every(mark => !mark.signal.basis.includes('事后核对')));
});

test('unfinished count nine is visible but explicitly provisional, not a confirmed event', () => {
  const data = rows(Array.from({ length: 13 }, (_, i) => 20 + i));
  data[12].incomplete = true;
  const result = marks(data);
  assert.equal(result.at(-1).value, '9');
  assert.match(result.at(-1).signal.label, /未收盘/);
  assert.match(result.at(-1).signal.basis, /未确认/);
  assert.ok(result.at(-1).itemStyle.opacity < 1);
  assert.doesNotMatch(result.at(-1).signal.basis, /事后核对/);
});

test('missing price bars break labels; empty history creates no marks', () => {
  const data = rows(Array.from({ length: 14 }, (_, i) => 20 + i));
  data[8].close = null;
  assert.deepEqual(marks(data).map(mark => mark.value), ['1', '2', '3', '4', '1']);
  assert.deepEqual(marks([]), []);
});

test('missing extrema fall back to the actual close without fabricating a price', () => {
  const data = rows(Array.from({ length: 5 }, (_, i) => 20 + i));
  data[4].high = null;
  assert.deepEqual(marks(data)[0].coord, [data[4].date, data[4].close]);
});
