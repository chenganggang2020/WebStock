const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

// Set the isolated database before loading any application module.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-portfolio-valuation-'));
process.env.WEBSTOCK_DB_PATH = path.join(directory, 'test.db');
const portfolio = require('../services/portfolioService');
const db = require('../db');
const iconv = require('iconv-lite');
const quoteSnapshots = require('../services/quoteSnapshotService');
const now = Date.parse('2026-09-08T02:00:00.000Z');

test.beforeEach(t => {
  t.mock.timers.enable({ apis: ['Date'], now });
});

test.after(() => {
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

function accountWithHoldings(codes = ['000001']) {
  const account = portfolio.createAccount({ name: 'Valuation regression', cashBalance: 500 });
  codes.forEach(code => portfolio.createTrade({
    accountId: account.id,
    code,
    name: 'Test holding ' + code,
    side: 'buy',
    tradeDate: '2026-09-01',
    quantity: 100,
    price: 10,
    fee: 0,
    tax: 0
  }));
  return account;
}

function liveQuote(overrides = {}) {
  return {
    price: 10,
    prevClose: 10,
    change: 0,
    tradeDate: '2026-09-08',
    tradeTime: '10:00:00',
    quoteStatus: 'live',
    ...overrides
  };
}

function valuesFor(account, quotes = {}) {
  const positions = portfolio.getPositions(quotes, { accountId: account.id });
  return {
    positions,
    summary: portfolio.getSummary(positions, { accountId: account.id }),
    allocation: portfolio.getAllocation(positions)
  };
}

function assertUnknownPortfolioTotals(summary) {
  for (const field of [
    'totalMarketValue', 'totalAssets', 'unrealizedPnl', 'todayPnl',
    'todayReferencePnl', 'totalPnl', 'totalPnlRate'
  ]) {
    assert.equal(summary[field], null, field + ' must remain unknown without complete quotes');
  }
}

test('missing quotes keep portfolio value and pnl unknown while preserving cash and cost', () => {
  const { summary } = valuesFor(accountWithHoldings());

  assertUnknownPortfolioTotals(summary);
  assert.equal(summary.cashBalance, 500);
  assert.equal(summary.totalCost, 1000);
  assert.equal(summary.realizedPnl, 0);
  assert.equal(summary.valuationStatus, 'unavailable');
  assert.deepEqual(summary.quoteCoverage, { total: 1, priced: 0, live: 0, stale: 0, missing: 1 });
});

test('null, zero, negative and nonfinite prices never count as priced positions', () => {
  const account = accountWithHoldings();
  for (const price of [null, undefined, '', 0, -1, NaN, Infinity]) {
    const { summary } = valuesFor(account, { '000001': liveQuote({ price }) });
    assertUnknownPortfolioTotals(summary);
    assert.equal(summary.valuationStatus, 'unavailable');
    assert.deepEqual(summary.quoteCoverage, { total: 1, priced: 0, live: 0, stale: 0, missing: 1 });
  }
});

test('missing quotes do not produce a cost-based market allocation', () => {
  const { allocation } = valuesFor(accountWithHoldings());

  assert.equal(allocation[0].marketValue, null);
  assert.equal(allocation[0].ratio, null);
});

test('partial quote coverage never reports a whole-portfolio total', () => {
  const { positions, summary } = valuesFor(accountWithHoldings(['000001', '600001']), {
    '000001': liveQuote({ price: 11 })
  });

  assert.equal(positions.find(position => position.code === '000001').marketValue, 1100);
  assertUnknownPortfolioTotals(summary);
  assert.equal(summary.totalCost, 2000);
  assert.equal(summary.positionCount, 2);
  assert.equal(summary.valuationStatus, 'partial');
  assert.deepEqual(summary.quoteCoverage, { total: 2, priced: 1, live: 1, stale: 0, missing: 1 });
});

test('partial allocation preserves known prices but does not invent whole-portfolio percentages', () => {
  const { allocation } = valuesFor(accountWithHoldings(['000001', '600001']), {
    '000001': liveQuote({ price: 11 })
  });
  const priced = allocation.find(item => item.code === '000001');
  const missing = allocation.find(item => item.code === '600001');

  assert.equal(priced.marketValue, 1100);
  assert.equal(missing.marketValue, null);
  assert.equal(priced.ratio, null);
  assert.equal(missing.ratio, null);
});

test('complete live quotes preserve genuine zero pnl instead of replacing it with unavailable', () => {
  const { summary, allocation } = valuesFor(accountWithHoldings(), { '000001': liveQuote() });

  assert.equal(summary.totalMarketValue, 1000);
  assert.equal(summary.totalAssets, 1500);
  assert.equal(summary.unrealizedPnl, 0);
  assert.equal(summary.totalPnl, 0);
  assert.equal(summary.totalPnlRate, 0);
  assert.equal(summary.todayPnl, 0);
  assert.equal(summary.todayReferencePnl, 0);
  assert.equal(summary.valuationStatus, 'live');
  assert.deepEqual(summary.quoteCoverage, { total: 1, priced: 1, live: 1, stale: 0, missing: 0 });
  assert.equal(allocation[0].ratio, 100);
});

test('a valid current price without previous close cannot turn unknown daily pnl into zero', () => {
  const { summary } = valuesFor(accountWithHoldings(), { '000001': liveQuote({ prevClose: null }) });

  assert.equal(summary.totalMarketValue, 1000);
  assert.equal(summary.unrealizedPnl, 0);
  assert.equal(summary.todayPnl, null);
  assert.equal(summary.todayReferencePnl, null);
});

for (const quoteStatus of ['stale']) {
  test(quoteStatus + ' prices remain dated valuation, not current daily pnl', () => {
    const { positions, summary } = valuesFor(accountWithHoldings(), {
      '000001': liveQuote({ price: 11, tradeDate: '2026-09-07', tradeTime: '15:00:00', quoteStatus })
    });

    assert.equal(positions[0].quoteDate, '2026-09-07');
    assert.equal(positions[0].quoteStatus, quoteStatus);
    assert.equal(summary.totalMarketValue, 1100);
    assert.equal(summary.totalAssets, 1600);
    assert.equal(summary.unrealizedPnl, 100);
    assert.equal(summary.todayPnl, null);
    assert.equal(summary.todayReferencePnl, null);
    assert.equal(summary.valuationStatus, 'stale');
    assert.deepEqual(summary.quoteCoverage, { total: 1, priced: 1, live: 0, stale: 1, missing: 0 });
  });
}

test('latest completed close exposes dated trading-day pnl while keeping valuation non-live', () => {
  const { positions, summary } = valuesFor(accountWithHoldings(), {
    '000001': liveQuote({ price: 11, prevClose: 10.5, tradeDate: '2026-09-07', tradeTime: '15:00:00', quoteStatus: 'latest-close' })
  });
  assert.equal(positions[0].todayPnl, 50);
  assert.equal(positions[0].todayPnlDate, '2026-09-07');
  assert.equal(summary.todayPnl, 50);
  assert.equal(summary.todayPnlDate, '2026-09-07');
  assert.equal(summary.todayPnlStatus, 'latest-close');
  assert.equal(summary.valuationStatus, 'stale');
});

test('mixed live and stale prices never label the full valuation or daily pnl as live', () => {
  const { summary } = valuesFor(accountWithHoldings(['000001', '600001']), {
    '000001': liveQuote(),
    '600001': liveQuote({ price: 12, tradeDate: '2026-09-07', quoteStatus: 'stale' })
  });

  assert.equal(summary.totalMarketValue, 2200);
  assert.equal(summary.totalAssets, 2700);
  assert.equal(summary.todayPnl, null);
  assert.equal(summary.valuationStatus, 'stale');
  assert.deepEqual(summary.quoteCoverage, { total: 2, priced: 2, live: 1, stale: 1, missing: 0 });
});

test('an empty cash-only portfolio is a known empty position set, not missing market data', () => {
  const { summary, allocation } = valuesFor(accountWithHoldings([]));

  assert.equal(summary.totalMarketValue, 0);
  assert.equal(summary.totalAssets, 500);
  assert.equal(summary.totalCost, 0);
  assert.equal(summary.totalPnl, 0);
  assert.equal(summary.todayPnl, 0);
  assert.equal(summary.valuationStatus, 'empty');
  assert.deepEqual(summary.quoteCoverage, { total: 0, priced: 0, live: 0, stale: 0, missing: 0 });
  assert.deepEqual(allocation, []);
});

function providerPayload(tradeDate, tradeTime = '10:00:00') {
  const fields = new Array(32).fill('0');
  fields[0] = 'Test holding';
  fields[1] = fields[2] = '10';
  fields[3] = fields[4] = '11';
  fields[5] = '9';
  fields[30] = tradeDate;
  fields[31] = tradeTime;
  return iconv.encode('var hq_str_sz000001="' + fields.join(',') + '";\n', 'gbk');
}

async function readPortfolioRoute(routePath, accountId, payload) {
  const filename = path.join(__dirname, '..', 'routes', 'portfolio.js');
  const routeModule = { exports: {} };
  const dependencies = {
    express: require('express'),
    'iconv-lite': iconv,
    '../services/portfolioService': portfolio,
    '../services/quoteSnapshotService': quoteSnapshots,
    '../services/tonghuashunWatchlistService': {},
    '../services/tonghuashunHoldingService': {},
    '../services/watchlistLevelService': {},
    './ai': {},
    '../utils/market': require('../utils/market'),
    '../services/handoffFormat': {},
    '../services/marketDataService': { get: async () => ({ data: payload }) }
  };

  // Load the complete router; only the provider and unused side-effect boundaries are replaced.
  // Invoke its real GET handler directly, without opening any socket or production endpoint.
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: routeModule,
    exports: routeModule.exports,
    require(id) {
      assert.ok(Object.hasOwn(dependencies, id), 'Unexpected route dependency: ' + id);
      return dependencies[id];
    },
    Buffer,
    Date,
    console
  }, { filename });
  const route = routeModule.exports.stack.find(layer => layer.route && layer.route.path === routePath);
  assert.ok(route && route.route.methods.get, 'GET route must exist: ' + routePath);
  let response;
  let statusCode = 200;
  await route.route.stack[0].handle({ query: { accountId } }, {
    status(value) { statusCode = value; return this; },
    json(value) { response = value; }
  });
  assert.equal(statusCode, 200, JSON.stringify(response));
  assert.equal(response.success, true, JSON.stringify(response));
  return response.data;
}

