const { createProcessRpc } = require('../../electron/processRpc');
const rpc = createProcessRpc(process, {
  initialize: () => ({ url: 'http://127.0.0.1:0/' }),
  notify: state => rpc.call('douyinSessionState', [state]),
  shutdown: () => { setTimeout(() => process.disconnect(), 30); return true; }
});
process.on('disconnect', () => process.exit(0));
