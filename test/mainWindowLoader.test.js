const test = require('node:test');
const assert = require('node:assert/strict');

const { loadMainWindow } = require('../electron/mainWindowLoader');

function fakeWindow(outcomes, getUrl) {
  let calls = 0;
  return {
    loadURL: async function(url) {
      const outcome = outcomes[calls++];
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
    isDestroyed: function() { return false; },
    webContents: {
      getURL: getUrl || function() { return 'about:blank'; }
    },
    get calls() { return calls; }
  };
}

test('retries a failed startup navigation while the window is still blank', async function() {
  const window = fakeWindow([new Error('ERR_CONNECTION_REFUSED'), undefined]);
  const logs = [];

  const result = await loadMainWindow(window, 'http://127.0.0.1:3000/', {
    maxAttempts: 3,
    delay: async function() {},
    log: function(message) { logs.push(message); }
  });

  assert.deepEqual(result, { loaded: true, attempts: 2 });
  assert.equal(window.calls, 2);
  assert.match(logs.join('\n'), /retrying/i);
});

test('does not retry after a real page has replaced about blank', async function() {
  const window = fakeWindow(
    [new Error('navigation superseded'), undefined],
    function() { return 'http://127.0.0.1:3000/tasks'; }
  );

  const result = await loadMainWindow(window, 'http://127.0.0.1:3000/', {
    maxAttempts: 3,
    delay: async function() {}
  });

  assert.deepEqual(result, { loaded: false, attempts: 1, reason: 'navigation_changed' });
  assert.equal(window.calls, 1);
});

test('bounds startup navigation retries', async function() {
  const window = fakeWindow([
    new Error('first failure'),
    new Error('second failure'),
    new Error('third failure'),
    undefined
  ]);

  const result = await loadMainWindow(window, 'http://127.0.0.1:3000/', {
    maxAttempts: 3,
    delay: async function() {}
  });

  assert.deepEqual(result, { loaded: false, attempts: 3, reason: 'load_failed' });
  assert.equal(window.calls, 3);
});