test('portfolio GET positions keeps a previous-session quote out of live status', async () => {
  const account = accountWithHoldings();
  const positions = await readPortfolioRoute('/positions', account.id, providerPayload('2026-09-07', '15:00:00'));

  assert.equal(positions[0].currentPrice, 11);
  assert.equal(positions[0].quoteDate, '2026-09-07');
  assert.equal(positions[0].quoteStatus, 'latest-close');
});

test('portfolio GET positions labels a current-session quote live using the same fixed clock', async () => {
  const account = accountWithHoldings();
  const positions = await readPortfolioRoute('/positions', account.id, providerPayload('2026-09-08'));

  assert.equal(positions[0].currentPrice, 11);
  assert.equal(positions[0].quoteDate, '2026-09-08');
  assert.equal(positions[0].quoteStatus, 'live');
});

test('portfolio GET positions marks a twenty-minute-old same-day quote stale', async () => {
  const account = accountWithHoldings();
  const positions = await readPortfolioRoute('/positions', account.id, providerPayload('2026-09-08', '09:40:00'));

  assert.equal(positions[0].quoteStatus, 'stale');
});

test('portfolio GET positions never labels missing or malformed quote timestamps live', async () => {
  const account = accountWithHoldings();
  for (const [date, time] of [['', ''], ['not-a-date', '10:00:00'], ['2026-09-08', ''], ['2026-09-08', '25:99:99']]) {
    const positions = await readPortfolioRoute('/positions', account.id, providerPayload(date, time));
    assert.notEqual(positions[0].quoteStatus, 'live', date + ' ' + time + ' is not a valid current quote timestamp');
  }
});

