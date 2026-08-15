const db = require('../db');

function isoNow() {
  return new Date().toISOString();
}

const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"'，。；！？、（）【】]+/gi;

function redactSensitiveUrls(value) {
  return String(value == null ? '' : value).replace(HTTP_URL_PATTERN, function(match) {
    const trailingMatch = match.match(/[),.;!\]}]+$/);
    const trailing = trailingMatch ? trailingMatch[0] : '';
    const url = trailing ? match.slice(0, -trailing.length) : match;
    const queryStart = url.search(/[?#]/);
    return (queryStart >= 0 ? url.slice(0, queryStart) : url) + trailing;
  });
}

function sanitizePersistentValue(value, seen) {
  if (typeof value === 'string') return redactSensitiveUrls(value);
  if (value == null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof URL !== 'undefined' && value instanceof URL) return redactSensitiveUrls(value.href);

  const visited = seen || new WeakSet();
  if (visited.has(value)) return '[Circular]';
  visited.add(value);

  if (Array.isArray(value)) {
    const result = value.map(function(item) { return sanitizePersistentValue(item, visited); });
    visited.delete(value);
    return result;
  }

  const result = {};
  Object.keys(value).forEach(function(key) {
    result[key] = sanitizePersistentValue(value[key], visited);
  });
  if (value instanceof Error && !Object.prototype.hasOwnProperty.call(result, 'message')) {
    result.message = redactSensitiveUrls(value.message || '');
  }
  visited.delete(value);
  return result;
}

function stringifyPersistentValue(value) {
  return JSON.stringify(sanitizePersistentValue(value));
}

function cleanText(value, maxLength = 2000) {
  return redactSensitiveUrls(value).trim().slice(0, maxLength);
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
    progress: parseJson(row.progress_json, {}),
    lastResult: parseJson(row.last_result_json, {}),
    runCount: Number(row.run_count || 0),
    updatedAt: row.updated_at || ''
  };
}

function rowToRunItem(row) {
  return {
    id: Number(row.id),
    runId: Number(row.run_id),
    contentId: row.content_id || '',
    sourceUrl: row.source_url || '',
    title: row.title || '',
    detailStatus: row.detail_status || 'pending',
    transcriptionStatus: row.transcription_status || 'not_ready',
    message: row.message || '',
    mediaBytes: Number(row.media_bytes || 0),
    elapsedSeconds: Number(row.elapsed_seconds || 0),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || ''
  };
}

