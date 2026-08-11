const {
  isAllowedDouyinUrl,
  parseDouyinItemUrl,
  normalizeDouyinPageSnapshot,
  buildDouyinPageSnapshotScript
} = require('./douyinPageCapture');

const PAUSE_MEDIA_SCRIPT = `(function() {
  document.querySelectorAll('video, audio').forEach(function(media) {
    media.muted = true;
    media.pause();
  });
  return true;
})()`;

function createDouyinSessionManager(options = {}) {
  const BrowserWindow = options.BrowserWindow;
  if (typeof BrowserWindow !== 'function') throw new Error('缺少 Electron BrowserWindow');
  const getParentWindow = typeof options.getParentWindow === 'function' ? options.getParentWindow : () => null;
  const log = typeof options.log === 'function' ? options.log : () => {};
  const loadTimeoutMs = Number(options.loadTimeoutMs) > 0 ? Number(options.loadTimeoutMs) : 15000;
  const pageSettleMs = options.pageSettleMs == null ? 2500 : Math.max(Number(options.pageSettleMs) || 0, 0);
  const capturePollMs = options.capturePollMs == null ? 1000 : Math.max(Number(options.capturePollMs) || 1, 1);
  const captureReadyTimeoutMs = options.captureReadyTimeoutMs == null
    ? 25000 : Math.max(Number(options.captureReadyTimeoutMs) || 1, 1);
  const captureReloadAttempts = Math.min(Math.max(Number(options.captureReloadAttempts) || 2, 0), 5);
  const captureRetryDelayMs = options.captureRetryDelayMs == null
    ? 3000 : Math.max(Number(options.captureRetryDelayMs) || 0, 0);
  let window = null;
  let automationWindow = null;

  function activeWindow() {
    return window && !window.isDestroyed() ? window : null;
  }

  function status() {
    const current = activeWindow();
    return {
      supported: true,
      windowOpen: Boolean(current),
      currentUrl: current ? String(current.webContents.getURL() || '') : '',
      backgroundActive: Boolean(automationWindow && !automationWindow.isDestroyed())
    };
  }

  function denyExternalNavigation(event, url) {
    if (isAllowedDouyinUrl(url)) return;
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
  }

  function createWindow(kind) {
    const parent = getParentWindow();
    const config = {
      width: 1240,
      height: 860,
      minWidth: 900,
      minHeight: 640,
      title: kind === 'background' ? 'WebStock · 抖音后台同步' : 'WebStock · 抖音登录与公开页面同步',
      backgroundColor: '#ffffff',
      show: false,
      webPreferences: {
        partition: 'persist:webstock-douyin',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    };
    if (parent && kind !== 'background') config.parent = parent;
    if (options.iconPath) config.icon = options.iconPath;
    const created = new BrowserWindow(config);
    if (typeof created.webContents.setAudioMuted === 'function') {
      created.webContents.setAudioMuted(true);
    }
    created.webContents.session.setPermissionRequestHandler(function(_contents, _permission, callback) {
      callback(false);
    });
    created.webContents.setWindowOpenHandler(function(details) {
      if (isAllowedDouyinUrl(details.url)) {
        created.loadURL(details.url).catch(function(error) {
          log('Failed to follow Douyin popup navigation', error);
        });
      }
      return { action: 'deny' };
    });
    created.webContents.on('will-navigate', denyExternalNavigation);
    created.webContents.on('will-redirect', denyExternalNavigation);
    created.on('closed', function() {
      if (window === created) window = null;
      if (automationWindow === created) automationWindow = null;
    });
    return created;
  }

  function wait(milliseconds) {
    return new Promise(function(resolve) { setTimeout(resolve, milliseconds); });
  }

  async function pauseMedia(current) {
    if (!current || current.isDestroyed()) return;
    if (typeof current.webContents.setAudioMuted === 'function') {
      current.webContents.setAudioMuted(true);
    }
    try {
      await current.webContents.executeJavaScript(PAUSE_MEDIA_SCRIPT, true);
    } catch (error) {
      log('Failed to pause Douyin background media', error);
    }
  }

  async function loadPage(current, target, settleMs) {
    const loadPromise = Promise.resolve().then(function() { return current.loadURL(target); });
    let timer = null;
    let loadState;
    try {
      loadState = await Promise.race([
        loadPromise.then(function() { return 'loaded'; }),
        new Promise(function(resolve) {
          timer = setTimeout(function() { resolve('loading'); }, loadTimeoutMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (loadState === 'loading') {
      loadPromise.catch(function(error) { log('Douyin page failed after yielding control', error); });
    }
    if (settleMs) await wait(settleMs);
    return loadState;
  }

  async function open(url) {
    const target = String(url || 'https://www.douyin.com/');
    if (!isAllowedDouyinUrl(target)) throw new Error('只能在登录窗口中打开抖音 HTTPS 页面');
    const current = activeWindow() || createWindow('user');
    window = current;
    current.show();
    current.focus();
    const loadState = await loadPage(current, target, 0);
    return Object.assign(status(), { loading: loadState === 'loading' });
  }

  async function collect() {
    const current = activeWindow();
    if (!current) throw new Error('抖音登录窗口尚未打开');
    const currentUrl = current.webContents.getURL();
    if (!isAllowedDouyinUrl(currentUrl)) throw new Error('当前窗口不是可采集的抖音页面');
    const raw = await current.webContents.executeJavaScript(buildDouyinPageSnapshotScript(), true);
    return normalizeDouyinPageSnapshot(raw);
  }

  async function captureUrl(url) {
    const target = String(url || '');
    if (!isAllowedDouyinUrl(target)) throw new Error('只能自动采集抖音 HTTPS 页面');
    const current = automationWindow && !automationWindow.isDestroyed()
      ? automationWindow : createWindow('background');
    automationWindow = current;
    if (typeof current.hide === 'function') current.hide();
    const expectedItem = parseDouyinItemUrl(target);
    let capture = null;
    for (let attempt = 0; attempt <= captureReloadAttempts; attempt += 1) {
      await loadPage(current, target, pageSettleMs);
      const deadline = Date.now() + captureReadyTimeoutMs;
      do {
        const raw = await current.webContents.executeJavaScript(buildDouyinPageSnapshotScript(), true);
        capture = normalizeDouyinPageSnapshot(raw);
        if (!capture.loggedIn) {
          await pauseMedia(current);
          return capture;
        }
        if (capture.loadError) break;
        if (expectedItem) {
          const detail = capture.items.find(function(item) { return item.contentId === expectedItem.contentId; });
          const hasUsefulDetail = detail && (detail.description || detail.transcript || detail.summary || detail.mediaUrl || detail.publishedAt ||
            Object.keys(detail.engagement || {}).length);
          if (capture.profile.profileUrl && hasUsefulDetail) {
            await pauseMedia(current);
            return capture;
          }
        } else if (capture.pageType === 'profile' && capture.profile.profileUrl && capture.profile.displayName && capture.items.length) {
          await pauseMedia(current);
          return capture;
        }
        if (Date.now() < deadline) await wait(capturePollMs);
      } while (Date.now() < deadline);
      if (attempt < captureReloadAttempts && captureRetryDelayMs) await wait(captureRetryDelayMs);
    }
    await pauseMedia(current);
    if (capture && capture.loadError) throw new Error('抖音页面暂时服务异常，已自动重试');
    throw new Error(expectedItem ? '抖音视频详情尚未加载完成' : '抖音主页尚未加载出作品列表');
  }

  function dispose() {
    const current = activeWindow();
    if (current && typeof current.close === 'function') current.close();
    if (automationWindow && !automationWindow.isDestroyed() && typeof automationWindow.close === 'function') {
      automationWindow.close();
    }
    window = null;
    automationWindow = null;
  }

  return { open, collect, captureUrl, status, dispose };
}

module.exports = { createDouyinSessionManager };
