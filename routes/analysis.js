const express = require('express');
const router = express.Router();

const axios = require('axios');
const iconv = require('iconv-lite');
const fs = require('fs');

const { isValidApiKey, createAIModelStream, callAIModel, getAIConfig } = require('./ai');
const { klineCache } = require('./cache');
const { toSinaSymbol, getEastmoneyMarketId } = require('../utils/market');

let promptTemplate = '';

function loadPromptTemplate() {
  try {
    promptTemplate = fs.readFileSync('./prompt.md', 'utf8');
    console.log('[Prompt] 模板加载成功，长度：' + promptTemplate.length);
  } catch (e) {
    console.error('[Prompt] 加载 prompt.md 失败：' + e.message + '，将使用内置默认模板');
    promptTemplate = `你是一位资深股票分析师，请根据以下数据，对"{{STOCK_NAME}}（{{STOCK_CODE}}）"进行全面深度分析，生成一份专业分析报告。

数据时间：{{DATA_TIME}}

{{DATA_SUMMARY}}

请按以下结构撰写分析报告（使用 Markdown 格式）：

# 📊 {{STOCK_NAME}}（{{STOCK_CODE}}）个股深度分析报告

> 生成时间：{{DATA_TIME}}

---

## 一、公司概况与行业定位
（结合股票名称和所属板块，分析公司的行业地位、主营业务、核心竞争力）

## 二、基本面分析
（基于PE、PB、市值、换手率、主力资金流向，评估估值水平和投资价值）

## 三、技术面分析
（基于均线系统、MACD、成交量、支撑压力位，分析当前趋势、入场时机和风险提示）

## 四、财报解读
（如有财报数据，解读营收增长、盈利能力、ROE 水平；如无数据则说明）

## 五、风险提示与操作建议
（综合基本面和技术面，给出风险提示，包括：短期风险、中期风险、建议观测点）
（操作建议需分场景：激进型、稳健型、保守型）

## 六、综合评分
（给出 0-10 分的综合评分，并简要说明打分理由）

---
> ⚠️ **免责声明**：本报告基于公开数据和 AI 分析，仅供参考，不构成投资建议。股市有风险，投资需谨慎。

要求：
1. 分析要专业、深入，体现资深分析师水准
2. 结合数据给出具体、可操作的建议
3. 风险提示要到位，不要过度乐观
4. 使用 Markdown 格式，排版清晰
5. 总字数控制在 1500-2500 字`;
  }
}
loadPromptTemplate();

function ok(res, data) {
  res.json({ success: true, data });
}

function fail(res, error, status = 400) {
  res.status(status).json({ success: false, error: error.message || String(error) });
}

router.get('/reload-prompt', function (req, res) {
  try {
    loadPromptTemplate();
    ok(res, { length: promptTemplate.length });
  } catch (e) {
    fail(res, e, 500);
  }
});

