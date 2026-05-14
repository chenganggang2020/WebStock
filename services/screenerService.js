const fs = require('fs');
const path = require('path');
const portfolio = require('./portfolioService');
const userService = require('./userService');
const sectors = require('./sectorService');
const { appendOneClickOutputInstructions } = require('./handoffFormat');
const db = require('../db');

const DISCLAIMER = '仅供研究和学习，不构成投资建议；市场有风险，决策需自行验证。';

function loadStocks() {
  const file = path.join(__dirname, '..', 'stocks.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return [];
  }
}

function mapByCode(items) {
  const map = new Map();
  items.forEach(item => map.set(item.code, item));
  return map;
}

function snapshotMap(input) {
  const map = new Map();
  (input.marketSnapshot || []).forEach(item => {
    if (item && item.code) map.set(String(item.code), item);
  });
  return map;
}

function klineFactorMap(input) {
  const map = new Map();
  function ema(values, period) {
    const k = 2 / (period + 1);
    let current = values[0];
    for (let i = 1; i < values.length; i++) {
      current = values[i] * k + current * (1 - k);
    }
    return current;
  }
  (input.klineSnapshot || []).forEach(item => {
    if (!item || !item.code || !Array.isArray(item.data)) return;
    const closes = item.data.map(row => Number(row.close)).filter(Number.isFinite);
    const volumes = item.data.map(row => Number(row.volume)).filter(Number.isFinite);
    if (closes.length < 5) return;
    const avg = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const ma5 = avg(closes.slice(-5));
    const ma20 = closes.length >= 20 ? avg(closes.slice(-20)) : null;
    const ma60 = closes.length >= 60 ? avg(closes.slice(-60)) : null;
    const latest = closes[closes.length - 1];
    const start5 = closes.length >= 5 ? closes[closes.length - 5] : closes[0];
    const start20 = closes.length >= 20 ? closes[closes.length - 20] : closes[0];
    const start60 = closes.length >= 60 ? closes[closes.length - 60] : closes[0];
    const trend5 = start5 ? (latest - start5) / start5 * 100 : 0;
    const trend20 = start20 ? (latest - start20) / start20 * 100 : 0;
    const trend60 = start60 ? (latest - start60) / start60 * 100 : 0;
    const returns = closes.slice(1).map((value, index) => closes[index] ? (value - closes[index]) / closes[index] * 100 : 0);
    const meanReturn = returns.length ? avg(returns) : 0;
    const volatility = returns.length ? Math.sqrt(avg(returns.map(value => Math.pow(value - meanReturn, 2)))) : 0;
    let volumeRatio5 = null;
    if (volumes.length >= 10) {
      const currentVolume = avg(volumes.slice(-5));
      const previousVolume = avg(volumes.slice(-10, -5));
      volumeRatio5 = previousVolume > 0 ? currentVolume / previousVolume : null;
    }
    let macd = null;
    if (closes.length >= 26) {
      const dif = ema(closes, 12) - ema(closes, 26);
      const deaSeries = [];
      for (let i = 26; i <= closes.length; i++) {
        const slice = closes.slice(0, i);
        deaSeries.push(ema(slice, 12) - ema(slice, 26));
      }
      const dea = ema(deaSeries, 9);
      const bar = (dif - dea) * 2;
      macd = {
        dif,
        dea,
        bar,
        signal: dif >= dea && dif >= 0 ? '多头' : dif >= dea ? '金叉观察' : dif < 0 ? '空头' : '回落'
      };
    }
    map.set(String(item.code), {
      latest,
      ma5,
      ma20,
      ma60,
      trend5,
      trend20,
      trend60,
      volatility,
      volumeRatio5,
      macd
    });
  });
  return map;
}

