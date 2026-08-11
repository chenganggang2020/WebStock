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
  const mediaMetadata = observation && observation.mediaMetadata && typeof observation.mediaMetadata === 'object'
    ? observation.mediaMetadata : {};
  return !mediaMetadata.asr || mediaMetadata.asr.status !== 'complete';
}

function summarizeObservationCoverage(observations) {
  const videos = (Array.isArray(observations) ? observations : []).filter(function(observation) {
    return observation && observation.externalContentId && observation.mediaType !== 'article';
  });
  let transcribedCount = 0;
  let failedTranscriptionCount = 0;
  videos.forEach(function(observation) {
    const metadata = observation.mediaMetadata && typeof observation.mediaMetadata === 'object'
      ? observation.mediaMetadata : {};
    const status = metadata.asr && metadata.asr.status;
    if (status === 'complete' && String(observation.transcript || '').trim()) transcribedCount += 1;
    else if (status === 'error') failedTranscriptionCount += 1;
  });
  const pendingTranscriptionCount = Math.max(videos.length - transcribedCount - failedTranscriptionCount, 0);
  return {
    videoCount: videos.length,
    transcribedCount,
    pendingTranscriptionCount,
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

function createDouyinAutoSync(options = {}) {
  const sessionManager = options.sessionManager;
  const channels = options.channels;
  const sources = options.sources;
  const syncState = options.syncState;
  const transcriber = options.transcriber || null;
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

  if (!sessionManager || typeof sessionManager.captureUrl !== 'function') throw new Error('缺少抖音登录会话采集器');
  if (!channels || !sources || !syncState) throw new Error('缺少抖音自动同步依赖');

  async function syncChannel(channelId) {
    const id = Number(channelId);
    if (running.has(id)) return running.get(id);
    const task = (async function() {
      syncState.markRunning(id);
      try {
        const channel = channels.getChannel(id);
        if (channel.platform !== 'douyin') throw new Error('自动同步仅支持抖音创作者频道');
        if (!channel.profileUrl) throw new Error('研究对象尚未配置抖音主页');
        const reanalysis = typeof sources.reanalyzeChannelObservations === 'function'
          ? sources.reanalyzeChannelObservations(id) : { updatedCount: 0 };
        const existing = channels.listObservations(id, { limit: 1000 });
        const existingByContentId = new Map(existing.map(item => [String(item.externalContentId || ''), item]));
        const profileCapture = await sessionManager.captureUrl(channel.profileUrl);
        if (!profileCapture.loggedIn) throw new Error('抖音登录状态已失效，请在 WebStock 中重新登录');
        if (!profileCapture.profile || !profileCapture.profile.profileUrl || !profileCapture.items.length) {
          throw new Error('抖音主页尚未加载出作品列表，本轮不会记为成功');
        }
        const profileIdentity = sources.verifyCapturedIdentity(id, profileCapture);
        if (!profileIdentity.matched) throw new Error('抖音主页身份与研究对象不一致，本轮不会入库');
        const pending = profileCapture.items.filter(function(item) {
          const observation = existingByContentId.get(String(item && item.contentId));
          return item && item.contentId && (observationNeedsDetail(observation) ||
            (transcriber && observationNeedsTranscription(observation)));
        });
        const recent = profileCapture.items.slice(0, 3);
        const candidates = recent.concat(pending).filter(function(item, index, items) {
          return item && item.contentId && items.findIndex(candidate => candidate.contentId === item.contentId) === index;
        }).slice(0, maxDetailsPerRun);
        let addedCount = 0;
        let updatedCount = 0;
        let unchangedCount = 0;
        let detailedCount = 0;
        let transcribedCount = 0;
        let transcriptionAttemptedCount = 0;
        const detailErrors = [];
        const transcriptErrors = [];

        for (const item of candidates) {
          try {
            const detailCapture = await sessionManager.captureUrl(item.sourceUrl);
            const currentItem = detailCapture.items.find(detail => String(detail.contentId) === String(item.contentId));
            if (!currentItem) throw new Error('详情页未返回目标视频数据');
            detailCapture.items = [Object.assign({}, item, currentItem, {
              engagement: Object.assign({}, item.engagement || {}, currentItem.engagement || {})
            })];
            const detailIdentity = sources.verifyCapturedIdentity(id, detailCapture);
            if (!detailIdentity.matched) throw new Error('详情页作者身份与研究对象不一致');
            const detailResult = sources.importCapturedPage(id, detailCapture);
            addedCount += Number(detailResult.addedCount || 0);
            updatedCount += Number(detailResult.updatedCount || 0);
            unchangedCount += Number(detailResult.unchangedCount || 0);
            detailedCount += 1;
            const saved = (detailResult.items || []).find(function(observation) {
              return String(observation.externalContentId || '') === String(item.contentId);
            });
            if (transcriber && transcriptionAttemptedCount < maxTranscriptionsPerRun && currentItem.mediaUrl &&
                observationNeedsTranscription(saved)) {
              transcriptionAttemptedCount += 1;
              try {
                const transcription = await transcriber.transcribe({
                  mediaUrl: currentItem.mediaUrl,
                  contentId: item.contentId,
                  prompt: [currentItem.title, currentItem.summary].concat(currentItem.hashtags || []).filter(Boolean).join('；')
                });
                sources.applyTranscription(id, item.contentId, transcription);
                transcribedCount += 1;
              } catch (error) {
                transcriptErrors.push({ contentId: item.contentId, message: error.message || String(error) });
                if (typeof sources.recordTranscriptionError === 'function') {
                  sources.recordTranscriptionError(id, item.contentId, error);
                }
                log('Douyin transcription failed for ' + item.contentId, error);
              }
            }
          } catch (error) {
            detailErrors.push({ contentId: item.contentId, message: error.message || String(error) });
            log('Douyin detail capture failed for ' + item.contentId, error);
          }
        }

        if (candidates.length && detailedCount === 0) {
          throw new Error('发现作品链接，但本轮未能提取任何身份匹配的视频详情');
        }

        const coverage = summarizeObservationCoverage(channels.listObservations(id, { limit: 1000 }));
        const result = {
          channelId: id,
          pageUrl: profileCapture.pageUrl,
          workCount: Number(profileCapture.profile && profileCapture.profile.workCount || 0),
          discoveredCount: profileCapture.items.length,
          reanalyzedCount: Number(reanalysis.updatedCount || 0),
          detailedCount,
          addedCount,
          updatedCount,
          unchangedCount,
          transcribedCount,
          transcriptionAttemptedCount,
          detailErrors,
          transcriptErrors,
          coverage
        };
        syncState.markCompleted(id, result);
        return result;
      } catch (error) {
        syncState.markFailed(id, error);
        throw error;
      } finally {
        running.delete(id);
      }
    })();
    running.set(id, task);
    return task;
  }

  async function runDue() {
    const jobs = syncState.listDue ? syncState.listDue() : [];
    for (const job of jobs) {
      try { await syncChannel(job.channelId); } catch (error) {
        log('Scheduled Douyin sync failed for channel ' + job.channelId, error);
      }
    }
  }

  async function syncAll() {
    const jobs = syncState.listEnabled ? syncState.listEnabled() : [];
    const items = [];
    for (const job of jobs) {
      try {
        const result = await syncChannel(job.channelId);
        items.push({ channelId: Number(job.channelId), result });
      } catch (error) {
        items.push({ channelId: Number(job.channelId), error: error.message || String(error) });
      }
    }
    return {
      attemptedCount: items.length,
      succeededCount: items.filter(function(item) { return !item.error; }).length,
      failedCount: items.filter(function(item) { return Boolean(item.error); }).length,
      items
    };
  }

  function start() {
    if (interval) return;
    startupTimer = setTimeoutFn(function() { runDue().catch(error => log('Initial Douyin sync failed', error)); }, startupDelayMs);
    interval = setIntervalFn(function() { runDue().catch(error => log('Douyin sync poll failed', error)); }, pollMs);
  }

  function stop() {
    if (startupTimer) clearTimeout(startupTimer);
    if (interval) clearIntervalFn(interval);
    startupTimer = null;
    interval = null;
  }

  return { syncChannel, syncAll, runDue, start, stop };
}

module.exports = {
  createDouyinAutoSync,
  observationNeedsDetail,
  observationNeedsTranscription,
  ensureDouyinSyncJobs,
  summarizeObservationCoverage
};
