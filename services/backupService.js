const db = require('../db');
const knowledgeService = require('./knowledgeService');
const paperPortfolioService = require('./paperPortfolioService');
const researchRunService = require('./researchRunService');
const expertChannelService = require('./expertChannelService');
const industryResearchService = require('./industryResearchService');

const BACKUP_VERSION = 8;
const MAX_ITEMS_PER_TABLE = 5000;
const BACKUP_TABLES = new Set([
  'portfolioAccounts', 'recentStocks', 'watchlist', 'trades', 'portfolioSnapshots',
  'sectors', 'sectorLeaders', 'sectorLeaderSnapshots', 'screenerResults',
  'screenerCandidateNotes', 'knowledgeSources', 'researchRuns', 'paperPortfolios', 'expertChannels', 'industryResearch'
]);

function validateBackup(backup) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) throw new Error('Backup JSON object is required');
  if (backup.version !== undefined && (!Number.isInteger(backup.version) || backup.version < 1 || backup.version > BACKUP_VERSION)) {
    throw new Error('Unsupported backup version');
  }
  const wrapped = Object.prototype.hasOwnProperty.call(backup, 'tables');
  const tables = wrapped ? backup.tables : backup;
  if (!tables || typeof tables !== 'object' || Array.isArray(tables)) throw new Error('Backup tables must be an object');
  const tableNames = Object.keys(tables).filter(key => BACKUP_TABLES.has(key));
  if (!tableNames.length) throw new Error('Backup must contain at least one supported table');
  if (wrapped && Object.keys(tables).some(key => !BACKUP_TABLES.has(key))) throw new Error('Unsupported table in backup');
  if (backup.version === BACKUP_VERSION) {
    const missingTables = [...BACKUP_TABLES].filter(key => !Object.prototype.hasOwnProperty.call(tables, key));
    if (missingTables.length) throw new Error('Current backup is missing required tables: ' + missingTables.join(', '));
  }
  for (const key of tableNames) {
    if (!Array.isArray(tables[key])) throw new Error('Backup table ' + key + ' must be an array');
    if (tables[key].some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
      throw new Error('Backup table ' + key + ' must contain only objects');
    }
  }
}

function text(value, fallback = '', maxLength = 2000) {
  const next = String(value == null ? fallback : value).trim();
  return next.slice(0, maxLength);
}

function code(value) {
  const next = String(value == null ? '' : value).trim();
  if (!/^\d{6}$/.test(next)) throw new Error('Invalid stock code in backup');
  return next;
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function numberOrZero(value) {
  const next = numberOrNull(value);
  return next == null ? 0 : next;
}

function integerOrZero(value) {
  const next = Number(value);
  return Number.isFinite(next) ? Math.trunc(next) : 0;
}

function arrayFromBackup(backup, key) {
  const tables = backup && backup.tables ? backup.tables : backup;
  const items = tables && Array.isArray(tables[key]) ? tables[key] : [];
  if (items.length > MAX_ITEMS_PER_TABLE) {
    throw new Error(key + ' exceeds import limit');
  }
  return items;
}

function packIndustryResearch(flat) {
  const topics = flat.topics.map(topic => {
    const versions = flat.versions.filter(version => version.topicId === topic.id);
    const versionEvidence = new Set(versions.flatMap(version => version.payload.evidenceIds || []));
    const evidence = flat.evidence.filter(item => versionEvidence.has(item.id));
    return { ...topic, evidence, versions, runs: flat.runs.filter(run => run.topicId === topic.id) };
  });
  const referenced = new Set(topics.flatMap(topic => topic.evidence.map(item => item.id)));
  if (referenced.size !== flat.evidence.length) throw new Error('Cannot export orphan industry research evidence');
  if (flat.versions.some(version => !topics.some(topic => topic.id === version.topicId)) || flat.runs.some(run => !topics.some(topic => topic.id === run.topicId))) {
    throw new Error('Cannot export orphan industry research records');
  }
  return topics;
}

function unpackIndustryResearch(groups) {
  const flat = { topics: [], evidence: [], versions: [], runs: [] };
  const seen = new Map();
  for (const group of groups) {
    if (!group || !Array.isArray(group.evidence) || !Array.isArray(group.versions) || !Array.isArray(group.runs) || typeof group.id !== 'string') throw new Error('Invalid industry research topic group');
    const { evidence = [], versions = [], runs = [], ...topic } = group;
    if (versions.some(item => !item || item.topicId !== group.id) || runs.some(item => !item || item.topicId !== group.id)) throw new Error('Industry research record does not belong to its topic group');
    flat.topics.push(topic);
    for (const [key, items] of [['evidence', evidence], ['versions', versions], ['runs', runs]]) {
      for (const item of items) {
        const prior = seen.get(`${key}:${item.id}`);
        if (prior && JSON.stringify(prior) !== JSON.stringify(item)) throw new Error('Duplicate industry research record conflict');
        if (!prior) { seen.set(`${key}:${item.id}`, item); flat[key].push(item); }
      }
    }
  }
  return flat;
}

function exportUserData() {
  const portfolioAccounts = db.prepare(`
    SELECT account_key AS accountKey, name, broker, masked_number AS maskedNumber,
      cash_balance AS cashBalance, is_default AS isDefault, note
    FROM portfolio_accounts
    WHERE enabled = 1
    ORDER BY is_default DESC, id ASC
  `).all().map(item => ({ ...item, isDefault: item.isDefault === 1 }));

  const recentStocks = db.prepare(`
    SELECT code, name, last_viewed_at AS lastViewedAt, view_count AS viewCount,
      last_price AS lastPrice, last_change AS lastChange
    FROM recent_stocks
    ORDER BY datetime(last_viewed_at) DESC
  `).all();

  const watchlist = db.prepare(`
    SELECT code, name, group_name AS groupName, note, alert_high AS alertHigh,
      alert_low AS alertLow, sort_order AS sortOrder,
      auto_d1_low AS autoD1Low, auto_d1_high AS autoD1High, auto_d2 AS autoD2,
      auto_r1 AS autoR1, auto_confirm AS autoConfirm,
      auto_levels_date AS autoLevelsDate, auto_levels_updated_at AS autoLevelsUpdatedAt,
      auto_levels_method AS autoLevelsMethod
    FROM watchlist
    ORDER BY sort_order ASC, updated_at DESC
  `).all();

  const trades = db.prepare(`
    SELECT account.account_key AS accountKey, trade.source_type AS sourceType, trade.code, trade.name, trade.side,
      trade.trade_date AS tradeDate, trade.price, trade.quantity, trade.fee, trade.tax, trade.amount, trade.note
    FROM trades AS trade
    JOIN portfolio_accounts AS account ON account.id = trade.account_id
    ORDER BY trade.trade_date DESC, trade.id DESC
  `).all();

  const portfolioSnapshots = db.prepare(`
    SELECT account.account_key AS accountKey, snapshot.snapshot_date AS snapshotDate,
      snapshot.total_market_value AS totalMarketValue, snapshot.cash_balance AS cashBalance,
      snapshot.total_assets AS totalAssets, snapshot.total_cost AS totalCost,
      snapshot.unrealized_pnl AS unrealizedPnl, snapshot.realized_pnl AS realizedPnl,
      snapshot.total_pnl AS totalPnl, snapshot.today_pnl AS todayPnl,
      snapshot.source_label AS sourceLabel, snapshot.holdings_json AS holdingsJson
    FROM portfolio_snapshots AS snapshot
    JOIN portfolio_accounts AS account ON account.id = snapshot.account_id
    ORDER BY snapshot.snapshot_date DESC, snapshot.id DESC
  `).all().map(item => {
    let holdings = [];
    try { holdings = JSON.parse(item.holdingsJson || '[]'); } catch (error) {}
    const { holdingsJson, ...snapshot } = item;
    return { ...snapshot, holdings };
  });

  const sectors = db.prepare(`
    SELECT id, name, description, sort_order AS sortOrder
    FROM sectors
    ORDER BY sort_order ASC, id ASC
  `).all();

  const sectorLeaders = db.prepare(`
    SELECT sector_id AS sectorId, code, name, role, reason, weight, note
    FROM sector_leaders
    ORDER BY sector_id ASC, weight DESC, id ASC
  `).all();

  const sectorLeaderSnapshots = db.prepare(`
    SELECT leader_id AS leaderId, sector_id AS sectorId, sector_name AS sectorName,
      code, name, price, change, amount, captured_at AS capturedAt
    FROM sector_leader_snapshots
    ORDER BY datetime(captured_at) DESC, id DESC
  `).all();

  const screenerResults = db.prepare(`
    SELECT id, task_name AS taskName, strategy, demand, result_json AS resultJson, ai_result AS aiResult
    FROM ai_screener_results
    ORDER BY datetime(created_at) DESC, id DESC
  `).all().map(item => {
    let result = null;
    try {
      result = JSON.parse(item.resultJson || '{}');
    } catch (error) {
      result = null;
    }
    return {
      id: item.id,
      taskName: item.taskName,
      strategy: item.strategy,
      demand: item.demand,
      result,
      aiResult: item.aiResult || ''
    };
  });

  const screenerCandidateNotes = db.prepare(`
    SELECT result_id AS resultId, code, status, note
    FROM screener_candidate_notes
    ORDER BY result_id ASC, code ASC
  `).all();

  const knowledgeSources = knowledgeService.exportSources();
  const researchRuns = researchRunService.exportRuns();
  const paperPortfolios = paperPortfolioService.exportPortfolios();
  const expertChannels = expertChannelService.exportChannels();

  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    tables: {
      portfolioAccounts,
      recentStocks,
      watchlist,
      trades,
      portfolioSnapshots,
      sectors,
      sectorLeaders,
      sectorLeaderSnapshots,
      screenerResults,
      screenerCandidateNotes,
      knowledgeSources,
      researchRuns,
      paperPortfolios,
      expertChannels,
      industryResearch: packIndustryResearch(industryResearchService.exportResearch())
    }
  };
}

