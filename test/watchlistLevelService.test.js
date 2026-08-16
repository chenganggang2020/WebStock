const test = require('node:test');
const assert = require('node:assert/strict');

const { deriveAutomaticLevels } = require('../services/watchlistLevelService');

function bars() {
  return Array.from({ length: 45 }, function(_, index) {
    const date = new Date(Date.UTC(2026, 5, 1 + index));
    const wave = Math.sin(index / 3) * 2;
    const close = 50 + index * 0.08 + wave;
    return {
      date: date.toISOString().slice(0, 10),
      open: close - 0.2,
      high: close + 0.8,
      low: close - 0.9,
      close,
      volume: 100000 + index * 1000
    };
  });
}

test('automatic watchlist levels are transparent historical support and resistance zones', () => {
  const result = deriveAutomaticLevels(bars());

  assert.ok(result.d1Low < result.d1High);
  assert.equal(result.d2, result.d1Low);
  assert.ok(result.r1 < result.confirm);
  assert.match(result.method, /历史局部高低点|枢轴点/);
  assert.equal(result.sourceDate, '2026-07-15');
  assert.equal(result.period, 'day');
});

test('automatic watchlist levels require enough valid daily bars', () => {
  assert.throws(() => deriveAutomaticLevels(bars().slice(0, 5)), /至少需要 10 根/);
});
