const { createProcessRpc } = require('../../electron/processRpc');
const { createRemoteSession } = require('../../electron/desktopBackend');
const remote = createRemoteSession((...args) => rpc.call(...args));
const rpc = createProcessRpc(process, {
  initialize: () => ({ url: 'http://127.0.0.1:0/' }),
  block: async () => {
    await new Promise(resolve => process.send({ type: 'blocking' }, resolve));
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  },
  archive: () => remote.sessionManager.captureProfileArchive('https://www.douyin.com/user/test', {
    async onBatch(batch) { if (batch.items[0] !== 1) throw new Error('wrong batch'); }
  }),
  archiveFailure: () => remote.sessionManager.captureProfileArchive('https://www.douyin.com/user/test', {
    async onBatch() { throw new Error('save failed'); }
  }),
  captureBatch: remote.onBatch,
  shutdown: () => { setTimeout(() => process.disconnect(), 30); return true; }
});
process.on('disconnect', () => process.exit(0));
