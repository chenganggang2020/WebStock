const express = require('express');
const router = express.Router();

const axios = require('axios');
const iconv = require('iconv-lite');
const { minuteCache, klineCache } = require('./cache');
const { toSinaSymbol } = require('../utils/market');

function ok(res, data) {
  res.json({ success: true, data });
}

function fail(res, error, status = 400) {
  res.status(status).json({ success: false, error: error.message || String(error) });
}

router.get('/quote', async function (req, res) {
  const codes = (req.query.codes || '').split(',').filter(function (c) { return c; });
  if (codes.length === 0) return ok(res, []);

  const BATCH_SIZE = 80;
  const batches = [];
  for (let i = 0; i < codes.length; i += BATCH_SIZE) {
    batches.push(codes.slice(i, i + BATCH_SIZE));
  }

  const results = {};
  try {
    for (let j = 0; j < batches.length; j++) {
      const batch = batches[j];
      const sinaCodes = batch.map(toSinaSymbol).join(',');
      const resp = await axios.get('https://hq.sinajs.cn/list=' + sinaCodes, {
        headers: { 'Referer': 'https://finance.sina.com.cn' },
        responseType: 'arraybuffer'
      });
      const rawData = iconv.decode(Buffer.from(resp.data), 'gbk');
      const lines = rawData.split('\n').filter(function (l) { return l; });
      lines.forEach(function (line) {
        const m = line.match(/hq_str_(s[hz]\d+)="(.+)"/);
        if (!m) return;
        const code = m[1].replace(/^sh|^sz/, '');
        const f = m[2].split(',');
        const price = parseFloat(f[3]) || 0;
        const prevClose = parseFloat(f[2]) || price;
        results[code] = {
          code: code,
          name: f[0],
          price: price,
          open: parseFloat(f[1]) || 0,
          high: parseFloat(f[4]) || 0,
          low: parseFloat(f[5]) || 0,
          volume: parseFloat(f[8]) || 0,
          amount: parseFloat(f[9]) || 0,
          prevClose: prevClose,
          change: prevClose ? Number(((price - prevClose) / prevClose * 100).toFixed(2)) : 0,
          buy1Price: parseFloat(f[11]) || 0,
          buy2Price: parseFloat(f[13]) || 0,
          buy3Price: parseFloat(f[15]) || 0,
          buy4Price: parseFloat(f[17]) || 0,
          buy5Price: parseFloat(f[19]) || 0,
          buy1Vol: parseFloat(f[10]) || 0,
          buy2Vol: parseFloat(f[12]) || 0,
          buy3Vol: parseFloat(f[14]) || 0,
          buy4Vol: parseFloat(f[16]) || 0,
          buy5Vol: parseFloat(f[18]) || 0,
          sell1Price: parseFloat(f[21]) || 0,
          sell2Price: parseFloat(f[23]) || 0,
          sell3Price: parseFloat(f[25]) || 0,
          sell4Price: parseFloat(f[27]) || 0,
          sell5Price: parseFloat(f[29]) || 0,
          sell1Vol: parseFloat(f[20]) || 0,
          sell2Vol: parseFloat(f[22]) || 0,
          sell3Vol: parseFloat(f[24]) || 0,
          sell4Vol: parseFloat(f[26]) || 0,
          sell5Vol: parseFloat(f[28]) || 0
        };
      });
      await new Promise(function (r) { setTimeout(r, 100); });
    }
    ok(res, Object.values(results));
  } catch (e) {
    console.error('Get quote failed:', e.message);
    ok(res, codes.map(function(code) {
      return { code: code, name: code, price: 0, change: 0, open: 0, high: 0, low: 0, volume: 0, amount: 0, prevClose: 0, quoteStatus: 'fallback' };
    }));
  }
});

function isTradingTime() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const hours = now.getHours();
  const minutes = now.getMinutes();

  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return false;
  }

  const morningStart = 9;
  const morningEnd = 11;
  const afternoonStart = 13;
  const afternoonEnd = 15;

  const isMorningTrading = hours > morningStart || (hours === morningStart && minutes >= 30);
  const isBeforeMorningEnd = hours < morningEnd || (hours === morningEnd && minutes <= 30);
  const isAfternoonTrading = hours >= afternoonStart && hours < afternoonEnd;

  return (isMorningTrading && isBeforeMorningEnd) || isAfternoonTrading;
}

