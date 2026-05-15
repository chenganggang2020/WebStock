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
  assert.equal(buy.fee, 50);
  assert.equal(buy.amount, 10050);

  const positions = portfolio.getPositions({ '000001': { price: 11, change: 1.5 } });
  assert.equal(positions.length, 1);
  assert.equal(positions[0].quantity, 1000);
  assert.equal(positions[0].avgCost, 10.05);
  assert.equal(positions[0].grossUnrealizedPnl, 950);
  assert.equal(positions[0].estimatedExitFee, 0);
  assert.equal(positions[0].totalFee, 50);
  assert.equal(positions[0].unrealizedPnl, 950);

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
  assert.equal(sell.fee, 50);
  assert.equal(sell.amount, 10949);

  const closed = portfolio.getClosedPositions();
  assert.equal(closed.length, 1);
  assert.equal(closed[0].code, '000001');
  assert.equal(closed[0].realizedPnl, 899);
  assert.equal(closed[0].tradeCount, 2);
  assert.equal(closed[0].firstTradeDate, '2026-05-11');
  assert.equal(closed[0].lastTradeDate, '2026-05-13');
  assert.equal(portfolio.getPositions().length, 0);
});

test('open position final pnl excludes realized pnl from earlier partial sells', () => {
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
    fee: 0,
    tax: 0
  });

  const positions = portfolio.getPositions({ '561560': { price: 1.394, change: -1.97 } });
  assert.equal(positions.length, 1);
  assert.equal(positions[0].quantity, 400);
  assert.equal(positions[0].costValue, 579.6);
  assert.equal(positions[0].realizedPnl, -40);
  assert.equal(positions[0].unrealizedPnl, -22);
  assert.equal(positions[0].netPnl, -22);
  assert.equal(positions[0].symbolTotalPnl, -62);
});
