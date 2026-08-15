function defaultDelay(milliseconds) {
  return new Promise(function(resolve) {
    setTimeout(resolve, milliseconds);
  });
}

function currentUrl(window) {
  try {
    return String(window.webContents.getURL() || '');
  } catch (_) {
    return '';
  }
}

function isBlank(window) {
  const url = currentUrl(window);
  return !url || url === 'about:blank';
}

async function loadMainWindow(window, url, options) {
  const settings = options || {};
  const maxAttempts = Math.max(1, Number(settings.maxAttempts) || 3);
  const retryDelayMs = Math.max(0, Number(settings.retryDelayMs) || 1000);
  const delay = settings.delay || defaultDelay;
  const log = typeof settings.log === 'function' ? settings.log : function() {};

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (!window || (typeof window.isDestroyed === 'function' && window.isDestroyed())) {
      return { loaded: false, attempts: attempt - 1, reason: 'window_destroyed' };
    }

    try {
      await window.loadURL(url);
      return { loaded: true, attempts: attempt };
    } catch (error) {
      if (!isBlank(window)) {
        log('Main window startup navigation changed; skipping automatic retry', error);
        return { loaded: false, attempts: attempt, reason: 'navigation_changed' };
      }
      if (attempt >= maxAttempts) {
        log('Main window failed to load after ' + attempt + ' startup attempts', error);
        return { loaded: false, attempts: attempt, reason: 'load_failed' };
      }
      log('Main window startup load failed; retrying (' + attempt + '/' + maxAttempts + ')', error);
      await delay(retryDelayMs);
    }
  }

  return { loaded: false, attempts: maxAttempts, reason: 'load_failed' };
}

module.exports = {
  loadMainWindow
};
