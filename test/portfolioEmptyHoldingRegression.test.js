const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-empty-holding-'));
process.env.WEBSTOCK_DB_PATH = path.join(testDirectory, 'test.db');
const portfolio = require('../services/portfolioService');
const holdings = require('../services/tonghuashunHoldingService');
const { normalizeCapturePayload, createTonghuashunWindowHoldingService, runWindowsCapture } = require('../services/tonghuashunWindowHoldingService');
const database = require('../db');
const catalog = new Map([['000001', '测试持仓']]);
const now = new Date('2026-09-08T02:30:20.000Z');

test.after(function() {
  database.close();
  fs.rmSync(testDirectory, { recursive: true, force: true });
});

function cashSnapshot(overrides = {}) {
  return Object.assign({
    snapshotDate: '2026-09-08', holdingsComplete: true,
    holdings: [], cashBalance: 1234.56, totalMarketValue: 0, totalAssets: 1234.56
  }, overrides);
}

function priorHolding() {
  return {
    snapshotDate: '2026-09-07', cashBalance: 234.56,
    holdings: [{ code: '000001', name: '测试持仓', quantity: 100, costValue: 1000, currentPrice: 10 }]
  };
}

function seededAccount() {
  const account = portfolio.createAccount({ name: '空仓隔离测试' });
  portfolio.importHoldingSnapshot(account.id, priorHolding());
  return account;
}

function emptyCapture(overrides = {}) {
  return Object.assign({
    available: true, observedAt: '2026-09-08T02:30:00.000Z',
    visibleRowsComplete: true, emptyHoldingsConfirmed: true, rows: [],
    cashBalance: '1234.56', displayedMarketValue: '0.00', displayedTotalAssets: '1234.56'
  }, overrides);
}

test('a complete and reconciled all-cash snapshot clears only the snapshot baseline and retains its history', () => {
  const account = seededAccount();
  const result = portfolio.syncHoldingSnapshot(account.id, cashSnapshot());
  assert.equal(result.importedCount, 0);
  assert.deepEqual(portfolio.getPositions({}, { accountId: account.id }), []);
  assert.equal(result.account.cashBalance, 1234.56);
  assert.equal(result.snapshot.totalMarketValue, 0);
  assert.equal(result.snapshot.totalAssets, 1234.56);
  assert.deepEqual(result.snapshot.holdings, []);
  assert.equal(portfolio.listSnapshots({ accountId: account.id }).length, 2);
});

for (const [name, overrides] of [
  ['missing complete-list evidence', { holdingsComplete: undefined }],
  ['missing holdings array', { holdings: undefined }],
  ['missing cash', { cashBalance: undefined }],
  ['missing account market value', { totalMarketValue: undefined }],
  ['missing account assets', { totalAssets: undefined }],
  ['positive account market value', { totalMarketValue: 10, totalAssets: 1244.56 }],
  ['mismatched account assets', { totalAssets: 1300 }],
  ['negative cash', { cashBalance: -1, totalAssets: -1 }],
  ['non-finite assets', { totalAssets: 'not-a-number' }]
]) {
  test('an all-cash snapshot with ' + name + ' cannot erase existing holdings', () => {
    const account = seededAccount();
    assert.throws(() => portfolio.syncHoldingSnapshot(account.id, cashSnapshot(overrides)));
    assert.equal(portfolio.getPositions({}, { accountId: account.id }).length, 1);
    assert.equal(portfolio.getAccount(account.id).cashBalance, 234.56);
    assert.equal(portfolio.listSnapshots({ accountId: account.id }).length, 1);
  });
}

test('even a complete all-cash snapshot cannot replace an account containing manual trades', () => {
  const account = portfolio.createAccount({ name: '手工账本保护测试' });
  portfolio.createTrade({ accountId: account.id, code: '000001', name: '测试持仓', side: 'buy', tradeDate: '2026-09-07', price: 10, quantity: 100 });
  assert.throws(() => portfolio.syncHoldingSnapshot(account.id, cashSnapshot()), /手工交易/);
  assert.equal(portfolio.getPositions({}, { accountId: account.id }).length, 1);
});

