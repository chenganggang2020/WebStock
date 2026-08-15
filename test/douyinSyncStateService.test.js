const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDbPath = path.join(os.tmpdir(), 'webstock-douyin-sync-state-' + process.pid + '.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
}
process.env.WEBSTOCK_DB_PATH = testDbPath;

const db = require('../db');
const channels = require('../services/expertChannelService');
const syncState = require('../services/douyinSyncStateService');

test.after(() => {
  try { db.close(); } catch (error) {}
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(testDbPath + suffix, { force: true }); } catch (error) {}
  }
});

test('sync audit persists run totals and per-video detail/transcription states', () => {
  const channel = channels.createChannel({
    channelKey: 'douyin-sync-audit-test',
    displayName: '采集审计作者',
    platform: 'douyin',
    profileUrl: 'https://www.douyin.com/user/sync-audit-test'
  });
  const run = syncState.startRun(channel.id, { trigger: 'manual' });
  syncState.updateRun(run.id, { workCount: 368, discoveredCount: 20, candidateCount: 4, message: '正在采集详情' });
  syncState.upsertRunItem(run.id, {
    contentId: '7672552250465095409',
    sourceUrl: 'https://www.douyin.com/video/7672552250465095409',
    title: '测试视频',
    detailStatus: 'complete',
    transcriptionStatus: 'media_missing',
    message: '详情页未提供可下载的 HTTPS 媒体地址'
  });
  syncState.completeRun(run.id, {
    workCount: 368, discoveredCount: 20, candidateCount: 4,
    detailedCount: 3, detailErrors: [{ contentId: '2', message: '身份不匹配' }],
    transcriptionAttemptedCount: 0, transcribedCount: 0, mediaMissingCount: 1,
    transcriptErrors: [], addedCount: 1, updatedCount: 2, unchangedCount: 0
  });

  const runs = syncState.listRuns(channel.id, { limit: 5, includeItems: true });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, 'completed');
  assert.equal(runs[0].trigger, 'manual');
  assert.equal(runs[0].workCount, 368);
  assert.equal(runs[0].candidateCount, 4);
  assert.equal(runs[0].detailedCount, 3);
  assert.equal(runs[0].detailErrorCount, 1);
  assert.equal(runs[0].mediaMissingCount, 1);
  assert.equal(runs[0].items.length, 1);
  assert.equal(runs[0].items[0].detailStatus, 'complete');
  assert.equal(runs[0].items[0].transcriptionStatus, 'media_missing');
  assert.doesNotMatch(JSON.stringify(runs), /token=/);

  const failedRun = syncState.startRun(channel.id, { trigger: 'scheduled' });
  syncState.upsertRunItem(failedRun.id, {
    contentId: '7672552250465095410',
    detailStatus: 'error',
    transcriptionStatus: 'not_ready',
    message: '详情页未返回目标视频数据'
  });
  syncState.failRun(failedRun.id, new Error('本轮未能提取任何视频详情'));
  const failedRuns = syncState.listRuns(channel.id, { limit: 5, includeItems: true });
  assert.equal(failedRuns[0].status, 'error');
  assert.equal(failedRuns[0].error, '本轮未能提取任何视频详情');
  assert.equal(failedRuns[0].items[0].detailStatus, 'error');

  const planning = syncState.getPlanningState(channel.id);
  assert.equal(planning['7672552250465095409'].failureCount, 0);
  assert.ok(planning['7672552250465095409'].lastDetailCheckedAt);
  assert.equal(planning['7672552250465095410'].failureCount, 1);
  assert.ok(planning['7672552250465095410'].lastFailureAt);

  syncState.markRunning(channel.id);
  syncState.updateProgress(channel.id, {
    stage: 'session', message: '逐批扫描', scrollCount: 27, discoveredCount: 160
  });
  syncState.markFailed(channel.id, new Error('扫描中断'));
  const failedJob = syncState.getJob(channel.id);
  assert.equal(failedJob.progress.stage, 'failed');
  assert.equal(failedJob.progress.scrollCount, 27);
  assert.equal(failedJob.progress.discoveredCount, 160);
});

test('check-only completion records available updates without claiming collection work', () => {
  const channel = channels.createChannel({
    channelKey: 'douyin-check-only-state-test',
    displayName: 'check-only creator',
    platform: 'douyin',
    profileUrl: 'https://www.douyin.com/user/check-only-state'
  });
  syncState.ensureJob(channel.id, { enabled: true, intervalMinutes: 10 });
  syncState.updateArchiveCheckpoint(channel.id, {
    scrollCount: 42,
    scrollLimit: 80,
    discoveredCount: 260,
    stoppedReason: 'scroll_limit'
  });
  syncState.markRunning(channel.id);
  syncState.markCompleted(channel.id, {
    archive: { complete: false, discoveredCount: 260, scrollCount: 42, stoppedReason: 'scroll_limit' },
    workCount: 368,
    discoveredCount: 260,
    candidateCount: 0,
    detailedCount: 0,
    transcribedCount: 0
  });
  assert.equal(syncState.getJob(channel.id).lastResult.archiveCheckpoint.scrollCount, 42);
  syncState.markRunning(channel.id);
  syncState.markCompleted(channel.id, {
    checkOnly: true,
    updatesAvailable: true,
    updateCandidateCount: 2,
    workCount: 20,
    discoveredCount: 20,
    candidateCount: 0,
    detailedCount: 0,
    transcribedCount: 0,
    addedCount: 1,
    updatedCount: 1
  });

  const job = syncState.getJob(channel.id);
  assert.equal(job.progress.stage, 'completed');
  assert.equal(job.progress.checkOnly, true);
  assert.equal(job.progress.updatesAvailable, true);
  assert.equal(job.progress.updateCandidateCount, 2);
  assert.equal(job.progress.detailTotal, 0);
  assert.match(job.progress.message, /检查/);
  assert.equal(job.lastResult.archiveCheckpoint.scrollCount, 42);
  assert.equal(job.lastResult.archiveCheckpoint.discoveredCount, 260);
});

