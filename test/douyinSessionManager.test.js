const test = require('node:test');
const assert = require('node:assert/strict');

const { createDouyinSessionManager } = require('../electron/douyinSessionManager');

function createFakeDebugger(responseBody) {
  const handlers = new Set();
  return {
    attached: false,
    commands: [],
    bodyReadCount: 0,
    isAttached() { return this.attached; },
    attach() { this.attached = true; },
    detach() { this.attached = false; },
    on(name, handler) { if (name === 'message') handlers.add(handler); },
    removeListener(name, handler) { if (name === 'message') handlers.delete(handler); },
    async sendCommand(method) {
      this.commands.push(method);
      if (method === 'Network.getResponseBody') {
        this.bodyReadCount += 1;
        return { body: JSON.stringify(responseBody), base64Encoded: false };
      }
      return {};
    },
    emit(method, params) { handlers.forEach(handler => handler({}, method, params)); }
  };
}

function createFakeBrowserWindow(configuration = {}) {
  const instances = [];

  class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.destroyed = false;
      this.visible = false;
      this.focused = false;
      this.events = {};
      this.loadedUrls = [];
      this.executedScripts = [];
      this.navigationHandlers = {};
      this.audioMuted = false;
      this.webContents = {
        currentUrl: '',
        scriptResult: {},
        permissionHandler: null,
        setAudioMuted: value => { this.audioMuted = Boolean(value); },
        setWindowOpenHandler: handler => { this.navigationHandlers.windowOpen = handler; },
        on: (name, handler) => { this.navigationHandlers[name] = handler; },
        getURL: () => this.webContents.currentUrl,
        executeJavaScript: async script => {
          this.executedScript = script;
          this.executedScripts.push(script);
          if (/window\.scrollTo|window\.scrollBy/.test(script)) {
            this.scrollExecutions = (this.scrollExecutions || 0) + 1;
            if (/scrollableContainers|parentElement/.test(script)) {
              this.containerScrollExecutions = (this.containerScrollExecutions || 0) + 1;
            }
            return true;
          }
          if (/querySelectorAll\('video, audio'\)/.test(script) && !/querySelector/.test(script.replace("querySelectorAll('video, audio')", ''))) {
            return true;
          }
          if (Array.isArray(this.webContents.mediaProbeResults) &&
              this.webContents.mediaProbeResults.length && !/itemsById/.test(script)) {
            return this.webContents.mediaProbeResults.shift();
          }
          if (Array.isArray(this.webContents.scriptResults) && this.webContents.scriptResults.length) {
            return this.webContents.scriptResults.shift();
          }
          return this.webContents.scriptResult;
        },
        session: {
          setPermissionRequestHandler: handler => { this.webContents.permissionHandler = handler; }
        }
      };
      if (configuration.debuggerApi) this.webContents.debugger = configuration.debuggerApi;
      instances.push(this);
    }

    async loadURL(url) {
      this.loadedUrls.push(url);
      this.webContents.currentUrl = url;
      if (typeof configuration.onLoad === 'function') configuration.onLoad(this, url);
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
  assert.equal(BrowserWindow.instances[0].audioMuted, true);
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
  assert.equal(BrowserWindow.instances[0].audioMuted, true);
  assert.match(BrowserWindow.instances[0].executedScript, /\.pause\(\)/);
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

test('background detail collection accepts a loaded media stream for transcription', async () => {
  const BrowserWindow = createFakeBrowserWindow();
  const manager = createDouyinSessionManager({
    BrowserWindow,
    getParentWindow: () => null,
    pageSettleMs: 0,
    capturePollMs: 1,
    captureReadyTimeoutMs: 50
  });
  const url = 'https://www.douyin.com/video/7671834569137647601';
  const pending = manager.captureUrl(url);
  BrowserWindow.instances[0].webContents.scriptResults = [{
    pageType: 'video', pageUrl: url, loggedIn: true,
    profile: { displayName: '模型先生', profileUrl: 'https://www.douyin.com/user/model-mr' },
    items: [{ sourceUrl: url, mediaUrl: 'https://v3-dy-o.zjcdn.com/video/sample.mp4?token=signed' }]
  }];

  const capture = await pending;
  assert.match(capture.items[0].mediaUrl, /token=signed/);
});

test('preferred-media detail collection attaches probe candidates before returning useful text', async () => {
  const BrowserWindow = createFakeBrowserWindow();
  const manager = createDouyinSessionManager({
    BrowserWindow,
    getParentWindow: () => null,
    pageSettleMs: 0,
    capturePollMs: 1,
    captureReadyTimeoutMs: 50
  });
  const url = 'https://www.douyin.com/video/7671834569137647601';
  const pending = manager.captureUrl(url, { preferMediaUrl: true });
  const detail = {
    pageType: 'video', pageUrl: url, loggedIn: true,
    profile: { displayName: '模型先生', profileUrl: 'https://www.douyin.com/user/model-mr' },
    items: [{ sourceUrl: url, summary: '页面文字已经先加载完成。' }]
  };
  const candidates = [
    { url: 'https://v3-dy-o.zjcdn.com/video/preferred.mp4?token=fresh', bytes: 2048, source: 'bit_rate', quality: '1080p' },
    { url: 'https://v9-dy-o.douyinvod.com/video/fallback.mp4?token=fresh', bytes: 1024, source: 'play_addr', quality: '720p' }
  ];
  BrowserWindow.instances[0].webContents.scriptResult = detail;
  BrowserWindow.instances[0].webContents.mediaProbeResults = [candidates];

  const capture = await pending;

  assert.equal(capture.items[0].mediaUrl, candidates[0].url);
  assert.deepEqual(capture.items[0].mediaCandidates, candidates);
  assert.ok(BrowserWindow.instances[0].executedScripts.some(script => !/itemsById/.test(script) && /7671834569137647601/.test(script)));
});

test('preferred-media detail collection returns the last useful detail after the media grace period', async () => {
  const BrowserWindow = createFakeBrowserWindow();
  const manager = createDouyinSessionManager({
    BrowserWindow,
    getParentWindow: () => null,
    pageSettleMs: 0,
    capturePollMs: 1,
    captureReadyTimeoutMs: 8
  });
  const url = 'https://www.douyin.com/video/7671834569137647601';
  const detail = {
    pageType: 'video', pageUrl: url, loggedIn: true,
    profile: { displayName: '模型先生', profileUrl: 'https://www.douyin.com/user/model-mr' },
    items: [{ sourceUrl: url, summary: '媒体缺失时仍要保留的详情文字。' }]
  };
  const pending = manager.captureUrl(url, { preferMediaUrl: true });
  BrowserWindow.instances[0].webContents.scriptResult = detail;
  BrowserWindow.instances[0].webContents.mediaProbeResults = Array.from({ length: 20 }, () => []);

  const capture = await pending;

  assert.equal(capture.items[0].summary, '媒体缺失时仍要保留的详情文字。');
  assert.equal(capture.items[0].mediaUrl, '');
  assert.deepEqual(capture.items[0].mediaCandidates, []);
  assert.equal(BrowserWindow.instances[0].loadedUrls.length, 1);
  const probeScripts = BrowserWindow.instances[0].executedScripts.filter(function(script) {
    return !/itemsById/.test(script) && /7671834569137647601/.test(script);
  });
  assert.equal(probeScripts.length, 1);
});

test('preferred-media detail collection reads the original detail response without running the fetch probe', async () => {
  const contentId = '7671834569137647601';
  const url = `https://www.douyin.com/video/${contentId}`;
  const debuggerMediaUrl = 'https://v3-dy-o.zjcdn.com/video/from-original-response.mp4?token=fresh';
  const debuggerApi = createFakeDebugger({
    aweme_detail: {
      aweme_id: contentId,
      video: {
        play_addr: { url_list: [debuggerMediaUrl], data_size: 4096 }
      }
    }
  });
  let emitted = false;
  const BrowserWindow = createFakeBrowserWindow({
    debuggerApi,
    onLoad() {
      if (emitted) return;
      emitted = true;
      debuggerApi.emit('Network.responseReceived', {
        requestId: 'detail-request-1',
        response: {
          url: `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${contentId}`
        }
      });
      debuggerApi.emit('Network.loadingFinished', { requestId: 'detail-request-1' });
    }
  });
  const manager = createDouyinSessionManager({
    BrowserWindow,
    getParentWindow: () => null,
    pageSettleMs: 0,
    capturePollMs: 1,
    captureReadyTimeoutMs: 50
  });
  const pending = manager.captureUrl(url, { preferMediaUrl: true });
  BrowserWindow.instances[0].webContents.scriptResult = {
    pageType: 'video', pageUrl: url, loggedIn: true,
    profile: { displayName: '模型先生', profileUrl: 'https://www.douyin.com/user/model-mr' },
    items: [{ sourceUrl: url, summary: '页面文字已经加载完成。' }]
  };
  BrowserWindow.instances[0].webContents.mediaProbeResults = [[{
    url: 'https://v9-dy-o.douyinvod.com/video/from-fetch-probe.mp4?token=fresh',
    bytes: 1024,
    source: 'fetch_probe',
    quality: '720p'
  }]];

  const capture = await pending;

  assert.equal(capture.items[0].mediaUrl, debuggerMediaUrl);
  assert.equal(capture.items[0].mediaCandidates[0].source, 'play_addr');
  assert.equal(debuggerApi.bodyReadCount, 1);
  assert.equal(debuggerApi.commands.filter(method => method === 'Network.enable').length, 1);
  assert.equal(BrowserWindow.instances[0].webContents.mediaProbeResults.length, 1);
  assert.equal(debuggerApi.attached, false);
});

test('preferred-media detail collection keeps a matching rendition beyond the first twenty candidates', async () => {
  const contentId = '7668963922510721226';
  const url = `https://www.douyin.com/video/${contentId}`;
  const historicalMediaUrl = 'https://v5-dy-o.zjcdn.com/video/historical-download.mp4?token=fresh';
  const debuggerApi = createFakeDebugger({
    aweme_detail: {
      aweme_id: contentId,
      video: {
        bit_rate: Array.from({ length: 21 }, function(_value, index) {
          return {
            gear_name: `rendition_${index}`,
            play_addr: {
              url_list: [`https://v5-dy-o.zjcdn.com/video/rendition-${index}.mp4?token=fresh`],
              data_size: 1000 + index
            }
          };
        }),
        download_addr: { url_list: [historicalMediaUrl], data_size: 8981332 }
      }
    }
  });
  let emitted = false;
  const BrowserWindow = createFakeBrowserWindow({
    debuggerApi,
    onLoad() {
      if (emitted) return;
      emitted = true;
      debuggerApi.emit('Network.responseReceived', {
        requestId: 'detail-request-many-candidates',
        response: {
          url: `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${contentId}`
        }
      });
      debuggerApi.emit('Network.loadingFinished', { requestId: 'detail-request-many-candidates' });
    }
  });
  const manager = createDouyinSessionManager({
    BrowserWindow,
    getParentWindow: () => null,
    pageSettleMs: 0,
    capturePollMs: 1,
    captureReadyTimeoutMs: 50
  });
  const pending = manager.captureUrl(url, { preferMediaUrl: true });
  BrowserWindow.instances[0].webContents.scriptResult = {
    pageType: 'video', pageUrl: url, loggedIn: true,
    profile: { displayName: '模型先生', profileUrl: 'https://www.douyin.com/user/model-mr' },
    items: [{ sourceUrl: url, summary: '页面文字已经加载完成。' }]
  };

  const capture = await pending;

  assert.equal(capture.items[0].mediaCandidates.length, 22);
  assert.ok(capture.items[0].mediaCandidates.some(function(candidate) {
    return candidate.url === historicalMediaUrl && candidate.bytes === 8981332;
  }));
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

test('complete profile archive merges scroll batches and stops after stable rounds', async () => {
  const BrowserWindow = createFakeBrowserWindow();
  const manager = createDouyinSessionManager({
    BrowserWindow,
    getParentWindow: () => null,
    pageSettleMs: 0,
    archiveScrollSettleMs: 0,
    capturePollMs: 1,
    captureReadyTimeoutMs: 50
  });
  const profileUrl = 'https://www.douyin.com/user/archive-profile';
  const batches = [];
  const first = {
    pageType: 'profile', pageUrl: profileUrl, loggedIn: true,
    profile: { displayName: '模型先生', profileUrl, workCount: 3 },
    items: [
      { sourceUrl: 'https://www.douyin.com/video/7800000000000000001', title: '作品 1' },
      { sourceUrl: 'https://www.douyin.com/video/7800000000000000002', title: '作品 2' }
    ]
  };
  const second = JSON.parse(JSON.stringify(first));
  second.items.push({ sourceUrl: 'https://www.douyin.com/video/7800000000000000003', title: '作品 3' });
  const pending = manager.captureProfileArchive(profileUrl, {
    maxScrolls: 400,
    stableRounds: 2,
    onBatch(capture) { batches.push(capture.items.map(function(item) { return item.contentId; })); }
  });
  BrowserWindow.instances[0].webContents.scriptResults = [first, second, second, second];

  const capture = await pending;

  assert.equal(capture.items.length, 3);
  assert.equal(capture.archive.complete, true);
  assert.equal(capture.archive.visibilityStable, true);
  assert.equal(capture.archive.reportedWorkCount, 3);
  assert.equal(capture.archive.scrollLimit, 400);
  assert.equal(capture.archive.stableRounds, 2);
  assert.ok(BrowserWindow.instances[0].scrollExecutions >= 2);
  assert.ok(BrowserWindow.instances[0].containerScrollExecutions >= 2);
  assert.deepEqual(batches[0], ['7800000000000000001', '7800000000000000002']);
  assert.deepEqual(batches[1], ['7800000000000000003']);
});

test('incomplete profile archive waits beyond ordinary stable rounds when reported work is still missing', async () => {
  const BrowserWindow = createFakeBrowserWindow();
  const manager = createDouyinSessionManager({
    BrowserWindow,
    getParentWindow: () => null,
    pageSettleMs: 0,
    archiveScrollSettleMs: 0,
    capturePollMs: 1,
    captureReadyTimeoutMs: 50
  });
  const profileUrl = 'https://www.douyin.com/user/archive-profile';
  const incomplete = {
    pageType: 'profile', pageUrl: profileUrl, loggedIn: true,
    profile: { displayName: '模型先生', profileUrl, workCount: 5 },
    items: [{ sourceUrl: 'https://www.douyin.com/video/7800000000000000001', title: '作品 1' }]
  };
  const firstWithoutReportedCount = JSON.parse(JSON.stringify(incomplete));
  firstWithoutReportedCount.profile.workCount = 0;
  const pending = manager.captureProfileArchive(profileUrl, {
    maxScrolls: 4,
    stableRounds: 3
  });
  BrowserWindow.instances[0].webContents.scriptResults = [firstWithoutReportedCount, incomplete, incomplete, incomplete, incomplete];

  const capture = await pending;

  assert.equal(capture.archive.complete, false);
  assert.equal(capture.archive.scrollCount, 4);
  assert.equal(capture.archive.incompleteStableRounds, 12);
  assert.equal(capture.archive.stoppedReason, 'scroll_limit');
});

test('incomplete profile archive caps the requested incomplete stable rounds', async () => {
  const BrowserWindow = createFakeBrowserWindow();
  const manager = createDouyinSessionManager({
    BrowserWindow,
    getParentWindow: () => null,
    pageSettleMs: 0,
    archiveScrollSettleMs: 0,
    capturePollMs: 1,
    captureReadyTimeoutMs: 50
  });
  const profileUrl = 'https://www.douyin.com/user/archive-profile';
  const incomplete = {
    pageType: 'profile', pageUrl: profileUrl, loggedIn: true,
    profile: { displayName: '模型先生', profileUrl, workCount: 2 },
    items: [{ sourceUrl: 'https://www.douyin.com/video/7800000000000000001', title: '作品 1' }]
  };
  const pending = manager.captureProfileArchive(profileUrl, {
    maxScrolls: 1,
    stableRounds: 3,
    incompleteStableRounds: 999
  });
  BrowserWindow.instances[0].webContents.scriptResults = [incomplete, incomplete];

  const capture = await pending;

  assert.equal(capture.archive.incompleteStableRounds, 60);
  assert.equal(capture.archive.scrollLimit, 1);
});

test('complete profile archive reloads after the first logged-in snapshot stays blank', async () => {
  const profileUrl = 'https://www.douyin.com/user/archive-profile';
  const blank = {
    pageType: 'profile', pageUrl: profileUrl, loggedIn: true,
    profile: { displayName: '模型先生', profileUrl }, items: []
  };
  const ready = {
    pageType: 'profile', pageUrl: profileUrl, loggedIn: true,
    profile: { displayName: '模型先生', profileUrl, workCount: 1 },
    items: [{ sourceUrl: 'https://www.douyin.com/video/7800000000000000001', title: '作品 1' }]
  };
  const BrowserWindow = createFakeBrowserWindow({
    onLoad(instance) {
      instance.webContents.scriptResult = instance.loadedUrls.length === 1 ? blank : ready;
    }
  });
  const manager = createDouyinSessionManager({
    BrowserWindow,
    getParentWindow: () => null,
    pageSettleMs: 0,
    archiveScrollSettleMs: 0,
    capturePollMs: 1,
    captureReadyTimeoutMs: 5,
    captureReloadAttempts: 1,
    captureRetryDelayMs: 0
  });

  const capture = await manager.captureProfileArchive(profileUrl, { maxScrolls: 1, stableRounds: 1 });

  assert.equal(BrowserWindow.instances[0].loadedUrls.length, 2);
  assert.equal(capture.items.length, 1);
});

test('complete profile archive returns a logged-out snapshot without reloading', async () => {
  const profileUrl = 'https://www.douyin.com/user/archive-profile';
  const BrowserWindow = createFakeBrowserWindow({
    onLoad(instance) {
      instance.webContents.scriptResult = {
        pageType: 'profile', pageUrl: profileUrl, loggedIn: false,
        profile: {}, items: []
      };
    }
  });
  const manager = createDouyinSessionManager({
    BrowserWindow,
    getParentWindow: () => null,
    pageSettleMs: 0,
    capturePollMs: 1,
    captureReadyTimeoutMs: 5,
    captureReloadAttempts: 2,
    captureRetryDelayMs: 0
  });

  const capture = await manager.captureProfileArchive(profileUrl, { maxScrolls: 1, stableRounds: 1 });

  assert.equal(capture.loggedIn, false);
  assert.equal(BrowserWindow.instances[0].loadedUrls.length, 1);
});