function buildPrompt(stockName, code, quote, tech, macd, stockInfo, financial, industry, klineData) {
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  let dataSummary = '';

  if (quote) {
    dataSummary += `【实时行情】最新价：${quote.price.toFixed(2)}，涨跌幅：${quote.change.toFixed(2)}%，今开：${quote.open?.toFixed(2) || '-'}，最高：${quote.high?.toFixed(2) || '-'}，最低：${quote.low?.toFixed(2) || '-'}，成交额：${((quote.amount || 0) / 100000000).toFixed(2)}亿\n`;
  }

  if (stockInfo) {
    dataSummary += `【基本面】市盈率(PE)：${stockInfo.pe || '-'}，市净率(PB)：${stockInfo.pb || '-'}，换手率：${(stockInfo.turnoverRate || 0).toFixed(2)}%，总市值：${((stockInfo.marketCap || 0) / 100000000).toFixed(2)}亿，流通市值：${((stockInfo.circulatingMktCap || 0) / 100000000).toFixed(2)}亿，主力净流入：${stockInfo.netInflow || 0}元\n`;
  }

  if (tech) {
    dataSummary += `【技术指标】趋势：${tech.trend}，MA5：${tech.ma5}，MA10：${tech.ma10}，MA20：${tech.ma20}，近60日高点：${tech.high60}，近60日低点：${tech.low60}，近5日涨跌：${tech.change5}%，近60日振幅：${tech.amp20}%，量能状态：${tech.volTrend}，支撑位：${tech.support}，压力位：${tech.resistance}\n`;
  }

  if (macd) {
    dataSummary += `【MACD】信号：${macd.signal}，DIF：${macd.dif}，DEA：${macd.dea}，MACD柱：${macd.bar}\n`;
  }

  if (industry) {
    dataSummary += `【所属板块】${industry}\n`;
  }

  if (financial && financial.length > 0) {
    dataSummary += `【近期财报】\n`;
    financial.forEach(f => {
      dataSummary += `  报告期：${f.date}，EPS：${f.eps?.toFixed(3) || '-'}，营收同比：${f.revenueYoy ? (f.revenueYoy * 100).toFixed(1) + '%' : '-'}，ROE：${f.roe?.toFixed(2) || '-'}%，净利润：${((f.netProfit || 0) / 100000000).toFixed(2)}亿\n`;
    });
  }

  if (klineData && klineData.length > 0) {
    dataSummary += `\n【历史行情】（最近${Math.min(klineData.length, 200)}日）\n`;
    dataSummary += `日期       开盘    收盘    最高    最低     成交量(手)\n`;
    const recent = klineData.slice(-200);
    recent.forEach(k => {
      let date, open, close, high, low, vol;
      if (typeof k === 'string') {
        const parts = k.split(',');
        if (parts.length < 6) return;
        date = parts[0];
        open = parseFloat(parts[1]);
        close = parseFloat(parts[2]);
        high = parseFloat(parts[3]);
        low = parseFloat(parts[4]);
        vol = parseInt(parts[5]);
      } else if (typeof k === 'object' && k !== null) {
        date = k.date || '';
        open = parseFloat(k.open) || 0;
        close = parseFloat(k.close) || 0;
        high = parseFloat(k.high) || 0;
        low = parseFloat(k.low) || 0;
        vol = parseInt(k.volume) || 0;
      } else {
        return;
      }
      dataSummary += `${date}  ${open.toFixed(2).padStart(7)}  ${close.toFixed(2).padStart(7)}  ${high.toFixed(2).padStart(7)}  ${low.toFixed(2).padStart(7)}  ${vol}\n`;
    });
  }

  return promptTemplate
    .replace(/\{\{STOCK_NAME\}\}/g, stockName)
    .replace(/\{\{STOCK_CODE\}\}/g, code)
    .replace(/\{\{DATA_TIME\}\}/g, now)
    .replace(/\{\{DATA_SUMMARY\}\}/g, dataSummary);
}

async function generateAIAnalysis(stockName, code, quote, tech, macd, stockInfo, financial, industry, klineData) {
  const aiConfig = getAIConfig();
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const prompt = buildPrompt(stockName, code, quote, tech, macd, stockInfo, financial, industry, klineData);

  if (!isValidApiKey(aiConfig && aiConfig.apiKey)) {
    console.log('[AI] 未检测到有效 API Key，进入模拟 AI 模式');
    return '[SIMULATED_AI]\n' + prompt;
  }

  const analysisLog = `<!-- ${now} | ${stockName}(${code}) -->\n${prompt}\n\n---\n`;
  try {
    fs.writeFileSync('./analysis.md', analysisLog, 'utf8');
    console.log('[AI] 已保存分析请求到 analysis.md');
  } catch (e) {
    console.error('[AI] 保存 analysis.md 失败：', e.message);
  }

  return await callAIModel(prompt);
}

