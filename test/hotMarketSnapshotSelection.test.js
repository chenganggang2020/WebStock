const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-hot-market-snapshot-'));
process.env.WEBSTOCK_DB_PATH = path.join(testRoot, 'webstock.db');
process.env.NODE_ENV = 'test';

const database = require('../db');
const hotMarket = require('../services/hotMarketService');

function todayString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function validPayload(name) {
  return {
    generatedAt: new Date().toISOString(),
    tradeDate: todayString(),
    degraded: false,
    errors: [],
    sources: ['snapshot-test'],
    marketStatus: 'available',
    localWatchBoards: [],
    boards: {
      day: [{ code: 'BK001', name, kind: 'industry', dailyChangePct: 1.2, mainNetInflow: 100 }],
      month: []
    },
    hotStocks: [{ code: '000001', name: '平安银行' }],
    news: []
  };
}

function unavailablePayload() {
  return {
    generatedAt: new Date().toISOString(),
    tradeDate: todayString(),
    degraded: true,
    errors: ['Eastmoney sector rank: external hot market fetch disabled'],
    sources: ['Local sector watchlist'],
    marketStatus: 'unavailable',
    localWatchBoards: [],
    boards: { day: [], month: [] },
    hotStocks: [],
    news: []
  };
}

test.after(() => {
  database.close();
  fs.rmSync(testRoot, { recursive: true, force: true });
});

test('fast overview skips a newer empty unavailable snapshot and returns the newest usable snapshot', async () => {
  const insert = database.prepare(`
    INSERT INTO hot_market_snapshots (snapshot_date, source, payload_json, created_at)
    VALUES (?, ?, ?, ?)
  `);
  const date = todayString();
  insert.run(date, 'snapshot-test', JSON.stringify(validPayload('较早有效行业')), date + ' 08:00:00');
  insert.run(date, 'snapshot-test', JSON.stringify(validPayload('最近有效行业')), date + ' 09:00:00');
  insert.run(date, 'offline-test', JSON.stringify(unavailablePayload()), date + ' 10:00:00');

  const overview = await hotMarket.getOverview({ fast: true });

  assert.equal(overview.marketStatus, 'available');
  assert.equal(overview.boards.day.length, 1);
  assert.equal(overview.boards.day[0].name, '最近有效行业');
  assert.equal(overview.hotStocks.length, 1);
});
