const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/modules/expertTracker.js'), 'utf8');

// Exercise real action, activation and loading code with an isolated desktop/API boundary.
function setup(action) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value: '', textContent: '', innerHTML: '', disabled: false,
      style: { setProperty() {} }, classList: { toggle() {}, remove() {} }
    });
    return nodes.get(id);
  };
  const channels = [
    { id: 1, platform: 'douyin', displayName: '作者一', observationCount: 1 },
    { id: 2, platform: 'douyin', displayName: '作者二', observationCount: 1 }
  ];
  const started = [];
  let complete;
  const pendingAction = new Promise(resolve => { complete = resolve; });
  const window = {
    webstockDesktop: {
      [action.bridge](channelId) {
        started.push(channelId);
        return pendingAction;
      }
    },
    async apiFetch(url) {
      if (url === '/api/expert/channels') return channels;
      const match = url.match(/^\/api\/expert\/channels\/(\d+)\/(.*)$/);
      assert.ok(match, 'unexpected fixture request: ' + url);
      const channelId = Number(match[1]);
      if (match[2].startsWith('observations?')) {
        return [{ id: channelId * 10, channelId, title: channels[channelId - 1].displayName + '的资料' }];
      }
      if (match[2].startsWith('backtests?') || match[2].startsWith('sync/runs?')) return [];
      if (match[2] === 'sync') return { channelId, status: 'idle', lastCompletedAt: '作者' + channelId + '完成时间' };
      assert.fail('unexpected fixture request: ' + url);
    }
  };
  node('expertChannelSelect').value = '1';
  node('creatorTaskChannelSelect').value = '1';
  node('creatorTaskDate').value = '2026-09-18';
  node('creatorTaskDateMode').value = 'all';
  const context = vm.createContext({
    window, document: { getElementById: node }, channels, console, Date, Intl, URL,
    setInterval: () => 1, clearInterval() {}
  });
  vm.runInContext(source, context, { filename: 'expertTracker.js' });
  const run = code => vm.runInContext(code, context);
  run(`expertChannels = channels;
    expertRenderTimeline = function() {
      document.getElementById('expertCreatorVideoList').textContent = expertObservations.map(item => item.title).join(',');
    };
    expertRenderBacktests = function() {};
    expertSyncChannelControls = function() {};
    expertRenderDouyinSyncState = function() {};
    expertRenderCreatorWorkbench = function() {};
    expertRenderCreatorRunAudit = function() {};`);
  const snapshot = () => ({
    selectedAuthor: node('expertChannelSelect').value,
    taskAuthor: node('creatorTaskChannelSelect').value,
    observationAuthor: run('expertObservations[0] && expertObservations[0].channelId'),
    visibleMaterials: node('expertCreatorVideoList').textContent,
    syncAuthor: run('expertDouyinSyncState && expertDouyinSyncState.channelId'),
    trackerStatus: node('expertTrackerStatus').textContent,
    sessionStatus: node('douyinDesktopSessionStatus').textContent
  });
  return { node, run, started, complete, snapshot };
}

const actions = [
  { name: 'incremental collection', call: 'expertRunDouyinAutoSync()', bridge: 'syncDouyinChannel', button: 'runDouyinSyncNowBtn', done: /主动采集完成/ },
  { name: 'full archive scan', call: 'expertRunDouyinArchiveScan()', bridge: 'archiveDouyinChannel', button: 'runDouyinArchiveScanBtn', done: /公开可见清单扫描结束/ }
];

function result() {
  return { discoveredCount: 1, detailedCount: 1, transcribedCount: 1, addedCount: 1, updatedCount: 0, archive: { complete: true } };
}

for (const action of actions) {
  test(action.name + ' completion cannot restore an author that the user has left', async () => {
    const r = setup(action);
    const running = r.run(action.call);
    assert.deepEqual(r.started, [1]);
    assert.equal(r.node(action.button).disabled, true);

    await r.run('expertActivateChannel(2)');
    r.run("expertSetDouyinSessionStatus('作者二当前状态')");
    const current = r.snapshot();
    assert.equal(current.selectedAuthor, '2');
    assert.equal(current.observationAuthor, 2);

    r.complete(result());
    await running;

    assert.deepEqual(r.snapshot(), current, 'late author-one completion must preserve author two, its materials and its status');
    assert.equal(r.node(action.button).disabled, false);
  });

  test(action.name + ' still refreshes materials and completion status when the author has not changed', async () => {
    const r = setup(action);
    const running = r.run(action.call);
    r.complete(result());
    await running;

    assert.equal(r.snapshot().selectedAuthor, '1');
    assert.equal(r.snapshot().observationAuthor, 1);
    assert.equal(r.snapshot().syncAuthor, 1);
    assert.match(r.snapshot().sessionStatus, action.done);
    assert.equal(r.node(action.button).disabled, false);
  });
}
