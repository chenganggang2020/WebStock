const SCHEMA = 'webstock.mobile-snapshot/v1';
const MOBILE_NEWS_LIMIT = 40;
const MOBILE_CANDIDATE_LIMIT = 20;
const { classifyChinaQuoteStatus } = require('./quoteSnapshotService');

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value, maximum = 160) {
  return String(value == null ? '' : value).trim().slice(0, maximum);
}

function safePosition(position, quoteStatus) {
  return {
    code: cleanText(position.code, 12),
    name: cleanText(position.name, 80),
    quantity: finiteOrNull(position.quantity),
    avgCost: finiteOrNull(position.avgCost),
    currentPrice: finiteOrNull(position.currentPrice),
    change: finiteOrNull(position.change),
    marketValue: finiteOrNull(position.marketValue),
    costValue: finiteOrNull(position.costValue),
    unrealizedPnl: finiteOrNull(position.unrealizedPnl == null ? position.pnl : position.unrealizedPnl),
    unrealizedPnlRate: finiteOrNull(position.unrealizedPnlRate == null ? position.pnlRate : position.unrealizedPnlRate),
    todayPnl: finiteOrNull(position.todayPnl == null ? position.todayReferencePnl : position.todayPnl),
    quoteDate: cleanText(position.quoteDate, 20),
    quoteTime: cleanText(position.quoteTime, 20),
    quoteStatus: cleanText(quoteStatus || position.quoteStatus || 'unavailable', 30)
  };
}

function snapshotPositions(saved) {
  return (Array.isArray(saved.holdings) ? saved.holdings : []).map(function(position) {
    return safePosition({
      ...position,
      unrealizedPnl: position.pnl,
      unrealizedPnlRate: position.pnlRate,
      quoteDate: saved.snapshotDate,
      quoteTime: ''
    }, 'saved-snapshot');
  });
}

function safeLiveSummary(summary, allValued) {
  return {
    cashBalance: finiteOrNull(summary.cashBalance),
    totalAssets: allValued ? finiteOrNull(summary.totalAssets) : null,
    totalMarketValue: allValued ? finiteOrNull(summary.totalMarketValue) : null,
    totalCost: finiteOrNull(summary.totalCost),
    unrealizedPnl: allValued ? finiteOrNull(summary.unrealizedPnl) : null,
    todayPnl: allValued ? finiteOrNull(summary.todayPnl == null ? summary.todayReferencePnl : summary.todayPnl) : null,
    realizedPnl: finiteOrNull(summary.realizedPnl),
    totalPnl: allValued ? finiteOrNull(summary.totalPnl) : null,
    totalPnlRate: allValued ? finiteOrNull(summary.totalPnlRate) : null,
    positionCount: finiteOrNull(summary.positionCount)
  };
}

function savedSummary(saved) {
  return {
    cashBalance: finiteOrNull(saved.cashBalance),
    totalAssets: finiteOrNull(saved.totalAssets),
    totalMarketValue: finiteOrNull(saved.totalMarketValue),
    totalCost: finiteOrNull(saved.totalCost),
    unrealizedPnl: finiteOrNull(saved.unrealizedPnl),
    todayPnl: finiteOrNull(saved.todayPnl),
    realizedPnl: finiteOrNull(saved.realizedPnl),
    totalPnl: finiteOrNull(saved.totalPnl),
    totalPnlRate: saved.totalCost > 0 ? Number((Number(saved.totalPnl || 0) / Number(saved.totalCost) * 100).toFixed(2)) : null,
    positionCount: Array.isArray(saved.holdings) ? saved.holdings.length : 0
  };
}

function latestQuoteObservation(positions) {
  return positions.map(function(position) {
    return [position.quoteDate, position.quoteTime].filter(Boolean).join(' ');
  }).filter(Boolean).sort().pop() || null;
}