async function fetchStockInfo(code) {
  try {
    const market = getEastmoneyMarketId(code);
    const url = `https://push2.eastmoney.com/api/qt/stock/get?fields=f57,f58,f84,f85,f116,f117,f162,f167,f168,f169,f170,f171,f172,f173,f62,f66,f69&fltt=2&invt=2&secid=${market}.${code}`;
    const resp = await axios.get(url, {
      headers: { 'Referer': 'https://www.eastmoney.com', 'User-Agent': 'Mozilla/5.0' },
      timeout: 8000
    });
    const data = resp.data && resp.data.data;
    if (!data) return null;
    return {
      totalShares: data.f84,
      circulatingShares: data.f85,
      marketCap: data.f116,
      circulatingMktCap: data.f117,
      pe: data.f162,
      pb: data.f167,
      turnoverRate: data.f168,
      volumeRatio: data.f169,
      amplitude: data.f170,
      fiftyTwoHigh: data.f174,
      fiftyTwoLow: data.f175,
      netInflow: data.f62,
    };
  } catch (e) {
    return null;
  }
}

function getTradeMarket(code) {
  if (code.startsWith('688')) return '科创板';
  if (code.startsWith('689')) return '科创板';
  if (code.startsWith('6')) return '沪市主板';
  if (code.startsWith('900')) return '沪市B股';
  if (code.startsWith('000')) return '深市主板';
  if (code.startsWith('001')) return '深市主板';
  if (code.startsWith('002')) return '深市主板';
  if (code.startsWith('003')) return '深市主板';
  if (code.startsWith('300')) return '创业板';
  if (code.startsWith('301')) return '创业板';
  if (code.startsWith('400')) return '老三板';
  if (code.startsWith('800')) return '老三板';
  if (code.startsWith('430')) return '北交所';
  if (code.startsWith('830')) return '北交所';
  if (code.startsWith('831')) return '北交所';
  if (code.startsWith('832')) return '北交所';
  if (code.startsWith('833')) return '北交所';
  if (code.startsWith('834')) return '北交所';
  if (code.startsWith('835')) return '北交所';
  if (code.startsWith('836')) return '北交所';
  if (code.startsWith('837')) return '北交所';
  if (code.startsWith('838')) return '北交所';
  if (code.startsWith('839')) return '北交所';
  if (code.startsWith('870')) return '北交所';
  if (code.startsWith('871')) return '北交所';
  if (code.startsWith('872')) return '北交所';
  if (code.startsWith('873')) return '北交所';
  if (code.startsWith('874')) return '北交所';
  if (code.startsWith('875')) return '北交所';
  if (code.startsWith('876')) return '北交所';
  if (code.startsWith('877')) return '北交所';
  if (code.startsWith('878')) return '北交所';
  if (code.startsWith('879')) return '北交所';
  if (code.startsWith('8')) return '北交所';
  if (code.startsWith('4')) return '北交所';
  return '未知';
}

async function fetchStockIndustry(code) {
  try {
    const finUrl = `https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/ZYZBAjaxNew?type=0&code=${toSinaSymbol(code)}`;
    const finResp = await axios.get(finUrl, {
      headers: { 'Referer': 'https://emweb.securities.eastmoney.com', 'User-Agent': 'Mozilla/5.0' },
      timeout: 8000
    });

    const tradeMarket = getTradeMarket(code);
    const finData = finResp.data && finResp.data.data;
    if (finData && finData.length > 0) {
      const orgType = finData[0].ORG_TYPE;
      const secType = finData[0].SECURITY_TYPE;
      if (orgType) {
        return `${tradeMarket} ${orgType}${secType ? ' ' + secType : ''}`.trim();
      } else {
        return tradeMarket;
      }
    }

    return tradeMarket;
  } catch (e) {
    console.error('获取行业信息失败:', e.message);
    return getTradeMarket(code);
  }
}

