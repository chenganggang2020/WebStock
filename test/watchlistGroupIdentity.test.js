const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createHarness() {
  const elements = new Map();
  function add(id, overrides) {
    const element = Object.assign({
      id,
      innerHTML: '',
      textContent: '',
      value: '',
      dataset: {},
      style: {},
      querySelectorAll() { return []; }
    }, overrides || {});
    elements.set(id, element);
    return element;
  }

  add('watchlistTbody');
  add('watchlistEmpty');
  add('watchlistTable');
  add('watchlistGroupFilter');
  add('watchlistGroupTabs');
  add('watchlistSearchInput');
  add('watchlistSortSelect');

  const window = {
    State: {
      tonghuashunCatalog: {
        groups: [{
          id: '42',
          name: '重名分组',
          items: [{ code: '600001', name: '同花顺样本', price: 10, change: 1 }]
        }]
      },
      watchlist: [{
        id: 7,
        code: '600002',
        name: 'WebStock样本',
        groupName: '重名分组',
        price: 20,
        change: -1
      }]
    },
    apiFetch() { throw new Error('unexpected API request'); }
  };
  const context = {
    window,
    document: {
      body: { classList: { contains() { return false; } } },
      getElementById(id) { return elements.get(id) || null; }
    },
    console,
    Intl,
    Date,
    Map,
    Set,
    Number,
    String,
    Array,
    Object,
    Promise,
    setTimeout,
    clearTimeout
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../js/modules/watchlist.js'), 'utf8'),
    context,
    { filename: 'watchlist.js' }
  );
  return { window, elements };
}

test('same-name Tonghuashun and WebStock groups retain separate stable identities', () => {
  const { window, elements } = createHarness();

  window.Watchlist.renderWatchlist();

  const tabs = elements.get('watchlistGroupTabs').innerHTML;
  const filter = elements.get('watchlistGroupFilter').innerHTML;
  assert.match(tabs, /data-group="ths:42"/);
  assert.match(tabs, /data-group="local:重名分组"/);
  assert.match(tabs, /同花顺只读/);
  assert.match(tabs, /本地可编辑/);
  assert.match(filter, /value="ths:42"/);
  assert.match(filter, /value="local:重名分组"/);
});

test('stable group keys reach both same-name sources without crossing read-only boundaries', () => {
  const { window, elements } = createHarness();

  window.Watchlist.setSelectedGroup('ths:42');
  assert.equal(window.Watchlist.getSelectedGroup(), 'ths:42');
  assert.match(elements.get('watchlistTbody').innerHTML, /600001/);
  assert.doesNotMatch(elements.get('watchlistTbody').innerHTML, /600002/);
  assert.match(elements.get('watchlistTbody').innerHTML, /同花顺只读/);

  window.Watchlist.setSelectedGroup('local:重名分组');
  assert.equal(window.Watchlist.getSelectedGroup(), 'local:重名分组');
  assert.match(elements.get('watchlistTbody').innerHTML, /600002/);
  assert.doesNotMatch(elements.get('watchlistTbody').innerHTML, /600001/);
  assert.match(elements.get('watchlistTbody').innerHTML, /data-action="edit"/);
  assert.doesNotMatch(elements.get('watchlistTbody').innerHTML, /同花顺只读/);
});

test('legacy setSelectedGroup(name) remains compatible and resolves deterministically', () => {
  const { window, elements } = createHarness();

  window.Watchlist.setSelectedGroup('重名分组');

  assert.equal(window.Watchlist.getSelectedGroup(), 'ths:42');
  assert.match(elements.get('watchlistTbody').innerHTML, /600001/);
});

test('persisted automatic-level dates are escaped before entering watchlist HTML', () => {
  const { window, elements } = createHarness();
  Object.assign(window.State.watchlist[0], {
    autoD1Low: 18,
    autoD1High: 19,
    autoD2: 17,
    autoR1: 22,
    autoConfirm: 23,
    autoLevelsDate: '<img data-watchlist-date-xss="1" src=x>'
  });

  window.Watchlist.setSelectedGroup('local:重名分组');

  const html = elements.get('watchlistTbody').innerHTML;
  assert.match(html, /日线 &lt;img data-watchlist-date-xss=&quot;1&quot; src=x&gt;/);
  assert.doesNotMatch(html, /<img data-watchlist-date-xss=/);
});
