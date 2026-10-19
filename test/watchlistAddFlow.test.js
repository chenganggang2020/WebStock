const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const automaticLevels = {
  autoD1Low: 9, autoD1High: 10, autoD2: 8, autoR1: 12, autoConfirm: 13
};

function savedStock(overrides) {
  return Object.assign({
    id: 1, code: '600001', name: '原有样本', groupName: '原有分组', price: 11
  }, automaticLevels, overrides);
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function createHarness(options) {
  options = options || {};
  const elements = new Map();
  const requests = [];
  const alerts = [];
  const views = [];
  const failures = { read: null, write: null };
  const serverRows = copy(options.serverRows || []);
  const catalog = { groups: [{
    id: '42', name: '同名目标', items: [savedStock({ code: '600099', name: '只读样本' })]
  }] };
  for (const id of [
    'watchlistTbody', 'watchlistEmpty', 'watchlistTable', 'watchlistGroupFilter',
    'watchlistGroupTabs', 'watchlistSearchInput', 'watchlistSortSelect',
    'watchlistActionStatus', 'watchlistSyncStatus'
  ]) {
    elements.set(id, {
      id, innerHTML: '', textContent: '', value: '', dataset: {}, style: {},
      hidden: false,
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      querySelectorAll() { return []; },
      setAttribute(name, value) { this[name] = String(value); },
      focus() {},
      scrollIntoView() {}
    });
  }
  const window = {
    State: {
      tonghuashunCatalog: copy(catalog),
      watchlist: copy(options.cachedRows === undefined ? serverRows : options.cachedRows)
    },
    switchMainView(view) { views.push(view); },
    selectPortfolioWatchlistTab(view) { views.push(view); },
    ApiClient: { async fetchJsonData(url) {
      assert.match(url, /^\/api\/quote\?codes=/);
      return [];
    } },
    async apiFetch(url, requestOptions) {
      const method = requestOptions && requestOptions.method || 'GET';
      const body = requestOptions && requestOptions.body ? JSON.parse(requestOptions.body) : null;
      requests.push({ url, method, body });
      if (url === '/api/portfolio/watchlist' && method === 'GET') {
        if (failures.read) throw failures.read;
        return copy(serverRows);
      }
      if (url === '/api/portfolio/tonghuashun-watchlist/catalog' && method === 'GET') {
        return copy(catalog);
      }
      if (url === '/api/portfolio/watchlist' && method === 'POST') {
        if (failures.write) throw failures.write;
        if (serverRows.some(row => row.code === body.code)) throw new Error('该股票已存在');
        const row = savedStock(Object.assign({ id: serverRows.length + 1 }, body));
        serverRows.push(row);
        return copy(row);
      }
      throw new Error('Unexpected API boundary: ' + method + ' ' + url);
    }
  };
  const context = {
    window,
    document: {
      body: { classList: { contains() { return false; } } },
      getElementById(id) { return elements.get(id) || null; },
      querySelectorAll() { return []; }
    },
    alert(message) { alerts.push(String(message)); },
    console, Intl, Date, Map, Set, Number, String, Array, Object, Promise,
    setTimeout, clearTimeout
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../js/modules/watchlist.js'), 'utf8'),
    context,
    { filename: 'watchlist.js' }
  );
  return {
    window, elements, requests, alerts, views, failures, serverRows,
    writes() { return requests.filter(request => request.method !== 'GET'); },
    status() { return elements.get('watchlistActionStatus').textContent; }
  };
}

function addDialog(h) {
  for (const id of [
    'watchlistAddDialog', 'watchlistAddGroup', 'watchlistAddError', 'watchlistAddSubmit',
    'watchlistAddCancel', 'watchlistAddStockLabel', 'watchlistAddGroups', 'watchlistAddForm'
  ]) {
    h.elements.set(id, {
      id, value: '', textContent: '', innerHTML: '', disabled: false,
      focus() {}, select() {}
    });
  }
  const dialog = h.elements.get('watchlistAddDialog');
  dialog.showModal = function() { this.open = true; };
  dialog.close = function() {
    this.open = false;
    if (this.onclose) this.onclose();
  };
  return dialog;
}

test('adding to a target group reveals the local group and clears filters hiding the new stock', async () => {
  const h = createHarness({ serverRows: [savedStock()] });
  h.window.Watchlist.setSelectedGroup('ths:42');
  h.elements.get('watchlistSearchInput').value = '不会匹配新增股票';

  await h.window.Watchlist.addStock({ code: '600002', name: '新增样本' }, {
    groupName: '同名目标', reveal: true
  });

  assert.deepEqual(h.writes().map(request => ({ url: request.url, method: request.method, body: request.body })), [{
    url: '/api/portfolio/watchlist', method: 'POST',
    body: { code: '600002', name: '新增样本', groupName: '同名目标' }
  }]);
  assert.equal(h.window.Watchlist.getSelectedGroup(), 'local:同名目标');
  assert.equal(h.elements.get('watchlistGroupFilter').value, 'local:同名目标');
  assert.equal(h.elements.get('watchlistSearchInput').value, '');
  assert.match(h.elements.get('watchlistGroupTabs').innerHTML, /data-group="local:同名目标"/);
  assert.match(h.elements.get('watchlistTbody').innerHTML, /600002/);
  assert.doesNotMatch(h.elements.get('watchlistTbody').innerHTML, /600099/);
  assert.equal(h.elements.get('watchlistTable').style.display, 'table');
  assert.match(h.status(), /已(?:添加|加入)|添加成功|加入成功/);
  assert.ok(h.status().includes('同名目标'));
  assert.ok(h.views.includes('watchlist'), 'reveal should open the watchlist view');
});

test('a duplicate stays in its existing group and is revealed without any write', async () => {
  const original = savedStock();
  const h = createHarness({ serverRows: [original] });
  h.window.Watchlist.setSelectedGroup('ths:42');
  h.elements.get('watchlistSearchInput').value = '隐藏已有股票';

  await h.window.Watchlist.addStock({ code: original.code, name: original.name }, {
    groupName: '不应移动到这里', reveal: true
  });

  assert.deepEqual(h.writes(), []);
  assert.deepEqual(h.serverRows, [original]);
  assert.equal(h.window.Watchlist.getSelectedGroup(), 'local:原有分组');
  assert.equal(h.elements.get('watchlistSearchInput').value, '');
  assert.match(h.status(), /已存在|已在/);
  assert.ok(h.status().includes('原有分组'));
  assert.match(h.elements.get('watchlistTbody').innerHTML, /600001/);
});

test('duplicate detection reads the latest saved list when State has no matching stock', async () => {
  const h = createHarness({ serverRows: [savedStock()], cachedRows: [] });

  await h.window.Watchlist.addStock({ code: '600001', name: '原有样本' }, {
    groupName: '新的目标', reveal: true
  });

  assert.ok(h.requests.some(request => request.url === '/api/portfolio/watchlist' && request.method === 'GET'));
  assert.deepEqual(h.writes(), []);
  assert.equal(h.serverRows[0].groupName, '原有分组');
  assert.equal(h.window.Watchlist.getSelectedGroup(), 'local:原有分组');
  assert.match(h.status(), /已存在|已在/);
  assert.ok(h.status().includes('原有分组'));
  assert.match(h.elements.get('watchlistTbody').innerHTML, /600001/);
});

test('a stock removed from the server can be added again despite an outdated State entry', async () => {
  const h = createHarness({ serverRows: [], cachedRows: [savedStock()] });

  await h.window.Watchlist.addStock({ code: '600001', name: '重新添加样本' }, {
    groupName: '重新建组', reveal: true
  });

  assert.equal(h.writes().length, 1);
  assert.equal(h.serverRows[0].groupName, '重新建组');
  assert.equal(h.window.Watchlist.getSelectedGroup(), 'local:重新建组');
  assert.match(h.status(), /已(?:添加|加入)|添加成功|加入成功/);
});

test('checking the saved list must succeed before an add can write or report success', async () => {
  const h = createHarness();
  h.failures.read = new Error('自选列表暂时无法读取');

  await h.window.Watchlist.addStock({ code: '600002', name: '新增样本' }, {
    groupName: '目标分组', reveal: true
  });

  assert.deepEqual(h.writes(), []);
  assert.deepEqual(h.serverRows, []);
  assert.ok(h.status().includes('自选列表暂时无法读取'));
  assert.doesNotMatch(h.status(), /已(?:添加|加入)|添加成功|加入成功/);
});

test('write errors containing 已 are surfaced and the same add can be retried', async () => {
  const h = createHarness();
  h.failures.write = new Error('服务已断开，请重试');

  await h.window.Watchlist.addStock({ code: '600002', name: '新增样本' }, {
    groupName: '重试分组', reveal: true
  });

  assert.deepEqual(h.serverRows, []);
  assert.ok(h.status().includes('服务已断开，请重试'));
  assert.doesNotMatch(h.status(), /已(?:添加|加入)|添加成功|加入成功/);

  h.failures.write = null;
  await h.window.Watchlist.addStock({ code: '600002', name: '新增样本' }, {
    groupName: '重试分组', reveal: true
  });

  assert.equal(h.serverRows.length, 1);
  assert.equal(h.serverRows[0].groupName, '重试分组');
  assert.equal(h.window.Watchlist.getSelectedGroup(), 'local:重试分组');
  assert.match(h.status(), /已(?:添加|加入)|添加成功|加入成功/);
  assert.doesNotMatch(h.status(), /服务已断开/);
});

test('finishing a duplicate attempt does not block a subsequent add', async () => {
  const h = createHarness({ serverRows: [savedStock()] });
  await h.window.Watchlist.addStock({ code: '600001', name: '原有样本' }, {
    groupName: '新建分组', reveal: true
  });
  assert.deepEqual(h.writes(), []);

  await h.window.Watchlist.addStock({ code: '600002', name: '下一只样本' }, {
    groupName: '新建分组', reveal: true
  });

  assert.equal(h.writes().length, 1);
  assert.equal(h.serverRows.length, 2);
  assert.equal(h.window.Watchlist.getSelectedGroup(), 'local:新建分组');
  assert.match(h.elements.get('watchlistTbody').innerHTML, /600002/);
});

test('whitespace-only group names are rejected without creating a stock or group', async () => {
  const h = createHarness();

  await h.window.Watchlist.addStock({ code: '600002', name: '新增样本' }, {
    groupName: ' \t\n ', reveal: true
  });

  assert.deepEqual(h.writes(), []);
  assert.deepEqual(h.serverRows, []);
  assert.match(h.status(), /分组.*(?:空|输入)|(?:输入|填写).*分组/);
});

test('a new group is trimmed and becomes visible after its first saved stock', async () => {
  const h = createHarness();

  await h.window.Watchlist.addStock({ code: '600002', name: '新增样本' }, {
    groupName: '  全新分组  ', reveal: true
  });

  assert.equal(h.serverRows[0].groupName, '全新分组');
  assert.equal(h.window.Watchlist.getSelectedGroup(), 'local:全新分组');
  assert.match(h.elements.get('watchlistGroupTabs').innerHTML, /data-group="local:全新分组"/);
  assert.match(h.elements.get('watchlistTbody').innerHTML, /600002/);
  assert.equal(h.elements.get('watchlistEmpty').style.display, 'none');
});

test('stock and group names are displayed as text in feedback and escaped in rows and tabs', async () => {
  const h = createHarness();
  const name = '<img data-add-name="x" src=x>';
  const groupName = '<img data-add-group="x" src=x> & 观察';

  await h.window.Watchlist.addStock({ code: '600002', name }, { groupName, reveal: true });

  assert.equal(h.serverRows[0].groupName, groupName);
  assert.equal(h.window.Watchlist.getSelectedGroup(), 'local:' + groupName);
  assert.ok(h.status().includes(groupName), 'status uses textContent for the original group name');
  assert.equal(h.elements.get('watchlistActionStatus').innerHTML, '');
  const html = h.elements.get('watchlistTbody').innerHTML + h.elements.get('watchlistGroupTabs').innerHTML;
  assert.doesNotMatch(html, /<img data-add-(?:name|group)=/);
  assert.match(html, /&lt;img data-add-name=&quot;x&quot; src=x&gt;/);
  assert.match(html, /&lt;img data-add-group=&quot;x&quot; src=x&gt; &amp; 观察/);
});

test('two concurrent adds of the same stock save only once and can be retried afterward', async () => {
  const h = createHarness();
  const stock = { code: '600002', name: '并发样本' };

  await Promise.all([
    h.window.Watchlist.addStock(stock, { groupName: '并发分组', reveal: true }),
    h.window.Watchlist.addStock(stock, { groupName: '并发分组', reveal: true })
  ]);

  assert.equal(h.writes().length, 1);
  assert.equal(h.serverRows.length, 1);
  await h.window.Watchlist.addStock(stock, { groupName: '另一个分组', reveal: true });
  assert.equal(h.writes().length, 1);
  assert.match(h.status(), /已存在|已在/);
});

test('different stocks added concurrently both remain in the visible local list', async () => {
  const h = createHarness();

  await Promise.all([
    h.window.Watchlist.addStock({ code: '600002', name: '并发样本甲' }, { groupName: '并发分组', reveal: true }),
    h.window.Watchlist.addStock({ code: '600003', name: '并发样本乙' }, { groupName: '并发分组', reveal: true })
  ]);

  assert.equal(h.serverRows.length, 2);
  assert.equal(h.window.State.watchlist.length, 2);
  assert.match(h.elements.get('watchlistTbody').innerHTML, /600002/);
  assert.match(h.elements.get('watchlistTbody').innerHTML, /600003/);
});

test('later watchlist renders do not keep scrolling back to a previously added stock', async () => {
  const h = createHarness();
  const tbody = h.elements.get('watchlistTbody');
  let scrollCount = 0;
  tbody.querySelector = function(selector) {
    if (selector === '.watchlist-located' && this.innerHTML.includes('watchlist-located')) {
      return { scrollIntoView() { scrollCount += 1; } };
    }
    return null;
  };

  await h.window.Watchlist.addStock({ code: '600002', name: '新增样本' }, {
    groupName: '定位分组', reveal: true
  });
  assert.equal(scrollCount, 1, 'the newly added stock should initially be located');

  h.window.Watchlist.renderWatchlist();
  h.window.Watchlist.renderWatchlist();

  assert.equal(scrollCount, 1, 'a refresh after the user scrolls should preserve their position');
});

test('a successful save with a lost response is reconciled against the saved list', async () => {
  const h = createHarness();
  const apiFetch = h.window.apiFetch;
  h.window.apiFetch = async function(url, options) {
    const result = await apiFetch(url, options);
    if (url === '/api/portfolio/watchlist' && options && options.method === 'POST') {
      throw new Error('保存结果响应已断开');
    }
    return result;
  };

  await h.window.Watchlist.addStock({ code: '600002', name: '响应丢失样本' }, {
    groupName: '已保存分组', reveal: true
  });

  assert.equal(h.writes().length, 1);
  assert.equal(h.serverRows.length, 1);
  assert.equal(h.window.Watchlist.getSelectedGroup(), 'local:已保存分组');
  assert.match(h.elements.get('watchlistTbody').innerHTML, /600002/);
  assert.match(h.status(), /已存在|已在|已(?:添加|加入)|添加成功|加入成功/);
  assert.doesNotMatch(h.status(), /未完成|失败/);
});

test('revealing an added local group expands a previously collapsed local directory', async () => {
  const h = createHarness();
  const tabs = h.elements.get('watchlistGroupTabs');
  tabs.querySelectorAll = function() {
    return [{ dataset: { groupSource: 'local' }, open: false }, { dataset: { groupSource: 'ths' }, open: true }];
  };

  await h.window.Watchlist.addStock({ code: '600002', name: '新增样本' }, {
    groupName: '新增分组', reveal: true
  });

  assert.equal(h.window.Watchlist.getSelectedGroup(), 'local:新增分组');
  assert.match(tabs.innerHTML, /<details data-group-source="local" open>/);
  assert.match(tabs.innerHTML, /data-group="local:新增分组"/);
});

test('ordinary add opens the local-group dialog and cancellation performs no write', async () => {
  const h = createHarness({ serverRows: [savedStock()] });
  const dialog = addDialog(h);
  h.window.Watchlist.setSelectedGroup('ths:42');

  const pending = h.window.Watchlist.addStock({ code: '600002', name: '新增样本' });

  assert.equal(dialog.open, true);
  assert.deepEqual(h.writes(), []);
  assert.equal(h.elements.get('watchlistAddGroup').value, '默认分组');
  assert.match(h.elements.get('watchlistAddGroups').innerHTML, /原有分组/);
  assert.doesNotMatch(h.elements.get('watchlistAddGroups').innerHTML, /同名目标/);
  h.elements.get('watchlistAddCancel').onclick();
  assert.equal(await pending, null);
  assert.deepEqual(h.writes(), []);
});

test('a failed dialog save keeps the form open and enabled for a successful retry', async () => {
  const h = createHarness();
  const dialog = addDialog(h);
  const pending = h.window.Watchlist.addStock({ code: '600002', name: '新增样本' });
  h.elements.get('watchlistAddGroup').value = '对话框分组';
  h.failures.write = new Error('自选保存暂不可用');

  await h.elements.get('watchlistAddForm').onsubmit({ preventDefault() {} });

  assert.equal(dialog.open, true);
  assert.equal(h.elements.get('watchlistAddSubmit').disabled, false);
  assert.equal(h.elements.get('watchlistAddCancel').disabled, false);
  assert.match(h.elements.get('watchlistAddError').textContent, /自选保存暂不可用/);
  assert.deepEqual(h.serverRows, []);

  h.failures.write = null;
  await h.elements.get('watchlistAddForm').onsubmit({ preventDefault() {} });

  assert.equal(dialog.open, false);
  assert.equal((await pending).groupName, '对话框分组');
  assert.equal(h.serverRows.length, 1);
});

test('a delayed view refresh from an earlier add cannot hide a later saved stock', async () => {
  const h = createHarness();
  const apiFetch = h.window.apiFetch;
  let releaseCatalog;
  const catalogDelay = new Promise(resolve => { releaseCatalog = resolve; });
  let catalogReads = 0;
  h.window.apiFetch = async function(url, options) {
    if (url === '/api/portfolio/tonghuashun-watchlist/catalog' && catalogReads++ === 0) {
      await catalogDelay;
    }
    return apiFetch(url, options);
  };
  const viewLoads = [];
  h.window.switchMainView = function(view) {
    h.views.push(view);
    viewLoads.push(h.window.Watchlist.loadWatchlist({ skipQuotes: true }));
  };

  await h.window.Watchlist.addStock({ code: '600002', name: '先添加样本' }, { groupName: '刷新分组', reveal: true });
  await h.window.Watchlist.addStock({ code: '600003', name: '后添加样本' }, { groupName: '刷新分组', reveal: true });
  await viewLoads[1];
  releaseCatalog();
  await viewLoads[0];

  assert.equal(h.serverRows.length, 2);
  assert.equal(h.window.State.watchlist.length, 2);
  assert.match(h.elements.get('watchlistTbody').innerHTML, /600002/);
  assert.match(h.elements.get('watchlistTbody').innerHTML, /600003/);
});
