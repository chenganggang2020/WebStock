const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadHotMetric() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'modules', 'hotMarket.js'), 'utf8');
  const context = vm.createContext({
    window: {},
    console,
    URLSearchParams,
    setTimeout,
    clearTimeout
  });
  vm.runInContext(source + '\nthis.hotMetricForTest = hotMetric;', context, { filename: 'hotMarket.js' });
  return context.hotMetricForTest;
}

test('hot market metric reads the board mainNetInflow contract field', () => {
  const hotMetric = loadHotMetric();
  const withoutFlow = hotMetric({ amount: 0, dailyChangePct: 0, heatScore: 0, mainNetInflow: null });
  const withFlow = hotMetric({ amount: 0, dailyChangePct: 0, heatScore: 0, mainNetInflow: 200000000 });

  assert.equal(withoutFlow, 1);
  assert.ok(withFlow > withoutFlow);
  assert.ok(Math.abs(withFlow - Math.log10(3) * 8) < 1e-12);
});