function safeAccount(input) {
  const livePositions = (Array.isArray(input.positions) ? input.positions : []).map(position => safePosition(position));
  const valuedCount = livePositions.filter(position => position.currentPrice !== null).length;
  const allValued = livePositions.length === 0 || valuedCount === livePositions.length;
  const hasLiveValuation = livePositions.length > 0 && allValued;
  const saved = input.latestSnapshot && Array.isArray(input.latestSnapshot.holdings)
    ? input.latestSnapshot : null;
  const useSaved = !hasLiveValuation && saved && saved.holdings.length > 0;

  let valuationStatus = 'unavailable';
  let observedAt = null;
  let positions = livePositions;
  let summary = safeLiveSummary(input.summary || {}, hasLiveValuation);
  let source = { kind: 'market-quote', label: '实时行情', stale: false };

  if (hasLiveValuation) {
    const statuses = new Set(livePositions.map(position => position.quoteStatus));
    valuationStatus = statuses.has('stale') || statuses.has('latest-close') ? 'stale' : 'live';
    observedAt = latestQuoteObservation(livePositions);
    source.stale = valuationStatus === 'stale';
    if (valuationStatus === 'stale') source.label = '最近收盘行情';
  } else if (useSaved) {
    valuationStatus = 'saved-snapshot';
    observedAt = cleanText(saved.snapshotDate, 20) || null;
    positions = snapshotPositions(saved);
    summary = savedSummary(saved);
    source = {
      kind: 'broker-snapshot',
      label: cleanText(saved.sourceLabel, 120) || '已保存持仓快照',
      stale: true
    };
  } else if (livePositions.length === 0) {
    valuationStatus = 'cash-only';
    summary = safeLiveSummary(input.summary || {}, true);
    source = { kind: 'local-account', label: '本地账户', stale: false };
  } else if (valuedCount > 0) {
    valuationStatus = 'partial';
    observedAt = latestQuoteObservation(livePositions);
    source = { kind: 'market-quote', label: '部分行情可用', stale: true };
  } else {
    source = { kind: 'unavailable', label: '行情不可用', stale: true };
  }

  return {
    id: Number(input.id),
    name: cleanText(input.name, 120),
    broker: cleanText(input.broker, 120),
    maskedNumber: cleanText(input.maskedNumber, 60),
    isDefault: input.isDefault === true,
    valuationStatus,
    observedAt,
    source,
    summary,
    positions
  };
}

function safeResearchChannel(channel) {
  return {
    channelKey: cleanText(channel.channelKey, 120),
    displayName: cleanText(channel.displayName, 160),
    platform: cleanText(channel.platform, 60),
    observationCount: Number(channel.observationCount || 0),
    videoCount: Number(channel.videoCount || 0),
    transcriptCount: Number(channel.transcriptCount || 0),
    archiveCount: Number(channel.archiveCount || 0),
    lastUpdatedAt: cleanText(channel.lastUpdatedAt || channel.updatedAt, 50) || null
  };
}

function safeHttpUrl(value) {
  const candidate = cleanText(value, 2048);
  if (!candidate) return '#';
  try {
    const parsed = new URL(candidate);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password
      ? parsed.toString() : '#';
  } catch (error) {
    return '#';
  }
}

function safeWatchlist(input) {
  const items = (Array.isArray(input.watchlist) ? input.watchlist : []).map(function(item) {
    return {
      code: cleanText(item.code, 12),
      name: cleanText(item.name, 80),
      groupName: cleanText(item.groupName, 80),
      note: cleanText(item.note, 200),
      alertHigh: finiteOrNull(item.alertHigh),
      alertLow: finiteOrNull(item.alertLow),
      currentPrice: finiteOrNull(item.currentPrice),
      previousClose: finiteOrNull(item.previousClose),
      change: finiteOrNull(item.change),
      quoteDate: cleanText(item.quoteDate, 20),
      quoteTime: cleanText(item.quoteTime, 20),
      quoteStatus: cleanText(item.quoteStatus || 'unavailable', 30)
    };
  });
  const quotedCount = items.filter(item => item.currentPrice !== null).length;
  return {
    status: !items.length ? 'empty' : quotedCount === items.length ? 'available' : quotedCount ? 'partial' : 'unavailable',
    items,
    observation: {
      source: cleanText(input.watchlistMeta && input.watchlistMeta.source, 80) || 'sina-public-quote',
      observedAt: cleanText(input.watchlistMeta && input.watchlistMeta.observedAt, 50) || null,
      requestedCount: items.length,
      receivedCount: quotedCount
    }
  };
}

