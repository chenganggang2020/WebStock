const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDbPath = path.join(os.tmpdir(), 'webstock-portfolio-service-' + process.pid + '.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
}
process.env.WEBSTOCK_DB_PATH = testDbPath;

const portfolio = require('../services/portfolioService');

test('portfolio service calculates positions and prevents oversell', () => {
  const buy = portfolio.createTrade({
    code: '000001',
    name: '平安银行',
    side: 'buy',
    tradeDate: '2026-05-11',
    price: 10,
    quantity: 1000,
    fee: 5
  });
  assert.equal(buy.amount, 10005);

  const positions = portfolio.getPositions({ '000001': { price: 11, change: 1.5 } });
  assert.equal(positions.length, 1);
  assert.equal(positions[0].quantity, 1000);
  assert.equal(positions[0].avgCost, 10.005);
  assert.equal(positions[0].grossUnrealizedPnl, 995);
  assert.equal(positions[0].estimatedExitFee, 0);
  assert.equal(positions[0].totalFee, 5);
  assert.equal(positions[0].unrealizedPnl, 995);

  assert.throws(() => portfolio.createTrade({
    code: '000001',
    name: '平安银行',
    side: 'sell',
    tradeDate: '2026-05-12',
    price: 11,
    quantity: 2000
  }), /卖出数量|超过/);
  const sell = portfolio.createTrade({
    code: '000001',
    name: 'Ping An Bank',
    side: 'sell',
    tradeDate: '2026-05-13',
    price: 11,
    quantity: 1000,
    fee: 3,
    tax: 1
  });
  assert.equal(sell.amount, 10996);

  const closed = portfolio.getClosedPositions();
  assert.equal(closed.length, 1);
  assert.equal(closed[0].code, '000001');
  assert.equal(closed[0].realizedPnl, 991);
  assert.equal(closed[0].tradeCount, 2);
  assert.equal(closed[0].firstTradeDate, '2026-05-11');
  assert.equal(closed[0].lastTradeDate, '2026-05-13');
  assert.equal(portfolio.getPositions().length, 0);
});

test('today reference pnl uses current price minus previous close', () => {
  portfolio.createTrade({
    code: '300001',
    name: '特锐德',
    side: 'buy',
    tradeDate: '2026-05-14',
    price: 10,
    quantity: 100,
    fee: 5
  });

  const positions = portfolio.getPositions({ '300001': { price: 10.52, prevClose: 10.49, change: 0.29 } });
  assert.equal(positions.length, 1);
  assert.equal(positions[0].unrealizedPnl, 47);
  assert.equal(positions[0].todayReferencePnl, 3);
  assert.equal(positions[0].todayPnl, 3);

  portfolio.createTrade({
    code: '300001',
    name: '特锐德',
    side: 'sell',
    tradeDate: '2026-05-15',
    price: 10.52,
    quantity: 100,
    fee: 5,
    tax: 0
  });
});

test('open position final pnl counts one fee per trade record', () => {
  portfolio.createTrade({
    code: '561560',
    name: '电力ETF',
    side: 'buy',
    tradeDate: '2026-05-11',
    price: 1.399,
    quantity: 400,
    fee: 5
  });
  portfolio.createTrade({
    code: '561560',
    name: '电力ETF',
    side: 'buy',
    tradeDate: '2026-05-12',
    price: 1.399,
    quantity: 400,
    fee: 5
  });
  portfolio.createTrade({
    code: '561560',
    name: '电力ETF',
    side: 'sell',
    tradeDate: '2026-05-13',
    price: 1.399,
    quantity: 400,
    fee: 5,
    tax: 0
  });

  const positions = portfolio.getPositions({ '561560': { price: 1.394, change: -1.97 } });
  assert.equal(positions.length, 1);
  assert.equal(positions[0].quantity, 400);
  assert.equal(positions[0].costValue, 564.6);
  assert.equal(positions[0].realizedPnl, -10);
  assert.equal(positions[0].unrealizedPnl, -7);
  assert.equal(positions[0].netPnl, -7);
  assert.equal(positions[0].symbolTotalPnl, -17);
});

test('deleting an earlier buy is rejected when it would leave an oversold history', () => {
  const buy = portfolio.createTrade({
    code: '600001',
    name: 'Delete guard',
    side: 'buy',
    tradeDate: '2026-06-01',
    price: 10,
    quantity: 100,
    fee: 5
  });
  portfolio.createTrade({
    code: '600001',
    name: 'Delete guard',
    side: 'sell',
    tradeDate: '2026-06-02',
    price: 11,
    quantity: 100,
    fee: 5
  });

  assert.throws(() => portfolio.deleteTrade(buy.id), /卖出数量|超过当前持仓|trade history/i);
  assert.equal(portfolio.listTrades({ code: '600001' }).length, 2);
});

test('today pnl includes same-day buy cash flow and deducts its trade fee once', () => {
  portfolio.createTrade({
    code: '600002',
    name: 'Same day buy',
    side: 'buy',
    tradeDate: '2026-06-10',
    price: 10,
    quantity: 100,
    fee: 5
  });

  const position = portfolio.getPositions({
    '600002': { price: 10.1, prevClose: 9.8, change: 3.06, tradeDate: '2026-06-10' }
  }).find(item => item.code === '600002');

  assert.equal(position.todayPnl, 5);
  assert.equal(position.todayReferencePnl, 5);
  assert.equal(position.todayPnlMethod, 'transaction-adjusted');
  assert.equal(position.todayPnlDate, '2026-06-10');
});

test('today pnl adjusts for same-day buys, sells, fees and taxes', () => {
  portfolio.createTrade({
    code: '600003',
    name: 'Intraday cash flow',
    side: 'buy',
    tradeDate: '2026-06-09',
    price: 10,
    quantity: 100,
    fee: 5
  });
  portfolio.createTrade({
    code: '600003',
    name: 'Intraday cash flow',
    side: 'buy',
    tradeDate: '2026-06-10',
    price: 11,
    quantity: 50,
    fee: 5
  });
  portfolio.createTrade({
    code: '600003',
    name: 'Intraday cash flow',
    side: 'sell',
    tradeDate: '2026-06-10',
    price: 11.2,
    quantity: 30,
    fee: 5,
    tax: 1
  });

  const position = portfolio.getPositions({
    '600003': { price: 11.5, prevClose: 10.8, change: 6.48, tradeDate: '2026-06-10' }
  }).find(item => item.code === '600003');

  assert.equal(position.quantity, 120);
  assert.equal(position.todayPnl, 75);
  assert.notEqual(position.todayPnl, 84);
});
