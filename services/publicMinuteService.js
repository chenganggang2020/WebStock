const { toSinaSymbol } = require('../utils/market');

const EASTMONEY_FIELDS_1 = 'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13';
const EASTMONEY_FIELDS_2 = 'f51,f52,f53,f54,f55,f56,f57,f58';

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizedCode(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(digits)) throw new Error('Invalid stock code');
  return digits;
}

function eastmoneySecid(code) {
  const normalized = normalizedCode(code);
  return (/^(5|6|9)/.test(normalized) ? '1.' : '0.') + normalized;
}

function normalizedTime(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?::(\d{2}))?$/);
  return match ? match[1] + ' ' + match[2] + ':' + (match[3] || '00') : '';
}

function latestTradingRows(rows) {
  const valid = rows.filter(function(row) { return row && row.time && Number(row.price) > 0; });
  if (!valid.length) return { tradingDate: '', rows: [] };
  const tradingDate = valid.reduce(function(latest, row) {
    const date = row.time.slice(0, 10);
    return date > latest ? date : latest;
  }, '');
  return {
    tradingDate,
    rows: valid.filter(function(row) { return row.time.startsWith(tradingDate); })
      .sort(function(left, right) { return left.time.localeCompare(right.time); })
  };
}

function normalizeEastmoneyTrends(payload) {
  const trends = payload && payload.data && Array.isArray(payload.data.trends)
    ? payload.data.trends : [];
  const rows = trends.map(function(line) {
    const fields = String(line || '').split(',');
    const time = normalizedTime(fields[0]);
    const open = numberOrNull(fields[1]);
    const close = numberOrNull(fields[2]);
    const high = numberOrNull(fields[3]);
    const low = numberOrNull(fields[4]);
    const volumeLots = numberOrNull(fields[5]);
    const amount = numberOrNull(fields[6]);
    const averagePrice = numberOrNull(fields[7]);
    if (!time || close === null || close <= 0) return null;
    return {
      time,
      open,
      price: close,
      high,
      low,
      volume: volumeLots === null ? null : volumeLots * 100,
      amount,
      averagePrice
    };
  }).filter(Boolean);
  return latestTradingRows(rows);
}

function normalizeSinaKlines(payload) {
  const rows = (Array.isArray(payload) ? payload : []).map(function(item) {
    const time = normalizedTime(item && item.day);
    const price = numberOrNull(item && (item.close == null ? item.price : item.close));
    if (!time || price === null || price <= 0) return null;
    return {
      time,
      open: numberOrNull(item.open),
      price,
      high: numberOrNull(item.high),
      low: numberOrNull(item.low),
      volume: numberOrNull(item.volume),
      amount: numberOrNull(item.amount),
      averagePrice: numberOrNull(item.avg_price || item.averagePrice)
    };
  }).filter(Boolean);
  return latestTradingRows(rows);
}

function normalizedCompactDate(value) {
  const match = String(value || '').match(/^(\d{4})(\d{2})(\d{2})$/);
  return match ? match[1] + '-' + match[2] + '-' + match[3] : '';
}

function isTradingMinuteLabel(value) {
  const match = String(value || '').match(/^(\d{2})(\d{2})$/);
  if (!match) return false;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  return (minute >= 9 * 60 + 30 && minute <= 11 * 60 + 30) ||
    (minute >= 13 * 60 && minute <= 15 * 60);
}

function normalizeTencentMinute(payload, code) {
  const symbol = toSinaSymbol(normalizedCode(code));
  const container = payload && payload.data && payload.data[symbol];
  const source = container && container.data;
  const tradingDate = normalizedCompactDate(source && source.date);
  const lines = source && Array.isArray(source.data) ? source.data : [];
  let previousCumulativeVolume = 0;
  let previousCumulativeAmount = 0;
  const rows = lines.map(function(line) {
    const fields = String(line || '').trim().split(/\s+/);
    const label = fields[0];
    const price = numberOrNull(fields[1]);
    const cumulativeVolumeLots = numberOrNull(fields[2]);
    const cumulativeAmount = numberOrNull(fields[3]);
    if (!tradingDate || !isTradingMinuteLabel(label) || price === null || price <= 0 ||
        cumulativeVolumeLots === null || cumulativeAmount === null) return null;
    const volumeLots = Math.max(cumulativeVolumeLots - previousCumulativeVolume, 0);
    const amount = Math.max(cumulativeAmount - previousCumulativeAmount, 0);
    previousCumulativeVolume = cumulativeVolumeLots;
    previousCumulativeAmount = cumulativeAmount;
    const time = tradingDate + ' ' + label.slice(0, 2) + ':' + label.slice(2) + ':00';
    return {
      time,
      open: price,
      price,
      high: price,
      low: price,
      volume: volumeLots * 100,
      amount,
      averagePrice: cumulativeVolumeLots > 0
        ? Number((cumulativeAmount / (cumulativeVolumeLots * 100)).toFixed(2))
        : null
    };
  }).filter(Boolean);
  return { tradingDate, rows: rows.sort(function(left, right) { return left.time.localeCompare(right.time); }) };
}

function shanghaiDate(timestamp) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(timestamp)).map(function(part) { return [part.type, part.value]; }));
  return parts.year + '-' + parts.month + '-' + parts.day;
}