function normalizeRecent(item) {
  return {
    code: code(item.code),
    name: text(item.name || item.code, item.code, 80),
    lastViewedAt: text(item.lastViewedAt, new Date().toISOString(), 40),
    viewCount: Math.max(integerOrZero(item.viewCount), 1),
    lastPrice: numberOrNull(item.lastPrice),
    lastChange: numberOrNull(item.lastChange)
  };
}

function normalizeWatchlist(item) {
  return {
    code: code(item.code),
    name: text(item.name || item.code, item.code, 80),
    groupName: text(item.groupName, 'Default', 80),
    note: text(item.note, '', 1000),
    alertHigh: numberOrNull(item.alertHigh),
    alertLow: numberOrNull(item.alertLow),
    sortOrder: integerOrZero(item.sortOrder),
    autoD1Low: numberOrNull(item.autoD1Low),
    autoD1High: numberOrNull(item.autoD1High),
    autoD2: numberOrNull(item.autoD2),
    autoR1: numberOrNull(item.autoR1),
    autoConfirm: numberOrNull(item.autoConfirm),
    autoLevelsDate: text(item.autoLevelsDate, '', 40),
    autoLevelsUpdatedAt: text(item.autoLevelsUpdatedAt, '', 40),
    autoLevelsMethod: text(item.autoLevelsMethod, '', 500)
  };
}

function normalizePortfolioAccount(item) {
  const accountKey = text(item.accountKey, '', 120);
  return {
    accountKey: accountKey || 'default',
    name: text(item.name, accountKey === 'default' ? '默认账户' : '持仓账户', 120),
    broker: text(item.broker, '', 120),
    maskedNumber: text(item.maskedNumber, '', 40),
    cashBalance: Math.max(numberOrZero(item.cashBalance), 0),
    isDefault: item.isDefault === true || item.isDefault === 1 || accountKey === 'default',
    note: text(item.note, '', 2000)
  };
}

function backupDate(value) {
  const date = text(value, '', 20);
  const parsed = new Date(date + 'T00:00:00.000Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('备份记录缺少有效原始日期，不能按今天的日期导入');
  }
  return date;
}

function normalizeTrade(item) {
  const side = text(item.side, '', 20);
  if (!['buy', 'sell', 'dividend', 'fee'].includes(side)) throw new Error('Invalid trade side in backup');
  const price = numberOrZero(item.price);
  const quantity = Math.max(integerOrZero(item.quantity), 0);
  const fee = Math.max(numberOrZero(item.fee), 0);
  const tax = Math.max(numberOrZero(item.tax), 0);
  const fallbackAmount = side === 'buy' ? price * quantity + fee + tax
    : side === 'sell' ? price * quantity - fee - tax
      : numberOrZero(item.amount);

  return {
    accountKey: text(item.accountKey, 'default', 120) || 'default',
    sourceType: text(item.sourceType, 'manual', 40) || 'manual',
    code: code(item.code),
    name: text(item.name || item.code, item.code, 80),
    side,
    tradeDate: backupDate(item.tradeDate),
    price,
    quantity,
    fee,
    tax,
    amount: item.amount === undefined || item.amount === null || item.amount === '' ? fallbackAmount : numberOrZero(item.amount),
    note: text(item.note, '', 1000)
  };
}

function normalizePortfolioSnapshot(item) {
  const holdings = Array.isArray(item.holdings) ? item.holdings.slice(0, 500).map(holding => ({
    code: code(holding.code),
    name: text(holding.name || holding.code, holding.code, 100),
    quantity: Math.max(integerOrZero(holding.quantity), 0),
    costValue: Math.max(numberOrZero(holding.costValue), 0),
    avgCost: Math.max(numberOrZero(holding.avgCost), 0),
    currentPrice: numberOrNull(holding.currentPrice),
    marketValue: numberOrNull(holding.marketValue),
    pnl: numberOrNull(holding.pnl),
    pnlRate: numberOrNull(holding.pnlRate)
  })).filter(holding => holding.quantity > 0) : [];
  return {
    accountKey: text(item.accountKey, 'default', 120) || 'default',
    snapshotDate: backupDate(item.snapshotDate),
    totalMarketValue: numberOrZero(item.totalMarketValue),
    cashBalance: numberOrZero(item.cashBalance),
    totalAssets: numberOrZero(item.totalAssets),
    totalCost: numberOrZero(item.totalCost),
    unrealizedPnl: numberOrZero(item.unrealizedPnl),
    realizedPnl: numberOrZero(item.realizedPnl),
    totalPnl: numberOrZero(item.totalPnl),
    todayPnl: numberOrZero(item.todayPnl),
    sourceLabel: text(item.sourceLabel, '', 200),
    holdingsJson: JSON.stringify(holdings)
  };
}

function normalizeSector(item) {
  return {
    oldId: integerOrZero(item.id),
    name: text(item.name, '', 80),
    description: text(item.description, '', 1000),
    sortOrder: integerOrZero(item.sortOrder)
  };
}

function normalizeLeader(item) {
  return {
    oldSectorId: integerOrZero(item.sectorId),
    code: code(item.code),
    name: text(item.name || item.code, item.code, 80),
    role: text(item.role, 'Observation', 80),
    reason: text(item.reason, '', 1000),
    weight: numberOrZero(item.weight) || 1,
    note: text(item.note, '', 1000)
  };
}

