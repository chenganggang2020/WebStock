const {
  isAllowedDouyinUrl,
  parseDouyinItemUrl,
  normalizeDouyinPageSnapshot,
  buildDouyinPageSnapshotScript,
  buildDouyinMediaProbeScript,
  extractDouyinMediaCandidates
} = require('./douyinPageCapture');

const PAUSE_MEDIA_SCRIPT = `(function() {
  document.querySelectorAll('video, audio').forEach(function(media) {
    media.muted = true;
    media.pause();
  });
  return true;
})()`;

const SCROLL_PROFILE_SCRIPT = `(function() {
  const scrollableContainers = [];
  function addCandidate(element) {
    if (!element || scrollableContainers.includes(element)) return;
    if (Number(element.scrollHeight || 0) <= Number(element.clientHeight || 0) + 1) return;
    scrollableContainers.push(element);
  }
  const postList = document.querySelector('[data-e2e="user-post-list"]');
  let ancestor = postList;
  while (ancestor) {
    addCandidate(ancestor);
    ancestor = ancestor.parentElement;
  }
  [document.scrollingElement, document.documentElement, document.body].forEach(addCandidate);
  document.querySelectorAll('main, [role="main"], [data-e2e*="scroll"], [class*="scroll"]').forEach(addCandidate);
  scrollableContainers.forEach(function(element) {
    const style = window.getComputedStyle(element);
    const isDocumentScroller = element === document.scrollingElement || element === document.documentElement || element === document.body;
    if (!isDocumentScroller && !/(auto|scroll|overlay)/i.test(String(style.overflowY || ''))) return;
    if (typeof element.scrollTo === 'function') {
      element.scrollTo({ top: element.scrollHeight, behavior: 'instant' });
    } else {
      element.scrollTop = element.scrollHeight;
    }
  });
  window.scrollTo({ top: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight), behavior: 'instant' });
  document.querySelectorAll('video, audio').forEach(function(media) {
    media.muted = true;
    media.pause();
  });
  return { scrollableContainers: scrollableContainers.length };
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
  const archiveScrollSettleMs = options.archiveScrollSettleMs == null
    ? 1500 : Math.max(Number(options.archiveScrollSettleMs) || 0, 0);
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

  function sanitizeMediaCandidates(input) {
    const candidates = Array.isArray(input) ? input : [];
    return candidates.map(function(candidate) {
      try {
        const source = candidate && typeof candidate === 'object' ? candidate : { url: candidate };
        const parsed = new URL(String(source.url || ''));
        if (parsed.protocol !== 'https:') return null;
        return {
          url: parsed.href.slice(0, 4000),
          bytes: Math.max(Number(source.bytes) || 0, 0),
          source: String(source.source || '').slice(0, 80),
          quality: String(source.quality || '').slice(0, 80)
        };
      } catch (error) {
        return null;
      }
    }).filter(Boolean).filter(function(value, index, values) {
      return values.findIndex(function(item) { return item.url === value.url; }) === index;
    }).slice(0, 100);
  }

  async function startDetailResponseCapture(current, expectedItem) {
    const unavailable = {
      available: false,
      getCandidates: function() { return []; },
      flush: async function() {},
      stop: async function() {}
    };
    const debug = current && current.webContents && current.webContents.debugger;
    if (!expectedItem || !debug || typeof debug.attach !== 'function' ||
        typeof debug.sendCommand !== 'function' || typeof debug.on !== 'function') {
      return unavailable;
    }

    let attachedByUs = false;
    let listenerInstalled = false;
    const matchingRequests = new Set();
    const processedRequests = new Set();
    const pending = new Set();
    let candidates = [];

    function matchesDetailUrl(value) {
      try {
        const parsed = new URL(String(value || ''));
        return parsed.protocol === 'https:' && parsed.hostname === 'www.douyin.com' &&
          /^\/aweme\/v1\/web\/aweme\/detail\/?$/.test(parsed.pathname) &&
          parsed.searchParams.get('aweme_id') === expectedItem.contentId;
      } catch (error) {
        return false;
      }
    }

    function track(task) {
      pending.add(task);
      task.finally(function() { pending.delete(task); });
    }

    function onDebuggerMessage(_event, method, params = {}) {
      if (method === 'Network.responseReceived') {
        if (params.requestId && params.response && matchesDetailUrl(params.response.url)) {
          matchingRequests.add(params.requestId);
        }
        return;
      }
      if (method !== 'Network.loadingFinished' || !matchingRequests.has(params.requestId) ||
          processedRequests.has(params.requestId)) return;
      processedRequests.add(params.requestId);
      const task = Promise.resolve().then(async function() {
        const response = await debug.sendCommand('Network.getResponseBody', { requestId: params.requestId });
        const body = response && response.base64Encoded
          ? Buffer.from(String(response.body || ''), 'base64').toString('utf8')
          : String(response && response.body || '');
        const payload = JSON.parse(body);
        candidates = sanitizeMediaCandidates(extractDouyinMediaCandidates(payload, expectedItem.contentId));
      }).catch(function(error) {
        log('Failed to read original Douyin detail response', error);
      });
      track(task);
    }

    async function cleanup() {
      if (listenerInstalled) {
        try {
          if (typeof debug.removeListener === 'function') debug.removeListener('message', onDebuggerMessage);
          else if (typeof debug.off === 'function') debug.off('message', onDebuggerMessage);
        } catch (error) {
          log('Failed to remove Douyin detail debugger listener', error);
        }
        listenerInstalled = false;
      }
      if (pending.size) await Promise.allSettled(Array.from(pending));
      if (attachedByUs && typeof debug.detach === 'function') {
        try { debug.detach(); } catch (error) { log('Failed to detach Douyin detail debugger', error); }
        attachedByUs = false;
      }
    }

    try {
      const alreadyAttached = typeof debug.isAttached === 'function' && debug.isAttached();
      if (!alreadyAttached) {
        debug.attach('1.3');
        attachedByUs = true;
      }
      debug.on('message', onDebuggerMessage);
      listenerInstalled = true;
      await debug.sendCommand('Network.enable');
      return {
        available: true,
        getCandidates: function() { return candidates.slice(); },
        flush: async function() {
          if (pending.size) await Promise.allSettled(Array.from(pending));
        },
        stop: cleanup
      };
    } catch (error) {
      log('Douyin debugger unavailable; using the page media probe', error);
      await cleanup();
      return unavailable;
    }
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

  async function captureUrl(url, captureOptions = {}) {
    const preferMediaUrl = Boolean(captureOptions && captureOptions.preferMediaUrl === true);
    const target = String(url || '');
    if (!isAllowedDouyinUrl(target)) throw new Error('只能自动采集抖音 HTTPS 页面');
    const current = automationWindow && !automationWindow.isDestroyed()
      ? automationWindow : createWindow('background');
    automationWindow = current;
    if (typeof current.hide === 'function') current.hide();
    const expectedItem = parseDouyinItemUrl(target);
    let capture = null;
    let lastUsefulCapture = null;
    const responseCapture = preferMediaUrl && expectedItem
      ? await startDetailResponseCapture(current, expectedItem)
      : { available: false, getCandidates: function() { return []; }, flush: async function() {}, stop: async function() {} };
    try {
      for (let attempt = 0; attempt <= captureReloadAttempts; attempt += 1) {
        await loadPage(current, target, pageSettleMs);
        const deadline = Date.now() + captureReadyTimeoutMs;
        let mediaProbeAttempted = false;
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
              if (preferMediaUrl && !detail.mediaUrl) {
                lastUsefulCapture = capture;
                let probed = [];
                if (responseCapture.available) {
                  await responseCapture.flush();
                  probed = responseCapture.getCandidates();
                } else if (!mediaProbeAttempted) {
                  mediaProbeAttempted = true;
                  try {
                    const rawCandidates = typeof buildDouyinMediaProbeScript === 'function'
                      ? await current.webContents.executeJavaScript(buildDouyinMediaProbeScript(expectedItem.contentId), true)
                      : [];
                    const candidateInput = Array.isArray(rawCandidates) ? rawCandidates
                      : rawCandidates && Array.isArray(rawCandidates.mediaCandidates) ? rawCandidates.mediaCandidates : [];
                    probed = sanitizeMediaCandidates(candidateInput);
                  } catch (error) {
                    log('Failed to probe Douyin detail media candidates', error);
                  }
                }
                detail.mediaCandidates = probed;
                if (probed.length) {
                  detail.mediaUrl = probed[0].url;
                  await pauseMedia(current);
                  return capture;
                }
              } else {
                await pauseMedia(current);
                return capture;
              }
            }
          } else if (capture.pageType === 'profile' && capture.profile.profileUrl && capture.profile.displayName && capture.items.length) {
            await pauseMedia(current);
            return capture;
          }
          if (Date.now() < deadline) await wait(capturePollMs);
        } while (Date.now() < deadline);
        if (preferMediaUrl && lastUsefulCapture) {
          if (responseCapture.available) {
            await responseCapture.flush();
            const detail = lastUsefulCapture.items.find(function(item) { return item.contentId === expectedItem.contentId; });
            const candidates = responseCapture.getCandidates();
            if (detail) {
              detail.mediaCandidates = candidates;
              if (candidates.length) detail.mediaUrl = candidates[0].url;
            }
          }
          await pauseMedia(current);
          return lastUsefulCapture;
        }
        if (attempt < captureReloadAttempts && captureRetryDelayMs) await wait(captureRetryDelayMs);
      }
      await pauseMedia(current);
      if (capture && capture.loadError) throw new Error('抖音页面暂时服务异常，已自动重试');
      throw new Error(expectedItem ? '抖音视频详情尚未加载完成' : '抖音主页尚未加载出作品列表');
    } finally {
      await responseCapture.stop();
    }
  }

  async function captureProfileArchive(url, archiveOptions = {}) {
    const target = String(url || '');
    if (!isAllowedDouyinUrl(target) || parseDouyinItemUrl(target)) {
      throw new Error('完整存档只能从抖音创作者主页开始');
    }
    const maxScrolls = Math.min(Math.max(Number(archiveOptions.maxScrolls) || 60, 1), 400);
    const stableTarget = Math.min(Math.max(Number(archiveOptions.stableRounds) || 3, 1), 10);
    const incompleteStableTarget = Math.min(Math.max(
      Number(archiveOptions.incompleteStableRounds) || 12,
      stableTarget
    ), 60);
    const onBatch = typeof archiveOptions.onBatch === 'function' ? archiveOptions.onBatch : null;
    const current = automationWindow && !automationWindow.isDestroyed()
      ? automationWindow : createWindow('background');
    automationWindow = current;
    if (typeof current.hide === 'function') current.hide();
    let first = null;
    for (let attempt = 0; attempt <= captureReloadAttempts; attempt += 1) {
      await loadPage(current, target, pageSettleMs);
      const deadline = Date.now() + captureReadyTimeoutMs;
      do {
        first = normalizeDouyinPageSnapshot(
          await current.webContents.executeJavaScript(buildDouyinPageSnapshotScript(), true)
        );
        if (!first.loggedIn) {
          await pauseMedia(current);
          return first;
        }
        if (first.pageType === 'profile' && first.profile.profileUrl && first.profile.displayName && first.items.length) break;
        if (Date.now() < deadline) await wait(capturePollMs);
      } while (Date.now() < deadline);
      if (first && first.pageType === 'profile' && first.profile.profileUrl && first.profile.displayName && first.items.length) break;
      if (attempt < captureReloadAttempts && captureRetryDelayMs) await wait(captureRetryDelayMs);
    }
    if (!first || first.pageType !== 'profile' || !first.items.length) {
      await pauseMedia(current);
      throw new Error('抖音主页尚未加载出作品列表');
    }

    const merged = new Map();
    first.items.forEach(function(item) { if (item.contentId) merged.set(String(item.contentId), item); });
    let reportedWorkCount = Math.max(Number(first.profile && first.profile.workCount || 0), 0);
    function requiredStableRounds() {
      return reportedWorkCount && merged.size < reportedWorkCount ? incompleteStableTarget : stableTarget;
    }
    let stable = 0;
    let scrollCount = 0;
    let latest = first;
    if (onBatch) {
      await onBatch(Object.assign({}, first, {
        items: first.items.slice(),
        archive: { scrollCount: 0, stableRounds: 0, discoveredCount: merged.size, scrollLimit: maxScrolls }
      }));
    }
    while (scrollCount < maxScrolls && stable < requiredStableRounds()) {
      const before = merged.size;
      await current.webContents.executeJavaScript(SCROLL_PROFILE_SCRIPT, true);
      if (archiveScrollSettleMs) await wait(archiveScrollSettleMs);
      const next = normalizeDouyinPageSnapshot(
        await current.webContents.executeJavaScript(buildDouyinPageSnapshotScript(), true)
      );
      if (!next.loggedIn) break;
      if (next.profile && next.profile.profileUrl) {
        latest = next;
        reportedWorkCount = Math.max(reportedWorkCount, Number(next.profile.workCount) || 0);
      }
      const newlyDiscovered = [];
      next.items.forEach(function(item) {
        if (!item.contentId) return;
        const key = String(item.contentId);
        if (!merged.has(key)) newlyDiscovered.push(item);
        merged.set(key, Object.assign({}, merged.get(key) || {}, item));
      });
      scrollCount += 1;
      stable = merged.size === before ? stable + 1 : 0;
      if (onBatch) {
        await onBatch(Object.assign({}, next, {
          items: newlyDiscovered,
          archive: { scrollCount, stableRounds: stable, discoveredCount: merged.size, scrollLimit: maxScrolls }
        }));
      }
    }
    await pauseMedia(current);
    const visibilityStable = stable >= requiredStableRounds();
    const coverageComplete = visibilityStable && (!reportedWorkCount || merged.size >= reportedWorkCount);
    return Object.assign({}, latest, {
      pageUrl: first.pageUrl,
      pageType: 'profile',
      loggedIn: true,
      profile: Object.assign({}, first.profile, latest.profile || {}),
      items: Array.from(merged.values()),
      archive: {
        complete: coverageComplete,
        visibilityStable,
        reportedWorkCount,
        discoveredCount: merged.size,
        scrollCount,
        scrollLimit: maxScrolls,
        stableRounds: stable,
        incompleteStableRounds: incompleteStableTarget,
        stoppedReason: visibilityStable ? (coverageComplete ? 'reported_count_reached' : 'visible_page_stable') : 'scroll_limit'
      }
    });
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

  return { open, collect, captureUrl, captureProfileArchive, status, dispose };
}

module.exports = { createDouyinSessionManager };
