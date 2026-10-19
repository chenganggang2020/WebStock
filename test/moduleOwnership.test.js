const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const terminal = require('../js/modules/compactTerminal');
const { refreshPage } = require('../js/modules/pageRefresh');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('ETF intraday has a dedicated watch view; legacy capital link opens daily funds', () => {
  assert.equal(terminal.resolve('etf').view, 'etf');
  assert.equal(terminal.resolve('etf').workspace, 'market');
  assert.equal(terminal.resolve('capitalDaily').workspace, 'capital');
  assert.equal(terminal.resolve('capitalDaily').target, 'institutionalFlowTitle');
  assert.equal(terminal.resolve('capitalIntraday').id, 'capitalDaily');
});

test('account ledgers and paper portfolios have separate owners', () => {
  for (const id of ['portfolio', 'trades', 'stats']) assert.equal(terminal.resolve(id).workspace, 'watch', id);
  assert.equal(terminal.resolve('paperPortfolio').workspace, 'paper');
  assert.equal(terminal.resolve('paperPortfolio').view, 'paperPortfolio');
  assert.match(terminal.resolve('aiHistory').label, /AI交接/);
  assert.match(terminal.resolve('health').label, /行情接口/);
  assert.match(terminal.resolve('replay').label, /资金快照/);
});

test('right click refresh follows the selected data scope, not the old container', async () => {
  const calls = [];
  const root = { document: {}, MarketInstitutionalFlow: { load: async (...args) => calls.push(args) },
    AIResearch: { loadPaperPortfolios: async () => calls.push('paper') } };
  await refreshPage(root, 'etf');
  await refreshPage(root, 'capitalDaily');
  await refreshPage(root, 'capitalIntraday');
  await refreshPage(root, 'paperPortfolio');
  assert.deepEqual(calls, [[true, 'intraday'], [true, 'daily'], [true, 'daily'], 'paper']);
});

test('page composition uses actual author management and no duplicated daily dashboard', () => {
  const html = read('index.html');
  assert.match(html, /id="etfView"/);
  assert.match(html, /id="paperPortfolioView"/);
  assert.doesNotMatch(html, /id="dashboardInstitutionalFlow"/);
  assert.doesNotMatch(html, /id="savedHandoffResults"/);
  const composition = read('js/modules/fixedWorkspace.js');
  assert.match(composition, /page\.id === 'authors' \? 'management' : 'videos'/);
  assert.doesNotMatch(composition, /item\('paper', '前向模拟'/);
  assert.doesNotMatch(composition, /item\('models', '模型状态'/);
});

test('daily page refresh reports partial failures instead of a false success', async () => {
  const root = { document: {}, MarketInstitutionalFlow: { load: async () => ({ ok: true }) },
    EastmoneyEtfDaily: { load: async () => ({ ok: false }) } };
  assert.equal((await refreshPage(root, 'capitalDaily')).ok, false);
  root.EastmoneyEtfDaily.load = async () => ({ ok: true });
  assert.equal((await refreshPage(root, 'capitalDaily')).ok, true);
});
