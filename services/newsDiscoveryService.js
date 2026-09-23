const crypto = require('node:crypto');

const IMAGE_FIELDS = [
  'imageUrl', 'image_url', 'thumbnailUrl', 'thumbnail_url', 'thumbnail',
  'thumb', 'img', 'wap_thumb', 'coverUrl', 'cover_url'
];

const EVENT_TERMS = [
  'earnings', 'profit', 'guidance', 'contract', 'acquisition', 'merger',
  'restructuring', 'regulation', 'policy', 'buyback', 'dividend',
  'investigation', 'litigation', 'default', 'suspension', 'resumption',
  '业绩', '预增', '预亏', '利润', '中标', '合同', '并购', '重组',
  '监管', '政策', '回购', '分红', '立案', '诉讼', '违约', '停牌', '复牌'
];

const CRITICAL_EVENT_TERMS = [
  '重大违法', '强制退市', '财务造假', '虚假记载', '信披违法',
  '立案调查', '行政处罚', '拟被罚', '风险警示', '终止上市'
];

function text(value) {
  return String(value == null ? '' : value).trim();
}

function normalized(value) {
  return text(value).toLowerCase();
}

function uniqueList(values) {
  const seen = new Set();
  const items = [];
  (Array.isArray(values) ? values : []).forEach(function(value) {
    const clean = text(value);
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) return;
    seen.add(key);
    items.push(clean);
  });
  return items;
}

function validHttpUrl(value) {
  const candidate = text(value);
  if (!candidate || candidate.length > 2048) return null;
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch (error) {
    return null;
  }
}

function extractUpstreamImage(item) {
  const provider = text(item && item.imageProvider) || text(item && item.provider) || text(item && item.source) || null;
  const declaredField = text(item && item.imageSourceField);
  if (IMAGE_FIELDS.includes(declaredField)) {
    const declaredUrl = validHttpUrl(item && item.imageUrl);
    if (declaredUrl) {
      return { url: declaredUrl, sourceField: declaredField, provider, upstreamProvided: true };
    }
  }
  for (const sourceField of IMAGE_FIELDS) {
    if (!item || !Object.prototype.hasOwnProperty.call(item, sourceField)) continue;
    const url = validHttpUrl(item[sourceField]);
    if (url) return { url, sourceField, provider, upstreamProvided: true };
  }
  return null;
}

function associationProvenance(item, field, value) {
  const metadata = item && item.associationProvenance && item.associationProvenance[field];
  if (typeof metadata === 'string') return metadata;
  if (Array.isArray(metadata)) {
    const match = metadata.find(function(entry) {
      return entry && normalized(entry.value) === normalized(value);
    });
    if (match) return text(match.provenance || match.source || match.kind);
  }
  if (metadata && typeof metadata === 'object') {
    return text(metadata[value] || metadata[normalized(value)]);
  }
  return item && item.evidenceKind === 'local-fallback' ? 'local-fallback' : 'upstream-field';
}

function isExplicitAssociationProvenance(value) {
  const provenance = normalized(value);
  return provenance.startsWith('upstream') || provenance === 'provider-field';
}

function explicitAssociations(item, field) {
  return uniqueList(item && item[field]).filter(function(value) {
    return isExplicitAssociationProvenance(associationProvenance(item, field, value));
  });
}

function timestampDetails(item, now) {
  const parsed = Date.parse(item && item.time);
  const provenance = text(item && item.timeProvenance) || 'upstream-field';
  if (!Number.isFinite(parsed) || /generated|fallback|synthetic/i.test(provenance)) {
    return { valid: false, provenance, ageHours: null };
  }
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now || Date.now());
  const rawAgeHours = Number.isFinite(nowMs) ? (nowMs - parsed) / 3600000 : null;
  if (!Number.isFinite(rawAgeHours) || rawAgeHours < -0.02) {
    return { valid: false, provenance, ageHours: null };
  }
  const ageHours = Math.max(0, rawAgeHours);
  return {
    valid: Number.isFinite(ageHours),
    provenance,
    ageHours: Number.isFinite(ageHours) ? Number(ageHours.toFixed(2)) : null
  };
}