function rowToRun(row, items) {
  return {
    id: Number(row.id),
    channelId: Number(row.channel_id),
    trigger: row.trigger || 'scheduled',
    status: row.status || 'running',
    startedAt: row.started_at || '',
    completedAt: row.completed_at || '',
    workCount: Number(row.work_count || 0),
    discoveredCount: Number(row.discovered_count || 0),
    candidateCount: Number(row.candidate_count || 0),
    detailedCount: Number(row.detailed_count || 0),
    detailErrorCount: Number(row.detail_error_count || 0),
    transcriptionAttemptedCount: Number(row.transcription_attempted_count || 0),
    transcribedCount: Number(row.transcribed_count || 0),
    mediaMissingCount: Number(row.media_missing_count || 0),
    transcriptErrorCount: Number(row.transcript_error_count || 0),
    addedCount: Number(row.added_count || 0),
    updatedCount: Number(row.updated_count || 0),
    unchangedCount: Number(row.unchanged_count || 0),
    message: row.message || '',
    error: row.error || '',
    result: parseJson(row.result_json, {}),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    items: Array.isArray(items) ? items : undefined
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
    progress_json = ?, updated_at = CURRENT_TIMESTAMP WHERE channel_id = ?`)
    .run(isoNow(), JSON.stringify({ stage: 'session', message: '正在检查登录会话' }), Number(channelId));
  return getJob(channelId);
}

function updateProgress(channelId, progress = {}) {
  ensureJob(channelId);
  db.prepare(`UPDATE expert_sync_jobs SET progress_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE channel_id = ?`).run(stringifyPersistentValue(progress || {}), Number(channelId));
  return getJob(channelId);
}

function updateArchiveCheckpoint(channelId, checkpoint = {}) {
  const current = getJob(channelId);
  const stoppedReason = ['reported_count_reached', 'visible_page_stable', 'scroll_limit']
    .includes(String(checkpoint.stoppedReason || '')) ? String(checkpoint.stoppedReason) : '';
  const archiveCheckpoint = {
    complete: checkpoint.complete === true,
    visibilityStable: checkpoint.visibilityStable === true,
    reportedWorkCount: Math.max(Number(checkpoint.reportedWorkCount) || 0, 0),
    discoveredCount: Math.max(Number(checkpoint.discoveredCount) || 0, 0),
    scrollCount: Math.max(Number(checkpoint.scrollCount) || 0, 0),
    scrollLimit: Math.max(Number(checkpoint.scrollLimit) || 0, 0),
    stableRounds: Math.max(Number(checkpoint.stableRounds) || 0, 0),
    stoppedReason
  };
  const lastResult = Object.assign({}, current.lastResult || {}, { archiveCheckpoint });
  db.prepare(`UPDATE expert_sync_jobs SET last_result_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE channel_id = ?`).run(stringifyPersistentValue(lastResult), Number(channelId));
  return getJob(channelId);
}

function nextRunIso(intervalMinutes) {
  return new Date(Date.now() + Number(intervalMinutes) * 60000).toISOString();
}

function markCompleted(channelId, result = {}) {
  const current = getJob(channelId);
  const completedAt = isoNow();
  const checkOnly = result.checkOnly === true;
  const updateCandidateCount = Math.max(Number(result.updateCandidateCount) || 0, 0);
  const completionMessage = checkOnly
    ? updateCandidateCount
      ? '更新检查完成，发现 ' + updateCandidateCount + ' 条新增或变化，等待手动采集'
      : '更新检查完成，未发现新增或实质变化'
    : '本轮采集已完成';
  const storedResult = current.lastResult && current.lastResult.archiveCheckpoint
    ? Object.assign({}, result, { archiveCheckpoint: current.lastResult.archiveCheckpoint })
    : result;
  db.prepare(`UPDATE expert_sync_jobs SET status = 'idle', last_completed_at = ?, next_run_at = ?,
    last_error = '', progress_json = ?, last_result_json = ?, run_count = run_count + 1,
    updated_at = CURRENT_TIMESTAMP WHERE channel_id = ?`)
    .run(completedAt, current.enabled ? nextRunIso(current.intervalMinutes) : '',
      stringifyPersistentValue({
        stage: 'completed',
        message: completionMessage,
        checkOnly,
        updatesAvailable: checkOnly && result.updatesAvailable === true,
        updateCandidateCount,
        workCount: Number(result.workCount || 0),
        discoveredCount: Number(result.discoveredCount || 0),
        detailTotal: Number(result.candidateCount == null
          ? Number(result.detailedCount || 0) + (Array.isArray(result.detailErrors) ? result.detailErrors.length : 0)
          : result.candidateCount),
        detailedCount: Number(result.detailedCount || 0),
        detailErrorCount: Array.isArray(result.detailErrors) ? result.detailErrors.length : 0,
        transcriptionAttemptedCount: Number(result.transcriptionAttemptedCount || 0),
        transcribedCount: Number(result.transcribedCount || 0),
        mediaMissingCount: Number(result.mediaMissingCount || 0),
        transcriptErrorCount: Array.isArray(result.transcriptErrors) ? result.transcriptErrors.length : 0,
        addedCount: Number(result.addedCount || 0),
        updatedCount: Number(result.updatedCount || 0)
      }),
      stringifyPersistentValue(storedResult || {}), Number(channelId));
  return getJob(channelId);
}

function markFailed(channelId, error) {
  const current = getJob(channelId);
  const message = cleanText(error && (error.message || error), 2000);
  const failedStage = current.progress && current.progress.stage ? current.progress.stage : 'session';
  const failedProgress = Object.assign({}, current.progress || {}, { stage: 'failed', failedStage, message });
  db.prepare(`UPDATE expert_sync_jobs SET status = 'error', next_run_at = ?, last_error = ?, progress_json = ?,
    run_count = run_count + 1, updated_at = CURRENT_TIMESTAMP WHERE channel_id = ?`)
    .run(current.enabled ? nextRunIso(current.intervalMinutes) : '',
      message, stringifyPersistentValue(failedProgress), Number(channelId));
  return getJob(channelId);
}

function listDue(now = isoNow()) {
  return db.prepare(`SELECT * FROM expert_sync_jobs WHERE enabled = 1
    AND (next_run_at = '' OR datetime(next_run_at) <= datetime(?))
    ORDER BY datetime(next_run_at) ASC, channel_id ASC`).all(now).map(rowToJob);
}

function listEnabled() {
  return db.prepare(`SELECT * FROM expert_sync_jobs WHERE enabled = 1
    ORDER BY channel_id ASC`).all().map(rowToJob);
}

function getRun(runId) {
  const row = db.prepare('SELECT * FROM expert_sync_runs WHERE id = ?').get(Number(runId));
  if (!row) throw new Error('采集运行记录不存在');
  return rowToRun(row);
}

function startRun(channelId, input = {}) {
  const startedAt = isoNow();
  const trigger = ['manual', 'scheduled', 'startup', 'archive'].includes(String(input.trigger || ''))
    ? String(input.trigger) : 'scheduled';
  const channelKey = Number(channelId);
  const interruptedMessage = '上次任务因程序退出或异常中断，已保留已完成数据并等待续跑';
  const result = db.transaction(function() {
    db.prepare(`UPDATE expert_sync_runs SET status = 'error', completed_at = ?, message = ?, error = ?,
      updated_at = CURRENT_TIMESTAMP WHERE channel_id = ? AND status = 'running'`)
      .run(startedAt, interruptedMessage, interruptedMessage, channelKey);
    return db.prepare(`INSERT INTO expert_sync_runs
      (channel_id, trigger, status, started_at, message) VALUES (?, ?, 'running', ?, ?)`)
      .run(channelKey, trigger, startedAt, cleanText(input.message || '正在检查登录会话'));
  })();
  return getRun(result.lastInsertRowid);
}

const RUN_UPDATE_COLUMNS = {
  workCount: 'work_count',
  discoveredCount: 'discovered_count',
  candidateCount: 'candidate_count',
  detailedCount: 'detailed_count',
  detailErrorCount: 'detail_error_count',
  transcriptionAttemptedCount: 'transcription_attempted_count',
  transcribedCount: 'transcribed_count',
  mediaMissingCount: 'media_missing_count',
  transcriptErrorCount: 'transcript_error_count',
  addedCount: 'added_count',
  updatedCount: 'updated_count',
  unchangedCount: 'unchanged_count',
  message: 'message'
};

function updateRun(runId, input = {}) {
  getRun(runId);
  const values = [];
  const assignments = [];
  Object.keys(RUN_UPDATE_COLUMNS).forEach(function(key) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) return;
    assignments.push(RUN_UPDATE_COLUMNS[key] + ' = ?');
    values.push(key === 'message' ? cleanText(input[key]) : Math.max(Number(input[key]) || 0, 0));
  });
  if (!assignments.length) return getRun(runId);
  values.push(Number(runId));
  db.prepare('UPDATE expert_sync_runs SET ' + assignments.join(', ') +
    ', updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(...values);
  return getRun(runId);
}

const RUN_ITEM_COLUMNS = {
  sourceUrl: 'source_url',
  title: 'title',
  detailStatus: 'detail_status',
  transcriptionStatus: 'transcription_status',
  message: 'message',
  mediaBytes: 'media_bytes',
  elapsedSeconds: 'elapsed_seconds'
};

function upsertRunItem(runId, input = {}) {
  getRun(runId);
  const contentId = cleanText(input.contentId, 100);
  if (!contentId) throw new Error('采集运行明细缺少作品 ID');
  const existing = db.prepare('SELECT * FROM expert_sync_run_items WHERE run_id = ? AND content_id = ?')
    .get(Number(runId), contentId);
  if (!existing) {
    db.prepare(`INSERT INTO expert_sync_run_items
      (run_id, content_id, source_url, title, detail_status, transcription_status, message, media_bytes, elapsed_seconds)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      Number(runId), contentId, cleanText(input.sourceUrl, 2000), cleanText(input.title, 300),
      cleanText(input.detailStatus || 'pending', 40), cleanText(input.transcriptionStatus || 'not_ready', 40),
      cleanText(input.message, 1000), Math.max(Number(input.mediaBytes) || 0, 0),
      Math.max(Number(input.elapsedSeconds) || 0, 0)
    );
  } else {
    const assignments = [];
    const values = [];
    Object.keys(RUN_ITEM_COLUMNS).forEach(function(key) {
      if (!Object.prototype.hasOwnProperty.call(input, key)) return;
      assignments.push(RUN_ITEM_COLUMNS[key] + ' = ?');
      values.push(['mediaBytes', 'elapsedSeconds'].includes(key)
        ? Math.max(Number(input[key]) || 0, 0) : cleanText(input[key], key === 'sourceUrl' ? 2000 : key === 'title' ? 300 : 1000));
    });
    if (assignments.length) {
      values.push(Number(existing.id));
      db.prepare('UPDATE expert_sync_run_items SET ' + assignments.join(', ') +
        ', updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(...values);
    }
  }
  return rowToRunItem(db.prepare('SELECT * FROM expert_sync_run_items WHERE run_id = ? AND content_id = ?')
    .get(Number(runId), contentId));
}

