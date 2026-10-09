const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
test('widget is opt-in, pinned, sandboxed; close disables but app disposal preserves preference', async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'market-widget-'));
  const windows = [];
  class Window extends EventEmitter {
    constructor(options) { super(); this.options = options; this.webContents = new EventEmitter(); this.webContents.mainFrame = {}; this.webContents.setWindowOpenHandler = fn => { this.openHandler = fn; }; windows.push(this); }
    setAlwaysOnTop(top) { this.top = top; } setMenuBarVisibility() {} loadURL(url) { this.url = url; this.webContents.mainFrame.url = url; return Promise.resolve(); }
    showInactive() {} getBounds() { return { x: 20, y: 20, width: 350, height: 480 }; }
    destroy() { this.dead = true; this.emit('closed'); } isDestroyed() { return !!this.dead; }
  }
  try {
    const create = () => require('../electron/marketWidget').createMarketWidget({ BrowserWindow: Window, userDataDir: directory, url: 'http://127.0.0.1:3000/', screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) } });
    const controller = create(); controller.restore(); assert.equal(windows.length, 0);
    controller.set({ enabled: true }); const win = windows[0];
    assert.equal(win.options.alwaysOnTop, true); assert.equal(win.options.webPreferences.sandbox, true);
    assert.equal(win.options.webPreferences.nodeIntegration, false);
    assert.equal(controller.isSender({ sender: win.webContents, senderFrame: win.webContents.mainFrame }), true);
    assert.equal(controller.isSender({ sender: win.webContents, senderFrame: {} }), false);
    win.webContents.mainFrame.url = 'https://example.com/';
    assert.equal(controller.isSender({ sender: win.webContents, senderFrame: win.webContents.mainFrame }), false);
    win.webContents.mainFrame.url = win.url;
    assert.equal(win.openHandler({ url: 'https://example.com' }).action, 'deny');
    controller.dispose(); assert.equal(controller.state().enabled, true);
    const restored = create(); restored.restore(); assert.equal(windows.length, 2);
    windows[1].emit('close', { preventDefault() {} }); assert.equal(restored.state().enabled, false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
