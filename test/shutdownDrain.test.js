const test = require('node:test');
const assert = require('node:assert/strict');

const { createDouyinAutoSync } = require('../electron/douyinAutoSync');
const { createBackgroundMode } = require('../electron/backgroundMode');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const nextTurn = () => new Promise(resolve => setImmediate(resolve));

for (const mode of ['scheduled author', 'single video']) {
  test('stop waits for ' + mode + ' persistence before completing shutdown', async () => {
    const saving = deferred();
    const releaseSave = deferred();
    const profileUrl = 'https://www.douyin.com/user/shutdown-drain';
    const contentId = '7940000000000000001';
    const sourceUrl = 'https://www.douyin.com/video/' + contentId;
    const observation = {
      id: 1, externalContentId: contentId, sourceUrl, mediaType: 'video',
      transcript: 'Previously persisted transcript',
      mediaMetadata: { detailCapturedAt: '2026-09-20T00:00:00.000Z', asr: { status: 'complete' } }
    };
    const state = { saved: false, completed: false, stopped: false, opened: [] };
    const sync = createDouyinAutoSync({
      sessionManager: {
        async captureUrl(url) {
          state.opened.push(url);
          return {
            pageType: url === profileUrl ? 'profile' : 'video', pageUrl: url, loggedIn: true,
            profile: { profileUrl, workCount: 1 }, items: [{ contentId, sourceUrl }]
          };
        }
      },
      channels: {
        listChannels: () => [],
        getChannel: id => ({ id, platform: 'douyin', profileUrl }),
        getObservation: () => observation,
        listObservations: () => [observation]
      },
      sources: {
        verifyCapturedIdentity: () => ({ matched: true }),
        async importCapturedPageAsync() {
          saving.resolve();
          await releaseSave.promise;
          state.saved = true;
          return { addedCount: 0, updatedCount: 0, unchangedCount: 1, items: [observation] };
        }
      },
      syncState: {
        listDue: () => [{ channelId: 1 }, { channelId: 2 }],
        markRunning() {},
        markCompleted() { state.completed = state.saved; },
        markFailed() { assert.fail('the in-flight save should complete successfully'); }
      }
    });
    const task = mode === 'scheduled author' ? sync.runDue() : sync.runVideo(1, 1, 'capture');
    await saving.promise;
    const stopped = Promise.resolve(sync.stop()).then(() => { state.stopped = true; });

    try {
      await nextTurn();
      assert.equal(state.saved, false);
      assert.equal(state.stopped, false, 'shutdown completed while the current save was still pending');
      await assert.rejects(sync.syncChannel(3), /stopping/);
      await assert.rejects(sync.runVideo(3, 1, 'capture'), /stopping/);
      assert.deepEqual(await sync.runDue(), { skipped: true, reason: 'stopping' });

      releaseSave.resolve();
      await stopped;
      assert.equal(state.saved, true);
      assert.equal(state.completed, true, 'shutdown must wait until the saved result has a terminal job state');
      assert.equal(sync.status().runningCount, 0);
      assert.deepEqual(state.opened, [mode === 'scheduled author' ? profileUrl : sourceUrl]);
    } finally {
      releaseSave.resolve();
      await Promise.allSettled([task, stopped]);
    }
  });
}

test('stop drains a scheduled failure through its persisted terminal state without an unhandled rejection', async () => {
  const started = deferred();
  const capture = deferred();
  const state = { opened: [], failed: [], stopped: false };
  const sync = createDouyinAutoSync({
    sessionManager: {
      captureUrl(url) {
        state.opened.push(url);
        started.resolve();
        return capture.promise;
      }
    },
    channels: {
      listChannels: () => [], listObservations: () => [],
      getChannel: id => ({ id, platform: 'douyin', profileUrl: 'https://www.douyin.com/user/' + id })
    },
    sources: {},
    syncState: {
      listDue: () => [{ channelId: 1 }, { channelId: 2 }],
      markRunning() {},
      markCompleted() { assert.fail('a failed capture cannot be marked complete'); },
      markFailed(id, error) { state.failed.push({ id, message: error.message }); }
    }
  });
  const task = sync.runDue();
  await started.promise;
  const stopped = Promise.resolve(sync.stop()).then(() => { state.stopped = true; });

  try {
    await nextTurn();
    assert.equal(state.stopped, false, 'shutdown completed before the in-flight failure could be persisted');
    capture.reject(new Error('capture closed during shutdown'));
    await stopped;
    assert.deepEqual(state.failed, [{ id: 1, message: 'capture closed during shutdown' }]);
    assert.deepEqual(state.opened, ['https://www.douyin.com/user/1']);
    assert.equal(sync.status().runningCount, 0);
    await nextTurn();
  } finally {
    capture.reject(new Error('capture closed during shutdown'));
    await Promise.allSettled([task, stopped]);
  }
});

function backgroundFixture(onExit) {
  const state = { mainVisible: false, pendingVisible: false, quit: false, error: '' };
  class Tray {
    setToolTip() {} setContextMenu() {} on() {} destroy() {}
  }
  const controller = createBackgroundMode({
    app: { quit() { state.quit = true; } },
    Tray,
    Menu: { buildFromTemplate: items => items },
    getMainWindow: () => ({
      isDestroyed: () => false,
      show() { state.mainVisible = true; }
    }),
    onExit,
    onExitPending(value) { state.pendingVisible = value; },
    onExitError(error) { state.error = error.message; }
  });
  return { controller, state };
}

test('opening the window during shutdown shows the pending view until the app can quit', async () => {
  const saving = deferred();
  const { controller, state } = backgroundFixture(() => saving.promise);
  const exiting = controller.exit();

  try {
    assert.equal(state.pendingVisible, true, 'starting shutdown must show its pending state');
    state.pendingVisible = false;
    controller.showMainWindow();
    assert.equal(state.pendingVisible, true);
    assert.equal(state.mainVisible, false, 'the normal page is not ready while its backend is shutting down');
    assert.equal(state.quit, false);
    saving.resolve();
    await exiting;
    assert.equal(state.quit, true);
  } finally {
    saving.resolve();
    await exiting;
  }
});

test('failed shutdown keeps the pending view and allows retry without reopening a stopped normal page', async () => {
  let attempts = 0;
  const { controller, state } = backgroundFixture(async () => {
    if (++attempts === 1) throw new Error('save is still draining');
  });

  await controller.exit();
  assert.equal(state.error, 'save is still draining');
  assert.equal(state.quit, false);
  assert.equal(state.pendingVisible, true);
  assert.equal(state.mainVisible, false, 'a shutdown failure must not advertise an already stopped backend as ready');
  state.pendingVisible = false;
  controller.showMainWindow();
  assert.equal(state.pendingVisible, true);
  assert.equal(state.mainVisible, false);

  await controller.exit();
  assert.equal(attempts, 2);
  assert.equal(state.quit, true);
});