function getUniverse(scope, input = {}) {
  const allStocks = loadStocks();
  const watchlist = portfolio.listWatchlist();
  const positions = portfolio.getPositions();
  const recent = userService.listRecentStocks(80);
  const dashboardPromiseData = sectors.listSectors().flatMap(sector => sectors.listLeaders(sector.id).map(leader => Object.assign({}, leader, { sectorName: sector.name })));
  const leaderMap = mapByCode(dashboardPromiseData);
  const marketMap = snapshotMap(input);
  const klineMap = klineFactorMap(input);

  let base;
  if (scope === 'watchlist') base = watchlist;
  else if (scope === 'portfolio') base = positions;
  else if (scope === 'recent') base = recent;
  else if (scope === 'leaders') base = dashboardPromiseData;
  else {
    const merged = new Map();
    allStocks.slice(0, 500).forEach(item => merged.set(item.code, item));
    watchlist.forEach(item => merged.set(item.code, item));
    positions.forEach(item => merged.set(item.code, item));
    recent.forEach(item => merged.set(item.code, item));
    dashboardPromiseData.forEach(item => merged.set(item.code, item));
    base = Array.from(merged.values());
  }

  return base.map(item => {
    const leader = leaderMap.get(item.code);
    const snapshot = marketMap.get(item.code) || {};
    const technical = klineMap.get(item.code) || {};
    return {
      code: item.code,
      name: item.name || item.code,
      price: Number.isFinite(Number(snapshot.price)) ? Number(snapshot.price) : null,
      change: Number.isFinite(Number(snapshot.change)) ? Number(snapshot.change) : null,
      amount: Number.isFinite(Number(snapshot.amount)) ? Number(snapshot.amount) : null,
      volume: Number.isFinite(Number(snapshot.volume)) ? Number(snapshot.volume) : null,
      technical,
      inWatchlist: watchlist.some(row => row.code === item.code),
      inPortfolio: positions.some(row => row.code === item.code),
      inRecent: recent.some(row => row.code === item.code),
      isLeader: !!leader,
      sectorName: leader ? leader.sectorName : '',
      leaderRole: leader ? leader.role : '',
      note: item.note || ''
    };
  });
}

function pushFactorBreakdown(items, label, impact, note, kind = 'positive') {
  if (!impact && kind !== 'risk') return;
  items.push({ label, impact, note, kind });
}

