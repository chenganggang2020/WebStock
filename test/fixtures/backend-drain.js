// Replace only the business layer, exercise the real child-process shutdown protocol.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
require.cache[require.resolve('../../electron/desktopBackendServices')] = { exports: {
  createDesktopBackendServices(config) {
    let stopCount = 0;
    return {
      async start() { return { pid: process.pid }; },
      async stop() { if (config.failFirstStop && ++stopCount === 1) throw new Error('stop failed once'); },
      commands: {
        syncAll() {
          const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 700)'], { windowsHide: true, stdio: 'ignore' });
          child.once('exit', () => fs.writeFileSync(path.join(config.userDataDir, 'drained.txt'), 'completed'));
          return { started: true };
        }
      }
    };
  }
} };
require('../../electron/desktopBackendProcess');
