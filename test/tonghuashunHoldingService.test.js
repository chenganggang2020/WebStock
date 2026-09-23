const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDbPath = path.join(os.tmpdir(), 'webstock-ths-holdings-' + process.pid + '.db');
process.env.WEBSTOCK_DB_PATH = testDbPath;
try { fs.unlinkSync(testDbPath); } catch (error) {}

const portfolio = require('../services/portfolioService');
const {
  parseHoldingText,
  findNewestHoldingFile,
  syncHoldingText,
  getMonitorHoldingContext,
  getMonitorStatus,
  recordWindowCaptureStatus
} = require('../services/tonghuashunHoldingService');

test.after(function() {
  try { fs.unlinkSync(testDbPath); } catch (error) {}
});

test('Tonghuashun holding parser reads a copied position table', () => {
  const text = [
    '证券代码\t证券名称\t股票余额\t可用余额\t成本价\t市价\t市值\t盈亏\t盈亏比例',
    '600183\t生益科技\t100\t100\t140.051\t143.210\t14,321.00\t315.86\t2.255%',
    '002463\t沪电股份\t200\t200\t59.185\t62.980\t12,596.00\t759.00\t6.410%'
  ].join('\r\n');

  const parsed = parseHoldingText(text);

  assert.equal(parsed.holdings.length, 2);
  assert.deepEqual(parsed.holdings[0], {
    code: '600183',
    name: '生益科技',
    quantity: 100,
    costValue: 14005.1,
    currentPrice: 143.21,
    marketValue: 14321,
    pnl: 315.86,
    pnlRate: 2.255
  });
});

test('Tonghuashun holding parser accepts the live client reference-cost columns', () => {
  const text = [
    '操作\t序号\t证券代码\t证券名称\t股票余额\t可用余额\t冻结数量\t参考成本\t市价\t总盈亏\t盈亏比例(%)',
    '\t1\t600183\t生益科技\t200\t200\t0\t133.651\t147.730\t2815.73\t10.534'
  ].join('\r\n');

  const parsed = parseHoldingText(text);

  assert.deepEqual(parsed.holdings[0], {
    code: '600183',
    name: '生益科技',
    quantity: 200,
    costValue: 26730.2,
    currentPrice: 147.73,
    marketValue: 29546,
    pnl: 2815.73,
    pnlRate: 10.534
  });
});

test('Tonghuashun holding parser accepts normalized JSON exports', () => {
  const parsed = parseHoldingText(JSON.stringify({
    snapshotDate: '2026-08-26',
    cashBalance: 446.86,
    holdings: [
      { code: '600183', name: '生益科技', quantity: 100, avgCost: 140.051, currentPrice: 143.21 }
    ]
  }));

  assert.equal(parsed.snapshotDate, '2026-08-26');
  assert.equal(parsed.cashBalance, 446.86);
  assert.equal(parsed.holdings[0].costValue, 14005.1);
});

test('Tonghuashun holding parser accepts an explicit all-cash snapshot', () => {
  const parsed = parseHoldingText(JSON.stringify({
    snapshotDate: '2026-09-02',
    cashBalance: 100000,
    totalMarketValue: 0,
    totalAssets: 100000,
    holdingsComplete: true,
    holdings: []
  }), { catalog: new Map() });

  assert.deepEqual(parsed.holdings, []);
  assert.equal(parsed.cashBalance, 100000);
  assert.equal(parsed.snapshotDate, '2026-09-02');
});

test('Tonghuashun holding parser derives current price from market value when needed', () => {
  const text = [
    '证券代码\t证券名称\t股票余额\t成本价\t市值',
    '600183\t生益科技\t100\t140.051\t14,321.00'
  ].join('\n');

  const parsed = parseHoldingText(text);

  assert.equal(parsed.holdings[0].currentPrice, 143.21);
  assert.equal(parsed.holdings[0].marketValue, 14321);
});

