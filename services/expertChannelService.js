const crypto = require('node:crypto');
const db = require('../db');
const knowledge = require('./knowledgeService');

const EVIDENCE_LEVELS = new Set(['primary', 'archive', 'secondary_quote', 'commentary']);
const AVAILABILITY_STATUSES = new Set(['available', 'unavailable', 'deleted_trace', 'unknown']);
const CONTENT_ROLES = new Set(['direct_quote', 'transcript', 'secondary_quote', 'fact_summary', 'model_inference']);
const STANCES = new Set(['bullish', 'bearish', 'neutral', 'conditional', 'unknown']);
const TIME_PRECISIONS = new Set(['date', 'minute', 'second', 'unknown']);
const SUBJECT_TYPES = new Set(['creator', 'person', 'book', 'method']);
const MEDIA_TYPES = new Set(['text', 'video', 'audio', 'image', 'chart', 'book', 'pdf', 'article', 'note']);
const ARCHIVE_STATUSES = new Set(['linked', 'local_reference', 'downloaded', 'blocked', 'failed', 'not_applicable']);
const RIGHTS_BASES = new Set(['quotation_only', 'user_owned', 'authorized', 'platform_download', 'public_domain', 'unknown']);

const EVIDENCE_LABELS = {
  primary: '原始来源 / 本人公开',
  archive: '公开存档',
  secondary_quote: '第三方转述',
  commentary: '第三方评论'
};

function cleanText(value, maxLength = 1000) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function normalizeArray(value, options = {}) {
  const source = Array.isArray(value) ? value : String(value == null ? '' : value).split(/[,，;；\n]/);
  let items = source.map(item => cleanText(item, options.maxLength || 100)).filter(Boolean);
  if (options.stockCodes) {
    items = items.map(item => item.replace(/\D/g, '')).filter(item => /^\d{6}$/.test(item));
  }
  return items.filter((item, index) => items.indexOf(item) === index).slice(0, options.limit || 100);
}

function normalizeCurveData(value) {
  let source = value;
  if (typeof source === 'string') {
    const raw = source.trim();
    if (!raw) return [];
    if (raw.startsWith('[')) {
      try { source = JSON.parse(raw); } catch (error) { source = raw.split(/\r?\n/); }
    } else {
      source = raw.split(/\r?\n/);
    }
  }
  if (!Array.isArray(source)) return [];
  return source.slice(0, 2000).map((item, index) => {
    if (typeof item === 'string') {
      const parts = item.split(/[,，\t]/);
      return { x: cleanText(parts[0], 80) || String(index + 1), y: Number(parts[1]) };
    }
    if (Array.isArray(item)) return { x: cleanText(item[0], 80) || String(index + 1), y: Number(item[1]) };
    if (item && typeof item === 'object') {
      return { x: cleanText(item.x == null ? item.label : item.x, 80) || String(index + 1), y: Number(item.y) };
    }
    return null;
  }).filter(item => item && Number.isFinite(item.y));
}

