const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const model = require('../js/modules/commentStrategyModel');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'modules', 'commentStrategyLab.js'), 'utf8');

function deferred() {
  let resolve;
  const promise = new Promise(onResolve => { resolve = onResolve; });
  return { promise, resolve };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); }
  };
}

function element(value) {
  const listeners = {};
  return {
    value: value == null ? '' : String(value),
    textContent: '',
    innerHTML: '',
    hidden: false,
    className: '',
    tabIndex: 0,
    classList: { toggle() {} },
    addEventListener(type, handler) { listeners[type] = handler; },
    fire(type) { if (listeners[type]) return listeners[type]({ target: this }); },
    setAttribute() {},
    focus() {}
  };
}

function createHarness(elements, apiFetch, storage) {
  const document = {
    getElementById(id) { return elements[id] || null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    activeElement: null
  };
  const window = { apiFetch, CommentStrategyModel: model, confirm() { return true; }, switchMainView() {} };
  window.window = window;
  vm.runInContext(source, vm.createContext({
    window, document, localStorage: storage, console, Date, Number, String, Array, Object, JSON, Promise, Set, Error
  }), { filename: 'commentStrategyLab.js' });
  return window;
}

async function flush() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

test('a newer observation comment request cannot be overwritten by an older response', async () => {
  const firstComments = deferred();
  const secondComments = deferred();
  const elements = {
    commentStrategyChannelSelect: element('1'),
    commentStrategyObservationSelect: element('1'),
    commentStrategyStatus: element(),
    commentStrategyError: element()
  };
  const apiFetch = url => {
    if (url === '/api/expert/channels') return Promise.resolve([{ id: 1, displayName: '模型先生' }]);
    if (url.includes('/observations?')) return Promise.resolve([{ id: 1, title: '旧视频' }, { id: 2, title: '新视频' }]);
    if (url.endsWith('/observations/1/comments')) return firstComments.promise;
    if (url.endsWith('/observations/2/comments')) return secondComments.promise;
    throw new Error('Unexpected URL ' + url);
  };
  const window = createHarness(elements, apiFetch, memoryStorage());

  const firstLoad = window.CommentStrategyLab.ensureLoaded();
  await flush();
  elements.commentStrategyObservationSelect.value = '2';
  elements.commentStrategyObservationSelect.fire('change');
  await flush();
  secondComments.resolve({ comments: [{ commentId: 'b1', text: 'B1' }, { commentId: 'b2', text: 'B2' }] });
  await flush();
  firstComments.resolve({ comments: [{ commentId: 'a1', text: 'A1' }] });
  await firstLoad;

  assert.match(elements.commentStrategyStatus.textContent, /2 条已保存评论/);
});

test('a complete rule card is saved locally without invoking a mutation endpoint', () => {
  const storage = memoryStorage();
  const elements = {
    commentRuleCardSelect: element(),
    commentRuleTitle: element(),
    commentRuleUniverse: element(),
    commentRuleTimeframe: element(),
    commentRuleSignalTiming: element(),
    commentRuleEntry: element(),
    commentRuleExit: element(),
    commentRuleStop: element(),
    commentRulePosition: element(),
    commentRuleCost: element(),
    commentRuleStatus: element(),
    commentRuleSource: element(),
    commentRuleSaveBtn: element(),
    commentRuleNewBtn: element(),
    commentRuleDeleteBtn: element(),
    commentStrategyStatus: element()
  };
  const window = createHarness(elements, () => { throw new Error('No API call expected'); }, storage);
  window.CommentStrategyLab.bind();
  elements.commentRuleTitle.value = '日线规则';
  elements.commentRuleUniverse.value = '沪深主板';
  elements.commentRuleTimeframe.value = '日线';
  elements.commentRuleSignalTiming.value = '收盘后';
  elements.commentRuleEntry.value = '次日开盘';
  elements.commentRuleExit.value = '目标位';
  elements.commentRuleStop.value = '收盘止损';
  elements.commentRulePosition.value = '单票20%';
  elements.commentRuleCost.value = '双边0.1%';
  elements.commentRuleSaveBtn.fire('click');

  const cards = JSON.parse(storage.getItem('webstock.commentStrategy.ruleCards'));
  assert.equal(cards.length, 1);
  assert.equal(cards[0].title, '日线规则');
  assert.match(elements.commentRuleStatus.innerHTML, /规则字段完整/);
});
