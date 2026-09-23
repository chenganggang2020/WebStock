const crypto = require('crypto');
const db = require('../db');
const gptPickImports = require('./gptPickImportService');

const BATCH_SCHEMA = 'webstock.external-research-batch/v1';
const PICK_SCHEMA = 'webstock.research-picks/v1';
const HOTSPOT_SCHEMA = 'webstock.market-hotspots/v1';
const INDUSTRY_CHAIN_SCHEMA = 'webstock.industry-chain-updates/v1';
const ALLOWED_TARGETS = new Set(['webstock-research', 'tonghuashun-watchlist']);
const BATCH_KEYS = new Set(['schema', 'source', 'revision', 'asOf', 'automaticTrading', 'artifacts', 'deliveries']);

function issue(message, status) {
  const error = new Error(message);
  error.status = status || 422;
  return error;
}

function text(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength || 2000);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce(function(result, key) {
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function normalizedPick(input, index) {
  const code = text(input && input.code, 20);
  const name = text(input && input.name, 80);
  const thesis = text(input && input.thesis, 4000);
  const risks = Array.isArray(input && input.risks) ? input.risks.map(function(item) { return text(item, 1000); }).filter(Boolean) : [];
  const rank = input && input.rank !== undefined ? Number(input.rank) : index + 1;
  const evidenceRefs = evidenceList(input && input.evidenceRefs, '候选 evidenceRefs');
  if (!/^(?:(?:000|001|002|003|300|301|302|600|601|603|605|688|689|920)\d{3})$/.test(code)) {
    throw issue('第 ' + (index + 1) + ' 个候选不是有效 A股代码');
  }
  if (!Number.isInteger(rank) || rank < 1 || rank > 20) throw issue('候选 rank 必须是 1–20 的整数');
  if (!name || !thesis || !risks.length) throw issue('每个候选必须包含名称、研究逻辑和至少一项风险');
  return {
    rank,
    priority: input.priority === '重点' || input.priority === '观察' ? input.priority : '',
    code,
    name,
    thesis,
    risks,
    evidenceRefs,
    includeInTonghuashun: input.includeInTonghuashun === true
  };
}

function textList(value, field, minimum) {
  const items = Array.isArray(value) ? value.map(function(item) { return text(item, 2000); }).filter(Boolean) : [];
  if (items.length < (minimum || 0)) throw issue(field + ' 至少需要 ' + (minimum || 0) + ' 项');
  return items.slice(0, 30);
}

function evidenceList(value, field) {
  const items = textList(value, field, 1);
  const invalid = items.some(function(item) {
    try {
      const parsed = new URL(item);
      return parsed.protocol !== 'http:' && parsed.protocol !== 'https:';
    } catch (error) {
      return true;
    }
  });
  if (invalid) throw issue(field + ' 必须是完整的 http/https 来源链接');
  return items;
}

function normalizeHotspotArtifact(artifact) {
  if (artifact.schema !== HOTSPOT_SCHEMA) throw issue('market-hotspots 产物 schema 不受支持');
  const payload = artifact.payload || {};
  const rows = Array.isArray(payload.items) ? payload.items : [];
  if (!rows.length || rows.length > 20) throw issue('热点更新必须包含 1–20 个条目');
  const items = rows.map(function(input, index) {
    const name = text(input && input.name, 120);
    const thesis = text(input && input.thesis, 4000);
    const evidenceRefs = evidenceList(input && input.evidenceRefs, '热点 evidenceRefs');
    if (!name || !thesis) throw issue('每个热点必须包含名称和研究判断');
    return {
      rank: Number(input.rank) || index + 1,
      name,
      state: text(input.state, 40),
      thesis,
      drivers: textList(input.drivers, '热点驱动', 0),
      risks: textList(input.risks, '热点风险', 1),
      evidenceRefs,
      relatedCodes: textList(input.relatedCodes, '热点相关代码', 0).filter(function(code) { return /^\d{6}$/.test(code); })
    };
  });
  return {
    artifactId: text(artifact.artifactId, 120) || 'market-hotspots',
    kind: 'market-hotspots',
    schema: HOTSPOT_SCHEMA,
    payload: { summary: text(payload.summary, 10000), items }
  };
}

function normalizeIndustryChainArtifact(artifact) {
  if (artifact.schema !== INDUSTRY_CHAIN_SCHEMA) throw issue('industry-chain-updates 产物 schema 不受支持');
  const payload = artifact.payload || {};
  const rows = Array.isArray(payload.chains) ? payload.chains : [];
  if (!rows.length || rows.length > 20) throw issue('产业链更新必须包含 1–20 个条目');
  const chains = rows.map(function(input) {
    const name = text(input && input.name, 120);
    const thesis = text(input && input.thesis, 4000);
    const evidenceRefs = evidenceList(input && input.evidenceRefs, '产业链 evidenceRefs');
    if (!name || !thesis) throw issue('每条产业链更新必须包含名称和研究判断');
    return {
      name,
      state: text(input.state, 40),
      thesis,
      stages: textList(input.stages, '产业链环节', 1),
      catalysts: textList(input.catalysts, '产业链催化', 0),
      risks: textList(input.risks, '产业链风险', 1),
      evidenceRefs,
      relatedCodes: textList(input.relatedCodes, '产业链相关代码', 0).filter(function(code) { return /^\d{6}$/.test(code); })
    };
  });
  return {
    artifactId: text(artifact.artifactId, 120) || 'industry-chain-updates',
    kind: 'industry-chain-updates',
    schema: INDUSTRY_CHAIN_SCHEMA,
    payload: { summary: text(payload.summary, 10000), chains }
  };
}

function validateBatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw issue('研究批次必须是 JSON 对象');
  const unknownKeys = Object.keys(input).filter(function(key) { return !BATCH_KEYS.has(key); });
  if (unknownKeys.length) throw issue('研究批次存在未知顶层字段：' + unknownKeys.join(', '));
  if (input.schema !== BATCH_SCHEMA) throw issue('不支持的研究批次 schema');
  if (input.automaticTrading !== false) throw issue('automaticTrading 必须严格为 false');
  const source = input.source || {};
  const system = text(source.system, 80);
  const taskId = text(source.taskId, 120);
  const runId = text(source.runId || source.scheduledFor, 160);
  const generatedAt = text(source.generatedAt, 60);
  const revision = Number(input.revision);
  const marketDate = text(input.asOf && input.asOf.marketDate, 20);
  const observedAt = text(input.asOf && input.asOf.observedAt, 60);
  const timezone = text(input.asOf && input.asOf.timezone, 60);
  if (!system || !taskId || !runId || !generatedAt) throw issue('source.system/taskId/runId/generatedAt 均不能为空');
  if (!Number.isInteger(revision) || revision < 1) throw issue('revision 必须是正整数');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(marketDate)) throw issue('asOf.marketDate 必须使用 YYYY-MM-DD');
  if (!observedAt || !Number.isFinite(Date.parse(observedAt))) throw issue('asOf.observedAt 必须是有效时间');
  if (timezone !== 'Asia/Shanghai') throw issue('asOf.timezone 必须是 Asia/Shanghai');
  const artifacts = Array.isArray(input.artifacts) ? input.artifacts : [];
  if (artifacts.length < 1 || artifacts.length > 3) throw issue('研究批次必须包含 1–3 个研究产物');
  const supportedKinds = new Set(['research-picks', 'market-hotspots', 'industry-chain-updates']);
  if (artifacts.some(function(item) { return !item || !supportedKinds.has(item.kind); })) {
    throw issue('批次包含不支持的研究产物');
  }
  const pickArtifacts = artifacts.filter(function(item) { return item && item.kind === 'research-picks'; });
  const hotspotArtifacts = artifacts.filter(function(item) { return item && item.kind === 'market-hotspots'; });
  const chainArtifacts = artifacts.filter(function(item) { return item && item.kind === 'industry-chain-updates'; });
  if (pickArtifacts.length !== 1 || pickArtifacts[0].schema !== PICK_SCHEMA) {
    throw issue('批次必须且只能包含一个 webstock.research-picks/v1 候选产物');
  }
  if (hotspotArtifacts.length > 1 || chainArtifacts.length > 1) throw issue('同类研究产物不能重复');
  const rawPicks = pickArtifacts[0].payload && pickArtifacts[0].payload.picks;
  if (!Array.isArray(rawPicks) || rawPicks.length < 1 || rawPicks.length > 20) throw issue('结构化候选必须为 1–20 只，不能静默截断');
  const picks = rawPicks.map(normalizedPick);
  if (new Set(picks.map(function(item) { return item.code; })).size !== picks.length) throw issue('结构化候选代码不能重复');
  if (new Set(picks.map(function(item) { return item.rank; })).size !== picks.length) throw issue('结构化候选 rank 不能重复');
  const deliveries = Array.isArray(input.deliveries) ? input.deliveries : [];
  if (!deliveries.some(function(item) { return item && item.target === 'webstock-research'; })) {
    throw issue('批次必须投递到 webstock-research');
  }
  deliveries.forEach(function(item) {
    if (!item || !ALLOWED_TARGETS.has(item.target)) throw issue('存在不支持的投递目标');
  });
  const deliveryTargets = deliveries.map(function(item) { return item.target; });
  if (new Set(deliveryTargets).size !== deliveryTargets.length) throw issue('投递目标不能重复');
  const wantsTonghuashun = deliveryTargets.includes('tonghuashun-watchlist');
  if (wantsTonghuashun && !picks.some(function(item) { return item.includeInTonghuashun; })) {
    throw issue('同花顺投递必须包含至少一只候选');
  }
  const normalizedArtifacts = [{
    artifactId: text(pickArtifacts[0].artifactId, 120) || 'daily-picks',
    kind: 'research-picks',
    schema: PICK_SCHEMA,
    payload: { analysis: text(pickArtifacts[0].payload && pickArtifacts[0].payload.analysis, 20000), picks }
  }];
  if (hotspotArtifacts[0]) normalizedArtifacts.push(normalizeHotspotArtifact(hotspotArtifacts[0]));
  if (chainArtifacts[0]) normalizedArtifacts.push(normalizeIndustryChainArtifact(chainArtifacts[0]));
  const normalized = {
    schema: BATCH_SCHEMA,
    source: { system, taskId, runId, generatedAt, model: text(source.model, 120) },
    revision,
    asOf: {
      marketDate,
      observedAt,
      timezone: 'Asia/Shanghai'
    },
    automaticTrading: false,
    artifacts: normalizedArtifacts,
    deliveries: deliveries.map(function(item) {
      return { target: item.target, required: item.required === true, policy: item.policy || {} };
    })
  };
  const identity = [system, taskId, runId, revision].join('|');
  return {
    normalized,
    batchKey: sha256(identity),
    payloadHash: sha256(JSON.stringify(canonicalize(normalized))),
    picks,
    wantsTonghuashun
  };
}

