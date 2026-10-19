const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sequential = require('../js/modules/sequentialSignalModel');
const basic = require('../js/modules/marketSignalModel');
const source = fs.readFileSync(path.join(__dirname, '../js/modules/klineChart.js'), 'utf8');
function harness(mode) {
  const saved = new Map(mode ? [['webstock.nineTurnMode', mode]] : []);
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', value: '', children: [],
      replaceChildren() { this.children = []; }, appendChild(child) { this.children.push(child); }, append(...children) { this.children.push(...children); } });
    return nodes.get(id);
  };
  const context = vm.createContext({ window: { MarketSignalModel: basic, SequentialSignalModel: sequential,
    State: { currentPeriod: 'day', currentView: 'realtime', currentRawData: [] } },
    document: { getElementById: node, createElement: () => ({ children: [], appendChild(child) { this.children.push(child); }, append(...children) { this.children.push(...children); } }) },
    localStorage: { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) }
  });
  vm.runInContext(source, context);
  return { context, node, saved };
}
function rows(closes) {
  return closes.map((close, index) => ({ date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
    open: close, close, high: close + .4, low: close - .4, volume: 100, incomplete: false }));
}
const asOf = '2026-10-03T08:00:00Z';

test('desktop extended overlay draws all Setup 1–9 and Countdown 1–13 with separate lanes', () => {
  const r = harness();
  const data = rows([100, 101, 102, 103, 104, ...Array.from({ length: 21 }, (_, i) => 99 - i)]);
  const overlay = r.context.buildKlineSequenceOverlay(data, { asOf, timeframe: 'day' });
  assert.equal(overlay.mode, 'extended');
  assert.deepEqual(Array.from(overlay.marks.filter(mark => mark.sequenceType === 'setup'), mark => mark.value), ['1','2','3','4','5','6','7','8','9']);
  assert.deepEqual(Array.from(overlay.marks.filter(mark => mark.sequenceType === 'countdown'), mark => mark.value), Array.from({ length: 13 }, (_, i) => 'C' + (i + 1)));
  const atNine = overlay.marks.filter(mark => mark.coord[0] === data[13].date);
  assert.equal(new Set(atNine.map(mark => mark.symbolOffset[1])).size, atNine.length);
  assert.ok(overlay.marks.every(mark => mark.nineTurnCount && mark.signal.triggerUsesFutureData === false));
  assert.ok(overlay.marks.every(mark => mark.sequenceTimeframe === 'day'));
  assert.match(overlay.marks.at(-1).signal.detail, /sequential-public-rules-v1/);
  assert.match(overlay.marks.find(mark => mark.value === '9').signal.basis, /完善/);
});

test('basic compatibility mode is a distinct persisted choice, not relabelled as extended', () => {
  const r = harness('basic');
  const data = rows(Array.from({ length: 18 }, (_, i) => 20 + i));
  assert.equal(r.context.buildKlineSequenceOverlay(data, { asOf, timeframe: 'day' }).mode, 'basic');
  assert.equal(r.context.buildKlineSequenceOverlay(data, { asOf, timeframe: 'day' }).marks.length, 9);
  r.context.window.KlineChart.setNineTurnMode('extended');
  assert.equal(r.saved.get('webstock.nineTurnMode'), 'extended');
  assert.equal(r.context.buildKlineSequenceOverlay(data, { asOf, timeframe: 'day' }).marks.length, 0, 'strict flip cannot be inferred from an already monotone history start');
});

test('deferred 13 and provisional bars are explained without reporting confirmed completion', () => {
  const r = harness();
  const closes = [100,101,102,103,104,...Array.from({length:16},(_,i)=>99-i),100,83,95,82,94,90,93,81];
  const data = rows(closes);
  data.at(-1).incomplete = true;
  const overlay = r.context.buildKlineSequenceOverlay(data, { asOf, timeframe: 'day' });
  assert.match(overlay.marks.find(mark => mark.value === '+').signal.basis, /13对8/);
  const last = overlay.marks.at(-1);
  assert.equal(last.value, 'C13');
  assert.ok(last.itemStyle.opacity < 1);
  assert.match(last.signal.basis, /未收盘/);
  assert.ok(overlay.history.events.every(event => event.type !== 'countdown-complete'));
});

test('history coverage shows the actual period, rules and event type without pretending to be a trading backtest', () => {
  const r = harness();
  const data = rows([100,101,102,103,104,...Array.from({length:21},(_,i)=>99-i)]);
  const overlay = r.context.buildKlineSequenceOverlay(data, { asOf, timeframe: 'week' });
  r.context.renderNineTurnHistory(overlay.history, { dataSource: 'fixture-week' }, { mode: overlay.mode, timeframe: 'week' });
  assert.match(r.node('nineTurnHistorySummary').textContent, /扩展9\+13/);
  assert.match(r.node('nineTurnHistoryCoverage').textContent, /周线.*fixture-week.*sequential-public-rules-v1/);
  assert.match(r.node('nineTurnHistoryEvents').children.at(-1).children[0].textContent, /准备9/);
});

test('stock/period loading cannot leave the previous stock history labelled as current', () => {
  const r = harness();
  r.node('nineTurnHistoryEvents').children.push({ textContent: '旧股票的事件' });
  r.node('nineTurnHistoryCoverage').textContent = '旧股票日线';
  r.context.hideKlineInsights(r.context.window.State);
  assert.equal(r.node('nineTurnHistoryEvents').children.length, 0);
  assert.match(r.node('nineTurnHistoryCoverage').textContent, /当前.*K线/);
  assert.doesNotMatch(r.node('nineTurnHistoryCoverage').textContent, /旧股票/);
});

