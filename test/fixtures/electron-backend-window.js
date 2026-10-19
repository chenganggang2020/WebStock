// Isolated native-window check; no application database, login, or external requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { app, BrowserWindow } = require('electron');
const { createDesktopBackend } = require('../../electron/desktopBackend');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-window-isolation-'));
app.setPath('userData', directory);
let window, backend, pulse;
app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } });
    await window.loadURL('data:text/html,' + encodeURIComponent('<button id="test" onclick="this.textContent=\'responsive\'">test</button>'));
    backend = createDesktopBackend({ script: path.join(__dirname, 'backend-block.js') });
    await backend.start({ port: 0 });
    const blocking = once(backend.child, 'message');
    let completed = false, pulses = 0;
    const work = backend.call('block', [], { timeoutMs: 5000 }).then(() => { completed = true; });
    await blocking;
    pulse = setInterval(() => pulses++, 20);
    const started = Date.now();
    const text = await window.webContents.executeJavaScript("document.querySelector('#test').click(); document.querySelector('#test').textContent");
    const interactionMs = Date.now() - started;
    await new Promise(resolve => setTimeout(resolve, 180));
    clearInterval(pulse);
    assert.equal(text, 'responsive');
    assert.equal(completed, false, 'data process must still be blocked during window interaction');
    assert.ok(pulses >= 3, 'Electron main must continue processing events');
    await work;
    await backend.stop();
    console.log('WINDOW_ISOLATION_PASS ' + JSON.stringify({ electron: process.versions.electron, interactionMs, pulses, backendExitCode: backend.child.exitCode }));
    window.destroy();
    app.quit();
  } catch (error) {
    clearInterval(pulse);
    console.error(error.stack);
    if (backend) await backend.stop().catch(() => {});
    if (window && !window.isDestroyed()) window.destroy();
    app.exit(1);
  }
});