async function fetchFinancialData(code) {
  try {
    const finUrl = `https://emweb.securities.eastmoney.com/PC_HSF10/NewFinanceAnalysis/ZYZBAjaxNew?type=0&code=${toSinaSymbol(code)}`;
    const finResp = await axios.get(finUrl, {
      headers: { 'Referer': 'https://emweb.securities.eastmoney.com', 'User-Agent': 'Mozilla/5.0' },
      timeout: 8000
    });
    const rows = finResp.data && finResp.data.data;
    if (rows && rows.length > 0) {
      return rows.slice(0, 2).map(r => ({
        date: r.REPORT_DATE ? r.REPORT_DATE.substring(0, 10) : (r.REPORTDATE ? r.REPORTDATE.substring(0, 10) : '-'),
        eps: r.EPSJB || r.BASIC_EPS,
        revenue: r.TOTALOPERATEREVE || r.TOTAL_OPERATE_INCOME,
        revenueYoy: r.TOTALOPERATEREVETZ ? r.TOTALOPERATEREVETZ / 100 : (r.YSTZ ? r.YSTZ / 100 : null),
        netProfit: r.PARENTNETPROFIT || r.NETPROFIT,
        roe: r.ROEJQ || r.WEIGHTAVG_ROE
      }));
    }
    return null;
  } catch (e) {
    return null;
  }
}

function calcTechSummary(klineData) {
  if (!klineData || klineData.length < 30) return null;
  const recent = klineData.slice(-60);
  const last = recent[recent.length - 1];
  const closes = recent.map(d => d.close);

  const ma5 = closes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const ma10 = closes.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const ma60 = closes.length >= 60 ? closes.slice(-60).reduce((a, b) => a + b, 0) / 60 : null;

  const high60 = Math.max(...recent.map(d => d.high));
  const low60 = Math.min(...recent.map(d => d.low));

  const change5 = ((last.close - closes[closes.length - 6]) / closes[closes.length - 6] * 100).toFixed(2);

  const amp20 = ((high60 - low60) / low60 * 100).toFixed(2);

  const vols = recent.map(d => d.volume);
  const avgVol5 = vols.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const avgVol20 = vols.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const volTrend = avgVol5 > avgVol20 * 1.2 ? '放量' : avgVol5 < avgVol20 * 0.8 ? '缩量' : '温和';

  let trend = '震荡';
  if (last.close > ma5 && ma5 > ma10 && ma10 > ma20) trend = '多头排列（上升趋势）';
  else if (last.close < ma5 && ma5 < ma10 && ma10 < ma20) trend = '空头排列（下降趋势）';
  else if (last.close > ma20) trend = '震荡偏强';
  else trend = '震荡偏弱';

  const support = Math.min(ma5, ma10, ma20).toFixed(2);
  const resistance = Math.max(ma5, ma10, ma20).toFixed(2);

  return {
    price: last.close,
    ma5: ma5.toFixed(2), ma10: ma10.toFixed(2), ma20: ma20.toFixed(2),
    ma60: ma60 ? ma60.toFixed(2) : null,
    high60: high60.toFixed(2), low60: low60.toFixed(2),
    change5, amp20, volTrend, trend, support, resistance,
    totalCandles: klineData.length,
    recentDate: last.date
  };
}

function calcMACDSignal(klineData) {
  if (!klineData || klineData.length < 35) return null;
  const closes = klineData.map(d => d.close);
  const shortAlpha = 2 / 13, longAlpha = 2 / 27, signalAlpha = 2 / 10;
  let emaShort = closes[0], emaLong = closes[0], dea = 0;
  const macdBars = [];
  for (let i = 1; i < closes.length; i++) {
    emaShort = closes[i] * shortAlpha + emaShort * (1 - shortAlpha);
    emaLong = closes[i] * longAlpha + emaLong * (1 - longAlpha);
    const dif = emaShort - emaLong;
    dea = dif * signalAlpha + dea * (1 - signalAlpha);
    macdBars.push({ dif, dea, bar: (dif - dea) * 2 });
  }
  const last5 = macdBars.slice(-5);
  const lastBar = last5[last5.length - 1];
  let signal = '中性';
  if (lastBar.dif > 0 && lastBar.bar > 0 && lastBar.bar > last5[last5.length - 2].bar) signal = '多头增强（MACD 柱放大）';
  else if (lastBar.dif > 0 && lastBar.bar > 0) signal = '多头（MACD 0轴上方）';
  else if (lastBar.dif < 0 && lastBar.bar < 0) signal = '空头（MACD 0轴下方）';
  else if (lastBar.dif > 0 && lastBar.bar < 0) signal = '多头减弱（金叉后回落）';
  return { dif: lastBar.dif.toFixed(4), dea: lastBar.dea.toFixed(4), bar: lastBar.bar.toFixed(4), signal };
}

