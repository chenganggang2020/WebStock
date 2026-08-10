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
          if (Array.isArray(this.webContents.scriptResults) && this.webContents.scriptResults.length) {
            return this.webContents.scriptResults.shift();
          }
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
    hide() { this.visible = false; }
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
  assert.equal(BrowserWindow.instances[0].options.webPreferences.backgroundThrottling, false);
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

test('Douyin session returns control when the remote page keeps loading', async () => {
  const BrowserWindow = createFakeBrowserWindow();
  const manager = createDouyinSessionManager({
    BrowserWindow,
    getParentWindow: () => null,
    loadTimeoutMs: 5
  });
  BrowserWindow.prototype.loadURL = function(url) {
    this.loadedUrls.push(url);
    this.webContents.currentUrl = url;
    return new Promise(() => {});
  };

  const result = await Promise.race([
    manager.open('https://www.douyin.com/video/7672339420096779953'),
    new Promise((resolve, reject) => setTimeout(() => reject(new Error('open did not yield')), 50))
  ]);

  assert.equal(result.windowOpen, true);
  assert.equal(result.loading, true);
  assert.equal(BrowserWindow.instances[0].visible, true);
  assert.equal(BrowserWindow.instances[0].focused, true);
});

test('background collection uses the persistent session without opening a visible login window', async () => {
  const BrowserWindow = createFakeBrowserWindow();
  const manager = createDouyinSessionManager({
    BrowserWindow,
    getParentWindow: () => null,
    pageSettleMs: 0
  });
  const capturePromise = manager.captureUrl('https://www.douyin.com/user/model-mr');
  BrowserWindow.instances[0].webContents.scriptResult = {
    pageType: 'profile',
    pageUrl: 'https://www.douyin.com/user/model-mr',
    loggedIn: true,
    profile: { displayName: '模型先生', profileUrl: 'https://www.douyin.com/user/model-mr' },
    items: [{ sourceUrl: 'https://www.douyin.com/video/7672339420096779953', title: '新视频' }]
  };

  const capture = await capturePromise;

  assert.equal(BrowserWindow.instances.length, 1);
  assert.equal(BrowserWindow.instances[0].visible, false);
  assert.equal(BrowserWindow.instances[0].options.webPreferences.partition, 'persist:webstock-douyin');
  assert.equal(capture.items[0].contentId, '7672339420096779953');
});

test('background collection waits until the target profile has rendered usable data', async () => {
  const BrowserWindow = createFakeBrowserWindow();
  const manager = createDouyinSessionManager({
    BrowserWindow,
    getParentWindow: () => null,
    pageSettleMs: 0,
    capturePollMs: 1,
    captureReadyTimeoutMs: 50
  });
  const pending = manager.captureUrl('https://www.douyin.com/user/model-mr');
  BrowserWindow.instances[0].webContents.scriptResults = [{
    pageType: 'profile', pageUrl: 'https://www.douyin.com/user/model-mr', loggedIn: true,
    profile: {}, items: []
  }, {
    pageType: 'profile', pageUrl: 'https://www.douyin.com/user/model-mr', loggedIn: true,
    profile: { displayName: '模型先生', profileUrl: 'https://www.douyin.com/user/model-mr', workCount: 368 },
    items: [{ sourceUrl: 'https://www.douyin.com/video/7672339420096779953', title: '已渲染' }]
  }];

  const capture = await pending;

  assert.equal(capture.profile.workCount, 368);
  assert.equal(capture.items.length, 1);
});

test('background detail collection does not accept a generic title as extracted video content', async () => {
  const BrowserWindow = createFakeBrowserWindow();
  const manager = createDouyinSessionManager({
    BrowserWindow,
    getParentWindow: () => null,
    pageSettleMs: 0,
    capturePollMs: 1,
    captureReadyTimeoutMs: 50
  });
  const url = 'https://www.douyin.com/video/7672339420096779953';
  const pending = manager.captureUrl(url);
  BrowserWindow.instances[0].webContents.scriptResults = [{
    pageType: 'video', pageUrl: url, loggedIn: true,
    profile: { displayName: '模型先生', profileUrl: 'https://www.douyin.com/user/model-mr' },
    items: [{ sourceUrl: url, title: '抖音 - 记录美好生活' }]
  }, {
    pageType: 'video', pageUrl: url, loggedIn: true,
    profile: { displayName: '模型先生', profileUrl: 'https://www.douyin.com/user/model-mr' },
    items: [{ sourceUrl: url, title: '产业观察', summary: '页面已经渲染出的章节摘要。' }]
  }];

  const capture = await pending;

  assert.equal(capture.items[0].summary, '页面已经渲染出的章节摘要。');
});

test('background collection reloads a recoverable Douyin service error', async () => {
  const BrowserWindow = createFakeBrowserWindow();
  const manager = createDouyinSessionManager({
    BrowserWindow,
    getParentWindow: () => null,
    pageSettleMs: 0,
    capturePollMs: 1,
    captureReadyTimeoutMs: 20,
    captureReloadAttempts: 1,
    captureRetryDelayMs: 0
  });
  const url = 'https://www.douyin.com/user/model-mr';
  const pending = manager.captureUrl(url);
  BrowserWindow.instances[0].webContents.scriptResults = [{
    pageType: 'profile', pageUrl: url, loggedIn: true, loadError: true,
    profile: { displayName: '模型先生', profileUrl: url }, items: []
  }, {
    pageType: 'profile', pageUrl: url, loggedIn: true,
    profile: { displayName: '模型先生', profileUrl: url, workCount: 368 },
    items: [{ sourceUrl: 'https://www.douyin.com/video/7672339420096779953', title: '恢复后的作品' }]
  }];

  const capture = await pending;

  assert.equal(BrowserWindow.instances[0].loadedUrls.length, 2);
  assert.equal(capture.items.length, 1);
});
