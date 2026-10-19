const test = require('node:test');
const assert = require('node:assert/strict');

function refreshPage(root, pageId) {
  const module = require('../js/modules/pageRefresh');
  assert.equal(typeof module.refreshPage, 'function');
  return module.refreshPage(root, pageId);
}

function pageRoot(pageId) {
  const calls = [];
  const forbidden = action => () => { throw new Error('Refresh must not trigger ' + action); };
  const record = action => async (...args) => { calls.push({ action, args }); return { refreshed: true }; };
  const root = {
    State: {
      currentMainView: pageId,
      currentView: 'realtime',
      currentPeriod: 'minute',
      currentStock: { code: '000001' }
    },
    document: {
      getElementById: id => id === 'terminalPageSelect' ? { value: pageId } : null,
      querySelector: () => null,
      querySelectorAll: () => []
    },
    location: { reload: forbidden('browser reload'), assign: forbidden('browser navigation') },
    fetch: forbidden('unrouted network calls'),
    RealtimeChart: { loadRealtimeData: record('realtime') },
    KlineChart: { loadKlineData: record('kline') },
    DarkRankBoard: { refresh: record('darkRank') },
    News: { load: record('news') },
    ExpertTracker: {
      refresh: record('creatorRead'),
      showCreatorTasks: forbidden('resetting creator filters'),
      bind: forbidden('rebinding creator controls'),
      runCollection: forbidden('video collection'),
      startCollection: forbidden('video collection'),
      generateAnalysis: forbidden('AI generation')
    },
    CapitalFlowReplay: { run: forbidden('replay without an explicitly selected file') },
    AIResearch: { generate: forbidden('AI research generation') },
    PaperTrading: { trade: forbidden('paper trade'), submitOrder: forbidden('order placement') },
    webstockDesktop: { startCollection: forbidden('desktop video collection') }
  };
  return { root, calls };
}

test('market refresh uses the selected stock chart without reloading the browser', async () => {
  const { root, calls } = pageRoot('market');
  const before = JSON.stringify(root.State);
  await refreshPage(root, 'market');

  assert.deepEqual(calls.map(call => call.action), ['realtime']);
  assert.deepEqual(calls[0].args, ['000001']);
  assert.equal(JSON.stringify(root.State), before, 'refresh must preserve selection and chart mode');
});

test('auction refresh reuses the realtime read path instead of starting collection', async () => {
  const { root, calls } = pageRoot('auction');
  await refreshPage(root, 'auction');
  assert.deepEqual(calls.map(call => call.action), ['realtime']);
});

test('market K-line refresh preserves the selected security and period', async () => {
  const { root, calls } = pageRoot('market');
  root.State.currentView = 'kline';
  root.State.currentPeriod = 'week';
  await refreshPage(root, 'market');

  assert.deepEqual(calls, [{ action: 'kline', args: ['000001', 'week'] }]);
  assert.equal(root.State.currentPeriod, 'week');
});

test('dark flow refresh routes to the compact ranking board', async () => {
  const { root, calls } = pageRoot('darkFlow');
  await refreshPage(root, 'darkFlow');
  assert.deepEqual(calls.map(call => call.action), ['darkRank']);
});

test('news refresh requests fresh news through the existing News.load interface', async () => {
  const { root, calls } = pageRoot('news');
  await refreshPage(root, 'news');
  assert.deepEqual(calls, [{ action: 'news', args: [{ cacheBust: true }] }]);
});

for (const pageId of ['creatorTasks', 'authors']) {
  test(pageId + ' refresh only rereads creator state and preserves user filters', async () => {
    const { root, calls } = pageRoot(pageId);
    root.State.creatorAuthorId = 2;
    root.State.creatorDate = '2026-09-18';
    root.State.creatorSearch = '光模块';
    const before = JSON.stringify(root.State);
    await refreshPage(root, pageId);

    assert.deepEqual(calls.map(call => call.action), ['creatorRead']);
    assert.equal(JSON.stringify(root.State), before);
  });
}

test('local replay with no retained file is safely skipped with an actionable explanation', async () => {
  const { root, calls } = pageRoot('replay');
  const result = await refreshPage(root, 'replay');

  assert.equal(result.skipped, true);
  assert.match(result.reason, /重新选择文件/);
  assert.deepEqual(calls, []);
});

test('the page selector determines the visible subpage when no pageId is provided', async () => {
  const { root, calls } = pageRoot('darkFlow');
  root.State.currentMainView = 'funds';
  await refreshPage(root);
  assert.deepEqual(calls.map(call => call.action), ['darkRank']);
});

test('the main view is used when the page selector is unavailable', async () => {
  const { root, calls } = pageRoot('news');
  root.document.getElementById = () => null;
  await refreshPage(root);
  assert.deepEqual(calls.map(call => call.action), ['news']);
});

test('unknown pages cannot trigger arbitrary actions or full reloads', async () => {
  const { root, calls } = pageRoot('unknownPage');
  const result = await refreshPage(root, 'unknownPage');
  assert.equal(result.skipped, true);
  assert.deepEqual(calls, []);
});
