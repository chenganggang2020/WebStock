const path = require('node:path');
const { createProcessRpc } = require('./processRpc');
const { createRemoteSession } = require('./desktopBackend');
let services, observer, shutdownTask, shuttingDown = false;
const remote = createRemoteSession((...args) => rpc.call(...args));

async function shutdown() {
  if (shutdownTask) return shutdownTask;
  shuttingDown = true;
  shutdownTask = (async () => {
    if (services) await services.stop();
    if (observer) observer.stop();
    // Reply first, then release IPC. Existing network/child-process handles drain
    // naturally, including their final persistence callbacks. Never force exit.
    setTimeout(() => { if (process.connected) process.disconnect(); }, 100);
    return true;
  })().catch(error => { shuttingDown = false; shutdownTask = null; throw error; });
  return shutdownTask;
}
const handlers = {
  async initialize(config) {
    if (services) throw new Error('Backend already initialized');
    observer = require('./runtimeDiagnostics').startRuntimeDiagnostics({
      directory: path.join(config.userDataDir, 'diagnostics', 'backend'),
      port: config.port, version: require('../package.json').version,
      nativeCapture: config.nativeCapture,
      onWarning: code => console.error('Backend diagnostics unavailable: ' + code)
    });
    services = require('./desktopBackendServices').createDesktopBackendServices(config, remote.sessionManager);
    try { return await services.start(); }
    catch (error) { await shutdown(); throw error; }
  },
  captureBatch: remote.onBatch,
  shutdown
};
for (const method of ['lanStatus', 'setLanEnabled', 'setPairingToken', 'syncAll', 'syncChannel', 'runVideo']) {
  handlers[method] = (...args) => {
    if (!services || shuttingDown) throw new Error('Backend is not ready');
    return services.commands[method](...args);
  };
}
const rpc = createProcessRpc(process, handlers);
process.on('disconnect', () => {
  shutdown().catch(error => { console.error('Backend shutdown failed:', error.message); process.exitCode = 1; });
});
