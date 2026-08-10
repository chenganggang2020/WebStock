const test = require('node:test');
const assert = require('node:assert/strict');

const { createDouyinSessionManager } = require('../electron/douyinSessionManager');

function createFakeBrowserWindow() {
  const instances = [];

  class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.destroyed = false;
      this.visible = false;
      this.focused = false;
      this.events = {};
      this.loadedUrls = [];
      this.navigationHandlers = {};
      this.webContents = {
        currentUrl: '',
        scriptResult: {},
        permissionHandler: null,
        setWindowOpenHandler: handler => { this.navigationHandlers.windowOpen = handler; },
        on: (name, handler) => { this.navigationHandlers[name] = handler; },
        getURL: () => this.webContents.currentUrl,
        executeJavaScript: async script => {
          this.executedScript = script;
          return this.webContents.scriptResult;
        },
        session: {
          setPermissionRequestHandler: handler => { this.webContents.permissionHandler = handler; }
        }
      };
      instances.push(this);
    }

    async loadURL(url) {
      this.loadedUrls.push(url);
      this.webContents.currentUrl = url;
    }

    show() { this.visible = true; }
    focus() { this.focused = true; }
    isDestroyed() { return this.destroyed; }
    on(name, handler) { this.events[name] = handler; }
  }

  FakeBrowserWindow.instances = instances;
  return FakeBrowserWindow;
}

test('Douyin session window is secure, persistent and reused across opens', async () => {
  const BrowserWindow = createFakeBrowserWindow();
  const manager = createDouyinSessionManager({ BrowserWindow, getParentWindow: () => null });

  const first = await manager.open('https://www.douyin.com/user/example');
  const second = await manager.open('https://www.douyin.com/search/%E6%A8%A1%E5%9E%8B%E5%85%88%E7%94%9F');

  assert.equal(BrowserWindow.instances.length, 1);
  assert.equal(first.windowOpen, true);
  assert.equal(second.windowOpen, true);
  assert.equal(BrowserWindow.instances[0].options.webPreferences.partition, 'persist:webstock-douyin');
  assert.equal(BrowserWindow.instances[0].options.webPreferences.contextIsolation, true);
  assert.equal(BrowserWindow.instances[0].options.webPreferences.nodeIntegration, false);
  assert.equal(BrowserWindow.instances[0].options.webPreferences.sandbox, true);
  assert.equal(BrowserWindow.instances[0].focused, true);
  assert.equal(BrowserWindow.instances[0].loadedUrls.length, 2);

  let permissionGranted = true;
  BrowserWindow.instances[0].webContents.permissionHandler(null, 'camera', value => { permissionGranted = value; });
  assert.equal(permissionGranted, false);
});

test('Douyin session collection returns a normalized visible-page snapshot', async () => {
  const BrowserWindow = createFakeBrowserWindow();
  const manager = createDouyinSessionManager({ BrowserWindow, getParentWindow: () => null });
  await manager.open('https://www.douyin.com/user/example');
  BrowserWindow.instances[0].webContents.scriptResult = {
    pageType: 'video',
    pageUrl: 'https://www.douyin.com/video/7533142185677114684?from=web',
    loggedIn: true,
    profile: { displayName: '模型先生' },
    items: [{ sourceUrl: 'https://www.douyin.com/video/7533142185677114684', title: '可见标题' }]
  };

  const result = await manager.collect();

  assert.equal(result.pageUrl, 'https://www.douyin.com/video/7533142185677114684?from=web');
  assert.equal(result.items[0].contentId, '7533142185677114684');
  assert.match(BrowserWindow.instances[0].executedScript, /querySelector/);
});

test('Douyin session rejects external URLs and collection before the window is opened', async () => {
  const BrowserWindow = createFakeBrowserWindow();
  const manager = createDouyinSessionManager({ BrowserWindow, getParentWindow: () => null });

  await assert.rejects(() => manager.open('https://example.com/login'), /抖音/);
  await assert.rejects(() => manager.collect(), /尚未打开/);
  assert.equal(BrowserWindow.instances.length, 0);
});
