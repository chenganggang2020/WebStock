const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

const app = express();
app.use(cors());

// 静态文件托管，确保 HTML 以 UTF-8 发送
app.use(express.static(__dirname, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
    }
  }
}));

// 所有 API 响应自动带 charset
app.use('/api', (req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

// ---------- 拼音工具（tiny-pinyin） ----------
let pinyinLib = null;
try {
  pinyinLib = require('tiny-pinyin');
} catch (e) {
  console.log('ℹ️ 未安装 tiny-pinyin，拼音搜索将使用简易映射');
}

function generatePinyin(name) {
  if (pinyinLib && typeof pinyinLib.convertToPinyin === 'function') {
    try {
      const fullWithSpace = pinyinLib.convertToPinyin(name, ' ', true);
      const syllables = fullWithSpace.split(' ').filter(s => s.length > 0);
      const abbr = syllables.map(s => s[0]).join('').toLowerCase();
      const full = fullWithSpace.replace(/\s/g, '').toLowerCase();
      return { full, abbr };
    } catch (e) {
      console.warn('⚠️ tiny-pinyin 转换失败:', name, e.message);
    }
  }
  const map = {
    '平安': 'pa', '万科': 'wk', '招商': 'zs', '兴业': 'xy', '浦发': 'pf',
    '民生': 'ms', '中信': 'zx', '交通': 'jt', '光大': 'gd', '华夏': 'hx',
    '中国': 'zg', '建设': 'js', '农业': 'ny', '工商': 'gs', '北京': 'bj',
    '上海': 'sh', '深圳': 'sz', '广州': 'gz', '南京': 'nj', '宁波': 'nb',
    '贵州茅台': 'gzmt', '五粮液': 'wly', '宁德': 'nd', '比亚迪': 'byd',
    '美的': 'md', '格力': 'gl', '海尔': 'he', '中兴': 'zx', '海康': 'hk'
  };
  let abbr = '';
  for (const [key, val] of Object.entries(map)) {
    if (name.startsWith(key)) { abbr = val; break; }
  }
  if (!abbr) abbr = name.split('').map(c => c.charCodeAt(0) > 127 ? '?' : c.toLowerCase()).join('');
  return { full: abbr, abbr };
}

// ---------- 加载股票列表 ----------
function loadStockList() {
  const filePath = path.join(__dirname, 'stocks.json');
  console.log('🔍 正在读取', filePath);
  try {
    if (!fs.existsSync(filePath)) throw new Error('文件不存在：' + filePath);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const list = JSON.parse(raw);
    if (!Array.isArray(list) || list.length === 0) throw new Error('JSON 内容不是非空数组');
    const processed = [];
    for (const item of list) {
      if (!item.code || !item.name) continue;
      const py = generatePinyin(item.name);
      processed.push({
        code: item.code,
        name: item.name,
        alias: item.name,
        pinyin: py.full,
        abbr: py.abbr
      });
    }
    return processed;
  } catch (err) {
    console.error('❌ 加载 stocks.json 失败:', err.message);
    return [
      { code: '000001', name: '平安银行', pinyin: 'pinganyinhang', abbr: 'payh' },
      { code: '600519', name: '贵州茅台', pinyin: 'guizhoumaotai', abbr: 'gzmt' },
      { code: '300750', name: '宁德时代', pinyin: 'ningdeshidai', abbr: 'ndsd' }
    ];
  }
}

let stockListCache = loadStockList();
console.log(`📊 当前股票数量: ${stockListCache.length}`);

// ---------- HTTP 工具（伪装 + 重试） ----------
const httpAgent = new http.Agent({ keepAlive: false });
const httpsAgent = new https.Agent({ keepAlive: false });

async function fetchWithRetry(url, options = {}, retries = 1, delay = 500) {
  const config = {
    url,
    method: 'get',
    timeout: 8000,
    httpAgent,
    httpsAgent,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': '*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Referer': 'https://finance.sina.com.cn',
      ...options.headers
    }
  };
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await axios(config);
      return resp.data;
    } catch (err) {
      if (i === retries) throw err;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// ---------- 指标计算函数 ----------
function calcMA(data, key, period, outKey) {
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { data[i][outKey] = null; continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j][key];
    data[i][outKey] = parseFloat((sum / period).toFixed(2));
  }
  return data;
}

function calcMACD(data, closeKey = 'close', fast = 12, slow = 26, signal = 9) {
  const dif = [], dea = [], macd = [];
  let emaFast = 0, emaSlow = 0, prevDea = 0;
  for (let i = 0; i < data.length; i++) {
    const c = data[i][closeKey];
    if (i === 0) { emaFast = c; emaSlow = c; }
    else {
      const kf = 2 / (fast + 1), ks = 2 / (slow + 1);
      emaFast = (c - emaFast) * kf + emaFast;
      emaSlow = (c - emaSlow) * ks + emaSlow;
    }
    const d = emaFast - emaSlow;
    dif.push(d);
    if (i < slow - 1) { dea.push(null); macd.push(null); continue; }
    if (i === slow - 1) { dea.push(d); macd.push(0); prevDea = d; }
    else {
      const kd = 2 / (signal + 1);
      prevDea = (d - prevDea) * kd + prevDea;
      dea.push(prevDea);
      macd.push((d - prevDea) * 2);
    }
  }
  return { dif, dea, macd };
}

function calcKDJ(data, highKey='high', lowKey='low', closeKey='close', n=9, m1=3, m2=3) {
  const k = [], d = [], j = [];
  let prevK = 50, prevD = 50;
  for (let i = 0; i < data.length; i++) {
    if (i < n - 1) { k.push(null); d.push(null); j.push(null); continue; }
    const slice = data.slice(i - n + 1, i + 1);
    const highest = Math.max(...slice.map(x => x[highKey]));
    const lowest = Math.min(...slice.map(x => x[lowKey]));
    const rsv = highest === lowest ? 50 : ((data[i][closeKey] - lowest) / (highest - lowest)) * 100;
    const curK = (2 / (m1 + 1)) * prevK + (1 - 2 / (m1 + 1)) * rsv;
    const curD = (2 / (m2 + 1)) * prevD + (1 - 2 / (m2 + 1)) * curK;
    const curJ = 3 * curK - 2 * curD;
    k.push(+curK.toFixed(2)); d.push(+curD.toFixed(2)); j.push(+curJ.toFixed(2));
    prevK = curK; prevD = curD;
  }
  return { k, d, j };
}

// 新增指标
function calcRSI(data, closeKey='close', period=14) {
  const rsi = [];
  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < data.length; i++) {
    if (i === 0) { rsi.push(null); continue; }
    const change = data[i][closeKey] - data[i-1][closeKey];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    if (i < period) {
      avgGain += gain;
      avgLoss += loss;
      if (i === period - 1) {
        avgGain /= period;
        avgLoss /= period;
        rsi.push(avgLoss === 0 ? 100 : +(100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
      } else {
        rsi.push(null);
      }
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      rsi.push(avgLoss === 0 ? 100 : +(100 - 100 / (1 + avgGain / avgLoss)).toFixed(2));
    }
  }
  return rsi;
}

function calcCCI(data, highKey='high', lowKey='low', closeKey='close', period=14) {
  const cci = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { cci.push(null); continue; }
    const tp = (data[i][highKey] + data[i][lowKey] + data[i][closeKey]) / 3;
    let sumTP = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumTP += (data[j][highKey] + data[j][lowKey] + data[j][closeKey]) / 3;
    }
    const avgTP = sumTP / period;
    let sumDev = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumDev += Math.abs((data[j][highKey] + data[j][lowKey] + data[j][closeKey]) / 3 - avgTP);
    }
    const meanDev = sumDev / period;
    cci.push(meanDev === 0 ? 0 : +((tp - avgTP) / (0.015 * meanDev)).toFixed(2));
  }
  return cci;
}

