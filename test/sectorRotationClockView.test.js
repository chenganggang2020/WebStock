const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
// The chart-option builder is run from the real module. Money formatting and
// browser rendering are not exercised by this isolated contract test.
const sandbox = { module: { exports: {} }, require: () => ({}) };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/modules/sectorRotation.js'), 'utf8'), sandbox);
const { chartOption } = sandbox.module.exports;
function point(at, minute, phase, more = {}) {
  return { at, phase: '2026-09-17:' + phase, cumulativeCents: '10000000000',
    changeRatio: 0.01, tradingTimeMs: minute * 60000, gapBefore: false,
    sourceKey: 'fixture', totalReported: 1, clockVersion: 'cn-continuous-samples/v1', ...more };
}
const before = () => point('2026-09-17T03:30:00Z', 120, 'am');
const after = () => point('2026-09-17T05:00:00Z', 120, 'pm');
test('verified lunch boundary is adjacent with no 90-minute hole or fabricated price', () => {
  const opt = chartOption([before(), after()]);
  assert.equal(opt.xAxis.type, 'value');
  assert.equal(opt.series[0].connectNulls, false);
  assert.equal(opt.series[0].data.length, 2);
  assert.equal(opt.series[0].data[0][0], opt.series[0].data[1][0]);
  assert.equal(opt.xAxis.axisLabel.formatter(120 * 60000), '11:30 / 13:00');
  assert.equal(opt.xAxis.axisLabel.formatter(121 * 60000), '13:01');
  assert.equal(opt.series[0].data[1][2], '2026-09-17T05:00:00Z');
  assert.match(opt.tooltip.formatter([{data:opt.series[0].data[1],seriesName:'净额'}]), /13:00/);
});
test('true trading gaps and source/universe changes still produce an explicit null', () => {
  for (const change of [
    {gapBefore:true}, {sourceKey:'other'}, {totalReported:2},
    {at:'2026-09-17T05:03:00Z',tradingTimeMs:123*60000}
  ]) {
    const opt = chartOption([before(), {...after(), ...change}]);
    assert.equal(opt.series[0].data.length, 3);
    assert.equal(opt.series[0].data[1][1], null);
  }
});
test('missing money or percentage remains null, never zero', () => {
  const opt = chartOption([before(), {...after(), cumulativeCents:null, changeRatio:null}]);
  assert.equal(opt.series[0].data[1][1], null);
  assert.equal(opt.series[1].data[1][1], null);
});
test('legacy or mixed-clock payloads fail closed rather than inferring sessions', () => {
  const legacy = [before(), after()].map(({clockVersion, ...rest}) => rest);
  const opt = chartOption(legacy);
  assert.equal(opt.xAxis.type, 'time');
  assert.equal(opt.series[0].data.length, 3);
  assert.equal(opt.series[0].data[1][1], null);
  const wrongDay = {...after(),phase:'2026-09-18:pm'};
  assert.equal(chartOption([before(),wrongDay]).xAxis.type, 'time');
});
test('empty chart remains valid and does not acquire an invented trading session', () => {
  const opt = chartOption([]);
  assert.equal(opt.series[0].data.length, 0);
  assert.equal(opt.xAxis.type, 'time');
});