function normalizeUrl(value) {
  const raw = cleanText(value, 1200);
  if (!raw) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (error) {
    throw new Error('公开来源链接必须是有效的 http/https 地址');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('公开来源链接只支持 http/https');
  return parsed.toString();
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || '');
    return parsed == null ? fallback : parsed;
  } catch (error) {
    return fallback;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function safeIso(value, fallback = '') {
  const raw = cleanText(value, 50);
  if (!raw) return fallback;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new Error('时间格式无效');
  return parsed.toISOString();
}

function inferTimePrecision(value, explicit) {
  const requested = cleanText(explicit, 20);
  if (TIME_PRECISIONS.has(requested)) return requested;
  const raw = cleanText(value, 80);
  if (!raw) return 'unknown';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return 'date';
  if (/T\d{2}:\d{2}:\d{2}/.test(raw)) return 'second';
  if (/T\d{2}:\d{2}/.test(raw)) return 'minute';
  return 'unknown';
}

function rowToChannel(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    channelKey: row.channel_key,
    displayName: row.display_name,
    subjectType: row.subject_type || 'creator',
    platform: row.platform,
    profileUrl: row.profile_url || '',
    description: row.description || '',
    aliases: parseJson(row.aliases_json, []),
    discoveryQueries: parseJson(row.discovery_queries_json, []),
    enabled: Boolean(row.enabled),
    observationCount: Number(row.observation_count || 0),
    primaryCount: Number(row.primary_count || 0),
    directDouyinCount: Number(row.direct_douyin_count || 0),
    deletedTraceCount: Number(row.deleted_trace_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToObservation(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    channelId: Number(row.channel_id),
    externalKey: row.external_key,
    externalContentId: row.external_content_id || '',
    sourceUrl: row.source_url || '',
    title: row.title,
    author: row.author || '',
    publishedAt: row.published_at || '',
    publishedTimePrecision: row.published_time_precision || 'unknown',
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    evidenceLevel: row.evidence_level,
    evidenceLabel: EVIDENCE_LABELS[row.evidence_level] || row.evidence_level,
    availabilityStatus: row.availability_status,
    contentRole: row.content_role,
    content: row.content_text || '',
    summary: row.summary_text || '',
    contentHash: row.content_hash,
    stockCodes: parseJson(row.stock_codes_json, []),
    sectors: parseJson(row.sectors_json, []),
    topics: parseJson(row.topics_json, []),
    mediaType: row.media_type || 'text',
    archiveStatus: row.archive_status || 'linked',
    rightsBasis: row.rights_basis || 'quotation_only',
    localAssetPath: row.local_asset_path || '',
    curveData: parseJson(row.curve_data_json, []),
    analysisNotes: row.analysis_notes || '',
    stance: row.stance || 'unknown',
    horizon: row.horizon || 'unspecified',
    confidence: Number(row.confidence),
    knowledgeSourceId: row.knowledge_source_id == null ? null : Number(row.knowledge_source_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const channelCountsSql = `
  SELECT channel.*,
    COUNT(observation.id) AS observation_count,
    SUM(CASE WHEN observation.evidence_level = 'primary' THEN 1 ELSE 0 END) AS primary_count,
    SUM(CASE WHEN LOWER(observation.source_url) LIKE 'https://%.douyin.com/%'
      OR LOWER(observation.source_url) LIKE 'https://douyin.com/%' THEN 1 ELSE 0 END) AS direct_douyin_count,
    SUM(CASE WHEN observation.availability_status = 'deleted_trace' THEN 1 ELSE 0 END) AS deleted_trace_count
  FROM expert_channels AS channel
  LEFT JOIN expert_observations AS observation ON observation.channel_id = channel.id
`;

function getChannel(id) {
  const row = db.prepare(channelCountsSql + ' WHERE channel.id = ? GROUP BY channel.id').get(Number(id));
  if (!row) throw new Error('研究对象不存在');
  return rowToChannel(row);
}

function listChannels(options = {}) {
  const params = { limit: Math.min(Math.max(Number(options.limit) || 100, 1), 500) };
  const query = cleanText(options.query, 200);
  const where = query ? ` WHERE (
    channel.display_name LIKE @query OR channel.platform LIKE @query OR channel.subject_type LIKE @query OR
    channel.description LIKE @query OR channel.aliases_json LIKE @query OR channel.discovery_queries_json LIKE @query
  )` : '';
  if (query) params.query = '%' + query + '%';
  return db.prepare(channelCountsSql + where + ` GROUP BY channel.id
    ORDER BY datetime(channel.updated_at) DESC, channel.id DESC LIMIT @limit`).all(params).map(rowToChannel);
}

function createChannel(input = {}) {
  const displayName = cleanText(input.displayName, 160);
  const platform = cleanText(input.platform, 60).toLowerCase();
  const subjectType = cleanText(input.subjectType, 30).toLowerCase() || 'creator';
  if (!displayName) throw new Error('研究对象名称不能为空');
  if (!platform) throw new Error('来源或平台不能为空');
  if (!SUBJECT_TYPES.has(subjectType)) throw new Error('不支持的研究对象类型');
  const channelKey = cleanText(input.channelKey, 120) || sha256(subjectType + '\n' + platform + '\n' + displayName).slice(0, 24);
  const profileUrl = normalizeUrl(input.profileUrl);
  const description = cleanText(input.description, 10000);
  const aliases = normalizeArray(input.aliases, { maxLength: 160 });
  const discoveryQueries = normalizeArray(input.discoveryQueries, { maxLength: 300, limit: 30 });
  const enabled = input.enabled === false ? 0 : 1;
  db.prepare(`
    INSERT INTO expert_channels (
      channel_key, display_name, subject_type, platform, profile_url, description,
      aliases_json, discovery_queries_json, enabled
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(channel_key) DO UPDATE SET
      display_name = excluded.display_name,
      subject_type = excluded.subject_type,
      platform = excluded.platform,
      profile_url = excluded.profile_url,
      description = excluded.description,
      aliases_json = excluded.aliases_json,
      discovery_queries_json = excluded.discovery_queries_json,
      enabled = excluded.enabled,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    channelKey, displayName, subjectType, platform, profileUrl, description,
    JSON.stringify(aliases), JSON.stringify(discoveryQueries), enabled
  );
  const row = db.prepare('SELECT id FROM expert_channels WHERE channel_key = ?').get(channelKey);
  return getChannel(row.id);
}

function observationRow(channelId, externalKey) {
  return db.prepare('SELECT * FROM expert_observations WHERE channel_id = ? AND external_key = ?')
    .get(Number(channelId), externalKey);
}

function buildExternalKey(channel, input) {
  const supplied = cleanText(input.externalKey, 200);
  if (supplied) return supplied;
  const sourceUrl = normalizeUrl(input.sourceUrl);
  const externalId = cleanText(input.externalContentId, 160);
  const basis = externalId || sourceUrl || [input.title, input.publishedAt, input.summary, input.content].join('\n');
  if (!cleanText(basis, 5000)) throw new Error('观察记录需要公开内容 ID、来源链接或可识别文本');
  return channel.platform + ':' + sha256(basis).slice(0, 32);
}

function syncKnowledgeSource(channel, observation, existing) {
  const sourceText = [observation.content.length >= 10 ? observation.content : observation.summary,
    observation.analysisNotes ? '图形 / 方法分析记录：\n' + observation.analysisNotes : '']
    .filter(Boolean).join('\n\n');
  if (sourceText.length < 10) return existing && existing.knowledge_source_id || null;
  const prefix = '[' + (EVIDENCE_LABELS[observation.evidenceLevel] || observation.evidenceLevel) + '] ';
  const sourceInput = {
    sourceKey: 'expert-' + sha256(channel.channelKey + '\n' + observation.externalKey).slice(0, 40),
    sourceType: observation.contentRole === 'transcript' ? 'transcript'
      : ['book', 'article', 'video', 'note'].includes(observation.mediaType) ? observation.mediaType : 'note',
    title: prefix + observation.title,
    author: channel.displayName,
    sourceUrl: observation.sourceUrl,
    publishedAt: observation.publishedAt,
    tags: ['研究资料', 'subject:' + channel.subjectType, 'media:' + observation.mediaType,
      'evidence:' + observation.evidenceLevel, 'status:' + observation.availabilityStatus,
      'archive:' + observation.archiveStatus, 'role:' + observation.contentRole, channel.platform].concat(observation.topics),
    stockCodes: observation.stockCodes,
    sectors: observation.sectors,
    content: sourceText
  };
  if (existing && existing.knowledge_source_id) {
    return knowledge.updateSource(Number(existing.knowledge_source_id), sourceInput).id;
  }
  return knowledge.createSource(sourceInput).id;
}

function recordObservation(channelId, input = {}) {
  const channel = getChannel(channelId);
  const externalKey = buildExternalKey(channel, input);
  const existingRow = observationRow(channel.id, externalKey);
  const existing = existingRow ? rowToObservation(existingRow) : null;
  const now = new Date().toISOString();
  const evidenceLevel = cleanText(input.evidenceLevel == null && existing ? existing.evidenceLevel : input.evidenceLevel, 40) || 'primary';
  const availabilityStatus = cleanText(input.availabilityStatus == null && existing ? existing.availabilityStatus : input.availabilityStatus, 40) || 'available';
  const contentRole = cleanText(input.contentRole == null && existing ? existing.contentRole : input.contentRole, 40)
    || (evidenceLevel === 'primary' ? 'direct_quote' : 'secondary_quote');
  const stance = cleanText(input.stance == null && existing ? existing.stance : input.stance, 40) || 'unknown';
  const mediaType = cleanText(input.mediaType == null && existing ? existing.mediaType : input.mediaType, 40) || 'text';
  const archiveStatus = cleanText(input.archiveStatus == null && existing ? existing.archiveStatus : input.archiveStatus, 40) || 'linked';
  const rightsBasis = cleanText(input.rightsBasis == null && existing ? existing.rightsBasis : input.rightsBasis, 40) || 'quotation_only';
  if (!EVIDENCE_LEVELS.has(evidenceLevel)) throw new Error('不支持的证据等级');
  if (!AVAILABILITY_STATUSES.has(availabilityStatus)) throw new Error('不支持的可用状态');
  if (!CONTENT_ROLES.has(contentRole)) throw new Error('不支持的文本角色');
  if (!STANCES.has(stance)) throw new Error('不支持的观点方向');
  if (!MEDIA_TYPES.has(mediaType)) throw new Error('不支持的资料类型');
  if (!ARCHIVE_STATUSES.has(archiveStatus)) throw new Error('不支持的归档状态');
  if (!RIGHTS_BASES.has(rightsBasis)) throw new Error('不支持的使用依据');

  const title = cleanText(input.title == null && existing ? existing.title : input.title, 300);
  if (!title) throw new Error('观察记录标题不能为空');
  const sourceUrl = input.sourceUrl == null && existing ? existing.sourceUrl : normalizeUrl(input.sourceUrl);
  const content = cleanText(input.content == null && existing ? existing.content : input.content, 800000);
  const summary = cleanText(input.summary == null && existing ? existing.summary : input.summary, 10000);
  const rawPublishedAt = input.publishedAt == null && existing ? existing.publishedAt : input.publishedAt;
  const publishedAt = safeIso(rawPublishedAt, '');
  const publishedTimePrecision = input.publishedAt == null && existing
    ? existing.publishedTimePrecision
    : inferTimePrecision(rawPublishedAt, input.publishedTimePrecision);
  const firstSeenAt = safeIso(input.firstSeenAt, existing ? existing.firstSeenAt : now);
  const lastSeenAt = safeIso(input.lastSeenAt, now);
  const stockCodes = normalizeArray(input.stockCodes == null && existing ? existing.stockCodes : input.stockCodes, { stockCodes: true });
  const sectors = normalizeArray(input.sectors == null && existing ? existing.sectors : input.sectors);
  const topics = normalizeArray(input.topics == null && existing ? existing.topics : input.topics);
  const curveData = normalizeCurveData(input.curveData == null && existing ? existing.curveData : input.curveData);
  const confidence = Math.min(Math.max(Number(input.confidence == null && existing ? existing.confidence : input.confidence) || 0.5, 0), 1);
  const observation = {
    externalKey,
    externalContentId: cleanText(input.externalContentId == null && existing ? existing.externalContentId : input.externalContentId, 160),
    sourceUrl,
    title,
    author: cleanText(input.author == null && existing ? existing.author : input.author, 160) || channel.displayName,
    publishedAt,
    publishedTimePrecision,
    firstSeenAt,
    lastSeenAt,
    evidenceLevel,
    availabilityStatus,
    contentRole,
    content,
    summary,
    contentHash: sha256([content, summary, JSON.stringify(curveData),
      cleanText(input.analysisNotes == null && existing ? existing.analysisNotes : input.analysisNotes, 20000),
      title, sourceUrl].join('\n')),
    stockCodes,
    sectors,
    topics,
    mediaType,
    archiveStatus,
    rightsBasis,
    localAssetPath: cleanText(input.localAssetPath == null && existing ? existing.localAssetPath : input.localAssetPath, 2000),
    curveData,
    analysisNotes: cleanText(input.analysisNotes == null && existing ? existing.analysisNotes : input.analysisNotes, 20000),
    stance,
    horizon: cleanText(input.horizon == null && existing ? existing.horizon : input.horizon, 80) || 'unspecified',
    confidence
  };
  const knowledgeSourceId = syncKnowledgeSource(channel, observation, existingRow);

  db.prepare(`
    INSERT INTO expert_observations (
      channel_id, external_key, external_content_id, source_url, title, author, published_at, published_time_precision,
      first_seen_at, last_seen_at, evidence_level, availability_status, content_role,
      content_text, summary_text, content_hash, stock_codes_json, sectors_json, topics_json,
      media_type, archive_status, rights_basis, local_asset_path, curve_data_json, analysis_notes,
      stance, horizon, confidence, knowledge_source_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(channel_id, external_key) DO UPDATE SET
      external_content_id = excluded.external_content_id,
      source_url = excluded.source_url,
      title = excluded.title,
      author = excluded.author,
      published_at = excluded.published_at,
      published_time_precision = excluded.published_time_precision,
      last_seen_at = excluded.last_seen_at,
      evidence_level = excluded.evidence_level,
      availability_status = excluded.availability_status,
      content_role = excluded.content_role,
      content_text = excluded.content_text,
      summary_text = excluded.summary_text,
      content_hash = excluded.content_hash,
      stock_codes_json = excluded.stock_codes_json,
      sectors_json = excluded.sectors_json,
      topics_json = excluded.topics_json,
      media_type = excluded.media_type,
      archive_status = excluded.archive_status,
      rights_basis = excluded.rights_basis,
      local_asset_path = excluded.local_asset_path,
      curve_data_json = excluded.curve_data_json,
      analysis_notes = excluded.analysis_notes,
      stance = excluded.stance,
      horizon = excluded.horizon,
      confidence = excluded.confidence,
      knowledge_source_id = excluded.knowledge_source_id,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    channel.id, observation.externalKey, observation.externalContentId, observation.sourceUrl,
    observation.title, observation.author, observation.publishedAt, observation.publishedTimePrecision, observation.firstSeenAt,
    observation.lastSeenAt, observation.evidenceLevel, observation.availabilityStatus,
    observation.contentRole, observation.content, observation.summary, observation.contentHash,
    JSON.stringify(observation.stockCodes), JSON.stringify(observation.sectors), JSON.stringify(observation.topics),
    observation.mediaType, observation.archiveStatus, observation.rightsBasis, observation.localAssetPath,
    JSON.stringify(observation.curveData), observation.analysisNotes,
    observation.stance, observation.horizon, observation.confidence, knowledgeSourceId
  );
  return rowToObservation(observationRow(channel.id, externalKey));
}

function listObservations(channelId, options = {}) {
  getChannel(channelId);
  const conditions = ['channel_id = @channelId'];
  const params = { channelId: Number(channelId), limit: Math.min(Math.max(Number(options.limit) || 200, 1), 1000) };
  if (options.evidenceLevel && EVIDENCE_LEVELS.has(String(options.evidenceLevel))) {
    conditions.push('evidence_level = @evidenceLevel');
    params.evidenceLevel = String(options.evidenceLevel);
  }
  if (options.availabilityStatus && AVAILABILITY_STATUSES.has(String(options.availabilityStatus))) {
    conditions.push('availability_status = @availabilityStatus');
    params.availabilityStatus = String(options.availabilityStatus);
  }
  const query = cleanText(options.query, 300);
  if (query) {
    conditions.push('(title LIKE @query OR content_text LIKE @query OR summary_text LIKE @query OR topics_json LIKE @query OR stock_codes_json LIKE @query)');
    params.query = '%' + query + '%';
  }
  return db.prepare(`SELECT * FROM expert_observations WHERE ${conditions.join(' AND ')}
    ORDER BY COALESCE(NULLIF(published_at, ''), first_seen_at) DESC, id DESC LIMIT @limit`)
    .all(params).map(rowToObservation);
}

function findObservationByIdentity(channelId, input = {}) {
  getChannel(channelId);
  const externalContentId = cleanText(input.externalContentId, 160);
  const sourceUrl = normalizeUrl(input.sourceUrl);
  const clauses = [];
  const params = { channelId: Number(channelId) };
  if (externalContentId) {
    clauses.push('external_content_id = @externalContentId');
    params.externalContentId = externalContentId;
  }
  if (sourceUrl) {
    clauses.push('LOWER(source_url) = LOWER(@sourceUrl)');
    params.sourceUrl = sourceUrl;
  }
  if (!clauses.length) return null;
  const row = db.prepare(`SELECT * FROM expert_observations
    WHERE channel_id = @channelId AND (${clauses.join(' OR ')}) LIMIT 1`).get(params);
  return row ? rowToObservation(row) : null;
}

function deleteObservation(channelId, observationId) {
  const action = function() {
    getChannel(channelId);
    const row = db.prepare('SELECT id, knowledge_source_id FROM expert_observations WHERE id = ? AND channel_id = ?')
      .get(Number(observationId), Number(channelId));
    if (!row) return false;
    db.prepare('DELETE FROM expert_observations WHERE id = ?').run(row.id);
    if (row.knowledge_source_id) knowledge.deleteSource(Number(row.knowledge_source_id));
    return true;
  };
  return db.inTransaction ? action() : db.transaction(action)();
}

function deleteChannel(channelId) {
  const action = function() {
    const channel = getChannel(channelId);
    const sourceIds = db.prepare('SELECT knowledge_source_id FROM expert_observations WHERE channel_id = ? AND knowledge_source_id IS NOT NULL')
      .all(channel.id).map(item => Number(item.knowledge_source_id));
    db.prepare('DELETE FROM expert_channels WHERE id = ?').run(channel.id);
    sourceIds.forEach(id => knowledge.deleteSource(id));
    return true;
  };
  return db.inTransaction ? action() : db.transaction(action)();
}

function buildIntentContext(channelId, input = {}) {
  const channel = getChannel(channelId);
  const observations = listObservations(channel.id, { limit: 500 });
  const sourceIds = observations.map(item => item.knowledgeSourceId).filter(Boolean);
  if (!sourceIds.length) throw new Error('该研究对象还没有可检索的正文证据');
  const isCreator = ['creator', 'person'].includes(channel.subjectType);
  const question = cleanText(input.question, 1000) || (isCreator
    ? '根据可核对证据，分析' + channel.displayName + '近期直接表达的观点、可能意图及其替代解释。'
    : '根据可核对证据，总结' + channel.displayName + '的核心方法、适用条件、可检验规则和反例。');
  const context = knowledge.buildAnalysisContext({
    question,
    searchQuery: cleanText(input.searchQuery, 500) || channel.displayName,
    sourceIds,
    mode: input.mode || 'timeline',
    limit: input.limit || 10
  });
  const boundary = [
    '## 研究资料证据边界',
    '- `primary` 仅表示本人公开页面；`archive` 表示合法公开存档。',
    '- `secondary_quote` 和 `commentary` 均为第三方材料，不得改写为本人原话。',
    '- `deleted_trace` 只证明公开页面或第三方材料提到内容已不可用，不证明系统掌握被删除原文。',
    '- “意图/暗示”必须作为模型推断，列出前提、置信度、替代解释和反证，不能陈述成事实。',
    '- 曲线和图形分析必须说明数据来源、坐标含义、观察窗口及可证伪条件，不得仅凭形状下结论。',
    ''
  ].join('\n');
  return Object.assign({}, context, {
    channel,
    observationCount: observations.length,
    prompt: boundary + context.prompt
  });
}

function rowToBacktest(row) {
  return {
    id: Number(row.id),
    channelId: Number(row.channel_id),
    observationId: row.observation_id == null ? null : Number(row.observation_id),
    status: row.status,
    signalAt: row.signal_at,
    eligibleAt: row.eligible_at || '',
    instrumentCode: row.instrument_code || '',
    benchmarkCode: row.benchmark_code || '',
    horizons: parseJson(row.horizons_json, []),
    methodology: parseJson(row.methodology_json, {}),
    result: parseJson(row.result_json, {}),
    runId: row.run_id || '',
    datasetId: row.dataset_id || '',
    resultPath: row.result_path || '',
    resultSha256: row.result_sha256 || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function recordBacktest(channelId, input = {}) {
  const channel = getChannel(channelId);
  const runId = cleanText(input.runId, 160);
  if (!runId) throw new Error('回测运行 ID 不能为空');
  const result = input.result && typeof input.result === 'object' ? input.result : {};
  const methodology = input.methodology && typeof input.methodology === 'object'
    ? input.methodology : (result.parameters || {});
  const horizons = Array.isArray(input.horizons) ? input.horizons : (methodology.horizons || [1, 5, 20, 60]);
  db.prepare(`
    INSERT INTO expert_backtests (
      channel_id, observation_id, status, signal_at, eligible_at, instrument_code,
      benchmark_code, horizons_json, methodology_json, result_json, run_id,
      dataset_id, result_path, result_sha256
    ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) WHERE run_id <> '' DO UPDATE SET
      status = excluded.status,
      methodology_json = excluded.methodology_json,
      result_json = excluded.result_json,
      dataset_id = excluded.dataset_id,
      result_path = excluded.result_path,
      result_sha256 = excluded.result_sha256,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    channel.id, cleanText(input.status, 40) || 'exploratory',
    safeIso(input.signalAt, new Date().toISOString()), cleanText(input.eligibleAt, 50),
    cleanText(input.instrumentCode, 20) || 'MULTI', cleanText(input.benchmarkCode, 20),
    JSON.stringify(horizons), JSON.stringify(methodology), JSON.stringify(result), runId,
    cleanText(input.datasetId, 160), cleanText(input.resultPath, 2000), cleanText(input.resultSha256, 80)
  );
  return rowToBacktest(db.prepare('SELECT * FROM expert_backtests WHERE run_id = ?').get(runId));
}

function listBacktests(channelId, options = {}) {
  getChannel(channelId);
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 500);
  return db.prepare(`SELECT * FROM expert_backtests WHERE channel_id = ?
    ORDER BY datetime(created_at) DESC, id DESC LIMIT ?`).all(Number(channelId), limit).map(rowToBacktest);
}

function exportChannels() {
  return listChannels({ limit: 500 }).map(channel => ({
    channelKey: channel.channelKey,
    displayName: channel.displayName,
    subjectType: channel.subjectType,
    platform: channel.platform,
    profileUrl: channel.profileUrl,
    description: channel.description,
    aliases: channel.aliases,
    discoveryQueries: channel.discoveryQueries,
    enabled: channel.enabled,
    observations: listObservations(channel.id, { limit: 1000 }),
    backtests: listBacktests(channel.id, { limit: 500 })
  }));
}

function restoreChannels(channels) {
  (Array.isArray(channels) ? channels : []).forEach(item => {
    const channel = createChannel(item);
    (item.observations || []).forEach(observation => recordObservation(channel.id, observation));
    (item.backtests || []).forEach(backtest => recordBacktest(channel.id, backtest));
  });
}

module.exports = {
  EVIDENCE_LEVELS,
  AVAILABILITY_STATUSES,
  CONTENT_ROLES,
  STANCES,
  TIME_PRECISIONS,
  SUBJECT_TYPES,
  MEDIA_TYPES,
  ARCHIVE_STATUSES,
  RIGHTS_BASES,
  createChannel,
  getChannel,
  listChannels,
  recordObservation,
  listObservations,
  findObservationByIdentity,
  deleteObservation,
  deleteChannel,
  buildIntentContext,
  recordBacktest,
  listBacktests,
  exportChannels,
  restoreChannels
};
