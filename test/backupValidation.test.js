const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-backup-validation-'));
process.env.WEBSTOCK_DB_PATH = path.join(testRoot, 'webstock.db');
const backup = require('../services/backupService');
const db = require('../db');

function seedResearchFixture() {
  db.exec('DELETE FROM industry_research_runs; DELETE FROM industry_research_versions; DELETE FROM industry_research_evidence; DELETE FROM industry_research_topics;');
  db.prepare('INSERT INTO industry_research_topics (id,name,aliases_json,source_urls_json,enabled,interval_minutes,next_due_at,config_json) VALUES (?,?,?,?,?,?,?,?)').run('bellows', '波纹管', '[]', '["https://example.com/source"]', 1, 120, '2026-09-09T03:00:00.000Z', '{}');
  const evidence = { id: 'evidence_fixture', requestedUrl: 'https://example.com/source', finalUrl: 'https://example.com/source', title: 'Fixture', publishedAt: null, publishedTimePrecision: 'unknown', fetchedAt: '2026-09-08T01:00:00.000Z', contentSha256: 'a'.repeat(64), snippet: 'A source quote', locator: { start: 0, end: 14 }, status: 'fetched' };
  db.prepare('INSERT INTO industry_research_evidence (id,canonical_url,content_sha256,payload_json,created_at) VALUES (?,?,?,?,?)').run(evidence.id, evidence.finalUrl, evidence.contentSha256, JSON.stringify(evidence), evidence.fetchedAt);
  const relation = { id: 'relation_fixture', topicId: 'bellows', stage: 'components', product: 'Fixture product', company: null, claim: 'A source quote', evidenceIds: [evidence.id], evidenceRefs: [{ evidenceId: evidence.id, url: evidence.finalUrl, quote: 'A source quote', position: { start: 0, end: 14 } }], polarity: 'supports', status: 'verified', reasonCodes: [], metrics: [], review: { decision: 'verify', source: 'local_manual' } };
  const payload = { id: 'version_fixture', topicId: 'bellows', sequence: 1, previousVersionId: null, createdAt: '2026-09-08T01:00:00.000Z', knowledgeCutoffAt: '2026-09-08T01:00:00.000Z', contentHash: 'b'.repeat(64), status: 'complete', evidenceIds: [evidence.id], relations: [relation], analysis: { kind: 'none', text: '', evidenceIds: [], model: null }, changes: { added: [relation.id], changed: [], disputed: [] }, gaps: [], run: { startedAt: '2026-09-08T01:00:00.000Z', completedAt: '2026-09-08T01:00:00.000Z', ai: 'disabled' } };
  payload.contentHash = crypto.createHash('sha256').update(JSON.stringify({ evidenceIds: payload.evidenceIds, relations: payload.relations, gaps: payload.gaps, analysis: payload.analysis })).digest('hex');
  db.prepare('INSERT INTO industry_research_versions (id,topic_id,sequence,previous_version_id,content_hash,payload_json,created_at) VALUES (?,?,?,?,?,?,?)').run(payload.id, payload.topicId, payload.sequence, null, payload.contentHash, JSON.stringify(payload), payload.createdAt);
  db.prepare('UPDATE industry_research_topics SET current_version_id = ? WHERE id = ?').run(payload.id, payload.topicId);
  db.prepare('INSERT INTO industry_research_runs (id,topic_id,status,payload_json,started_at,completed_at) VALUES (?,?,?,?,?,?)').run('run_fixture', 'bellows', 'succeeded', JSON.stringify({ successCount: 1 }), payload.createdAt, payload.createdAt);
}

function researchCounts() {
  return ['topics', 'evidence', 'versions', 'runs'].map(name => db.prepare('SELECT COUNT(*) AS count FROM industry_research_' + name).get().count);
}

test.after(() => {
  db.close();
  fs.rmSync(testRoot, { recursive: true, force: true });
});

function storedWatchlist() {
  return db.prepare('SELECT code, name, group_name, note FROM watchlist ORDER BY code').all();
}

