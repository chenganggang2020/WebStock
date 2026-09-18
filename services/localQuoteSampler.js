'use strict';
const calendar = require('./marketTradingCalendar');

function samplingSession(value) {
  const clock = calendar.clock(value), day = calendar.tradingDay(clock.date);
  const allowed = day.open && (clock.time >= '09:15:00' && clock.time <= '09:25:05' ||
    clock.time >= '09:30:00' && clock.time <= '11:30:05' || clock.time >= '13:00:00' && clock.time <= '15:00:05');
  return { allowed, date: clock.date, reason: allowed ? '交易时段后台采样' : day.reason || '非采样时段，保留历史' };
}

function createLocalQuoteSampler(options) {
  const now = options.now || Date.now;
  const setTimer = options.setInterval || setInterval, clearTimer = options.clearInterval || clearInterval;
  let timer = null, pending = null, codes = [], codesAt = -Infinity;
  const state = { targetCount: 0, requestedCount: 0, freshQuoteCount: 0, omittedCount: 0, lastAttemptAt: null, lastSuccessAt: null, lastError: null };
  function status() {
    return { ...state, ...samplingSession(now()), running: !!timer, inFlight: !!pending,
      intervalSeconds: 5, scope: 'holdings-and-watchlist', automaticTrading: false,
      note: '本机公共报价采样；并非交易所逐笔，休眠/退出无法采集，缺失历史不补造。' };
  }
  function tick() {
    if (pending) return pending;
    if (!samplingSession(now()).allowed) return Promise.resolve(status());
    pending = (async function() {
      state.lastAttemptAt = new Date(now()).toISOString();
      state.freshQuoteCount = 0;
      try {
        if (now() - codesAt >= 60000) {
          codes = [...new Set((await options.loadCodes()).map(String).filter(code => /^[036]\d{5}$/.test(code)))];
          codesAt = now();
        }
        state.targetCount = codes.length;
        state.requestedCount = Math.min(codes.length, 200);
        state.omittedCount = Math.max(0, codes.length - 200);
        if (!codes.length) { state.lastError = '没有可采集的沪深持仓/自选代码'; return; }
        const result = await options.readQuotes(codes.slice(0, 200));
        const quotes = Object.values(result && result.quotes || {});
        state.freshQuoteCount = quotes.filter(quote => {
          const time = String(quote.providerObservedAt || '').trim();
          const observedAt = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(time) ? time.replace(' ', 'T') + '+08:00' : time);
          const lag = now() - observedAt;
          return Number.isFinite(lag) && lag >= 0 && lag <= 30000 && !quote.stale && quote.price > 0;
        }).length;
        if (!state.freshQuoteCount) {
          state.lastError = '未获得新鲜报价，未伪造秒级或竞价数据';
        } else {
          state.lastSuccessAt = new Date(now()).toISOString();
          state.lastError = null;
        }
      } catch (error) { state.lastError = String(error.message || error).slice(0, 200); }
    })().finally(function() { pending = null; });
    return pending;
  }
  function start() {
    if (timer) return;
    timer = setTimer(tick, 5000);
    if (timer && timer.unref) timer.unref();
    tick();
  }
  function stop() { if (timer) clearTimer(timer); timer = null; }
  return { start, stop, tick, status };
}
module.exports = { createLocalQuoteSampler, samplingSession };