function calcOBV(data, closeKey='close', volumeKey='volume') {
  const obv = [];
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      sum = data[i][volumeKey];
      obv.push(sum);
    } else {
      if (data[i][closeKey] > data[i-1][closeKey]) sum += data[i][volumeKey];
      else if (data[i][closeKey] < data[i-1][closeKey]) sum -= data[i][volumeKey];
      // 持平则不变
      obv.push(sum);
    }
  }
  return obv;
}

function calcVWAP(data, highKey='high', lowKey='low', closeKey='close', volumeKey='volume') {
  const vwap = [];
  let cumVolume = 0, cumPriceVolume = 0;
  for (let i = 0; i < data.length; i++) {
    const typicalPrice = (data[i][highKey] + data[i][lowKey] + data[i][closeKey]) / 3;
    const volume = data[i][volumeKey];
    cumPriceVolume += typicalPrice * volume;
    cumVolume += volume;
    if (cumVolume > 0) {
      vwap.push(+(cumPriceVolume / cumVolume).toFixed(2));
    } else {
      vwap.push(null);
    }
  }
  return vwap;
}

function calcATR(data, highKey='high', lowKey='low', closeKey='close', period=14) {
  const atr = [];
  let prevATR = 0;
  for (let i = 0; i < data.length; i++) {
    const high = data[i][highKey], low = data[i][lowKey], close = data[i-1] ? data[i-1][closeKey] : data[i][closeKey];
    const tr = Math.max(high - low, Math.abs(high - close), Math.abs(low - close));
    if (i < period - 1) {
      atr.push(null);
      continue;
    }
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) {
        const hh = data[j][highKey], ll = data[j][lowKey], cc = j > 0 ? data[j-1][closeKey] : data[j][closeKey];
        sum += Math.max(hh - ll, Math.abs(hh - cc), Math.abs(ll - cc));
      }
      prevATR = sum / period;
    } else {
      prevATR = (prevATR * (period - 1) + tr) / period;
    }
    atr.push(+prevATR.toFixed(2));
  }
  return atr;
}