function safeImportance(value) {
  const score = finiteOrNull(value && value.score);
  const level = ['high', 'medium', 'low'].includes(value && value.level) ? value.level : 'low';
  const reasons = (Array.isArray(value && value.reasons) ? value.reasons : [])
    .map(reason => cleanText(reason, 240)).filter(Boolean).slice(0, 3);
  return {
    score,
    level,
    label: level === 'high' ? '重点' : level === 'medium' ? '关注' : '一般',
    reason: reasons[0] || '暂无可验证的本地重点信号。',
    reasons,
    method: cleanText(value && value.method, 80) || 'local-research-priority-v1',
    scope: cleanText(value && value.scope, 80) || 'local-research-priority'
  };
}

function safeNews(input) {
  const feed = input.newsFeed || null;
  if (!feed) {
    return {
      status: 'unavailable', generatedAt: null, items: [],
      pagination: { limit: MOBILE_NEWS_LIMIT, returned: 0, sourceCount: 0, hasMore: false },
      message: '资讯服务暂不可用。'
    };
  }
  const sourceItems = Array.isArray(feed.items) ? feed.items : [];
  const items = sourceItems.slice(0, MOBILE_NEWS_LIMIT).map(function(item) {
    const relatedStocks = (Array.isArray(item.relatedStocks) ? item.relatedStocks : [])
      .map(value => cleanText(value, 20)).filter(Boolean).slice(0, 8);
    const relatedSectors = (Array.isArray(item.relatedSectors) ? item.relatedSectors : [])
      .map(value => cleanText(value, 40)).filter(Boolean).slice(0, 8);
    const imageUrl = safeHttpUrl(item.imageUrl || item.image && item.image.url);
    return {
      id: cleanText(item.id, 120),
      title: cleanText(item.title, 240),
      source: cleanText(item.source, 100) || 'WebStock',
      provider: cleanText(item.provider, 100) || cleanText(item.source, 100) || 'WebStock',
      time: cleanText(item.time, 50) || null,
      summary: cleanText(item.summary, 600),
      link: safeHttpUrl(item.link),
      imageUrl: imageUrl === '#' ? null : imageUrl,
      relatedStocks,
      relatedSectors,
      importance: safeImportance(item.importance)
    };
  }).filter(item => item.title);
  const coverage = feed.coverage || {};
  const sourceCount = Math.max(Number(coverage.sourceItemCount) || sourceItems.length, items.length);
  const hasMore = coverage.truncated === true || sourceItems.length > items.length || sourceCount > items.length;
  return {
    status: feed.error ? 'unavailable' : feed.degraded ? 'degraded' : items.length ? 'available' : 'empty',
    generatedAt: cleanText(feed.generatedAt, 50) || null,
    items,
    pagination: { limit: MOBILE_NEWS_LIMIT, returned: items.length, sourceCount, hasMore },
    coverage: {
      validTimestampCount: finiteOrNull(coverage.validTimestampCount),
      explicitAssociationItemCount: finiteOrNull(coverage.explicitAssociationItemCount)
    },
    message: cleanText(feed.error && (feed.error.message || feed.error), 240) ||
      (feed.degraded ? '部分资讯来源暂不可用，以下为当前可验证结果。' : '')
  };
}

function safeCapitalMomentum(input) {
  const envelope = input.capitalMomentum || null;
  if (!envelope) {
    return { status: 'unavailable', target: null, source: null, observation: null, latest: null, points: [], message: '暂无可展示的资金动量。' };
  }
  const target = envelope.target || {};
  const latest = envelope.latest || null;
  const observation = envelope.observation || null;
  const available = envelope.availability === 'available' && latest;
  const status = available ? (observation && observation.isStale ? 'degraded' : 'available') : 'unavailable';
  function safePoint(point) {
    if (!point) return null;
    return {
      timestamp: cleanText(point.timestamp, 50) || null,
      netAmount: finiteOrNull(point.netAmount),
      netFlowSpeed: finiteOrNull(point.netFlowSpeed),
      netFlowAcceleration: finiteOrNull(point.netFlowAcceleration),
      flowState: {
        code: cleanText(point.flowState && point.flowState.code, 60),
        label: cleanText(point.flowState && point.flowState.label, 80) || '状态不足'
      }
    };
  }
  return {
    status,
    target: target.code ? { code: cleanText(target.code, 12), name: cleanText(target.name, 80) } : null,
    source: envelope.source ? {
      sourceClass: cleanText(envelope.source.sourceClass, 80),
      provider: cleanText(envelope.source.provider, 100),
      truthStatement: cleanText(envelope.source.truthStatement, 240)
    } : null,
    observation: observation ? {
      state: cleanText(observation.state, 40),
      observedAt: cleanText(observation.observedAt, 50) || null,
      checkedAt: cleanText(observation.checkedAt, 50) || null,
      isStale: observation.isStale === true,
      reason: cleanText(observation.reason, 120) || null
    } : null,
    latest: safePoint(latest),
    points: (Array.isArray(envelope.points) ? envelope.points : []).slice(-24).map(safePoint).filter(Boolean),
    message: cleanText(envelope.error && (envelope.error.message || envelope.error), 240) ||
      (status === 'degraded' ? '资金数据已过时，保留最近一次可验证观察。' : status === 'unavailable' ? '资金数据暂不可用。' : '')
  };
}