test('portfolio GET positions never labels a quote beyond the future-clock tolerance live', async () => {
  const account = accountWithHoldings();
  const positions = await readPortfolioRoute('/positions', account.id, providerPayload('2026-09-08', '10:01:00'));

  assert.notEqual(positions[0].quoteStatus, 'live');
});

test('portfolio GET summary preserves unavailable totals when the provider returns no quote', async () => {
  const account = accountWithHoldings();
  const summary = await readPortfolioRoute('/summary', account.id, Buffer.alloc(0));

  assertUnknownPortfolioTotals(summary);
  assert.equal(summary.valuationStatus, 'unavailable');
  assert.deepEqual(summary.quoteCoverage, { total: 1, priced: 0, live: 0, stale: 0, missing: 1 });
});

function renderPortfolioSummary(summary, positions = []) {
  const filename = path.join(__dirname, '..', 'js', 'modules', 'portfolio.js');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const elements = Object.fromEntries(Array.from(html.matchAll(/\bid="([^"]+)"/g), match => [
    match[1], { textContent: '', innerHTML: '', title: '', className: '', style: {}, hidden: false, value: '' }
  ]));
  const downloads = [];
  const chartCalls = { allocation: [], pnl: [] };
  const window = {
    State: { portfolioSummary: summary, positions, portfolioAccounts: [], minuteSeriesByCode: {} },
    QuoteSnapshotClientModel: require('../js/modules/quoteSnapshotClientModel'),
    ApiClient: { fetchJsonData: async () => [] },
    PortfolioCharts: {
      renderAllocationChart(data) { chartCalls.allocation.push(data); },
      renderPnlRankChart(data) { chartCalls.pnl.push(data); }
    },
    apiFetch() { throw new Error('Summary rendering must not make network requests'); }
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    window,
    document: {
      getElementById(id) { return elements[id] || null; },
      querySelector() { return null; },
      createElement() { return { click() {} }; },
      body: { appendChild() {}, removeChild() {}, classList: { contains() { return false; } } }
    },
    Blob: class { constructor(parts) { this.parts = parts; } },
    URL: { createObjectURL(blob) { downloads.push(blob.parts.join('')); return 'blob:test'; }, revokeObjectURL() {} },
    Date,
    console
  }, { filename });
  window.Portfolio.renderSummary();
  return {
    api: window.Portfolio,
    state: window.State,
    elements,
    downloads,
    chartCalls,
    get visibleText() {
      return Object.values(elements)
        .filter(element => !element.hidden && element.style.display !== 'none')
        .map(element => (element.textContent + ' ' + element.innerHTML.replace(/<[^>]*>/g, ' ')).trim())
        .filter(Boolean)
        .join('\n');
    }
  };
}

