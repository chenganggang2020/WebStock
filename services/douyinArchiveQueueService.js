const { planDetailCandidates } = require('./douyinSyncPlanningService');

const CONTENT_ID_PATTERN = /^\d{12,24}$/;

function normalizedText(value) {
  return String(value || '').trim();
}

function canonicalDouyinContentId(value) {
  try {
    const parsed = new URL(normalizedText(value));
    const hostname = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || (hostname !== 'douyin.com' && !hostname.endsWith('.douyin.com'))) return '';
    const match = parsed.pathname.match(/^\/video\/(\d{12,24})\/?$/);
    return match ? match[1] : '';
  } catch (error) {
    return '';
  }
}

function verifiedContentId(observation) {
  const item = observation && typeof observation === 'object' ? observation : {};
  const direct = [item.externalContentId, item.contentId].map(normalizedText)
    .find(value => CONTENT_ID_PATTERN.test(value));
  return direct || canonicalDouyinContentId(item.sourceUrl);
}

function observationContentId(observation) {
  const item = observation && typeof observation === 'object' ? observation : {};
  const evidenceLevel = normalizedText(item.evidenceLevel).toLowerCase();
  if (evidenceLevel) return evidenceLevel === 'primary' ? verifiedContentId(item) : '';
  return normalizedText(item.externalContentId || item.contentId || item.externalKey || item.sourceUrl || item.id);
}

function archiveQueueState(observation) {
  const metadata = observation && observation.mediaMetadata && typeof observation.mediaMetadata === 'object'
    ? observation.mediaMetadata : {};
  const asr = metadata.asr && typeof metadata.asr === 'object' ? metadata.asr : {};
  const archive = metadata.archive && typeof metadata.archive === 'object' ? metadata.archive : {};
  const remote = metadata.remote && typeof metadata.remote === 'object' ? metadata.remote : {};
  const transcribed = asr.status === 'complete' && Boolean(normalizedText(observation && observation.transcript));
  const noSpeech = asr.status === 'no_speech';
  const unavailable = remote.status === 'identity_rejected';
  const archived = Boolean(normalizedText(observation && observation.localAssetPath ||
    archive.localAssetPath || asr.localAssetPath));
  return {
    transcribed,
    noSpeech,
    unavailable,
    archived,
    completed: (transcribed || noSpeech) && archived,
    archivePending: transcribed && !archived,
    transcriptionPending: !transcribed && !noSpeech && !unavailable
  };
}

function videoObservations(observations) {
  return (Array.isArray(observations) ? observations : []).filter(function(observation) {
    return observation && observation.mediaType === 'video' && Boolean(observationContentId(observation));
  });
}

function summarizeArchiveQueue(observations) {
  const videos = videoObservations(observations);
  const states = videos.map(archiveQueueState);
  const transcribedCount = states.filter(state => state.transcribed).length;
  const archivedCount = states.filter(state => state.archived).length;
  const completedCount = states.filter(state => state.completed).length;
  const unavailableCount = states.filter(state => state.unavailable).length;
  const pendingCount = videos.length - completedCount - unavailableCount;
  return {
    videoCount: videos.length,
    transcribedCount,
    noSpeechCount: states.filter(state => state.noSpeech).length,
    unavailableCount,
    archivedCount,
    completedCount,
    pendingCount,
    archivePendingCount: states.filter(state => state.archivePending).length,
    transcriptionPendingCount: states.filter(state => state.transcriptionPending).length,
    completionRate: videos.length ? Number(((completedCount + unavailableCount) / videos.length).toFixed(4)) : 0
  };
}

function planFullArchiveQueue(observations, state = {}, options = {}) {
  const incomplete = videoObservations(observations).filter(function(observation) {
    const state = archiveQueueState(observation);
    return !state.completed && !state.unavailable;
  });
  if (!incomplete.length) return [];

  const requestedLimit = options.limit == null
    ? incomplete.length
    : Math.max(0, Math.floor(Number(options.limit) || 0));
  if (!requestedLimit) return [];

  const unthrottledState = Object.create(null);
  incomplete.forEach(function(observation) {
    const id = observationContentId(observation);
    const itemState = state && typeof state[id] === 'object' ? state[id] : {};
    unthrottledState[id] = Object.assign({}, itemState, { failureCount: 0 });
  });

  const originals = new Map(incomplete.map(function(observation) {
    return [observationContentId(observation), observation];
  }));
  const planningObservations = incomplete.map(function(observation) {
    return Object.assign({}, observation, { externalContentId: observationContentId(observation) });
  });
  const planned = planDetailCandidates(planningObservations, unthrottledState, {
    now: options.now,
    limit: incomplete.length,
    recentTtlMs: 0,
    maxTranscriptionPending: incomplete.length,
    prioritizeArchivePending: true
  }).map(function(entry) {
    const id = observationContentId(entry.observation);
    const observation = originals.get(id) || entry.observation;
    const queueState = archiveQueueState(observation);
    let reason = entry.reason;
    if (queueState.archivePending) reason = 'archive_pending';
    else if (queueState.transcriptionPending && reason !== 'new') reason = 'transcription_pending';
    return Object.assign({}, entry, { contentId: id, observation, reason });
  });

  return planned.filter(entry => entry.reason === 'archive_pending')
    .concat(planned.filter(entry => entry.reason !== 'archive_pending'))
    .slice(0, requestedLimit);
}

module.exports = {
  planFullArchiveQueue,
  summarizeArchiveQueue
};
