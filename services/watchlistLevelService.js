const db = require('../db');
const marketData = require('./marketDataService');
const portfolio = require('./portfolioService');
const { buildChartAnnotations } = require('./chartAnalysisService');
const { toSinaSymbol } = require('../utils/market');

function round(value) {
  return Number(Number(value).toFixed(2));
}

function deriveAutomaticLevels(rawBars) {
  const bars = (Array.isArray(rawBars) ? rawBars : []).filter(function(bar) {
    return bar && Number(bar.close) > 0 && Number(bar.high) >= Number(bar.low);
  });
  if (bars.length < 10) throw new Error('自动点位至少需要 10 根有效日线');
  const annotations = buildChartAnnotations(bars, 'day');
  const key = annotations.keyLevels || {};
  const pivot = annotations.currentLevels || {};
  const support = Number(key.support && key.support.price || pivot.support && pivot.support.price);
  const resistance = Number(key.resistance && key.resistance.price || pivot.resistance && pivot.resistance.price);
  const latest = bars[bars.length - 1];
  const tolerance = Number(key.tolerance) > 0 ? Number(key.tolerance) : Number(latest.close) * 0.005;
  if (!(support > 0) || !(resistance > 0) || !(tolerance > 0)) {
    throw new Error('日线样本未形成可用的历史支撑和压力位');
  }
  const usesKeyClusters = !!(key.support && key.resistance);
  return {
    d1Low: round(Math.max(0.01, support - tolerance)),
    d1High: round(support + tolerance),
    d2: round(Math.max(0.01, support - tolerance)),
    r1: round(resistance),
    confirm: round(resistance + tolerance),
    sourceDate: String(latest.date || latest.day || ''),
    period: 'day',
    method: usesKeyClusters
      ? '过去120根内历史局部高低点聚类；容差=max(收盘价0.5%, ATR14×35%)'
      : '前一完整日线 OHLC 传统枢轴点；容差=收盘价0.5%',
    rulesVersion: key.rulesVersion || 'pivot-fallback-v1'
  };
}

async function fetchDailyBars(code) {
  const url = 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=' +
    toSinaSymbol(code) + '&scale=240&ma=no&datalen=180&klt=100';
  const response = await marketData.get('watchlist-level-day:' + code, url, {
    headers: { Referer: 'https://finance.sina.com.cn' }
  });
  return (Array.isArray(response.data) ? response.data : []).map(function(item) {
    return {
      date: item.day || '',
      open: Number(item.open) || 0,
      close: Number(item.close) || 0,
      high: Number(item.high) || 0,
      low: Number(item.low) || 0,
      volume: Number(item.volume) || 0,
      amount: Number(item.amount) || 0
    };
  });
}

function saveLevels(id, levels) {
  db.prepare(`
    UPDATE watchlist
    SET auto_d1_low = @d1Low,
        auto_d1_high = @d1High,
        auto_d2 = @d2,
        auto_r1 = @r1,
        auto_confirm = @confirm,
        auto_levels_date = @sourceDate,
        auto_levels_updated_at = @updatedAt,
        auto_levels_method = @method,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run(Object.assign({ id, updatedAt: new Date().toISOString() }, levels));
}

async function refreshWatchlistLevels(options = {}) {
  const fetchBars = options.fetchDailyBars || fetchDailyBars;
  const items = options.items || portfolio.listWatchlist();
  const queue = items.slice();
  const failures = [];
  let updatedCount = 0;

  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      try {
        const levels = deriveAutomaticLevels(await fetchBars(item.code));
        saveLevels(item.id, levels);
        updatedCount++;
      } catch (error) {
        failures.push({ code: item.code, error: error.message || String(error) });
      }
    }
  }

  const concurrency = Math.max(1, Math.min(Number(options.concurrency) || 4, queue.length || 1));
  await Promise.all(Array.from({ length: concurrency }, worker));
  return {
    sourceCount: items.length,
    updatedCount,
    failedCount: failures.length,
    failures,
    updatedAt: new Date().toISOString(),
    method: '历史日线支撑压力自动点位，不是价格预测或交易指令'
  };
}

module.exports = {
  deriveAutomaticLevels,
  fetchDailyBars,
  refreshWatchlistLevels
};