function buildFactorBreakdown(stock, strategy, demand) {
  const items = [];
  const lowerDemand = String(demand || '').toLowerCase();

  if (stock.isLeader) {
    pushFactorBreakdown(items, '板块龙头', strategy === 'sector-leader' || lowerDemand.includes('龙头') ? 28 : 12, stock.sectorName || stock.leaderRole || 'leader context');
  }
  if (Number.isFinite(Number(stock.change))) {
    const change = Number(stock.change);
    if (strategy === 'short-strong' && change >= 3) pushFactorBreakdown(items, '涨跌幅', 18, `${change.toFixed(2)}% short strength`);
    else if (strategy === 'breakout' && change >= 1.5) pushFactorBreakdown(items, '涨跌幅', 12, `${change.toFixed(2)}% trend confirmation`);
    else if (strategy === 'pullback' && change <= -1 && change >= -5) pushFactorBreakdown(items, '回调幅度', 10, `${change.toFixed(2)}% pullback`);
    else if (strategy === 'portfolio-risk' && change <= -3) pushFactorBreakdown(items, '持仓跌幅', 16, `${change.toFixed(2)}% risk review`);
    if (Math.abs(change) >= 6) pushFactorBreakdown(items, '当日波动', 0, `${change.toFixed(2)}% requires manual review`, 'risk');
  }
  if (Number.isFinite(Number(stock.amount)) && Number(stock.amount) > 0) {
    const amountYi = Number(stock.amount) / 100000000;
    if (amountYi >= 5) pushFactorBreakdown(items, '成交额', 6, `${amountYi.toFixed(2)} 亿 liquidity`);
  }
  if (stock.technical && Number.isFinite(Number(stock.technical.ma5))) {
    const tech = stock.technical;
    if (Number.isFinite(Number(tech.ma20))) {
      if (tech.ma5 >= tech.ma20) pushFactorBreakdown(items, '均线结构', strategy === 'breakout' || strategy === 'short-strong' ? 10 : 5, 'MA5 >= MA20');
      else if (strategy === 'pullback') pushFactorBreakdown(items, '均线回调', 5, 'MA5 < MA20 pullback watch');
      else pushFactorBreakdown(items, '均线走弱', 0, 'MA5 < MA20', 'risk');
    }
    if (Number.isFinite(Number(tech.trend20))) {
      const trend20 = Number(tech.trend20);
      if (strategy === 'stable' && Math.abs(trend20) <= 8) pushFactorBreakdown(items, '20日走势', 6, `${trend20.toFixed(2)}% stable range`);
      if (strategy === 'short-strong' && trend20 >= 8) pushFactorBreakdown(items, '20日强势', 8, `${trend20.toFixed(2)}%`);
    }
    if (Number.isFinite(Number(tech.ma60))) {
      if (tech.ma5 >= tech.ma60) pushFactorBreakdown(items, 'MA60', strategy === 'breakout' || strategy === 'short-strong' ? 7 : 4, 'MA5 >= MA60 medium trend');
      else pushFactorBreakdown(items, 'MA60', 0, 'MA5 < MA60 medium trend weak', 'risk');
    }
    if (Number.isFinite(Number(tech.trend5))) {
      const trend5 = Number(tech.trend5);
      if (strategy === 'short-strong' && trend5 >= 2) pushFactorBreakdown(items, '5d trend', 6, `${trend5.toFixed(2)}% short momentum`);
      if (strategy === 'pullback' && trend5 <= -2 && trend5 >= -8) pushFactorBreakdown(items, '5d trend', 5, `${trend5.toFixed(2)}% controlled pullback`);
      if (Math.abs(trend5) >= 10) pushFactorBreakdown(items, '5d trend', 0, `${trend5.toFixed(2)}% fast move requires review`, 'risk');
    }
    if (Number.isFinite(Number(tech.trend60))) {
      const trend60 = Number(tech.trend60);
      if ((strategy === 'breakout' || strategy === 'short-strong') && trend60 >= 10) pushFactorBreakdown(items, '60d trend', 5, `${trend60.toFixed(2)}% medium trend`);
      if (strategy === 'stable' && Math.abs(trend60) <= 15) pushFactorBreakdown(items, '60d trend', 4, `${trend60.toFixed(2)}% stable medium range`);
      if (trend60 <= -12) pushFactorBreakdown(items, '60d trend', 0, `${trend60.toFixed(2)}% medium weakness`, 'risk');
    }
    if (Number.isFinite(Number(tech.volumeRatio5))) {
      const ratio = Number(tech.volumeRatio5);
      if (ratio >= 1.2) pushFactorBreakdown(items, 'volume trend', 5, `${ratio.toFixed(2)}x recent volume`);
      if (ratio <= 0.7) pushFactorBreakdown(items, 'volume trend', 0, `${ratio.toFixed(2)}x shrinking volume`, 'risk');
    }
    if (Number.isFinite(Number(tech.volatility))) {
      if (Number(tech.volatility) > 4) pushFactorBreakdown(items, '波动率', 0, `${Number(tech.volatility).toFixed(2)}% high volatility`, 'risk');
      else if (strategy === 'stable') pushFactorBreakdown(items, '低波动', 5, `${Number(tech.volatility).toFixed(2)}%`);
    }
    if (tech.macd) {
      if ((strategy === 'breakout' || strategy === 'short-strong') && (tech.macd.signal === '多头' || tech.macd.signal === '金叉观察')) {
        pushFactorBreakdown(items, 'MACD', 8, tech.macd.signal);
      }
      if (tech.macd.signal === '空头') pushFactorBreakdown(items, 'MACD', 0, 'bearish signal', 'risk');
    }
  }
  if (stock.inWatchlist) pushFactorBreakdown(items, '自选股', strategy === 'stable' ? 14 : 8, 'tracked by user');
  if (stock.inPortfolio) pushFactorBreakdown(items, '持仓', strategy === 'portfolio-risk' ? 24 : 6, 'portfolio exposure');
  if (stock.inRecent) pushFactorBreakdown(items, '最近查看', 8, 'recently reviewed');
  if (strategy === 'breakout') pushFactorBreakdown(items, '策略模板', stock.isLeader ? 12 : 4, 'breakout template');
  else if (strategy === 'pullback') pushFactorBreakdown(items, '策略模板', stock.inWatchlist || stock.inRecent ? 12 : 4, 'pullback template');
  else if (strategy === 'stable') pushFactorBreakdown(items, '策略模板', stock.inPortfolio ? 8 : 4, 'stable template');
  else if (strategy === 'short-strong') pushFactorBreakdown(items, '策略模板', stock.isLeader ? 16 : 5, 'short-strong template');
  else if (strategy === 'portfolio-risk' && stock.inPortfolio) pushFactorBreakdown(items, '策略模板', 20, 'portfolio-risk template');
  if (lowerDemand.includes('低估值')) pushFactorBreakdown(items, '需求关键词', 4, 'low valuation requested');

  return items;
}

