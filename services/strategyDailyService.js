const calendar = require('./marketTradingCalendar');

const STRATEGY_FAMILIES = [
  'moving-average-crossover',
  'macd-crossover',
  'rsi-rebound',
  'volume-breakout'
];

function beijingClock(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now || new Date()).reduce(function(result, part) {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
  const date = parts.year + '-' + parts.month + '-' + parts.day;
  const pseudoLocal = new Date(date + 'T' + parts.hour + ':' + parts.minute + ':' + parts.second);
  return { date, pseudoLocal, weekday: pseudoLocal.getDay() };
}

function calendarAgeDays(asOf, currentDate) {
  const asOfMs = Date.parse(String(asOf) + 'T00:00:00Z');
  const currentMs = Date.parse(String(currentDate) + 'T00:00:00Z');
  return Number.isFinite(asOfMs) && Number.isFinite(currentMs)
    ? Math.max(Math.floor((currentMs - asOfMs) / 86400000), 0)
    : Infinity;
}

function strategyDailyScheduleDecision(options = {}) {
  const clock = beijingClock(options.now || new Date());
  const target = new Date(clock.date + 'T09:05:00');
  const day = calendar.tradingDay(clock.date);
  if (!day.open) {
    return { action: day.known ? 'wait' : 'blocked', date: clock.date, reason: day.reason };
  }
  if (clock.pseudoLocal < target) {
    return { action: 'wait', date: clock.date, reason: '北京时间 09:05 后才运行每日研究。' };
  }
  if (options.runtimeAvailable === false) {
    return { action: 'blocked', date: clock.date, reason: '量化环境不可用，请先安装或修复量化环境。' };
  }
  if (options.hasActiveJob) {
    return { action: 'skip', date: clock.date, reason: '已有量化任务正在运行。' };
  }
  if (String(options.lastCompletedDate || '') === clock.date) {
    return { action: 'skip', date: clock.date, reason: '今天的每日研究已经完成。' };
  }
  const minimumRequested = Number(options.minimumRequested || 1000);
  const datasets = (Array.isArray(options.datasets) ? options.datasets : []).filter(function(entry) {
    const manifest = entry && entry.manifest;
    return entry && entry.valid && manifest && Number(manifest.coverage && manifest.coverage.requested) >= minimumRequested;
  }).sort(function(left, right) {
    const asOfOrder = String(right.manifest.asOf || '').localeCompare(String(left.manifest.asOf || ''));
    return asOfOrder || String(right.manifest.createdAt || '').localeCompare(String(left.manifest.createdAt || ''));
  });
  if (!datasets.length) {
    return { action: 'blocked', date: clock.date, reason: '没有可用的本地全市场数据，请先同步全市场。' };
  }
  const selected = datasets[0].manifest;
  const ageDays = calendarAgeDays(selected.asOf, clock.date);
  if (ageDays > Number(options.maxAgeDays == null ? 7 : options.maxAgeDays)) {
    return {
      action: 'blocked', date: clock.date, datasetId: selected.datasetId, asOf: selected.asOf, ageDays,
      reason: '最新全市场数据已经过期，请先同步全市场。'
    };
  }
  return {
    action: 'run', date: clock.date, datasetId: selected.datasetId,
    asOf: selected.asOf, ageDays, reason: '全市场数据满足每日研究条件。'
  };
}

function latestEligibleDailyCompletionDate(jobEntries, datasetEntries, minimumRequested = 1000, maxAgeDays = 7) {
  const eligibleDatasets = new Map((Array.isArray(datasetEntries) ? datasetEntries : []).filter(function(entry) {
    const manifest = entry && entry.manifest;
    return entry && entry.valid && manifest &&
      Number(manifest.coverage && manifest.coverage.requested) >= Number(minimumRequested);
  }).map(entry => [String(entry.manifest.datasetId || ''), entry.manifest]));
  const latest = (Array.isArray(jobEntries) ? jobEntries : []).filter(function(job) {
    const datasetId = String(job && job.output && (job.output.datasetId || job.output.report && job.output.report.datasetId) ||
      job && job.request && job.request.datasetId || '');
    const manifest = eligibleDatasets.get(datasetId);
    const completionDate = Number.isFinite(Date.parse(job && job.updatedAt))
      ? beijingClock(new Date(job.updatedAt)).date
      : '';
    return job && job.kind === 'strategy-daily' && job.status === 'completed' &&
      completionDate && manifest && calendarAgeDays(manifest.asOf, completionDate) <= Number(maxAgeDays);
  }).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0];
  return latest ? beijingClock(new Date(latest.updatedAt)).date : '';
}

function usableEntry(entry) {
  const result = entry && entry.result;
  const family = result && result.ruleCard && result.ruleCard.strategyFamily;
  return !!(entry && entry.valid && result && result.automaticTrading === false &&
    STRATEGY_FAMILIES.includes(family) && result.dataManifest && result.dataManifest.datasetId && result.asOf);
}

function chooseCohort(entries, options) {
  const cohorts = new Map();
  entries.filter(usableEntry).forEach(function(entry) {
    const result = entry.result;
    if (options.datasetId && result.dataManifest.datasetId !== options.datasetId) return;
    if (options.asOf && result.asOf !== options.asOf) return;
    const key = result.dataManifest.datasetId + '\0' + result.asOf;
    if (!cohorts.has(key)) cohorts.set(key, []);
    cohorts.get(key).push(entry);
  });
  return Array.from(cohorts.values()).sort(function(left, right) {
    const leftFamilies = new Set(left.map(entry => entry.result.ruleCard.strategyFamily)).size;
    const rightFamilies = new Set(right.map(entry => entry.result.ruleCard.strategyFamily)).size;
    if (leftFamilies !== rightFamilies) return rightFamilies - leftFamilies;
    const leftLatest = left.reduce((latest, entry) => latest > entry.result.createdAt ? latest : entry.result.createdAt, '');
    const rightLatest = right.reduce((latest, entry) => latest > entry.result.createdAt ? latest : entry.result.createdAt, '');
    return String(rightLatest).localeCompare(String(leftLatest));
  })[0] || [];
}

