'use strict';

function createIndustryResearchScheduler(options = {}) {
  const service = options.service;
  const now = options.now || (() => new Date());
  const setIntervalFn = options.setInterval || setInterval;
  const clearIntervalFn = options.clearInterval || clearInterval;
  const pollMs = Number(options.pollMs) > 0 ? Number(options.pollMs) : 30000;
  let timer = null;
  let stopped = true;
  let running = false;

  async function tick() {
    if (stopped || running || !service || typeof service.listTopics !== 'function') return false;
    running = true;
    try {
      const current = now() instanceof Date ? now() : new Date(now());
      for (const topic of service.listTopics()) {
        if (stopped) break;
        const latest = service.listTopics().find(item => item.id === topic.id);
        if (!latest || !latest.enabled || !latest.nextDueAt || Number.isNaN(Date.parse(latest.nextDueAt)) || Date.parse(latest.nextDueAt) > current.getTime()) continue;
        try {
          await service.updateTopic(latest.id, {});
        } catch (_) {}
      }
      return true;
    } finally {
      running = false;
    }
  }

  function start() {
    if (!stopped) return false;
    stopped = false;
    timer = setIntervalFn(() => { tick().catch(() => {}); }, pollMs);
    if (timer && timer.unref) timer.unref();
    return true;
  }

  function stop() {
    if (stopped) return false;
    stopped = true;
    if (timer !== null) clearIntervalFn(timer);
    timer = null;
    return true;
  }

  return { start, stop, tick, isRunning: () => !stopped };
}

module.exports = { createIndustryResearchScheduler };