test('Tonghuashun holding file discovery only chooses named export files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-ths-holding-file-'));
  const ignored = path.join(root, 'orders.csv');
  const older = path.join(root, '持仓.csv');
  const newer = path.join(root, 'WebStockHoldings.json');
  fs.writeFileSync(ignored, 'ignored');
  fs.writeFileSync(older, 'old');
  fs.writeFileSync(newer, 'new');
  fs.utimesSync(older, new Date('2026-08-25T01:00:00Z'), new Date('2026-08-25T01:00:00Z'));
  fs.utimesSync(newer, new Date('2026-08-26T01:00:00Z'), new Date('2026-08-26T01:00:00Z'));

  assert.equal(findNewestHoldingFile([root]), newer);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Tonghuashun holding sync uses an isolated snapshot account', () => {
  portfolio.createTrade({
    code: '000001', name: '默认账户股票', side: 'buy', tradeDate: '2026-08-25', price: 10, quantity: 100
  });
  const text = [
    '证券代码\t证券名称\t股票余额\t成本价\t市价',
    '600183\t生益科技\t100\t140.051\t143.210',
    '002463\t沪电股份\t200\t59.185\t62.980'
  ].join('\n');

  const result = syncHoldingText(text, { snapshotDate: '2026-08-26', cashBalance: 446.86 });

  assert.equal(result.account.accountKey, 'tonghuashun-local-sync');
  assert.equal(result.importedCount, 2);
  assert.deepEqual(portfolio.getPositions({}, { accountId: result.account.id }).map(item => item.code), ['600183', '002463']);
  assert.deepEqual(portfolio.getPositions({}, { accountId: 1 }).map(item => item.code), ['000001']);
});

test('manual Tonghuashun sync can replace the selected snapshot account', () => {
  const account = portfolio.createAccount({ name: '广发证券测试账户', broker: '广发证券' });
  portfolio.importHoldingSnapshot(account.id, {
    snapshotDate: '2026-09-08', cashBalance: 100,
    holdings: [{ code: '600001', name: '旧持仓', quantity: 100, costValue: 900, currentPrice: 10 }]
  });
  const text = [
    '证券代码\t证券名称\t股票余额\t成本价\t市价',
    '600002\t新持仓\t200\t11.5\t12.0'
  ].join('\n');
  const result = syncHoldingText(text, { accountId: account.id, snapshotDate: '2026-09-09', cashBalance: 300 });
  assert.equal(result.account.id, account.id);
  assert.deepEqual(portfolio.getPositions({}, { accountId: account.id }).map(item => item.code), ['600002']);
  assert.equal(portfolio.getAccount(account.id).cashBalance, 300);
});