test('Tonghuashun full JSON evidence survives parsing and sync into a genuine all-cash account', () => {
  const seeded = holdings.syncHoldingText(JSON.stringify(priorHolding()), { catalog });
  assert.equal(portfolio.getPositions({}, { accountId: seeded.account.id }).length, 1);
  const parsed = holdings.parseHoldingText(JSON.stringify(cashSnapshot()), { catalog });
  assert.equal(parsed.holdingsComplete, true);
  const result = holdings.syncHoldingText(JSON.stringify(cashSnapshot()), { catalog });
  assert.equal(result.importedCount, 0);
  assert.deepEqual(portfolio.getPositions({}, { accountId: result.account.id }), []);
  assert.equal(result.snapshot.totalAssets, 1234.56);
});

test('a JSON list that contained unrecognized rows must not be relabeled as complete empty holdings', () => {
  assert.throws(() => holdings.parseHoldingText(JSON.stringify(cashSnapshot({ holdings: [{ code: 'OCR-failed' }] })), { catalog }), /有效持仓|识别/);
});

test('a partly valid JSON holding list cannot silently drop invalid or duplicate entries', () => {
  for (const invalid of [{ code: 'OCR-failed' }, null, priorHolding().holdings[0]]) {
    assert.throws(() => holdings.parseHoldingText(JSON.stringify({ holdings: [priorHolding().holdings[0], invalid] }), { catalog }), /识别|无效|重复/);
  }
});

for (const [name, overrides] of [
  ['missing account totals', {}],
  ['missing independent assets', { totalMarketValue: 1000 }],
  ['invalid account totals', { totalMarketValue: 'OCR-failed', totalAssets: 'OCR-failed' }],
  ['zero-valued nonempty account', { totalMarketValue: 0, totalAssets: 234.56 }]
]) {
  test('a nonempty snapshot with missing prices and ' + name + ' preserves the previous baseline', () => {
    const account = seededAccount();
    const snapshot = Object.assign(priorHolding(), overrides, {
      snapshotDate: '2026-09-08',
      holdings: [{ code: '000001', name: '测试持仓', quantity: 100, costValue: 1000, currentPrice: null }]
    });
    assert.throws(() => portfolio.syncHoldingSnapshot(account.id, snapshot), /报价|估值|资产|市值/);
    assert.equal(portfolio.getAccount(account.id).cashBalance, 234.56);
    assert.equal(portfolio.listSnapshots({ accountId: account.id }).length, 1);
    assert.equal(portfolio.getLatestSnapshot(account.id).holdings[0].currentPrice, 10);
  });
}

test('independently reconciled totals may preserve a dated partial-price snapshot without fabricating per-stock prices', () => {
  const account = seededAccount();
  const result = portfolio.syncHoldingSnapshot(account.id, {
    snapshotDate: '2026-09-08', cashBalance: 234.56, totalMarketValue: 2100, totalAssets: 2334.56,
    holdings: [
      { code: '000001', name: '测试持仓', quantity: 100, costValue: 1000, currentPrice: 11 },
      { code: '600001', name: '测试缺报价', quantity: 100, costValue: 1000, currentPrice: null }
    ]
  });
  assert.equal(result.snapshot.totalMarketValue, 2100);
  assert.equal(result.snapshot.totalAssets, 2334.56);
  assert.equal(result.snapshot.holdings[1].currentPrice, null);
  assert.equal(result.snapshot.holdings[1].marketValue, null);
  assert.equal(portfolio.getSummary(undefined, { accountId: account.id }).totalMarketValue, null);
});

test('a bare empty JSON list with no reconciliation proof is not a ready holding export', () => {
  assert.throws(() => holdings.parseHoldingText(JSON.stringify({ holdings: [], cashBalance: 1234.56 }), { catalog }), /完整|空仓|总资产/);
});