test('invalid backup envelopes and table types cannot preview or replace existing data', () => {
  db.prepare('INSERT INTO watchlist (code, name, group_name, note) VALUES (?, ?, ?, ?)')
    .run('600000', 'Preserved test row', 'Test', 'must survive rejected imports');
  const before = storedWatchlist();
  for (const payload of [
    {}, [], { version: 7 }, { version: 7, tables: {} },
    { version: 7, tables: [] }, { version: 7, tables: 'invalid' },
    { version: 7, tables: { watchlist: null } },
    { version: 7, tables: { watchlist: {} } },
    { version: 7, tables: { watchlist: 'invalid' } },
    { version: 7, tables: { watchlist: [null] } },
    { version: 7, tables: { watchlist: [], unknownTable: [] } }
  ]) {
    assert.throws(() => backup.previewUserDataImport(payload), /backup|table|watchlist/i);
    assert.throws(() => backup.importUserData(payload, { mode: 'replace' }), /backup|table|watchlist/i);
    assert.deepEqual(storedWatchlist(), before);
  }
});

test('unsupported backup versions are rejected before replacement', () => {
  const before = storedWatchlist();
  for (const version of [0, -1, 1.5, '7', backup.BACKUP_VERSION + 1]) {
    const payload = { version, tables: { watchlist: [] } };
    assert.throws(() => backup.previewUserDataImport(payload), /version/i);
    assert.throws(() => backup.importUserData(payload), /version/i);
    assert.deepEqual(storedWatchlist(), before);
  }
});

test('current-version backups require every exported table before preview or replacement', () => {
  const current = backup.exportUserData();
  const before = storedWatchlist();
  for (const key of Object.keys(current.tables)) {
    const tables = { ...current.tables };
    delete tables[key];
    const payload = { ...current, tables };
    assert.throws(() => backup.previewUserDataImport(payload), /missing|required|table/i, key);
    assert.throws(() => backup.importUserData(payload, { mode: 'replace' }), /missing|required|table/i, key);
    assert.deepEqual(storedWatchlist(), before);
  }
});

test('supported old exports and unversioned flat table backups remain importable', () => {
  for (const payload of [
    { watchlist: [{ code: '000001', name: 'Legacy flat' }] },
    { version: 1, tables: { watchlist: [{ code: '000001', name: 'Version one' }] } },
    { version: 6, tables: { watchlist: [{ code: '000001', name: 'Version six' }] } },
    backup.exportUserData()
  ]) {
    const preview = backup.previewUserDataImport(payload);
    assert.equal(preview.legacyScope, payload.version !== backup.BACKUP_VERSION);
    if (preview.legacyScope) assert.match(preview.warnings.join(' '), /旧版.*未提供.*空表/);
    const imported = backup.importUserData(payload, { mode: 'replace' });
    assert.equal(imported.watchlist, preview.incoming.watchlist);
    assert.equal(storedWatchlist().length, preview.incoming.watchlist);
  }
});

test('replacement rolls back deletions when an insert fails inside the transaction', () => {
  const before = storedWatchlist();
  db.exec("CREATE TEMP TRIGGER fail_backup_restore BEFORE INSERT ON watchlist BEGIN SELECT RAISE(ABORT, 'forced restore failure'); END");
  try {
    assert.throws(() => backup.importUserData({ version: 1, tables: {
      watchlist: [{ code: '000002', name: 'Rejected insertion' }]
    } }, { mode: 'replace' }), /forced restore failure/);
    assert.deepEqual(storedWatchlist(), before);
  } finally {
    db.exec('DROP TRIGGER fail_backup_restore');
  }
});

test('v8 exports the complete industry research history and v7 missing research preserves it', () => {
  seedResearchFixture();
  const current = backup.exportUserData();
  assert.equal(backup.BACKUP_VERSION, 8);
  assert.ok(Array.isArray(current.tables.industryResearch));
  assert.deepEqual(Object.keys(current.tables.industryResearch[0]).sort(), ['aliases', 'config', 'currentVersionId', 'evidence', 'enabled', 'id', 'intervalMinutes', 'lastAttemptAt', 'lastSuccessAt', 'name', 'nextDueAt', 'runs', 'sourceUrls', 'versions'].sort());
  assert.deepEqual(researchCounts(), [1, 1, 1, 1]);
  const legacy = { version: 7, tables: { watchlist: [] } };
  backup.importUserData(legacy, { mode: 'merge' });
  assert.deepEqual(researchCounts(), [1, 1, 1, 1]);
  backup.importUserData(legacy, { mode: 'replace' });
  assert.deepEqual(researchCounts(), [1, 1, 1, 1]);
});