function normalizeLeaderSnapshot(item) {
  return {
    leaderId: integerOrZero(item.leaderId) || null,
    sectorId: integerOrZero(item.sectorId) || null,
    sectorName: text(item.sectorName, '', 120),
    code: code(item.code),
    name: text(item.name || item.code, item.code, 80),
    price: numberOrNull(item.price),
    change: numberOrNull(item.change),
    amount: numberOrNull(item.amount),
    capturedAt: text(item.capturedAt, new Date().toISOString(), 40)
  };
}

function normalizeScreenerResult(item) {
  const result = item.result || {};
  if (!result || !Array.isArray(result.candidates)) throw new Error('Invalid screener result in backup');
  return {
    oldId: integerOrZero(item.id),
    taskName: text(item.taskName || result.demand || result.strategy || 'Screener task', 'Screener task', 120),
    strategy: text(item.strategy || result.strategy || 'stable', 'stable', 80),
    demand: text(item.demand || result.demand || '', '', 1000),
    resultJson: JSON.stringify(result),
    aiResult: text(item.aiResult, '', 20000)
  };
}

function normalizeScreenerCandidateNote(item) {
  const status = text(item.status, 'watch', 20).toLowerCase();
  return {
    oldResultId: integerOrZero(item.resultId),
    code: code(item.code),
    status: ['watch', 'priority', 'risk', 'skip', 'done'].includes(status) ? status : 'watch',
    note: text(item.note, '', 2000)
  };
}

function normalizeStringArray(value, maxItems = 80) {
  const items = Array.isArray(value) ? value : [];
  return items.map(item => text(item, '', 160)).filter(Boolean).slice(0, maxItems);
}

function normalizeKnowledgeSource(item) {
  return {
    sourceKey: text(item.sourceKey, '', 80),
    sourceType: text(item.sourceType, 'note', 30),
    title: text(item.title, '', 200),
    author: text(item.author, '', 160),
    sourceUrl: text(item.sourceUrl, '', 1000),
    publishedAt: text(item.publishedAt, '', 40),
    tags: normalizeStringArray(item.tags),
    stockCodes: normalizeStringArray(item.stockCodes).filter(item => /^\d{6}$/.test(item)),
    sectors: normalizeStringArray(item.sectors),
    content: text(item.content, '', 800000),
    createdAt: text(item.createdAt, '', 40)
  };
}

function normalizeResearchRun(item) {
  return {
    runType: text(item.runType, '', 80),
    modelId: text(item.modelId, '', 120),
    status: text(item.status, 'completed', 30),
    title: text(item.title, '', 200),
    question: text(item.question, '', 2000),
    prompt: text(item.prompt, '', 250000),
    result: text(item.result, '', 250000),
    evidence: Array.isArray(item.evidence) ? item.evidence.slice(0, 100) : [],
    request: item.request && typeof item.request === 'object' ? item.request : {},
    metrics: item.metrics && typeof item.metrics === 'object' ? item.metrics : {},
    createdAt: text(item.createdAt, '', 40)
  };
}

function normalizePaperPortfolio(item) {
  const status = text(item.status, 'draft', 20).toLowerCase();
  const riskProfile = text(item.riskProfile, 'balanced', 20).toLowerCase();
  const paperItems = Array.isArray(item.items) ? item.items : [];
  const paperPositions = Array.isArray(item.positions) ? item.positions : [];
  const paperSnapshots = Array.isArray(item.snapshots) ? item.snapshots : [];
  const monitor = item.monitor && typeof item.monitor === 'object' ? item.monitor : null;
  return {
    name: text(item.name, 'Paper portfolio', 160),
    status: ['draft', 'active', 'archived'].includes(status) ? status : 'draft',
    asOf: text(item.asOf, new Date().toISOString(), 40),
    capital: Math.max(numberOrZero(item.capital) || 100000, 1000),
    cashWeight: Math.min(Math.max(numberOrZero(item.cashWeight), 0), 1),
    riskProfile: ['conservative', 'balanced', 'aggressive'].includes(riskProfile) ? riskProfile : 'balanced',
    constraints: item.constraints && typeof item.constraints === 'object' ? item.constraints : {},
    rationale: text(item.rationale, '', 4000),
    items: paperItems.slice(0, 100).map(position => ({
      code: code(position.code),
      name: text(position.name || position.code, position.code, 100),
      targetWeight: Math.min(Math.max(numberOrZero(position.targetWeight), 0), 1),
      consensusScore: Math.min(Math.max(numberOrZero(position.consensusScore), 0), 100),
      signalCount: Math.max(integerOrZero(position.signalCount), 0),
      rationale: text(position.rationale, '', 2000),
      risks: normalizeStringArray(position.risks, 30),
      evidence: normalizeStringArray(position.evidence, 50)
    })).filter(position => position.targetWeight > 0),
    positions: paperPositions.slice(0, 100).map(position => ({
      code: code(position.code),
      name: text(position.name || position.code, position.code, 100),
      quantity: Math.max(integerOrZero(position.quantity), 0),
      entryPrice: Math.max(numberOrZero(position.entryPrice), 0),
      entryValue: Math.max(numberOrZero(position.entryValue), 0),
      entryFee: Math.max(numberOrZero(position.entryFee), 0),
      lastPrice: Math.max(numberOrZero(position.lastPrice), 0),
      lastMarketValue: Math.max(numberOrZero(position.lastMarketValue), 0),
      openedAt: text(position.openedAt, new Date().toISOString(), 40)
    })).filter(position => position.code && position.quantity > 0 && position.entryPrice > 0),
    snapshots: paperSnapshots.slice(0, MAX_ITEMS_PER_TABLE).map(snapshot => ({
      snapshotAt: text(snapshot.snapshotAt, '', 40),
      marketDate: text(snapshot.marketDate, '', 20),
      marketTime: text(snapshot.marketTime, '', 20),
      cashValue: Math.max(numberOrZero(snapshot.cashValue), 0),
      marketValue: Math.max(numberOrZero(snapshot.marketValue), 0),
      totalValue: Math.max(numberOrZero(snapshot.totalValue), 0),
      dailyPnl: numberOrZero(snapshot.dailyPnl),
      totalPnl: numberOrZero(snapshot.totalPnl),
      totalReturn: numberOrZero(snapshot.totalReturn),
      source: text(snapshot.source, '', 100),
      sourceMetadata: snapshot.sourceMetadata && typeof snapshot.sourceMetadata === 'object' ? snapshot.sourceMetadata : {},
      warnings: normalizeStringArray(snapshot.warnings, 100)
    })).filter(snapshot => snapshot.snapshotAt),
    monitor: monitor ? {
      runs: (Array.isArray(monitor.runs) ? monitor.runs : []).slice(0, MAX_ITEMS_PER_TABLE).map(run => ({
        slot: text(run.slot, '', 40), status: text(run.status, '', 30), attempts: Math.max(integerOrZero(run.attempts), 0),
        lastAttemptAt: text(run.lastAttemptAt, '', 40), nextRetryAt: text(run.nextRetryAt, '', 40), error: text(run.error, '', 2000)
      })).filter(run => /^\d{4}-\d{2}-\d{2}@\d{2}:\d{2}$/.test(run.slot) && ['running', 'retrying', 'succeeded', 'invalid', 'failed', 'missed', 'handoff'].includes(run.status)),
      settings: monitor.settings ? {
        enabled: monitor.settings.enabled !== false,
        startMode: monitor.settings.startMode === 'next-trading-day' ? 'next-trading-day' : 'today',
        activatedAt: text(monitor.settings.activatedAt, new Date().toISOString(), 40),
        schedule: normalizeStringArray(monitor.settings.schedule, 12).filter(value => /^\d{2}:\d{2}$/.test(value)),
        holdingsSyncRequired: monitor.settings.holdingsSyncRequired !== false,
        lastHoldingsSyncAt: text(monitor.settings.lastHoldingsSyncAt, '', 80),
        lastHoldingsSource: text(monitor.settings.lastHoldingsSource, '', 120),
        lastRunSlot: text(monitor.settings.lastRunSlot, '', 40),
        lastError: text(monitor.settings.lastError, '', 2000)
      } : null,
      decisions: (Array.isArray(monitor.decisions) ? monitor.decisions : []).slice(0, MAX_ITEMS_PER_TABLE).map(decision => ({
        backupId: Math.max(integerOrZero(decision.id), 0),
        advisedAt: text(decision.advisedAt, '', 40),
        marketAsOf: text(decision.marketAsOf, '', 40),
        modelId: text(decision.modelId, 'chatgpt-handoff', 120),
        mode: ['direct', 'manual', 'scheduled'].includes(decision.mode) ? decision.mode : 'manual',
        scheduleSlot: text(decision.scheduleSlot, '', 40),
        promptHash: text(decision.promptHash, '', 128),
        prompt: text(decision.prompt, '', 250000),
        inputContext: decision.inputContext && typeof decision.inputContext === 'object' ? decision.inputContext : {},
        allowedUniverse: Array.isArray(decision.allowedUniverse) ? decision.allowedUniverse.slice(0, 200) : [],
        rawResponse: text(decision.rawResponse, '', 250000),
        decision: decision.decision && typeof decision.decision === 'object' ? decision.decision : {},
        validationStatus: decision.validationStatus === 'valid' ? 'valid' : 'invalid',
        validationErrors: normalizeStringArray(decision.validationErrors, 100)
      })).filter(decision => decision.backupId && decision.advisedAt),
      orders: (Array.isArray(monitor.orders) ? monitor.orders : []).slice(0, MAX_ITEMS_PER_TABLE).map(order => ({
        backupId: Math.max(integerOrZero(order.id), 0),
        decisionBackupId: Math.max(integerOrZero(order.decisionId), 0),
        code: code(order.code),
        name: text(order.name || order.code, order.code, 100),
        action: ['buy', 'sell', 'hold'].includes(order.action) ? order.action : 'hold',
        targetPositionPercent: Math.min(Math.max(numberOrZero(order.targetPositionPercent), 0), 100),
        confidence: Math.min(Math.max(numberOrZero(order.confidence), 0), 100),
        reason: text(order.reason, '', 4000),
        invalidation: text(order.invalidation, '', 4000),
        advisedAt: text(order.advisedAt, '', 40),
        status: ['pending', 'filled', 'rejected', 'held', 'cancelled'].includes(order.status) ? order.status : 'rejected',
        statusReason: text(order.statusReason, '', 2000),
        filledQuantity: Math.max(integerOrZero(order.filledQuantity), 0)
      })).filter(order => order.backupId && order.decisionBackupId),
      fills: (Array.isArray(monitor.fills) ? monitor.fills : []).slice(0, MAX_ITEMS_PER_TABLE).map(fill => ({
        orderBackupId: Math.max(integerOrZero(fill.orderId), 0),
        code: code(fill.code),
        side: fill.side === 'sell' ? 'sell' : 'buy',
        filledAt: text(fill.filledAt, '', 40),
        marketDate: text(fill.marketDate, '', 20),
        marketTime: text(fill.marketTime, '', 20),
        dataSource: text(fill.dataSource, '', 100),
        rawPrice: Math.max(numberOrZero(fill.rawPrice), 0),
        executionPrice: Math.max(numberOrZero(fill.executionPrice), 0),
        quantity: Math.max(integerOrZero(fill.quantity), 0),
        grossValue: Math.max(numberOrZero(fill.grossValue), 0),
        commission: Math.max(numberOrZero(fill.commission), 0),
        stampDuty: Math.max(numberOrZero(fill.stampDuty), 0),
        cashChange: numberOrZero(fill.cashChange)
      })).filter(fill => fill.orderBackupId && fill.quantity > 0 && fill.filledAt)
    } : null
  };
}

