const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/modules/expertTracker.js'), 'utf8');
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup() {
  const nodes = new Map(), requests = [];
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value: '', checked: false, disabled: false, hidden: false, textContent: '', innerHTML: '', handlers: {},
      style: { setProperty() {} }, classList: { toggle() {}, remove() {}, contains() { return true; } },
      addEventListener(type, handler) { this.handlers[type] = handler; }
    });
    return nodes.get(id);
  };
  const channels = [
    { id: 1, platform: 'douyin', displayName: '视频作者', collectionMediaType: 'video', industryAnalysisEnabled: true },
    { id: 2, platform: 'douyin', displayName: '图文作者', collectionMediaType: 'note', industryAnalysisEnabled: false }
  ];
  let intercept = () => undefined;
  const ctx = vm.createContext({ window: { apiFetch: async (url, options = {}) => {
    requests.push({ url, options });
    const custom = intercept(url, options);
    if (custom !== undefined) return custom;
    if (url === '/api/expert/channels') return channels;
    if (url.endsWith('/sync')) return { channelId: Number(url.split('/')[4]), enabled: false, status: 'idle' };
    if (url.includes('observations?') || url.includes('backtests?') || url.includes('sync/runs?')) return [];
    if (url === '/api/expert/collection-queue') return { jobs: [], workerRunning: true };
    if (options.method === 'PUT') return {};
    throw new Error('Unexpected fixture request: ' + url);
  } }, document: { getElementById: node }, channels, Date, Intl, URL, console, setInterval: () => 1, clearInterval() {} });
  vm.runInContext(source, ctx);
  const run = code => vm.runInContext(code, ctx);
  node('expertChannelSelect').value = node('creatorTaskChannelSelect').value = '1';
  node('creatorTaskDate').value = '2026-09-26';
  node('creatorTaskDateMode').value = 'all';
  node('creatorQueueScope').value = 'current';
  run(`expertChannels = channels;
    expertRenderTimeline = function() {};
    expertRenderBacktests = function() {};
    expertRenderCreatorWorkbench = function() {};
    expertRenderCreatorRunAudit = function() {};
    expertRenderCreatorTaskPipeline = function() {};
    const savedLoader = expertLoadChannels;
    expertLoadChannels = async function() {};
    bindExpertTracker();
    expertLoadChannels = savedLoader;`);
  const change = id => node(id).handlers.change({ target: node(id), currentTarget: node(id) });
  return { node, run, requests, change, intercept: fn => { intercept = fn; } };
}

test('author switch updates configuration immediately, even while works are loading', async () => {
  const r = setup(), waiting = deferred();
  r.node('creatorMediaPreference').value = 'video';
  r.node('creatorIndustryAutomatic').checked = true;
  r.node('creatorMediaView').value = 'video';
  r.node('creatorAccountForm').hidden = false;
  r.node('douyinAutoSyncSummary').textContent = '上一位作者同步记录';
  r.intercept(url => url.includes('/2/observations?') ? waiting.promise : undefined);
  const loading = r.run('expertActivateChannel(2)');
  assert.equal(r.node('creatorMediaPreference').value, 'note');
  assert.equal(r.node('creatorIndustryAutomatic').checked, false);
  assert.equal(r.node('creatorMediaView').value, 'preferred');
  assert.equal(r.node('creatorAccountForm').hidden, true);
  assert.notEqual(r.node('douyinAutoSyncSummary').textContent, '上一位作者同步记录');
  waiting.resolve([]);
  await loading;
});

test('sync and run history load independently of a failed works request', async () => {
  const r = setup(), waiting = deferred();
  r.intercept(url => url.includes('/2/observations?') ? waiting.promise : undefined);
  const loading = r.run('expertActivateChannel(2)');
  const rejection = assert.rejects(loading, /作品请求失败/);
  await new Promise(setImmediate);
  assert.equal(r.run('expertDouyinSyncState?.channelId'), 2);
  waiting.reject(new Error('作品请求失败'));
  await rejection;
  assert.equal(r.run('expertDouyinSyncState?.channelId'), 2);
});

test('queue drafts belong to an author and switching does not carry archive mode to the next author', async () => {
  const r = setup();
  await r.run('expertActivateChannel(1)');
  r.node('creatorCurrentMode').value = 'archive';
  r.node('creatorCurrentModel').value = 'small';
  r.change('creatorCurrentMode'); r.change('creatorCurrentModel');
  await r.run('expertActivateChannel(2)');
  assert.equal(r.node('creatorCurrentMode').value, 'incremental');
  assert.equal(r.node('creatorCurrentModel').value, 'large-v3-turbo');
  await r.run('expertActivateChannel(1)');
  assert.equal(r.node('creatorCurrentMode').value, 'archive');
  assert.equal(r.node('creatorCurrentModel').value, 'small');
});

