const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function captureModule() {
  const filename = path.resolve(__dirname, '../services/tonghuashunWindowHoldingService.js');
  const context = { module: { exports: {} }, __dirname: path.dirname(filename), process, Buffer,
    require: name => name.startsWith('./') ? {} : require(name) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context);
  return context.module.exports;
}

test('capture launch stays below the Windows command limit and uses packaged UTF-8 script', async () => {
  let invocation;
  const result = await captureModule().runWindowsCapture({execFile: async (exe, args) => {
    invocation = {exe, args};
    return {stdout: JSON.stringify({available:false,errorCode:'THS_WINDOW_NOT_FOUND'})};
  }});
  assert.ok([invocation.exe, ...invocation.args].join(' ').length < 32767);
  const script = invocation.args[invocation.args.indexOf('-File') + 1];
  assert.ok(invocation.args.includes('-File'));
  const text = fs.readFileSync(script, 'utf8');
  assert.ok(text.startsWith('\uFEFF'), 'Windows PowerShell 5 reads Chinese script using UTF-8 BOM');
  assert.match(text, /资金|可用金额/);
  assert.equal(result.available, false);
  assert.equal(result.error, '同花顺交易窗口未打开');
});

test('failed native capture cannot return a usable holding snapshot', async () => {
  const result = await captureModule().runWindowsCapture({execFile: async () => { throw new Error('capture failed'); }});
  assert.equal(result.available, false);
  assert.equal(result.ready, false);
});

function portfolioContext(accounts) {
  const values = new Map([['webstock.activePortfolioAccountId','2']]);
  const context = {window:{State:{activePortfolioAccountId:2,portfolioAccounts:[]},apiFetch:async()=>accounts},
    localStorage:{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)},console};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../js/modules/portfolio.js'),'utf8'),context);
  vm.runInContext('renderAccountControls = function() {}',context);
  return context;
}

test('initial portfolio display prioritizes the separate Tonghuashun account over old remembered account', async () => {
  const context = portfolioContext([{id:2,isDefault:true},{id:3,accountKey:'tonghuashun-local-sync'}]);
  await vm.runInContext('loadAccounts()',context);
  assert.equal(context.window.State.activePortfolioAccountId,3);
});

test('subsequent account refresh respects manual switching', async () => {
  const context = portfolioContext([{id:2,isDefault:true},{id:3,accountKey:'tonghuashun-local-sync'}]);
  await vm.runInContext('loadAccounts()',context);
  vm.runInContext('rememberActiveAccount(2)',context);
  await vm.runInContext('loadAccounts()',context);
  assert.equal(context.window.State.activePortfolioAccountId,2);
});

test('existing account remains selected when there is no Tonghuashun sync account', async () => {
  const context = portfolioContext([{id:2,isDefault:true}]);
  await vm.runInContext('loadAccounts()',context);
  assert.equal(context.window.State.activePortfolioAccountId,2);
});
