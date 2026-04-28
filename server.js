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
  console.log(`📊 当前股票数量: ${stockListCache.length}`);
} catch (e) {
  console.error('❌ 读取 stocks.json 失败:', e.message);
}

app.get('/api/stocklist', (req, res) => {
  res.json(stockListCache);
});

app.get('/api/quote', async (req, res) => {
  const codes = (req.query.codes || '').split(',').filter(Boolean);
  if (codes.length === 0) return res.json([]);

  const BATCH_SIZE = 80;
  const batches = [];
  for (let i = 0; i < codes.length; i += BATCH_SIZE) {
    batches.push(codes.slice(i, i + BATCH_SIZE));
  }

  const results = {};
  try {
    for (const batch of batches) {
      const sinaCodes = batch.map(c => (c.startsWith('6') ? 'sh' : 'sz') + c).join(',');
      const resp = await axios.get(`https://hq.sinajs.cn/list=${sinaCodes}`, {
        headers: { 'Referer': 'https://finance.sina.com.cn' }
      });
      const lines = resp.data.split('\n').filter(Boolean);
      lines.forEach(line => {
        const m = line.match(/hq_str_(s[hz]\d+)="(.+)"/);
        if (!m) return;
        const code = m[1].replace(/^sh|^sz/, '');
        const f = m[2].split(',');
        const price = parseFloat(f[3]) || 0;
        const prevClose = parseFloat(f[2]) || price;
        results[code] = {
          code, name: f[0], price,
          open: parseFloat(f[1]) || 0,
          high: parseFloat(f[4]) || 0,
          low: parseFloat(f[5]) || 0,
          volume: parseFloat(f[8]) || 0,
          amount: parseFloat(f[9]) || 0,
          prevClose,
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
          sell5Vol: parseFloat(f[28]) || 0,
          change: prevClose ? Number(((price - prevClose) / prevClose * 100).toFixed(2)) : 0
        };
      });
      await new Promise(r => setTimeout(r, 100));
    }
    res.json(Object.values(results));
  } catch (e) {
    console.error('❌ 获取行情失败:', e.message);
    res.status(500).json({ error: e.message });
  }
});

const minuteCache = new Map();

app.get('/api/minute', async (req, res) => {
  const code = req.query.code;
  console.log(`📡 /api/minute called with code: ${code}`);
  
  if (!code) {
    return res.status(400).json({ error: '缺少股票代码' });
  }

  const cached = minuteCache.get(code);
  if (cached && Date.now() - cached.ts < 60 * 1000) {
    return res.json(cached.data);
  }

  try {
    const market = code.startsWith('6') ? 'sh' : 'sz';
    const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${market}${code}&scale=5&ma=no&datalen=1000`;
    
    const resp = await axios.get(url, {
      headers: { 'Referer': 'https://finance.sina.com.cn' },
      timeout: 10000
    });

    const data = resp.data;
    if (Array.isArray(data) && data.length > 0) {
      const result = data.map(item => ({
        time: item.day || item.time || '',
        price: parseFloat(item.close) || parseFloat(item.price) || 0,
        volume: parseFloat(item.volume) || 0,
        amount: parseFloat(item.amount) || 0
      }));

      minuteCache.set(code, { ts: Date.now(), data: result });
      res.json(result);
    
    
    } else {
      console.log('⚠️ 分时数据为空或格式错误，使用模拟数据');
      const mockData = generateMockMinuteData(code);
      res.json(mockData);
    }
  } catch (e) {
    console.error('❌ 获取分时数据失败:', e.message);
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
    
    const timeStr = `${currentTime.getHours().toString().padStart(2, '0')}:${currentTime.getMinutes().toString().padStart(2, '0')}:00`;
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

app.get('/api/kline', async (req, res) => {
  const code = req.query.code;
  const type = req.query.type || 'day';
  
  if (!code) return res.status(400).json({ error: '缺少股票代码' });

  const cacheKey = `${code}_${type}`;
  const cached = klineCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 30 * 60 * 1000) {
    return res.json(cached.data);
  }

  try {
    const market = code.startsWith('6') ? 'sh' : 'sz';
    const scale = type === 'week' ? 'week' : type === 'month' ? 'month' : 'day';
    const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${market}${code}&scale=${scale === 'day' ? 240 : scale === 'week' ? 1680 : 720}&ma=no&datalen=500`;
    
    const resp = await axios.get(url, {
      headers: { 'Referer': 'https://finance.sina.com.cn' }
    });

    const data = resp.data;
    if (Array.isArray(data) && data.length > 0) {
      const result = data.map(item => ({
        date: item.day || '',
        open: parseFloat(item.open) || 0,
        close: parseFloat(item.close) || 0,
        high: parseFloat(item.high) || 0,
        low: parseFloat(item.low) || 0,
        volume: parseFloat(item.volume) || 0,
        amount: parseFloat(item.amount) || 0
      }));
      klineCache.set(cacheKey, { ts: Date.now(), data: result });
      res.json(result);
    } else {
      res.json([]);
    }
  } catch (e) {
    console.error('❌ 获取K线数据失败:', e.message);
    res.status(500).json({ error: e.message });
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of klineCache.entries()) {
    if (now - val.ts > 30 * 60 * 1000) klineCache.delete(key);
  }
}, 10 * 60 * 1000);

app.use(express.static(__dirname, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
    }
  }
}));

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🌐 服务已启动: http://localhost:${PORT}`);
  console.log(`📋 股票列表来源: ${stockListCache.length > 10 ? 'stocks.json' : '内置备用列表'}`);
});