const test = require('node:test');
const assert = require('node:assert/strict');

const ChartTheme = require('../js/modules/chartTheme');

test('chart option styling keeps lines delicate and moving averages unsmoothed', () => {
  const option = ChartTheme.applyToOption({
    xAxis: {
      axisLine: { lineStyle: { color: '#000', width: 2 } },
      splitLine: { lineStyle: { color: '#000', width: 2 } }
    },
    yAxis: [{
      axisLine: { lineStyle: { color: '#000', width: 2 } },
      splitLine: { lineStyle: { color: '#000', width: 2 } }
    }],
    series: [
      { name: '分时价格', type: 'line', smooth: true, lineStyle: { width: 3 } },
      { name: '均价', type: 'line', smooth: true, lineStyle: { width: 2 } },
      { name: '昨收', type: 'line', referenceRole: 'zero', lineStyle: { width: 2 }, markLine: { lineStyle: { width: 2 } } },
      { name: 'MA5', type: 'line', smooth: true, lineStyle: { width: 2 } },
      { name: 'VOL_MA5', type: 'line', smooth: true, lineStyle: { width: 2 } },
      { name: '成交量(万手)', type: 'bar', barWidth: '60%' }
    ]
  }, { dark: false });

  assert.ok(option.series[0].lineStyle.width <= 1.5);
  assert.equal(option.series[0].smooth, false);
  assert.equal(option.series[1].smooth, false);
  assert.ok(option.series[2].lineStyle.width > option.xAxis.axisLine.lineStyle.width);
  assert.ok(option.series[2].lineStyle.width <= 1.1);
  assert.equal(option.series[2].markLine.lineStyle.width, option.series[2].lineStyle.width);
  assert.equal(option.series[3].smooth, false);
  assert.ok(option.series[3].lineStyle.width <= 1.25);
  assert.equal(option.series[4].smooth, false);
  assert.ok(option.series[4].lineStyle.width <= 1.25);
  assert.ok(option.xAxis.axisLine.lineStyle.width <= 0.75);
  assert.ok(option.xAxis.splitLine.lineStyle.width <= 0.75);
  assert.ok(option.yAxis[0].splitLine.lineStyle.width <= 0.75);
  assert.equal(option.series[5].barWidth, '42%');
});

test('light and dark palettes share low-saturation semantic chart tokens', () => {
  const light = ChartTheme.get(false);
  const dark = ChartTheme.get(true);

  assert.equal(light.mode, 'light');
  assert.equal(dark.mode, 'dark');
  assert.notEqual(light.colors.background, dark.colors.background);
  assert.equal(light.widths.main, dark.widths.main);
  assert.ok(light.widths.main <= 1.5);
  assert.ok(light.widths.average <= 1.25);
  assert.ok(light.widths.reference <= 0.75);
  assert.ok(light.widths.zeroReference > light.widths.reference);
  assert.ok(light.widths.zeroReference <= 1.1);
  assert.ok(light.widths.grid <= 0.75);
  assert.equal(light.volumeBarWidth, '42%');
  assert.equal(light.colors.movingAverages.length, 7);
});

test('mini chart SVG widths stay delicate at compact sidebar size', () => {
  const theme = ChartTheme.get(false);
  assert.ok(theme.widths.mini <= 1.25);
  assert.ok(theme.widths.miniEmphasis <= 1.6);
  assert.ok(theme.widths.reference <= 0.75);
});
