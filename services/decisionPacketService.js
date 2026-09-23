const crypto = require('node:crypto');
const knowledge = require('./knowledgeService');
const news = require('./newsService');
const portfolio = require('./portfolioService');
const quant = require('./quantService');
const researchRuns = require('./researchRunService');
const screener = require('./screenerService');
const stockProfiles = require('./stockProfileService');
const { appendOneClickOutputInstructions } = require('./handoffFormat');

const RISK_PROFILES = new Set(['conservative', 'balanced', 'aggressive']);

function text(value, maxLength = 2000) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function stockCode(value) {
  const digits = String(value == null ? '' : value).replace(/\D/g, '');
  return digits.length <= 6 ? digits.padStart(6, '0') : '';
}

function latestPerModel(entries, datasetId) {
  const validEntries = (entries || []).filter(entry => entry.valid && entry.result && entry.result.dataManifest);
  const selectedDatasetId = datasetId || (validEntries[0] && validEntries[0].result.dataManifest.datasetId) || '';
  const seen = new Set();
  return validEntries
    .filter(entry => !selectedDatasetId || entry.result.dataManifest.datasetId === selectedDatasetId)
    .filter(entry => {
      const modelId = String(entry.result.modelId || '');
      if (seen.has(modelId)) return false;
      seen.add(modelId);
      return true;
    });
}

function addRankedCandidates(candidateMap, source, candidates) {
  const items = (candidates || []).slice(0, 30);
  items.forEach((item, index) => {
    const code = stockCode(item.code);
    const name = text(item.name || code, 100);
    if (!code || /(^|\*)ST/i.test(name)) return;
    if (!candidateMap.has(code)) {
      candidateMap.set(code, { code, name, signals: [], profile: {}, contexts: [] });
    }
    const rankPercentile = items.length <= 1 ? 100 : 100 * (items.length - index) / items.length;
    candidateMap.get(code).signals.push({
      sourceId: source.sourceId,
      sourceLabel: source.sourceLabel,
      sourceType: source.sourceType,
      rank: index + 1,
      rankPercentile: Number(rankPercentile.toFixed(2)),
      rawScore: Number.isFinite(Number(item.score)) ? Number(item.score) : null,
      asOf: source.asOf || '',
      datasetId: source.datasetId || '',
      validationStatus: source.validationStatus || 'context',
      trainedThrough: item.modelTrainedThrough || item.trainedThrough || ''
    });
  });
}

function consensusScore(signals) {
  const values = (signals || []).map(item => Number(item.rankPercentile)).filter(Number.isFinite);
  if (!values.length) return 0;
  const averageRank = values.reduce((sum, value) => sum + value, 0) / values.length;
  const sourceBonus = Math.min(new Set(signals.map(item => item.sourceId)).size, 3) / 3 * 30;
  return Number((averageRank * 0.7 + sourceBonus).toFixed(2));
}

function factorRankingEligible(result) {
  return !!(result && Array.isArray(result.factors) && result.factors.some(factor => factor.admission === 'candidate'));
}

function evidenceId(prefix, value) {
  return prefix + '-' + crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex').slice(0, 12).toUpperCase();
}

function buildNewsEvidence(candidates, question) {
  const result = news.listNewsWithMeta({});
  const tokens = [question].concat(candidates.flatMap(item => [item.code, item.name].concat(item.themes || [], item.industry || [])))
    .map(value => text(value, 80).toLowerCase()).filter(value => value.length >= 2);
  const items = (result.items || []).filter(item => !/^WebStock Fallback$/i.test(item.source || ''))
    .filter(item => {
      const haystack = [item.title, item.summary, item.source].concat(item.relatedStocks || [], item.relatedSectors || [])
        .join(' ').toLowerCase();
      return tokens.some(token => haystack.includes(token));
    }).slice(0, 12).map(item => ({
      evidenceId: evidenceId('NEWS', [item.title, item.link, item.time].join('|')),
      evidenceType: 'news',
      title: item.title,
      source: item.source,
      publishedAt: item.time,
      sourceUrl: item.link === '#' ? '' : item.link,
      content: item.summary || item.title,
      relatedStocks: item.relatedStocks || [],
      relatedSectors: item.relatedSectors || []
    }));
  return { items, meta: result.meta || {} };
}

