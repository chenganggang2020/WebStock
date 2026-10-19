const crypto = require('crypto');
const db = require('../db');
const calendar = require('./marketTradingCalendar');
const paperPortfolios = require('./paperPortfolioService');
const trading = require('./paperTradingService');
const holdingsService = require('./tonghuashunHoldingService');
const quoteService = require('./quoteService');
const marketOverviewService = require('./marketOverviewService');
const volumePaceService = require('./marketVolumePaceService');
const marketData = require('./marketDataService');
const { createPublicMinuteService } = require('./publicMinuteService');
const aiRoute = require('../routes/ai');
const {
  DECISION_JSON_SCHEMA,
  buildAllowedUniverse,
  assertFreshHoldingContext,
  buildMonitorPrompt
} = require('./paperMonitorPromptService');

const PREPARATION_MAX_AGE_MS = 5 * 60 * 1000;

function quoteIssues(universe, quoteResult, cutoff) {
  return universe.filter(item => {
    const quote = quoteResult && quoteResult.quotes && quoteResult.quotes[item.code];
    const observed = quote && Date.parse(quote.tradeDate + 'T' + quote.tradeTime + '+08:00');
    return !quote || !(Number(quote.price) > 0) || !Number.isFinite(observed) || observed > cutoff.getTime() + 5000 || cutoff.getTime() - observed > PREPARATION_MAX_AGE_MS;
  }).map(item => item.code);
}

function pointInTimeResearch(artifacts, cutoff) {
  const items = [];
  for (const [kind, artifact] of Object.entries(artifacts || {})) {
    if (!artifact) continue;
    const created = String(artifact.createdAt || '').replace(' ', 'T');
    const stamps = [artifact.asOf && artifact.asOf.observedAt, artifact.source && artifact.source.generatedAt, /Z$|[+-]\d{2}:\d{2}$/.test(created) ? created : created + 'Z'];
    if (stamps.some(value => !Number.isFinite(Date.parse(value)) || Date.parse(value) > cutoff.getTime())) continue;
    if (JSON.stringify(artifact).length > 40000) {
      items.push({ kind, marketDate: artifact.marketDate, source: artifact.source, asOf: artifact.asOf, payload: { summary: String(artifact.payload && artifact.payload.summary || '').slice(0, 6000) }, truncated: true });
    } else items.push(Object.assign({ kind }, artifact));
  }
  return { status: items.length ? 'available' : 'unavailable', items, note: '已保存的历史研究证据，不是实时事实；不扩展允许买卖的股票池。' };
}

function safeContext(result, label, cutoff) {
  if (result.status !== 'fulfilled') return { available: false, source: label, error: result.reason && result.reason.message || String(result.reason) };
  const value = result.value || {};
  const stamps = ['fetchedAt', 'observedAt', 'generatedAt'].filter(key => value[key]).map(key => Date.parse(value[key]));
  if (value.asOf) stamps.push(/^\d{2}:\d{2}(?::\d{2})?$/.test(value.asOf)
    ? Date.parse(value.tradingDate + 'T' + value.asOf + '+08:00') : Date.parse(value.asOf));
  if (!stamps.length || stamps.some(time => !Number.isFinite(time) || time > cutoff.getTime() || cutoff.getTime() - time > PREPARATION_MAX_AGE_MS)) {
    return { available: false, source: label, error: '来源时间缺失、已过期或晚于模型输入截止，未纳入判断' };
  }
  return Object.assign({}, value, { timeQuality: value.asOf ? 'source-time' : 'fetch-time-only', timeNote: '抓取时间不是交易所逐笔时间，未提供逐证券时间时不视为实时成交依据。' });
}

