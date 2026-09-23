const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { buildChartOption, describeObservation } = require('../js/modules/capitalFlow');
const chartTheme = require('../js/modules/chartTheme');
const realtimeChartModel = require('../js/modules/realtimeChartModel');

function fundsPoint(time, value) {
  return {
    timestamp: '2026-09-18T' + time + ':00+08:00',
    inflowAmount: value,
    outflowAmount: value === null ? null : 0,
    netAmount: value,
    netFlowSpeed: null,
    netFlowAcceleration: null
  };
}

function clockLabel(value) {
  if (/^\d{2}:\d{2}$/.test(String(value))) return value;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(new Date(value));
}

function chartValue(item) {
  const value = item && typeof item === 'object' && !Array.isArray(item) ? item.value : item;
  return Array.isArray(value) ? value[1] : value;
}

test('funds panels compress lunch so 11:30 directly precedes 13:00', () => {
  const option = buildChartOption({ points: [
    fundsPoint('11:29', 100), fundsPoint('11:30', 120),
    fundsPoint('13:00', 140), fundsPoint('13:01', 150)
  ] });

  for (const axis of option.xAxis) {
    assert.equal(axis.type, 'category', 'lunch must not occupy 90 minutes of a continuous clock axis');
    const times = axis.data.map(clockLabel);
    assert.equal(times[times.indexOf('11:30') + 1], '13:00');
    assert.ok(!times.includes('12:00'));
  }
});

test('lunch compression preserves explicit missing measurements without inventing zero or interpolation', () => {
  const points = [fundsPoint('13:00', 100), fundsPoint('13:01', null), fundsPoint('13:02', 200)];
  const before = JSON.stringify(points);
  const option = buildChartOption({ points });
  const net = option.series.find(series => series.name === '净额');
  const values = net.data.map(chartValue);

  assert.equal(JSON.stringify(points), before, 'rendering must not mutate source measurements');
  assert.deepEqual(values.filter(value => value !== null), [100, 200]);
  assert.ok(values.slice(values.indexOf(100) + 1, values.indexOf(200)).includes(null));
  assert.notEqual(net.connectNulls, true, 'a real intraday missing point must remain a visible gap');
});

test('a previous close viewed on Saturday is dated data, not an expired-data alarm', () => {
  const description = describeObservation({
    observedAt: '2026-09-18T07:00:00.000Z',
    checkedAt: '2026-09-19T11:38:43.000Z',
    expiresAt: '2026-09-18T07:10:00.000Z',
    state: 'stale', isStale: true, reason: 'age-exceeds-threshold'
  });

  assert.doesNotMatch(description.label, /过期/);
  assert.ok(description.label.length > 0);
  assert.match(description.observedAt, /2026.*9.*18/);
  assert.match(description.observedAt, /15:00/);
  assert.match(description.checkedAt, /2026.*9.*19/);
});

function loadHotMarketWithoutIO() {
  const forbidden = new Proxy({}, {
    get: function(_, key) { throw new Error('Unexpected DB or network access: ' + String(key)); }
  });
  const dependencies = {
    axios: forbidden,
    '../db': forbidden,
    './sectorService': forbidden,
    './newsService': forbidden,
    './themeService': { decorateStock: stock => stock },
    '../utils/market': { toSinaSymbol: code => code }
  };
  const context = vm.createContext({
    module: { exports: {} },
    require: name => {
      assert.ok(Object.hasOwn(dependencies, name), 'unexpected dependency: ' + name);
      return dependencies[name];
    },
    process: { env: { NODE_ENV: 'test', WEBSTOCK_HOT_MARKET_OFFLINE: '1' } },
    console, URLSearchParams
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../services/hotMarketService.js'), 'utf8'), context);
  return context.module.exports;
}

test('hot board inflows rank above equal-sized outflows with identical other metrics', () => {
  const hotMarket = loadHotMarketWithoutIO();
  const common = { f12: 'BK0001', f14: '测试板块', f3: 2, f6: 1000000000 };
  const inflow = hotMarket.mapBoard({ ...common, f62: 200000000 }, 'industry');
  const outflow = hotMarket.mapBoard({ ...common, f62: -200000000 }, 'industry');
  const unavailable = hotMarket.mapBoard({ ...common, f62: null }, 'industry');

  assert.ok(inflow.heatScore > outflow.heatScore, 'an outflow must not gain the same absolute-value flow bonus as an inflow');
  assert.ok(outflow.heatScore <= unavailable.heatScore, 'outflows must not receive a positive inflow bonus');
});

test('a missing board change stays missing and is not displayed as +0.00%', () => {
  const hotMarket = loadHotMarketWithoutIO();
  const board = hotMarket.mapBoard({ f12: 'BK0001', f14: '测试板块', f3: null, f6: null, f62: null }, 'industry');

  assert.equal(board.dailyChangePct, null);
  assert.equal(board.mainNetInflow, null);
  assert.equal(hotMarket.formatPct(null), '--');
  assert.doesNotMatch(board.rankReason, /日涨幅\s*\+0\.00%/);
});

function loadRealtimeChart() {
  let option = null;
  const document = {
    body: { classList: { contains: () => false } },
    getElementById: id => id === 'timeChartContainer' ? { innerHTML: '' } : null,
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
    visibilityState: 'visible'
  };
  const window = {
    addEventListener: () => {},
    RealtimeChartModel: realtimeChartModel,
    ChartTheme: { ...chartTheme, renderTo: (_, __, ___, next) => { option = next; return {}; } },
    WebStockTime: { todayDate: () => '2026-09-19', currentMinutes: () => 900 },
    State: {
      currentStock: { code: '000001' },
      currentQuote: { price: 10, prevClose: 10 },
      currentMinuteMeta: { tradingDate: '2026-09-18', resolution: '1m' }
    }
  };
  const context = vm.createContext({ window, document, console, echarts: {}, setTimeout, clearTimeout, AbortController });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/modules/realtimeChart.js'), 'utf8'), context);
  return { api: window.RealtimeChart, getOption: () => option, context };
}

test('opening auction from another date cannot be merged into the selected trading day',()=>{
  const {context}=loadRealtimeChart();
  const rows=vm.runInContext("mergeRealtimeRows([{time:'2026-09-18 09:30:00',price:10}],[{time:'2026-09-17 09:20:00',price:9}])",context);
  assert.equal(rows.length,1);
});

test('realtime charts enable the auction layer by default', () => {
  assert.equal(loadRealtimeChart().api.getRealtimeAuctionEnabled(), true);
});

test('the rendered price chart labels both opening and closing auction regions', () => {
  const chart = loadRealtimeChart();
  chart.api.renderTimeChart([
    { time: '2026-09-18 09:20:00', price: 9.9, volume: 100 },
    { time: '2026-09-18 09:30:00', price: 10, volume: 120 },
    { time: '2026-09-18 14:57:00', price: 10.1, volume: 140 },
    { time: '2026-09-18 15:00:00', price: 10.2, volume: 160 }
  ]);
  const option = chart.getOption();
  assert.ok(option, 'real render path must produce a chart option');
  const regions = option.series.flatMap(series => series.markArea && series.markArea.data || []);
  const regionText = JSON.stringify(regions);

  assert.match(regionText, /开盘竞价/);
  assert.match(regionText, /收盘竞价/);
  assert.match(regionText, /09:15/);
  assert.match(regionText, /09:25/);
  assert.match(regionText, /14:57/);
  assert.match(regionText, /15:00/);
});
