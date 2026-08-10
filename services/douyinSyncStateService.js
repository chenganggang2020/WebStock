const db = require('../db');

function isoNow() {
  return new Date().toISOString();
}

function cleanText(value, maxLength = 2000) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function parseJson(value, fallback) {
  try { return JSON.parse(value || '') || fallback; } catch (error) { return fallback; }
}

function rowToJob(row) {
  if (!row) return null;
  return {
    channelId: Number(row.channel_id),
    enabled: Boolean(row.enabled),
    intervalMinutes: Number(row.interval_minutes),
    status: row.status || 'idle',
    lastStartedAt: row.last_started_at || '',
    lastCompletedAt: row.last_completed_at || '',
    nextRunAt: row.next_run_at || '',
    lastError: row.last_error || '',
    lastResult: parseJson(row.last_result_json, {}),
    runCount: Number(row.run_count || 0),
    updatedAt: row.updated_at || ''
  };
}

function ensureJob(channelId, defaults = {}) {
  const id = Number(channelId);
  const intervalMinutes = Math.min(Math.max(Number(defaults.intervalMinutes) || 10, 5), 1440);
  const enabled = defaults.enabled === true ? 1 : 0;
  db.prepare(`INSERT OR IGNORE INTO expert_sync_jobs
    (channel_id, enabled, interval_minutes, next_run_at) VALUES (?, ?, ?, ?)`)
    .run(id, enabled, intervalMinutes, enabled ? isoNow() : '');
  return getJob(id);
}

function getJob(channelId) {
  const id = Number(channelId);
  const row = db.prepare('SELECT * FROM expert_sync_jobs WHERE channel_id = ?').get(id);
  return rowToJob(row) || ensureJob(id);
}

function updateSettings(channelId, input = {}) {
  const current = getJob(channelId);
  const enabled = input.enabled == null ? current.enabled : input.enabled === true;
  const intervalMinutes = input.intervalMinutes == null ? current.intervalMinutes
    : Math.min(Math.max(Number(input.intervalMinutes) || 10, 5), 1440);
  const nextRunAt = enabled ? (current.enabled && current.nextRunAt ? current.nextRunAt : isoNow()) : '';
  db.prepare(`UPDATE expert_sync_jobs SET enabled = ?, interval_minutes = ?, status = ?,
    next_run_at = ?, last_error = CASE WHEN ? = 1 THEN last_error ELSE '' END,
    updated_at = CURRENT_TIMESTAMP WHERE channel_id = ?`)
    .run(enabled ? 1 : 0, intervalMinutes, enabled ? current.status : 'idle', nextRunAt, enabled ? 1 : 0, Number(channelId));
  return getJob(channelId);
}

function markRunning(channelId) {
  ensureJob(channelId);
  db.prepare(`UPDATE expert_sync_jobs SET status = 'running', last_started_at = ?, last_error = '',
    updated_at = CURRENT_TIMESTAMP WHERE channel_id = ?`).run(isoNow(), Number(channelId));
  return getJob(channelId);
}

function nextRunIso(intervalMinutes) {
  return new Date(Date.now() + Number(intervalMinutes) * 60000).toISOString();
}

function markCompleted(channelId, result = {}) {
  const current = getJob(channelId);
  const completedAt = isoNow();
  db.prepare(`UPDATE expert_sync_jobs SET status = 'idle', last_completed_at = ?, next_run_at = ?,
    last_error = '', last_result_json = ?, run_count = run_count + 1,
    updated_at = CURRENT_TIMESTAMP WHERE channel_id = ?`)
    .run(completedAt, current.enabled ? nextRunIso(current.intervalMinutes) : '',
      JSON.stringify(result || {}), Number(channelId));
  return getJob(channelId);
}

function markFailed(channelId, error) {
  const current = getJob(channelId);
  db.prepare(`UPDATE expert_sync_jobs SET status = 'error', next_run_at = ?, last_error = ?,
    run_count = run_count + 1, updated_at = CURRENT_TIMESTAMP WHERE channel_id = ?`)
    .run(current.enabled ? nextRunIso(current.intervalMinutes) : '',
      cleanText(error && (error.message || error), 2000), Number(channelId));
  return getJob(channelId);
}

function listDue(now = isoNow()) {
  return db.prepare(`SELECT * FROM expert_sync_jobs WHERE enabled = 1
    AND (next_run_at = '' OR datetime(next_run_at) <= datetime(?))
    ORDER BY datetime(next_run_at) ASC, channel_id ASC`).all(now).map(rowToJob);
}

module.exports = { ensureJob, getJob, updateSettings, markRunning, markCompleted, markFailed, listDue };