function normalizeExpertChannel(item) {
  const observations = Array.isArray(item.observations) ? item.observations : [];
  const backtests = Array.isArray(item.backtests) ? item.backtests : [];
  if (observations.length > 1000 || backtests.length > 500) throw new Error('expert channel exceeds import limit');
  return {
    channelKey: text(item.channelKey, '', 120),
    displayName: text(item.displayName, '', 160),
    subjectType: text(item.subjectType, 'creator', 30),
    platform: text(item.platform, '', 60),
    profileUrl: text(item.profileUrl, '', 1200),
    description: text(item.description, '', 10000),
    aliases: normalizeStringArray(item.aliases, 100),
    discoveryQueries: normalizeStringArray(item.discoveryQueries, 30),
    enabled: item.enabled !== false,
    observations: observations.map(observation => ({
      externalKey: text(observation.externalKey, '', 200),
      externalContentId: text(observation.externalContentId, '', 160),
      sourceUrl: text(observation.sourceUrl, '', 1200),
      title: text(observation.title, '', 300),
      author: text(observation.author, '', 160),
      publishedAt: text(observation.publishedAt, '', 50),
      publishedTimePrecision: text(observation.publishedTimePrecision, 'unknown', 20),
      firstSeenAt: text(observation.firstSeenAt, '', 50),
      lastSeenAt: text(observation.lastSeenAt, '', 50),
      evidenceLevel: text(observation.evidenceLevel, 'primary', 40),
      availabilityStatus: text(observation.availabilityStatus, 'available', 40),
      contentRole: text(observation.contentRole, 'direct_quote', 40),
      content: text(observation.content, '', 800000),
      summary: text(observation.summary, '', 10000),
      description: text(observation.description, '', 20000),
      transcript: text(observation.transcript, '', 800000),
      engagement: observation.engagement && typeof observation.engagement === 'object' ? observation.engagement : {},
      mediaMetadata: observation.mediaMetadata && typeof observation.mediaMetadata === 'object' ? observation.mediaMetadata : {},
      signal: observation.signal && typeof observation.signal === 'object' ? observation.signal : {},
      stockCodes: normalizeStringArray(observation.stockCodes).filter(code => /^\d{6}$/.test(code)),
      sectors: normalizeStringArray(observation.sectors),
      topics: normalizeStringArray(observation.topics),
      mediaType: text(observation.mediaType, 'text', 40),
      archiveStatus: text(observation.archiveStatus, 'linked', 40),
      rightsBasis: text(observation.rightsBasis, 'quotation_only', 40),
      localAssetPath: text(observation.localAssetPath, '', 2000),
      curveData: Array.isArray(observation.curveData) ? observation.curveData.slice(0, 2000) : [],
      analysisNotes: text(observation.analysisNotes, '', 20000),
      stance: text(observation.stance, 'unknown', 40),
      horizon: text(observation.horizon, 'unspecified', 80),
      confidence: Math.min(Math.max(numberOrZero(observation.confidence), 0), 1),
      commentData: {
        comments: (observation.commentData && Array.isArray(observation.commentData.comments)
          ? observation.commentData.comments : []).slice(0, 200).map(comment => ({
          commentId: text(comment.commentId, '', 200),
          parentCommentId: text(comment.parentCommentId, '', 200),
          replyToCommentId: text(comment.replyToCommentId, '', 200),
          authorName: text(comment.authorName, '', 160),
          authorPlatformId: text(comment.authorPlatformId, '', 200),
          authorProfileUrl: text(comment.authorProfileUrl, '', 1200),
          text: text(comment.text, '', 10000),
          publishedAt: text(comment.publishedAt, '', 80),
          likes: comment.likes == null ? null : Math.max(numberOrZero(comment.likes), 0),
          isCreatorLabel: comment.creatorStatus === 'platform_marked'
        })).filter(comment => comment.commentId && comment.text),
        coverage: observation.commentData && observation.commentData.coverage ? {
          status: text(observation.commentData.coverage.status, 'not_loaded', 40),
          message: text(observation.commentData.coverage.message, '', 500),
          observedAt: text(observation.commentData.coverage.observedAt, '', 50),
          visibleCount: Math.max(numberOrZero(observation.commentData.coverage.visibleCount), 0),
          complete: false
        } : null
      }
    })),
    backtests: backtests.map(backtest => ({
      runId: text(backtest.runId, '', 160),
      datasetId: text(backtest.datasetId, '', 160),
      status: text(backtest.status, 'exploratory', 40),
      signalAt: text(backtest.signalAt, '', 50),
      eligibleAt: text(backtest.eligibleAt, '', 50),
      instrumentCode: text(backtest.instrumentCode, 'MULTI', 20),
      benchmarkCode: text(backtest.benchmarkCode, '', 20),
      horizons: Array.isArray(backtest.horizons) ? backtest.horizons.slice(0, 20) : [],
      methodology: backtest.methodology && typeof backtest.methodology === 'object' ? backtest.methodology : {},
      result: backtest.result && typeof backtest.result === 'object' ? backtest.result : {},
      resultPath: text(backtest.resultPath, '', 2000),
      resultSha256: text(backtest.resultSha256, '', 80)
    })).filter(backtest => backtest.runId)
  };
}

