const holdingService = require('./tonghuashunHoldingService');
const { getTonghuashunWindowHoldingService } = require('./tonghuashunWindowHoldingService');

function createTonghuashunHoldingScheduler(options = {}) {
  const holdings = options.holdings || holdingService;
  const windowCapture = options.windowCapture || getTonghuashunWindowHoldingService();
  const now = typeof options.now === 'function' ? options.now : function() { return new Date(); };
  const log = typeof options.log === 'function' ? options.log : function() {};
  const setIntervalFn = options.setInterval || setInterval;
  const clearIntervalFn = options.clearInterval || clearInterval;
  const setTimeoutFn = options.setTimeout || setTimeout;
  const clearTimeoutFn = options.clearTimeout || clearTimeout;
  const configuredPollMs = Number(options.pollMs || process.env.WEBSTOCK_THS_HOLDINGS_POLL_MS);
  const pollMs = Math.max(Number.isFinite(configuredPollMs) ? configuredPollMs : 15000, 5000);
  let interval = null;
  let initialTimer = null;
  let running = null;
  let lastState = '';

  function report(result) {
    const state = result.available
      ? 'ready:' + String(result.fileUpdatedAt || result.observedAt || '')
      : 'blocked:' + String(result.error || 'unavailable');
    if (state === lastState) return;
    lastState = state;
    if (result.available) {
      log(result.unchanged
        ? 'Tonghuashun holding export is unchanged'
        : 'Tonghuashun holding export synchronized');
    } else {
      log('Tonghuashun automatic holding sync is waiting: ' + String(result.error || 'no current export'));
    }
  }

  function tick() {
    if (running) return running;
    const timestamp = now();
    running = Promise.resolve().then(function() {
      return windowCapture.captureAndSync({ now: timestamp });
    }).then(function(result) {
      if (typeof holdings.recordWindowCaptureStatus === 'function') {
        holdings.recordWindowCaptureStatus(result, { now: timestamp });
      }
      if (result && result.available) return result;
      return holdings.getMonitorHoldingContext({
        now: timestamp,
        fallbackToSnapshot: false
      });
    }).then(function(result) {
      report(result);
      return result;
    }).catch(function(error) {
      const result = { available: false, error: error.message || String(error) };
      report(result);
      return result;
    }).finally(function() {
      running = null;
    });
    return running;
  }

  function start() {
    if (interval || initialTimer) return;
    initialTimer = setTimeoutFn(function() {
      initialTimer = null;
      tick();
    }, 1000);
    if (initialTimer && initialTimer.unref) initialTimer.unref();
    interval = setIntervalFn(tick, pollMs);
    if (interval && interval.unref) interval.unref();
  }

  function stop() {
    if (initialTimer) clearTimeoutFn(initialTimer);
    if (interval) clearIntervalFn(interval);
    initialTimer = null;
    interval = null;
  }

  return { tick, start, stop };
}

module.exports = { createTonghuashunHoldingScheduler };