function buildPrompt(packet) {
  const prompt = `你是一名负责复核的 A 股研究主管。请审查下面的 WebStock 决策包，完成一次量化、产业证据、反方观点和组合风险合并分析。

工作规则：
- 模型原始分数不能跨模型直接比较，只能使用每个来源内的排名和来源数。
- “探索性”结果不能写成已验证策略；数据缺口必须保留。
- 每条外部事实必须引用提供的 evidenceId；没有证据时写“待补证”，不能补写来源不明的事实。
- 主动寻找模型排序分歧、资讯与专家观点冲突、集中暴露和失效条件。
- 不调用券商、不输出自动下单指令。价格或盘口缺失时不得虚构。

研究问题：${packet.question}
风险偏好：${packet.riskProfile}

决策包 JSON：
${JSON.stringify({
    generatedAt: packet.generatedAt,
    dataSources: packet.dataSources,
    candidates: packet.candidates,
    portfolioContext: packet.portfolioContext,
    dataGaps: packet.dataGaps,
    evidence: packet.evidence
  }, null, 2)}

请输出：
## 研究结论
明确最值得继续研究、等待确认和暂时排除的候选。

## 四角色复核
分别给出量化审查、产业与公司证据、反方/冲突、组合与风险四部分结论。

## 候选审查表
列出代码、名称、来源共识、支持证据、反证、数据缺口、确认条件、失效条件和研究优先级。

## 纸面组合输入
只给出适合进入纸面组合草稿的候选及理由，不给真实下单指令。

## 下一步补证
按优先级列出需要补充的财报、公告、资讯、盘口、行业或点时点数据。`;
  return appendOneClickOutputInstructions(prompt, {
    title: 'AI 研究决策包复核结果',
    sections: [
      '研究结论：继续研究 / 等待确认 / 暂时排除。',
      '四角色复核：量化、产业证据、反方冲突、组合风险。',
      '候选审查：代码、证据编号、确认条件、失效条件、数据缺口。',
      '纸面组合输入：仅列候选和研究理由，不生成真实订单。',
      '下一步补证：按优先级列出待核验数据。'
    ]
  });
}