function prepareImport(backup) {
  validateBackup(backup);
  const portfolioAccounts = arrayFromBackup(backup, 'portfolioAccounts').map(normalizePortfolioAccount);
  const recentStocks = arrayFromBackup(backup, 'recentStocks').map(normalizeRecent);
  const watchlist = arrayFromBackup(backup, 'watchlist').map(normalizeWatchlist);
  const trades = arrayFromBackup(backup, 'trades').map(normalizeTrade);
  const portfolioSnapshots = arrayFromBackup(backup, 'portfolioSnapshots').map(normalizePortfolioSnapshot);
  // Legacy trades may have no account identity; do not recreate default for unrelated imports.
  if (trades.concat(portfolioSnapshots).some(item => item.accountKey === 'default') &&
      !portfolioAccounts.some(account => account.accountKey === 'default')) {
    portfolioAccounts.unshift(normalizePortfolioAccount({ accountKey: 'default', name: '默认账户', isDefault: true }));
  }
  if (new Set(portfolioAccounts.map(item => item.accountKey)).size !== portfolioAccounts.length) {
    throw new Error('备份含重复账户身份，不能安全导入');
  }
  const sectors = arrayFromBackup(backup, 'sectors').map(normalizeSector).filter(item => item.name);
  const sectorLeaders = arrayFromBackup(backup, 'sectorLeaders').map(normalizeLeader);
  const sectorLeaderSnapshots = arrayFromBackup(backup, 'sectorLeaderSnapshots').map(normalizeLeaderSnapshot);
  const screenerResults = arrayFromBackup(backup, 'screenerResults').map(normalizeScreenerResult);
  const screenerCandidateNotes = arrayFromBackup(backup, 'screenerCandidateNotes').map(normalizeScreenerCandidateNote);
  const knowledgeSources = arrayFromBackup(backup, 'knowledgeSources').map(normalizeKnowledgeSource);
  const researchRuns = arrayFromBackup(backup, 'researchRuns').map(normalizeResearchRun);
  const paperPortfolios = arrayFromBackup(backup, 'paperPortfolios').map(normalizePaperPortfolio);
  const expertChannels = arrayFromBackup(backup, 'expertChannels').map(normalizeExpertChannel)
    .filter(item => item.channelKey && item.displayName && item.platform);
  const tables = backup.tables || backup;
  const industryResearch = !Array.isArray(tables.industryResearch) ? null : industryResearchService.validateResearch(unpackIndustryResearch(tables.industryResearch));
  return {
    portfolioAccounts,
    recentStocks,
    watchlist,
    trades,
    portfolioSnapshots,
    sectors,
    sectorLeaders,
    sectorLeaderSnapshots,
    screenerResults,
    screenerCandidateNotes,
    knowledgeSources,
    researchRuns,
    paperPortfolios,
    expertChannels,
    industryResearch
  };
}

function countsForPrepared(prepared) {
  return {
    portfolioAccounts: prepared.portfolioAccounts.length,
    recentStocks: prepared.recentStocks.length,
    watchlist: prepared.watchlist.length,
    trades: prepared.trades.length,
    portfolioSnapshots: prepared.portfolioSnapshots.length,
    sectors: prepared.sectors.length,
    sectorLeaders: prepared.sectorLeaders.length,
    sectorLeaderSnapshots: prepared.sectorLeaderSnapshots.length,
    screenerResults: prepared.screenerResults.length,
    screenerCandidateNotes: prepared.screenerCandidateNotes.length,
    knowledgeSources: prepared.knowledgeSources.length,
    researchRuns: prepared.researchRuns.length,
    paperPortfolios: prepared.paperPortfolios.length,
    expertChannels: prepared.expertChannels.length,
    industryResearch: prepared.industryResearch ? {
      topics: prepared.industryResearch.topics.length,
      evidence: prepared.industryResearch.evidence.length,
      versions: prepared.industryResearch.versions.length,
      runs: prepared.industryResearch.runs.length
    } : null
  };
}

function currentCounts() {
  return {
    portfolioAccounts: db.prepare('SELECT COUNT(*) AS count FROM portfolio_accounts WHERE enabled = 1').get().count,
    recentStocks: db.prepare('SELECT COUNT(*) AS count FROM recent_stocks').get().count,
    watchlist: db.prepare('SELECT COUNT(*) AS count FROM watchlist').get().count,
    trades: db.prepare('SELECT COUNT(*) AS count FROM trades').get().count,
    portfolioSnapshots: db.prepare('SELECT COUNT(*) AS count FROM portfolio_snapshots').get().count,
    sectors: db.prepare('SELECT COUNT(*) AS count FROM sectors').get().count,
    sectorLeaders: db.prepare('SELECT COUNT(*) AS count FROM sector_leaders').get().count,
    sectorLeaderSnapshots: db.prepare('SELECT COUNT(*) AS count FROM sector_leader_snapshots').get().count,
    screenerResults: db.prepare('SELECT COUNT(*) AS count FROM ai_screener_results').get().count,
    screenerCandidateNotes: db.prepare('SELECT COUNT(*) AS count FROM screener_candidate_notes').get().count,
    knowledgeSources: db.prepare('SELECT COUNT(*) AS count FROM knowledge_sources').get().count,
    researchRuns: db.prepare('SELECT COUNT(*) AS count FROM ai_research_runs').get().count,
    paperPortfolios: db.prepare('SELECT COUNT(*) AS count FROM paper_portfolios').get().count,
    expertChannels: db.prepare('SELECT COUNT(*) AS count FROM expert_channels').get().count,
    industryResearch: {
      topics: db.prepare('SELECT COUNT(*) AS count FROM industry_research_topics').get().count,
      evidence: db.prepare('SELECT COUNT(*) AS count FROM industry_research_evidence').get().count,
      versions: db.prepare('SELECT COUNT(*) AS count FROM industry_research_versions').get().count,
      runs: db.prepare('SELECT COUNT(*) AS count FROM industry_research_runs').get().count
    }
  };
}

function importMode(options = {}) {
  if (options.mode !== undefined && !['merge', 'replace'].includes(options.mode)) {
    throw new Error('无效的导入模式，只支持 merge 或 replace');
  }
  return options.mode || 'replace';
}

