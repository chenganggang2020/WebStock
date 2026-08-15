(function() {
  const SNAPSHOT_SCHEMA = 'webstock.mobile-snapshot/v1';
  const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
  const DB_NAME = 'webstock-mobile';
  const STORE_NAME = 'snapshots';
  let currentSnapshot = null;
  let selectedAccountId = Number(localStorage.getItem('webstock_mobile_account') || 0);
  let pushSubscription = null;
  let quoteTimer = null;
  let quoteRunning = null;
  let quoteSignature = '';
  let fullSnapshotTimer = null;
  const QUOTE_HEARTBEAT_MS = 1000;
  const FULL_SNAPSHOT_REFRESH_MS = 60000;

  function element(id) { return document.getElementById(id); }

  function setConnection(mode, message, timestamp) {
    const dot = element('mobileConnectionDot');
    if (dot) dot.className = 'connection-dot ' + (mode || '');
    if (element('mobileConnectionText')) element('mobileConnectionText').textContent = message || '';
    if (element('mobileSnapshotTime')) element('mobileSnapshotTime').textContent = timestamp || '';
  }

  function formatTime(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).format(date) + ' 北京时间';
  }

  function validSnapshot(value) {
    return value && value.schema === SNAPSHOT_SCHEMA && Array.isArray(value.accounts);
  }

  function openStore() {
    return new Promise(function(resolve, reject) {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = function() {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = function() { resolve(request.result); };
      request.onerror = function() { reject(request.error); };
    });
  }

  async function saveSnapshot(snapshot) {
    const json = JSON.stringify(snapshot);
    if (!validSnapshot(snapshot) || new Blob([json]).size > MAX_SNAPSHOT_BYTES) return;
    const db = await openStore();
    await new Promise(function(resolve, reject) {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(snapshot, 'latest');
      tx.oncomplete = resolve;
      tx.onerror = function() { reject(tx.error); };
    });
    db.close();
  }

  async function loadSavedSnapshot() {
    const db = await openStore();
    const result = await new Promise(function(resolve, reject) {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get('latest');
      request.onsuccess = function() { resolve(request.result || null); };
      request.onerror = function() { reject(request.error); };
    });
    db.close();
    return validSnapshot(result) ? result : null;
  }

  function render(snapshot, sourceMode) {
    currentSnapshot = snapshot;
    const accounts = snapshot.accounts || [];
    if (!selectedAccountId || !accounts.some(item => Number(item.id) === selectedAccountId)) {
      const preferred = accounts.find(item => item.isDefault) || accounts[0];
      selectedAccountId = preferred ? Number(preferred.id) : 0;
    }
    element('mobileSnapshotRoot').innerHTML = window.WebStockMobileView.renderSnapshot(snapshot, selectedAccountId);
    setConnection(sourceMode === 'saved' ? 'offline' : 'online', sourceMode === 'saved' ? '离线快照' : '已连接 Windows 主机', formatTime(snapshot.generatedAt));
  }

  function snapshotCodes(snapshot) {
    const positions = (snapshot.accounts || []).flatMap(function(account) { return account.positions || []; });
    const watchlist = snapshot.watchlist && snapshot.watchlist.items || [];
    return Array.from(new Set(positions.concat(watchlist).map(function(item) {
      return String(item && item.code || '').trim();
    }).filter(function(code) { return /^\d{6}$/.test(code); }))).slice(0, 200);
  }

  function mergeQuoteSnapshot(quotes, meta) {
    const model = window.QuoteSnapshotClientModel;
    if (!currentSnapshot || !model) return false;
    const nextSignature = model.signature(quotes);
    if (nextSignature === quoteSignature) return false;
    quoteSignature = nextSignature;
    currentSnapshot.accounts = (currentSnapshot.accounts || []).map(function(account) {
      const positions = model.applyPositionQuotes(account.positions || [], quotes);
      return Object.assign({}, account, {
        positions,
        summary: model.summarizePortfolio(account.summary || {}, positions),
        observedAt: meta && meta.fetchedAt || account.observedAt,
        valuationStatus: meta && meta.stale ? 'stale' : account.valuationStatus
      });
    });
    if (currentSnapshot.watchlist) {
      const normalized = (currentSnapshot.watchlist.items || []).map(function(item) {
        return Object.assign({ price: item.currentPrice }, item);
      });
      currentSnapshot.watchlist.items = model.applyWatchlistQuotes(normalized, quotes).map(function(item) {
        return Object.assign({}, item, { currentPrice: item.price });
      });
      if (currentSnapshot.watchlist.observation) {
        currentSnapshot.watchlist.observation.observedAt = meta && meta.fetchedAt || currentSnapshot.watchlist.observation.observedAt;
      }
    }
    window.WebStockMobileView.patchQuotes(element('mobileSnapshotRoot'), currentSnapshot, selectedAccountId);
    return true;
  }

  async function refreshQuoteSnapshot() {
    if (quoteRunning) return quoteRunning;
    if (!currentSnapshot || document.hidden || !navigator.onLine) return { skipped: true };
    const codes = snapshotCodes(currentSnapshot);
    if (!codes.length) return { skipped: true };
    quoteRunning = fetch('/api/quote/snapshot?codes=' + encodeURIComponent(codes.join(',')), {
      credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }
    }).then(async function(response) {
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || '行情快照不可用');
      const quotes = Array.isArray(payload.data) ? payload.data : [];
      const meta = payload.meta || {};
      mergeQuoteSnapshot(quotes, meta);
      const label = meta.stale ? '行情源波动，保留最近有效值' : '本机行情快照 · 每秒检查';
      setConnection(meta.stale ? 'offline' : 'online', label, formatTime(meta.fetchedAt || currentSnapshot.generatedAt));
      return { ok: true, meta };
    }).catch(function(error) {
      setConnection('offline', '行情检查暂时失败，页面将自动重试', currentSnapshot ? formatTime(currentSnapshot.generatedAt) : '');
      return { ok: false, error };
    }).finally(function() {
      quoteRunning = null;
    });
    return quoteRunning;
  }

  function scheduleQuoteHeartbeat() {
    if (quoteTimer) clearTimeout(quoteTimer);
    quoteTimer = null;
    if (document.hidden || !navigator.onLine) return;
    quoteTimer = setTimeout(function run() {
      quoteTimer = null;
      refreshQuoteSnapshot().finally(scheduleQuoteHeartbeat);
    }, QUOTE_HEARTBEAT_MS);
  }

  function scheduleFullSnapshotRefresh() {
    if (fullSnapshotTimer) clearTimeout(fullSnapshotTimer);
    fullSnapshotTimer = null;
    if (document.hidden || !navigator.onLine) return;
    fullSnapshotTimer = setTimeout(function() {
      fullSnapshotTimer = null;
      refreshSnapshot().finally(scheduleFullSnapshotRefresh);
    }, FULL_SNAPSHOT_REFRESH_MS);
  }

  async function refreshSnapshot(options) {
    const manual = options && options.manual;
    if (manual) setConnection('', '正在刷新', '');
    try {
      const response = await fetch('/api/mobile/snapshot', {
        credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error(response.status === 401 ? '设备尚未配对' : '主机暂不可用');
      const payload = await response.json();
      if (!payload.success || !validSnapshot(payload.data)) throw new Error(payload.error || '快照格式无效');
      render(payload.data, 'live');
      quoteSignature = '';
      await saveSnapshot(payload.data);
    } catch (error) {
      if (currentSnapshot) {
        setConnection('offline', '主机暂不可用，显示离线快照', formatTime(currentSnapshot.generatedAt));
        return;
      }
      const saved = await loadSavedSnapshot().catch(function() { return null; });
      if (saved) render(saved, 'saved');
      else {
        setConnection('offline', error.message || '无法连接 Windows 主机', '');
        element('mobileSnapshotRoot').innerHTML = '<div class="mobile-error">请确认 Windows WebStock 和 Tailscale 正在运行</div>';
      }
    }
  }

  function bindAccountSwitch() {
    element('mobileSnapshotRoot').addEventListener('click', function(event) {
      const button = event.target.closest('[data-account-id]');
      if (!button || !currentSnapshot) return;
      selectedAccountId = Number(button.getAttribute('data-account-id'));
      localStorage.setItem('webstock_mobile_account', String(selectedAccountId));
      render(currentSnapshot, navigator.onLine ? 'live' : 'saved');
    });
  }

  function configureInstallBanner() {
    const standalone = isStandalone();
    const dismissed = sessionStorage.getItem('webstock_ios_install_dismissed') === '1';
    element('installBanner').hidden = standalone || dismissed;
    element('dismissInstallBtn').addEventListener('click', function() {
      sessionStorage.setItem('webstock_ios_install_dismissed', '1');
      element('installBanner').hidden = true;
    });
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function base64UrlBytes(value) {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const binary = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, function(character) { return character.charCodeAt(0); });
  }

  async function pushJson(path, options) {
    const response = await fetch(path, {
      method: options && options.method || 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: options && options.body ? JSON.stringify(options.body) : undefined
    });
    const payload = await response.json();
    if (!response.ok || !payload.success) throw new Error(payload.error || '通知服务暂不可用');
    return payload.data;
  }

  function renderPushButton() {
    const button = element('enablePushBtn');
    if (!button) return;
    const standalone = isStandalone();
    const supported = standalone && window.isSecureContext && 'PushManager' in window && 'Notification' in window && 'serviceWorker' in navigator;
    button.hidden = !supported;
    if (!supported) return;
    button.textContent = pushSubscription ? '关闭重要变化通知' : '开启重要变化通知';
  }

  async function loadPushState() {
    if (!isStandalone() || !window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      renderPushButton();
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    pushSubscription = await registration.pushManager.getSubscription();
    renderPushButton();
  }

  async function togglePush() {
    const button = element('enablePushBtn');
    button.disabled = true;
    try {
      const registration = await navigator.serviceWorker.ready;
      pushSubscription = await registration.pushManager.getSubscription();
      if (pushSubscription) {
        const endpoint = pushSubscription.endpoint;
        await pushSubscription.unsubscribe();
        await pushJson('/api/mobile/push/subscription', { method: 'DELETE', body: { endpoint } });
        pushSubscription = null;
      } else {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') throw new Error('通知权限未开启');
        const status = await pushJson('/api/mobile/push/status');
        pushSubscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlBytes(status.publicKey)
        });
        await pushJson('/api/mobile/push/subscription', {
          method: 'POST', body: { subscription: pushSubscription.toJSON() }
        });
        await pushJson('/api/mobile/push/test', {
          method: 'POST', body: { endpoint: pushSubscription.endpoint }
        });
      }
      renderPushButton();
    } catch (error) {
      setConnection('offline', error.message || '通知设置失败', currentSnapshot ? formatTime(currentSnapshot.generatedAt) : '');
    } finally {
      button.disabled = false;
    }
  }

  async function start() {
    configureInstallBanner();
    bindAccountSwitch();
    element('refreshMobileBtn').addEventListener('click', function() { refreshSnapshot({ manual: true }); });
    element('enablePushBtn').addEventListener('click', togglePush);
    window.addEventListener('online', function() {
      refreshSnapshot().finally(function() {
        scheduleQuoteHeartbeat();
        scheduleFullSnapshotRefresh();
      });
    });
    window.addEventListener('offline', function() {
      if (quoteTimer) clearTimeout(quoteTimer);
      if (fullSnapshotTimer) clearTimeout(fullSnapshotTimer);
      if (currentSnapshot) setConnection('offline', '网络已断开，显示离线快照', formatTime(currentSnapshot.generatedAt));
    });
    document.addEventListener('visibilitychange', function() {
      if (document.hidden) {
        if (quoteTimer) clearTimeout(quoteTimer);
        if (fullSnapshotTimer) clearTimeout(fullSnapshotTimer);
        return;
      }
      refreshQuoteSnapshot().finally(function() {
        scheduleQuoteHeartbeat();
        scheduleFullSnapshotRefresh();
      });
    });
    const saved = await loadSavedSnapshot().catch(function() { return null; });
    if (saved) render(saved, 'saved');
    await refreshSnapshot();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then(function() { return loadPushState(); })
        .catch(function() { renderPushButton(); });
    } else {
      renderPushButton();
    }
    scheduleQuoteHeartbeat();
    scheduleFullSnapshotRefresh();
  }

  document.addEventListener('DOMContentLoaded', start);
})();
