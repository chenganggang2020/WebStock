const { planIncrementalCandidates, discoveryFingerprint, noteProcessingComplete } = require('../services/douyinSyncPlanningService');
const { planFullArchiveQueue, summarizeArchiveQueue } = require('../services/douyinArchiveQueueService');
const { runDouyinVideoTask } = require('./douyinVideoTask');

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

function observationNeedsDetail(observation) {
  if (!observation) return true;
  const hasText = Boolean(String(observation.transcript || observation.content || observation.summary || '').trim());
  const hasPublishedAt = Boolean(String(observation.publishedAt || '').trim());
  const engagement = observation.engagement && typeof observation.engagement === 'object'
    ? observation.engagement : {};
  const mediaMetadata = observation.mediaMetadata && typeof observation.mediaMetadata === 'object'
    ? observation.mediaMetadata : {};
  return !hasText || !hasPublishedAt || !(mediaMetadata.detailCapturedAt || engagement.observedAt);
}

function observationNeedsTranscription(observation) {
  if (observation && observation.mediaType === 'note') return false;
  const mediaMetadata = observation && observation.mediaMetadata && typeof observation.mediaMetadata === 'object'
    ? observation.mediaMetadata : {};
  const hasTranscript = Boolean(String(observation && observation.transcript || '').trim());
  const status = mediaMetadata.asr && mediaMetadata.asr.status;
  if (status === 'no_speech') return false;
  if (status === 'needs_review' && hasTranscript) return false;
  return !mediaMetadata.asr || status !== 'complete' || !hasTranscript;
}

function observationNeedsArchiveBackfill(observation) {
  if (observation && observation.mediaType === 'note') return false;
  const mediaMetadata = observation && observation.mediaMetadata && typeof observation.mediaMetadata === 'object'
    ? observation.mediaMetadata : {};
  const asr = mediaMetadata.asr && typeof mediaMetadata.asr === 'object' ? mediaMetadata.asr : {};
  const archive = mediaMetadata.archive && typeof mediaMetadata.archive === 'object' ? mediaMetadata.archive : {};
  const localAssetPath = String(observation && observation.localAssetPath ||
    archive.localAssetPath || asr.localAssetPath || '').trim();
  return (asr.status === 'complete' || asr.status === 'needs_review') &&
    Boolean(String(observation && observation.transcript || '').trim()) && !localAssetPath;
}

function isDouyinDetailCandidate(observation) {
  const contentId = String(observation && (observation.externalContentId || observation.contentId) || '').trim();
  const sourceUrl = String(observation && observation.sourceUrl || '').trim();
  if (!/^\d{12,24}$/.test(contentId) || !sourceUrl) return false;
  try {
    const parsed = new URL(sourceUrl);
    if (parsed.protocol !== 'https:' || (parsed.hostname !== 'douyin.com' && !parsed.hostname.endsWith('.douyin.com'))) {
      return false;
    }
    const match = parsed.pathname.match(/\/(?:m\/)?(?:video|note)\/(\d{12,24})(?:\/|$)/i);
    return Boolean(match && match[1] === contentId);
  } catch (error) {
    return false;
  }
}

function planArchiveMediaUrls(mediaCandidates, historicalMediaBytes, options = {}) {
  const expectedBytes = Math.max(Math.floor(Number(historicalMediaBytes) || 0), 0);
  const deepRecovery = options.deepRecovery === true;
  const candidates = (Array.isArray(mediaCandidates) ? mediaCandidates : []).map(function(candidate, index) {
    return Object.assign({ index }, candidate || {});
  }).filter(function(candidate) {
    return /^https:\/\//i.test(String(candidate.url || '')) &&
      Number.isFinite(Number(candidate.bytes)) && Number(candidate.bytes) >= 0;
  });
  const exactUrls = [];
  if (expectedBytes > 0) {
    candidates.forEach(function(candidate) {
      const url = String(candidate.url || '');
      if (Number(candidate.bytes) === expectedBytes && !exactUrls.includes(url)) exactUrls.push(url);
    });
  }
  const mediaUrls = exactUrls.slice(0, deepRecovery ? 12 : 2);
  if (deepRecovery && exactUrls.length) {
    const seenRenditions = new Set();
    candidates.filter(function(candidate) {
      return Number(candidate.bytes) !== expectedBytes;
    }).sort(function(left, right) {
      const distance = Math.abs(Number(left.bytes) - expectedBytes) -
        Math.abs(Number(right.bytes) - expectedBytes);
      return distance || left.index - right.index;
    }).forEach(function(candidate) {
      if (seenRenditions.size >= 24) return;
      const renditionKey = [Number(candidate.bytes), String(candidate.source || ''),
        String(candidate.quality || '')].join('|');
      if (seenRenditions.has(renditionKey)) return;
      seenRenditions.add(renditionKey);
      const url = String(candidate.url || '');
      if (url && !mediaUrls.includes(url)) mediaUrls.push(url);
    });
  }
  return { exactCandidateCount: exactUrls.length, mediaUrls };
}

function summarizeObservationCoverage(observations) {
  const videos = (Array.isArray(observations) ? observations : []).filter(function(observation) {
    return observation && observation.externalContentId && observation.mediaType === 'video' &&
      (!observation.evidenceLevel || observation.evidenceLevel === 'primary');
  });
  let transcribedCount = 0;
  let noSpeechCount = 0;
  let unavailableCount = 0;
  let mediaMissingCount = 0;
  let failedTranscriptionCount = 0;
  videos.forEach(function(observation) {
    const metadata = observation.mediaMetadata && typeof observation.mediaMetadata === 'object'
      ? observation.mediaMetadata : {};
    const status = metadata.asr && metadata.asr.status;
    const remoteStatus = metadata.remote && metadata.remote.status;
    if ((status === 'complete' || status === 'needs_review') && String(observation.transcript || '').trim()) {
      transcribedCount += 1;
    }
    else if (status === 'no_speech') noSpeechCount += 1;
    else if (remoteStatus === 'identity_rejected') unavailableCount += 1;
    else if (status === 'error') failedTranscriptionCount += 1;
    else if (status === 'media_missing') mediaMissingCount += 1;
  });
  const pendingTranscriptionCount = Math.max(videos.length - transcribedCount - noSpeechCount -
    unavailableCount - failedTranscriptionCount, 0);
  return {
    videoCount: videos.length,
    transcribedCount,
    noSpeechCount,
    unavailableCount,
    pendingTranscriptionCount,
    mediaMissingCount,
    waitingTranscriptionCount: Math.max(pendingTranscriptionCount - mediaMissingCount, 0),
    failedTranscriptionCount,
    transcriptCoverage: videos.length ? Number((transcribedCount / videos.length).toFixed(4)) : 0
  };
}