function generateAnalysisReport(stockName, code, quote, tech, macd, stockInfo, financial, industry) {
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const changeStr = quote ? (quote.change >= 0 ? `+${quote.change.toFixed(2)}` : `${quote.change.toFixed(2)}`) + '%' : '-';

  let report = `# 📊 ${stockName}（${code}）个股分析报告\n\n`;
  report += `> 生成时间：${now}\n\n---\n\n`;

  report += `## 一、基本行情\n\n`;
  if (quote) {
    report += `| 指标 | 数值 |\n|------|------|\n`;
    report += `| 最新价 | **${quote.price.toFixed(2)}** |\n`;
    report += `| 今日涨跌幅 | ${quote.change >= 0 ? '🔴' : '🟢'} ${changeStr} |\n`;
    report += `| 今开 | ${quote.open?.toFixed(2) || '-'} |\n`;
    report += `| 最高 | ${quote.high?.toFixed(2) || '-'} |\n`;
    report += `| 最低 | ${quote.low?.toFixed(2) || '-'} |\n`;
    report += `| 昨收 | ${quote.prevClose?.toFixed(2) || '-'} |\n`;
    if (quote.volume) report += `| 成交量 | ${(quote.volume / 10000).toFixed(2)} 万手 |\n`;
    if (quote.amount) report += `| 成交额 | ${(quote.amount / 100000000).toFixed(2)} 亿 |\n`;
  }
  if (stockInfo) {
    if (stockInfo.pe) report += `| 市盈率(动) | ${stockInfo.pe} |\n`;
    if (stockInfo.pb) report += `| 市净率 | ${stockInfo.pb} |\n`;
    if (stockInfo.turnoverRate) report += `| 换手率 | ${stockInfo.turnoverRate}% |\n`;
    if (stockInfo.marketCap) report += `| 总市值 | ${(stockInfo.marketCap / 100000000).toFixed(2)} 亿 |\n`;
  }
  report += '\n';

  if (industry) {
    report += `## 二、行业 & 板块\n\n`;
    report += `**所属板块：** ${industry}\n\n`;
  }

  if (tech) {
    report += `## 三、技术面分析\n\n`;
    report += `**趋势研判：** ${tech.trend}\n\n`;
    report += `| 指标 | 数值 |\n|------|------|\n`;
    report += `| MA5 | ${tech.ma5} |\n`;
    report += `| MA10 | ${tech.ma10} |\n`;
    report += `| MA20 | ${tech.ma20} |\n`;
    if (tech.ma60) report += `| MA60 | ${tech.ma60} |\n`;
    report += `| 近60日高点 | ${tech.high60} |\n`;
    report += `| 近60日低点 | ${tech.low60} |\n`;
    report += `| 近5日涨跌 | ${tech.change5}% |\n`;
    report += `| 近60日振幅 | ${tech.amp20}% |\n`;
    report += `| 量能状态 | ${tech.volTrend} |\n`;
    report += '\n';
    report += `**关键价位：**\n- 支撑位：约 **${tech.support}**\n- 压力位：约 **${tech.resistance}**\n\n`;
  }

  if (macd) {
    report += `**MACD 信号：** ${macd.signal}\n`;
    report += `- DIF：${macd.dif}，DEA：${macd.dea}，MACD柱：${macd.bar}\n\n`;
  }

  if (financial && financial.length > 0) {
    report += `## 四、近期业绩摘要\n\n`;
    report += `| 报告期 | 每股收益 | 营收同比 | ROE |\n|--------|---------|---------|-----|\n`;
    financial.forEach(f => {
      const eps = f.eps ? f.eps.toFixed(3) : '-';
      const yoy = f.revenueYoy ? (f.revenueYoy * 100).toFixed(1) + '%' : '-';
      const roe = f.roe ? f.roe.toFixed(2) + '%' : '-';
      report += `| ${f.date} | ${eps} | ${yoy} | ${roe} |\n`;
    });
    report += '\n';
  }

  report += `## 五、综合研判\n\n`;
  const signals = [];
  if (tech) {
    if (tech.trend.includes('上升') || tech.trend.includes('偏强')) signals.push('📈 均线结构偏多');
    else if (tech.trend.includes('下降') || tech.trend.includes('偏弱')) signals.push('📉 均线结构偏空');
    else signals.push('↔️ 均线震荡整理');
    if (tech.volTrend === '放量') signals.push('📊 成交量放大，关注方向');
    if (tech.volTrend === '缩量') signals.push('📊 成交量萎缩，观望为主');
  }
  if (macd) {
    if (macd.signal.includes('多头')) signals.push('✅ MACD 多头信号');
    else if (macd.signal.includes('空头')) signals.push('⚠️ MACD 空头信号');
  }
  if (stockInfo && stockInfo.pe) {
    const pe = parseFloat(stockInfo.pe);
    if (pe > 0 && pe < 20) signals.push('💰 估值偏低（PE < 20）');
    else if (pe > 50) signals.push('⚠️ 估值偏高（PE > 50），注意风险');
    else if (pe > 0) signals.push('📌 估值适中');
  }
  if (stockInfo && stockInfo.netInflow) {
    const inflow = parseFloat(stockInfo.netInflow);
    if (inflow > 0) signals.push('💹 今日主力净流入资金');
    else if (inflow < 0) signals.push('🔻 今日主力净流出资金');
  }

  if (signals.length > 0) {
    signals.forEach(s => { report += `- ${s}\n`; });
  } else {
    report += `- 数据获取中，请稍后重试\n`;
  }

  report += `\n> ⚠️ **免责声明：** 本报告基于公开数据和技术指标自动生成，仅供参考，不构成投资建议。股市有风险，投资需谨慎。`;
  return report;
}

