const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-hot-market-fallback-'));
process.env.WEBSTOCK_DB_PATH = path.join(testRoot, 'webstock.db');
process.env.NODE_ENV = 'test';
const hotMarket = require('../services/hotMarketService');
const database = require('../db');

test.after(() => {
  database.close();
  fs.rmSync(testRoot, { recursive: true, force: true });
});

test('hot market fallback test never opens the production database', () => {
  assert.notEqual(
    path.resolve(database.dbPath),
    path.resolve(__dirname, '..', 'data', 'webstock.db')
  );
});

test('hot market uses the official delayed Eastmoney host before numbered mirrors', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'hotMarketService.js'), 'utf8');
  const delayed = source.indexOf("'https://push2delay.eastmoney.com'");
  const numbered = source.indexOf("'https://41.push2.eastmoney.com'");
  assert.ok(delayed >= 0, 'official delayed host should be configured');
  assert.ok(numbered < 0 || delayed < numbered, 'delayed host should be attempted before numbered mirrors');
});

test('unavailable market sources keep local watch sectors outside today hot boards', async () => {
  const overview = await hotMarket.getOverview({ refresh: true, fast: true });

  assert.equal(overview.marketStatus, 'unavailable');
  assert.deepEqual(overview.boards.day, []);
  assert.ok(overview.localWatchBoards.length > 0);
  assert.ok(overview.localWatchBoards.every(board => board.kind === 'local-watch'));
  assert.ok(overview.localWatchBoards.every(board => board.heatScore === null));
});