function scoreCandidate(stock, strategy, demand) {
  let score = 45;
  const reasons = [];
  const risks = [];
  const lowerDemand = String(demand || '').toLowerCase();

  if (stock.isLeader) {
    score += strategy === 'sector-leader' || lowerDemand.includes('龙头') ? 28 : 12;
    reasons.push(`属于${stock.sectorName || '板块'}${stock.leaderRole || '观察股'}`);
  }
  if (Number.isFinite(Number(stock.change))) {
    const change = Number(stock.change);
    if (strategy === 'short-strong' && change >= 3) {
      score += 18;
      reasons.push(`本地行情涨跌幅 ${change.toFixed(2)}%，短线强势信号较强`);
    } else if (strategy === 'breakout' && change >= 1.5) {
      score += 12;
      reasons.push(`本地行情涨跌幅 ${change.toFixed(2)}%，符合趋势观察`);
    } else if (strategy === 'pullback' && change <= -1 && change >= -5) {
      score += 10;
      reasons.push(`本地行情回调 ${change.toFixed(2)}%，适合纳入回调观察`);
    } else if (strategy === 'portfolio-risk' && change <= -3) {
      score += 16;
      risks.push(`本地行情跌幅 ${change.toFixed(2)}%，需检查持仓风险`);
    } else {
      reasons.push(`本地行情涨跌幅 ${change.toFixed(2)}%，作为辅助因子`);
    }
    if (Math.abs(change) >= 6) risks.push('当日波动较大，需避免追涨杀跌');
  }
  if (Number.isFinite(Number(stock.amount)) && Number(stock.amount) > 0) {
    const amountYi = Number(stock.amount) / 100000000;
    if (amountYi >= 5) {
      score += 6;
      reasons.push(`成交额约 ${amountYi.toFixed(2)} 亿，流动性观察价值较高`);
    }
  }
  if (stock.technical && Number.isFinite(Number(stock.technical.ma5))) {
    const tech = stock.technical;
    if (Number.isFinite(Number(tech.ma20))) {
      if (tech.ma5 >= tech.ma20) {
        score += strategy === 'breakout' || strategy === 'short-strong' ? 10 : 5;
        reasons.push(`MA5 高于 MA20，均线结构偏强`);
      } else if (strategy === 'pullback') {
        score += 5;
        reasons.push('MA5 低于 MA20，适合观察是否出现回调企稳');
      } else {
        risks.push('MA5 低于 MA20，短期趋势需要复核');
      }
    }
    if (Number.isFinite(Number(tech.trend20))) {
      reasons.push(`近 20 日涨跌约 ${Number(tech.trend20).toFixed(2)}%`);
      if (strategy === 'stable' && Math.abs(Number(tech.trend20)) <= 8) score += 6;
      if (strategy === 'short-strong' && Number(tech.trend20) >= 8) score += 8;
    }
    if (Number.isFinite(Number(tech.ma60))) {
      if (tech.ma5 >= tech.ma60) {
        score += strategy === 'breakout' || strategy === 'short-strong' ? 7 : 4;
        reasons.push('MA5 高于 MA60，中期均线结构保持向上');
      } else {
        risks.push('MA5 低于 MA60，中期趋势仍需确认');
      }
    }
    if (Number.isFinite(Number(tech.trend5))) {
      const trend5 = Number(tech.trend5);
      reasons.push(`5d trend ${trend5.toFixed(2)}%`);
      if (strategy === 'short-strong' && trend5 >= 2) score += 6;
      if (strategy === 'pullback' && trend5 <= -2 && trend5 >= -8) score += 5;
      if (Math.abs(trend5) >= 10) risks.push(`5d trend ${trend5.toFixed(2)}%，短期波动过快，需人工复核`);
    }
    if (Number.isFinite(Number(tech.trend60))) {
      const trend60 = Number(tech.trend60);
      reasons.push(`60d trend ${trend60.toFixed(2)}%`);
      if ((strategy === 'breakout' || strategy === 'short-strong') && trend60 >= 10) score += 5;
      if (strategy === 'stable' && Math.abs(trend60) <= 15) score += 4;
      if (trend60 <= -12) risks.push(`60d trend ${trend60.toFixed(2)}%，中期趋势偏弱`);
    }
    if (Number.isFinite(Number(tech.volumeRatio5))) {
      const ratio = Number(tech.volumeRatio5);
      reasons.push(`volume trend ${ratio.toFixed(2)}x`);
      if (ratio >= 1.2) score += 5;
      if (ratio <= 0.7) risks.push(`volume trend ${ratio.toFixed(2)}x，近期量能收缩`);
    }
    if (Number.isFinite(Number(tech.volatility))) {
      if (Number(tech.volatility) > 4) risks.push(`近阶段波动率约 ${Number(tech.volatility).toFixed(2)}%，波动偏高`);
      else if (strategy === 'stable') score += 5;
    }
    if (tech.macd) {
      reasons.push(`MACD 信号：${tech.macd.signal}`);
      if ((strategy === 'breakout' || strategy === 'short-strong') && (tech.macd.signal === '多头' || tech.macd.signal === '金叉观察')) {
        score += 8;
      }
      if (tech.macd.signal === '空头') risks.push('MACD 处于空头状态，趋势确认不足');
    }
  }
  if (stock.inWatchlist) {
    score += strategy === 'stable' ? 14 : 8;
    reasons.push('已在自选，便于持续跟踪');
  }
  if (stock.inPortfolio) {
    score += strategy === 'portfolio-risk' ? 24 : 6;
    reasons.push('当前持仓相关，可结合成本和仓位复盘');
  }
  if (stock.inRecent) {
    score += 8;
    reasons.push('最近查看过，适合二次筛选');
  }

  if (strategy === 'breakout') {
    score += stock.isLeader ? 12 : 4;
    reasons.push('趋势突破模板优先观察强势和板块核心标的');
    risks.push('突破失败时可能快速回落，需观察成交量和回踩');
  } else if (strategy === 'pullback') {
    score += stock.inWatchlist || stock.inRecent ? 12 : 4;
    reasons.push('回调观察模板优先选择已跟踪标的');
    risks.push('均线附近并不等于止跌，需确认量能和市场环境');
  } else if (strategy === 'stable') {
    score += stock.inPortfolio ? 8 : 4;
    reasons.push('稳健观察模板优先降低信息盲区');
    risks.push('低波动也可能意味着缺乏趋势弹性');
  } else if (strategy === 'short-strong') {
    score += stock.isLeader ? 16 : 5;
    reasons.push('短线强势模板更关注龙头和高关注度标的');
    risks.push('短线波动更高，需控制观察周期和仓位假设');
  } else if (strategy === 'portfolio-risk') {
    if (stock.inPortfolio) score += 20;
    reasons.push('持仓风险排查模板优先检查已有暴露');
    risks.push('需要结合真实成本、仓位和流动性判断');
  }

  if (lowerDemand.includes('低估值')) {
    score += 4;
    reasons.push('低估值需求已记录，但当前缺少稳定估值数据源');
    risks.push('估值因子当前为弱信号，需要补充财报和行业对比');
  }

  if (!reasons.length) reasons.push('基础本地因子通过，适合作为观察候选');
  if (!risks.length) risks.push('外部行情或财务数据可能缺失，需人工复核');

  const factorTags = [];
  if (stock.isLeader) factorTags.push('板块龙头');
  if (stock.inWatchlist) factorTags.push('自选');
  if (stock.inPortfolio) factorTags.push('持仓');
  if (stock.inRecent) factorTags.push('最近查看');
  if (Number.isFinite(Number(stock.change))) factorTags.push('涨跌幅');
  if (Number.isFinite(Number(stock.amount)) && Number(stock.amount) > 0) factorTags.push('成交额');
  if (stock.technical) {
    if (Number.isFinite(Number(stock.technical.ma5)) || Number.isFinite(Number(stock.technical.ma20))) factorTags.push('均线');
    if (Number.isFinite(Number(stock.technical.ma60))) factorTags.push('MA60');
    if (Number.isFinite(Number(stock.technical.trend5))) factorTags.push('5d trend');
    if (Number.isFinite(Number(stock.technical.trend20))) factorTags.push('20日走势');
    if (Number.isFinite(Number(stock.technical.trend60))) factorTags.push('60d trend');
    if (Number.isFinite(Number(stock.technical.volumeRatio5))) factorTags.push('volume trend');
    if (Number.isFinite(Number(stock.technical.volatility))) factorTags.push('波动率');
    if (stock.technical.macd) factorTags.push('MACD');
  }

  return {
    code: stock.code,
    name: stock.name,
    score: Math.min(Math.round(score), 100),
    reasons,
    risks,
    factorTags,
    factorBreakdown: buildFactorBreakdown(stock, strategy, demand),
    observePrice: stock.price ? `当前价 ${Number(stock.price).toFixed(2)}；结合 20 日均线和前高/前低人工确认` : '结合最新价、20日均线和前高/前低人工确认',
    strategy,
    sectorName: stock.sectorName,
    leaderRole: stock.leaderRole,
    inWatchlist: stock.inWatchlist,
    inPortfolio: stock.inPortfolio
  };
}

