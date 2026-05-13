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
  assert.equal(positions[0].estimatedExitFee, 5);
  assert.equal(positions[0].unrealizedPnl, 990);

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