async function buildDecisionPacket(input = {}) {
  const question = text(input.question || '综合当前量化模型、因子、专家资料和资讯，哪些股票值得继续研究？', 1000);
  const riskProfile = RISK_PROFILES.has(input.riskProfile) ? input.riskProfile : 'balanced';
  const maxCandidates = Math.min(Math.max(Number(input.maxCandidates) || 12, 3), 20);
  const requestedDatasetId = text(input.datasetId, 100);
  const quantEntries = latestPerModel(quant.listResults(50), requestedDatasetId);
  const datasetId = requestedDatasetId || (quantEntries[0] && quantEntries[0].result.dataManifest.datasetId) || '';
  const factorEntry = quant.listFactorResults(30).find(entry => entry.valid && entry.result && (!datasetId || entry.result.dataManifest.datasetId === datasetId));
  const savedScreener = screener.listScreenerResults(1)[0] || null;
  const candidateMap = new Map();
  const dataSources = [];
  let factorRankingSkipped = false;

  quantEntries.forEach(entry => {
    const result = entry.result;
    const source = {
      sourceId: result.runId,
      sourceLabel: result.modelId,
      sourceType: 'quant-model',
      asOf: result.asOf,
      datasetId: result.dataManifest.datasetId,
      validationStatus: result.validationStatus,
      metrics: result.metrics
    };
    dataSources.push(source);
    addRankedCandidates(candidateMap, source, result.candidates);
  });
  if (factorEntry) {
    const result = factorEntry.result;
    const source = {
      sourceId: result.runId,
      sourceLabel: '验证期加权复合因子',
      sourceType: 'factor-lab',
      asOf: result.asOf,
      datasetId: result.dataManifest.datasetId,
      validationStatus: result.validationStatus,
      metrics: result.composite.metrics,
      rankingEligible: factorRankingEligible(result),
      factorAdmissions: result.factors.reduce((summary, factor) => {
        summary[factor.admission] = (summary[factor.admission] || 0) + 1;
        return summary;
      }, {})
    };
    dataSources.push(source);
    if (source.rankingEligible) addRankedCandidates(candidateMap, source, result.composite.candidates);
    else factorRankingSkipped = true;
  }
  if (savedScreener && savedScreener.result) {
    const result = savedScreener.result;
    const source = {
      sourceId: 'screener-' + savedScreener.id,
      sourceLabel: savedScreener.taskName || result.strategy || '本地筛选',
      sourceType: 'local-screener',
      asOf: result.createdAt || savedScreener.createdAt || '',
      validationStatus: 'context',
      strategy: result.strategy || savedScreener.strategy
    };
    dataSources.push(source);
    addRankedCandidates(candidateMap, source, result.candidates);
  }

  const positions = portfolio.getPositions();
  const watchlist = portfolio.listWatchlist();
  const positionCodes = new Set(positions.map(item => item.code));
  const watchCodes = new Set(watchlist.map(item => item.code));
  if (!candidateMap.size) {
    addRankedCandidates(candidateMap, {
      sourceId: 'portfolio-context', sourceLabel: '持仓与自选上下文', sourceType: 'portfolio-context', validationStatus: 'context'
    }, positions.concat(watchlist));
  }

  let candidates = Array.from(candidateMap.values());
  const profiles = await stockProfiles.getProfiles(candidates.map(item => item.code), { detail: false, limit: 30 });
  const profileMap = new Map(profiles.map(item => [stockCode(item.code), item]));
  candidates = candidates.map(item => {
    const profile = profileMap.get(item.code) || {};
    const score = consensusScore(item.signals);
    const ranks = item.signals.map(signal => signal.rankPercentile);
    const themes = Array.isArray(profile.themes) ? profile.themes : Array.isArray(profile.tags) ? profile.tags : [];
    const boards = Array.isArray(profile.boards) ? profile.boards : [];
    return Object.assign(item, {
      consensusScore: score,
      signalCount: new Set(item.signals.map(signal => signal.sourceId)).size,
      modelDisagreement: ranks.length > 1 ? Number((Math.max(...ranks) - Math.min(...ranks)).toFixed(2)) : 0,
      industry: profile.industry || '',
      themes: themes.slice(0, 12),
      boards: boards.slice(0, 8),
      businessSummary: profile.businessSummary || profile.businessScope || '',
      inPortfolio: positionCodes.has(item.code),
      inWatchlist: watchCodes.has(item.code)
    });
  }).sort((left, right) => right.consensusScore - left.consensusScore || right.signalCount - left.signalCount || left.code.localeCompare(right.code))
    .slice(0, maxCandidates);

  const evidenceQuery = [question].concat(candidates.flatMap(item => [item.code, item.name, item.industry].concat(item.themes || [])))
    .filter(Boolean).join(' ').slice(0, 1200);
  let knowledgeResult = { engine: 'none', items: [] };
  let knowledgeError = '';
  try {
    knowledgeResult = knowledge.search({ query: evidenceQuery, sourceIds: input.sourceIds, limit: 12 });
  } catch (error) {
    knowledgeError = text(error && error.message ? error.message : error, 500);
  }
  const knowledgeEvidence = (knowledgeResult.items || []).map(item => Object.assign({ evidenceType: 'knowledge' }, item));
  const newsResult = buildNewsEvidence(candidates, question);
  const evidence = knowledgeEvidence.concat(newsResult.items).slice(0, 24);
  const dataGaps = [];
  const sourceDatasets = new Set(dataSources.map(source => source.datasetId).filter(Boolean));
  if (sourceDatasets.size > 1) dataGaps.push('候选来源使用了不同数据集，只能作为并列证据，不能做严格模型优劣比较');
  if (!quantEntries.length) dataGaps.push('没有可用的量化模型结果');
  if (!factorEntry) dataGaps.push('没有同数据集因子体检结果');
  else if (factorRankingSkipped) dataGaps.push('因子体检没有因子通过“候选”门禁，复合排名未计入共识分');
  if (!savedScreener) dataGaps.push('没有已保存的本地筛选任务');
  if (knowledgeError) dataGaps.push('专家资料库检索失败：' + knowledgeError);
  else if (!knowledgeEvidence.length) dataGaps.push('专家资料库没有匹配证据');
  if (!newsResult.items.length) dataGaps.push('没有匹配且带来源的资讯证据；本地兜底提示未作为外部证据');
  if (candidates.some(item => !item.businessSummary)) dataGaps.push('部分候选缺少主营业务摘要或营收结构');

  const packet = {
    schema: 'webstock.research.decision-packet.v1',
    generatedAt: new Date().toISOString(),
    question,
    riskProfile,
    datasetId,
    dataSources,
    candidates,
    evidence,
    evidenceEngine: knowledgeResult.engine,
    newsMeta: newsResult.meta,
    portfolioContext: {
      positions: positions.map(item => ({ code: item.code, name: item.name, quantity: item.quantity, costPrice: item.costPrice, finalPnlRate: item.finalPnlRate })),
      watchlist: watchlist.slice(0, 50).map(item => ({ code: item.code, name: item.name, groupName: item.groupName }))
    },
    dataGaps
  };
  packet.prompt = buildPrompt(packet);
  const run = researchRuns.createRun({
    runType: 'decision-packet',
    modelId: 'evidence-orchestrator-v1',
    status: 'completed',
    title: question,
    question,
    prompt: packet.prompt,
    result: JSON.stringify({ candidates, dataGaps, dataSources }, null, 2),
    evidence,
    request: { riskProfile, datasetId, maxCandidates }
  });
  packet.researchRunId = run.id;
  return packet;
}

module.exports = {
  buildDecisionPacket,
  latestPerModel,
  addRankedCandidates,
  consensusScore,
  factorRankingEligible,
  buildPrompt
};