test('research backup validates nested references and restores imported reviews as disabled audit data', () => {
  seedResearchFixture();
  const exported = backup.exportUserData();
  const invalid = JSON.parse(JSON.stringify(exported));
  invalid.tables.industryResearch[0].versions[0].payload.relations[0].evidenceIds = ['missing'];
  assert.throws(() => backup.previewUserDataImport(invalid), /evidence|reference|hash/i);
  assert.deepEqual(researchCounts(), [1, 1, 1, 1]);
  backup.importUserData(exported, { mode: 'replace' });
  const topic = db.prepare('SELECT enabled,next_due_at FROM industry_research_topics WHERE id = ?').get('bellows');
  const restored = JSON.parse(db.prepare('SELECT payload_json FROM industry_research_versions WHERE id = ?').get('version_fixture').payload_json);
  assert.equal(topic.enabled, 0);
  assert.equal(topic.next_due_at, null);
  assert.equal(restored.relations[0].status, 'candidate');
  assert.equal(restored.relations[0].review.source, 'imported_review');
  assert.equal(restored.originalContentHash, exported.tables.industryResearch[0].versions[0].contentHash);
  const roundTrip = backup.exportUserData();
  assert.doesNotThrow(() => backup.previewUserDataImport(roundTrip));
  assert.doesNotThrow(() => backup.importUserData(roundTrip, { mode: 'merge' }));
});

test('research backup rejects future cutoff, oversized versions and invalid relation subsets before changing sentinels', () => {
  seedResearchFixture();
  const before = researchCounts();
  const current = backup.exportUserData();
  const future = JSON.parse(JSON.stringify(current));
  future.tables.industryResearch[0].versions[0].payload.knowledgeCutoffAt = '2999-01-01T00:00:00.000Z';
  assert.throws(() => backup.previewUserDataImport(future), /future|cutoff/i);
  const oversized = JSON.parse(JSON.stringify(current));
  oversized.tables.industryResearch[0].versions[0].payload.relations = Array.from({ length: 201 }, (_, index) => ({ id: 'r' + index, topicId: 'bellows', stage: 'components', product: 'p', claim: 'c', evidenceIds: ['evidence_fixture'], evidenceRefs: [{ evidenceId: 'evidence_fixture', quote: 'A source quote', position: { start: 0, end: 14 } }], polarity: 'supports', status: 'candidate', metrics: [] }));
  assert.throws(() => backup.previewUserDataImport(oversized), /relation|limit/i);
  const subset = JSON.parse(JSON.stringify(current));
  subset.tables.industryResearch[0].versions[0].payload.relations[0].evidenceRefs[0].evidenceId = 'other';
  assert.throws(() => backup.previewUserDataImport(subset), /evidence|reference/i);
  assert.deepEqual(researchCounts(), before);
});

test('research restore preserves disputed status while downgrading verified status', () => {
  seedResearchFixture();
  const exported = backup.exportUserData();
  const version = exported.tables.industryResearch[0].versions[0];
  version.payload.relations[0].status = 'disputed';
  version.payload.contentHash = version.contentHash = crypto.createHash('sha256').update(JSON.stringify({ evidenceIds: version.payload.evidenceIds, relations: version.payload.relations, gaps: version.payload.gaps, analysis: version.payload.analysis })).digest('hex');
  backup.importUserData(exported, { mode: 'replace' });
  assert.equal(backup.exportUserData().tables.industryResearch[0].versions[0].payload.relations[0].status, 'disputed');
});

test('research restore is atomic when the version sentinel fails', () => {
  seedResearchFixture();
  const before = researchCounts();
  const exported = backup.exportUserData();
  db.exec("CREATE TEMP TRIGGER fail_research_restore BEFORE INSERT ON industry_research_versions BEGIN SELECT RAISE(ABORT, 'forced research restore failure'); END");
  try {
    assert.throws(() => backup.importUserData(exported, { mode: 'replace' }), /forced research restore failure/);
    assert.deepEqual(researchCounts(), before);
  } finally {
    db.exec('DROP TRIGGER fail_research_restore');
  }
});
