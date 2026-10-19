const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function harness() {
  const elements = new Map();
  ['watchlistGroupTabs', 'watchlistGroupSearch', 'watchlistSelectionMeta', 'watchlistTbody', 'watchlistEmpty', 'watchlistTable', 'watchlistGroupFilter'].forEach(id => {
    elements.set(id, { innerHTML: '', value: '', textContent: '', style: {}, dataset: {}, querySelectorAll: () => [] });
  });
  const window = { State: { watchlist: [
    { code: '600001', name: '甲', groupName: '我的观察', id: 1 },
    { code: '600002', name: '乙', groupName: '其他', id: 2 }
  ], tonghuashunCatalog: { groups: [{ id: 'a', name: '我的观察', items: [{ code: '600003', name: '丙' }] }] } } };
  const context = vm.createContext({ window, document: { getElementById: id => elements.get(id), body: { classList: { contains: () => false } } }, console });
  vm.runInContext(fs.readFileSync(path.join(root, 'js/modules/watchlist.js'), 'utf8'), context);
  return { window, elements, context };
}

test('group navigation separates editable and read-only sources with counts and full names', () => {
  const { window, elements } = harness();
  window.Watchlist.renderWatchlist();
  const html = elements.get('watchlistGroupTabs').innerHTML;
  assert.match(html, /本地自选/);
  assert.match(html, /同花顺分组/);
  assert.match(html, /watchlist-group-count/);
  assert.match(html, /local:我的观察/);
  assert.match(html, /ths:a/);
});

test('group search filters navigation without changing the selected stock list', () => {
  const { window, elements, context } = harness();
  vm.runInContext("selectedWatchlistGroupKey = 'local:我的观察'", context);
  elements.get('watchlistGroupSearch').value = '其他';
  window.Watchlist.renderWatchlist();
  const html = elements.get('watchlistGroupTabs').innerHTML;
  assert.match(html, /data-group="local:其他"/);
  assert.doesNotMatch(html, /data-group="local:我的观察"/);
  assert.match(elements.get('watchlistTbody').innerHTML, /600001/);
  assert.match(elements.get('watchlistSelectionMeta').textContent, /我的观察/);
});

test('new group layout and accessible add dialog are included by the shipped entry page', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /id="watchlistGroupSearch"/);
  assert.match(html, /id="watchlistActionStatus"[^>]*role="status"/);
  assert.match(html, /<dialog[^>]*id="watchlistAddDialog"/);
  assert.match(html, /从同花顺读取/);
  assert.match(html, /market-observation\.css/);
});
