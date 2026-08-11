const test = require('node:test');
const assert = require('node:assert/strict');

const { createBackgroundMode } = require('../electron/backgroundMode');

test('background mode hides the main window and keeps the process alive', () => {
  const menuTemplates = [];
  const trays = [];
  const window = {
    hidden: false,
    shown: false,
    focused: false,
    isDestroyed() { return false; },
    isMinimized() { return false; },
    hide() { this.hidden = true; },
    show() { this.shown = true; },
    focus() { this.focused = true; }
  };
  class FakeTray {
    constructor(iconPath) { this.iconPath = iconPath; this.handlers = {}; trays.push(this); }
    setToolTip(value) { this.tooltip = value; }
    setContextMenu(value) { this.menu = value; }
    on(name, handler) { this.handlers[name] = handler; }
    destroy() { this.destroyed = true; }
  }
  const controller = createBackgroundMode({
    app: { quit() {} },
    Tray: FakeTray,
    Menu: { buildFromTemplate(value) { menuTemplates.push(value); return value; } },
    iconPath: 'webstock.ico',
    getMainWindow() { return window; }
  });
  let prevented = false;

  controller.attach();
  controller.handleWindowClose({ preventDefault() { prevented = true; } });

  assert.equal(prevented, true);
  assert.equal(window.hidden, true);
  assert.equal(trays.length, 1);
  assert.equal(trays[0].tooltip, 'WebStock 后台采集');
  assert.deepEqual(menuTemplates[0].map(item => item.label || item.type), [
    '打开 WebStock', '立即检查全部创作者', 'separator', '完全退出'
  ]);
  trays[0].handlers.click();
  assert.equal(window.shown, true);
  assert.equal(window.focused, true);
});

test('background mode runs all collectors and exits only through the explicit command', async () => {
  let syncCalls = 0;
  let cleanupCalls = 0;
  let quitCalls = 0;
  let template = null;
  class FakeTray {
    setToolTip() {}
    setContextMenu() {}
    on() {}
    destroy() { this.destroyed = true; }
  }
  const controller = createBackgroundMode({
    app: { quit() { quitCalls += 1; } },
    Tray: FakeTray,
    Menu: { buildFromTemplate(value) { template = value; return value; } },
    iconPath: 'webstock.ico',
    getMainWindow() { return null; },
    async onSyncAll() { syncCalls += 1; },
    async onExit() { cleanupCalls += 1; }
  });

  controller.attach();
  await template.find(item => item.label === '立即检查全部创作者').click();
  assert.equal(syncCalls, 1);
  await template.find(item => item.label === '完全退出').click();
  assert.equal(cleanupCalls, 1);
  assert.equal(quitCalls, 1);
  assert.equal(controller.isQuitting(), true);
});
