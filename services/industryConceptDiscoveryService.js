'use strict';

const crypto = require('node:crypto');
const defaultDb = require('../db');
const defaultMarketBoardService = require('./marketBoardService');
const defaultResearchService = require('./industryResearchService');

const NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function cleanText(value, maximum) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; }
}

function sourceKey(provider, providerId) {
  return provider + ':' + providerId;
}

function createIndustryConceptDiscoveryService(options = {}) {
  const db = options.db || defaultDb;
  const marketBoardService = options.marketBoardService || defaultMarketBoardService;
  const researchService = options.researchService || defaultResearchService;
  const now = options.now || (() => new Date().toISOString());

  function trackedTopics() {
    const map = new Map();
    for (const topic of researchService.listTopics()) {
      const key = topic && topic.config && topic.config.conceptKey;
      if (key) map.set(key, topic.id);
    }
    return map;
  }

  function rowToItem(row, tracked, referenceTime) {
    const payload = parseJson(row.payload_json, {});
    const firstSeen = Date.parse(row.first_seen_at);
    return {
      key: sourceKey(row.provider, row.provider_id),
      name: row.name,
      classification: row.classification || null,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      isNew: !Boolean(row.baseline) && Number.isFinite(firstSeen) && referenceTime - firstSeen <= NEW_WINDOW_MS,
      trackedTopicId: tracked.get(sourceKey(row.provider, row.provider_id)) || null,
      source: {
        provider: row.provider,
        providerId: row.provider_id,
        fetchedAt: row.source_fetched_at || null,
        stale: payload.stale === true,
        coverageComplete: payload.coverageComplete === true
      }
    };
  }

  function list(input = {}) {
    const query = cleanText(input.query, 80).toLocaleLowerCase();
    const requestedLimit = Number(input.limit);
    const limit = Number.isInteger(requestedLimit) ? Math.min(1000, Math.max(1, requestedLimit)) : 80;
    const rows = db.prepare(`SELECT * FROM industry_concept_discovery
      WHERE active = 1 ORDER BY baseline ASC, catalog_rank ASC, name ASC`).all();
    const tracked = trackedTopics();
    const referenceTime = Date.parse(now());
    const activeItems = rows.map(row => rowToItem(row, tracked, referenceTime));
    const matching = query ? activeItems.filter(item => item.name.toLocaleLowerCase().includes(query)) : activeItems;
    return {
      schema: 'webstock.industry-concept-discovery/v1',
      summary: {
        total: activeItems.length,
        shown: Math.min(limit, matching.length),
        matching: matching.length,
        newCount: activeItems.filter(item => item.isNew).length,
        trackedCount: activeItems.filter(item => item.trackedTopicId).length,
        baselineInitialized: false
      },
      items: matching.slice(0, limit)
    };
  }

  async function syncAndList(input = {}) {
    const catalog = await marketBoardService.fetchCatalog({ taxonomy: 'concept', refresh: input.refresh === true });
    const coverage = Array.isArray(catalog.coverage)
      ? catalog.coverage.find(item => item.taxonomy === 'concept')
      : null;
    const rawItems = Array.isArray(catalog.items) ? catalog.items : [];
    const items = rawItems.map((item, index) => ({
      provider: cleanText(item.provider, 80),
      providerId: cleanText(item.providerId || item.code, 80),
      name: cleanText(item.name, 120),
      classification: cleanText(item.classification, 120) || null,
      rank: index + 1,
      payload: {
        key: cleanText(item.key, 180),
        stale: item.stale === true,
        coverageComplete: item.coverageComplete === true,
        status: cleanText(item.status, 40) || null
      }
    })).filter(item => item.provider && item.providerId && item.name);
    const observedAt = cleanText(catalog.fetchedAt || coverage && coverage.fetchedAt || now(), 80);
    const existingCount = db.prepare('SELECT COUNT(*) AS count FROM industry_concept_discovery').get().count;
    const baselineInitialized = existingCount === 0 && items.length > 0;

    if (items.length) {
      db.transaction(() => {
        const select = db.prepare('SELECT provider_id FROM industry_concept_discovery WHERE provider = ? AND provider_id = ?');
        const insert = db.prepare(`INSERT INTO industry_concept_discovery
          (provider,provider_id,name,classification,first_seen_at,last_seen_at,source_fetched_at,catalog_rank,baseline,active,payload_json)
          VALUES (?,?,?,?,?,?,?,?,?,1,?)`);
        const update = db.prepare(`UPDATE industry_concept_discovery SET
          name = ?, classification = ?, last_seen_at = ?, source_fetched_at = ?, catalog_rank = ?, active = 1, payload_json = ?
          WHERE provider = ? AND provider_id = ?`);
        for (const item of items) {
          const payloadJson = JSON.stringify(item.payload);
          if (select.get(item.provider, item.providerId)) {
            update.run(item.name, item.classification, observedAt, observedAt, item.rank, payloadJson, item.provider, item.providerId);
          } else {
            insert.run(item.provider, item.providerId, item.name, item.classification, observedAt, observedAt, observedAt, item.rank, baselineInitialized ? 1 : 0, payloadJson);
          }
        }
        if (catalog.coverageComplete === true || coverage && coverage.coverageComplete === true) {
          db.prepare('UPDATE industry_concept_discovery SET active = 0 WHERE last_seen_at <> ?').run(observedAt);
        }
      })();
    }

    const result = list(input);
    result.summary.baselineInitialized = baselineInitialized;
    result.source = {
      provider: coverage && coverage.provider || catalog.provider || null,
      status: coverage && coverage.status || catalog.status || (items.length ? 'partial' : 'unavailable'),
      fetchedAt: observedAt || null,
      stale: catalog.stale === true || Boolean(coverage && coverage.stale),
      coverageComplete: catalog.coverageComplete === true || Boolean(coverage && coverage.coverageComplete),
      reason: coverage && coverage.reason || catalog.reason || null
    };
    if (!items.length) result.dataGaps = ['概念目录本次未返回可用条目，当前列表来自已保存的最近目录。'];
    return result;
  }

  function trackConcept(input = {}) {
    const provider = cleanText(input.provider, 80);
    const providerId = cleanText(input.providerId, 80);
    if (!provider || !providerId) throw fail('INVALID_INPUT', 'concept provider identity is required');
    const row = db.prepare(`SELECT * FROM industry_concept_discovery
      WHERE provider = ? AND provider_id = ? AND active = 1`).get(provider, providerId);
    if (!row) throw fail('NOT_FOUND', 'Concept was not found in the active provider directory');
    const conceptKey = sourceKey(provider, providerId);
    const existing = researchService.listTopics().find(topic => topic.config && topic.config.conceptKey === conceptKey);
    if (existing) return { created: false, topic: existing };
    const topicId = 'concept_' + crypto.createHash('sha256').update(conceptKey).digest('hex').slice(0, 16);
    return researchService.createTopic({
      id: topicId,
      name: row.name,
      aliases: [row.name],
      sourceUrls: [],
      enabled: false,
      intervalMinutes: 1440,
      config: {
        origin: 'concept-directory',
        conceptKey,
        provider,
        providerId,
        classification: row.classification || null,
        firstSeenAt: row.first_seen_at,
        evidenceStatus: 'directory-only'
      }
    });
  }

  return { list, syncAndList, trackConcept };
}

const defaultService = createIndustryConceptDiscoveryService();

module.exports = Object.assign(defaultService, {
  NEW_WINDOW_MS,
  createIndustryConceptDiscoveryService
});
