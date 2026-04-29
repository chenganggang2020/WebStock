const express = require('express');
const axios = require('axios');
const cors = require('cors');
const fs = require('fs');

const app = express();
app.use(cors());

let stockListCache = [];

try {
  const stockData = fs.readFileSync('./stocks.json', 'utf8');
  stockListCache = JSON.parse(stockData);
  console.log('Stock count:', stockListCache.length);
} catch (e) {
  console.error('Read stocks.json failed:', e.message);
}

app.get('/api/stocklist', function (req, res) {
  res.json(stockListCache);
});

app.get('/api/quote', async function (req, res) {
  const codes = (req.query.codes || '').split(',').filter(function (c) { return c; });
  if (codes.length === 0) return res.json([]);

  const BATCH_SIZE = 80;
  const batches = [];
  for (let i = 0; i < codes.length; i += BATCH_SIZE) {
    batches.push(codes.slice(i, i + BATCH_SIZE));
  }

  const results = {};
  try {
    for (let j = 0; j < batches.length; j++) {
      const batch = batches[j];
      const sinaCodes = batch.map(function (c) {
        return (c.startsWith('6') ? 'sh' : 'sz') + c;
      }).join(',');
      const resp = await axios.get('https://hq.sinajs.cn/list=' + sinaCodes, {
        headers: { 'Referer': 'https://finance.sina.com.cn' }
      });
      const lines = resp.data.split('\n').filter(function (l) { return l; });
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
    res.json(Object.values(results));
  } catch (e) {
    console.error('Get quote failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

const minuteCache = new Map();

app.get('/api/minute', async function (req, res) {
  const code = req.query.code;

  if (!code) {
    return res.status(400).json({ error: 'Missing code' });
  }

  const cached = minuteCache.get(code);
  if (cached && Date.now() - cached.ts < 60 * 1000) {
    return res.json(cached.data);
  }

  try {
    const market = code.startsWith('6') ? 'sh' : 'sz';
    const url = 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=' + market + code + '&scale=5&ma=no&datalen=1000';

    const resp = await axios.get(url, {
      headers: { 'Referer': 'https://finance.sina.com.cn' },
      timeout: 10000
    });

    const data = resp.data;
    if (Array.isArray(data) && data.length > 0) {
      const result = [];
      for (let i = 0; i < data.length; i++) {
        const item = data[i];
        result.push({
          time: item.day || item.time || '',
          price: parseFloat(item.close) || parseFloat(item.price) || 0,
          volume: parseFloat(item.volume) || 0,
          amount: parseFloat(item.amount) || 0
        });
      }

      minuteCache.set(code, { ts: Date.now(), data: result });
      res.json(result);
    } else {
      const mockData = generateMockMinuteData(code);
      res.json(mockData);
    }
  } catch (e) {
    const mockData = generateMockMinuteData(code);
    res.json(mockData);
  }
});

function generateMockMinuteData(code) {
  const basePrice = 10 + Math.random() * 20;
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 30);

  const data = [];
  let lastPrice = basePrice;
  let currentTime = new Date(startOfDay);

  while (currentTime <= now && currentTime.getHours() < 15) {
    if (currentTime.getHours() >= 11 && currentTime.getHours() < 13) {
      currentTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 0);
      continue;
    }

    const timeStr = currentTime.getHours().toString().padStart(2, '0') + ':' + currentTime.getMinutes().toString().padStart(2, '0') + ':00';
    const change = (Math.random() - 0.5) * basePrice * 0.005;
    let price = lastPrice + change;
    price = +price.toFixed(2);

    data.push({
      time: timeStr,
      price: price,
      volume: Math.floor(Math.random() * 10000) + 5000,
      amount: price * (Math.floor(Math.random() * 10000) + 5000)
    });

    lastPrice = price;
    currentTime = new Date(currentTime.getTime() + 300000);
  }

  return data;
}

const klineCache = new Map();

app.get('/api/kline', async function (req, res) {
  const code = req.query.code;
  const period = req.query.period || req.query.type || 'day';

  console.log('API kline called:', code, period);

  if (!code) {
    return res.status(400).json({ error: 'Missing code' });
  }

  const cacheKey = code + '_' + period;
  const cached = klineCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 30 * 60 * 1000) {
    return res.json(cached.data);
  }

  if (period === 'week' || period === 'month') {
    try {
      const aggData = await calculateWeekOrMonthData(code, period);
      klineCache.set(cacheKey, { ts: Date.now(), data: aggData });
      res.json(aggData);
    } catch (calcError) {
      res.status(500).json({ error: calcError.message });
    }
    return;
  }

  try {
    const market = code.startsWith('6') ? 'sh' : 'sz';
    const url = 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=' + market + code + '&scale=240&ma=no&datalen=10000&klt=100';
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
      res.json(result);
    } else {
      res.json([]);
    }
  } catch (e) {
    console.error('Get kline failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

async function calculateWeekOrMonthData(code, period) {
  const dayCacheKey = code + '_day';
  let dayData = klineCache.get(dayCacheKey);

  if (!dayData || Date.now() - dayData.ts > 30 * 60 * 1000) {
    const market = code.startsWith('6') ? 'sh' : 'sz';
    const url = 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=' + market + code + '&scale=240&ma=no&datalen=10000&klt=100';
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

app.use(express.static(__dirname));

const PORT = 3000;
app.listen(PORT, function () {
  console.log('Server started: http://localhost:' + PORT);
});
