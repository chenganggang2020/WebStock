'use strict';
const tradingCalendar = require('./marketTradingCalendar');
const { getEastmoneyEtfDailyService } = require('./eastmoneyEtfDailyService');

function createEastmoneyEtfDailyScheduler(options = {}) {
  const service = options.service || getEastmoneyEtfDailyService();
  const calendar = options.calendar || tradingCalendar;
  const now = options.now || (() => new Date());
  const enabled = options.enabled === undefined ? process.env.WEBSTOCK_ETF_DAILY_AUTO_UPDATE !== '0' : options.enabled;
  const setIntervalFn = options.setInterval || setInterval;
  const clearIntervalFn = options.clearInterval || clearInterval;
  const slots = ['08:50', '09:00', '09:10', '09:20'];
  let timer = null, running = false, stopped = false, doneDate = '', localAttempt = '', observedDay = '', lateStartup = false;
  const state = () => typeof service.getState === 'function' ? service.getState() : {};
  const isDone = () => {
    const date = tradingCalendar.clock(now()).date;
    return doneDate === date || state().lastSuccessTargetDate === date;
  };
  async function tick() {
    if (!enabled || stopped || running) return false;
    const current = now(), clock = tradingCalendar.clock(current);
    if (observedDay !== clock.date) {
      observedDay = clock.date;
      lateStartup = clock.time >= '09:25:00';
    }
    const day = calendar.tradingDay(clock.date);
    if (!day.known || !day.open || clock.time < '08:50:00' || isDone()) return false;
    const last = typeof service.getLastAttempt === 'function' ? service.getLastAttempt() : localAttempt;
    const sameDay = last.startsWith(clock.date + '@');
    if (sameDay && last.endsWith('@catchup')) return false;
    const slot = clock.time < '09:25:00' ? slots.filter(time => clock.time >= time + ':00').pop() : 'catchup';
    if (slot === 'catchup' && !lateStartup) return false;
    const key = clock.date + '@' + slot;
    if (!slot || last === key) return false;
    if (sameDay) {
      const lastAt = state().lastScheduledAttemptAt || clock.date + 'T' + last.split('@')[1] + ':00+08:00';
      if (current.getTime() - Date.parse(lastAt) < 10 * 60000) return false;
    }
    // Lock and persist before network I/O, so overlapping calls/restarts cannot duplicate work.
    running = true;
    try {
      if (options.persistAttempt) await options.persistAttempt(key);
      else await service.saveLastAttempt(key);
      localAttempt = key;
      if (stopped) return false;
      const result = await service.refresh();
      if (result && result.isCurrent) doneDate = clock.date;
      return true;
    } catch (error) {
      if (options.log) options.log('ETF日报更新未完成', error);
      return false;
    } finally {
      running = false;
    }
  }
  function start() {
    if (!enabled || timer !== null) return false;
    stopped = false;
    timer = setIntervalFn(() => { tick().catch(() => {}); }, options.pollMs || 30000);
    if (timer && timer.unref) timer.unref();
    tick().catch(() => {});
    return true;
  }
  function stop() {
    stopped = true;
    if (timer === null) return false;
    clearIntervalFn(timer); timer = null;
    return true;
  }
  return { tick, start, stop, isDone };
}
module.exports = { createEastmoneyEtfDailyScheduler };