// ---------- 路由 ----------
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
          prevClose,
          change: prevClose ? parseFloat(((price - prevClose) / prevClose * 100).toFixed(2)) : 0
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

const klineCache = new Map();
let pendingKline = 0;

app.get('/api/kline', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).json({ error: '缺少股票代码' });

  const cached = klineCache.get(code);
  if (cached && Date.now() - cached.ts < 15 * 60 * 1000) {
    console.log(`📦 命中缓存: ${code}`);
    return res.json(cached.data);
  }

  while (pendingKline >= 2) await new Promise(r => setTimeout(r, 100));
  pendingKline++;
  try {
    const market = code.startsWith('6') ? 'sh' : 'sz';
    const symbol = market + code;
    const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${symbol}&scale=240&ma=5,10,15,30&datalen=400`;
    const resp = await fetchWithRetry(url);
    if (!Array.isArray(resp) || resp.length === 0) throw new Error('新浪K线返回空');

    let rawData = resp.map(item => ({
      date: item.day,
      open: parseFloat(item.open) || 0,
      close: parseFloat(item.close) || 0,
      high: parseFloat(item.high) || 0,
      low: parseFloat(item.low) || 0,
      volume: parseFloat(item.volume) || 0,
      ma5: parseFloat(item.ma5) || null,
      ma10: parseFloat(item.ma10) || null,
      ma15: parseFloat(item.ma15) || null,
      ma30: parseFloat(item.ma30) || null
    }));

    // 确保均线数据有效
    if (rawData.length > 0 && rawData[0].ma5 === undefined) {
      rawData = calcMA(rawData, 'close', 5, 'ma5');
      rawData = calcMA(rawData, 'close', 10, 'ma10');
      rawData = calcMA(rawData, 'close', 15, 'ma15');
      rawData = calcMA(rawData, 'close', 30, 'ma30');
    }

    const macd = calcMACD(rawData);
    const kdj = calcKDJ(rawData);
    const rsi = calcRSI(rawData);
    const cci = calcCCI(rawData);
    const obv = calcOBV(rawData);
    const vwap = calcVWAP(rawData);
    const atr = calcATR(rawData);

    const enriched = rawData.map((d, i) => ({
      ...d,
      macd_dif: macd.dif[i] !== null ? +macd.dif[i].toFixed(4) : null,
      macd_dea: macd.dea[i] !== null ? +macd.dea[i].toFixed(4) : null,
      macd_bar: macd.macd[i] !== null ? +macd.macd[i].toFixed(4) : null,
      kdj_k: kdj.k[i],
      kdj_d: kdj.d[i],
      kdj_j: kdj.j[i],
      rsi: rsi[i],
      cci: cci[i],
      obv: obv[i],
      vwap: vwap[i],
      atr: atr[i]
    }));

    klineCache.set(code, { data: enriched, ts: Date.now() });
    console.log(`✅ 已缓存K线: ${code}`);
    res.json(enriched);
  } catch (e) {
    console.error(`❌ 获取K线失败 [${code}]:`, e.message);
    res.status(502).json({ error: 'K线数据获取失败，请稍后重试' });
  } finally {
    pendingKline--;
  }
});

// 定期清理 K 线缓存
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of klineCache.entries()) {
    if (now - val.ts > 30 * 60 * 1000) klineCache.delete(key);
  }
}, 10 * 60 * 1000);

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🌐 服务已启动: http://localhost:${PORT}`);
  console.log(`📋 股票列表来源: ${stockListCache.length > 10 ? 'stocks.json' : '内置备用列表'}`);
});