function summaryFixture(overrides = {}) {
  return {
    cashBalance: 500,
    totalCost: 1000,
    realizedPnl: 0,
    totalAssets: 1500,
    totalMarketValue: 1000,
    unrealizedPnl: 0,
    todayPnl: 0,
    todayReferencePnl: 0,
    totalPnl: 0,
    totalPnlRate: 0,
    valuationStatus: 'live',
    quoteDate: '2026-09-08',
    quoteTime: '10:00:00',
    quoteCoverage: { total: 1, priced: 1, live: 1, stale: 0, missing: 0 },
    ...overrides
  };
}

test('portfolio summary UI explains missing or partial quote coverage without displaying invented totals', () => {
  for (const valuationStatus of ['unavailable', 'partial']) {
    const partial = valuationStatus === 'partial';
    const app = renderPortfolioSummary(summaryFixture({
      totalAssets: null,
      totalMarketValue: null,
      unrealizedPnl: null,
      todayPnl: null,
      todayReferencePnl: null,
      totalPnl: null,
      totalPnlRate: null,
      valuationStatus,
      quoteDate: partial ? '2026-09-08' : '',
      quoteTime: partial ? '10:00:00' : '',
      quoteCoverage: { total: 2, priced: partial ? 1 : 0, live: partial ? 1 : 0, stale: 0, missing: partial ? 1 : 2 }
    }));

    for (const id of ['summaryTotalAssets', 'summaryMarketValue', 'summaryUnrealizedPnl', 'summaryTodayReferencePnl', 'summaryTotalPnl']) {
      assert.equal(app.elements[id].textContent, '--', valuationStatus + ': ' + id);
    }
    assert.equal(app.elements.summaryCashBalance.textContent, '500.00');
    assert.equal(app.elements.summaryCost.textContent, '1000.00');
    assert.match(app.visibleText, /(?:行情|报价|估值)[^\n]*(?:缺失|缺少|不可用|不完整|不足|覆盖)|(?:缺失|缺少|不可用|不完整|不足|覆盖)[^\n]*(?:行情|报价|估值)/,
      valuationStatus + ' must explain why complete valuation is unavailable');
  }
});

test('portfolio summary UI shows the historical quote date and non-live valuation warning', () => {
  const app = renderPortfolioSummary(summaryFixture({
    totalAssets: 1600,
    totalMarketValue: 1100,
    unrealizedPnl: 100,
    totalPnl: 100,
    totalPnlRate: 10,
    todayPnl: null,
    todayReferencePnl: null,
    valuationStatus: 'stale',
    quoteDate: '2026-09-07',
    quoteTime: '15:00:00',
    quoteCoverage: { total: 1, priced: 1, live: 0, stale: 1, missing: 0 }
  }));

  assert.equal(app.elements.summaryMarketValue.textContent, '1100.00');
  assert.equal(app.elements.summaryTodayReferencePnl.textContent, '--');
  assert.match(app.visibleText, /2026[-/]09[-/]07/);
  assert.match(app.visibleText, /非实时|历史|过时|旧行情|陈旧|收盘|已过期/);
});