function createPaperMonitorService(options = {}) {
  const holdings = options.holdings || holdingsService;
  const quotes = options.quotes || quoteService;
  const marketOverview = options.marketOverview || marketOverviewService;
  const volumePace = options.volumePace || volumePaceService;
  const ai = options.ai || aiRoute;
  const minute = options.minute || createPublicMinuteService({ marketData });
  const now = typeof options.now === 'function' ? options.now : function() { return new Date(); };

  function getPendingHandoff(portfolioId) {
    if (paperPortfolios.getPortfolio(portfolioId).status !== 'active') return null;
    const timestamp = now().toISOString();
    const row = db.prepare(`SELECT payload_json FROM paper_monitor_preparations WHERE portfolio_id = ?
      AND decision_id IS NULL AND prepared_at <= ? AND expires_at >= ? ORDER BY prepared_at DESC, rowid DESC LIMIT 1`)
      .get(Number(portfolioId), timestamp, timestamp);
    if (!row) return null;
    const prepared = JSON.parse(row.payload_json);
    if ((prepared.context.holdingsSyncRequired !== false) !== trading.ensureMonitorSettings(portfolioId).holdingsSyncRequired) return null;
    return Object.assign({}, prepared, { handoffMode: true });
  }

  async function getReadiness(portfolioId, input = {}) {
    const timestamp = now();
    const paper = paperPortfolios.getPortfolio(portfolioId);
    const settings = trading.ensureMonitorSettings(paper.id);
    const current = calendar.clock(timestamp);
    const day = calendar.tradingDay(current.date);
    const inSession = calendar.isContinuousSession(timestamp);
    const checks = [];
    const add = (id, label, status, detail) => checks.push({ id, label, status, detail });
    add('account', '模拟账户', paper.status === 'active' ? 'ready' : 'blocked', paper.status === 'active' ? '独立纸面账本，不下实盘委托' : '账户不是观察中，请先切换状态');
    add('session', '交易时段', inSession ? 'ready' : day.known ? 'waiting' : 'blocked', inSession ? '已验证交易日盘中' : day.reason || '等待连续交易时段，休市及午休不生成新建议');
    let holdingContext = {};
    if (!settings.holdingsSyncRequired) add('holdings', '真实持仓', 'not-required', '独立模拟：不读取、不发送真实持仓');
    else {
      try {
        if (input.checkQuotes) holdingContext = assertFreshHoldingContext(holdings.getMonitorHoldingContext({ now: timestamp }), { now: timestamp });
        else {
          const status = input.holdingStatus || holdings.getMonitorStatus({ now: timestamp });
          holdingContext = assertFreshHoldingContext(Object.assign({}, status, { holdings: [] }), { now: timestamp });
        }
        add('holdings', '真实持仓', 'ready', '参考模式：最近 5 分钟持仓校验通过');
      } catch (error) { add('holdings', '真实持仓', 'blocked', error.message); }
    }
    const universe = buildAllowedUniverse(paper, holdingContext);
    const hasUniverse = universe.length > 0 || !input.checkQuotes && Number(holdingContext.holdingCount) > 0;
    add('universe', '候选股票池', hasUniverse ? 'ready' : 'blocked', hasUniverse ? universe.length + ' 只候选/模拟持仓' + (!input.checkQuotes && holdingContext.holdingCount ? '，另有真实持仓待运行时合并' : '') : '候选池为空，请明确添加股票代码；不会自动复制真实仓位');
    let marketStatus = 'unchecked';
    let marketDetail = '尚未检查；点击“检查运行条件”获取最新证券行情';
    if (input.checkQuotes && paper.status === 'active' && inSession && universe.length && checks.find(item => item.id === 'holdings').status !== 'blocked') {
      try {
        const result = await quotes.fetchSinaQuotes(universe.map(item => item.code));
        const issues = quoteIssues(universe, result, now());
        marketStatus = issues.length ? 'blocked' : 'ready';
        marketDetail = issues.length ? '缺价、旧价或未来时间：' + issues.slice(0, 5).join('、') + '（共 ' + issues.length + ' 只）' : universe.length + ' 只行情通过 5 分钟新鲜度校验；不等于逐笔实时行情';
      } catch (error) { marketStatus = 'blocked'; marketDetail = '行情获取失败：' + error.message; }
    }
    add('market', '证券行情', marketStatus, marketDetail);
    const config = ai.getAIConfig && ai.getAIConfig();
    const direct = (!ai.getAIEnabled || ai.getAIEnabled()) && config && ai.isValidApiKey(config.apiKey);
    add('model', '模型通道', direct ? 'ready' : 'handoff', direct ? '已配置 ' + (config.model || 'OpenAI') + '；配置检查不等于实际调用成功' : '直连未就绪，可生成提示词交给外部模型；必须回填结果，不能视作全自动');
    const scheduled = settings.enabled && !(settings.startMode === 'next-trading-day' && current.date <= calendar.clock(settings.activatedAt).date);
    add('schedule', '自动调度', scheduled ? 'ready' : 'waiting', scheduled ? settings.schedule.join(' / ') + '；程序需保持运行，时点启用不等于已执行' : settings.enabled ? '等待下一交易日启用' : '自动已暂停，不影响手动判断');
    const finishedAt = now();
    if (settings.holdingsSyncRequired && checks.find(item => item.id === 'holdings').status === 'ready') {
      try { assertFreshHoldingContext(holdingContext, { now: finishedAt }); }
      catch (error) { Object.assign(checks.find(item => item.id === 'holdings'), { status: 'blocked', detail: error.message }); }
    }
    const latestPaper = paperPortfolios.getPortfolio(paper.id);
    const latestSettings = trading.ensureMonitorSettings(paper.id);
    const changed = latestPaper.status !== paper.status || JSON.stringify(latestPaper.items) !== JSON.stringify(paper.items) ||
      ['holdingsSyncRequired', 'enabled', 'startMode', 'activatedAt'].some(key => latestSettings[key] !== settings[key]) || JSON.stringify(latestSettings.schedule) !== JSON.stringify(settings.schedule);
    if (changed) Object.assign(checks.find(item => item.id === 'market'), { status: 'blocked', detail: '检查期间账户、候选或模式设置已改变，请重新检查' });
    if (!calendar.isContinuousSession(finishedAt)) Object.assign(checks.find(item => item.id === 'session'), { status: 'waiting', detail: '当前不在连续交易时段，请在盘中重新检查' });
    const canPrepare = ['account', 'session', 'holdings', 'universe', 'market'].every(id => ['ready', 'not-required'].includes(checks.find(item => item.id === id).status));
    return { checkedAt: finishedAt.toISOString(), holdingsSyncRequired: settings.holdingsSyncRequired, checks, canPrepare, canRunDirect: Boolean(canPrepare && direct), automaticReady: Boolean(canPrepare && direct && scheduled) };
  }

  async function prepare(portfolioId, input = {}) {
    const timestamp = input.now ? new Date(input.now) : now();
    const paper = paperPortfolios.getPortfolio(portfolioId, { snapshotLimit: 5000 });
    if (paper.status !== 'active') throw new Error('只有观察中的模拟账户才能生成新建议');
    const settings = trading.ensureMonitorSettings(paper.id, { now: timestamp });
    const holdingContext = settings.holdingsSyncRequired ? assertFreshHoldingContext(
      holdings.getMonitorHoldingContext(Object.assign({}, input.holdingOptions, { now: timestamp })),
      { now: timestamp }
    ) : { available: false, excluded: true, source: '', observedAt: '', holdings: [] };
    const preliminary = buildMonitorPrompt({ paper, holdingContext, holdingsSyncRequired: settings.holdingsSyncRequired, asOf: timestamp.toISOString(), quotes: {} });
    const results = await Promise.allSettled([
      quotes.fetchSinaQuotes(preliminary.allowedUniverse.map(function(item) { return item.code; })),
      marketOverview.fetchIndexOverview(),
      volumePace.fetch({ refresh: input.refresh === true })
    ]);
    if (results[0].status !== 'fulfilled') throw new Error('点时证券行情不可用：' + (results[0].reason && results[0].reason.message || results[0].reason));
    const quoteResult = results[0].value;
    if (!quoteResult || !quoteResult.quotes || !Object.keys(quoteResult.quotes).length) {
      throw new Error('点时证券行情没有返回任何可用价格');
    }
    const cutoff = now();
    if (!calendar.isContinuousSession(cutoff)) throw new Error('当前不是已验证交易日的盘中时段，暂停新模拟建议');
    if (settings.holdingsSyncRequired) assertFreshHoldingContext(holdingContext, { now: cutoff });
    const invalidQuotes = quoteIssues(preliminary.allowedUniverse, quoteResult, cutoff);
    if (invalidQuotes.length) throw new Error('点时行情未通过新鲜度校验（过期、未来或缺价）：' + invalidQuotes.join('、'));
    if (trading.ensureMonitorSettings(paper.id).holdingsSyncRequired !== settings.holdingsSyncRequired) throw new Error('模拟模式已改变，请重新准备');
    if (JSON.stringify(paperPortfolios.getPortfolio(paper.id).items) !== JSON.stringify(paper.items)) throw new Error('候选股票池已改变，请重新准备');
    const currentClock = calendar.clock(cutoff);
    const currentMinute = Number(currentClock.time.slice(0, 2)) * 60 + Number(currentClock.time.slice(3, 5));
    const inferredTime = settings.schedule.find(time => {
      const minute = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
      return currentMinute >= minute && currentMinute < minute + 5;
    });
    const scheduleSlot = inferredTime ? currentClock.date + '@' + inferredTime : '';
    if (input.scheduleSlot && input.scheduleSlot !== scheduleSlot) throw new Error('调度时段已过期或不匹配当前时间');
    const built = buildMonitorPrompt({
      paper,
      holdingContext,
      holdingsSyncRequired: settings.holdingsSyncRequired,
      quotes: quoteResult.quotes,
      marketOverview: safeContext(results[1], 'market-overview', cutoff),
      volumePace: safeContext(results[2], 'market-volume-pace', cutoff),
      researchEvidence: pointInTimeResearch((options.research || require('./externalResearchBatchService')).listLatestArtifacts(), cutoff),
      asOf: cutoff.toISOString()
    });
    trading.updateMonitorRunStatus(paper.id, {
      lastHoldingsSyncAt: holdingContext.observedAt,
      lastHoldingsSource: holdingContext.source,
      lastError: ''
    });
    const prepared = Object.assign({}, built, {
      asOf: cutoff.toISOString(),
      preparationId: crypto.randomUUID(),
      expiresAt: new Date(Math.min(cutoff.getTime() + PREPARATION_MAX_AGE_MS,
        settings.holdingsSyncRequired ? Date.parse(holdingContext.observedAt) + PREPARATION_MAX_AGE_MS : Infinity)).toISOString(),
      scheduleSlot,
      holdingContext,
      quoteSource: quoteResult.source || '',
      quoteFetchedAt: quoteResult.fetchedAt || '',
      handoffMode: false
    });
    db.prepare('INSERT INTO paper_monitor_preparations (id, portfolio_id, prepared_at, expires_at, payload_json) VALUES (?, ?, ?, ?, ?)')
      .run(prepared.preparationId, paper.id, prepared.asOf, prepared.expiresAt, JSON.stringify(prepared));
    return prepared;
  }

  function acceptResponse(portfolioId, supplied, rawResponse, metadata) {
    const row = db.prepare('SELECT * FROM paper_monitor_preparations WHERE id = ? AND portfolio_id = ?')
      .get(String(supplied.preparationId || ''), Number(portfolioId));
    if (!row) throw new Error('手动交接准备记录校验失败，请重新生成');
    const prepared = JSON.parse(row.payload_json);
    for (const field of ['asOf', 'prompt', 'promptHash', 'allowedUniverse', 'context']) {
      if (JSON.stringify(prepared[field]) !== JSON.stringify(supplied[field])) throw new Error('手动交接上下文已修改，校验失败');
    }
    if (row.decision_id) {
      const decision = trading.listDecisions(portfolioId, 500).find(item => item.id === row.decision_id);
      if (!decision || decision.rawResponse !== String(rawResponse || '').trim()) throw new Error('该准备记录已使用，请重新生成');
      return { decision, orders: trading.listOrders(portfolioId, 1000).filter(item => item.decisionId === decision.id), deduplicated: true };
    }
    const receivedAt = now().toISOString();
    if (paperPortfolios.getPortfolio(portfolioId).status !== 'active') throw new Error('模拟账户已不在观察中，不能接收新建议');
    if (receivedAt < prepared.asOf || receivedAt > prepared.expiresAt) throw new Error('模型输入已过期或时间无效，请重新判断');
    const settings = trading.ensureMonitorSettings(portfolioId);
    const holdingsSyncRequired = prepared.context.holdingsSyncRequired !== false;
    if (settings.holdingsSyncRequired !== holdingsSyncRequired) throw new Error('模拟模式已改变，请重新准备');
    if (holdingsSyncRequired) assertFreshHoldingContext(prepared.holdingContext, { now: new Date(receivedAt) });
    return db.transaction(function() {
      const repeatedInvalid = db.prepare(`SELECT id FROM paper_model_decisions WHERE portfolio_id = ? AND prompt_hash = ?
        AND validation_status = 'invalid' AND raw_response = ? ORDER BY id DESC LIMIT 1`)
        .get(Number(portfolioId), prepared.promptHash, String(rawResponse || '').trim());
      if (repeatedInvalid) return { decision: trading.listDecisions(portfolioId, 500).find(item => item.id === repeatedInvalid.id), orders: [], deduplicated: true };
      const saved = trading.recordModelDecision(portfolioId, Object.assign({}, metadata, {
        advisedAt: receivedAt,
        marketAsOf: prepared.asOf,
        scheduleSlot: prepared.scheduleSlot,
        prompt: prepared.prompt,
        promptHash: prepared.promptHash,
        inputContext: prepared.context,
        allowedUniverse: prepared.allowedUniverse,
        rawResponse
      }));
      if (saved.decision.validationStatus === 'valid') db.prepare('UPDATE paper_monitor_preparations SET decision_id = ? WHERE id = ?').run(saved.decision.id, row.id);
      if (prepared.scheduleSlot) trading.saveMonitorRun(portfolioId, prepared.scheduleSlot, { status: saved.decision.validationStatus === 'valid' ? 'succeeded' : 'invalid', nextRetryAt: '', error: saved.decision.validationErrors.join('；') });
      trading.updateMonitorRunStatus(portfolioId, { lastRunSlot: prepared.scheduleSlot || undefined, lastError: saved.decision.validationErrors.join('；') });
      return saved;
    })();
  }

  async function run(portfolioId, input = {}) {
    const scheduleSlot = String(input.scheduleSlot || '');
    if (scheduleSlot) {
      const existing = trading.listDecisions(portfolioId, 500).find(function(item) {
        return item.scheduleSlot === scheduleSlot && item.validationStatus === 'valid';
      });
      if (existing) {
        return {
          handoffMode: false,
          deduplicated: true,
          saved: {
            decision: existing,
            orders: trading.listOrders(portfolioId, 1000).filter(function(order) { return order.decisionId === existing.id; })
          }
        };
      }
    }
    try {
      const prepared = await prepare(portfolioId, input);
      const config = ai.getAIConfig && ai.getAIConfig();
      const aiEnabled = !ai.getAIEnabled || ai.getAIEnabled();
      if (!aiEnabled || !config || !ai.isValidApiKey(config.apiKey)) {
        const reason = !aiEnabled
          ? 'OpenAI 自动调用未启用，请复制提示词到 ChatGPT 后粘贴 JSON 结果。'
          : 'OpenAI API Key 未配置，请复制提示词到 ChatGPT 后粘贴 JSON 结果。';
        if (scheduleSlot) {
          trading.updateMonitorRunStatus(portfolioId, {
            lastRunSlot: scheduleSlot,
            lastError: reason
          });
        }
        return Object.assign({}, prepared, {
          handoffMode: true,
          reason
        });
      }
      const rawResponse = await ai.callAIModel(prepared.prompt, {
        responseFormat: { type: 'json_schema', json_schema: DECISION_JSON_SCHEMA }
      });
      const saved = acceptResponse(portfolioId, prepared, rawResponse, {
        modelId: config.model || 'openai',
        mode: scheduleSlot ? 'scheduled' : 'direct',
        scheduleSlot,
        prompt: prepared.prompt,
        promptHash: prepared.promptHash,
        inputContext: prepared.context,
        allowedUniverse: prepared.allowedUniverse,
        rawResponse
      });
      trading.updateMonitorRunStatus(portfolioId, {
        lastHoldingsSyncAt: prepared.holdingContext.observedAt,
        lastHoldingsSource: prepared.holdingContext.source,
        lastRunSlot: scheduleSlot,
        lastError: saved.decision.validationStatus === 'valid' ? '' : saved.decision.validationErrors.join('；')
      });
      return { handoffMode: false, prepared, saved };
    } catch (error) {
      try { trading.updateMonitorRunStatus(portfolioId, { lastRunSlot: scheduleSlot, lastError: error.message }); } catch (ignored) {}
      throw error;
    }
  }

  function submitManual(portfolioId, input = {}) {
    const prepared = input.prepared && typeof input.prepared === 'object' ? input.prepared : {};
    return acceptResponse(portfolioId, prepared, input.rawResponse, {
      modelId: input.modelId || 'chatgpt-handoff',
      mode: 'manual'
    });
  }

  async function execute(portfolioId, input = {}) {
    const paper = paperPortfolios.getPortfolio(portfolioId);
    if (paper.status !== 'active') return { paper, orders: trading.listOrders(portfolioId), fills: [] };
    const pendingCodes = Array.from(new Set(trading.listOrders(portfolioId, 1000).filter(function(order) {
      return order.status === 'pending';
    }).map(function(order) { return order.code; }).concat(paper.positions.map(position => position.code))));
    const results = await Promise.all(pendingCodes.map(async function(code) {
      try { return [code, await minute.fetch(code)]; }
      catch (error) { return [code, { rows: [], meta: { stale: true, error: error.message } }]; }
    }));
    const executionOptions = { now: input.now || now().toISOString() };
    const markets = Object.fromEntries(results);
    const result = trading.executePendingOrders(portfolioId, markets, executionOptions);
    result.paper = trading.markToMarket(portfolioId, markets, executionOptions);
    return result;
  }

  return { getPendingHandoff, getReadiness, prepare, run, submitManual, execute };
}

const defaultService = createPaperMonitorService();

module.exports = {
  createPaperMonitorService,
  getPendingHandoff: defaultService.getPendingHandoff,
  getReadiness: defaultService.getReadiness,
  prepare: defaultService.prepare,
  run: defaultService.run,
  submitManual: defaultService.submitManual,
  execute: defaultService.execute
};
