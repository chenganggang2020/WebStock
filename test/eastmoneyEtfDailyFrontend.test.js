const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'js/modules/eastmoneyEtfDaily.js'), 'utf8');
function setup(apiFetch = async () => ({})) {
  const nodes = new Map(), events = {};
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { textContent: '', innerHTML: '', hidden: false, href: '', disabled: false, dataset: {}, addEventListener() {} });
    return nodes.get(selector);
  };
  const box = node('box'); box.querySelector = node;
  const document = { getElementById: () => box, querySelector: selector => selector.includes('button') ? node('button') : node('.eastmoney-etf-daily-status'), addEventListener: (name, fn) => { events[name] = fn; }, readyState: 'loading' };
  const window = { apiFetch, setInterval: () => 1, clearInterval() {}, addEventListener() {} };
  vm.runInNewContext(source, { window, document, URL, Date, setTimeout, clearTimeout });
  return { ui: window.EastmoneyEtfDaily, node, events };
}
const report = { availability: 'available', status: 'current', isCurrent: true, asOf: '2026-09-09', publishedAt: '2026-09-10T08:00:59+08:00', checkedAt: '2026-09-10T00:50:00Z',
  totalNetFlow: 33.83, stockEtfNetFlow: -19.87, subscriptions: [{code:'588000', name:'科创50ETF华夏', value:6.49}], redemptions: [],
  source: '东方财富Choice数据', sourceUrl: 'https://wap.eastmoney.com/a/202609103869906865.html',
  originalImageUrl: 'https://np-newspic.dfcfw.com/download/D287152B1490376D40EB857B126F7BE3B2_w1000h3322.jpg' };
test('empty values stay -- and expected date is not presented as observed date', () => {
  const { ui, node } = setup();
  ui.render({ availability: 'unavailable', totalNetFlow:null, stockEtfNetFlow:'', expectedAsOf:'2026-09-09' });
  assert.doesNotMatch(node('.eastmoney-etf-daily-total').innerHTML, /0亿元/);
  assert.match(node('.eastmoney-etf-daily-total').innerHTML, /--/);
  assert.match(node('.eastmoney-etf-daily-date').textContent, /数据日 --/);
  ui.render(report);
  assert.match(node('.eastmoney-etf-daily-stock').innerHTML, /-19.87/);
});
test('source links are restricted and provider text is escaped', () => {
  const { ui, node } = setup();
  ui.render({ ...report, subscriptions: [{code:'588000',name:'<img onerror=alert(1)>',value:null}], originalImageUrl:'javascript:alert(1)', sourceUrl:'https://evil.test/' });
  assert.equal(node('.eastmoney-etf-daily-image').hidden, true);
  assert.equal(node('.eastmoney-etf-daily-source').hidden, true);
  assert.doesNotMatch(node('.eastmoney-etf-daily-subscriptions').innerHTML, /<img/);
  assert.doesNotMatch(node('.eastmoney-etf-daily-subscriptions').innerHTML, /0亿元/);
});
test('manual success is shown as verified and cached errors remain visible', () => {
  const { ui, node } = setup();
  ui.render({ ...report, status:'no-change' });
  assert.match(node('.eastmoney-etf-daily-status').textContent, /已核验/);
  ui.render({ ...report, status:'stale',lastError:'源站暂不可用' });
  assert.match(node('.eastmoney-etf-daily-status').textContent, /源站暂不可用/);
});
test('initial bind reads the cache and concurrent refresh requests are deduplicated', async () => {
  let calls = 0, resolve;
  const { ui, node, events } = setup(() => { calls++; return new Promise(r => { resolve = r; }); });
  events.DOMContentLoaded();
  const second = ui.load(false);
  assert.equal(calls, 1); assert.equal(node('button').disabled, true);
  resolve(report); await second;
  assert.match(node('.eastmoney-etf-daily-total').innerHTML, /33.83/);
  assert.equal(node('button').disabled, false);
});
test('read failure preserves rendered amounts', async () => {
  const { ui, node } = setup(async () => { throw new Error('断网'); });
  ui.render(report); await ui.load(true);
  assert.match(node('.eastmoney-etf-daily-total').innerHTML, /33.83/);
  assert.match(node('.eastmoney-etf-daily-status').textContent, /保留.*断网/);
});