function buildStrategyDailyReport(entries, options = {}) {
  const cohort = chooseCohort(Array.isArray(entries) ? entries : [], options);
  if (!cohort.length) {
    return {
      schema: 'webstock.quant.strategy-daily.v1', status: 'blocked', automaticTrading: false,
      datasetId: '', asOf: '', createdAt: new Date().toISOString(), comparisons: [],
      missingFamilies: STRATEGY_FAMILIES.slice(), candidateCount: 0, storedCount: 0,
      truncated: false, candidates: [], warnings: ['没有同源、同截止日的策略研究结果。']
    };
  }
  const selectedByFamily = new Map();
  cohort.sort((left, right) => String(right.result.createdAt).localeCompare(String(left.result.createdAt))).forEach(function(entry) {
    const family = entry.result.ruleCard.strategyFamily;
    if (!selectedByFamily.has(family)) selectedByFamily.set(family, entry);
  });
  const selected = STRATEGY_FAMILIES.map(family => selectedByFamily.get(family)).filter(Boolean);
  const first = selected[0].result;
  const comparisons = selected.map(function(entry) {
    const result = entry.result;
    const current = result.currentSignals || {};
    return {
      strategyFamily: result.ruleCard.strategyFamily,
      label: result.ruleCard.label || result.ruleCard.strategyFamily,
      runId: result.runId,
      bestParameterId: result.bestParameter && result.bestParameter.parameterId || '',
      bestParameterLabel: result.bestParameter && result.bestParameter.label || '',
      stableParameterCount: Array.isArray(result.stableParameterIds) ? result.stableParameterIds.length : 0,
      selectedWalkForward: result.selectedWalkForward,
      candidateCount: Number(current.candidateCount || 0),
      universeScanned: Number(current.universeScanned || 0),
      verification: entry.verification || null
    };
  });

  const byCode = new Map();
  selected.forEach(function(entry) {
    const result = entry.result;
    const family = result.ruleCard.strategyFamily;
    const familyLabel = result.ruleCard.label || family;
    const current = result.currentSignals || {};
    (Array.isArray(current.candidates) ? current.candidates : []).forEach(function(candidate) {
      const code = String(candidate.code || '');
      if (!/^\d{6}$/.test(code)) return;
      if (!byCode.has(code)) {
        byCode.set(code, {
          code, name: String(candidate.name || code), signalDate: result.asOf,
          earliestObservation: 'next-executable-open', families: []
        });
      }
      byCode.get(code).families.push({
        strategyFamily: family,
        label: familyLabel,
        runId: result.runId,
        candidateStatus: candidate.candidateStatus,
        parameterIds: Array.isArray(candidate.parameterIds) ? candidate.parameterIds.slice() : [],
        evidence: Array.isArray(candidate.evidence) ? candidate.evidence.slice() : []
      });
    });
  });
  const candidates = Array.from(byCode.values()).map(function(candidate) {
    candidate.families.sort((left, right) => STRATEGY_FAMILIES.indexOf(left.strategyFamily) - STRATEGY_FAMILIES.indexOf(right.strategyFamily));
    candidate.stableFamilyCount = candidate.families.filter(family => family.candidateStatus === 'stable').length;
    candidate.watchFamilyCount = candidate.families.filter(family => family.candidateStatus === 'watch').length;
    candidate.consensusCount = candidate.families.length;
    candidate.maxPositiveFoldRate = candidate.families.reduce(function(best, family) {
      return Math.max(best, ...family.evidence.map(item => Number(item.positiveFoldRate) || 0));
    }, 0);
    return candidate;
  }).sort(function(left, right) {
    return right.stableFamilyCount - left.stableFamilyCount ||
      right.consensusCount - left.consensusCount ||
      right.watchFamilyCount - left.watchFamilyCount ||
      right.maxPositiveFoldRate - left.maxPositiveFoldRate ||
      left.code.localeCompare(right.code);
  });
  const limit = Math.min(Math.max(Number(options.maxCandidates) || 200, 1), 200);
  const stored = candidates.slice(0, limit);
  const missingFamilies = STRATEGY_FAMILIES.filter(family => !selectedByFamily.has(family));
  const warnings = [];
  if (missingFamilies.length) warnings.push('缺少策略家族：' + missingFamilies.join('、') + '。');
  if (candidates.length > stored.length) warnings.push('候选数量超过页面上限，已截断。');
  warnings.push('候选只表示收盘信号，最早于下一可成交交易日开盘人工观察。');
  return {
    schema: 'webstock.quant.strategy-daily.v1',
    status: missingFamilies.length ? 'partial' : 'complete',
    automaticTrading: false,
    datasetId: first.dataManifest.datasetId,
    manifestSha256: first.dataManifest.sha256,
    asOf: first.asOf,
    createdAt: new Date().toISOString(),
    comparisons,
    missingFamilies,
    candidateCount: candidates.length,
    storedCount: stored.length,
    truncated: candidates.length > stored.length,
    candidates: stored,
    warnings
  };
}

module.exports = {
  STRATEGY_FAMILIES,
  beijingClock,
  buildStrategyDailyReport,
  latestEligibleDailyCompletionDate,
  strategyDailyScheduleDecision
};