function ensureDouyinSyncJobs(channels, syncState, defaults = {}) {
  if (!channels || typeof channels.listChannels !== 'function' || !syncState || typeof syncState.ensureJob !== 'function') {
    return 0;
  }
  const settings = {
    enabled: true,
    intervalMinutes: Math.min(Math.max(Number(defaults.intervalMinutes) || 10, 5), 1440)
  };
  const eligible = channels.listChannels({ limit: 500 }).filter(function(channel) {
    return channel && channel.enabled === true && channel.platform === 'douyin' && Boolean(channel.profileUrl);
  });
  eligible.forEach(function(channel) { syncState.ensureJob(channel.id, settings); });
  return eligible.length;
}

function transcriptionReadiness(transcriber, input = {}) {
  if (!transcriber || typeof transcriber.readiness !== 'function') return { available: true };
  try {
    const result = transcriber.readiness(input);
    return result && typeof result === 'object' ? result : { available: true };
  } catch (error) {
    return { available: false, status: 'runtime_missing', message: error.message || '本地转写环境尚未就绪' };
  }
}

function createDouyinAutoSync(options = {}) {
  const sessionManager = options.sessionManager;
  const channels = options.channels;
  const sources = options.sources;
  const importCapture = (id, capture) => (sources.importCapturedPageAsync || sources.importCapturedPage)(id, capture);
  const syncState = options.syncState;
  const transcriber = options.transcriber || null;
  const noteProcessor = options.noteProcessor || null;
  const log = typeof options.log === 'function' ? options.log : () => {};
  const maxDetailsPerRun = Math.min(Math.max(Number(options.maxDetailsPerRun) || 8, 1), 30);
  const maxTranscriptionsPerRun = Math.min(Math.max(Number(options.maxTranscriptionsPerRun) || 1, 1), 5);
  const pollMs = Math.max(Number(options.pollMs) || 60000, 1000);
  const startupDelayMs = Math.max(Number(options.startupDelayMs) || 15000, 0);
  const setIntervalFn = options.setInterval || setInterval;
  const clearIntervalFn = options.clearInterval || clearInterval;
  const setTimeoutFn = options.setTimeout || setTimeout;
  const running = new Map();
  let interval = null;
  let startupTimer = null;
  let dueTask = null;
  let workQueue = Promise.resolve();
  const videoTasks = new Map();
  let paused = false;
  let stopping = false;
  function enqueue(work) {
    const task = workQueue.then(work);
    workQueue = task.catch(() => {});
    return task;
  }

  if (!sessionManager || typeof sessionManager.captureUrl !== 'function') throw new Error('缺少抖音登录会话采集器');
  if (!channels || !sources || !syncState) throw new Error('缺少抖音自动同步依赖');

  const redactPersistentText = typeof syncState.redactSensitiveUrls === 'function'
    ? syncState.redactSensitiveUrls : redactSensitiveUrls;

  function safeErrorMessage(error) {
    return redactPersistentText(error && (error.message || error) || '未知错误');
  }

  function safeError(error) {
    const sanitized = new Error(safeErrorMessage(error));
    if (error && error.name) sanitized.name = error.name;
    if (error && error.code === 'DOUYIN_LOGIN_REQUIRED') sanitized.code = error.code;
    return sanitized;
  }

  function sessionState(status, channelId) {
    if (typeof options.onSessionState !== 'function') return;
    try {
      Promise.resolve(options.onSessionState({ status, channelId: Number(channelId) }))
        .catch(error => log('Douyin session notice delivery failed', safeError(error)));
    } catch (error) { log('Douyin session notice delivery failed', safeError(error)); }
  }

  function requireCaptureSession(capture, channelId) {
    if (capture && capture.loadError) throw new Error('抖音页面服务异常，请稍后重试；尚不能确认登录状态');
    if (capture && capture.loggedIn === true) return;
    if (capture && capture.loggedIn === false) {
      sessionState('login_required', channelId);
      const error = new Error('抖音登录状态已失效或需要验证，请在采集页面重新登录');
      error.code = 'DOUYIN_LOGIN_REQUIRED';
      throw error;
    }
    throw new Error('抖音页面未返回可核验的登录状态，请稍后重试');
  }

  function reportProgress(channelId, progress) {
    if (typeof syncState.updateProgress === 'function') syncState.updateProgress(channelId, progress);
  }

  function audit(method, ...args) {
    if (!syncState || typeof syncState[method] !== 'function') return null;
    try { return syncState[method](...args); } catch (error) {
      log('Douyin sync audit failed during ' + method, safeError(error));
      return null;
    }
  }

  function collectionObservations(channelId) {
    return typeof channels.listCollectionObservations === 'function'
      ? channels.listCollectionObservations(channelId)
      : channels.listObservations(channelId, { limit: 1000 });
  }

  async function syncChannel(channelId, runOptions = {}) {
    if (stopping) throw new Error('Background collection is stopping');
    const id = Number(channelId);
    if (running.has(id)) {
      if (runOptions.mode === 'archive') throw new Error('该创作者已有采集任务运行中，请完成后再启动完整清单扫描');
      return running.get(id);
    }
    const task = enqueue(async function() {
      if (stopping) throw new Error('Background collection is stopping');
      let runId = 0;
      const checkOnly = runOptions.mode === 'check';
      const priorJob = typeof syncState.getJob === 'function' ? syncState.getJob(id) : null;
      syncState.markRunning(id);
      try {
        const startedRun = audit('startRun', id, {
          trigger: runOptions.trigger || 'scheduled',
          message: '正在检查登录会话'
        });
        runId = Number(startedRun && startedRun.id || 0);
        const channel = channels.getChannel(id);
        const acceptsMedia = item => !channel.collectionMediaType || channel.collectionMediaType === 'all' ||
          (item.mediaType || (/\/note\//.test(item.sourceUrl || '') ? 'note' : 'video')) === channel.collectionMediaType;
        if (channel.platform !== 'douyin') throw new Error('自动同步仅支持抖音创作者频道');
        if (!channel.profileUrl) throw new Error('研究对象尚未配置抖音主页');
        reportProgress(id, { stage: 'session', message: '正在检查登录会话和创作者主页' });
        const reanalysis = !checkOnly && typeof sources.reanalyzeChannelObservations === 'function'
          ? sources.reanalyzeChannelObservations(id) : { updatedCount: 0 };
        let batchedDiscoveryResult = null;
        let archiveOptions = runOptions.archiveOptions || {};
        if (runOptions.mode === 'archive') {
          const previousJob = priorJob;
          const previousArchive = previousJob && previousJob.lastResult &&
            (previousJob.lastResult.archiveCheckpoint || previousJob.lastResult.archive) || {};
          const interruptedScrollCount = Number(previousJob && previousJob.progress && previousJob.progress.scrollCount || 0) ||
            (previousArchive.complete === false ? Number(previousArchive.scrollCount || 0) : 0);
          const baseScrollLimit = Math.min(Math.max(Number(archiveOptions.maxScrolls) || 80, 1), 400);
          const continuedScrollLimit = previousArchive.stoppedReason === 'scroll_limit'
            ? Math.min(Math.max(Number(previousArchive.scrollLimit) || baseScrollLimit, baseScrollLimit) + 80, 400)
            : interruptedScrollCount
              ? Math.min(Math.max(interruptedScrollCount + 80, baseScrollLimit), 400)
              : baseScrollLimit;
          archiveOptions = Object.assign({}, archiveOptions, {
            maxScrolls: continuedScrollLimit,
            async onBatch(batchCapture) {
              requireCaptureSession(batchCapture, id);
              const batchIdentity = sources.verifyCapturedIdentity(id, batchCapture);
              if (!batchIdentity.matched) throw new Error('抖音主页身份与研究对象不一致，本轮不会入库');
              sessionState('authenticated', id);
              const batch = await importCapture(id, batchCapture);
              if (!batchedDiscoveryResult) {
                batchedDiscoveryResult = { addedCount: 0, updatedCount: 0, unchangedCount: 0, items: [] };
              }
              batchedDiscoveryResult.addedCount += Number(batch.addedCount || 0);
              batchedDiscoveryResult.updatedCount += Number(batch.updatedCount || 0);
              batchedDiscoveryResult.unchangedCount += Number(batch.unchangedCount || 0);
              batchedDiscoveryResult.items.push(...(batch.items || []));
              reportProgress(id, {
                stage: 'session',
                message: '正在滚动扫描并逐批保存公开作品清单',
                discoveredCount: Number(batchCapture.archive && batchCapture.archive.discoveredCount || 0),
                scrollCount: Number(batchCapture.archive && batchCapture.archive.scrollCount || 0),
                addedCount: batchedDiscoveryResult.addedCount
              });
              audit('updateRun', runId, {
                discoveredCount: Number(batchCapture.archive && batchCapture.archive.discoveredCount || 0),
                addedCount: batchedDiscoveryResult.addedCount,
                updatedCount: batchedDiscoveryResult.updatedCount,
                unchangedCount: batchedDiscoveryResult.unchangedCount,
                message: '正在滚动扫描并逐批保存公开作品清单'
              });
              audit('updateArchiveCheckpoint', id, batchCapture.archive || {});
            }
          });
        }
        const profileCapture = runOptions.mode === 'archive' && typeof sessionManager.captureProfileArchive === 'function'
          ? await sessionManager.captureProfileArchive(channel.profileUrl, archiveOptions)
          : typeof sessionManager.captureProfileRecent === 'function'
            ? await sessionManager.captureProfileRecent(channel.profileUrl)
            : await sessionManager.captureUrl(channel.profileUrl);
        if (runOptions.mode === 'archive' && profileCapture && profileCapture.archive) {
          audit('updateArchiveCheckpoint', id, profileCapture.archive);
        }
        requireCaptureSession(profileCapture, id);
        if (!profileCapture.profile || !profileCapture.profile.profileUrl || !profileCapture.items.length) {
          throw new Error('抖音主页尚未加载出作品列表，本轮不会记为成功');
        }
        const profileIdentity = sources.verifyCapturedIdentity(id, profileCapture);
        if (!profileIdentity.matched) throw new Error('抖音主页身份与研究对象不一致，本轮不会入库');
        sessionState('authenticated', id);
        if (checkOnly) {
          if (typeof sources.inspectCapturedPage !== 'function') {
            throw new Error('当前采集服务不支持只读更新检查');
          }
          const inspection = sources.inspectCapturedPage(id, profileCapture);
          const updateCandidates = Array.isArray(inspection.candidates) ? inspection.candidates : [];
          const updateCandidateCount = updateCandidates.length;
          audit('updateRun', runId, {
            workCount: Number(profileCapture.profile && profileCapture.profile.workCount || 0),
            discoveredCount: profileCapture.items.length,
            candidateCount: 0,
            addedCount: Number(inspection.addedCount || 0),
            updatedCount: Number(inspection.updatedCount || 0),
            unchangedCount: Number(inspection.unchangedCount || 0),
            message: updateCandidateCount
              ? '更新检查完成，发现 ' + updateCandidateCount + ' 条新增或变化，等待手动采集'
              : '更新检查完成，未发现新增或实质变化'
          });
          updateCandidates.forEach(function(item) {
            audit('upsertRunItem', runId, {
              contentId: item.externalContentId || item.contentId,
              sourceUrl: item.sourceUrl,
              title: item.title,
              detailStatus: 'detected',
              transcriptionStatus: 'not_started',
              message: item.changeType === 'updated' ? '检测到实质变化，等待手动采集' : '检测到新增作品，等待手动采集'
            });
          });
          const result = {
            channelId: id,
            pageUrl: profileCapture.pageUrl,
            workCount: Number(profileCapture.profile && profileCapture.profile.workCount || 0),
            discoveredCount: profileCapture.items.length,
            checkOnly: true,
            updatesAvailable: updateCandidateCount > 0,
            updateCandidateCount,
            candidateCount: 0,
            discoveryAddedCount: Number(inspection.addedCount || 0),
            discoveryUpdatedCount: Number(inspection.updatedCount || 0),
            discoveryUnchangedCount: Number(inspection.unchangedCount || 0),
            reanalyzedCount: 0,
            detailedCount: 0,
            addedCount: Number(inspection.addedCount || 0),
            updatedCount: Number(inspection.updatedCount || 0),
            unchangedCount: Number(inspection.unchangedCount || 0),
            transcribedCount: 0,
            archivedCount: 0,
            transcriptionAttemptedCount: 0,
            mediaMissingCount: 0,
            detailErrors: [],
            transcriptErrors: [],
            archiveErrors: [],
            coverage: summarizeObservationCoverage(collectionObservations(id))
          };
          reportProgress(id, {
            stage: 'saving',
            message: updateCandidateCount
              ? '已发现更新，仅记录检查结果；等待手动采集'
              : '未发现更新，正在保存检查结果',
            workCount: result.workCount,
            discoveredCount: result.discoveredCount,
            detailTotal: 0,
            detailedCount: 0,
            transcribedCount: 0,
            updateCandidateCount
          });
          audit('completeRun', runId, result);
          syncState.markCompleted(id, result);
          return result;
        }
        const beforeDiscovery = new Map(collectionObservations(id)
          .map(item => [String(item.externalContentId || ''), item]));
        const discoveryResult = batchedDiscoveryResult || await importCapture(id, profileCapture);
        const existing = collectionObservations(id);
        (discoveryResult.items || []).forEach(function(item) {
          if (!existing.some(function(current) { return String(current.externalContentId) === String(item.externalContentId); })) {
            existing.push(item);
          }
        });
        const existingByContentId = new Map(existing.map(item => [String(item.externalContentId || ''), item]));
        const visibleByContentId = new Map(profileCapture.items.map(function(item) {
          return [String(item.contentId || ''), item];
        }));
        const metadataUpdates = [];
        const planningObservations = profileCapture.items.map(function(item) {
          const previous = beforeDiscovery.get(String(item.contentId));
          const observation = existingByContentId.get(String(item.contentId)) || {};
          const metadata = Object.assign({}, observation.mediaMetadata || {});
          const fingerprint = discoveryFingerprint(item);
          const changed = previous && previous.mediaMetadata && previous.mediaMetadata.discoveryFingerprint &&
            previous.mediaMetadata.discoveryFingerprint !== fingerprint;
          if (!previous || changed) {
            metadata.incrementalPending = true;
            metadata.incrementalReason = previous ? 'changed' : 'new';
          }
          metadata.discoveryFingerprint = fingerprint;
          if (typeof channels.recordObservation === 'function' && observation.externalKey &&
              JSON.stringify(metadata) !== JSON.stringify(observation.mediaMetadata || {})) {
            const patch = Object.fromEntries(Object.entries(metadata).filter(([key, value]) =>
              JSON.stringify(value) !== JSON.stringify((observation.mediaMetadata || {})[key])));
            metadataUpdates.push({ externalKey: observation.externalKey, mediaMetadataPatch: patch });
          }
          return Object.assign({}, observation, item, {
            mediaMetadata: metadata,
            externalContentId: item.contentId
          });
        });
        if (channels.recordObservationsAsync) await channels.recordObservationsAsync(id, metadataUpdates);
        else for (const update of metadataUpdates) {
          const observation = existing.find(item => item.externalKey === update.externalKey);
          channels.recordObservation(id, { externalKey: update.externalKey,
            mediaMetadata: { ...observation?.mediaMetadata, ...update.mediaMetadataPatch } });
        }
        existing.forEach(function(observation) {
          if (!visibleByContentId.has(String(observation.externalContentId || ''))) planningObservations.push(observation);
        });
        const directPlanningObservations = planningObservations.filter(isDouyinDetailCandidate).filter(acceptsMedia);
        const planningState = typeof syncState.getPlanningState === 'function'
          ? syncState.getPlanningState(id) : {};
        const archivePlanningObservations = runOptions.mode === 'archive'
          ? directPlanningObservations.map(function(observation) {
            if (observation.mediaType || !/\/video\/\d{12,24}(?:\/|$)/i.test(String(observation.sourceUrl || ''))) {
              return observation;
            }
            return Object.assign({}, observation, { mediaType: 'video' });
          })
          : directPlanningObservations;
        const archiveQueueBefore = runOptions.mode === 'archive'
          ? summarizeArchiveQueue(archivePlanningObservations) : null;
        const allPlanned = runOptions.mode === 'archive'
          ? planFullArchiveQueue(archivePlanningObservations, planningState)
          : planIncrementalCandidates(directPlanningObservations, planningState, {
            limit: maxDetailsPerRun,
            transcriptionReady: transcriptionReadiness(transcriber, {
              model: runOptions.model,
              provider: runOptions.model ? 'local' : undefined
            }).available,
          });
        const planned = runOptions.detailLimit
          ? allPlanned.slice(0, Math.min(Math.max(Number(runOptions.detailLimit) || 5, 1), 30)) : allPlanned;
        const plannedReasonByContentId = new Map(planned.map(function(entry) {
          return [String(entry.contentId), entry.reason];
        }));
        const candidates = planned.map(function(entry) {
          return visibleByContentId.get(String(entry.contentId)) || {
            contentId: entry.contentId,
            sourceUrl: entry.observation.sourceUrl,
            title: entry.observation.title
          };
        }).filter(function(item) { return item && item.contentId && item.sourceUrl; });
        audit('updateRun', runId, {
          workCount: Number(profileCapture.profile && profileCapture.profile.workCount || 0),
          discoveredCount: profileCapture.items.length,
          candidateCount: candidates.length,
          message: candidates.length ? '已发现作品，准备采集详情' : '主页检查完成，暂无待处理视频'
        });
        candidates.forEach(function(item) {
          audit('upsertRunItem', runId, {
            contentId: item.contentId,
            sourceUrl: item.sourceUrl,
            title: item.title,
            detailStatus: 'pending',
            transcriptionStatus: 'not_ready',
            message: '等待采集详情'
          });
        });
        reportProgress(id, {
          stage: 'processing',
          message: candidates.length ? '已发现作品，准备采集详情' : '主页检查完成，暂无待处理视频',
          discoveredCount: profileCapture.items.length,
          detailTotal: candidates.length,
          detailedCount: 0,
          transcribedCount: 0
        });
        const discoveryAddedCount = Number(discoveryResult.addedCount || 0);
        const discoveryUpdatedCount = Number(discoveryResult.updatedCount || 0);
        const discoveryUnchangedCount = Number(discoveryResult.unchangedCount || 0);
        let addedCount = discoveryAddedCount;
        let updatedCount = discoveryUpdatedCount;
        let unchangedCount = discoveryUnchangedCount;
        let detailedCount = 0;
        let transcribedCount = 0;
        let transcriptionDeferredCount = 0;
        let archivedCount = 0;
        let transcriptionAttemptedCount = 0;
        let mediaMissingCount = 0;
        const detailErrors = [];
        const transcriptErrors = [];
        const archiveErrors = [];
        let processedCount = 0;
        const transcriptionLimit = runOptions.mode === 'archive'
          ? candidates.length : maxTranscriptionsPerRun;

        let remainingCount = candidates.length;
        for (const item of candidates) {
          if (stopping) break; // Finish and persist this video, not the entire remaining archive.
          remainingCount--;
          try {
            audit('upsertRunItem', runId, {
              contentId: item.contentId,
              detailStatus: 'running',
              message: '正在加载详情页'
            });
            const plannedReason = plannedReasonByContentId.get(String(item.contentId));
            const shouldProbeMedia = ['new', 'transcription_pending', 'archive_pending'].includes(plannedReason);
            const detailCapture = shouldProbeMedia
              ? await sessionManager.captureUrl(item.sourceUrl, { preferMediaUrl: true })
              : await sessionManager.captureUrl(item.sourceUrl);
            requireCaptureSession(detailCapture, id);
            const currentItem = detailCapture.items.find(detail => String(detail.contentId) === String(item.contentId));
            if (!currentItem) throw new Error('详情页未返回目标视频数据');
            const persistedItem = Object.assign({}, item, currentItem, {
              engagement: Object.assign({}, item.engagement || {}, currentItem.engagement || {})
            });
            delete persistedItem.mediaUrl;
            delete persistedItem.mediaCandidates;
            const persistedDetailCapture = Object.assign({}, detailCapture, { items: [persistedItem] });
            delete persistedDetailCapture.mediaUrl;
            delete persistedDetailCapture.mediaCandidates;
            const detailIdentity = sources.verifyCapturedIdentity(id, persistedDetailCapture);
            if (!detailIdentity.matched) throw new Error('详情页作者身份与研究对象不一致');
            sessionState('authenticated', id);
            const detailResult = await importCapture(id, persistedDetailCapture);
            addedCount += Number(detailResult.addedCount || 0);
            updatedCount += Number(detailResult.updatedCount || 0);
            unchangedCount += Number(detailResult.unchangedCount || 0);
            detailedCount += 1;
            const saved = (detailResult.items || []).find(function(observation) {
              return String(observation.externalContentId || '') === String(item.contentId);
            });
            const needsTranscription = transcriber && observationNeedsTranscription(saved);
            const transcriptionSetup = needsTranscription
              ? transcriptionReadiness(transcriber, {model:runOptions.model, provider:runOptions.model ? 'local' : undefined})
              : { available: true };
            const hasLocalArchive = Boolean(saved && (saved.localAssetPath ||
              saved.mediaMetadata && saved.mediaMetadata.archive && saved.mediaMetadata.archive.localAssetPath ||
              saved.mediaMetadata && saved.mediaMetadata.asr && saved.mediaMetadata.asr.localAssetPath));
            const needsArchiveBackfill = Boolean(transcriber && typeof transcriber.archive === 'function' &&
              observationNeedsArchiveBackfill(saved));
            const historicalMediaSha256 = needsArchiveBackfill
              ? String(saved.mediaMetadata.asr.mediaSha256 || '').toLowerCase() : '';
            const hasHistoricalHash = /^[a-f0-9]{64}$/i.test(historicalMediaSha256);
            const archiveVerificationMode = hasHistoricalHash ? 'historical_sha256' : 'current_content_id';
            const historicalMediaBytes = needsArchiveBackfill
              ? Math.max(Math.floor(Number(saved.mediaMetadata.asr.mediaBytes) || 0), 0) : 0;
            const mediaCandidates = Array.isArray(currentItem.mediaCandidates)
              ? currentItem.mediaCandidates.filter(function(candidate) {
                return candidate && /^https:\/\//i.test(String(candidate.url || '')) &&
                  Number.isFinite(Number(candidate.bytes)) && Number(candidate.bytes) >= 0;
              }) : [];
            const archiveMediaPlan = hasHistoricalHash
              ? planArchiveMediaUrls(mediaCandidates, historicalMediaBytes, {
                deepRecovery: runOptions.mode === 'archive'
              })
              : {
                exactCandidateCount: 0,
                mediaUrls: [currentItem.mediaUrl].concat(mediaCandidates.map(function(candidate) { return candidate.url; }))
                  .filter(function(url, index, urls) {
                    return /^https:\/\//i.test(String(url || '')) && urls.indexOf(url) === index;
                  }).slice(0, 3)
              };
            const archiveMediaUrls = archiveMediaPlan.mediaUrls;
            const archiveMediaUrl = archiveMediaUrls[0] || '';
            audit('upsertRunItem', runId, {
              contentId: item.contentId,
              detailStatus: 'complete',
              transcriptionStatus: needsArchiveBackfill ? 'archive_pending' : needsTranscription ? 'waiting_media' : 'complete',
              message: needsArchiveBackfill ? '逐字稿已存在，正在回填永久视频归档'
                : needsTranscription ? '详情已保存，正在检查媒体地址' : '详情已保存，逐字稿已完成'
            });
            if (saved && saved.mediaType === 'note') {
              try {
                if (!noteProcessor) throw new Error('图文识别服务尚未启动');
                const noteResult = await noteProcessor.process({channelId:id,contentId:item.contentId,
                  images:currentItem.images,imageCount:currentItem.imageCount,
                  onProgress(progress) { audit('upsertRunItem',runId,{contentId:item.contentId,
                    detailStatus:'complete',transcriptionStatus:'ocr',message:progress.message}); }});
                sources.applyNoteResult(id,item.contentId,noteResult);
                if (noteResult.status==='partial') archiveErrors.push({contentId:item.contentId,message:'图文有图片未完成归档或识别'});
                else archivedCount += 1;
                audit('upsertRunItem',runId,{contentId:item.contentId,detailStatus:'complete',
                  transcriptionStatus:noteResult.status==='partial'?'ocr_partial':noteResult.status==='no_text'?'no_text':'ocr_complete',
                  message:noteResult.status==='partial'?'图文部分处理，原图和已识别文字已保存'
                    :noteResult.status==='no_text'?'原图已保存，未识别到文字':'图文原图已保存，图片文字识别完成'});
              } catch (error) {
                const message=safeErrorMessage(error);
                archiveErrors.push({contentId:item.contentId,message});
                audit('upsertRunItem',runId,{contentId:item.contentId,detailStatus:'complete',transcriptionStatus:'ocr_error',message});
              }
            } else if (needsArchiveBackfill && !archiveMediaUrl && !hasLocalArchive) {
              const message = mediaCandidates.length
                ? historicalMediaBytes
                  ? '详情页媒体候选中没有与历史记录 ' + historicalMediaBytes + ' 字节数精确匹配的版本，已停止归档以避免下载其他清晰度'
                  : '历史记录缺少有效媒体字节数，无法安全选择详情页媒体候选'
                : '详情页未提供可用于历史归档回填的 HTTPS 媒体地址';
              archiveErrors.push({ contentId: item.contentId, message });
              audit('upsertRunItem', runId, {
                contentId: item.contentId,
                detailStatus: 'complete',
                transcriptionStatus: 'archive_missing',
                message
              });
            } else if (needsArchiveBackfill) {
              try {
                const archive = await transcriber.archive({
                  mediaUrl: archiveMediaUrl,
                  mediaUrls: archiveMediaUrls,
                  contentId: item.contentId,
                  expectedSha256: hasHistoricalHash ? historicalMediaSha256 : '',
                  onArchived(evidence) {
                    if (typeof sources.applyMediaArchive !== 'function') {
                      throw new Error('媒体已归档，但采集服务无法写入本地归档证据');
                    }
                    sources.applyMediaArchive(id, item.contentId, Object.assign({}, evidence, {
                      verificationMode: archiveVerificationMode
                    }));
                  },
                  onProgress(progress) {
                    audit('upsertRunItem', runId, {
                      contentId: item.contentId,
                      detailStatus: 'complete',
                      transcriptionStatus: progress.stage === 'archived' ? 'archive_complete' : 'archiving',
                      message: redactPersistentText(progress.message || '正在回填永久视频归档'),
                      mediaBytes: progress.mediaBytes
                    });
                  }
                });
                archivedCount += 1;
                audit('upsertRunItem', runId, {
                  contentId: item.contentId,
                  detailStatus: 'complete',
                  transcriptionStatus: 'archive_complete',
                  message: hasHistoricalHash
                    ? '历史视频已通过 SHA-256 校验并永久归档'
                    : '已按当前作品身份永久归档，并记录新的 SHA-256；未声称与历史媒体逐字节一致',
                  mediaBytes: archive.mediaBytes
                });
              } catch (error) {
                const message = safeErrorMessage(error);
                archiveErrors.push({ contentId: item.contentId, message });
                audit('upsertRunItem', runId, {
                  contentId: item.contentId,
                  detailStatus: 'complete',
                  transcriptionStatus: 'archive_error',
                  message
                });
                log('Douyin archive backfill failed for ' + item.contentId, safeError(error));
              }
            } else if (needsTranscription && !archiveMediaUrl && !hasLocalArchive) {
              const message = '详情页未提供可下载的 HTTPS 媒体地址';
              mediaMissingCount += 1;
              if (typeof sources.recordTranscriptionUnavailable === 'function') {
                sources.recordTranscriptionUnavailable(id, item.contentId, message);
              }
              audit('upsertRunItem', runId, {
                contentId: item.contentId,
                detailStatus: 'complete',
                transcriptionStatus: 'media_missing',
                message
              });
            } else if (needsTranscription && !transcriptionSetup.available) {
              transcriptionDeferredCount += 1;
              audit('upsertRunItem', runId, {
                contentId: item.contentId,
                detailStatus: 'complete',
                transcriptionStatus: transcriptionSetup.status || 'runtime_missing',
                message: transcriptionSetup.message || '本地转写环境尚未就绪；视频详情已保存，等待环境就绪后继续'
              });
            } else if (needsTranscription && transcriptionAttemptedCount >= transcriptionLimit) {
              audit('upsertRunItem', runId, {
                contentId: item.contentId,
                detailStatus: 'complete',
                transcriptionStatus: 'deferred_limit',
                message: '本轮转写额度已满，等待下次采集'
              });
            } else if (needsTranscription) {
              transcriptionAttemptedCount += 1;
              try {
                const transcription = await transcriber.transcribe({
                  model: runOptions.model,
                  provider: runOptions.model ? 'local' : undefined,
                  durationSeconds: Number(currentItem.durationSeconds || saved && saved.mediaMetadata && saved.mediaMetadata.durationSeconds || 0),
                  mediaUrl: archiveMediaUrl,
                  mediaUrls: archiveMediaUrls,
                  contentId: item.contentId,
                  prompt: [currentItem.title, currentItem.summary].concat(currentItem.hashtags || []).filter(Boolean).join('；'),
                  onArchived(archive) {
                    if (typeof sources.applyMediaArchive !== 'function') {
                      throw new Error('媒体已归档，但采集服务无法写入本地归档证据');
                    }
                    sources.applyMediaArchive(id, item.contentId, archive);
                    if (!hasLocalArchive) archivedCount += 1;
                  },
                  onProgress(progress) {
                    reportProgress(id, {stage:'processing', message:progress.message || '正在本地语音识别',
                      discoveredCount:profileCapture.items.length, detailTotal:candidates.length, detailedCount,
                      transcribedCount, archivedCount});
                    audit('upsertRunItem', runId, {
                      contentId: item.contentId,
                      detailStatus: 'complete',
                      transcriptionStatus: progress.stage || 'transcribing',
                      message: redactPersistentText(progress.message || '正在本地语音识别'),
                      mediaBytes: progress.mediaBytes,
                      elapsedSeconds: progress.elapsedSeconds
                    });
                  }
                });
                const noSpeech = transcription.status === 'no_speech';
                if (noSpeech) {
                  if (typeof sources.applyNoSpeechResult !== 'function') {
                    throw new Error('视频已归档且未检测到可识别语音，但采集服务无法保存该终态。');
                  }
                  sources.applyNoSpeechResult(id, item.contentId, transcription);
                } else {
                  sources.applyTranscription(id, item.contentId, transcription);
                  transcribedCount += 1;
                }
                audit('upsertRunItem', runId, {
                  contentId: item.contentId,
                  detailStatus: 'complete',
                  transcriptionStatus: noSpeech ? 'no_speech' : transcription.status,
                  message: noSpeech ? '视频已永久归档，未检测到可识别语音'
                    : transcription.status === 'needs_review' ? '本地语音识别完成，低置信度片段等待复核'
                      : '本地语音识别完成',
                  mediaBytes: transcription.mediaBytes,
                  elapsedSeconds: transcription.elapsedSeconds
                });
              } catch (error) {
                const message = safeErrorMessage(error);
                const sanitizedError = safeError(error);
                transcriptErrors.push({ contentId: item.contentId, message });
                if (typeof sources.recordTranscriptionError === 'function') {
                  sources.recordTranscriptionError(id, item.contentId, sanitizedError);
                }
                audit('upsertRunItem', runId, {
                  contentId: item.contentId,
                  detailStatus: 'complete',
                  transcriptionStatus: 'error',
                  message
                });
                log('Douyin transcription failed for ' + item.contentId, sanitizedError);
              }
            }
          } catch (error) {
            const message = safeErrorMessage(error);
            const identityRejected = /身份.*不一致/.test(message);
            detailErrors.push({ contentId: item.contentId, message });
            if (identityRejected && typeof sources.recordRemoteUnavailable === 'function') {
              sources.recordRemoteUnavailable(id, item.contentId, safeError(error), 1, {
                reason: 'identity_rejected'
              });
            }
            audit('upsertRunItem', runId, {
              contentId: item.contentId,
              detailStatus: identityRejected ? 'rejected' : 'error',
              transcriptionStatus: 'not_ready',
              message
            });
            log('Douyin detail capture failed for ' + item.contentId, safeError(error));
            if (error.code === 'DOUYIN_LOGIN_REQUIRED') throw error;
          }
          processedCount += 1;
          reportProgress(id, {
            stage: 'processing',
            message: '正在处理第 ' + processedCount + ' / ' + candidates.length + ' 条视频',
            discoveredCount: profileCapture.items.length,
            detailTotal: candidates.length,
            detailedCount,
            transcribedCount,
            archivedCount,
            detailErrorCount: detailErrors.length,
            transcriptErrorCount: transcriptErrors.length
          });
          audit('updateRun', runId, {
            detailedCount,
            detailErrorCount: detailErrors.length,
            transcriptionAttemptedCount,
            transcribedCount,
            mediaMissingCount,
            transcriptErrorCount: transcriptErrors.length,
            addedCount,
            updatedCount,
            unchangedCount,
            message: '正在处理第 ' + processedCount + ' / ' + candidates.length + ' 条视频'
          });
        }

        if (!stopping && candidates.length && detailedCount === 0) {
          throw new Error('发现作品链接，但本轮未能提取任何身份匹配的视频详情');
        }

        const finalObservations = collectionObservations(id);
        finalObservations.forEach(function(observation) {
          const metadata = observation.mediaMetadata || {};
          if (metadata.incrementalPending && (observation.mediaType === 'note' ? noteProcessingComplete(observation) : !observationNeedsTranscription(observation)) &&
              !detailErrors.some(item => String(item.contentId) === String(observation.externalContentId)) &&
              typeof channels.recordObservation === 'function') {
            channels.recordObservation(id, { externalKey: observation.externalKey,
              mediaMetadata: Object.assign({}, metadata, { incrementalPending: false, incrementalReason: '' }) });
          }
        });
        const coverage = summarizeObservationCoverage(finalObservations);
        const result = {
          channelId: id,
          pageUrl: profileCapture.pageUrl,
          workCount: Number(profileCapture.profile && profileCapture.profile.workCount || 0),
          discoveredCount: profileCapture.items.length,
          candidateCount: candidates.length,
          interrupted: stopping && remainingCount > 0,
          remainingCount,
          archive: profileCapture.archive || null,
          discoveryAddedCount,
          discoveryUpdatedCount,
          discoveryUnchangedCount,
          reanalyzedCount: Number(reanalysis.updatedCount || 0),
          detailedCount,
          addedCount,
          updatedCount,
          unchangedCount,
          transcribedCount,
          transcriptionDeferredCount,
          archivedCount,
          transcriptionAttemptedCount,
          mediaMissingCount,
          detailErrors,
          transcriptErrors,
          archiveErrors,
          coverage,
          archiveQueue: runOptions.mode === 'archive'
            ? {
              before: archiveQueueBefore,
              after: summarizeArchiveQueue(finalObservations.filter(acceptsMedia))
            }
            : null
        };
        reportProgress(id, {
          stage: 'saving',
          message: '正在保存本轮采集结果',
          discoveredCount: profileCapture.items.length,
          detailTotal: candidates.length,
          detailedCount,
          transcribedCount
        });
        audit('completeRun', runId, result);
        syncState.markCompleted(id, result);
        return result;
      } catch (error) {
        const sanitizedError = safeError(error);
        audit('failRun', runId, sanitizedError);
        syncState.markFailed(id, sanitizedError);
        throw sanitizedError;
      }
    });
    running.set(id, task);
    const clearRunning = function() {
      if (running.get(id) === task) running.delete(id);
    };
    task.then(clearRunning, clearRunning);
    return task;
  }

  function runDue(trigger = 'scheduled') {
    if (stopping) return Promise.resolve({ skipped: true, reason: 'stopping' });
    if (paused) return Promise.resolve({ skipped: true, reason: 'paused' });
    if (dueTask) return Promise.resolve({ skipped: true, reason: 'poll_in_progress' });
    const task = (async function() {
      ensureDouyinSyncJobs(channels, syncState);
      const jobs = syncState.listDue ? syncState.listDue() : [];
      for (const job of jobs) {
        if (stopping) break;
        if (typeof options.shouldDeferChannel === 'function' && options.shouldDeferChannel(job.channelId)) continue;
        if (channels.getChannel(job.channelId).enabled === false) continue;
        if (running.has(Number(job.channelId))) continue;
        try { await syncChannel(job.channelId, { trigger }); } catch (error) {
          log('Scheduled Douyin sync failed for channel ' + job.channelId, safeError(error));
        }
      }
      return { skipped: false, checkedCount: jobs.length };
    })();
    dueTask = task;
    const clearDueTask = function() {
      if (dueTask === task) dueTask = null;
    };
    task.then(clearDueTask, clearDueTask);
    return task;
  }

  async function syncAll() {
    const jobs = syncState.listEnabled ? syncState.listEnabled() : [];
    const items = [];
    for (const job of jobs) {
      if (stopping) break;
      try {
        const result = await syncChannel(job.channelId, { trigger: 'manual' });
        items.push({ channelId: Number(job.channelId), result });
      } catch (error) {
        items.push({ channelId: Number(job.channelId), error: safeErrorMessage(error) });
      }
    }
    return {
      attemptedCount: items.length,
      succeededCount: items.filter(function(item) { return !item.error; }).length,
      failedCount: items.filter(function(item) { return Boolean(item.error); }).length,
      items
    };
  }

  function runVideo(channelId, observationId, stage, settings = {}) {
    if (stopping) return Promise.reject(new Error('Background collection is stopping'));
    const key = Number(channelId) + ':' + Number(observationId) + ':' + stage;
    if (videoTasks.has(key)) return videoTasks.get(key);
    const task = enqueue(async function() {
      if (stopping) throw new Error('Background collection is stopping');
      const observation = channels.getObservation(channelId, observationId);
      syncState.markRunning(channelId);
      const run = audit('startRun', channelId, { trigger: 'video-' + stage, message: '单视频操作：' + stage });
      const runId = run && run.id;
      const update = function(progress) {
        reportProgress(channelId, { stage: 'processing', message: '单视频：' + (progress.message || stage) });
        audit('upsertRunItem', runId, { contentId: observation.externalContentId,
          title: observation.title, sourceUrl: observation.sourceUrl, detailStatus: 'running',
          transcriptionStatus: stage === 'transcribe' ? progress.stage : 'not_requested',
          message: safeErrorMessage(progress.message || stage) });
      };
      try {
        const checkedSession = { async captureUrl(...args) {
          const capture = await sessionManager.captureUrl(...args);
          requireCaptureSession(capture, channelId);
          if (sources.verifyCapturedIdentity(channelId, capture).matched) sessionState('authenticated', channelId);
          return capture;
        } };
        const result = await runDouyinVideoTask({ channels, sources, sessionManager: checkedSession, transcriber, noteProcessor },
          channelId, observationId, stage, update, settings);
        audit('upsertRunItem', runId, { contentId: observation.externalContentId, detailStatus: 'complete',
          transcriptionStatus: result.transcriptionStatus || (stage === 'transcribe' ? 'complete' : 'not_requested'), message: '单视频操作完成' });
        audit('completeRun', runId, result);
        syncState.markCompleted(channelId, result);
        return result;
      } catch (error) {
        audit('upsertRunItem', runId, { contentId: observation.externalContentId, detailStatus: 'error',
          transcriptionStatus: stage === 'transcribe' ? 'error' : 'not_requested', message: safeErrorMessage(error) });
        audit('failRun', runId, safeError(error));
        syncState.markFailed(channelId, safeError(error));
        throw safeError(error);
      }
    });
    videoTasks.set(key, task);
    const clear = () => videoTasks.delete(key);
    task.then(clear, clear);
    return task;
  }

  function start() {
    if (interval) return;
    stopping = false;
    startupTimer = setTimeoutFn(function() { runDue('startup').catch(error => log('Initial Douyin sync failed', error)); }, startupDelayMs);
    interval = setIntervalFn(function() { runDue().catch(error => log('Douyin sync poll failed', error)); }, pollMs);
  }

  function stop() {
    stopping = true;
    if (startupTimer) clearTimeout(startupTimer);
    if (interval) clearIntervalFn(interval);
    startupTimer = null;
    interval = null;
    // Await persistence as well as the child job; clearing timers only stops new work.
    return Promise.allSettled([workQueue, dueTask, ...running.values(), ...videoTasks.values()]);
  }

  return { syncChannel, syncAll, runVideo, runDue, start, stop,
    setPaused(value) { paused = value === true; return { paused }; },
    status() { return { paused, runningCount: running.size + videoTasks.size }; } };
}

module.exports = {
  createDouyinAutoSync,
  observationNeedsDetail,
  observationNeedsTranscription,
  isDouyinDetailCandidate,
  ensureDouyinSyncJobs,
  transcriptionReadiness,
  summarizeObservationCoverage,
  planArchiveMediaUrls
};
