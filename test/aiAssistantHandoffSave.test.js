const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'modules', 'aiAssistant.js'), 'utf8');
const invalidResult = '{ invalid paper-monitor JSON }';
const correctedResult = '{"decision":"hold","reason":"等待下一次有效信号"}';
const failureMessage = '纸面判断 JSON 格式无效，请更正后重试。';
const successMessage = /已保存|保存成功|关联成功|已关联/;

function element() {
  const listeners = {};
  return {
    value: '',
    textContent: '',
    className: '',
    disabled: false,
    style: { display: '' },
    addEventListener(type, handler) { listeners[type] = handler; },
    fire(type) {
      if (this.disabled) return;
      if (listeners[type]) return listeners[type]({ target: this });
    },
    setAttribute() {},
    removeAttribute() {},
    focus() {}
  };
}

function harness() {
  const elements = Object.fromEntries([
    'handoffModalOverlay', 'handoffModalTitle', 'handoffModalSummary',
    'handoffPromptStyle', 'handoffPromptText', 'handoffResultText',
    'handoffStatus', 'handoffSaveBtn', 'handoffCloseBtn', 'handoffCopyBtn'
  ].map(id => [id, element()]));
  const storage = new Map();
  const alerts = [];
  const clipboardWrites = [];
  const window = {};
  const context = vm.createContext({
    window,
    document: { getElementById(id) { return elements[id] || null; } },
    navigator: { clipboard: { async writeText(value) { clipboardWrites.push(value); } } },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); }
    },
    alert(message) { alerts.push(String(message)); },
    console: { warn() {} },
    setTimeout, clearTimeout, setInterval, clearInterval
  });
  vm.runInContext(source, context, { filename: 'aiAssistant.js' });
  window.AIAssistant.bind();
  return {
    api: window.AIAssistant,
    elements,
    alerts,
    clipboardWrites,
    save() { return elements.handoffSaveBtn.fire('click'); },
    history() { return JSON.parse(JSON.stringify(window.AIAssistant.getSavedResults())); },
    visibleMessages() { return alerts.join('\n') + '\n' + elements.handoffStatus.textContent; }
  };
}

function openPaperHandoff(app, onSave, result = invalidResult) {
  app.api.open({
    title: '纸面账户 ChatGPT 盯盘判断',
    kind: 'paper-monitor',
    prompt: '仅根据提供的点时证据返回纸面模拟判断。',
    context: { paperPortfolioId: 7, asOf: '2026-09-07T10:00:00+08:00' },
    result,
    onSave
  });
}

test('rejected paper handoff does not add a successful local history record', async () => {
  const app = harness();
  app.api.saveHistoryRecord({ title: 'Existing research', result: 'Previously saved result' });
  const previousHistory = app.history();
  openPaperHandoff(app, async () => { throw new Error(failureMessage); });

  await app.save();

  assert.deepEqual(app.history(), previousHistory);
});

test('rejected paper handoff keeps its input visible and available for correction', async () => {
  const app = harness();
  openPaperHandoff(app, async () => { throw new Error(failureMessage); });

  await app.save();

  assert.equal(app.elements.handoffModalOverlay.style.display, 'flex');
  assert.equal(app.elements.handoffResultText.value, invalidResult);
  assert.equal(app.elements.handoffSaveBtn.disabled, false);
});

test('rejected paper handoff reports the validation error without claiming success', async () => {
  const app = harness();
  openPaperHandoff(app, async () => { throw new Error(failureMessage); });

  await app.save();

  assert.doesNotMatch(app.visibleMessages(), successMessage);
  assert.ok(app.visibleMessages().includes(failureMessage));
});

test('correcting and retrying a rejected paper handoff saves only the accepted result once', async () => {
  const app = harness();
  const submitted = [];
  openPaperHandoff(app, async result => {
    submitted.push(result);
    if (result === invalidResult) throw new Error(failureMessage);
    return { accepted: true };
  });

  await app.save();
  app.elements.handoffResultText.value = correctedResult;
  await app.save();

  assert.deepEqual(submitted, [invalidResult, correctedResult]);
  const saved = app.history();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].result, correctedResult);
  assert.equal(saved[0].kind, 'paper-monitor');
  assert.equal(saved[0].context.paperPortfolioId, 7);
  assert.equal(app.elements.handoffModalOverlay.style.display, 'none');
  assert.equal(app.alerts.filter(message => successMessage.test(message)).length, 1);
});

