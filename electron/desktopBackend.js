const path = require('node:path');
const { fork } = require('node:child_process');
const { createProcessRpc } = require('./processRpc');

function createRemoteSession(call) {
  let sequence = 0;
  const batches = new Map();
  return {
    async onBatch(id, batch) {
      if (!batches.has(id)) throw new Error('Capture batch callback expired');
      return batches.get(id)(batch);
    },
    sessionManager: {
      captureUrl: (...args) => call('captureUrl', args, { timeoutMs: 0 }),
      captureProfileRecent: (...args) => call('captureProfileRecent', args, { timeoutMs: 0 }),
      async captureProfileArchive(url, options = {}) {
        const { onBatch, ...settings } = options;
        const id = typeof onBatch === 'function' ? ++sequence : null;
        if (id !== null) batches.set(id, onBatch);
        try { return await call('captureProfileArchive', [url, settings, id], { timeoutMs: 0 }); }
        finally { if (id !== null) batches.delete(id); }
      }
    }
  };
}

function createDesktopBackend(options = {}) {
  let child, rpc, exitPromise, stopPromise, shutdownRequested = false, stopping = false;
  const getSession = options.getSessionManager || (() => { throw new Error('Desktop capture is unavailable'); });
  function sessionForCapture() {
    if (stopping) throw new Error('Desktop capture is stopping');
    return getSession();
  }
  function call(method, args, settings) {
    if (stopping && !['shutdown', 'captureBatch', 'lanStatus'].includes(method)) {
      return Promise.reject(new Error('Backend is stopping'));
    }
    return rpc ? rpc.call(method, args, settings) : Promise.reject(new Error('Backend is not ready'));
  }
  async function start(config) {
    if (child) throw new Error('Backend already started');
    child = fork(options.script || path.join(__dirname, 'desktopBackendProcess.js'), [], {
      execPath: process.execPath,
      env: { ...process.env, ...options.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    exitPromise = new Promise(resolve => child.once('exit', (code, signal) => {
      resolve({ code, signal });
      if (!stopping) options.onExit?.({ code, signal });
    }));
    child.stdout.on('data', chunk => options.onLog?.(String(chunk)));
    child.stderr.on('data', chunk => options.onLog?.(String(chunk)));
    rpc = createProcessRpc(child, {
      douyinSessionState(state) {
        if (!state || !['login_required', 'authenticated'].includes(state.status) ||
            !Number.isSafeInteger(state.channelId) || state.channelId < 1) throw new Error('Invalid Douyin session state');
        if (stopping) return false;
        try {
          Promise.resolve(options.onDouyinSessionState?.({ status: state.status, channelId: state.channelId }))
            .catch(() => options.onLog?.('Douyin session notice delivery failed'));
        } catch (_) { options.onLog?.('Douyin session notice delivery failed'); }
        return true;
      },
      captureUrl: (...args) => sessionForCapture().captureUrl(...args),
      captureProfileRecent: (...args) => sessionForCapture().captureProfileRecent(...args),
      captureProfileArchive: (url, settings, id) => sessionForCapture().captureProfileArchive(url, {
        ...settings,
        onBatch: id === null ? undefined : batch => call('captureBatch', [id, batch], { timeoutMs: 0 })
      })
    });
    return call('initialize', [config], { timeoutMs: 60000 });
  }
  function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    if (stopPromise) return stopPromise;
    stopping = true;
    stopPromise = (async () => {
      if (!shutdownRequested) {
        await call('shutdown', [], { timeoutMs: 30000 });
        shutdownRequested = true;
      }
      let timeout;
      try {
        await Promise.race([exitPromise, new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Backend did not exit; no force termination was attempted')), 10000);
        })]);
      } finally { clearTimeout(timeout); }
      rpc.close();
    })().catch(error => { stopPromise = null; throw error; });
    return stopPromise;
  }
  return { start, call, stop, get child() { return child; } };
}

module.exports = { createDesktopBackend, createRemoteSession };