test('real desktop candle renderer switches rule modes without a request, new canvas or lost zoom', () => {
  const r = harness();
  const data = rows([100,101,102,103,104,...Array.from({length:21},(_,i)=>99-i)]);
  r.context.window.ChartTheme = require('../js/modules/chartTheme');
  r.context.window.RealtimeChartModel = require('../js/modules/realtimeChartModel');
  r.context.document.body = { classList: { contains: () => false } };
  r.node('chartContainer').querySelector = () => null;
  r.context.echarts = { init(dom) { return { option: {}, getDom: () => dom,
    setOption(option) { this.option = option; }, getOption() { return this.option; } }; } };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/indicators.js'), 'utf8'), r.context);
  const state = r.context.window.State;
  Object.assign(state, { currentStock: { code: '600183' }, currentPeriod: 'week', currentIndicator: 'ma',
    currentView: 'kline', currentRawData: data, maPeriods: [5,10], watchlist: [] });
  r.context.window.KlineChart.renderKlineChart(data, 'ma');
  const chart = state.klineChart;
  assert.equal(chart.getOption().series[0].markPoint.data.at(-1).value, 'C13');
  assert.ok(chart.getOption().yAxis[0].boundaryGap[0] > 0, 'count labels need reserved space below prices, not on the date axis');
  assert.equal(chart.getOption().yAxis[0].boundaryGap[1], 0, 'one-sided labels should not waste the other side');
  chart.option.dataZoom.forEach(zoom => { zoom.start = 35; zoom.end = 75; });
  r.context.window.KlineChart.setNineTurnMode('basic');
  assert.equal(state.klineChart, chart);
  assert.equal(chart.getOption().series[0].markPoint, undefined, 'basic weekly mode must not inherit extended marks');
  assert.equal(chart.getOption().dataZoom[0].start, 35);
  assert.match(r.node('nineTurnHistoryCoverage').textContent, /基础模式仅在日线/);
  r.context.window.KlineChart.setNineTurnMode('extended');
  assert.equal(state.klineChart, chart);
  assert.equal(chart.getOption().series[0].markPoint.data.at(-1).value, 'C13');
  assert.equal(chart.getOption().dataZoom[0].end, 75);

  // A 14:59 cached candle must not become confirmed merely by rendering it later.
  state.currentPeriod = 'day';
  state.currentRawData = data.map(row => { const copy = { ...row }; delete copy.incomplete; return copy; });
  state.currentKlineMeta = { fetchedAt: '2025-01-26T06:59:00.000Z', stale: true };
  r.context.window.KlineChart.renderKlineChart(state.currentRawData, 'ma');
  const preview = state.klineChart.getOption().series[0].markPoint.data.at(-1);
  assert.equal(preview.value, 'C13');
  assert.match(preview.signal.basis, /未收盘/);
  assert.ok(preview.itemStyle.opacity < 1);
  assert.match(r.node('nineTurnHistoryCoverage').textContent, /判定快照.*2025-01-26T06:59:00/);
  assert.doesNotMatch(r.node('nineTurnHistoryEvents').children[0]?.children[0]?.textContent || '', /衰竭13/);
  state.currentKlineMeta = { fetchedAt: '2025-01-26T07:01:00.000Z' };
  r.context.window.KlineChart.renderKlineChart(state.currentRawData, 'ma');
  assert.match(state.klineChart.getOption().series[0].markPoint.data.at(-1).signal.basis, /本根已收盘/);
});

test('missing acquisition time keeps only an unverified final candle provisional without altering source data', () => {
  const r = harness();
  const data = rows([100,101,102,103,104,...Array.from({length:21},(_,i)=>99-i)]);
  data.forEach(row=>{ delete row.incomplete; });
  const snapshot = r.context.prepareKlineSequenceSnapshot(data, {}, 'day');
  const overlay = r.context.buildKlineSequenceOverlay(snapshot.data, snapshot.context);
  assert.equal(data.at(-1).incomplete, undefined);
  assert.equal(overlay.marks.at(-1).value, 'C13');
  assert.match(overlay.marks.at(-1).signal.basis, /未收盘/);
  assert.ok(overlay.history.events.some(event=>event.type==='setup-complete'), 'older completed periods remain checkable');
  assert.ok(overlay.history.events.every(event=>event.type!=='countdown-complete'));
  data.at(-1).closed = true;
  const closed = r.context.prepareKlineSequenceSnapshot(data, {}, 'day');
  assert.equal(r.context.buildKlineSequenceOverlay(closed.data, closed.context).history.events.at(-1).type, 'countdown-complete');
});

test('explicit incomplete and row observation time remain authoritative after later metadata checks', () => {
  const r = harness();
  const data = rows([100,101,102,103,104,...Array.from({length:21},(_,i)=>99-i)]);
  delete data.at(-1).incomplete;
  data.at(-1).observedAt = '2025-01-26 14:59:00';
  let snapshot = r.context.prepareKlineSequenceSnapshot(data, {fetchedAt:'2025-01-26T07:05:00Z'}, 'day');
  assert.equal(snapshot.context.asOf, '2025-01-26T06:59:00.000Z');
  assert.equal(r.context.buildKlineSequenceOverlay(snapshot.data, snapshot.context).latest.provisional, true);
  data.at(-1).incomplete = true;
  delete data.at(-1).observedAt;
  snapshot = r.context.prepareKlineSequenceSnapshot(data, {fetchedAt:'2025-01-26T07:05:00Z'}, 'day');
  assert.equal(r.context.buildKlineSequenceOverlay(snapshot.data, snapshot.context).latest.provisional, true);
});
