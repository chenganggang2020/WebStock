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

function loadUnavailableMessage() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'modules', 'hotMarket.js'), 'utf8');
  const context = vm.createContext({ window: {}, console, URLSearchParams, setTimeout, clearTimeout });
  vm.runInContext(source + '\nthis.messageForTest = hotUnavailableMessage;', context, { filename: 'hotMarket.js' });
  return context.messageForTest;
}

test('hot market metric reads the board mainNetInflow contract field', () => {
  const hotMetric = loadHotMetric();
  const withoutFlow = hotMetric({ amount: 0, dailyChangePct: 0, heatScore: 0, mainNetInflow: null });
  const withFlow = hotMetric({ amount: 0, dailyChangePct: 0, heatScore: 0, mainNetInflow: 200000000 });

  assert.equal(withoutFlow, 1);
  assert.ok(withFlow > withoutFlow);
  assert.ok(Math.abs(withFlow - Math.log10(3) * 8) < 1e-12);
});

test('hot market unavailable state names local sectors as a watchlist, not current heat', () => {
  const message = loadUnavailableMessage()({
    marketStatus: 'unavailable',
    localWatchBoards: [{ name: '人工智能' }]
  });

  assert.match(message, /市场热点数据暂不可用/);
  assert.match(message, /本地观察板块/);
  assert.doesNotMatch(message, /今日热点.*人工智能/);
});
