const crypto = require('node:crypto');

const ENGAGEMENT_KEYS = ['likes', 'comments', 'favorites', 'shares', 'plays'];
const MEDIA_NUMBER_KEYS = ['durationSeconds', 'width', 'height', 'videoWidth', 'videoHeight', 'mediaBytes'];
const MEDIA_TEXT_KEYS = ['format', 'codec', 'mediaSha256', 'mediaContentType'];

function normalizedText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizedDate(value) {
  const raw = normalizedText(value);
  if (!raw) return '';
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
}

function stableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stableEngagement(value) {
  const source = value && typeof value === 'object' ? value : {};
  const result = {};
  ENGAGEMENT_KEYS.forEach(function(key) {
    const number = stableNumber(source[key]);
    if (number != null) result[key] = number;
  });
  return result;
}

function stableMediaMetadata(value) {
  const source = value && typeof value === 'object' ? value : {};
  const result = {};
  MEDIA_NUMBER_KEYS.forEach(function(key) {
    const number = stableNumber(source[key]);
    if (number != null) result[key] = number;
  });
  MEDIA_TEXT_KEYS.forEach(function(key) {
    const text = normalizedText(source[key]);
    if (text) result[key] = text;
  });
  const asr = source.asr && typeof source.asr === 'object' ? source.asr : {};
  const segmentText = (Array.isArray(asr.segments) ? asr.segments : [])
    .map(function(segment) { return normalizedText(segment && segment.text); })
    .filter(Boolean);
  if (segmentText.length) result.transcriptSegments = segmentText;
  return result;
}

function materialFingerprint(observation = {}) {
  const material = {
    title: normalizedText(observation.title),
    publishedAt: normalizedDate(observation.publishedAt),
    content: normalizedText(observation.content),
    description: normalizedText(observation.description),
    summary: normalizedText(observation.summary),
    transcript: normalizedText(observation.transcript),
    engagement: stableEngagement(observation.engagement),
    media: stableMediaMetadata(observation.mediaMetadata)
  };
  return crypto.createHash('sha256').update(JSON.stringify(material)).digest('hex');
}

function materiallyEquivalent(left, right) {
  return materialFingerprint(left) === materialFingerprint(right);
}

function contentId(observation) {
  return normalizedText(observation && (observation.externalContentId || observation.contentId ||
    observation.externalKey || observation.sourceUrl || observation.id));
}

function discoveryEntry(id, previous, current) {
  return {
    contentId: id,
    previous: previous || null,
    current,
    previousFingerprint: previous ? materialFingerprint(previous) : '',
    currentFingerprint: materialFingerprint(current)
  };
}

function summarizeDiscovery(previousObservations, currentObservations) {
  const previousById = new Map();
  (Array.isArray(previousObservations) ? previousObservations : []).forEach(function(item) {
    const id = contentId(item);
    if (id) previousById.set(id, item);
  });

  const added = [];
  const updated = [];
  const unchanged = [];
  const seen = new Set();
  (Array.isArray(currentObservations) ? currentObservations : []).forEach(function(item) {
    const id = contentId(item);
    if (!id || seen.has(id)) return;
    seen.add(id);
    const previous = previousById.get(id);
    const entry = discoveryEntry(id, previous, item);
    if (!previous) added.push(entry);
    else if (entry.previousFingerprint !== entry.currentFingerprint) updated.push(entry);
    else unchanged.push(entry);
  });

  return {
    addedCount: added.length,
    updatedCount: updated.length,
    unchangedCount: unchanged.length,
    added,
    updated,
    unchanged
  };
}