function runScreener(input = {}) {
  const strategy = input.strategy || 'stable';
  const demand = input.demand || '';
  const scope = input.scope || 'all';
  const universe = getUniverse(scope, input);
  const candidates = universe
    .map(stock => scoreCandidate(stock, strategy, demand))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(Number(input.limit) || 20, 50));

  const prompt = buildSmartPrompt({ strategy, demand, scope, candidates });
  return {
    strategy,
    demand,
    scope,
    candidates,
    prompt,
    disclaimer: DISCLAIMER
  };
}

function buildPrompt(result) {
  return `请作为谨慎的股票研究助手，对以下候选观察清单进行二次分析。\n\n要求：\n1. 只做研究和学习用途，不构成投资建议。\n2. 不承诺收益，不给出真实下单指令。\n3. 输出每只股票的入选逻辑、风险点、观察价位、后续验证条件。\n4. 优先指出数据缺口和需要人工复核的地方。\n\n用户需求：${result.demand || '未填写'}\n策略：${result.strategy}\n范围：${result.scope}\n候选数据：\n${JSON.stringify(result.candidates, null, 2)}\n\n请输出结构化 Markdown 报告，并包含免责声明。`;
}

function buildSmartPrompt(result) {
  const candidates = (result.candidates || []).slice(0, 12).map(function(item) {
    return {
      code: item.code,
      name: item.name,
      score: item.score,
      strategy: item.strategy,
      factorTags: item.factorTags,
      reasons: item.reasons,
      risks: item.risks,
      factorBreakdown: item.factorBreakdown,
      observePrice: item.observePrice,
      sectorName: item.sectorName,
      leaderRole: item.leaderRole,
      inWatchlist: item.inWatchlist,
      inPortfolio: item.inPortfolio
    };
  });
  const prompt = `你是一个谨慎的 A 股投研助手。请对 WebStock 本地初筛出来的候选股做“二次筛选”，不是泛泛点评，也不要直接给买卖指令。

重要约束：
1. 只用于研究和复盘，不构成投资建议，不承诺收益。
2. 必须结合候选股的分数、因子、入选理由、风险点、板块/龙头标签、观察价位做分析。
3. 如果数据不足，要明确写出缺口，例如缺少财报、盘口、资金流、龙虎榜、公告、行业景气度等。
4. 不要把所有候选都说成好；请主动剔除风险较高或逻辑不清的股票。
5. 输出要适合复制回 WebStock 保存，重点清楚、可执行、可复盘。

我的筛选需求：${result.demand || '未填写'}
本地策略：${result.strategy}
筛选范围：${result.scope}

候选股数据 JSON：
${JSON.stringify(candidates, null, 2)}

请按下面结构输出 Markdown：

## 结论
- 给出“优先观察 / 等待确认 / 暂时剔除”的分组结论。
- 每组最多列 3 只，不够可以少列。

## 优先观察清单
用表格输出：代码、名称、所属逻辑、为什么优先、需要等待的确认信号、主要风险、观察价位。

## 剔除或降级原因
说明哪些股票不适合当前策略，以及原因。

## 板块与风格判断
总结候选股集中在哪些板块/风格，是否存在同质化、追高、流动性不足或板块退潮风险。

## 下一步验证清单
列出 5-8 条盘中/明日应检查的数据，例如量能、分时承接、板块联动、公告、财报、资金流、关键价位。

## 可复制回 WebStock 的摘要
用简短 bullet 输出最终摘要，方便粘贴保存。`;
  return appendOneClickOutputInstructions(prompt, {
    title: '智能选股二次筛选结果',
    sections: [
      '结论分组：优先观察 / 等待确认 / 暂时剔除。',
      '优先观察表：代码、名称、理由、确认信号、主要风险、观察价位。',
      '板块与风格：集中方向、同质化、追高或退潮风险。',
      '下一步验证：5-8 条明日或盘中检查项。',
      '免责声明：仅供研究复盘，不构成投资建议。'
    ]
  });
}