function publicMarketState(timestamp, tradingDate) {
  const date = new Date(timestamp);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).map(function(part) { return [part.type, part.value]; }));
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  const weekday = parts.weekday;
  const tradingNow = weekday !== 'Sat' && weekday !== 'Sun' &&
    ((minute >= 9 * 60 + 30 && minute <= 11 * 60 + 30) ||
      (minute >= 13 * 60 && minute < 15 * 60));
  if (!tradingNow) return { marketState: 'latest-close', stale: false };
  return tradingDate === shanghaiDate(timestamp)
    ? { marketState: 'live', stale: false }
    : { marketState: 'delayed', stale: true };
}

function sourceMeta(dataSource, intervalMinutes, tradingDate, timestamp, extra) {
  return Object.assign({
    dataSource,
    provider: dataSource === 'tencent-1m' ? 'Tencent public minute' :
      dataSource === 'eastmoney-1m' ? 'Eastmoney public trends' : 'Sina public K-line',
    derived: false,
    synthetic: false,
    exchangeGroundTruth: false,
    stale: false,
    tradingDate,
    fetchedAt: new Date(timestamp).toISOString(),
    sampling: {
      intervalSeconds: intervalMinutes * 60,
      intervalMinutes,
      label: intervalMinutes + '\u5206\u949f\u516c\u5f00\u884c\u60c5',
      timestampMeaning: 'bar-label',
      expectedFullDayPoints: intervalMinutes === 1
        ? (dataSource === 'tencent-1m' ? 242 : 241)
        : 48
    },
    realtimeGuaranteed: false
  }, extra || {});
}

function createPublicMinuteService(options = {}) {
  const marketData = options.marketData;
  const now = options.now || Date.now;
  if (!marketData || typeof marketData.get !== 'function') throw new TypeError('marketData.get is required');

  async function fetch(code) {
    const normalized = normalizedCode(code);
    const oneMinuteReasons = [];
    try {
      const symbol = toSinaSymbol(normalized);
      const url = 'https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=' + symbol;
      const response = await marketData.get('minute-1m-tencent:' + normalized, url, {
        headers: { Referer: 'https://gu.qq.com/', 'User-Agent': 'Mozilla/5.0' }
      });
      const normalizedRows = normalizeTencentMinute(response.data, normalized);
      if (normalizedRows.rows.length) {
        const timestamp = now();
        return {
          rows: normalizedRows.rows,
          meta: sourceMeta('tencent-1m', 1, normalizedRows.tradingDate, timestamp, {
            ...publicMarketState(timestamp, normalizedRows.tradingDate)
          })
        };
      }
      oneMinuteReasons.push('tencent-returned-empty-data');
    } catch (error) {
      oneMinuteReasons.push('tencent-request-failed');
    }

    try {
      const url = 'https://push2his.eastmoney.com/api/qt/stock/trends2/get?' + new URLSearchParams({
        fields1: EASTMONEY_FIELDS_1,
        fields2: EASTMONEY_FIELDS_2,
        ndays: '5',
        iscr: '0',
        secid: eastmoneySecid(normalized)
      }).toString();
      const response = await marketData.get('minute-1m-eastmoney:' + normalized, url, {
        headers: { Referer: 'https://quote.eastmoney.com/', 'User-Agent': 'Mozilla/5.0' }
      });
      const normalizedRows = normalizeEastmoneyTrends(response.data);
      if (normalizedRows.rows.length) {
        const timestamp = now();
        return {
          rows: normalizedRows.rows,
          meta: sourceMeta('eastmoney-1m', 1, normalizedRows.tradingDate, timestamp, {
            ...publicMarketState(timestamp, normalizedRows.tradingDate),
            fallbackFrom: 'tencent-1m',
            reason: oneMinuteReasons[0] || ''
          })
        };
      }
      oneMinuteReasons.push('eastmoney-returned-empty-data');
    } catch (error) {
      oneMinuteReasons.push('eastmoney-request-failed');
    }

    try {
      const url = 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=' +
        toSinaSymbol(normalized) + '&scale=5&ma=no&datalen=1000';
      const response = await marketData.get('minute-5m:' + normalized, url, {
        headers: { Referer: 'https://finance.sina.com.cn' }
      });
      const normalizedRows = normalizeSinaKlines(response.data);
      if (normalizedRows.rows.length) {
        const timestamp = now();
        return {
          rows: normalizedRows.rows,
          meta: sourceMeta('sina-5m', 5, normalizedRows.tradingDate, timestamp, {
            ...publicMarketState(timestamp, normalizedRows.tradingDate),
            fallbackFrom: 'public-1m',
            reason: 'one-minute-providers-unavailable',
            fallbackReasons: oneMinuteReasons.slice()
          })
        };
      }
      const error = new Error('Public minute providers returned no usable data');
      error.code = 'PROVIDER_EMPTY_DATA';
      throw error;
    } catch (error) {
      if (error.code === 'PROVIDER_EMPTY_DATA') throw error;
      const unavailable = new Error('Public minute providers are unavailable');
      unavailable.code = 'PROVIDER_REQUEST_FAILED';
      throw unavailable;
    }
  }

  return { fetch };
}

module.exports = {
  createPublicMinuteService,
  normalizeEastmoneyTrends,
  normalizeTencentMinute,
  normalizeSinaKlines,
  eastmoneySecid
};
