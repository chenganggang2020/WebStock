const test = require('node:test');
const assert = require('node:assert/strict');
const theme = require('../js/modules/chartTheme');

function engine() {
  const instances = [];
  return { instances, init(dom) {
    const chart = { dom, option: {}, disposed: false, getDom() { return dom; },
      isDisposed() { return this.disposed; }, getOption() { return this.option; },
      setOption(value) { this.option = value; }, resize() {}, dispose() { this.disposed = true; } };
    instances.push(chart);
    return chart;
  } };
}
const option = () => ({ legend: { data: ['MA5', 'MA10'] }, dataZoom: [{ start: 0, end: 100 }], series: [] });

test('a quote update reuses the chart and keeps the chosen viewport and hidden averages', () => {
  const api = engine(), dom = { innerHTML: '' };
  const first = theme.renderTo(api, dom, null, option(), '000001:day');
  first.option.dataZoom = [{ start: 31, end: 74 }];
  first.option.legend = [{ selected: { MA5: false } }];
  const next = theme.renderTo(api, dom, first, option(), '000001:day');
  assert.equal(next, first);
  assert.equal(api.instances.length, 1);
  assert.equal(next.option.dataZoom[0].start, 31);
  assert.equal(next.option.legend.selected.MA5, false);
});

test('switching a stock or resolution resets viewport without recreating the same canvas', () => {
  const api = engine(), dom = { innerHTML: '' };
  const first = theme.renderTo(api, dom, null, option(), '000001:1m');
  first.option.dataZoom[0].start = 65;
  const next = theme.renderTo(api, dom, first, option(), '000002:5s');
  assert.equal(next.option.dataZoom[0].start, 0);
  assert.equal(api.instances.length, 1);
});

test('replacement containers or disposed charts are initialized safely', () => {
  const api = engine();
  const first = theme.renderTo(api, {}, null, option(), 'a');
  const second = theme.renderTo(api, {}, first, option(), 'a');
  assert.equal(first.disposed, true);
  second.dispose();
  theme.renderTo(api, second.dom, second, option(), 'a');
  assert.equal(api.instances.length, 3);
});

test('theme application preserves gaps and uses crisp lines and readable axes', () => {
  const data = [1, null, 2];
  const next = theme.applyToOption({xAxis: {}, yAxis: {}, series: [{type:'line', name:'分时价格', data}]}, {dark:true});
  assert.equal(next.animation, false);
  assert.equal(next.xAxis.axisLabel.hideOverlap, true);
  assert.equal(next.series[0].smooth, false);
  assert.equal(next.series[0].data, data);
  assert.equal(next.backgroundColor, '#191919');
});

test('small nonzero volumes remain readable instead of all becoming 0.0', () => {
  assert.equal(theme.formatAxisNumber(0), '0');
  assert.equal(theme.formatAxisNumber(0.005), '0.005');
  assert.equal(theme.formatAxisNumber(0.025), '0.025');
  assert.equal(theme.formatAxisNumber(1.25), '1.25');
});