test('Tonghuashun monitor context auto-syncs only a current-day export file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-ths-monitor-'));
  const filename = path.join(root, '持仓.csv');
  fs.writeFileSync(filename, [
    '证券代码,证券名称,股票余额,成本价,市价',
    '600183,生益科技,100,140.051,143.210'
  ].join('\n'));
  fs.utimesSync(filename, new Date('2026-09-02T02:28:00.000Z'), new Date('2026-09-02T02:28:00.000Z'));

  const context = getMonitorHoldingContext({
    roots: [root],
    now: new Date('2026-09-02T02:30:00.000Z'),
    fallbackToSnapshot: false
  });

  assert.equal(context.available, true);
  assert.equal(context.method, 'export-file');
  assert.equal(context.snapshotDate, '2026-09-02');
  assert.equal(context.holdings[0].code, '600183');
  assert.equal(context.account.accountKey, 'tonghuashun-local-sync');
  assert.equal(getMonitorStatus({ roots: [root], now: new Date('2026-09-02T02:30:00.000Z') }).ready, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Tonghuashun monitor does not create another snapshot when the export file is unchanged', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-ths-monitor-dedupe-'));
  const filename = path.join(root, '持仓.csv');
  fs.writeFileSync(filename, [
    '证券代码,证券名称,股票余额,成本价,市价',
    '600184,光电股份,100,140.051,143.210'
  ].join('\n'));
  fs.utimesSync(filename, new Date('2026-09-02T02:28:00.000Z'), new Date('2026-09-02T02:28:00.000Z'));

  const existingAccount = portfolio.listAccounts().find(function(account) {
    return account.accountKey === 'tonghuashun-local-sync';
  });
  const countBefore = existingAccount
    ? portfolio.listSnapshots({ accountId: existingAccount.id }).length
    : 0;

  const first = getMonitorHoldingContext({
    roots: [root],
    now: new Date('2026-09-02T02:30:00.000Z'),
    fallbackToSnapshot: false
  });
  const second = getMonitorHoldingContext({
    roots: [root],
    now: new Date('2026-09-02T02:31:00.000Z'),
    fallbackToSnapshot: false
  });

  assert.equal(first.unchanged, false);
  assert.equal(second.unchanged, true);
  assert.equal(portfolio.listSnapshots({ accountId: first.account.id }).length, countBefore + 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Tonghuashun monitor context blocks an old export instead of relabeling it as today', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-ths-monitor-stale-'));
  const filename = path.join(root, '持仓.csv');
  fs.writeFileSync(filename, [
    '证券代码,证券名称,股票余额,成本价,市价',
    '600183,生益科技,100,140.051,143.210'
  ].join('\n'));
  fs.utimesSync(filename, new Date('2026-09-01T07:00:00.000Z'), new Date('2026-09-01T07:00:00.000Z'));

  const context = getMonitorHoldingContext({
    roots: [root],
    now: new Date('2026-09-02T02:30:00.000Z'),
    fallbackToSnapshot: false
  });

  assert.equal(context.available, false);
  assert.match(context.error, /不是本交易日/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Tonghuashun monitor blocks a same-day export that is no longer fresh', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-ths-monitor-intraday-stale-'));
  const filename = path.join(root, '持仓.csv');
  fs.writeFileSync(filename, [
    '证券代码,证券名称,股票余额,成本价,市价',
    '600183,生益科技,100,140.051,143.210'
  ].join('\n'));
  fs.utimesSync(filename, new Date('2026-09-02T02:20:00.000Z'), new Date('2026-09-02T02:20:00.000Z'));

  const context = getMonitorHoldingContext({
    roots: [root],
    now: new Date('2026-09-02T02:30:01.000Z'),
    maxAgeMs: 5 * 60 * 1000
  });

  assert.equal(context.available, false);
  assert.match(context.error, /超过 5 分钟未更新/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Tonghuashun monitor recognizes a fresh read-only window snapshot as automatic', () => {
  const now = new Date();
  const snapshotDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
  syncHoldingText(JSON.stringify({
    snapshotDate,
    cashBalance: 2315.17,
    holdings: [{ code: '600183', name: '生益科技', quantity: 200, avgCost: 137.352, currentPrice: 143.19 }]
  }), {
    snapshotDate,
    sourceLabel: '同花顺窗口只读采集',
    dedupeKey: 'window-test'
  });

  const status = getMonitorStatus({ roots: [], now, maxAgeMs: 5 * 60 * 1000 });

  assert.equal(status.available, true);
  assert.equal(status.method, 'windows-ocr-snapshot');
  assert.equal(status.source, 'tonghuashun-window-ocr');
});

test('Tonghuashun monitor reports the recent window-capture blocker instead of only asking for an export', () => {
  const now = new Date('2026-09-05T02:30:00.000Z');
  recordWindowCaptureStatus({
    available: false,
    ready: false,
    method: 'windows-ocr',
    error: '同花顺交易窗口未打开'
  }, { now });

  const status = getMonitorStatus({ roots: [], now });
  const context = getMonitorHoldingContext({ roots: [], now, fallbackToSnapshot: false });

  assert.equal(status.available, false);
  assert.equal(status.method, 'windows-ocr');
  assert.match(status.error, /同花顺交易窗口未打开/);
  assert.equal(context.method, 'windows-ocr');
  assert.match(context.error, /同花顺交易窗口未打开/);
});
