(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.document) root.NetworkHealth = api.createBrowserNetworkHealth(root, root.document);
})(typeof window !== 'undefined' ? window : null, function() {
  const FOREGROUND_INTERVAL_MS = 30000;
  const HIDDEN_INTERVAL_MS = 120000;
  const MAX_BACKOFF_MS = 300000;
  const REQUEST_TIMEOUT_MS = 10000;

  function createNetworkHealthMonitor(options) {
    const fetchHealth = options.fetch;
    const isHidden = options.isHidden || function() { return false; };
    const setTimer = options.setTimeout || setTimeout;
    const clearTimer = options.clearTimeout || clearTimeout;
    const now = options.now || Date.now;
    const onStateChange = options.onStateChange || function() {};
    const dispatchRecovered = options.dispatchRecovered || function() {};
    const AbortControllerRef = options.AbortController || AbortController;
    let timerId = null;
    let running = false;
    let inFlight = null;
    let state = {
      status: 'checking',
      connectivity: 'offline',
      consecutiveFailures: 0,
      lastCheckedAt: null,
      lastSuccessfulAt: null
    };

    function snapshot() {
      return Object.assign({}, state);
    }

    function publish(next) {
      state = Object.assign({}, state, next);
      onStateChange(snapshot());
    }

    function nextDelay() {
      const base = isHidden() ? HIDDEN_INTERVAL_MS : FOREGROUND_INTERVAL_MS;
      const multiplier = Math.pow(2, Math.max(0, state.consecutiveFailures - 1));
      return Math.min(MAX_BACKOFF_MS, base * multiplier);
    }

    function schedule() {
      if (timerId !== null) clearTimer(timerId);
      timerId = null;
      if (!running) return;
      timerId = setTimer(function() {
        timerId = null;
        return check();
      }, nextDelay());
    }

    async function requestHealth() {
      const controller = new AbortControllerRef();
      const timeoutId = setTimer(function() { controller.abort(); }, REQUEST_TIMEOUT_MS);
      let response;
      try {
        response = await fetchHealth('/api/health', {
          method: 'GET',
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal
        });
      } finally {
        clearTimer(timeoutId);
      }
      if (!response || !response.ok) throw new Error('Local health check failed');
      const payload = await response.json();
      if (!payload || payload.success !== true || !payload.data || payload.data.status !== 'ok') {
        throw new Error('Local health check returned an invalid status');
      }
      return payload.data;
    }

    function check() {
      if (inFlight) return inFlight;
      inFlight = requestHealth().then(function() {
        const checkedAt = new Date(now()).toISOString();
        const recovered = state.consecutiveFailures > 0;
        publish({
          status: 'online',
          connectivity: 'live',
          consecutiveFailures: 0,
          lastCheckedAt: checkedAt,
          lastSuccessfulAt: checkedAt
        });
        if (recovered) dispatchRecovered(snapshot());
        return snapshot();
      }).catch(function() {
        publish({
          status: 'retrying',
          connectivity: state.lastSuccessfulAt ? 'cache' : 'offline',
          consecutiveFailures: state.consecutiveFailures + 1,
          lastCheckedAt: new Date(now()).toISOString()
        });
        return snapshot();
      }).finally(function() {
        inFlight = null;
        schedule();
      });
      return inFlight;
    }

    function start() {
      if (running) return inFlight || Promise.resolve(snapshot());
      running = true;
      publish({ status: 'checking' });
      return check();
    }

    function stop() {
      running = false;
      if (timerId !== null) clearTimer(timerId);
      timerId = null;
    }

    function visibilityChanged() {
      if (running) schedule();
    }

    return {
      start,
      stop,
      check,
      visibilityChanged,
      getState: snapshot
    };
  }

  function defaultFormatTime(value) {
    if (!value) return '--';
    return new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  }

  function renderNetworkHealthState(documentRef, state, formatTime) {
    const container = documentRef.getElementById('networkHealthStatus');
    const statusTarget = documentRef.getElementById('networkHealthState');
    const modeTarget = documentRef.getElementById('networkHealthMode');
    const checkedTarget = documentRef.getElementById('networkHealthCheckedAt');
    if (!container || !statusTarget || !modeTarget || !checkedTarget) return;

    const online = state.status === 'online';
    const checking = state.status === 'checking';
    const displayState = online ? 'online' : checking ? 'checking' : state.connectivity;
    container.className = 'network-health-status state-' + displayState;
    container.dataset.state = displayState;
    statusTarget.textContent = online ? '在线' : checking ? '检测中' : '重试中';
    modeTarget.textContent = online ? '本地服务与数据库可用'
      : checking ? '等待本地服务响应'
        : state.connectivity === 'cache' ? '使用缓存' : '离线';
    checkedTarget.textContent = '最后检测 ' + (state.lastCheckedAt
      ? (formatTime || defaultFormatTime)(state.lastCheckedAt)
      : '--');
    checkedTarget.dateTime = state.lastCheckedAt || '';
  }

  function createBrowserNetworkHealth(windowRef, documentRef) {
    const formatTime = function(value) {
      return windowRef.WebStockTime && windowRef.WebStockTime.formatDateTime
        ? windowRef.WebStockTime.formatDateTime(value)
        : defaultFormatTime(value);
    };
    const monitor = createNetworkHealthMonitor({
      fetch: windowRef.fetch.bind(windowRef),
      isHidden: function() { return documentRef.hidden; },
      onStateChange: function(state) { renderNetworkHealthState(documentRef, state, formatTime); },
      dispatchRecovered: function(state) {
        windowRef.dispatchEvent(new windowRef.CustomEvent('webstock:network-recovered', {
          detail: { checkedAt: state.lastCheckedAt }
        }));
      }
    });
    documentRef.addEventListener('visibilitychange', monitor.visibilityChanged);
    return monitor;
  }

  return {
    createNetworkHealthMonitor,
    renderNetworkHealthState,
    createBrowserNetworkHealth,
    FOREGROUND_INTERVAL_MS,
    HIDDEN_INTERVAL_MS,
    MAX_BACKOFF_MS,
    REQUEST_TIMEOUT_MS
  };
});
