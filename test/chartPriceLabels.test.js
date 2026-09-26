const test = require('node:test');
const assert = require('node:assert/strict');
const labels = require('../js/modules/chartPriceLabels');

test('crowded labels move apart without moving the actual price coordinates', () => {
  const input = [102, 101, 100, 100, 99].map((y, i) => ({ y, price: 60 + i / 100 }));
  const before = JSON.stringify(input);
  const result = labels.layout(input, 50, 300, 34);
  assert.equal(result.scroll, false);
  for (let i = 1; i < result.items.length; i++) assert.ok(result.items[i].labelY - result.items[i-1].labelY >= 34);
  assert.ok(result.items.every(item => item.labelY >= 67 && item.labelY <= 283));
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(result.items.map(x => x.y), [99, 100, 100, 101, 102]);
});

test('labels at both edges fit; tiny chart switches to a complete scrollable list', () => {
  for (const values of [[0, 1, 2], [299, 300, 301]]) {
    const result = labels.layout(values.map(y => ({ y })), 0, 300, 34);
    assert.ok(result.items.every(x => x.labelY >= 17 && x.labelY <= 283));
  }
  const crowded = labels.layout(Array.from({ length: 9 }, (_, i) => ({ y: 50 + i })), 0, 180, 34);
  assert.equal(crowded.scroll, true);
  assert.equal(crowded.items.length, 9);
  assert.equal(labels.layout([], 0, 180, 34).items.length, 0);
});

test('pressure assessment states price zone, distance, evidence and limits, not a guaranteed breakout', () => {
  const result = labels.describe({ name: '关键压力', yAxis: 60, signal: {
    type: 'resistance', tolerance: 0.3, strengthLabel: '强', touchCount: 3,
    rejectionCount: 2, volumeConfirmedTouches: 1, basis: '过去120根局部高点聚类'
  } }, { close: 58, date: '2026-09-25' });
  assert.match(result.status, /收盘在区下/);
  assert.match(result.detail, /59\.70.*60\.30/);
  assert.match(result.detail, /3\.45%/);
  assert.match(result.detail, /3次触碰.*2次反向收盘/);
  assert.match(result.detail, /至少3次触碰/);
  assert.match(result.detail, /不是.*预测/);
  assert.match(result.name, /强.*压力/);
});

test('unclosed price above a pressure area stays provisional; missing values are not zero', () => {
  const mark = { name: '压力', yAxis: 60, signal: { type: 'resistance', tolerance: 0.3 } };
  assert.match(labels.describe(mark, { close: 61, incomplete: true }).status, /现价在区上.*待收盘/);
  assert.match(labels.describe(mark, { close: 60.1 }).status, /区内测试/);
  assert.match(labels.describe(mark, { close: null }).status, /价格不可用/);
  assert.doesNotMatch(labels.describe(mark, { close: null }).detail, /距.*0\.00%/);
});

test('manual levels and area entries retain all distinct labels and provenance', () => {
  const lines = [{ name: '自动 R1 压力', yAxis: 60, signal: { basis: '历史规则', sourceDate: '2026-09-23' } },
    { name: '自动确认', yAxis: 60.01 }, { name: '无效', yAxis: null }];
  const areas = [[{ name: 'D1 观察区', yAxis: 59.5 }, { yAxis: 60 }]];
  const entries = labels.entries({ markLine: { data: lines }, markArea: { data: areas } }, { close: 58 });
  assert.equal(entries.length, 3);
  assert.match(entries[0].detail, /2026-09-23/);
  assert.match(entries[1].detail, /依据未提供/);
  assert.match(entries[2].valueText, /59\.50–60\.00/);
});