function sourceTraceability(item) {
  const providerItem = text(item && item.evidenceKind) !== 'local-fallback';
  const source = text(item && item.source);
  const provider = text(item && item.provider);
  const originalUrl = validHttpUrl(item && item.link);
  const traceable = Boolean(providerItem && source && provider && originalUrl);
  return {
    traceable,
    points: traceable ? 8 : 0,
    source: source || null,
    provider: provider || null,
    originalUrl: originalUrl || null
  };
}

function upstreamPriorityEvidence(item) {
  const marker = item && item.sourcePriority;
  if (!marker || typeof marker !== 'object') return null;
  const provenance = normalized(marker.provenance);
  if (!provenance.startsWith('upstream') && provenance !== 'provider-field') return null;
  const rawValue = marker.value;
  const value = normalized(rawValue);
  const accepted = rawValue === true || ['important', 'high', 'breaking', 'top', '重点', '重要'].includes(value);
  if (!accepted) return null;
  return {
    value: rawValue === true ? 'true' : text(rawValue),
    field: text(marker.field) || 'sourcePriority',
    provenance: text(marker.provenance),
    points: 30
  };
}

function importanceLevel(score) {
  if (score >= 60) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

function scoreImportance(item, now) {
  const stocks = explicitAssociations(item, 'relatedStocks');
  const sectors = explicitAssociations(item, 'relatedSectors');
  const timestamp = timestampDetails(item, now);
  const searchable = normalized([item && item.title, item && item.summary].filter(Boolean).join(' '));
  const eventTerms = EVENT_TERMS.filter(function(term) {
    return searchable.includes(normalized(term));
  });
  const criticalEventTerms = CRITICAL_EVENT_TERMS.filter(function(term) {
    return searchable.includes(normalized(term));
  });
  const source = sourceTraceability(item);
  const upstreamPriority = upstreamPriorityEvidence(item);
  let score = 0;
  const reasons = [];
  if (timestamp.valid) {
    const recencyPoints = timestamp.ageHours <= 6 ? 25
      : timestamp.ageHours <= 24 ? 18
        : timestamp.ageHours <= 72 ? 10
          : timestamp.ageHours <= 168 ? 5 : 0;
    score += recencyPoints;
    if (recencyPoints) reasons.push('有效发布时间按时效性 +' + recencyPoints + ' 分。');
  }
  if (source.points) {
    score += source.points;
    reasons.push('来源、采集方与原文链接均可追溯 +' + source.points + ' 分。');
  }
  if (stocks.length) {
    const stockPoints = Math.min(stocks.length * 18, 36);
    score += stockPoints;
    reasons.push('上游明确关联股票 +' + stockPoints + ' 分。');
  }
  if (sectors.length) {
    const sectorPoints = Math.min(sectors.length * 10, 20);
    score += sectorPoints;
    reasons.push('上游明确关联板块 +' + sectorPoints + ' 分。');
  }
  if (eventTerms.length) {
    const eventPoints = Math.min(eventTerms.length * 12, 24);
    score += eventPoints;
    reasons.push('明确事件词 +' + eventPoints + ' 分：' + eventTerms.join('、') + '。');
  }
  if (criticalEventTerms.length) {
    score += 30;
    reasons.push('重大风险事件词 +30 分：' + criticalEventTerms.join('、') + '。');
  }
  if (upstreamPriority) {
    score += upstreamPriority.points;
    reasons.push('源站字段 ' + upstreamPriority.field + ' 明确标记重点 +' + upstreamPriority.points + ' 分。');
  }
  score = Math.min(score, 100);
  if (!reasons.length) reasons.push('暂无可验证的本地重点信号。');
  return {
    score,
    level: importanceLevel(score),
    method: 'local-research-priority-v1',
    scope: 'local-research-priority',
    reasons,
    inputs: {
      publishedTimeValid: timestamp.valid,
      publishedTimeProvenance: timestamp.provenance,
      ageHours: timestamp.ageHours,
      sourceTraceable: source.traceable,
      sourceTraceabilityPoints: source.points,
      source: source.source,
      provider: source.provider,
      upstreamPriorityAccepted: Boolean(upstreamPriority),
      upstreamPriorityField: upstreamPriority ? upstreamPriority.field : null,
      upstreamPriorityValue: upstreamPriority ? upstreamPriority.value : null,
      explicitStockAssociationCount: stocks.length,
      explicitSectorAssociationCount: sectors.length,
      eventTerms,
      criticalEventTerms
    }
  };
}

function relevanceLevel(score) {
  if (score == null) return 'unscored';
  if (score >= 70) return 'high';
  if (score >= 35) return 'medium';
  if (score > 0) return 'low';
  return 'none';
}

function pushMatch(matches, kind, value, points, field) {
  const key = [kind, normalized(value), field].join('|');
  if (matches.some(function(match) { return match.key === key; })) return;
  matches.push({ key, kind, value, points, field });
}

function scoreRelevance(item, query) {
  const requestedCodes = uniqueList(query.codes);
  const requestedSectors = uniqueList(query.sectors);
  const requestedKeywords = uniqueList(query.keywords);
  const targetSupplied = Boolean(requestedCodes.length || requestedSectors.length || requestedKeywords.length);
  const inputs = { requestedCodes, requestedSectors, requestedKeywords, matches: [] };
  if (!targetSupplied) {
    return {
      score: null,
      level: 'unscored',
      method: 'explicit-association-text-match-v1',
      reasons: ['No stock, sector, or keyword target was supplied.'],
      inputs
    };
  }
  const explicitStocks = explicitAssociations(item, 'relatedStocks').map(normalized);
  const explicitSectors = explicitAssociations(item, 'relatedSectors').map(normalized);
  const title = normalized(item && item.title);
  const summary = normalized(item && item.summary);
  const matches = [];
  requestedCodes.forEach(function(code) {
    if (explicitStocks.includes(normalized(code))) pushMatch(matches, 'stock', code, 50, 'relatedStocks');
    else if (title.includes(normalized(code))) pushMatch(matches, 'stock-title', code, 30, 'title');
    else if (summary.includes(normalized(code))) pushMatch(matches, 'stock-summary', code, 20, 'summary');
  });
  requestedSectors.forEach(function(sector) {
    if (explicitSectors.includes(normalized(sector))) pushMatch(matches, 'sector', sector, 35, 'relatedSectors');
    else if (title.includes(normalized(sector))) pushMatch(matches, 'sector-title', sector, 25, 'title');
    else if (summary.includes(normalized(sector))) pushMatch(matches, 'sector-summary', sector, 15, 'summary');
  });
  requestedKeywords.forEach(function(keyword) {
    if (title.includes(normalized(keyword))) pushMatch(matches, 'keyword-title', keyword, 25, 'title');
    else if (summary.includes(normalized(keyword))) pushMatch(matches, 'keyword-summary', keyword, 15, 'summary');
  });
  const cleanMatches = matches.map(function(match) {
    const result = Object.assign({}, match);
    delete result.key;
    return result;
  });
  const score = Math.min(cleanMatches.reduce(function(sum, match) { return sum + match.points; }, 0), 100);
  inputs.matches = cleanMatches;
  return {
    score,
    level: relevanceLevel(score),
    method: 'explicit-association-text-match-v1',
    reasons: cleanMatches.length
      ? cleanMatches.map(function(match) { return match.field + ' matched ' + match.value + '.'; })
      : ['No requested target matched an explicit association, title, or summary.'],
    inputs
  };
}

function stableId(item) {
  if (item && item.id != null && text(item.id)) return text(item.id);
  const value = [item && item.source, item && item.time, item && item.title, item && item.link].map(text).join('|');
  return 'news-' + crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function countBy(items, getter) {
  const counts = new Map();
  items.forEach(function(item) {
    const key = text(getter(item)) || 'unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return Array.from(counts.entries()).map(function(entry) {
    return { key: entry[0], count: entry[1] };
  }).sort(function(a, b) { return b.count - a.count || a.key.localeCompare(b.key); });
}

function rate(count, total) {
  return total ? Number((count / total * 100).toFixed(2)) : 0;
}

function buildCoverage(items, sourceItemCount, filteredItemCount, limit) {
  const itemCount = items.length;
  const upstreamImageCount = items.filter(function(item) { return Boolean(item.image); }).length;
  const validTimestampCount = items.filter(function(item) { return item.importance.inputs.publishedTimeValid; }).length;
  const explicitAssociationItemCount = items.filter(function(item) {
    return item.importance.inputs.explicitStockAssociationCount > 0 || item.importance.inputs.explicitSectorAssociationCount > 0;
  }).length;
  const explicitAssociationCount = items.reduce(function(sum, item) {
    return sum + item.importance.inputs.explicitStockAssociationCount + item.importance.inputs.explicitSectorAssociationCount;
  }, 0);
  const relevanceEvaluatedCount = items.filter(function(item) { return item.relevance.score != null; }).length;
  const relevanceMatchedCount = items.filter(function(item) { return Number(item.relevance.score) > 0; }).length;
  return {
    sourceItemCount,
    filteredItemCount,
    filteredOutCount: Math.max(sourceItemCount - filteredItemCount, 0),
    itemCount,
    limit,
    truncated: filteredItemCount > itemCount,
    upstreamImageCount,
    upstreamImageRate: rate(upstreamImageCount, itemCount),
    validTimestampCount,
    validTimestampRate: rate(validTimestampCount, itemCount),
    explicitAssociationCount,
    explicitAssociationItemCount,
    explicitAssociationRate: rate(explicitAssociationItemCount, itemCount),
    relevanceEvaluatedCount,
    relevanceMatchedCount,
    relevanceMatchedRate: rate(relevanceMatchedCount, relevanceEvaluatedCount)
  };
}

function buildVisualization(items, coverage) {
  return {
    sourceCounts: countBy(items, function(item) { return item.source; }),
    importanceLevels: countBy(items, function(item) { return item.importance.level; }),
    relevanceLevels: countBy(items, function(item) { return item.relevance.level; }),
    coverageBars: [
      { key: 'upstream-images', label: 'Upstream images', count: coverage.upstreamImageCount, total: coverage.itemCount, rate: coverage.upstreamImageRate },
      { key: 'valid-times', label: 'Valid published times', count: coverage.validTimestampCount, total: coverage.itemCount, rate: coverage.validTimestampRate },
      { key: 'explicit-associations', label: 'Explicit associations', count: coverage.explicitAssociationItemCount, total: coverage.itemCount, rate: coverage.explicitAssociationRate },
      { key: 'relevance-matches', label: 'Target relevance matches', count: coverage.relevanceMatchedCount, total: coverage.relevanceEvaluatedCount, rate: coverage.relevanceMatchedRate }
    ]
  };
}

function canonicalItem(item, query, now, index) {
  const image = extractUpstreamImage(item || {});
  const imageProvenance = image ? {
    provider: image.provider,
    sourceField: image.sourceField,
    upstreamProvided: true
  } : null;
  return {
    id: stableId(item || {}),
    title: text(item && item.title),
    source: text(item && item.source) || 'WebStock',
    provider: text(item && item.provider) || text(item && item.source) || 'WebStock',
    time: item && item.time ? item.time : null,
    timeProvenance: text(item && item.timeProvenance) || 'upstream-field',
    summary: text(item && item.summary),
    link: text(item && item.link) || '#',
    type: text(item && item.type) || 'market',
    relatedStocks: uniqueList(item && item.relatedStocks),
    relatedSectors: uniqueList(item && item.relatedSectors),
    associationProvenance: item && item.associationProvenance ? item.associationProvenance : null,
    evidenceKind: text(item && item.evidenceKind) || 'provider-item',
    image,
    imageUrl: image ? image.url : null,
    imageSourceField: image ? image.sourceField : null,
    imageProvenance,
    importance: scoreImportance(item || {}, now),
    relevance: scoreRelevance(item || {}, query),
    _index: index
  };
}

function timeRangeHours(value) {
  const ranges = { '1h': 1, today: 24, '3d': 72, '7d': 168 };
  return Object.prototype.hasOwnProperty.call(ranges, value) ? ranges[value] : null;
}

function buildDiscoveryFeed(input = {}) {
  const query = {
    codes: uniqueList(input.query && input.query.codes),
    sectors: uniqueList(input.query && input.query.sectors),
    keywords: uniqueList(input.query && input.query.keywords)
  };
  const sourceItems = Array.isArray(input.items) ? input.items : [];
  const limit = Math.min(Math.max(Number(input.limit) || sourceItems.length || 1, 1), 200);
  const sort = input.sort === 'relevance' ? 'relevance' : 'latest';
  const rangeHours = timeRangeHours(input.timeRange);
  const withImage = input.withImage === true;
  const filteredItems = sourceItems.map(function(item, index) {
    return canonicalItem(item, query, input.now || new Date(), index);
  }).filter(function(item) {
    if (withImage && !item.image) return false;
    if (rangeHours == null) return true;
    if (!item.importance.inputs.publishedTimeValid) return true;
    return item.importance.inputs.ageHours <= rangeHours;
  }).sort(function(a, b) {
    const relevanceA = a.relevance.score == null ? -1 : a.relevance.score;
    const relevanceB = b.relevance.score == null ? -1 : b.relevance.score;
    if (sort === 'relevance') {
      return relevanceB - relevanceA || b.importance.score - a.importance.score || a._index - b._index;
    }
    const timeA = a.importance.inputs.publishedTimeValid ? Date.parse(a.time) : -1;
    const timeB = b.importance.inputs.publishedTimeValid ? Date.parse(b.time) : -1;
    return timeB - timeA || relevanceB - relevanceA || b.importance.score - a.importance.score || a._index - b._index;
  });
  const items = filteredItems.slice(0, limit).map(function(item) {
    const output = Object.assign({}, item);
    delete output._index;
    return output;
  });
  const coverage = buildCoverage(items, sourceItems.length, filteredItems.length, limit);
  const generatedAt = input.now instanceof Date ? input.now : new Date(input.now || Date.now());
  return {
    schema: 'webstock.news-discovery/v1',
    generatedAt: generatedAt.toISOString(),
    query,
    filters: {
      timeRange: input.timeRange || 'all',
      withImage,
      sort,
      unknownPublishedTimeIncluded: rangeHours != null
    },
    items,
    coverage,
    visualization: buildVisualization(items, coverage),
    sourceMeta: input.sourceMeta || null,
    degraded: Boolean(input.sourceMeta && input.sourceMeta.degraded),
    methodology: {
      image: { method: 'explicit-upstream-field-v1', acceptedFields: IMAGE_FIELDS.slice(), inferredImages: false },
      importance: {
        method: 'local-research-priority-v1',
        inputs: ['trusted published time', 'traceable provider source', 'explicit associations', 'event terms', 'major-risk event terms', 'explicit upstream priority marker'],
        doesNotMeasure: ['all-web popularity', 'social-media reach', 'audience size', 'undocumented provider level fields']
      },
      relevance: {
        method: 'explicit-association-text-match-v1',
        inputs: ['requested stocks', 'requested sectors', 'requested keywords'],
        semanticVerification: false
      }
    },
    limitations: [
      'Importance is a local research-priority score, not a measure of all-web popularity.',
      'Undocumented upstream fields such as level are not treated as official priority markers.',
      'An upstream image is used only from a supported explicit field with a valid HTTP(S) URL; images are never guessed from article links or titles.',
      'Relevance uses explicit upstream associations and literal title or summary matches; it does not verify the underlying claim.',
      'Items without a verified upstream published time remain visible under time filters and are counted as missing time coverage.',
      'Coverage is limited to the providers reported in sourceMeta and must not be read as whole-market or whole-web coverage.'
    ]
  };
}

module.exports = {
  IMAGE_FIELDS,
  buildDiscoveryFeed,
  extractUpstreamImage,
  scoreImportance,
  scoreRelevance
};