function planPortfolioMerge(prepared) {
  const accounts = new Map(db.prepare('SELECT * FROM portfolio_accounts').all().map(row => [row.account_key, row]));
  const declared = new Set(prepared.portfolioAccounts.map(item => item.accountKey));
  const skipTrades = new Set();
  const skipSnapshots = new Set();
  const conflicts = [];
  const keys = new Set(prepared.trades.concat(prepared.portfolioSnapshots).map(item => item.accountKey));
  const sameRows = (a, b) => JSON.stringify(a.map(item => JSON.stringify(item)).sort()) ===
    JSON.stringify(b.map(item => JSON.stringify(item)).sort());
  for (const accountKey of keys) {
    const account = accounts.get(accountKey);
    if (!account) {
      if (!declared.has(accountKey)) conflicts.push({ accountKey, reason: '备份交易或快照缺少对应账户，不能转入其他账户' });
      continue;
    }
    if (!account.enabled) {
      conflicts.push({ accountKey, reason: '当前账户已停用，不能通过合并重新激活或追加持仓' });
      continue;
    }
    const oldTrades = db.prepare(`SELECT source_type AS sourceType, code, name, side, trade_date AS tradeDate,
      price, quantity, fee, tax, amount, note FROM trades WHERE account_id = ?`).all(account.id)
      .map(row => normalizeTrade({ ...row, accountKey }));
    const oldSnapshots = db.prepare(`SELECT snapshot_date AS snapshotDate, total_market_value AS totalMarketValue,
      cash_balance AS cashBalance, total_assets AS totalAssets, total_cost AS totalCost,
      unrealized_pnl AS unrealizedPnl, realized_pnl AS realizedPnl, total_pnl AS totalPnl, today_pnl AS todayPnl,
      source_label AS sourceLabel, holdings_json AS holdingsJson FROM portfolio_snapshots WHERE account_id = ?`).all(account.id)
      .map(row => normalizePortfolioSnapshot({ ...row, accountKey, holdings: JSON.parse(row.holdingsJson || '[]') }));
    if (!oldTrades.length && !oldSnapshots.length) continue;
    for (const [table, stored, skipped] of [
      ['trades', oldTrades, skipTrades], ['portfolioSnapshots', oldSnapshots, skipSnapshots]
    ]) {
      const incoming = prepared[table].filter(item => item.accountKey === accountKey);
      if (!incoming.length) continue;
      // Old JSON exports have no stable transaction IDs. Only an identical complete history
      // can be skipped; differing histories need a source-aware recovery, never guessed deduplication.
      if (sameRows(incoming, stored)) skipped.add(accountKey);
      else conflicts.push({ accountKey, table, reason: '已有账户历史与备份不一致；缺少逐笔身份，不能安全追加' });
    }
  }
  return {
    accounts, skipTrades, skipSnapshots, conflicts,
    preserved: {
      portfolioAccounts: prepared.portfolioAccounts.filter(item => accounts.has(item.accountKey)).length,
      watchlist: prepared.watchlist.filter(item => db.prepare('SELECT 1 FROM watchlist WHERE code = ?').get(item.code)).length,
      trades: prepared.trades.filter(item => skipTrades.has(item.accountKey)).length,
      portfolioSnapshots: prepared.portfolioSnapshots.filter(item => skipSnapshots.has(item.accountKey)).length
    }
  };
}

function previewUserDataImport(backup, options = {}) {
  const mode = importMode(options);
  const prepared = prepareImport(backup);
  const legacyScope = backup.version !== BACKUP_VERSION;
  const plan = mode === 'merge' ? planPortfolioMerge(prepared) : null;
  return {
    mode,
    canImport: !plan || plan.conflicts.length === 0,
    conflicts: plan ? plan.conflicts : [],
    preserved: plan ? plan.preserved : null,
    legacyScope,
    warnings: (legacyScope ? ['旧版备份可能仅包含部分数据；未提供的产业研究数据会被保留（不再清空为空表），其他未提供表按旧版兼容规则处理。请先保存当前完整备份。'] : [])
      .concat(mode === 'merge' ? ['合并保留已有账户与自选资料；相同账户的完整历史一致时跳过，不一致时停止导入。其他类别仍按原有合并规则处理。'] : []),
    incoming: countsForPrepared(prepared),
    current: currentCounts()
  };
}