function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch (error) { return fallback; }
}

function rowToBatch(row, replayed) {
  if (!row) return null;
  const details = parseJson(row.delivery_json, {});
  return {
    id: row.id,
    batchKey: row.batch_key,
    payloadHash: row.payload_hash,
    status: row.status,
    marketDate: row.market_date,
    webstockRunId: row.webstock_run_id,
    replayed: Boolean(replayed),
    deliveries: {
      webstock: { status: row.webstock_status, details: details.webstock || {} },
      tonghuashun: { status: row.tonghuashun_status, details: details.tonghuashun || {} }
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function getRow(batchKey) {
  return db.prepare('SELECT * FROM external_research_batches WHERE batch_key = ?').get(text(batchKey, 100));
}

const importTransaction = db.transaction(function(validated) {
  const existing = getRow(validated.batchKey);
  if (existing) {
    if (existing.payload_hash !== validated.payloadHash) throw issue('批次冲突：相同身份的 payload 已变化，必须提高 revision', 409);
    return rowToBatch(existing, true);
  }
  const artifact = validated.normalized.artifacts.find(function(item) { return item.kind === 'research-picks'; });
  const run = gptPickImports.importExternalPicks({
    batchKey: validated.batchKey,
    title: validated.normalized.asOf.marketDate + ' ChatGPT 每日研究候选',
    generatedAt: validated.normalized.source.generatedAt,
    model: validated.normalized.source.model,
    analysis: artifact.payload.analysis,
    picks: artifact.payload.picks.map(function(item) {
      return {
        rank: item.rank,
        priority: item.priority,
        code: item.code,
        name: item.name,
        reason: item.thesis,
        risk: item.risks.join('；'),
        analysis: '证据：' + item.evidenceRefs.join('；')
      };
    }),
    evidence: artifact.payload.picks.flatMap(function(item) { return item.evidenceRefs; })
  });
  const status = validated.wantsTonghuashun ? 'partial' : 'completed';
  const thsStatus = validated.wantsTonghuashun ? 'pending' : 'not-requested';
  const details = { webstock: { materializedAt: new Date().toISOString(), runId: run.id } };
  db.prepare(`INSERT INTO external_research_batches (
    batch_key, payload_hash, schema_version, source_system, task_id, run_id, revision,
    market_date, status, payload_json, webstock_run_id, webstock_status,
    tonghuashun_status, delivery_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'succeeded', ?, ?)`)
    .run(
      validated.batchKey, validated.payloadHash, BATCH_SCHEMA,
      validated.normalized.source.system, validated.normalized.source.taskId,
      validated.normalized.source.runId, validated.normalized.revision,
      validated.normalized.asOf.marketDate, status, JSON.stringify(validated.normalized),
      run.id, thsStatus, JSON.stringify(details)
    );
  return rowToBatch(getRow(validated.batchKey), false);
});

function importBatch(input) {
  return importTransaction(validateBatch(input));
}

function recordDelivery(batchKey, target, status, details) {
  if (target !== 'tonghuashun-watchlist') throw issue('当前只允许记录同花顺投递状态');
  if (!['succeeded', 'failed', 'no-change', 'pending'].includes(status)) throw issue('投递状态无效');
  const row = getRow(batchKey);
  if (!row) throw issue('研究批次不存在', 404);
  const delivery = parseJson(row.delivery_json, {});
  delivery.tonghuashun = Object.assign({}, details || {}, { recordedAt: new Date().toISOString() });
  const overall = ['succeeded', 'no-change'].includes(status) ? 'completed' : 'partial';
  db.prepare(`UPDATE external_research_batches
    SET tonghuashun_status = ?, status = ?, delivery_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE batch_key = ?`).run(status, overall, JSON.stringify(delivery), row.batch_key);
  return rowToBatch(getRow(row.batch_key), false);
}

function getBatch(batchKey) {
  const row = getRow(batchKey);
  if (!row) throw issue('研究批次不存在', 404);
  return rowToBatch(row, false);
}

function listLatestArtifacts() {
  const rows = db.prepare(`SELECT batch_key, market_date, payload_json, created_at
    FROM external_research_batches
    WHERE webstock_status = 'succeeded'
    ORDER BY id DESC LIMIT 100`).all();
  const result = { hotspots: null, industryChains: null };
  rows.forEach(function(row) {
    const batch = parseJson(row.payload_json, null);
    if (!batch || !Array.isArray(batch.artifacts)) return;
    batch.artifacts.forEach(function(artifact) {
      const key = artifact.kind === 'market-hotspots' ? 'hotspots' :
        artifact.kind === 'industry-chain-updates' ? 'industryChains' : '';
      if (!key || result[key]) return;
      result[key] = {
        batchKey: row.batch_key,
        marketDate: row.market_date,
        createdAt: row.created_at,
        source: batch.source || {},
        asOf: batch.asOf || {},
        artifactId: artifact.artifactId,
        schema: artifact.schema,
        payload: artifact.payload
      };
    });
  });
  return result;
}

module.exports = {
  BATCH_SCHEMA,
  PICK_SCHEMA,
  HOTSPOT_SCHEMA,
  INDUSTRY_CHAIN_SCHEMA,
  validateBatch,
  importBatch,
  recordDelivery,
  getBatch,
  listLatestArtifacts
};