router.get('/analysis', async function (req, res) {
  const code = req.query.code;
  const name = req.query.name || code;
  if (!code) return fail(res, '缺少股票代码');

  try {
    const [quoteResp, klineResp, stockInfo, financial, industry] = await Promise.allSettled([
      axios.get(`https://hq.sinajs.cn/list=${toSinaSymbol(code)}`, {
        headers: { 'Referer': 'https://finance.sina.com.cn' }, timeout: 6000, responseType: 'arraybuffer'
      }),
      (async () => {
        const cacheKey = code + '_day';
        const cached = klineCache.get(cacheKey);
        if (cached && Date.now() - cached.ts < 30 * 60 * 1000) return cached.data;
        const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${toSinaSymbol(code)}&scale=240&ma=no&datalen=200&klt=100`;
        const r = await axios.get(url, { headers: { 'Referer': 'https://finance.sina.com.cn' }, timeout: 8000 });
        if (Array.isArray(r.data) && r.data.length > 0) {
          const data = r.data.map(item => ({
            date: item.day || '', open: parseFloat(item.open) || 0, close: parseFloat(item.close) || 0,
            high: parseFloat(item.high) || 0, low: parseFloat(item.low) || 0,
            volume: parseFloat(item.volume) || 0, amount: parseFloat(item.amount) || 0
          }));
          klineCache.set(cacheKey, { ts: Date.now(), data });
          return data;
        }
        return [];
      })(),
      fetchStockInfo(code),
      fetchFinancialData(code),
      fetchStockIndustry(code)
    ]);

    let quote = null;
    if (quoteResp.status === 'fulfilled') {
      const raw = iconv.decode(Buffer.from(quoteResp.value.data), 'gbk');
      const lines = raw.split('\n').filter(l => l);
      if (lines.length > 0) {
        const m = lines[0].match(/hq_str_s[hz]\d+="(.+)"/);
        if (m) {
          const f = m[1].split(',');
          const price = parseFloat(f[3]) || 0;
          const prevClose = parseFloat(f[2]) || price;
          quote = {
            name: f[0], price, prevClose,
            open: parseFloat(f[1]) || 0, high: parseFloat(f[4]) || 0, low: parseFloat(f[5]) || 0,
            volume: parseFloat(f[8]) || 0, amount: parseFloat(f[9]) || 0,
            change: prevClose ? Number(((price - prevClose) / prevClose * 100).toFixed(2)) : 0
          };
        }
      }
    }

    const klineData = klineResp.status === 'fulfilled' ? klineResp.value : [];
    const tech = calcTechSummary(klineData);
    const macd = calcMACDSignal(klineData);
    const info = stockInfo.status === 'fulfilled' ? stockInfo.value : null;
    const fin = financial.status === 'fulfilled' ? financial.value : null;
    const ind = industry.status === 'fulfilled' ? industry.value : null;

    const stockNameResolved = (quote && quote.name) ? quote.name : name;

    const aiConfig = getAIConfig();
    let report = '';
    let useAI = false;
    let simulatedAI = false;
    let promptText = '';

    if (!aiConfig) {
      return fail(res, 'OpenAI 配置未加载，请检查 OPENAI_API_KEY / ai-config.json');
    }

    try {
      console.log('[AI] 正在调用大模型生成分析报告…');
      const result = await generateAIAnalysis(stockNameResolved, code, quote, tech, macd, info, fin, ind, klineData);

      if (result.startsWith('[SIMULATED_AI]')) {
        const fullPrompt = result.replace('[SIMULATED_AI]\n', '');
        report = fullPrompt;
        promptText = fullPrompt;
        simulatedAI = true;
        useAI = false;
        console.log('[AI] 进入模拟 AI 模式，返回拼接数据供用户自行分析');
      } else {
        report = result;
        useAI = true;
        console.log('[AI] 大模型分析生成成功，长度：' + report.length);
      }
    } catch (aiErr) {
      console.error('[AI] 大模型调用失败：', aiErr.message);
      return fail(res, 'AI 分析失败: ' + aiErr.message);
    }

    ok(res, {
      report,
      aiUsed: useAI,
      simulatedAI: simulatedAI,
      promptText: promptText,
      aiError: null,
      data: { quote, tech, macd, info, financial: fin, industry: ind }
    });
  } catch (e) {
    console.error('Analysis failed:', e.message);
    fail(res, e, 500);
  }
});

router.get('/analysis-stream', async function (req, res) {
  const code = req.query.code;
  const name = req.query.name || code;
  if (!code) return fail(res, '缺少股票代码');

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  function sendEvent(data) {
    res.write('data: ' + JSON.stringify(data) + '\n\n');
  }

  try {
    const [quoteResp, klineResp, stockInfo, financial, industry] = await Promise.allSettled([
      axios.get(`https://hq.sinajs.cn/list=${toSinaSymbol(code)}`, {
        headers: { 'Referer': 'https://finance.sina.com.cn' }, timeout: 6000, responseType: 'arraybuffer'
      }),
      (async () => {
        const cacheKey = code + '_day';
        const cached = klineCache.get(cacheKey);
        if (cached && Date.now() - cached.ts < 30 * 60 * 1000) return cached.data;
        const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${toSinaSymbol(code)}&scale=240&ma=no&datalen=200&klt=100`;
        const r = await axios.get(url, { headers: { 'Referer': 'https://finance.sina.com.cn' }, timeout: 8000 });
        if (Array.isArray(r.data) && r.data.length > 0) {
          const data = r.data.map(item => ({
            date: item.day || '', open: parseFloat(item.open) || 0, close: parseFloat(item.close) || 0,
            high: parseFloat(item.high) || 0, low: parseFloat(item.low) || 0,
            volume: parseFloat(item.volume) || 0, amount: parseFloat(item.amount) || 0
          }));
          klineCache.set(cacheKey, { ts: Date.now(), data });
          return data;
        }
        return [];
      })(),
      fetchStockInfo(code),
      fetchFinancialData(code),
      fetchStockIndustry(code)
    ]);

    let quote = null;
    if (quoteResp.status === 'fulfilled') {
      const raw = iconv.decode(Buffer.from(quoteResp.value.data), 'gbk');
      const lines = raw.split('\n').filter(l => l);
      if (lines.length > 0) {
        const m = lines[0].match(/hq_str_s[hz]\d+="(.+)"/);
        if (m) {
          const f = m[1].split(',');
          const price = parseFloat(f[3]) || 0;
          const prevClose = parseFloat(f[2]) || price;
          quote = {
            name: f[0], price, prevClose,
            open: parseFloat(f[1]) || 0, high: parseFloat(f[4]) || 0, low: parseFloat(f[5]) || 0,
            volume: parseFloat(f[8]) || 0, amount: parseFloat(f[9]) || 0,
            change: prevClose ? Number(((price - prevClose) / prevClose * 100).toFixed(2)) : 0
          };
        }
      }
    }

    const klineData = klineResp.status === 'fulfilled' ? klineResp.value : [];
    const tech = calcTechSummary(klineData);
    const macd = calcMACDSignal(klineData);
    const info = stockInfo.status === 'fulfilled' ? stockInfo.value : null;
    const fin = financial.status === 'fulfilled' ? financial.value : null;
    const ind = industry.status === 'fulfilled' ? industry.value : null;
    const stockNameResolved = (quote && quote.name) ? quote.name : name;

    const aiConfig = getAIConfig();
    if (!aiConfig) {
      sendEvent({ type: 'error', error: 'OpenAI 配置未加载，请检查 OPENAI_API_KEY / ai-config.json' });
      res.end();
      return;
    }

    if (!isValidApiKey(aiConfig.apiKey)) {
      const prompt = buildPrompt(stockNameResolved, code, quote, tech, macd, info, fin, ind, klineData);
      sendEvent({ type: 'simulated', prompt, promptText: prompt });
      res.end();
      return;
    }

    const prompt = buildPrompt(stockNameResolved, code, quote, tech, macd, info, fin, ind, klineData);
    const analysisLog = `<!-- ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} | ${stockNameResolved}(${code}) -->\n${prompt}\n\n---\n`;
    try {
      fs.writeFileSync('./analysis.md', analysisLog, 'utf8');
      console.log('[AI] 已保存分析请求到 analysis.md');
    } catch (e) {
      console.error('[AI] 保存 analysis.md 失败：', e.message);
    }
    sendEvent({ type: 'start', promptLength: prompt.length });

    try {
      const aiStream = await createAIModelStream(prompt);
      let doneSent = false;

      aiStream.on('data', (chunk) => {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (doneSent) continue;
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            doneSent = true;
            sendEvent({ type: 'done' });
            continue;
          }
          try {
            const parsed = JSON.parse(data);
            if (!parsed.choices || parsed.choices.length === 0) continue;
            const content = parsed.choices[0].delta && parsed.choices[0].delta.content;
            if (content) {
              sendEvent({ type: 'chunk', content });
            }
          } catch (e) {
          }
        }
      });

      aiStream.on('end', () => {
        res.end();
      });

      aiStream.on('error', (err) => {
        console.error('[AI-Stream] 数据流异常中断：', err.message);
        sendEvent({ type: 'error', error: 'AI 响应流中断：' + err.message });
        res.end();
      });

    } catch (aiErr) {
      console.error('[AI-Stream] 调用失败：', aiErr.message);
      sendEvent({ type: 'error', error: 'AI 分析失败：' + aiErr.message });
      res.end();
    }

  } catch (e) {
    console.error('[AI-Stream] 整体异常：', e.message);
    sendEvent({ type: 'error', error: e.message });
    res.end();
  }
});

module.exports = router;