function getTodayStr() {
  const now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
}

router.get('/minute', async function (req, res) {
  const code = req.query.code;

  if (!code) {
    return fail(res, 'Missing code');
  }

  const isTrading = isTradingTime();
  const today = getTodayStr();
  const cacheDuration = isTrading ? 10 * 1000 : 60 * 1000;

  const cached = minuteCache.get(code);
  if (cached && Date.now() - cached.ts < cacheDuration) {
    const cachedDate = cached.data.length > 0 && cached.data[0].time ? 
      cached.data[0].time.split(' ')[0] : '';
    if (!isTrading || cachedDate === today) {
      return ok(res, cached.data);
    }
  }

  let basePrice = null;

  try {
    const quoteUrl = 'https://hq.sinajs.cn/list=' + toSinaSymbol(code);
    const quoteResp = await axios.get(quoteUrl, {
      headers: { 'Referer': 'https://finance.sina.com.cn' },
      responseType: 'arraybuffer',
      timeout: 5000
    });
    const quoteData = iconv.decode(Buffer.from(quoteResp.data), 'gbk');
    const match = quoteData.match(/hq_str_[^=]+="([^"]+)"/);
    if (match) {
      const f = match[1].split(',');
      basePrice = parseFloat(f[3]) || parseFloat(f[1]) || null;
      console.log(`[${code}] 获取基准价格: ${basePrice}`);
    }
  } catch (e) {
    console.log(`[${code}] 获取基准价格失败:`, e.message);
  }

  try {
    const url = 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=' + toSinaSymbol(code) + '&scale=5&ma=no&datalen=1000';

    const resp = await axios.get(url, {
      headers: { 'Referer': 'https://finance.sina.com.cn' },
      timeout: 10000
    });

    const data = resp.data;
    if (Array.isArray(data) && data.length > 0) {
      let targetDate = today;
      let hasTodayData = false;
      let lastClosePrice = basePrice;

      for (let i = data.length - 1; i >= 0; i--) {
        const item = data[i];
        if (item.day && item.day.startsWith(today)) {
          hasTodayData = true;
          break;
        }
      }

      if (!hasTodayData && isTrading) {
        console.log(`[${code}] 新浪API暂未返回今日(${today})分时数据，使用模拟数据`);
        const mockData = generateMockMinuteData(code, basePrice);
        minuteCache.set(code, { ts: Date.now(), data: mockData });
        return ok(res, mockData);
      }

      if (!hasTodayData && !isTrading) {
        for (let i = data.length - 1; i >= 0; i--) {
          const item = data[i];
          if (item.day && parseFloat(item.close) > 0) {
            targetDate = item.day.split(' ')[0];
            lastClosePrice = parseFloat(item.close);
            break;
          }
        }
      }

      let lastTradingData = [];
      let validPriceCount = 0;
      for (let i = 0; i < data.length; i++) {
        const item = data[i];
        if (item.day && item.day.startsWith(targetDate)) {
          const closePrice = parseFloat(item.close) || parseFloat(item.price) || 0;
          if (closePrice > 0) {
            validPriceCount++;
          }
          if (closePrice > 0 && !lastClosePrice) {
            lastClosePrice = closePrice;
          }
          lastTradingData.push({
            time: item.day || '',
            price: closePrice,
            volume: parseFloat(item.volume) || 0,
            amount: parseFloat(item.amount) || 0
          });
        }
      }

      if (lastTradingData.length === 0 || validPriceCount < 3) {
        console.log(`[${code}] 有效数据不足(总数:${lastTradingData.length}, 有效价格:${validPriceCount})，使用模拟数据`);
        const mockData = generateMockMinuteData(code, lastClosePrice || basePrice);
        minuteCache.set(code, { ts: Date.now(), data: mockData });
        return ok(res, mockData);
      }

      if (hasTodayData && isTrading) {
        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        
        lastTradingData = lastTradingData.filter(item => {
          if (!item.time) return false;
          const timeMatch = item.time.match(/(\d{2}):(\d{2}):(\d{2})/);
          if (!timeMatch) return true;
          const itemMinutes = parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2]);
          return itemMinutes <= currentMinutes + 5;
        });
      }

      minuteCache.set(code, { ts: Date.now(), data: lastTradingData });
      ok(res, lastTradingData);
    } else {
      const mockData = generateMockMinuteData(code, basePrice);
      ok(res, mockData);
    }
  } catch (e) {
    console.error(`[${code}] 获取分时数据失败:`, e.message);
    const mockData = generateMockMinuteData(code, basePrice);
    ok(res, mockData);
  }
});

