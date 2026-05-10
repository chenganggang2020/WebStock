const express = require('express');
const axios = require('axios');
const iconv = require('iconv-lite');
const router = express.Router();

const portfolio = require('../services/portfolioService');
const { isValidApiKey, getAIConfig, callAIModel } = require('./ai');

function ok(res, data) {
  res.json({ success: true, data });
}

function fail(res, error, status = 400) {
  res.status(status).json({ success: false, error: error.message || String(error) });
}

async function fetchQuotesSafe(codes) {
  if (!codes.length) return {};
  try {
    const sinaCodes = codes.map(code => (code.startsWith('6') ? 'sh' : 'sz') + code).join(',');
    const resp = await axios.get('https://hq.sinajs.cn/list=' + sinaCodes, {
      headers: { Referer: 'https://finance.sina.com.cn' },
      responseType: 'arraybuffer',
      timeout: 6000
    });
    const rawData = iconv.decode(Buffer.from(resp.data), 'gbk');
    const map = {};
    rawData.split('\n').filter(Boolean).forEach(line => {
      const match = line.match(/hq_str_(s[hz]\d+)="(.+)"/);
      if (!match) return;
      const code = match[1].replace(/^sh|^sz/, '');
      const fields = match[2].split(',');
      const price = parseFloat(fields[3]) || 0;
      const prevClose = parseFloat(fields[2]) || price;
      map[code] = {
        price,
        change: prevClose ? Number(((price - prevClose) / prevClose * 100).toFixed(2)) : 0
      };
    });
    return map;
  } catch (error) {
    console.error('[Portfolio] 行情获取失败：' + error.message);
    return {};
  }
}

async function getPositionsWithQuotes() {
  const rawPositions = portfolio.getPositions({});
  const quoteMap = await fetchQuotesSafe(rawPositions.map(pos => pos.code));
  return portfolio.getPositions(quoteMap);
}

router.get('/watchlist', function (req, res) {
  try {
    ok(res, portfolio.listWatchlist({ group: req.query.group }));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/watchlist', function (req, res) {
  try {
    ok(res, portfolio.addWatchlistItem(req.body));
  } catch (error) {
    fail(res, error);
  }
});

router.put('/watchlist/:id', function (req, res) {
  try {
    ok(res, portfolio.updateWatchlistItem(Number(req.params.id), req.body));
  } catch (error) {
    fail(res, error);
  }
});

router.delete('/watchlist/:id', function (req, res) {
  try {
    ok(res, { deleted: portfolio.deleteWatchlistItem(Number(req.params.id)) });
  } catch (error) {
    fail(res, error);
  }
});

router.delete('/watchlist/code/:code', function (req, res) {
  try {
    ok(res, { deleted: portfolio.removeWatchlistByCode(req.params.code) });
  } catch (error) {
    fail(res, error);
  }
});

router.get('/trades', function (req, res) {
  try {
    ok(res, portfolio.listTrades({
      code: req.query.code,
      side: req.query.side,
      startDate: req.query.startDate,
      endDate: req.query.endDate
    }));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/trades', function (req, res) {
  try {
    ok(res, portfolio.createTrade(req.body));
  } catch (error) {
    fail(res, error);
  }
});

router.put('/trades/:id', function (req, res) {
  try {
    ok(res, portfolio.updateTrade(Number(req.params.id), req.body));
  } catch (error) {
    fail(res, error);
  }
});

router.delete('/trades/:id', function (req, res) {
  try {
    ok(res, { deleted: portfolio.deleteTrade(Number(req.params.id)) });
  } catch (error) {
    fail(res, error);
  }
});

router.get('/trades/export', function (req, res) {
  try {
    const trades = portfolio.listTrades(req.query);
    const rows = [['日期', '类型', '代码', '名称', '价格', '数量', '手续费', '印花税', '金额', '备注']];
    trades.forEach(trade => {
      rows.push([trade.tradeDate, trade.side, trade.code, trade.name, trade.price, trade.quantity, trade.fee, trade.tax, trade.amount, trade.note]);
    });
    const csv = rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="webstock-trades.csv"');
    res.send('\ufeff' + csv);
  } catch (error) {
    fail(res, error);
  }
});

router.get('/positions', async function (req, res) {
  try {
    ok(res, await getPositionsWithQuotes());
  } catch (error) {
    fail(res, error);
  }
});

router.get('/summary', async function (req, res) {
  try {
    const positions = await getPositionsWithQuotes();
    ok(res, portfolio.getSummary(positions));
  } catch (error) {
    fail(res, error);
  }
});

router.get('/allocation', async function (req, res) {
  try {
    const positions = await getPositionsWithQuotes();
    ok(res, portfolio.getAllocation(positions));
  } catch (error) {
    fail(res, error);
  }
});

router.post('/recalculate', async function (req, res) {
  try {
    const positions = await getPositionsWithQuotes();
    ok(res, {
      positions,
      summary: portfolio.getSummary(positions),
      allocation: portfolio.getAllocation(positions)
    });
  } catch (error) {
    fail(res, error);
  }
});

router.post('/ai-analysis', async function (req, res) {
  try {
    const aiConfig = getAIConfig();
    if (!isValidApiKey(aiConfig && aiConfig.apiKey)) {
      throw new Error('AI 未配置，请先配置 OpenAI API Key');
    }

    const positions = await getPositionsWithQuotes();
    const summary = portfolio.getSummary(positions);
    const allocation = portfolio.getAllocation(positions);
    const trades = portfolio.listTrades().slice(0, 20);
    const prompt = `你是一名谨慎的投资组合分析助手。请根据以下持仓、盈亏和交易记录，对该投资组合进行结构性分析。请注意：
1. 不要承诺收益；
2. 不要给出绝对化买入或卖出指令；
3. 只能给出风险提示、观察建议和仓位结构建议；
4. 必须包含免责声明：AI 分析仅供参考，不构成投资建议。

【组合总览】
${JSON.stringify(summary, null, 2)}

【当前持仓】
${JSON.stringify(positions, null, 2)}

【持仓占比】
${JSON.stringify(allocation, null, 2)}

【最近交易记录】
${JSON.stringify(trades, null, 2)}

请输出：
一、组合总体情况
二、持仓集中度
三、盈利与亏损来源
四、主要风险
五、后续观察重点
六、仓位结构建议
七、免责声明`;

    ok(res, { report: await callAIModel(prompt) });
  } catch (error) {
    fail(res, error);
  }
});

module.exports = router;