function safeCandidate(candidate) {
  const singularReason = cleanText(candidate.reason, 180);
  const singularRisk = cleanText(candidate.risk, 180);
  return {
    code: cleanText(candidate.code, 12),
    name: cleanText(candidate.name, 80) || cleanText(candidate.code, 12),
    score: finiteOrNull(candidate.score),
    strategy: cleanText(candidate.strategy, 80),
    sectorName: cleanText(candidate.sectorName || candidate.industry, 100),
    reasons: (Array.isArray(candidate.reasons) ? candidate.reasons : singularReason ? [singularReason] : []).map(value => cleanText(value, 180)).filter(Boolean).slice(0, 2),
    risks: (Array.isArray(candidate.risks) ? candidate.risks : singularRisk ? [singularRisk] : []).map(value => cleanText(value, 180)).filter(Boolean).slice(0, 2),
    originalAnalysis: cleanText(candidate.originalAnalysis, 500),
    dataCoverage: {
      quote: candidate.dataCoverage && candidate.dataCoverage.quote === true,
      technical: candidate.dataCoverage && candidate.dataCoverage.technical === true,
      profile: candidate.dataCoverage && candidate.dataCoverage.profile === true
    }
  };
}

function safeScreener(input) {
  const saved = input.screenerResult || null;
  const candidates = saved && saved.result && Array.isArray(saved.result.candidates)
    ? saved.result.candidates.slice(0, MOBILE_CANDIDATE_LIMIT).map(safeCandidate).filter(item => item.code) : [];
  return {
    status: saved && candidates.length ? 'available' : 'empty',
    source: 'saved-screener-result',
    resultId: saved ? Number(saved.id) : null,
    taskName: saved ? cleanText(saved.taskName, 120) : '',
    strategy: saved ? cleanText(saved.strategy, 80) : '',
    createdAt: saved ? cleanText(saved.createdAt, 50) : null,
    updatedAt: saved ? cleanText(saved.updatedAt, 50) : null,
    analysisExcerpt: saved ? cleanText(saved.aiResult, 1200) : '',
    candidates
  };
}

function safeLatestGptPicks(input) {
  const saved = input.latestGptPicks || null;
  const rawPicks = saved && (saved.picks || saved.candidates || saved.stocks);
  const picks = (Array.isArray(rawPicks) ? rawPicks : []).slice(0, MOBILE_CANDIDATE_LIMIT)
    .map(safeCandidate).filter(item => item.code);
  return {
    status: saved && picks.length ? 'available' : 'empty',
    source: 'ai_research_runs/manual-chatgpt-stock-picks',
    runId: saved ? Number(saved.id || saved.runId) || null : null,
    title: saved ? cleanText(saved.title, 160) : '',
    createdAt: saved ? cleanText(saved.importedAt || saved.createdAt, 50) : null,
    analysisExcerpt: saved ? cleanText(saved.analysis || saved.resultText || saved.aiResult, 1600) : '',
    picks
  };
}