test('portfolio summary UI keeps genuine zero pnl visible as 0.00', () => {
  const app = renderPortfolioSummary(summaryFixture());

  for (const id of ['summaryUnrealizedPnl', 'summaryTodayReferencePnl', 'summaryRealizedPnl', 'summaryTotalPnl']) {
    assert.equal(app.elements[id].textContent, '0.00', id + ' must distinguish zero from unknown');
  }
  assert.equal(app.elements.summaryPnlRate.textContent, '0.00%');
});

function positionFixture(overrides = {}) {
  return {
    code: '000001', name: 'Test holding', quantity: 100, avgCost: 10,
    costValue: 1000, investedCapital: 1000, realizedPnl: 0,
    currentPrice: 10, price: 10, prevClose: 10, marketValue: 1000,
    unrealizedPnl: 0, todayPnl: 0, todayReferencePnl: 0,
    todayPnlDate: '2026-09-08', quoteDate: '2026-09-08', quoteTime: '10:00:00', quoteStatus: 'live',
    ...overrides
  };
}

function unavailablePosition(overrides = {}) {
  return positionFixture({
    currentPrice: null, price: null, prevClose: null, marketValue: null,
    unrealizedPnl: null, todayPnl: null, todayReferencePnl: null,
    quoteStatus: 'unavailable', quoteDate: '', quoteTime: '',
    ...overrides
  });
}

test('the real quote client model preserves backend unknown totals and missing allocation values', () => {
  const model = require('../js/modules/quoteSnapshotClientModel');
  const positions = [unavailablePosition()];
  const summary = model.summarizePortfolio(summaryFixture({
    totalAssets: null, totalMarketValue: null, unrealizedPnl: null,
    todayPnl: null, todayReferencePnl: null, totalPnl: null, totalPnlRate: null,
    valuationStatus: 'unavailable', quoteCoverage: { total: 1, priced: 0, live: 0, stale: 0, missing: 1 }
  }), positions);

  assertUnknownPortfolioTotals(summary);
  assert.equal(summary.valuationStatus, 'unavailable');
  assert.deepEqual(summary.quoteCoverage, { total: 1, priced: 0, live: 0, stale: 0, missing: 1 });
  assert.equal(model.allocation(positions)[0].marketValue, null);
  assert.equal(model.allocation(positions)[0].ratio, null);
});

test('portfolio quote heartbeat preserves partial coverage instead of rebuilding a complete valuation', () => {
  const app = renderPortfolioSummary(summaryFixture({ totalCost: 2000 }), [
    unavailablePosition(), unavailablePosition({ code: '600001' })
  ]);

  app.api.applyQuoteSnapshot([{ code: '000001', ...liveQuote({ price: 11 }) }], {});

  assertUnknownPortfolioTotals(app.state.portfolioSummary);
  assert.equal(app.state.positions[0].marketValue, 1100);
  assert.equal(app.state.portfolioSummary.valuationStatus, 'partial');
  assert.deepEqual(app.state.portfolioSummary.quoteCoverage, { total: 2, priced: 1, live: 1, stale: 0, missing: 1 });
  assert.equal(app.state.portfolioAllocation[1].marketValue, null);
  assert.ok(app.state.portfolioAllocation.every(item => item.ratio === null));
  assert.equal(app.elements.summaryMarketValue.textContent, '--');
});

test('portfolio quote heartbeat preserves an explicit zero pnl through the real client model', () => {
  const app = renderPortfolioSummary(summaryFixture(), [positionFixture()]);

  app.api.applyQuoteSnapshot([{ code: '000001', ...liveQuote() }], {});

  assert.equal(app.state.portfolioSummary.unrealizedPnl, 0);
  assert.equal(app.state.portfolioSummary.totalPnl, 0);
  assert.equal(app.state.portfolioSummary.todayPnl, 0);
  assert.equal(app.state.portfolioSummary.valuationStatus, 'live');
  assert.deepEqual(app.state.portfolioSummary.quoteCoverage, { total: 1, priced: 1, live: 1, stale: 0, missing: 0 });
  assert.equal(app.elements.summaryUnrealizedPnl.textContent, '0.00');
});