function generateMockMinuteData(code, basePrice) {
  const now = new Date();
  const todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  
  const isTrading = isTradingTime();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 30);

  if (!isTrading) {
    const lastTradingDay = new Date(now);
    let dayOfWeek = lastTradingDay.getDay();
    while (dayOfWeek === 0 || dayOfWeek === 6) {
      lastTradingDay.setDate(lastTradingDay.getDate() - 1);
      dayOfWeek = lastTradingDay.getDay();
    }
    const lastTradingStr = lastTradingDay.getFullYear() + '-' + String(lastTradingDay.getMonth() + 1).padStart(2, '0') + '-' + String(lastTradingDay.getDate()).padStart(2, '0');
    return generateFullDayMockData(lastTradingStr, basePrice);
  }

  const price = basePrice || (10 + Math.random() * 20);
  const data = [];
  let lastPrice = price;
  let currentTime = new Date(startOfDay);

  while (currentTime <= now && currentTime.getHours() < 15) {
    if (currentTime.getHours() >= 11 && currentTime.getHours() < 13) {
      currentTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 0);
      continue;
    }

    const timeStr = todayStr + ' ' + currentTime.getHours().toString().padStart(2, '0') + ':' + currentTime.getMinutes().toString().padStart(2, '0') + ':00';
    const change = (Math.random() - 0.5) * price * 0.005;
    let currentPrice = lastPrice + change;
    currentPrice = +currentPrice.toFixed(2);

    data.push({
      time: timeStr,
      price: currentPrice,
      volume: Math.floor(Math.random() * 10000) + 5000,
      amount: currentPrice * (Math.floor(Math.random() * 10000) + 5000)
    });

    lastPrice = currentPrice;
    currentTime = new Date(currentTime.getTime() + 300000);
  }

  return data;
}

function generateFullDayMockData(dateStr, basePrice) {
  const price = basePrice || (10 + Math.random() * 20);
  const data = [];
  let lastPrice = price;
  
  const times = [];
  for (let h = 9; h <= 11; h++) {
    const startMin = h === 9 ? 30 : 0;
    const endMin = h === 11 ? 30 : 60;
    for (let m = startMin; m < endMin; m += 5) {
      times.push(dateStr + ' ' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':00');
    }
  }
  for (let h = 13; h < 15; h++) {
    for (let m = 0; m < 60; m += 5) {
      times.push(dateStr + ' ' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':00');
    }
  }

  times.forEach(function(timeStr) {
    const change = (Math.random() - 0.5) * price * 0.005;
    let currentPrice = lastPrice + change;
    currentPrice = +currentPrice.toFixed(2);

    data.push({
      time: timeStr,
      price: currentPrice,
      volume: Math.floor(Math.random() * 10000) + 5000,
      amount: currentPrice * (Math.floor(Math.random() * 10000) + 5000)
    });

    lastPrice = currentPrice;
  });

  return data;
}