function buildMobileSnapshot(input = {}) {
  const accounts = (Array.isArray(input.accounts) ? input.accounts : []).map(safeAccount);
  const channels = (Array.isArray(input.researchChannels) ? input.researchChannels : []).map(safeResearchChannel);
  const totals = channels.reduce(function(result, channel) {
    result.observationCount += channel.observationCount;
    result.videoCount += channel.videoCount;
    result.transcriptCount += channel.transcriptCount;
    result.archiveCount += channel.archiveCount;
    return result;
  }, { observationCount: 0, videoCount: 0, transcriptCount: 0, archiveCount: 0 });

  return {
    schema: SCHEMA,
    generatedAt: new Date(input.generatedAt || Date.now()).toISOString(),
    mode: 'read-only',
    source: {
      kind: 'windows-host',
      database: 'primary',
      marketDataMayBeDelayed: true
    },
    accounts,
    watchlist: safeWatchlist(input),
    news: safeNews(input),
    capitalMomentum: safeCapitalMomentum(input),
    screener: safeScreener(input),
    latestGptPicks: safeLatestGptPicks(input),
    research: { totals, channels },
    limitations: [
      '移动快照只用于查看，不支持下单或修改 Windows 数据。',
      '实时行情不可用时仅显示带日期的已保存快照；缺失数据保持为空。',
      '后台更新时间由 Android 系统调度，可能受省电模式影响而晚于 15 分钟。'
    ]
  };
}

async function loadNewsFeed(options, codes, generatedAt) {
  if (Object.prototype.hasOwnProperty.call(options, 'newsFeed')) return options.newsFeed;
  try {
    const newsService = options.newsService || require('./newsService');
    const discovery = options.newsDiscoveryService || require('./newsDiscoveryService');
    const result = await newsService.listNewsWithMetaAsync({ pages: 1, num: MOBILE_NEWS_LIMIT });
    return discovery.buildDiscoveryFeed({
      items: result.items,
      sourceMeta: result.meta,
      query: { codes: codes.slice(0, 30), sectors: [], keywords: [] },
      limit: MOBILE_NEWS_LIMIT,
      timeRange: '3d',
      sort: 'latest',
      now: generatedAt || new Date()
    });
  } catch (error) {
    return { items: [], error: { message: error.message || String(error) }, degraded: true };
  }
}

async function loadCapitalMomentum(options, target) {
  if (Object.prototype.hasOwnProperty.call(options, 'capitalMomentum')) return options.capitalMomentum;
  if (!target || !target.code) return null;
  try {
    let service = options.capitalFlowService;
    if (!service) {
      const { createCapitalFlowService } = require('./capitalFlow');
      const { createCapitalFlowAdapters } = require('./capitalFlow/adapters');
      service = createCapitalFlowService(createCapitalFlowAdapters());
    }
    const result = await service.getSeries({ scope: 'stock', code: target.code, source: 'vendor-classified' });
    return Object.assign({}, result, { target: { code: target.code, name: target.name } });
  } catch (error) {
    return {
      availability: 'unavailable', target: { code: target.code, name: target.name },
      error: { code: error.code || 'CAPITAL_FLOW_UNAVAILABLE', message: error.message || String(error) }
    };
  }
}

function listMobileResearchChannels(database) {
  return database.prepare(`
    SELECT channel.channel_key, channel.display_name, channel.platform,
      COUNT(observation.id) AS observation_count,
      SUM(CASE WHEN observation.media_type = 'video' OR observation.source_url LIKE '%/video/%' THEN 1 ELSE 0 END) AS video_count,
      SUM(CASE WHEN TRIM(COALESCE(observation.transcript_text, '')) <> '' THEN 1 ELSE 0 END) AS transcript_count,
      SUM(CASE WHEN observation.archive_status IN ('downloaded', 'local_reference') THEN 1 ELSE 0 END) AS archive_count,
      MAX(COALESCE(NULLIF(observation.updated_at, ''), NULLIF(observation.last_seen_at, ''), channel.updated_at)) AS last_updated_at
    FROM expert_channels AS channel
    LEFT JOIN expert_observations AS observation ON observation.channel_id = channel.id
    WHERE channel.enabled = 1
    GROUP BY channel.id
    ORDER BY datetime(channel.updated_at) DESC, channel.id DESC
  `).all().map(function(row) {
    return {
      channelKey: row.channel_key,
      displayName: row.display_name,
      platform: row.platform,
      observationCount: Number(row.observation_count || 0),
      videoCount: Number(row.video_count || 0),
      transcriptCount: Number(row.transcript_count || 0),
      archiveCount: Number(row.archive_count || 0),
      lastUpdatedAt: row.last_updated_at || null
    };
  });
}

