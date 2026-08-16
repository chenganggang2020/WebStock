const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MarketVisualModel = require('../js/modules/marketVisualModel');
const klineSource = fs.readFileSync(path.join(__dirname, '../js/modules/klineChart.js'), 'utf8');

test('trend colors follow A-share convention with vivid red for gains and green for losses', () => {
  assert.equal(MarketVisualModel.trendColor(1.2, false), '#ff2d2d');
  assert.equal(MarketVisualModel.trendColor(-0.4, false), '#00b050');
  assert.equal(MarketVisualModel.trendColor(0, true), '#ff4d4f');
});

test('daily candles use yellow for limit-up and green for limit-down', () => {
  const colors = MarketVisualModel.candleColors({ code: '600000', name: '浦发银行' }, [
    { open: 9.8, close: 10, low: 9.7, high: 10 },
    { open: 10.2, close: 11, low: 10.2, high: 11 },
    { open: 10.4, close: 9.9, low: 9.9, high: 10.5 }
  ], false);

  assert.equal(colors[1].kind, 'limit-up');
  assert.equal(colors[1].color, '#f5c542');
  assert.equal(colors[2].kind, 'limit-down');
  assert.equal(colors[2].color, '#00b050');
});

test('daily candle limit thresholds respect ST and 20-percent boards', () => {
  const st = MarketVisualModel.classifyDailyBar({ open: 10, close: 10.5 }, 10, { code: '600001', name: 'ST测试' });
  const star = MarketVisualModel.classifyDailyBar({ open: 10, close: 12 }, 10, { code: '688001', name: '科创测试' });

  assert.equal(st, 'limit-up');
  assert.equal(star, 'limit-up');
});

test('watchlist notes become visible D1 D2 R1 and strong-confirmation chart marks', () => {
  const marks = MarketVisualModel.watchlistMarks({
    alertLow: 63.7,
    alertHigh: 66.5,
    note: 'D1 64.8–65.3；D2 收盘低于63.7；R1 66.5（强确认68.2）'
  });

  assert.deepEqual(marks.areas, [{ name: 'D1 观察区', from: 64.8, to: 65.3 }]);
  assert.deepEqual(marks.lines.map(item => [item.name, item.value]), [
    ['D2 防守', 63.7],
    ['R1 转强', 66.5],
    ['强确认', 68.2]
  ]);
});

test('structured alert prices remain visible when a note has no D1 D2 R1 syntax', () => {
  const marks = MarketVisualModel.watchlistMarks({ alertLow: 10.2, alertHigh: 12.8, note: '普通备注' });

  assert.deepEqual(marks.lines.map(item => [item.name, item.value]), [
    ['预警下限', 10.2],
    ['预警上限', 12.8]
  ]);
  assert.deepEqual(marks.areas, []);
});

test('daily K-line consumes candle classifications and watchlist marks', () => {
  assert.match(klineSource, /MarketVisualModel\.candleColors/);
  assert.match(klineSource, /MarketVisualModel\.watchlistMarks/);
  assert.match(klineSource, /markLine/);
  assert.match(klineSource, /markArea/);
  assert.match(klineSource, /State\.currentPeriod\s*===\s*'day'/);
});