function timestamp(value) {
  const parsed = new Date(String(value || '')).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function transcriptionPending(observation) {
  const metadata = observation && observation.mediaMetadata && typeof observation.mediaMetadata === 'object'
    ? observation.mediaMetadata : {};
  const asr = metadata.asr && typeof metadata.asr === 'object' ? metadata.asr : {};
  return Boolean(metadata.detailCapturedAt && asr.status !== 'complete');
}

function mediaArchivePending(observation) {
  const metadata = observation && observation.mediaMetadata && typeof observation.mediaMetadata === 'object'
    ? observation.mediaMetadata : {};
  const asr = metadata.asr && typeof metadata.asr === 'object' ? metadata.asr : {};
  const archive = metadata.archive && typeof metadata.archive === 'object' ? metadata.archive : {};
  const localAssetPath = normalizedText(observation && observation.localAssetPath ||
    archive.localAssetPath || asr.localAssetPath);
  return asr.status === 'complete' && /^[a-f0-9]{64}$/i.test(normalizedText(asr.mediaSha256)) && !localAssetPath;
}

function planDetailCandidates(observations, state = {}, options = {}) {
  const now = timestamp(options.now) || Date.now();
  const limit = Math.max(0, Math.floor(Number(options.limit) || 8));
  const recentTtlMs = Math.max(0, options.recentTtlMs == null
    ? 6 * 60 * 60 * 1000 : Number(options.recentTtlMs) || 0);
  const retryBaseMs = Math.max(1000, Number(options.retryBaseMs) || 15 * 60 * 1000);
  const retryMaxMs = Math.max(retryBaseMs, Number(options.retryMaxMs) || 24 * 60 * 60 * 1000);
  const defaultPendingLimit = Math.max(1, Math.floor(limit / 3));
  const maxTranscriptionPending = Math.max(0, Math.floor(
    options.maxTranscriptionPending == null ? defaultPendingLimit : Number(options.maxTranscriptionPending)
  ));
  if (!limit) return [];

  const eligible = [];
  (Array.isArray(observations) ? observations : []).forEach(function(observation, index) {
    const id = contentId(observation);
    if (!id) return;
    const itemState = state && typeof state[id] === 'object' ? state[id] : {};
    const metadata = observation.mediaMetadata && typeof observation.mediaMetadata === 'object'
      ? observation.mediaMetadata : {};
    const failureCount = Math.max(0, Math.floor(Number(itemState.failureCount) || 0));
    const lastFailureAt = timestamp(itemState.lastFailureAt);
    if (failureCount && lastFailureAt) {
      const retryDelay = Math.min(retryMaxMs, retryBaseMs * Math.pow(2, failureCount - 1));
      if (now < lastFailureAt + retryDelay) return;
    }

    const lastCheckedAt = timestamp(itemState.lastDetailCheckedAt || itemState.lastCheckedAt ||
      metadata.detailCapturedAt || itemState.lastFailureAt);
    const isNew = !lastCheckedAt;
    const pendingArchive = mediaArchivePending(observation);
    const pending = !isNew && transcriptionPending(observation);
    if (!isNew && !pending && now - lastCheckedAt < recentTtlMs) return;
    eligible.push({
      observation,
      contentId: id,
      reason: pendingArchive ? 'archive_pending' : isNew ? 'new' : pending ? 'transcription_pending' : failureCount ? 'retry' : 'stale',
      lastDetailCheckedAt: lastCheckedAt ? new Date(lastCheckedAt).toISOString() : '',
      failureCount,
      _lastCheckedAt: lastCheckedAt,
      _index: index
    });
  });

  const news = eligible.filter(function(item) { return item.reason === 'new'; })
    .sort(function(left, right) { return left._index - right._index; });
  const archives = eligible.filter(function(item) { return item.reason === 'archive_pending'; })
    .sort(function(left, right) {
      return left._lastCheckedAt - right._lastCheckedAt || left.contentId.localeCompare(right.contentId);
    });
  const regular = eligible.filter(function(item) {
    return !['new', 'archive_pending', 'transcription_pending'].includes(item.reason);
  })
    .sort(function(left, right) {
      return left._lastCheckedAt - right._lastCheckedAt || left.contentId.localeCompare(right.contentId);
    });
  const pending = eligible.filter(function(item) { return item.reason === 'transcription_pending'; })
    .sort(function(left, right) {
      return left._index - right._index || left._lastCheckedAt - right._lastCheckedAt ||
        left.contentId.localeCompare(right.contentId);
    })
    .slice(0, maxTranscriptionPending);

  const planned = [];
  if (options.prioritizeArchivePending === true) {
    archives.forEach(function(item) { if (planned.length < limit) planned.push(item); });
  }
  news.forEach(function(item) { if (planned.length < limit) planned.push(item); });
  pending.forEach(function(item) {
    if (planned.length < limit) planned.push(item);
  });
  regular.forEach(function(item) {
    if (planned.length < limit) planned.push(item);
  });
  if (options.prioritizeArchivePending !== true) {
    archives.forEach(function(item) { if (planned.length < limit) planned.push(item); });
  }
  return planned.map(function(item) {
    const result = Object.assign({}, item);
    delete result._lastCheckedAt;
    delete result._index;
    return result;
  });
}

module.exports = {
  materialFingerprint,
  materiallyEquivalent,
  planDetailCandidates,
  summarizeDiscovery
};
