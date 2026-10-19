const test = require('node:test');
const assert = require('node:assert/strict');
const { createDouyinLoginNotice } = require('../electron/douyinLoginNotice');

test('shared-session login failures produce one asynchronous native notice until recovery', async () => {
  const shown = [], opened = [];
  let respond;
  const notice = createDouyinLoginNotice({
    dialog: { showMessageBox(options) { shown.push(options); return new Promise(resolve => { respond = resolve; }); } },
    openLogin: () => opened.push('login')
  });
  const first = notice.handle({ status: 'login_required', channelId: 4 });
  await notice.handle({ status: 'login_required', channelId: 5 });
  assert.equal(shown.length, 1);
  assert.deepEqual(shown[0].buttons, ['去登录', '稍后']);
  assert.equal(opened.length, 0, 'login must never open before an explicit choice');
  respond({ response: 1 });
  await first;
  await notice.handle({ status: 'login_required', channelId: 4 });
  assert.equal(shown.length, 1, 'later polling must not repeat the same episode');
  await notice.handle({ status: 'authenticated', channelId: 5 });
  const next = notice.handle({ status: 'login_required', channelId: 4 });
  assert.equal(shown.length, 2);
  respond({ response: 0 });
  await next;
  assert.equal(opened.length, 1);
});

test('network errors and untrusted statuses never ask users to log in', async () => {
  const notice = createDouyinLoginNotice({
    dialog: { showMessageBox() { assert.fail('must not show a login dialog'); } },
    openLogin() { assert.fail('must not open login'); }
  });
  for (const status of ['network_error', 'unknown', '', null]) await notice.handle({ status });
});

test('a recovered or closing application does not open a late login window', async () => {
  for (const recovered of [true, false]) {
    let respond;
    const parent = { isDestroyed: () => false };
    const notice = createDouyinLoginNotice({
      getParentWindow: () => parent,
      dialog: { showMessageBox(window, options) {
        assert.equal(window, parent); assert.equal(options.cancelId, 1);
        return new Promise(resolve => { respond = resolve; });
      } },
      openLogin() { assert.fail('stale confirmation must not open login'); }
    });
    const task = notice.handle({ status: 'login_required' });
    if (recovered) await notice.handle({ status: 'authenticated' });
    else notice.dispose();
    respond({ response: 0 });
    await task;
  }
});

test('notice failures are logged and do not reject into collection', async () => {
  const errors = [];
  const notice = createDouyinLoginNotice({
    dialog: { async showMessageBox() { throw new Error('dialog unavailable'); } },
    log: (message, error) => errors.push([message, error.message])
  });
  await notice.handle({ status: 'login_required' });
  assert.equal(errors.length, 1);
  await notice.handle({ status: 'login_required' });
  assert.equal(errors.length, 2, 'a failed native dialog must not permanently suppress the notice');
});