function completeRun(runId, result = {}) {
  updateRun(runId, {
    workCount: result.workCount,
    discoveredCount: result.discoveredCount,
    candidateCount: result.candidateCount,
    detailedCount: result.detailedCount,
    detailErrorCount: Array.isArray(result.detailErrors) ? result.detailErrors.length : result.detailErrorCount,
    transcriptionAttemptedCount: result.transcriptionAttemptedCount,
    transcribedCount: result.transcribedCount,
    mediaMissingCount: result.mediaMissingCount,
    transcriptErrorCount: Array.isArray(result.transcriptErrors) ? result.transcriptErrors.length : result.transcriptErrorCount,
    addedCount: result.addedCount,
    updatedCount: result.updatedCount,
    unchangedCount: result.unchangedCount,
    message: result.checkOnly === true
      ? Math.max(Number(result.updateCandidateCount) || 0, 0)
        ? '更新检查完成，发现待采集变化'
        : '更新检查完成，未发现变化'
      : '本轮采集已完成'
  });
  const completedAt = isoNow();
  db.prepare(`UPDATE expert_sync_runs SET status = 'completed', completed_at = ?, error = '',
    result_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(completedAt, stringifyPersistentValue(result || {}), Number(runId));
  return getRun(runId);
}

function failRun(runId, error) {
  const message = cleanText(error && (error.message || error), 2000);
  db.prepare(`UPDATE expert_sync_runs SET status = 'error', completed_at = ?, message = ?, error = ?,
    updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(isoNow(), message, message, Number(runId));
  return getRun(runId);
}

function listRuns(channelId, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 10, 1), 100);
  const rows = db.prepare(`SELECT * FROM expert_sync_runs WHERE channel_id = ?
    ORDER BY datetime(started_at) DESC, id DESC LIMIT ?`).all(Number(channelId), limit);
  const includeItems = options.includeItems === true;
  const itemsByRun = new Map();
  if (includeItems && rows.length) {
    const placeholders = rows.map(function() { return '?'; }).join(', ');
    db.prepare('SELECT * FROM expert_sync_run_items WHERE run_id IN (' + placeholders + ') ORDER BY run_id, id')
      .all(...rows.map(function(row) { return row.id; }))
      .forEach(function(itemRow) {
        const runItems = itemsByRun.get(Number(itemRow.run_id)) || [];
        runItems.push(rowToRunItem(itemRow));
        itemsByRun.set(Number(itemRow.run_id), runItems);
      });
  }
  return rows.map(function(row) {
    const items = includeItems ? itemsByRun.get(Number(row.id)) || [] : undefined;
    return rowToRun(row, items);
  });
}

