const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadCharts() {
  const options = {};
  const echarts = { init(el) { return { setOption(value) { options[el.id] = value; }, dispose() {}, resize() {} }; } };
  const window = { echarts };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/modules/portfolioCharts.js'), 'utf8'), {
    window, echarts,
    document: { getElementById(id) { return { id }; }, body: { classList: { contains() { return false; } } } }
  });
  return { api: window.PortfolioCharts, options };
}

test('partial valuation is not normalized into a misleading complete allocation pie', () => {
  const app = loadCharts();
  app.api.renderAllocationChart([
    { code: '000001', name: 'Known', marketValue: 1000, ratio: null },
    { code: '000002', name: 'Unknown', marketValue: null, ratio: null }
  ]);
  for (const pie of [app.options.allocationChart, app.options.statsAllocationChart]) {
    assert.equal(pie.series[0].data.length, 0);
    assert.equal(pie.series[0].showEmptyCircle, false);
    assert.match(JSON.stringify(pie.graphic), /行情|报价|估值/);
    assert.ok(pie.graphic[0].z > (pie.series[0].z || 2), 'missing-quote text must remain above the pie layer');
  }
});

test('pnl bars preserve missing values and genuine zero as different outcomes', () => {
  const app = loadCharts();
  app.api.renderPnlRankChart([
    { code: '000001', name: 'Unknown', unrealizedPnl: null },
    { code: '000002', name: 'Zero', unrealizedPnl: 0 }
  ]);
  for (const bar of [app.options.pnlRankChart, app.options.statsPnlChart]) {
    assert.ok(bar.series[0].data.includes(null));
    assert.ok(bar.series[0].data.includes(0));
    assert.equal(bar.series[0].data[bar.xAxis.data.indexOf('Unknown')], null);
    assert.equal(bar.series[0].data[bar.xAxis.data.indexOf('Zero')], 0);
  }
});

test('complete allocation resumes its pie without a missing-quote overlay', () => {
  const app = loadCharts();
  app.api.renderAllocationChart([{ code: '000001', name: 'Known', marketValue: null, ratio: null }]);
  app.api.renderAllocationChart([{ code: '000001', name: 'Known', marketValue: 1000, ratio: 100 }]);
  for (const pie of [app.options.allocationChart, app.options.statsAllocationChart]) {
    assert.equal(pie.series[0].data.length, 1);
    assert.equal(pie.series[0].data[0].value, 1000);
    assert.equal(pie.graphic.length, 0);
  }
});
