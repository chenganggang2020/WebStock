const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('stock detail manual Level-2 output keeps missing amounts unknown', async () => {
  const result = { textContent: '', className: '' };
  const context = {
    window: { State: { currentStock: { code: '600000' } }, ApiClient: {
      fetchJsonData: async () => ({ trades: [{}], stats: {
        missingAmountCount: 1, largeNetAmount: null, largeAmountRatio: null
      } })
    } },
    document: { getElementById: id => id === 'detailManualLevel2Input' ? { value: 'test trade' }
      : id === 'detailLevel2Result' ? result : null }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/modules/stockDetail.js'), 'utf8'), context);
  await context.analyzeDetailManualLevel2Paste();
  assert.match(result.textContent, /金额缺失/);
  assert.doesNotMatch(result.textContent, /大单净额 0|大单占比 0/);
});

test('detail amounts and holding PnL do not classify missing values as zero gains', () => {
  const result = { textContent: '', className: '' };
  const context = { window: { State: { positions: [] } }, document: { getElementById: () => result } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/modules/stockDetail.js'), 'utf8'), context);
  for (const missing of [null, undefined, '', ' ', false]) {
    assert.equal(context.detailFmtMoney(missing), '--');
    assert.equal(context.detailFmtPercent(missing), '--');
    assert.equal(context.detailAmountClass(missing), '');
    context.window.State.positions = [{ code: '600000', quantity: 100, avgCost: 10, unrealizedPnl: missing }];
    context.renderPositionStatus({ code: '600000' });
    assert.match(result.textContent, /floating P\/L --/);
    assert.doesNotMatch(result.className, /pnl-up|pnl-down/);
  }
  assert.equal(context.detailFmtMoney(0), '0');
  assert.equal(context.detailFmtPercent(0), '0.00%');
});

test('stock detail shows unavailable free-flow honestly and does not report an update', async () => {
  const box = { innerHTML: '' };
  const result = { textContent: '', className: '' };
  const context = { window: { State: { currentStock: { code: '600000' } }, ApiClient: {
    fetchJsonData: async () => ({ code: '600000', status: 'unavailable', mainNetAmount: null,
      superLargeNetAmount: null, largeNetAmount: null, simulatedLargeNetAmount: null, mainNetRatio: null })
  } }, document: { getElementById: id => id === 'detailFreeFlowBox' ? box
    : id === 'detailLevel2Result' ? result : null } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/modules/stockDetail.js'), 'utf8'), context);
  await context.loadFreeFlowForCurrentStock();
  assert.match(result.textContent, /暂无/);
  assert.doesNotMatch(result.textContent, /已更新/);
  assert.match(box.innerHTML, /--/);
  assert.match(box.innerHTML, /不是.*暗盘/);
});

test('missing stock prices cannot trigger a low-price alert', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/modules/stockDetail.js'), 'utf8'), context);
  for (const price of [null, undefined, '', ' ', false, 0]) {
    assert.equal(context.detailAlertStatus({ alertLow: 10, price }, { price }).label, 'Alert pending');
  }
  assert.equal(context.detailAlertStatus({ alertLow: 10 }, { price: 9 }).label, 'Alert low');
});