async function loadMobileSnapshot(options = {}) {
  const database = options.database || require('../db');
  const portfolio = options.portfolio || require('./portfolioService');
  const quoteService = options.quoteService || require('./quoteService');
  const accounts = portfolio.listAccounts();
  const watchlist = portfolio.listWatchlist();
  const rawPositions = new Map(accounts.map(function(account) {
    return [account.id, portfolio.getPositions({}, { accountId: account.id })];
  }));
  const positionItems = Array.from(rawPositions.values()).flat();
  const codes = Array.from(new Set(positionItems.map(position => position.code).concat(watchlist.map(item => item.code))));
  let quoteMap = {};
  const generatedAtMs = new Date(options.generatedAt || Date.now()).getTime();
  const capitalTarget = positionItems[0] || watchlist[0] || null;
  const [quoteResult, newsFeed, capitalMomentum] = await Promise.all([
    quoteService.fetchSinaQuotes(codes, { timeoutMs: 8000 }).catch(function() { return null; }),
    loadNewsFeed(options, codes, new Date(options.generatedAt || Date.now())),
    loadCapitalMomentum(options, capitalTarget)
  ]);
  let quoteMeta = null;
  try {
    const result = quoteResult;
    if (!result) throw new Error('quote unavailable');
    quoteMeta = result;
    quoteMap = Object.fromEntries(Object.entries(result.quotes || {}).map(function(entry) {
      const quote = entry[1];
      const previousClose = finiteOrNull(quote.previousClose);
      return [entry[0], {
        ...quote,
        prevClose: previousClose,
        change: previousClose && quote.price
          ? Number(((Number(quote.price) - previousClose) / previousClose * 100).toFixed(2)) : null,
        quoteStatus: classifyChinaQuoteStatus(quote.tradeDate, generatedAtMs)
      }];
    }));
  } catch (error) {
    quoteMap = {};
  }

  const accountInputs = accounts.map(function(account) {
    const positions = portfolio.getPositions(quoteMap, { accountId: account.id });
    return {
      ...account,
      positions,
      summary: portfolio.getSummary(positions, { accountId: account.id }),
      latestSnapshot: portfolio.getLatestSnapshot(account.id)
    };
  });

  const watchlistInputs = watchlist.map(function(item) {
    const quote = quoteMap[item.code] || {};
    return Object.assign({}, item, {
      currentPrice: finiteOrNull(quote.price),
      previousClose: finiteOrNull(quote.previousClose || quote.prevClose),
      change: finiteOrNull(quote.change),
      quoteDate: quote.tradeDate || '',
      quoteTime: quote.tradeTime || '',
      quoteStatus: quote.quoteStatus || 'unavailable'
    });
  });

  let screenerResult = null;
  try {
    if (Object.prototype.hasOwnProperty.call(options, 'screenerResult')) {
      screenerResult = options.screenerResult;
    } else {
      const screener = options.screenerService || require('./screenerService');
      screenerResult = screener.listScreenerResults(1)[0] || null;
    }
  } catch (error) {
    screenerResult = null;
  }

  let latestGptPicks = options.latestGptPicks || null;
  if (!latestGptPicks && typeof options.loadLatestGptPicks === 'function') {
    try { latestGptPicks = await options.loadLatestGptPicks(); } catch (error) { latestGptPicks = null; }
  } else if (!latestGptPicks && !Object.prototype.hasOwnProperty.call(options, 'latestGptPicks')) {
    try {
      latestGptPicks = require('./gptPickImportService').getLatestManualPickImport();
    } catch (error) {
      latestGptPicks = null;
    }
  }

  return buildMobileSnapshot({
    generatedAt: options.generatedAt,
    accounts: accountInputs,
    watchlist: watchlistInputs,
    watchlistMeta: {
      source: quoteMeta && quoteMeta.source,
      observedAt: quoteMeta && quoteMeta.fetchedAt
    },
    newsFeed,
    capitalMomentum,
    screenerResult,
    latestGptPicks,
    researchChannels: listMobileResearchChannels(database)
  });
}

module.exports = { SCHEMA, MOBILE_NEWS_LIMIT, buildMobileSnapshot, listMobileResearchChannels, loadMobileSnapshot };