function getPlanningState(channelId) {
  const rows = db.prepare(`SELECT item.content_id, item.detail_status, item.transcription_status,
      item.updated_at, item.id
    FROM expert_sync_run_items AS item
    JOIN expert_sync_runs AS run ON run.id = item.run_id
    WHERE run.channel_id = ?
    ORDER BY datetime(item.updated_at) DESC, item.id DESC LIMIT 10000`).all(Number(channelId));
  const states = {};
  const stopped = new Set();
  rows.forEach(function(row) {
    const contentId = String(row.content_id || '');
    if (!contentId || stopped.has(contentId)) return;
    const detailStatus = String(row.detail_status || '');
    if (!['complete', 'error', 'rejected'].includes(detailStatus)) return;
    const state = states[contentId] || {
      lastDetailCheckedAt: row.updated_at || '',
      lastFailureAt: '',
      failureCount: 0
    };
    if (detailStatus === 'complete') {
      stopped.add(contentId);
    } else {
      if (!state.lastFailureAt) state.lastFailureAt = row.updated_at || '';
      state.failureCount += 1;
    }
    states[contentId] = state;
  });
  return states;
}

module.exports = {
  ensureJob, getJob, updateSettings, markRunning, updateProgress, updateArchiveCheckpoint, markCompleted, markFailed, listDue, listEnabled,
  startRun, updateRun, upsertRunItem, completeRun, failRun, listRuns, getPlanningState,
  redactSensitiveUrls, sanitizePersistentValue
};