test('queue shows only the current author unless all authors are explicitly selected', async () => {
  const r = setup();
  r.intercept(url => url === '/api/expert/collection-queue' ? { workerRunning: true, jobs: [
    { id: 10, channelId: 1, displayName: '视频作者', status: 'queued' },
    { id: 20, channelId: 2, displayName: '图文作者', status: 'queued' }
  ] } : undefined);
  await r.run('expertLoadCollectionQueue()');
  assert.match(r.node('creatorQueueList').innerHTML, /视频作者/);
  assert.doesNotMatch(r.node('creatorQueueList').innerHTML, /图文作者/);
  await r.run('expertActivateChannel(2)');
  assert.match(r.node('creatorQueueList').innerHTML, /图文作者/);
  assert.doesNotMatch(r.node('creatorQueueList').innerHTML, /视频作者/);
  r.node('creatorQueueScope').value = 'all'; r.change('creatorQueueScope');
  assert.match(r.node('creatorQueueList').innerHTML, /视频作者/);
});

for (const id of ['creatorMediaPreference', 'creatorIndustryAutomatic', 'douyinAutoSyncToggle']) {
  test('late ' + id + ' response cannot overwrite the next author', async () => {
    const r = setup(), waiting = deferred();
    await r.run('expertActivateChannel(1)');
    r.intercept((url, options) => options.method === 'PUT' ? waiting.promise : undefined);
    r.node(id).value = 'all'; r.node(id).checked = true;
    const saving = r.change(id);
    await r.run('expertActivateChannel(2)');
    const current = { value: r.node(id).value, checked: r.node(id).checked, status: r.node('expertTrackerStatus').textContent };
    waiting.resolve({ channelId: 1, enabled: true });
    await saving;
    assert.equal(r.node(id).value, current.value);
    assert.equal(r.node(id).checked, current.checked);
    assert.equal(r.node('expertTrackerStatus').textContent, current.status);
    assert.equal(r.run('expertDouyinSyncState.channelId'), 2);
  });
  test('late ' + id + ' failure cannot reset settings after A to B to A', async () => {
    const r = setup(), waiting = deferred();
    await r.run('expertActivateChannel(1)');
    r.intercept((url, options) => options.method === 'PUT' ? waiting.promise : undefined);
    const saving = r.change(id);
    await r.run('expertActivateChannel(2)');
    await r.run('expertActivateChannel(1)');
    r.node('expertTrackerStatus').textContent = r.node('douyinDesktopSessionStatus').textContent = '当前状态';
    r.node(id).value = 'note'; r.node(id).checked = true; r.node(id).disabled = true;
    waiting.reject(new Error('旧保存失败'));
    await saving;
    assert.equal(r.node(id).value, 'note');
    assert.equal(r.node(id).checked, true);
    assert.equal(r.node(id).disabled, true);
    assert.equal(r.node('expertTrackerStatus').textContent, '当前状态');
    assert.equal(r.node('douyinDesktopSessionStatus').textContent, '当前状态');
  });
}

test('saving an author uses the submitted identity and cannot switch the reader back later', async () => {
  const r = setup(), waiting = deferred();
  r.run('expertOpenCreatorForm(true)');
  r.node('creatorAccountName').value = '原作者新名称';
  r.node('creatorAccountUrl').value = 'https://www.douyin.com/user/original';
  r.intercept((url, options) => url === '/api/expert/resolve-profile' ? waiting.promise
    : url === '/api/expert/channels/1' && options.method === 'PUT' ? { id: 1 } : undefined);
  r.node('creatorAccountForm').querySelector = () => r.node('saveButton');
  const saving = r.node('creatorAccountForm').handlers.submit({ preventDefault() {}, target: r.node('creatorAccountForm') });
  await r.run('expertActivateChannel(2)');
  waiting.resolve({ profileUrl: 'https://www.douyin.com/user/original' });
  await saving;
  const put = r.requests.find(request => request.url === '/api/expert/channels/1' && request.options.method === 'PUT');
  assert.ok(put, 'switching must not turn an edit into creating another author');
  assert.equal(JSON.parse(put.options.body).displayName, '原作者新名称');
  assert.equal(r.node('creatorTaskChannelSelect').value, '2');
});