test('persistent sync state recursively redacts signed URL queries without losing public paths', () => {
  const signedUrl = 'https://media.example.com/archive/video.mp4?token=top-secret&signature=sig-value#fragment';
  const publicUrl = 'https://www.douyin.com/video/7672552250465095499?from=copy#share';
  const expectedMediaPath = 'https://media.example.com/archive/video.mp4';
  const expectedPublicPath = 'https://www.douyin.com/video/7672552250465095499';

  assert.deepEqual(syncState.sanitizePersistentValue({
    message: '下载失败：' + signedUrl + '，请重试',
    nested: [{ mediaUrl: signedUrl }],
    publicUrl
  }), {
    message: '下载失败：' + expectedMediaPath + '，请重试',
    nested: [{ mediaUrl: expectedMediaPath }],
    publicUrl: expectedPublicPath
  });

  const channel = channels.createChannel({
    channelKey: 'douyin-signed-url-redaction-test',
    displayName: '签名 URL 脱敏作者',
    platform: 'douyin',
    profileUrl: 'https://www.douyin.com/user/signed-url-redaction'
  });

  syncState.ensureJob(channel.id, { enabled: true, intervalMinutes: 10 });
  syncState.markRunning(channel.id);
  syncState.updateProgress(channel.id, {
    stage: 'transcription',
    message: '正在下载 ' + signedUrl,
    current: { mediaUrl: signedUrl }
  });
  syncState.markFailed(channel.id, new Error('采集失败 ' + signedUrl));
  const failedJob = syncState.getJob(channel.id);
  assert.equal(failedJob.lastError, '采集失败 ' + expectedMediaPath);
  assert.equal(failedJob.progress.message, '采集失败 ' + expectedMediaPath);
  assert.equal(failedJob.progress.current.mediaUrl, expectedMediaPath);
  assert.doesNotMatch(JSON.stringify(failedJob), /top-secret|sig-value|token=|signature=/);

  const failedRun = syncState.startRun(channel.id, {
    trigger: 'manual',
    message: '准备载入 ' + signedUrl
  });
  syncState.upsertRunItem(failedRun.id, {
    contentId: '7672552250465095499',
    sourceUrl: publicUrl,
    title: '测试视频',
    detailStatus: 'error',
    transcriptionStatus: 'error',
    message: '下载失败 ' + signedUrl
  });
  syncState.failRun(failedRun.id, new Error('转写失败 ' + signedUrl));
  const persistedFailedRun = syncState.listRuns(channel.id, { limit: 5, includeItems: true })[0];
  assert.equal(persistedFailedRun.error, '转写失败 ' + expectedMediaPath);
  assert.equal(persistedFailedRun.items[0].sourceUrl, expectedPublicPath);
  assert.equal(persistedFailedRun.items[0].message, '下载失败 ' + expectedMediaPath);
  assert.doesNotMatch(JSON.stringify(persistedFailedRun), /top-secret|sig-value|token=|signature=/);

  syncState.markRunning(channel.id);
  syncState.markCompleted(channel.id, {
    workCount: 1,
    nested: {
      mediaUrl: signedUrl,
      errors: [{ message: '详情失败 ' + signedUrl }]
    }
  });
  const completedJob = syncState.getJob(channel.id);
  assert.equal(completedJob.lastResult.nested.mediaUrl, expectedMediaPath);
  assert.equal(completedJob.lastResult.nested.errors[0].message, '详情失败 ' + expectedMediaPath);

  const completedRun = syncState.startRun(channel.id, { trigger: 'archive' });
  syncState.completeRun(completedRun.id, {
    workCount: 1,
    nested: {
      mediaUrl: signedUrl,
      publicUrl,
      errors: [{ message: '存档失败 ' + signedUrl }]
    }
  });
  const persistedCompletedRun = syncState.listRuns(channel.id, { limit: 5 })[0];
  assert.equal(persistedCompletedRun.result.nested.mediaUrl, expectedMediaPath);
  assert.equal(persistedCompletedRun.result.nested.publicUrl, expectedPublicPath);
  assert.equal(persistedCompletedRun.result.nested.errors[0].message, '存档失败 ' + expectedMediaPath);
  assert.doesNotMatch(JSON.stringify({ completedJob, persistedCompletedRun }),
    /top-secret|sig-value|token=|signature=/);
});

test('starting a new run closes stale running audit records from an interrupted process', () => {
  const channel = channels.createChannel({
    channelKey: 'douyin-interrupted-run-recovery-test',
    displayName: '中断续跑测试作者',
    platform: 'douyin',
    profileUrl: 'https://www.douyin.com/user/interrupted-run-recovery'
  });

  const interrupted = syncState.startRun(channel.id, {
    trigger: 'archive',
    message: '正在执行全量扫描'
  });
  syncState.upsertRunItem(interrupted.id, {
    contentId: '7672552250465095999',
    detailStatus: 'complete',
    transcriptionStatus: 'complete',
    message: '本条已保存'
  });

  const resumed = syncState.startRun(channel.id, {
    trigger: 'archive',
    message: '从已保存数据继续'
  });

  const runs = syncState.listRuns(channel.id, { limit: 5, includeItems: true });
  const recovered = runs.find((run) => run.id === interrupted.id);
  assert.equal(resumed.status, 'running');
  assert.equal(recovered.status, 'error');
  assert.ok(recovered.completedAt);
  assert.match(recovered.error, /中断/);
  assert.equal(recovered.items[0].transcriptionStatus, 'complete');
});