test('a header-only holding table does not prove an all-cash account', () => {
  assert.throws(() => holdings.parseHoldingText('证券代码\t股票余额\t成本价', { catalog }), /有效持仓|完整|空仓/);
});

test('an explicitly confirmed complete OCR empty grid requires zero market value and matching assets', () => {
  const result = normalizeCapturePayload(emptyCapture(), { catalog, now });
  assert.deepEqual(result.holdings, []);
  assert.equal(result.holdingsComplete, true);
  assert.equal(result.totalMarketValue, 0);
  assert.equal(result.totalAssets, 1234.56);
});

for (const [name, value] of [['missing', undefined], ['blank', ''], ['whitespace', '   '], ['unreadable', 'OCR failed']]) {
  test('all three ' + name + ' OCR asset fields are never evidence of a zero-asset empty account', () => {
    assert.throws(() => normalizeCapturePayload(emptyCapture({ cashBalance: value, displayedMarketValue: value, displayedTotalAssets: value }), { catalog, now }), /空仓|对账|资产/);
  });
}

test('explicit three zero OCR asset values remain valid for a confirmed complete empty account', () => {
  const result = normalizeCapturePayload(emptyCapture({ cashBalance: '0.00', displayedMarketValue: '0.00', displayedTotalAssets: '0.00' }), { catalog, now });
  assert.equal(result.cashBalance, 0);
  assert.equal(result.totalAssets, 0);
  assert.deepEqual(result.holdings, []);
});

for (const [name, overrides] of [
  ['no explicit empty-grid evidence', { emptyHoldingsConfirmed: undefined }],
  ['no complete-grid evidence', { visibleRowsComplete: undefined }],
  ['off-screen rows', { visibleRowsComplete: false }],
  ['no row collection', { rows: undefined }],
  ['no independent asset total', { displayedTotalAssets: undefined }],
  ['unreconciled assets', { displayedTotalAssets: '999.00' }],
  ['nonzero stock total', { displayedMarketValue: '100.00', displayedTotalAssets: '1334.56' }]
]) {
  test('an empty OCR result with ' + name + ' is rejected without syncing', async () => {
    let syncCount = 0;
    const service = createTonghuashunWindowHoldingService({
      runCapture: async () => emptyCapture(overrides), catalog: () => catalog,
      holdings: { syncHoldingText() { syncCount += 1; throw new Error('unsafe sync attempted'); } }
    });
    const result = await service.captureAndSync({ now });
    assert.equal(result.available, false);
    assert.equal(syncCount, 0);
  });
}

test('validated OCR empty-grid evidence reaches the real isolated snapshot sync', async () => {
  const seeded = holdings.syncHoldingText(JSON.stringify(priorHolding()), { catalog });
  const service = createTonghuashunWindowHoldingService({
    runCapture: async () => emptyCapture(), catalog: () => catalog,
    holdings: { syncHoldingText(text, options) { return holdings.syncHoldingText(text, Object.assign({}, options, { catalog })); } }
  });
  const result = await service.captureAndSync({ now });
  assert.equal(result.available, true);
  assert.equal(result.holdingCount, 0);
  assert.deepEqual(portfolio.getPositions({}, { accountId: seeded.account.id }), []);
  assert.equal(result.snapshot.totalAssets, 1234.56);
});

test('Windows capture obtains empty-grid evidence from a native row count and independent total assets', async () => {
  if (process.platform !== 'win32') return;
  let script = '';
  await runWindowsCapture({ execFile: async function(file, args) {
    script = fs.readFileSync(args[args.indexOf('-File') + 1], 'utf8');
    return { stdout: JSON.stringify(emptyCapture()) };
  } });
  assert.match(script, /GridPattern.*Pattern/);
  assert.match(script, /Current\.RowCount -eq 0/);
  assert.match(script, /displayedTotalAssets=\(Read-UiaTotalAssets \$window\)/);
  assert.match(script, /emptyHoldingsConfirmed=\$emptyGridConfirmed/);
});
