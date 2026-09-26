const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const chartSource = fs.readFileSync(path.join(__dirname, '../js/modules/realtimeChart.js'), 'utf8');
const model = require('../js/modules/marketSignalModel');
const meta = { tradingDate: '2026-09-25', sampling: { intervalSeconds: 60 } };
const data = Array.from({ length: 15 }, (_, i) => ({ time: '2026-09-25 09:' + (30 + i), price: 10 + i }));

function renderer() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', style: {}, dataset: {}, addEventListener() {},
      classList: { contains: () => false, toggle() {} }, setAttribute() {} });
    return nodes.get(id);
  };
  const State = { currentStock: { code: 'fixture' }, currentQuote: { prevClose: 10 }, currentMinuteMeta: meta };
  const window = { State, MarketSignalModel: model, RealtimeChartModel: require('../js/modules/realtimeChartModel'),
    ChartTheme: { ...require('../js/modules/chartTheme'), renderTo: (ec, dom, chart, option) => ({
      option: { ...option, series: option.series.map(s => ({ ...s,
        ...(s.markPoint ? { markPoint: { ...s.markPoint, data: s.markPoint.data.slice() } } : {}) })) }
    }), bindReadout() {} },
    WebStockTime: { todayDate: () => '2026-09-26', currentMinutes: () => 900 }, addEventListener() {} };
  const context = vm.createContext({ window, echarts: {}, document: { body: node('body'), getElementById: node,
    querySelectorAll: () => [], querySelector: () => null, addEventListener() {} }, console });
  vm.runInContext(chartSource, context);
  return { context, State, node };
}

test('real chart merges all nine-turn labels with existing open markers and explains actual comparisons', () => {
  const r = renderer();
  r.context.renderTimeChart(data);
  const price = r.State.timeChart.option.series.find(s => s.name === '分时价格');
  const marks = price.markPoint.data.filter(m => m.nineTurnCount);
  assert.deepEqual(Array.from(marks, m => m.value), ['1','2','3','4','5','6','7','8','9']);
  assert.equal(price.markPoint.data.some(m => m.value === '开'), true);
  assert.equal(marks.at(-1).symbolSize, 22);
  const tooltip = price.markPoint.tooltip.formatter({ data: marks.at(-1) });
  assert.match(tooltip, /09:42/);
  assert.match(tooltip, /22\.00/);
  assert.match(tooltip, /09:38/);
  assert.match(tooltip, /18\.00/);
  assert.match(tooltip, /不是买卖指令/);
  assert.match(r.node('realtimeNineTurnStatus').textContent, /1分钟九转/);
});

test('switching to sub-minute or empty data removes old minute marks and explains availability', () => {
  const r = renderer(); r.context.renderTimeChart(data);
  r.State.currentMinuteMeta = { ...meta, sampling: { intervalSeconds: 5 } };
  r.context.renderTimeChart(data);
  assert.equal(r.State.timeChart.option.series.find(s => s.name === '分时价格').markPoint.data.some(m => m.nineTurnCount), false);
  assert.match(r.node('realtimeNineTurnStatus').textContent, /仅支持1分钟/);
  r.State.currentMinuteMeta = meta; r.State.timeChart = null; r.context.renderTimeChart([]);
  assert.match(r.node('realtimeNineTurnStatus').textContent, /暂无/);
});

test('unfinished ninth minute is faint, unconfirmed and receives no completed circle', () => {
  const r = renderer();
  const result = r.context.buildRealtimeNineTurnMarks(data.slice(0,13), meta, { asOf: '2026-09-25T01:42:30Z' });
  assert.equal(result.marks.at(-1).itemStyle.opacity, 0.55);
  assert.equal(result.marks.at(-1).symbolSize, 16);
  assert.match(result.marks.at(-1).detail, /暂定价|未收盘/);
  assert.match(result.status, /未收盘/);
});

test('snapshot freshness includes minute closure, without creating another network polling loop', () => {
  const r = renderer();
  assert.notEqual(r.context.realtimeNineTurnRefreshKey(Date.parse('2026-09-25T01:42:59Z')),
    r.context.realtimeNineTurnRefreshKey(Date.parse('2026-09-25T01:43:00Z')));
  assert.match(chartSource, /snapshotKey\(minuteData, quote, minuteMeta\)[\s\S]{0,100}realtimeNineTurnRefreshKey\(/);
  assert.doesNotMatch(chartSource, /setInterval\s*\(/);
});
