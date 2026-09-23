const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const home = require('../js/modules/homeTerminal');

test('returning from a deep-linked settings page reveals chart controls for a primed stock', () => {
  const classes = new Set();
  const control = {classList:{add:name=>classes.add(name)}};
  const window = {State:{currentStock:{code:'000001'}},
    document:{getElementById:id=>id==='indicatorBtns'?control:null,querySelector:()=>null},
    requestAnimationFrame() {}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/modules/homeTerminal.js'),'utf8'),{window});
  window.HomeTerminal.sync('settings');
  assert.equal(classes.has('visible'),false);
  window.HomeTerminal.sync('dashboard');
  assert.equal(classes.has('visible'),true);
  classes.clear();
  window.HomeTerminal.sync('market');
  assert.equal(classes.has('visible'),true);
});

test('home ranking separates industry/concept and never turns missing flow into zero', () => {
  const boards = [
    { code: '1', kind: 'industry', dailyChangePct: 1, mainNetInflow: null },
    { code: '2', kind: 'industry', dailyChangePct: -1, mainNetInflow: -10 },
    { code: '3', kind: 'concept', dailyChangePct: 9, mainNetInflow: 100 }
  ];
  assert.deepEqual(home.rankBoards(boards, 'industry').map(x => x.code), ['2', '1']);
  assert.deepEqual(home.rankBoards(boards, 'concept').map(x => x.code), ['3']);
  assert.equal(home.formatNumber(null), '—');
  assert.equal(home.formatNumber(''), '—');
  assert.equal(home.formatNumber(0), '0.00');
});

test('home and detail can share refresh eligibility but background workspaces cannot', () => {
  assert.equal(home.isChartView('dashboard'), true);
  assert.equal(home.isChartView('market'), true);
  assert.equal(home.isChartView('creatorTasks'), false);
});

test('index cards match provider-prefixed intraday keys without matching a stock code', () => {
  const history = { key: 'index:sse', status: 'available' };
  assert.equal(home.indexHistory([history], 'sse'), history);
  assert.equal(home.indexHistory([history], '000001'), undefined);
});

test('production page has all five home regions and one shared stock chart', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  for (const id of ['homeWatchPane', 'homeIndicators', 'homeChartHost', 'homeBookHost', 'homeRankings', 'stockWorkspace']) {
    assert.equal(html.split('id="' + id + '"').length - 1, 1, id);
  }
  assert.equal(html.split('id="timeChartContainer"').length - 1, 1);
  assert.equal(html.split('id="chartContainer"').length - 1, 1);
  assert.ok(html.indexOf('js/modules/homeTerminal.js') < html.indexOf('js/app.js'));
});