function rowToSavedResult(row) {
  let result = null;
  try {
    result = JSON.parse(row.result_json || '{}');
  } catch (error) {
    result = null;
  }
  return {
    id: row.id,
    taskName: row.task_name,
    strategy: row.strategy,
    demand: row.demand,
    result,
    candidateCount: result && Array.isArray(result.candidates) ? result.candidates.length : 0,
    aiResult: row.ai_result || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function saveScreenerResult(input = {}) {
  const result = input.result || input;
  if (!result || !Array.isArray(result.candidates)) {
    throw new Error('Screener result with candidates is required');
  }
  const taskName = String(input.taskName || result.demand || result.strategy || 'Screener task').trim().slice(0, 120) || 'Screener task';
  const payload = {
    taskName,
    strategy: String(result.strategy || input.strategy || 'stable').slice(0, 80),
    demand: String(result.demand || input.demand || '').slice(0, 1000),
    resultJson: JSON.stringify(result),
    aiResult: String(input.aiResult || '').slice(0, 20000)
  };
  const info = db.prepare(`
    INSERT INTO ai_screener_results (task_name, strategy, demand, result_json, ai_result)
    VALUES (@taskName, @strategy, @demand, @resultJson, @aiResult)
  `).run(payload);
  return getScreenerResult(info.lastInsertRowid);
}

function getScreenerResult(id) {
  const row = db.prepare('SELECT * FROM ai_screener_results WHERE id = ?').get(Number(id));
  if (!row) throw new Error('Screener result not found');
  return rowToSavedResult(row);
}

function listScreenerResults(limit = 20) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  return db.prepare('SELECT * FROM ai_screener_results ORDER BY datetime(created_at) DESC, id DESC LIMIT ?')
    .all(safeLimit)
    .map(rowToSavedResult);
}

function updateScreenerResult(id, input = {}) {
  const existing = getScreenerResult(id);
  const taskName = String(input.taskName || existing.taskName || 'Screener task').trim().slice(0, 120) || 'Screener task';
  const aiResult = input.aiResult === undefined ? existing.aiResult : String(input.aiResult || '').slice(0, 20000);
  db.prepare(`
    UPDATE ai_screener_results
    SET task_name = ?, ai_result = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(taskName, aiResult, Number(id));
  return getScreenerResult(id);
}

function deleteScreenerResult(id) {
  return db.prepare('DELETE FROM ai_screener_results WHERE id = ?').run(Number(id)).changes > 0;
}

const ALLOWED_CANDIDATE_STATUSES = new Set(['watch', 'priority', 'risk', 'skip', 'done']);

function normalizeCandidateStatus(status) {
  const value = String(status || 'watch').trim().toLowerCase();
  return ALLOWED_CANDIDATE_STATUSES.has(value) ? value : 'watch';
}

function rowToCandidateNote(row) {
  return {
    id: row.id,
    resultId: row.result_id,
    code: row.code,
    status: row.status,
    note: row.note || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function listScreenerCandidateNotes(resultId) {
  getScreenerResult(resultId);
  return db.prepare('SELECT * FROM screener_candidate_notes WHERE result_id = ? ORDER BY code')
    .all(Number(resultId))
    .map(rowToCandidateNote);
}

function upsertScreenerCandidateNote(resultId, code, input = {}) {
  getScreenerResult(resultId);
  const safeCode = String(code || '').trim().slice(0, 20);
  if (!safeCode) throw new Error('Candidate code is required');
  const payload = {
    resultId: Number(resultId),
    code: safeCode,
    status: normalizeCandidateStatus(input.status),
    note: String(input.note || '').slice(0, 2000)
  };
  db.prepare(`
    INSERT INTO screener_candidate_notes (result_id, code, status, note)
    VALUES (@resultId, @code, @status, @note)
    ON CONFLICT(result_id, code) DO UPDATE SET
      status = excluded.status,
      note = excluded.note,
      updated_at = CURRENT_TIMESTAMP
  `).run(payload);
  return rowToCandidateNote(db.prepare('SELECT * FROM screener_candidate_notes WHERE result_id = ? AND code = ?')
    .get(payload.resultId, payload.code));
}

function bulkUpsertScreenerCandidateNotes(resultId, input = {}) {
  getScreenerResult(resultId);
  const codes = Array.isArray(input.codes) ? input.codes.map(item => String(item || '').trim().slice(0, 20)).filter(Boolean) : [];
  if (!codes.length) throw new Error('Candidate codes are required');
  const payload = {
    resultId: Number(resultId),
    status: normalizeCandidateStatus(input.status),
    note: String(input.note || '').slice(0, 2000)
  };
  const stmt = db.prepare(`
    INSERT INTO screener_candidate_notes (result_id, code, status, note)
    VALUES (@resultId, @code, @status, @note)
    ON CONFLICT(result_id, code) DO UPDATE SET
      status = excluded.status,
      note = excluded.note,
      updated_at = CURRENT_TIMESTAMP
  `);
  const uniqueCodes = Array.from(new Set(codes));
  db.transaction(function() {
    uniqueCodes.forEach(code => stmt.run(Object.assign({}, payload, { code })));
  })();
  return {
    updated: uniqueCodes.length,
    status: payload.status
  };
}

function deleteScreenerCandidateNote(resultId, code) {
  getScreenerResult(resultId);
  return db.prepare('DELETE FROM screener_candidate_notes WHERE result_id = ? AND code = ?')
    .run(Number(resultId), String(code || '').trim())
    .changes > 0;
}

function getScreenerReviewSummary(limit = 8) {
  const safeLimit = Math.min(Math.max(Number(limit) || 8, 1), 50);
  const saved = db.prepare('SELECT * FROM ai_screener_results ORDER BY datetime(created_at) DESC, id DESC LIMIT ?')
    .all(safeLimit)
    .map(rowToSavedResult);
  if (!saved.length) return [];

  const ids = saved.map(item => item.id);
  const placeholders = ids.map(() => '?').join(',');
  const noteRows = db.prepare(`
    SELECT result_id AS resultId, status, COUNT(*) AS count
    FROM screener_candidate_notes
    WHERE result_id IN (${placeholders})
    GROUP BY result_id, status
  `).all(...ids);

  const countMap = new Map();
  noteRows.forEach(row => {
    if (!countMap.has(row.resultId)) countMap.set(row.resultId, {});
    countMap.get(row.resultId)[row.status] = row.count;
  });

  return saved.map(item => {
    const counts = Object.assign({ watch: 0, priority: 0, risk: 0, skip: 0, done: 0 }, countMap.get(item.id) || {});
    const reviewed = Object.keys(counts).reduce((sum, key) => sum + Number(counts[key] || 0), 0);
    return {
      id: item.id,
      taskName: item.taskName,
      strategy: item.strategy,
      candidateCount: item.candidateCount,
      reviewed,
      unreviewed: Math.max(item.candidateCount - reviewed, 0),
      counts,
      updatedAt: item.updatedAt
    };
  });
}

function compareScreenerResults(baseId, headId) {
  const base = getScreenerResult(baseId);
  const head = getScreenerResult(headId);
  const baseCandidates = (base.result && base.result.candidates) || [];
  const headCandidates = (head.result && head.result.candidates) || [];
  const baseMap = new Map(baseCandidates.map(item => [item.code, item]));
  const headMap = new Map(headCandidates.map(item => [item.code, item]));

  const added = headCandidates.filter(item => !baseMap.has(item.code));
  const removed = baseCandidates.filter(item => !headMap.has(item.code));
  const changed = headCandidates
    .filter(item => baseMap.has(item.code))
    .map(item => {
      const previous = baseMap.get(item.code);
      return {
        code: item.code,
        name: item.name || previous.name || item.code,
        previousScore: previous.score,
        currentScore: item.score,
        delta: Number(item.score || 0) - Number(previous.score || 0)
      };
    })
    .filter(item => item.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return {
    base: { id: base.id, taskName: base.taskName, candidateCount: base.candidateCount },
    head: { id: head.id, taskName: head.taskName, candidateCount: head.candidateCount },
    added,
    removed,
    changed,
    commonCount: headCandidates.filter(item => baseMap.has(item.code)).length
  };
}

module.exports = {
  DISCLAIMER,
  runScreener,
  buildPrompt: buildSmartPrompt,
  scoreCandidate,
  saveScreenerResult,
  getScreenerResult,
  listScreenerResults,
  updateScreenerResult,
  deleteScreenerResult,
  compareScreenerResults,
  listScreenerCandidateNotes,
  upsertScreenerCandidateNote,
  bulkUpsertScreenerCandidateNotes,
  deleteScreenerCandidateNote,
  getScreenerReviewSummary
};
