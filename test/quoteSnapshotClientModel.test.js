const test = require('node:test');
const assert = require('node:assert/strict');

const QuoteSnapshotClientModel = require('../js/modules/quoteSnapshotClientModel');

test('quote snapshot merges watchlist fields without replacing user metadata', () => {
  const items = [{ code: '000001', name: '平安银行', groupName: '核心', note: '保留' }];
  const quotes = [{
    code: '000001', name: '平安银行', price: 12.34, change: 1.2,
    quoteStatus: 'live', fetchedAt: '2026-08-14T01:30:03.000Z',
    changedAt: '2026-08-14T01:30:03.000Z', source: 'sina-public-quote', stale: false
  }];

  const merged = QuoteSnapshotClientModel.applyWatchlistQuotes(items, quotes);
  assert.equal(merged[0].price, 12.34);
  assert.equal(merged[0].groupName, '核心');
  assert.equal(merged[0].note, '保留');
  assert.equal(merged[0].quoteFetchedAt, '2026-08-14T01:30:03.000Z');
  assert.equal(merged[0].quoteSource, 'sina-public-quote');
});

test('quote snapshot recalculates position valuation but preserves transaction-derived today pnl', () => {
  const positions = [{
    code: '600000', name: '浦发银行', quantity: 100, costValue: 1000,
    investedCapital: 1000, realizedPnl: 20, estimatedExitFee: 5,
    estimatedExitTax: 1, todayPnl: 18, todayReferencePnl: 18
  }];
  const quotes = [{
    code: '600000', price: 12, change: 2, prevClose: 11.76,
    quoteStatus: 'live', fetchedAt: '2026-08-14T01:30:03.000Z', stale: false
  }];

  const valued = QuoteSnapshotClientModel.applyPositionQuotes(positions, quotes);
  assert.equal(valued[0].marketValue, 1200);
  assert.equal(valued[0].grossUnrealizedPnl, 200);
  assert.equal(valued[0].unrealizedPnl, 194);
  assert.equal(valued[0].symbolTotalPnl, 214);
  assert.equal(valued[0].todayPnl, 18);
  assert.equal(valued[0].todayReferencePnl, 18);
});

test('portfolio summary uses updated valuation and leaves unavailable quotes unchanged', () => {
  const prior = {
    cashBalance: 500, realizedPnl: 20, lifetimeBuyCost: 1000,
    todayPnl: 18, todayReferencePnl: 18
  };
  const positions = [{
    code: '600000', costValue: 1000, marketValue: 1200,
    unrealizedPnl: 194, symbolTotalPnl: 214
  }];
  const summary = QuoteSnapshotClientModel.summarizePortfolio(prior, positions);
  assert.equal(summary.totalAssets, 1700);
  assert.equal(summary.totalMarketValue, 1200);
  assert.equal(summary.unrealizedPnl, 194);
  assert.equal(summary.totalPnl, 214);
  assert.equal(summary.totalPnlRate, 21.4);
  assert.equal(summary.todayPnl, 18);

  const unchanged = QuoteSnapshotClientModel.applyPositionQuotes(
    [{ code: '000001', currentPrice: 10, marketValue: 1000, quoteStatus: 'live' }],
    [{ code: '000001', price: 0, quoteStatus: 'unavailable', reason: 'refresh-pending' }]
  );
  assert.equal(unchanged[0].currentPrice, 10);
  assert.equal(unchanged[0].marketValue, 1000);
  assert.equal(unchanged[0].quoteStatus, 'unavailable');
  assert.equal(unchanged[0].quoteReason, 'refresh-pending');
});

test('snapshot signature changes only when user-visible quote evidence changes', () => {
  const quotes = [{ code: '000001', price: 10, quoteStatus: 'latest-close', fetchedAt: 'a', stale: false }];
  const first = QuoteSnapshotClientModel.signature(quotes);
  const same = QuoteSnapshotClientModel.signature([{ ...quotes[0], nextRefreshAt: 'b' }]);
  const changed = QuoteSnapshotClientModel.signature([{ ...quotes[0], price: 10.01 }]);
  assert.equal(first, same);
  assert.notEqual(first, changed);
});