test('portfolio quote heartbeat updates stale valuation status when a fresh quote arrives', () => {
  const app = renderPortfolioSummary(summaryFixture({
    valuationStatus: 'stale', todayPnl: null, todayReferencePnl: null,
    quoteDate: '2026-09-07', quoteTime: '15:00:00',
    quoteCoverage: { total: 1, priced: 1, live: 0, stale: 1, missing: 0 }
  }), [positionFixture({ quoteStatus: 'stale', quoteDate: '2026-09-07', todayPnl: null, todayReferencePnl: null })]);

  app.api.applyQuoteSnapshot([{ code: '000001', ...liveQuote({ price: 11 }) }], {});

  assert.equal(app.state.portfolioSummary.totalMarketValue, 1100);
  assert.equal(app.state.portfolioSummary.valuationStatus, 'live');
  assert.deepEqual(app.state.portfolioSummary.quoteCoverage, { total: 1, priced: 1, live: 1, stale: 0, missing: 0 });
  assert.equal(app.state.positions[0].quoteDate, '2026-09-08');
  assert.equal(app.state.portfolioSummary.todayPnl, null, 'a price-only heartbeat cannot reconstruct missing transaction-adjusted daily pnl');
});

test('portfolio quote heartbeat clears current daily pnl when live quotes become stale', () => {
  const app = renderPortfolioSummary(summaryFixture(), [positionFixture()]);

  app.api.applyQuoteSnapshot([{
    code: '000001', ...liveQuote({ price: 11, tradeDate: '2026-09-07', tradeTime: '15:00:00', quoteStatus: 'stale' })
  }], { stale: true });

  assert.equal(app.state.portfolioSummary.totalMarketValue, 1100);
  assert.equal(app.state.portfolioSummary.todayPnl, null);
  assert.equal(app.state.portfolioSummary.todayReferencePnl, null);
  assert.equal(app.state.positions[0].todayPnl, null);
  assert.equal(app.state.portfolioSummary.valuationStatus, 'stale');
  assert.deepEqual(app.state.portfolioSummary.quoteCoverage, { total: 1, priced: 1, live: 0, stale: 1, missing: 0 });
  assert.equal(app.elements.summaryTodayReferencePnl.textContent, '--');
});

test('portfolio quote heartbeat withdraws current valuation when the provider explicitly reports unavailable', () => {
  const app = renderPortfolioSummary(summaryFixture(), [positionFixture()]);

  app.api.applyQuoteSnapshot([{ code: '000001', price: 0, quoteStatus: 'unavailable', reason: 'provider-returned-no-quote' }], {});

  assert.equal(app.state.positions[0].currentPrice, null);
  assert.equal(app.state.positions[0].marketValue, null);
  assertUnknownPortfolioTotals(app.state.portfolioSummary);
  assert.equal(app.state.portfolioSummary.valuationStatus, 'unavailable');
  assert.deepEqual(app.state.portfolioSummary.quoteCoverage, { total: 1, priced: 0, live: 0, stale: 0, missing: 1 });
  assert.equal(app.state.portfolioAllocation[0].marketValue, null);
  assert.equal(app.state.portfolioAllocation[0].ratio, null);
  assert.equal(app.elements.summaryMarketValue.textContent, '--');
});

test('portfolio rows, exposure statistics and CSV do not substitute cost for unavailable market value', () => {
  const app = renderPortfolioSummary(summaryFixture(), [unavailablePosition()]);
  app.api.renderPositions();
  app.api.renderStatsOverview();
  app.api.exportPositionsCsv();
  assert.doesNotMatch(app.elements.positionsTbody.innerHTML, /<td>1000\.00<\/td>/);
  assert.doesNotMatch(app.elements.statsExposureTable.innerHTML, /<td>1000\.00<\/td>/);
  const cells = app.downloads[0].trim().split(/\r?\n/)[1].split(',');
  assert.equal(cells[5], '--');
  assert.equal(cells[6], '1000.00', 'the separately labeled cost column remains available');
});

test('ordinary price heartbeat avoids chart redraw but lost coverage invalidates previously complete charts', () => {
  const app = renderPortfolioSummary(summaryFixture(), [positionFixture()]);
  app.api.applyQuoteSnapshot([{ code: '000001', ...liveQuote({ price: 11 }) }], {});
  assert.equal(app.chartCalls.allocation.length, 0);
  app.api.applyQuoteSnapshot([{ code: '000001', price: 0, quoteStatus: 'unavailable' }], {});
  assert.equal(app.chartCalls.allocation.length, 1);
  assert.equal(app.chartCalls.allocation[0][0].marketValue, null);
  assert.equal(app.chartCalls.pnl[0][0].unrealizedPnl, null);
});
