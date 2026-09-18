const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('gateway diagnostics do not display incomplete money statistics as zero or OK', async () => {
  const result = { textContent: '', classList: { toggle() {} } };
  const context = { window: { State: {}, ApiClient: { fetchJsonData: async () => ({ code: '000001', stats: {
    status: 'partial', missingAmountCount: 1, largeNetAmount: null, largeAmountRatio: null
  } }) } }, document: { getElementById: id => id === 'settingsLevel2TestResult' ? result : null } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/modules/settings.js'), 'utf8'), context);
  await context.window.Settings.testLevel2CurrentStock();
  assert.match(result.textContent, /金额缺失/);
  assert.doesNotMatch(result.textContent, /Level-2 OK|net amount 0|ratio 0\.00/);
});

test('free-flow settings keep absent money and ratios unknown while preserving actual zero', async () => {
  const result = { textContent: '', classList: { toggle() {} } };
  const context = { window: { State: {}, ApiClient: { fetchJsonData: async () => ({
    code: '000001', status: 'partial', mainNetAmount: 0, superLargeNetAmount: null,
    largeNetAmount: -25, simulatedLargeNetAmount: null, mainNetRatio: null
  }) } }, document: { getElementById: id => id === 'settingsLevel2TestResult' ? result : null } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/modules/settings.js'), 'utf8'), context);
  await context.window.Settings.testFreeFlowCurrentStock();
  assert.match(result.textContent, /主力净额 0/);
  assert.match(result.textContent, /超大单 --/);
  assert.match(result.textContent, /大单 -25/);
  assert.match(result.textContent, /主力占比 --/);
  assert.match(result.textContent, /部分数据/);
  assert.match(result.textContent, /不是.*暗盘/);
});

test('legacy backup warnings are visible before confirmation and cancel never imports', async () => {
  const requests = [];
  let confirmation = '';
  let finished;
  const readComplete = new Promise(resolve => { finished = resolve; });
  const context = {
    window: { State: {}, ApiClient: { fetchJsonData: async url => {
      requests.push(url);
      return { incoming: { watchlist: 1 }, current: { trades: 2 }, legacyScope: true,
        warnings: ['旧版备份未提供的表将按空表处理。请先保存当前完整备份。'] };
    } } },
    document: { getElementById: () => null },
    confirm(message) { confirmation = message; return false; },
    FileReader: class {
      readAsText() { this.result = JSON.stringify({ version: 1, tables: { watchlist: [] } }); this.onload().then(finished); }
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/modules/settings.js'), 'utf8'), context);
  context.window.Settings.importUserDataFromFile({ name: 'legacy.json' });
  await readComplete;
  assert.match(confirmation, /旧版备份未提供的表将按空表处理/);
  assert.match(confirmation, /请先保存当前完整备份/);
  assert.deepEqual(requests, ['/api/user/import-preview']);
});