test('paper handoff remains unsaved until the asynchronous task association succeeds', async () => {
  const app = harness();
  let accept;
  const association = new Promise(resolve => { accept = resolve; });
  openPaperHandoff(app, () => association, correctedResult);

  const saving = app.save();
  const whilePending = {
    history: app.history(),
    visibleMessages: app.visibleMessages(),
    display: app.elements.handoffModalOverlay.style.display
  };
  accept({ accepted: true });
  await saving;

  assert.deepEqual(whilePending.history, []);
  assert.doesNotMatch(whilePending.visibleMessages, successMessage);
  assert.equal(whilePending.display, 'flex');
  assert.equal(app.history().length, 1);
  assert.equal(app.elements.handoffModalOverlay.style.display, 'none');
});

test('ordinary local handoff without a task callback still saves successfully', async () => {
  const app = harness();
  app.api.open({ title: 'Local research note', result: 'Keep this research result.' });

  await app.save();

  assert.equal(app.history().length, 1);
  assert.equal(app.history()[0].result, 'Keep this research result.');
  assert.equal(app.elements.handoffModalOverlay.style.display, 'none');
  assert.match(app.visibleMessages(), successMessage);
});

test('paper-monitor displays and copies the server prompt verbatim regardless of selected style', async () => {
  const app = harness();
  const prompt = '点时证据 asOf=2026-09-07T10:00:00+08:00\n  严格 JSON 输出。\n';
  app.api.open({ kind: 'paper-monitor', prompt, promptStyle: 'risk-control' });
  const displayedOnOpen = app.elements.handoffPromptText.value;
  const styleDisabled = app.elements.handoffPromptStyle.disabled;
  await app.api.copyPrompt();

  app.elements.handoffPromptStyle.value = 'technical';
  app.elements.handoffPromptStyle.fire('change');
  const displayedAfterStyleChange = app.elements.handoffPromptText.value;
  await app.api.copyPrompt();

  assert.deepEqual({
    displayedOnOpen,
    styleDisabled,
    displayedAfterStyleChange,
    copiedPrompts: app.clipboardWrites
  }, {
    displayedOnOpen: prompt,
    styleDisabled: true,
    displayedAfterStyleChange: prompt,
    copiedPrompts: [prompt, prompt]
  });
});

test('ordinary research can select prompt styles after a paper-monitor handoff', () => {
  const app = harness();
  app.api.open({ kind: 'paper-monitor', prompt: 'Locked paper prompt.' });
  const prompt = '普通研究证据。';
  app.api.open({ kind: 'knowledge-analysis', prompt, promptStyle: 'technical' });

  assert.equal(app.elements.handoffPromptStyle.disabled, false);
  assert.match(app.elements.handoffPromptText.value, /技术走势专家模式/);
  assert.ok(app.elements.handoffPromptText.value.endsWith(prompt));
  app.elements.handoffPromptStyle.value = 'risk-control';
  app.elements.handoffPromptStyle.fire('change');
  assert.match(app.elements.handoffPromptText.value, /风控止损计划模式/);
  assert.ok(app.elements.handoffPromptText.value.endsWith(prompt));
});

test('repeated save clicks during a pending association submit and save only once', async () => {
  const app = harness();
  let accept;
  let submissions = 0;
  const association = new Promise(resolve => { accept = resolve; });
  openPaperHandoff(app, () => {
    submissions += 1;
    return association;
  }, correctedResult);

  const firstSave = app.save();
  const secondSave = app.save();
  const submissionsWhilePending = submissions;
  accept({ accepted: true });
  await Promise.all([firstSave, secondSave]);

  assert.equal(submissionsWhilePending, 1);
  assert.equal(submissions, 1);
  assert.equal(app.history().length, 1);
  assert.equal(app.alerts.filter(message => successMessage.test(message)).length, 1);
});