router.get('/kline', async function (req, res) {
  const code = req.query.code;
  const period = req.query.period || req.query.type || 'day';

  console.log('API kline called:', code, period);

  if (!code) {
    return fail(res, 'Missing code');
  }

  const cacheKey = code + '_' + period;
  const cached = klineCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 30 * 60 * 1000) {
    return ok(res, cached.data);
  }

  if (period === 'week' || period === 'month') {
    try {
      const aggData = await calculateWeekOrMonthData(code, period);
      klineCache.set(cacheKey, { ts: Date.now(), data: aggData });
      ok(res, aggData);
    } catch (calcError) {
      fail(res, calcError, 500);
    }
    return;
  }

  try {
    const url = 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=' + toSinaSymbol(code) + '&scale=240&ma=no&datalen=10000&klt=100';
    const resp = await axios.get(url, { headers: { 'Referer': 'https://finance.sina.com.cn' } });

    const data = resp.data;
    if (Array.isArray(data) && data.length > 0) {
      const result = [];
      for (let i = 0; i < data.length; i++) {
        const item = data[i];
        result.push({
          date: item.day || '',
          open: parseFloat(item.open) || 0,
          close: parseFloat(item.close) || 0,
          high: parseFloat(item.high) || 0,
          low: parseFloat(item.low) || 0,
          volume: parseFloat(item.volume) || 0,
          amount: parseFloat(item.amount) || 0
        });
      }
      klineCache.set(cacheKey, { ts: Date.now(), data: result });
      ok(res, result);
    } else {
      ok(res, []);
    }
  } catch (e) {
    console.error('Get kline failed:', e.message);
    fail(res, e, 500);
  }
});

async function calculateWeekOrMonthData(code, period) {
  const dayCacheKey = code + '_day';
  let dayData = klineCache.get(dayCacheKey);

  if (!dayData || Date.now() - dayData.ts > 30 * 60 * 1000) {
    const url = 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=' + toSinaSymbol(code) + '&scale=240&ma=no&datalen=10000&klt=100';
    const resp = await axios.get(url, { headers: { 'Referer': 'https://finance.sina.com.cn' } });

    if (Array.isArray(resp.data) && resp.data.length > 0) {
      const dayResult = [];
      for (let i = 0; i < resp.data.length; i++) {
        const item = resp.data[i];
        dayResult.push({
          date: item.day || '',
          open: parseFloat(item.open) || 0,
          close: parseFloat(item.close) || 0,
          high: parseFloat(item.high) || 0,
          low: parseFloat(item.low) || 0,
          volume: parseFloat(item.volume) || 0,
          amount: parseFloat(item.amount) || 0
        });
      }
      dayData = { ts: Date.now(), data: dayResult };
      klineCache.set(dayCacheKey, dayData);
    } else {
      throw new Error('Cannot get day data');
    }
  }

  if (period === 'week') {
    return aggregateWeekData(dayData.data);
  } else {
    return aggregateMonthData(dayData.data);
  }
}

function aggregateWeekData(dayData) {
  const weeks = {};

  for (let i = 0; i < dayData.length; i++) {
    const item = dayData[i];
    const date = new Date(item.date);
    const startOfWeek = getStartOfWeek(date);
    const weekKey = startOfWeek.toISOString().split('T')[0];

    if (!weeks[weekKey]) {
      weeks[weekKey] = {
        date: weekKey,
        open: item.open,
        close: item.close,
        high: item.high,
        low: item.low,
        volume: item.volume,
        amount: item.amount
      };
    } else {
      weeks[weekKey].close = item.close;
      weeks[weekKey].high = Math.max(weeks[weekKey].high, item.high);
      weeks[weekKey].low = Math.min(weeks[weekKey].low, item.low);
      weeks[weekKey].volume = weeks[weekKey].volume + item.volume;
      weeks[weekKey].amount = weeks[weekKey].amount + item.amount;
    }
  }

  const weekArray = Object.values(weeks);
  weekArray.sort(function (a, b) {
    return a.date.localeCompare(b.date);
  });
  return weekArray;
}

function aggregateMonthData(dayData) {
  const months = {};

  for (let i = 0; i < dayData.length; i++) {
    const item = dayData[i];
    const date = new Date(item.date);
    const monthKey = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-01';

    if (!months[monthKey]) {
      months[monthKey] = {
        date: monthKey,
        open: item.open,
        close: item.close,
        high: item.high,
        low: item.low,
        volume: item.volume,
        amount: item.amount
      };
    } else {
      months[monthKey].close = item.close;
      months[monthKey].high = Math.max(months[monthKey].high, item.high);
      months[monthKey].low = Math.min(months[monthKey].low, item.low);
      months[monthKey].volume = months[monthKey].volume + item.volume;
      months[monthKey].amount = months[monthKey].amount + item.amount;
    }
  }

  const monthArray = Object.values(months);
  monthArray.sort(function (a, b) {
    return a.date.localeCompare(b.date);
  });
  return monthArray;
}

function getStartOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

module.exports = router;
