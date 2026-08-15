const db = require('../db');

const RUN_STATUSES = new Set(['pending', 'completed', 'failed']);

function text(value, maxLength = 2000) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function jsonValue(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return value;
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || '');
    return parsed == null ? fallback : parsed;
  } catch (error) {
    return fallback;
  }
}

function rowToRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    runType: row.run_type,
    modelId: row.model_id,
    status: row.status,
    title: row.title || '',
    question: row.question || '',
    prompt: row.prompt || '',
    result: row.result_text || '',
    evidence: parseJson(row.evidence_json, []),
    request: parseJson(row.request_json, {}),
    metrics: parseJson(row.metrics_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeRun(input = {}) {
  const runType = text(input.runType, 80);
  const modelId = text(input.modelId, 120);
  const status = text(input.status || 'completed', 30).toLowerCase();
  if (!runType) throw new Error('研究运行类型不能为空');
  if (!modelId) throw new Error('研究模型不能为空');
  if (!RUN_STATUSES.has(status)) throw new Error('研究运行状态无效');
  const evidence = jsonValue(input.evidence, []);
  if (!Array.isArray(evidence)) throw new Error('研究证据必须是数组');
  return {
    runType,
    modelId,
    status,
    title: text(input.title, 200),
    question: text(input.question, 2000),
    prompt: text(input.prompt, 250000),
    result: text(input.result, 250000),
    evidence,
    request: jsonValue(input.request, {}),
    metrics: jsonValue(input.metrics, {}),
    createdAt: text(input.createdAt, 40)
  };
}

function createRun(input = {}) {
  const run = normalizeRun(input);
  const statement = run.createdAt ? db.prepare(`
    INSERT INTO ai_research_runs (
      run_type, model_id, status, title, question, prompt, result_text,
      evidence_json, request_json, metrics_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `) : db.prepare(`
    INSERT INTO ai_research_runs (
      run_type, model_id, status, title, question, prompt, result_text,
      evidence_json, request_json, metrics_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const values = [
    run.runType, run.modelId, run.status, run.title, run.question, run.prompt, run.result,
    JSON.stringify(run.evidence), JSON.stringify(run.request), JSON.stringify(run.metrics)
  ];
  if (run.createdAt) values.push(run.createdAt, run.createdAt);
  const info = statement.run(...values);
  return getRun(info.lastInsertRowid);
}

function getRun(id) {
  const row = db.prepare('SELECT * FROM ai_research_runs WHERE id = ?').get(Number(id));
  if (!row) throw new Error('研究记录不存在');
  return rowToRun(row);
}

function updateRun(id, input = {}) {
  const existing = getRun(id);
  const run = normalizeRun(Object.assign({}, existing, input, { createdAt: '' }));
  db.prepare(`UPDATE ai_research_runs SET
    run_type = ?, model_id = ?, status = ?, title = ?, question = ?, prompt = ?,
    result_text = ?, evidence_json = ?, request_json = ?, metrics_json = ?,
    updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
    run.runType, run.modelId, run.status, run.title, run.question, run.prompt, run.result,
    JSON.stringify(run.evidence), JSON.stringify(run.request), JSON.stringify(run.metrics), Number(id)
  );
  return getRun(id);
}

function failRun(id, error, stage) {
  const existing = getRun(id);
  return updateRun(id, {
    status: 'failed',
    metrics: Object.assign({}, existing.metrics || {}, {
      failure: {
        stage: text(stage, 80) || 'unknown',
        message: text(error && error.message || error || 'AI 研究运行失败', 2000),
        failedAt: new Date().toISOString()
      }
    })
  });
}

function listRuns(options = {}) {
  const conditions = [];
  const params = { limit: Math.min(Math.max(Number(options.limit) || 50, 1), 500) };
  if (options.runType) {
    conditions.push('run_type = @runType');
    params.runType = text(options.runType, 80);
  }
  if (options.modelId) {
    conditions.push('model_id = @modelId');
    params.modelId = text(options.modelId, 120);
  }
  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  return db.prepare('SELECT * FROM ai_research_runs' + where + ' ORDER BY datetime(created_at) DESC, id DESC LIMIT @limit')
    .all(params)
    .map(rowToRun);
}

function deleteRun(id) {
  return db.prepare('DELETE FROM ai_research_runs WHERE id = ?').run(Number(id)).changes > 0;
}

function exportRuns() {
  return db.prepare('SELECT * FROM ai_research_runs ORDER BY id ASC').all().map(rowToRun);
}

module.exports = {
  createRun,
  getRun,
  updateRun,
  failRun,
  listRuns,
  deleteRun,
  exportRuns
};
