const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('node:assert/strict');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-portfolio-'));
process.env.WEBSTOCK_DB_PATH = path.join(tmpDir, 'webstock-test.db');
process.env.OPENAI_API_KEY = '';

const app = require('../server');

function request(server, method, urlPath, body) {
  const port = server.address().port;
  const payload = body ? JSON.stringify(body) : null;

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers: payload ? {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      } : {}
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        const json = raw ? JSON.parse(raw) : null;
        resolve({ statusCode: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  const server = app.listen(0);
  const ids = { watchlist: null, buy: null, sell: null };
  try {
    const watch = await request(server, 'POST', '/api/portfolio/watchlist', {
      code: '990001',
      name: '测试组合股',
      groupName: '测试分组',
      note: 'portfolio smoke'
    });
    assert.equal(watch.body.success, true, watch.body.error);
    ids.watchlist = watch.body.data.id;

    const watchList = await request(server, 'GET', '/api/portfolio/watchlist');
    assert.equal(watchList.body.success, true);
    assert.equal(watchList.body.data.some(item => item.code === '990001'), true);

    const buy = await request(server, 'POST', '/api/portfolio/trades', {
      code: '990001',
      name: '测试组合股',
      side: 'buy',
      tradeDate: '2026-05-01',
      price: 10,
      quantity: 1000,
      fee: 5,
      tax: 0,
      note: '测试买入'
    });
    assert.equal(buy.body.success, true, buy.body.error);
    ids.buy = buy.body.data.id;

    const trades = await request(server, 'GET', '/api/portfolio/trades?code=990001');
    assert.equal(trades.body.success, true);
    assert.equal(trades.body.data.length, 1);

    const positions = await request(server, 'GET', '/api/portfolio/positions');
    assert.equal(positions.body.success, true);
    const pos = positions.body.data.find(item => item.code === '990001');
    assert.ok(pos);
    assert.equal(pos.quantity, 1000);
    assert.equal(pos.avgCost, 10.005);

    const summary = await request(server, 'GET', '/api/portfolio/summary');
    assert.equal(summary.body.success, true);
    assert.equal(summary.body.data.positionCount, 1);

    const sell = await request(server, 'POST', '/api/portfolio/trades', {
      code: '990001',
      name: '测试组合股',
      side: 'sell',
      tradeDate: '2026-05-05',
      price: 11,
      quantity: 300,
      fee: 5,
      tax: 3.3,
      note: '测试卖出'
    });
    assert.equal(sell.body.success, true, sell.body.error);
    ids.sell = sell.body.data.id;

    const oversell = await request(server, 'POST', '/api/portfolio/trades', {
      code: '990001',
      name: '测试组合股',
      side: 'sell',
      tradeDate: '2026-05-06',
      price: 11,
      quantity: 10000,
      fee: 0,
      tax: 0
    });
    assert.equal(oversell.body.success, false);
    assert.match(oversell.body.error, /卖出数量超过当前持仓/);

    const afterSell = await request(server, 'GET', '/api/portfolio/positions');
    const afterPos = afterSell.body.data.find(item => item.code === '990001');
    assert.equal(afterPos.quantity, 700);
    assert.equal(afterPos.costValue, 7003.5);
    assert.equal(afterPos.realizedPnl, 290.2);

    await request(server, 'DELETE', '/api/portfolio/trades/' + ids.sell);
    await request(server, 'DELETE', '/api/portfolio/trades/' + ids.buy);
    await request(server, 'DELETE', '/api/portfolio/watchlist/' + ids.watchlist);

    console.log('Portfolio API smoke test passed.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    require('../db').close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