function importUserData(backup, options = {}) {
  const mode = importMode(options);
  const prepared = prepareImport(backup);
  const {
    portfolioAccounts,
    recentStocks,
    watchlist,
    trades,
    portfolioSnapshots,
    sectors,
    sectorLeaders,
    sectorLeaderSnapshots,
    screenerResults,
    screenerCandidateNotes,
    knowledgeSources,
    researchRuns,
    paperPortfolios,
    expertChannels,
    industryResearch
  } = prepared;

  const summary = {
    mode,
    ...countsForPrepared(prepared)
  };

  db.transaction(function() {
    const mergePlan = mode === 'merge' ? planPortfolioMerge(prepared) : null;
    if (mergePlan && mergePlan.conflicts.length) {
      throw new Error('账户合并冲突：' + mergePlan.conflicts.map(item => item.accountKey + '：' + item.reason).join('；'));
    }
    if (mergePlan) summary.preserved = mergePlan.preserved;
    if (mode === 'replace') {
      db.prepare('DELETE FROM sector_leaders').run();
      db.prepare('DELETE FROM sector_leader_snapshots').run();
      db.prepare('DELETE FROM sectors').run();
      db.prepare('DELETE FROM recent_stocks').run();
      db.prepare('DELETE FROM watchlist').run();
      db.prepare('DELETE FROM trades').run();
      db.prepare('DELETE FROM portfolio_snapshots').run();
      db.prepare('DELETE FROM portfolio_accounts WHERE is_default = 0').run();
      db.prepare('DELETE FROM screener_candidate_notes').run();
      db.prepare('DELETE FROM ai_screener_results').run();
      db.prepare('DELETE FROM ai_research_runs').run();
      db.prepare('DELETE FROM expert_channels').run();
      db.prepare('DELETE FROM knowledge_sources').run();
      db.prepare('DELETE FROM paper_portfolios').run();
    }

    const insertRecent = db.prepare(`
      INSERT INTO recent_stocks (code, name, last_viewed_at, view_count, last_price, last_change)
      VALUES (@code, @name, @lastViewedAt, @viewCount, @lastPrice, @lastChange)
      ON CONFLICT(code) DO UPDATE SET
        name = excluded.name,
        last_viewed_at = excluded.last_viewed_at,
        view_count = excluded.view_count,
        last_price = excluded.last_price,
        last_change = excluded.last_change,
        updated_at = CURRENT_TIMESTAMP
    `);

    const insertWatchlist = db.prepare(`
      INSERT INTO watchlist (
        code, name, group_name, note, alert_high, alert_low, sort_order,
        auto_d1_low, auto_d1_high, auto_d2, auto_r1, auto_confirm,
        auto_levels_date, auto_levels_updated_at, auto_levels_method
      ) VALUES (
        @code, @name, @groupName, @note, @alertHigh, @alertLow, @sortOrder,
        @autoD1Low, @autoD1High, @autoD2, @autoR1, @autoConfirm,
        @autoLevelsDate, @autoLevelsUpdatedAt, @autoLevelsMethod
      )
      ON CONFLICT(code) DO UPDATE SET
        name = excluded.name,
        group_name = excluded.group_name,
        note = excluded.note,
        alert_high = excluded.alert_high,
        alert_low = excluded.alert_low,
        sort_order = excluded.sort_order,
        auto_d1_low = excluded.auto_d1_low,
        auto_d1_high = excluded.auto_d1_high,
        auto_d2 = excluded.auto_d2,
        auto_r1 = excluded.auto_r1,
        auto_confirm = excluded.auto_confirm,
        auto_levels_date = excluded.auto_levels_date,
        auto_levels_updated_at = excluded.auto_levels_updated_at,
        auto_levels_method = excluded.auto_levels_method,
        updated_at = CURRENT_TIMESTAMP
    `);

    const upsertPortfolioAccount = db.prepare(`
      INSERT INTO portfolio_accounts (
        account_key, name, broker, masked_number, cash_balance, is_default, enabled, note
      ) VALUES (@accountKey, @name, @broker, @maskedNumber, @cashBalance, @isDefault, 1, @note)
      ON CONFLICT(account_key) DO UPDATE SET
        name = excluded.name,
        broker = excluded.broker,
        masked_number = excluded.masked_number,
        cash_balance = excluded.cash_balance,
        enabled = 1,
        note = excluded.note,
        updated_at = CURRENT_TIMESTAMP
    `);
    const findPortfolioAccount = db.prepare('SELECT id FROM portfolio_accounts WHERE account_key = ?');

    const insertTrade = db.prepare(`
      INSERT INTO trades (account_id, source_type, code, name, side, trade_date, price, quantity, fee, tax, amount, note)
      VALUES (@accountId, @sourceType, @code, @name, @side, @tradeDate, @price, @quantity, @fee, @tax, @amount, @note)
    `);
    const insertPortfolioSnapshot = db.prepare(`
      INSERT INTO portfolio_snapshots (
        account_id, snapshot_date, total_market_value, cash_balance, total_assets, total_cost,
        unrealized_pnl, realized_pnl, total_pnl, today_pnl, source_label, holdings_json
      ) VALUES (
        @accountId, @snapshotDate, @totalMarketValue, @cashBalance, @totalAssets, @totalCost,
        @unrealizedPnl, @realizedPnl, @totalPnl, @todayPnl, @sourceLabel, @holdingsJson
      )
    `);

    const upsertSector = db.prepare(`
      INSERT INTO sectors (name, description, sort_order)
      VALUES (@name, @description, @sortOrder)
      ON CONFLICT(name) DO UPDATE SET
        description = excluded.description,
        sort_order = excluded.sort_order,
        updated_at = CURRENT_TIMESTAMP
    `);

    const getSectorId = db.prepare('SELECT id FROM sectors WHERE name = ?');

    const insertLeader = db.prepare(`
      INSERT INTO sector_leaders (sector_id, code, name, role, reason, weight, note)
      VALUES (@sectorId, @code, @name, @role, @reason, @weight, @note)
      ON CONFLICT(sector_id, code, role) DO UPDATE SET
        name = excluded.name,
        reason = excluded.reason,
        weight = excluded.weight,
        note = excluded.note,
        updated_at = CURRENT_TIMESTAMP
    `);

    const insertLeaderSnapshot = db.prepare(`
      INSERT INTO sector_leader_snapshots (leader_id, sector_id, sector_name, code, name, price, change, amount, captured_at)
      VALUES (@leaderId, @sectorId, @sectorName, @code, @name, @price, @change, @amount, @capturedAt)
    `);

    const insertScreenerResult = db.prepare(`
      INSERT INTO ai_screener_results (task_name, strategy, demand, result_json, ai_result)
      VALUES (@taskName, @strategy, @demand, @resultJson, @aiResult)
    `);

    const insertScreenerCandidateNote = db.prepare(`
      INSERT INTO screener_candidate_notes (result_id, code, status, note)
      VALUES (@resultId, @code, @status, @note)
      ON CONFLICT(result_id, code) DO UPDATE SET
        status = excluded.status,
        note = excluded.note,
        updated_at = CURRENT_TIMESTAMP
    `);

    const insertPaperPortfolio = db.prepare(`
      INSERT INTO paper_portfolios (
        name, status, as_of, capital, cash_weight, risk_profile, constraints_json, rationale, source_run_id
      ) VALUES (@name, @status, @asOf, @capital, @cashWeight, @riskProfile, @constraintsJson, @rationale, NULL)
    `);
    const insertPaperPortfolioItem = db.prepare(`
      INSERT INTO paper_portfolio_items (
        portfolio_id, code, name, target_weight, consensus_score, signal_count, rationale, risks_json, evidence_json
      ) VALUES (@portfolioId, @code, @name, @targetWeight, @consensusScore, @signalCount, @rationale, @risksJson, @evidenceJson)
    `);
    const insertPaperPortfolioPosition = db.prepare(`
      INSERT INTO paper_portfolio_positions (
        portfolio_id, code, name, quantity, entry_price, entry_value, entry_fee,
        last_price, last_market_value, opened_at
      ) VALUES (@portfolioId, @code, @name, @quantity, @entryPrice, @entryValue, @entryFee,
        @lastPrice, @lastMarketValue, @openedAt)
    `);
    const insertPaperPortfolioSnapshot = db.prepare(`
      INSERT INTO paper_portfolio_snapshots (
        portfolio_id, snapshot_at, market_date, market_time, cash_value, market_value,
        total_value, daily_pnl, total_pnl, total_return, source, source_metadata_json, warnings_json
      ) VALUES (@portfolioId, @snapshotAt, @marketDate, @marketTime, @cashValue, @marketValue,
        @totalValue, @dailyPnl, @totalPnl, @totalReturn, @source, @sourceMetadataJson, @warningsJson)
    `);
    const insertPaperMonitorSettings = db.prepare(`
      INSERT INTO paper_monitor_settings (
        portfolio_id, enabled, start_mode, activated_at, schedule_json, holdings_sync_required,
        last_holdings_sync_at, last_holdings_source, last_run_slot, last_error
      ) VALUES (@portfolioId, @enabled, @startMode, @activatedAt, @scheduleJson, @holdingsSyncRequired,
        @lastHoldingsSyncAt, @lastHoldingsSource, @lastRunSlot, @lastError)
    `);
    const insertPaperDecision = db.prepare(`
      INSERT INTO paper_model_decisions (
        portfolio_id, advised_at, market_as_of, model_id, mode, schedule_slot, prompt_hash,
        prompt_text, input_context_json, allowed_universe_json, raw_response, decision_json,
        validation_status, validation_errors_json
      ) VALUES (@portfolioId, @advisedAt, @marketAsOf, @modelId, @mode, @scheduleSlot, @promptHash,
        @prompt, @inputContextJson, @allowedUniverseJson, @rawResponse, @decisionJson,
        @validationStatus, @validationErrorsJson)
    `);
    const insertPaperOrder = db.prepare(`
      INSERT INTO paper_orders (
        portfolio_id, decision_id, code, name, action, target_position_percent, confidence,
        reason, invalidation, advised_at, status, status_reason, filled_quantity
      ) VALUES (@portfolioId, @decisionId, @code, @name, @action, @targetPositionPercent, @confidence,
        @reason, @invalidation, @advisedAt, @status, @statusReason, @filledQuantity)
    `);
    const insertPaperFill = db.prepare(`
      INSERT INTO paper_fills (
        portfolio_id, order_id, code, side, filled_at, market_date, market_time, data_source,
        raw_price, execution_price, quantity, gross_value, commission, stamp_duty, cash_change
      ) VALUES (@portfolioId, @orderId, @code, @side, @filledAt, @marketDate, @marketTime, @dataSource,
        @rawPrice, @executionPrice, @quantity, @grossValue, @commission, @stampDuty, @cashChange)
    `);

    const portfolioAccountIdMap = new Map();
    portfolioAccounts.forEach(item => {
      const existing = findPortfolioAccount.get(item.accountKey);
      if (mode !== 'merge' || !existing) {
        const keepCurrentDefault = mode === 'merge' && db.prepare('SELECT 1 FROM portfolio_accounts WHERE is_default = 1 AND enabled = 1').get();
        upsertPortfolioAccount.run({ ...item, isDefault: keepCurrentDefault ? 0 : item.isDefault ? 1 : 0 });
      }
      const row = findPortfolioAccount.get(item.accountKey);
      if (row) portfolioAccountIdMap.set(item.accountKey, row.id);
    });
    if (mergePlan) mergePlan.accounts.forEach((row, key) => portfolioAccountIdMap.set(key, row.id));
    const resolveAccount = item => {
      const id = portfolioAccountIdMap.get(item.accountKey);
      if (!id) throw new Error('备份缺少对应持仓账户：' + item.accountKey);
      return id;
    };

    recentStocks.forEach(item => insertRecent.run(item));
    watchlist.forEach(item => {
      if (mode !== 'merge' || !db.prepare('SELECT 1 FROM watchlist WHERE code = ?').get(item.code)) insertWatchlist.run(item);
    });
    trades.filter(item => !mergePlan || !mergePlan.skipTrades.has(item.accountKey)).forEach(item => insertTrade.run({
      ...item,
      accountId: resolveAccount(item)
    }));
    portfolioSnapshots.filter(item => !mergePlan || !mergePlan.skipSnapshots.has(item.accountKey)).forEach(item => insertPortfolioSnapshot.run({
      ...item,
      accountId: resolveAccount(item)
    }));
    const screenerResultIdMap = new Map();
    screenerResults.forEach(item => {
      const info = insertScreenerResult.run({
        taskName: item.taskName,
        strategy: item.strategy,
        demand: item.demand,
        resultJson: item.resultJson,
        aiResult: item.aiResult
      });
      if (item.oldId) screenerResultIdMap.set(item.oldId, info.lastInsertRowid);
    });

    screenerCandidateNotes.forEach(item => {
      const resultId = screenerResultIdMap.get(item.oldResultId);
      if (!resultId) return;
      insertScreenerCandidateNote.run({
        resultId,
        code: item.code,
        status: item.status,
        note: item.note
      });
    });

    const sectorIdMap = new Map();
    sectors.forEach(item => {
      upsertSector.run(item);
      const row = getSectorId.get(item.name);
      if (row) sectorIdMap.set(item.oldId, row.id);
    });

    sectorLeaders.forEach(item => {
      const sectorId = sectorIdMap.get(item.oldSectorId);
      if (!sectorId) return;
      insertLeader.run({
        sectorId,
        code: item.code,
        name: item.name,
        role: item.role,
        reason: item.reason,
        weight: item.weight,
        note: item.note
      });
    });

    sectorLeaderSnapshots.forEach(item => insertLeaderSnapshot.run(item));
    knowledgeSources.forEach(item => knowledgeService.createSource(item));
    researchRuns.forEach(item => researchRunService.createRun(item));
    expertChannelService.restoreChannels(expertChannels);
    if (industryResearch) industryResearchService.restoreResearch(industryResearch, { mode, transactional: false });
    paperPortfolios.forEach(item => {
      const info = insertPaperPortfolio.run({
        name: item.name,
        status: item.status,
        asOf: item.asOf,
        capital: item.capital,
        cashWeight: item.cashWeight,
        riskProfile: item.riskProfile,
        constraintsJson: JSON.stringify(item.constraints),
        rationale: item.rationale
      });
      item.items.forEach(position => insertPaperPortfolioItem.run({
        portfolioId: info.lastInsertRowid,
        code: position.code,
        name: position.name,
        targetWeight: position.targetWeight,
        consensusScore: position.consensusScore,
        signalCount: position.signalCount,
        rationale: position.rationale,
        risksJson: JSON.stringify(position.risks),
        evidenceJson: JSON.stringify(position.evidence)
      }));
      item.positions.forEach(position => insertPaperPortfolioPosition.run(Object.assign({
        portfolioId: info.lastInsertRowid
      }, position)));
      item.snapshots.forEach(snapshot => insertPaperPortfolioSnapshot.run({
        portfolioId: info.lastInsertRowid,
        snapshotAt: snapshot.snapshotAt,
        marketDate: snapshot.marketDate,
        marketTime: snapshot.marketTime,
        cashValue: snapshot.cashValue,
        marketValue: snapshot.marketValue,
        totalValue: snapshot.totalValue,
        dailyPnl: snapshot.dailyPnl,
        totalPnl: snapshot.totalPnl,
        totalReturn: snapshot.totalReturn,
        source: snapshot.source,
        sourceMetadataJson: JSON.stringify(snapshot.sourceMetadata),
        warningsJson: JSON.stringify(snapshot.warnings)
      }));
      if (item.monitor && item.monitor.settings) {
        const settings = item.monitor.settings;
        insertPaperMonitorSettings.run({
          portfolioId: info.lastInsertRowid,
          enabled: settings.enabled ? 1 : 0,
          startMode: settings.startMode,
          activatedAt: settings.activatedAt,
          scheduleJson: JSON.stringify(settings.schedule.length ? settings.schedule : ['09:35', '10:30', '14:50']),
          holdingsSyncRequired: settings.holdingsSyncRequired ? 1 : 0,
          lastHoldingsSyncAt: settings.lastHoldingsSyncAt,
          lastHoldingsSource: settings.lastHoldingsSource,
          lastRunSlot: settings.lastRunSlot,
          lastError: settings.lastError
        });
      }
      if (item.monitor) {
        item.monitor.runs.forEach(run => {
          db.prepare(`INSERT INTO paper_monitor_runs (portfolio_id, slot, status, attempts, last_attempt_at, next_retry_at, error)
            VALUES (?, ?, ?, ?, ?, ?, ?)`).run(info.lastInsertRowid, run.slot, run.status, run.attempts, run.lastAttemptAt, run.nextRetryAt, run.error);
        });
        const decisionIdMap = new Map();
        item.monitor.decisions.forEach(decision => {
          const restored = insertPaperDecision.run({
            portfolioId: info.lastInsertRowid,
            advisedAt: decision.advisedAt,
            marketAsOf: decision.marketAsOf,
            modelId: decision.modelId,
            mode: decision.mode,
            scheduleSlot: decision.scheduleSlot,
            promptHash: decision.promptHash,
            prompt: decision.prompt,
            inputContextJson: JSON.stringify(decision.inputContext),
            allowedUniverseJson: JSON.stringify(decision.allowedUniverse),
            rawResponse: decision.rawResponse,
            decisionJson: JSON.stringify(decision.decision),
            validationStatus: decision.validationStatus,
            validationErrorsJson: JSON.stringify(decision.validationErrors)
          });
          decisionIdMap.set(decision.backupId, Number(restored.lastInsertRowid));
        });
        const orderIdMap = new Map();
        item.monitor.orders.forEach(order => {
          const decisionId = decisionIdMap.get(order.decisionBackupId);
          if (!decisionId) return;
          const restored = insertPaperOrder.run(Object.assign({}, order, {
            portfolioId: info.lastInsertRowid,
            decisionId
          }));
          orderIdMap.set(order.backupId, Number(restored.lastInsertRowid));
        });
        item.monitor.fills.forEach(fill => {
          const orderId = orderIdMap.get(fill.orderBackupId);
          if (!orderId) return;
          insertPaperFill.run(Object.assign({}, fill, {
            portfolioId: info.lastInsertRowid,
            orderId
          }));
        });
      }
    });
  })();

  return summary;
}

module.exports = {
  BACKUP_VERSION,
  exportUserData,
  importUserData,
  previewUserDataImport
};
