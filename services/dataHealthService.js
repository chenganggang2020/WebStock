const fs = require('fs');
const path = require('path');

const { beijingClock } = require('./strategyDailyService');
const calendar = require('./marketTradingCalendar');

function previousWeekday(dateText) {
  const value = new Date(String(dateText) + 'T00:00:00Z');
  do { value.setUTCDate(value.getUTCDate() - 1); } while ([0, 6].includes(value.getUTCDay()));
  return value.toISOString().slice(0, 10);
}

function nextDate(dateText) {
  const value = new Date(String(dateText) + 'T00:00:00Z');
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function subtractYears(dateText, years) {
  const value = new Date(String(dateText) + 'T00:00:00Z');
  value.setUTCFullYear(value.getUTCFullYear() - Number(years));
  return value.toISOString().slice(0, 10);
}

function latestCompletedMarketDate(now) {
  const clock = beijingClock(now || new Date());
  if (calendar.tradingDay(clock.date).known) {
    return calendar.tradingDay(clock.date).open && clock.pseudoLocal >= new Date(clock.date + 'T15:05:00')
      ? clock.date : calendar.previousTradingDay(clock.date) || '';
  }
  if ([0, 6].includes(clock.weekday)) return previousWeekday(clock.date);
  return clock.pseudoLocal >= new Date(clock.date + 'T15:05:00')
    ? clock.date
    : previousWeekday(clock.date);
}

function manifestSummary(entry) {
  const manifest = entry && entry.manifest || {};
  const requested = Number(manifest.coverage && manifest.coverage.requested || 0);
  const succeeded = Number(manifest.coverage && manifest.coverage.succeeded || 0);
  return {
    datasetId: String(manifest.datasetId || ''),
    asOf: String(manifest.asOf || ''),
    createdAt: String(manifest.createdAt || ''),
    adjustmentMode: String(manifest.adjustmentMode || ''),
    eligibility: String(manifest.eligibility || ''),
    source: manifest.source || null,
    coverage: manifest.coverage || null,
    coverageRate: requested ? succeeded / requested : 0,
    quality: manifest.quality || null,
    universe: manifest.universe || null,
    requestedDateRange: manifest.requestedDateRange || null,
    dateRange: manifest.dateRange || null,
    warnings: Array.isArray(manifest.warnings) ? manifest.warnings : [],
    manifestPath: String(entry && entry.manifestPath || '')
  };
}

function isFullMarket(entry, expectedUniverseCount) {
  const manifest = entry && entry.manifest || {};
  const universe = manifest.universe || {};
  const requested = Number(universe.requestedCount || (manifest.coverage && manifest.coverage.requested) || 0);
  const threshold = Math.max(Math.floor(Number(expectedUniverseCount || 0) * 0.9), 5000);
  return entry && entry.valid === true && requested >= threshold &&
    String(universe.policy || '') === 'current-a-share-ex-st';
}

function fullMarketDatasetStatus(datasets, options = {}) {
  const expectedUniverseCount = Number(options.expectedUniverseCount || 0);
  const expectedAsOf = String(options.expectedAsOf || '');
  const fullMarket = (Array.isArray(datasets) ? datasets : [])
    .filter(function(entry) { return isFullMarket(entry, expectedUniverseCount); })
    .sort(function(left, right) {
      const byDate = String(right.manifest.asOf || '').localeCompare(String(left.manifest.asOf || ''));
      return byDate || String(right.manifest.createdAt || '').localeCompare(String(left.manifest.createdAt || ''));
    });
  const adjusted = fullMarket.find(function(entry) {
    return entry.manifest.adjustmentMode === 'forward-adjusted';
  });
  const legacy = fullMarket.find(function(entry) {
    return entry.manifest.adjustmentMode !== 'forward-adjusted';
  });

  if (!adjusted) {
    return {
      state: 'missing-baseline',
      expectedAsOf,
      expectedUniverseCount,
      baseline: null,
      legacyDataset: legacy ? manifestSummary(legacy) : null,
      action: {
        mode: 'full',
        startDate: subtractYears(expectedAsOf, 5),
        endDate: expectedAsOf,
        reason: '尚无全市场前复权基线，需要首次完整同步。'
      }
    };
  }

  const baseline = manifestSummary(adjusted);
  const minimumCoverage = Math.max(Math.floor(expectedUniverseCount * 0.9), 5000);
  const succeeded = Number(baseline.coverage && baseline.coverage.succeeded);
  const requested = Number(baseline.coverage && baseline.coverage.requested);
  const qualityIssues = [];
  if (!Number.isInteger(requested) || requested <= 0) {
    qualityIssues.push('请求覆盖计数无效，必须是正整数');
  }
  if (!Number.isInteger(succeeded) || succeeded < minimumCoverage || succeeded > requested) {
    qualityIssues.push('成功覆盖 ' + (Number.isFinite(succeeded) ? succeeded : '未知') + ' 只，需至少 ' + minimumCoverage + ' 只且计数有效');
  }
  for (const [field, label] of [['invalidRows', '无效行'], ['duplicateRows', '重复行'], ['staleSecurityCount', '过期证券']]) {
    if (baseline.quality && baseline.quality[field] !== undefined &&
        (!Number.isFinite(Number(baseline.quality[field])) || Number(baseline.quality[field]) !== 0)) {
      qualityIssues.push(label + '检查未通过');
    }
  }
  if (qualityIssues.length) {
    const startDate = baseline.requestedDateRange && baseline.requestedDateRange.start ||
      baseline.dateRange && baseline.dateRange.start || subtractYears(expectedAsOf, 5);
    return {
      state: 'partial', expectedAsOf, expectedUniverseCount, minimumCoverage, baseline,
      legacyDataset: legacy ? manifestSummary(legacy) : null,
      action: {
        mode: baseline.asOf >= expectedAsOf ? 'repair' : 'full',
        startDate, fetchStartDate: startDate, endDate: expectedAsOf,
        reason: qualityIssues.join('；') + '，需要修复基线后再进行全市场扫描。'
      }
    };
  }
  if (baseline.asOf >= expectedAsOf) {
    return {
      state: 'ready',
      expectedAsOf,
      expectedUniverseCount,
      baseline,
      legacyDataset: legacy ? manifestSummary(legacy) : null,
      action: { mode: 'none', reason: '全市场前复权数据已更新到最近完成交易日。' }
    };
  }
  return {
    state: 'stale',
    expectedAsOf,
    expectedUniverseCount,
    baseline,
    legacyDataset: legacy ? manifestSummary(legacy) : null,
    action: {
      mode: 'incremental',
      baseDatasetId: baseline.datasetId,
      startDate: baseline.dateRange && baseline.dateRange.start || subtractYears(expectedAsOf, 5),
      fetchStartDate: nextDate(baseline.asOf),
      endDate: expectedAsOf,
      reason: '基线早于最近完成交易日，只需抓取缺失日期并生成新数据集。'
    }
  };
}

function source(id, label, state, details) {
  return Object.assign({ id, label, state, observedAt: null, source: '', reason: '' }, details || {});
}

function buildDataHealthReport(input = {}) {
  const fullMarket = fullMarketDatasetStatus(input.datasets, {
    expectedUniverseCount: input.expectedUniverseCount,
    expectedAsOf: input.expectedAsOf
  });
  const eligibility = fullMarket.baseline && fullMarket.baseline.eligibility || '';
  const qualificationReason = eligibility === 'validation_eligible'
    ? '具备正式研究的数据资格，不代表策略有效或可实现收益。'
    : eligibility === 'exploratory_only'
      ? '仅可用于探索研究，尚不具备正式研究的数据资格。'
      : '研究数据资格尚未确认。';
  const database = input.database || {};
  const marketCache = input.marketCache || {};
  const watchlist = input.tonghuashunWatchlist || {};
  const holdings = input.tonghuashunHoldings || {};
  const runtime = input.quantRuntime || {};
  const runtimeReady = runtime.status === 'available' || runtime.status === 'configured';
  const checkedAt = String(input.checkedAt || new Date().toISOString());
  const expected = calendar.expectedObservation(checkedAt);
  const cacheTime = Date.parse(marketCache.observedAt || '');
  const cacheFresh = Number.isFinite(cacheTime) && expected && cacheTime <= Date.parse(checkedAt) + 5000 && cacheTime >= Date.parse(expected) - 5 * 60000;
  const sources = [
    source('database', '本地数据库', database.available ? 'ready' : 'unavailable', {
      source: 'local-sqlite', reason: database.error || ''
    }),
    source('market-cache', '当前行情缓存', !marketCache.observedAt ? 'unavailable' : cacheFresh ? 'ready' : 'attention', {
      source: 'in-process-market-cache', observedAt: marketCache.observedAt || null,
      reason: !marketCache.observedAt ? '当前进程还没有保存行情响应。' : cacheFresh ? '缓存响应时间符合当前交易时段；不代表每个证券均有新行情。' : '缓存已过期或时间未验证，需要刷新并检查各证券的行情时间。'
    }),
    source('tonghuashun-watchlist', '同花顺自选', watchlist.available ? 'ready' : 'unavailable', {
      source: 'tonghuashun-local-file', observedAt: watchlist.fileUpdatedAt || null,
      count: Number(watchlist.supportedCount || 0), path: watchlist.cachePath || '',
      reason: watchlist.error || ''
    }),
    source('tonghuashun-holdings', '同花顺持仓', holdings.available ? 'ready' : 'unavailable', {
      source: holdings.method || 'manual-copy', observedAt: holdings.observedAt || holdings.fileUpdatedAt || null,
      count: Number(holdings.holdingCount || 0), path: holdings.filename || '',
      reason: holdings.error || ''
    }),
    source('quant-runtime', '量化运行环境', runtimeReady ? (runtime.verified ? 'ready' : 'attention') : 'unavailable', {
      source: runtime.runtimeSource || '', reason: runtime.reason || ''
    }),
    source('full-market-dataset', '全市场前复权日线', fullMarket.state === 'ready' && eligibility === 'validation_eligible' ? 'ready' :
      (fullMarket.baseline ? 'attention' : 'unavailable'), {
      source: fullMarket.baseline && fullMarket.baseline.source && fullMarket.baseline.source.id || '',
      observedAt: fullMarket.baseline && fullMarket.baseline.asOf || null,
      count: fullMarket.baseline && fullMarket.baseline.coverage && fullMarket.baseline.coverage.succeeded || 0,
      eligibility,
      reason: fullMarket.action.reason + ' ' + qualificationReason
    })
  ];
  const summary = sources.reduce(function(result, item) {
    result[item.state] = (result[item.state] || 0) + 1;
    return result;
  }, { ready: 0, attention: 0, unavailable: 0 });
  const activeJobs = (Array.isArray(input.jobs) ? input.jobs : []).filter(function(job) {
    return job && ['queued', 'running'].includes(job.status);
  }).map(function(job) {
    return { id: job.id, kind: job.kind, status: job.status, progress: job.progress || null };
  });
  return {
    schema: 'webstock.data-health.v1',
    checkedAt,
    overallState: database.available === false ? 'blocked' :
      (summary.attention || summary.unavailable ? 'attention' : 'ready'),
    summary,
    sources,
    fullMarket,
    watchlistDiff: input.watchlistDiff || null,
    activeJobs
  };
}

function eligibleStockCount(rootDir) {
  const rows = JSON.parse(fs.readFileSync(path.join(rootDir, 'stocks.json'), 'utf8'));
  const seen = new Set();
  rows.forEach(function(item) {
    const code = String(item && item.code || '').trim();
    const name = String(item && item.name || '').trim();
    if (/^\d{6}$/.test(code) && !/^\*?ST/i.test(name)) seen.add(code);
  });
  return seen.size;
}

function getDataHealth(options = {}) {
  const rootDir = options.rootDir || path.join(__dirname, '..');
  const database = options.database || require('../db');
  const quant = options.quant || require('./quantService');
  const tonghuashunWatchlist = options.tonghuashunWatchlist || require('./tonghuashunWatchlistService');
  const tonghuashunHoldings = options.tonghuashunHoldings || require('./tonghuashunHoldingService');
  const latestCacheTimestamp = options.latestCacheTimestamp || require('../routes/cache').latestCacheTimestamp;
  let databaseStatus = { available: true };
  try { database.prepare('SELECT 1 AS ok').get(); } catch (error) {
    databaseStatus = { available: false, error: error.message };
  }
  const cacheTimestamp = Number(latestCacheTimestamp()) || 0;
  let watchlistDiff = null;
  try { watchlistDiff = tonghuashunWatchlist.previewLocalDiff(); } catch (error) {
    watchlistDiff = { readOnly: true, error: error.message };
  }
  const expectedAsOf = latestCompletedMarketDate(options.now || new Date());
  return buildDataHealthReport({
    checkedAt: new Date(options.now || Date.now()).toISOString(),
    expectedAsOf,
    expectedUniverseCount: eligibleStockCount(rootDir),
    database: databaseStatus,
    marketCache: { observedAt: cacheTimestamp ? new Date(cacheTimestamp).toISOString() : null },
    tonghuashunWatchlist: tonghuashunWatchlist.getStatus(),
    tonghuashunHoldings: typeof tonghuashunHoldings.getMonitorStatus === 'function' ? tonghuashunHoldings.getMonitorStatus({ now: options.now || new Date() }) : tonghuashunHoldings.getStatus(),
    quantRuntime: quant.getRuntimeStatus(),
    datasets: quant.listDatasets(200),
    jobs: quant.listJobs(30),
    watchlistDiff
  });
}

module.exports = {
  latestCompletedMarketDate,
  fullMarketDatasetStatus,
  buildDataHealthReport,
  eligibleStockCount,
  getDataHealth
};
