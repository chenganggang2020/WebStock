const tradingService = require('./paperTradingService');
const monitorService = require('./paperMonitorService');
const paperPortfolioService = require('./paperPortfolioService');
const calendar = require('./marketTradingCalendar');

function shanghaiClock(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(value instanceof Date ? value : new Date(value)).map(function(part) {
    return [part.type, part.value];
  }));
  const time = parts.hour + ':' + parts.minute;
  return {
    date: parts.year + '-' + parts.month + '-' + parts.day,
    time,
    weekday: parts.weekday,
    minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

function timeMinute(value) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function selectDueSlot(value, settings) {
  if (!settings || settings.enabled !== true) return '';
  const clock = shanghaiClock(value);
  if (!calendar.tradingDay(clock.date).open) return '';
  const activated = shanghaiClock(new Date(settings.activatedAt));
  if (settings.startMode === 'next-trading-day' && clock.date <= activated.date) return '';
  const schedule = Array.isArray(settings.schedule) ? settings.schedule : [];
  for (const time of schedule) {
    const minute = timeMinute(time);
    if (minute === null || clock.minuteOfDay < minute || clock.minuteOfDay > minute + 4) continue;
    const slot = clock.date + '@' + time;
    return settings.lastRunSlot === slot ? '' : slot;
  }
  return '';
}

function createPaperMonitorScheduler(options = {}) {
  const trading = options.trading || tradingService;
  const monitor = options.monitor || monitorService;
  const ensurePortfolio = options.ensurePortfolio || paperPortfolioService.ensureDefaultMonitorPortfolio;
  const now = typeof options.now === 'function' ? options.now : function() { return new Date(); };
  const log = typeof options.log === 'function' ? options.log : function() {};
  const setIntervalFn = options.setInterval || setInterval;
  const clearIntervalFn = options.clearInterval || clearInterval;
  const setTimeoutFn = options.setTimeout || setTimeout;
  const clearTimeoutFn = options.clearTimeout || clearTimeout;
  const pollMs = Math.max(Number(options.pollMs) || 30000, 5000);
  let interval = null;
  let initialTimer = null;
  let running = null;

  function tick() {
    if (running) return running;
    running = (async function() {
      const current = now();
      ensurePortfolio({ now: current });
      const settingsList = trading.listEnabledMonitorSettings();
      for (const settings of settingsList) {
        const clock = shanghaiClock(current);
        const day = calendar.tradingDay(clock.date);
        if (!day.open) {
          if (!day.known && typeof trading.updateMonitorRunStatus === 'function') trading.updateMonitorRunStatus(settings.portfolioId, { lastError: day.reason });
          continue;
        }
        const journaling = typeof trading.getMonitorRun === 'function';
        if (journaling) {
          for (const time of settings.schedule) {
            const slotTime = new Date(clock.date + 'T' + time + ':00+08:00');
            if (slotTime.getTime() + 5 * 60000 <= Date.parse(settings.activatedAt)) continue;
            if (settings.startMode === 'next-trading-day' && clock.date <= shanghaiClock(settings.activatedAt).date) continue;
            const key = clock.date + '@' + time;
            const previous = trading.getMonitorRun(settings.portfolioId, key);
            if (current.getTime() >= slotTime.getTime() + 5 * 60000 && (!previous || ['retrying', 'running', 'handoff'].includes(previous.status))) {
              trading.saveMonitorRun(settings.portfolioId, key, { status: 'missed', nextRetryAt: '', error: '时段已过，未形成有效决策；不补用历史行情生成建议。' });
            }
          }
        }
        let slot = selectDueSlot(current, Object.assign({}, settings, journaling ? { lastRunSlot: '' } : {}));
        let previous = slot && journaling ? trading.getMonitorRun(settings.portfolioId, slot) : null;
        if (previous && (['succeeded', 'invalid', 'failed', 'missed', 'handoff'].includes(previous.status) ||
            previous.nextRetryAt && Date.parse(previous.nextRetryAt) > current.getTime() ||
            previous.status === 'running' && current.getTime() - Date.parse(previous.lastAttemptAt) < 3 * 60000)) slot = '';
        if (slot) {
          const attempts = Number(previous && previous.attempts || 0) + 1;
          try {
            if (journaling) trading.saveMonitorRun(settings.portfolioId, slot, { status: 'running', attempts, lastAttemptAt: current.toISOString(), nextRetryAt: '', error: '' });
            const result = await monitor.run(settings.portfolioId, { scheduleSlot: slot, now: current.toISOString() });
            if (journaling) trading.saveMonitorRun(settings.portfolioId, slot, {
              status: result && result.handoffMode ? 'handoff' : result && result.saved && result.saved.decision.validationStatus === 'invalid' ? 'invalid' : 'succeeded',
              nextRetryAt: '', error: result && result.reason || ''
            });
          } catch (error) {
            if (journaling) trading.saveMonitorRun(settings.portfolioId, slot, {
              status: attempts >= 3 ? 'failed' : 'retrying', error: error.message,
              nextRetryAt: attempts >= 3 ? '' : new Date(now().getTime() + attempts * 60000).toISOString()
            });
            log('Paper monitor advice failed for portfolio ' + settings.portfolioId, error);
          }
        }
        try {
          if (clock.time >= '09:30' && clock.time <= '15:05') await monitor.execute(settings.portfolioId, { now: now().toISOString() });
        } catch (error) {
          log('Paper monitor execution poll failed for portfolio ' + settings.portfolioId, error);
        }
      }
    })().finally(function() { running = null; });
    return running;
  }

  function start() {
    if (interval || initialTimer) return;
    initialTimer = setTimeoutFn(function() {
      initialTimer = null;
      tick().catch(function(error) { log('Initial paper monitor tick failed', error); });
    }, 15000);
    if (initialTimer && initialTimer.unref) initialTimer.unref();
    interval = setIntervalFn(function() {
      tick().catch(function(error) { log('Paper monitor tick failed', error); });
    }, pollMs);
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

module.exports = { shanghaiClock, selectDueSlot, createPaperMonitorScheduler };
