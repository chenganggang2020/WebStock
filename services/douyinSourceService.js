const expertChannels = require('./expertChannelService');
const { normalizeDouyinPageSnapshot } = require('../electron/douyinPageCapture');
const { analyzeInvestmentText } = require('./investmentSignalService');
const { materialFingerprint } = require('./douyinSyncPlanningService');
const crypto = require('node:crypto');

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = /[)\]}>，。；;！？!?、]+$/u;
const CURRENT_SIGNAL_RULE = 'rule-v2';
const CURRENT_CAPTURE_SCHEMA = 'douyin-visible-v2';

function cleanUrlToken(value) {
  return String(value || '').trim().replace(TRAILING_PUNCTUATION, '');
}

function douyinPlayerUrl(videoId) {
  const id = String(videoId || '').trim();
  if (!/^\d{12,24}$/.test(id)) return '';
  return 'https://open.douyin.com/player/video?vid=' + id + '&autoplay=0';
}

function normalizeDouyinLink(value) {
  let parsed;
  try {
    parsed = new URL(cleanUrlToken(value));
  } catch (error) {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || !(host === 'douyin.com' || host.endsWith('.douyin.com'))) return null;

  const pathMatch = parsed.pathname.match(/\/(?:m\/)?(video|note)\/(\d{12,24})(?:\/|$)/i);
  const playerId = host === 'open.douyin.com' && /^\/player\/video\/?$/i.test(parsed.pathname)
    ? String(parsed.searchParams.get('vid') || '')
    : '';
  const overlayId = String(parsed.searchParams.get('modal_id') || parsed.searchParams.get('aweme_id') || '');
  const videoId = pathMatch ? pathMatch[2]
    : /^\d{12,24}$/.test(playerId) ? playerId
      : /^\d{12,24}$/.test(overlayId) ? overlayId : '';
  if (videoId) {
    const kind = pathMatch ? pathMatch[1].toLowerCase() : 'video';
    return {
      sourceUrl: 'https://www.douyin.com/' + kind + '/' + videoId,
      videoId,
      kind
    };
  }

  if (host !== 'v.douyin.com' || !parsed.pathname.replace(/\//g, '')) return null;
  return {
    sourceUrl: 'https://v.douyin.com/' + parsed.pathname.replace(/^\/+|\/+$/g, '') + '/',
    videoId: '',
    kind: 'short_link'
  };
}

function extractDouyinShareLinks(text) {
  const urls = String(text || '').match(URL_PATTERN) || [];
  const items = [];
  const seen = new Set();
  let duplicateCount = 0;
  let ignoredCount = 0;
  urls.forEach(raw => {
    const item = normalizeDouyinLink(raw);
    if (!item) {
      ignoredCount += 1;
      return;
    }
    const key = item.videoId || item.sourceUrl.toLowerCase();
    if (seen.has(key)) {
      duplicateCount += 1;
      return;
    }
    seen.add(key);
    items.push(item);
  });
  return { items: items.slice(0, 50), duplicateCount, ignoredCount };
}

function shareTitle(text, itemCount) {
  if (itemCount !== 1) return '';
  const line = String(text || '').split(/\r?\n/).map(value => value.replace(URL_PATTERN, '').trim())
    .find(value => value.length >= 2 && value.length <= 160);
  return line || '';
}

function importDouyinLinks(channelId, input = {}) {
  const channel = expertChannels.getChannel(channelId);
  if (channel.platform !== 'douyin') throw new Error('只有抖音创作者频道可以导入抖音分享链接');
  const parsed = extractDouyinShareLinks(input.text);
  if (!parsed.items.length) throw new Error('没有识别到可用的抖音视频或分享链接');

  const title = shareTitle(input.text, parsed.items.length);
  const saved = [];
  let duplicateCount = parsed.duplicateCount;

  parsed.items.forEach(item => {
    if (expertChannels.findObservationByIdentity(channel.id, {
      externalContentId: item.videoId,
      sourceUrl: item.sourceUrl
    })) {
      duplicateCount += 1;
      return;
    }
    const identifier = item.videoId || item.sourceUrl.replace(/^https?:\/\//, '');
    saved.push(expertChannels.recordObservation(channel.id, {
      externalContentId: item.videoId,
      sourceUrl: item.sourceUrl,
      title: '[待核验抖音账号] ' + (title || '公开视频 ' + identifier),
      author: '待核验抖音账号',
      evidenceLevel: 'commentary',
      availabilityStatus: 'unknown',
      contentRole: 'fact_summary',
      mediaType: 'video',
      archiveStatus: 'linked',
      rightsBasis: 'quotation_only',
      summary: '从抖音公开分享链接直接导入。当前仅确认链接属于抖音；作者身份、标题、发布时间和正文尚待在平台页面人工核验。',
      topics: ['抖音直接链接', '身份待核验'],
      stance: 'unknown',
      confidence: 0.2,
      stockCodes: []
    }));
  });

  return {
    importedCount: saved.length,
    duplicateCount,
    ignoredCount: parsed.ignoredCount,
    items: saved
  };
}

function profileIdentity(value) {
  try {
    const parsed = new URL(String(value || ''));
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || !(host === 'douyin.com' || host.endsWith('.douyin.com'))) return '';
    if (!/^\/user\/[^/]+\/?$/i.test(parsed.pathname)) return '';
    return host + parsed.pathname.replace(/\/$/, '').toLowerCase();
  } catch (error) {
    return '';
  }
}

function identityName(value) {
  return String(value || '').replace(/\s+/g, '').trim().toLowerCase();
}

function captureIdentity(channel, capture) {
  const channelProfile = profileIdentity(channel.profileUrl);
  const capturedProfile = profileIdentity(capture.profile.profileUrl ||
    (capture.pageType === 'profile' ? capture.pageUrl : ''));
  const profileMatched = Boolean(channelProfile && capturedProfile && channelProfile === capturedProfile);
  const profileConflicted = Boolean(channelProfile && capturedProfile && channelProfile !== capturedProfile);
  const acceptedNames = [channel.displayName].concat(channel.aliases || []).map(identityName).filter(Boolean);
  const nameMatched = acceptedNames.includes(identityName(capture.profile.displayName));
  return {
    matched: profileMatched || (!profileConflicted && nameMatched),
    matchType: profileMatched ? 'profile_url' : (!profileConflicted && nameMatched) ? 'display_name' : 'unverified'
  };
}

function mergeUnique(left, right) {
  return (Array.isArray(left) ? left : []).concat(Array.isArray(right) ? right : [])
    .filter(Boolean).filter((value, index, values) => values.indexOf(value) === index);
}

function isAutomaticSignal(signal) {
  return /^rule-v\d+$/.test(String(signal && signal.analysisMethod || ''));
}

function generatedAnalysisNotes(signal) {
  const hasExtractedSignal = signal.keyPoints.length || signal.riskFlags.length ||
    signal.stockCodes.length || signal.sectors.length;
  return [
    signal.keyPoints.length ? '自动提取要点：' + signal.keyPoints.join('；') : '',
    signal.riskFlags.length ? '风险条件：' + signal.riskFlags.join('；') : '',
    hasExtractedSignal ? '分析方法：本地规则提取 ' + CURRENT_SIGNAL_RULE + '，原文不足时不推断股票代码。' : ''
  ].filter(Boolean).join('\n');
}

function topicsWithoutPreviousSignal(existing) {
  const previousSignal = existing && existing.signal && typeof existing.signal === 'object'
    ? existing.signal : {};
  const stale = new Set([].concat(previousSignal.topics || [], previousSignal.sectors || []));
  const topics = existing && Array.isArray(existing.topics) ? existing.topics : [];
  return isAutomaticSignal(previousSignal) ? topics.filter(topic => !stale.has(topic)) : topics;
}

function normalizedPublishedAt(value, fallback) {
  function parse(candidate) {
    const raw = String(candidate || '').trim().replace(/年|月/g, '-').replace(/日/g, '');
    const match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?)?(Z|[+-]\d{2}:?\d{2})?$/i);
    if (!match) return '';
    const day = match[1] + '-' + match[2].padStart(2, '0') + '-' + match[3].padStart(2, '0');
    const midnight = Date.parse(day + 'T00:00:00Z');
    if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== day ||
        Number(match[4] || 0) > 23 || Number(match[5] || 0) > 59 || Number(match[6] || 0) > 59) return '';
    // Absolute dates on the Chinese source page use Beijing time, not the PC timezone.
    const time = (match[4] || '00').padStart(2, '0') + ':' + (match[5] || '00') + ':' + (match[6] || '00') + (match[7] || '');
    const instant = Date.parse(day + 'T' + time + (match[8] || '+08:00'));
    return Number.isFinite(instant) ? new Date(instant).toISOString() : '';
  }
  return parse(value) || parse(fallback);
}

function comparableObservation(item) {
  return JSON.stringify({
    materialFingerprint: materialFingerprint(item),
    sourceUrl: item.sourceUrl || '',
    title: item.title || '',
    author: item.author || '',
    publishedAt: item.publishedAt || '',
    evidenceLevel: item.evidenceLevel || '',
    availabilityStatus: item.availabilityStatus || '',
    contentRole: item.contentRole || '',
    summary: item.summary || '',
    signal: item.signal || {},
    stockCodes: item.stockCodes || [],
    sectors: item.sectors || [],
    topics: item.topics || [],
    stance: item.stance || 'unknown',
    horizon: item.horizon || 'unspecified',
    mediaType: item.mediaType || '',
    archiveStatus: item.archiveStatus || '',
    rightsBasis: item.rightsBasis || '',
    confidence: Number(item.confidence || 0)
  });
}

function capturedObservationInput(channel, capture, identity, item, existing) {
  const matched = identity.matched;
  const visibleTitle = String(item.title || '').trim();
  const fallbackTitle = (item.mediaType === 'note' ? '抖音图文 ' : '抖音视频 ') + item.contentId;
  const existingTitle = existing && String(existing.title || '');
  const keepExistingTitle = !visibleTitle && existingTitle;
  const baseTitle = keepExistingTitle || visibleTitle || fallbackTitle;
  const title = matched ? baseTitle.replace(/^\[(?:待核验抖音账号|身份待核验)\]\s*/, '')
    : (/^\[身份待核验\]/.test(baseTitle) ? baseTitle : '[身份待核验] ' + baseTitle.replace(/^\[待核验抖音账号\]\s*/, ''));
  const existingSummary = existing && String(existing.summary || '');
  const placeholderSummary = /当前仅确认链接属于抖音|身份.*尚待.*核验/.test(existingSummary);
  const summary = String(item.summary || '').trim() ||
    (matched && (!existingSummary || placeholderSummary)
      ? ''
      : existingSummary || '从当前抖音页面采集到公开作品链接，作者身份尚未与研究对象核验一致。');
  const previousSignal = existing && existing.signal && typeof existing.signal === 'object'
    ? existing.signal : {};
  const replaceAutomaticSignal = isAutomaticSignal(previousSignal);
  const topics = mergeUnique(topicsWithoutPreviousSignal(existing), [
    '抖音登录会话同步',
    matched ? '身份已匹配' : '身份待核验'
  ]);
  const description = String(item.description || existing && existing.description || '').trim();
  const existingAsr = existing && existing.mediaMetadata && existing.mediaMetadata.asr;
  const transcript = String(existingAsr && ['complete', 'needs_review'].includes(existingAsr.status)
    ? existing.transcript || ''
    : item.transcript || existing && existing.transcript || '').trim();
  const existingNoteText = existing && existing.mediaType === 'note' && existing.mediaMetadata &&
    existing.mediaMetadata.note && existing.content;
  const content = transcript || existingNoteText || description || existing && existing.content || '';
  const visibleEngagement = item.engagement && typeof item.engagement === 'object' ? item.engagement : {};
  const previousEngagement = existing && existing.engagement || {};
  const previousMediaMetadata = existing && existing.mediaMetadata || {};
  const playCountExplicit = (capture.pageType === 'video' || capture.pageType === 'note') &&
    Object.prototype.hasOwnProperty.call(visibleEngagement, 'plays') || previousMediaMetadata.playCountExplicit === true;
  const engagementDelta = {};
  Object.keys(visibleEngagement).forEach(function(key) {
    const current = Number(visibleEngagement[key]);
    const previous = Number(previousEngagement[key]);
    if (Number.isFinite(current) && Number.isFinite(previous) && current !== previous) {
      engagementDelta[key] = current - previous;
    }
  });
  const engagement = Object.keys(visibleEngagement).length
    ? Object.assign({}, previousEngagement, visibleEngagement, {
      observedAt: capture.capturedAt,
      delta: engagementDelta
    })
    : Object.assign({}, previousEngagement);
  if (!playCountExplicit) delete engagement.plays;
  const mediaMetadata = Object.assign({}, previousMediaMetadata, {
    captureSchemaVersion: CURRENT_CAPTURE_SCHEMA,
    playCountExplicit
  });
  if (matched && (capture.pageType === 'video' || capture.pageType === 'note')) {
    delete mediaMetadata.remote;
  }
  if (item.coverUrl) mediaMetadata.coverUrl = item.coverUrl;
  if (Number(item.durationSeconds) > 0) mediaMetadata.durationSeconds = Number(item.durationSeconds);
  if (capture.pageType === 'video' || capture.pageType === 'note') mediaMetadata.detailCapturedAt = capture.capturedAt;
  if (item.coverUrl || Number(item.durationSeconds) > 0 || Object.keys(visibleEngagement).length ||
      capture.pageType === 'video' || capture.pageType === 'note') mediaMetadata.observedAt = capture.capturedAt;
  const signal = analyzeInvestmentText({
    title,
    description: existingNoteText || description,
    transcript,
    summary,
    hashtags: item.hashtags
  });
  const stockCodes = replaceAutomaticSignal ? signal.stockCodes
    : mergeUnique(existing && existing.stockCodes, signal.stockCodes);
  const sectors = replaceAutomaticSignal ? signal.sectors
    : mergeUnique(existing && existing.sectors, signal.sectors);
  const enrichedTopics = mergeUnique(topics, mergeUnique(item.hashtags, signal.topics));
  const analysisNotes = generatedAnalysisNotes(signal);

  return {
    externalContentId: item.contentId,
    sourceUrl: item.sourceUrl,
    title,
    author: matched ? channel.displayName : '待核验抖音账号',
    publishedAt: normalizedPublishedAt(item.publishedAt, existing && existing.publishedAt),
    evidenceLevel: matched ? 'primary' : 'commentary',
    availabilityStatus: matched ? 'available' : 'unknown',
    contentRole: transcript ? 'transcript' : 'fact_summary',
    content,
    description,
    transcript,
    engagement,
    mediaMetadata,
    signal,
    mediaType: item.mediaType,
    archiveStatus: existing && existing.archiveStatus === 'downloaded' ? 'downloaded' : 'linked',
    rightsBasis: 'quotation_only',
    localAssetPath: existing && existing.localAssetPath || '',
    summary,
    topics: enrichedTopics,
    stance: replaceAutomaticSignal ? signal.stance
      : signal.stance !== 'unknown' ? signal.stance : existing && existing.stance || 'unknown',
    horizon: replaceAutomaticSignal ? signal.horizon
      : signal.horizon !== 'unspecified' ? signal.horizon : existing && existing.horizon || 'unspecified',
    confidence: matched ? (transcript ? 0.92 : identity.matchType === 'profile_url' ? 0.85 : 0.7) : 0.2,
    stockCodes,
    sectors,
    analysisNotes,
    lastSeenAt: capture.capturedAt
  };
}

function reanalyzeChannelObservations(channelId) {
  const channel = expertChannels.getChannel(channelId);
  if (channel.platform !== 'douyin') return { scannedCount: 0, updatedCount: 0 };
  const observations = expertChannels.listObservations(channel.id, { limit: 1000 });
  let scannedCount = 0;
  let updatedCount = 0;

  observations.forEach(function(existing) {
    const previousSignal = existing.signal && typeof existing.signal === 'object' ? existing.signal : {};
    const previousMediaMetadata = existing.mediaMetadata && typeof existing.mediaMetadata === 'object'
      ? existing.mediaMetadata : {};
    const needsSignalUpgrade = isAutomaticSignal(previousSignal) &&
      previousSignal.analysisMethod !== CURRENT_SIGNAL_RULE;
    const needsCaptureUpgrade = previousMediaMetadata.captureSchemaVersion !== CURRENT_CAPTURE_SCHEMA;
    if (existing.evidenceLevel !== 'primary' || (!needsSignalUpgrade && !needsCaptureUpgrade)) return;
    scannedCount += 1;
    const preservedTopics = topicsWithoutPreviousSignal(existing);
    const signal = needsSignalUpgrade ? analyzeInvestmentText({
        title: existing.title,
        description: existing.description,
        transcript: existing.transcript || existing.content,
        summary: existing.summary,
        hashtags: preservedTopics
      }) : previousSignal;
    const topics = needsSignalUpgrade ? mergeUnique(preservedTopics, signal.topics) : existing.topics;
    const engagement = Object.assign({}, existing.engagement || {});
    const mediaMetadata = Object.assign({}, previousMediaMetadata, {
      captureSchemaVersion: CURRENT_CAPTURE_SCHEMA,
      playCountExplicit: previousMediaMetadata.playCountExplicit === true
    });
    if (!mediaMetadata.playCountExplicit) delete engagement.plays;
    expertChannels.recordObservation(channel.id, {
      externalKey: existing.externalKey,
      stockCodes: needsSignalUpgrade ? signal.stockCodes : existing.stockCodes,
      sectors: needsSignalUpgrade ? signal.sectors : existing.sectors,
      topics,
      signal,
      engagement,
      mediaMetadata,
      stance: needsSignalUpgrade ? signal.stance : existing.stance,
      horizon: needsSignalUpgrade ? signal.horizon : existing.horizon,
      analysisNotes: needsSignalUpgrade ? generatedAnalysisNotes(signal) : existing.analysisNotes,
      firstSeenAt: existing.firstSeenAt,
      lastSeenAt: existing.lastSeenAt
    });
    updatedCount += 1;
  });

  return { scannedCount, updatedCount };
}

function planCapturedPage(channelId, input = {}) {
  const channel = expertChannels.getChannel(channelId);
  if (channel.platform !== 'douyin') throw new Error('只有抖音创作者频道可以同步抖音页面');
  const capture = normalizeDouyinPageSnapshot(input.capture || input);
  const identity = captureIdentity(channel, capture);
  let addedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  const entries = capture.items.map(item => {
    const existing = expertChannels.findObservationByIdentity(channel.id, {
      externalContentId: item.contentId,
      sourceUrl: item.sourceUrl
    });
    const observationInput = capturedObservationInput(channel, capture, identity, item, existing);
    if (existing && comparableObservation(existing) === comparableObservation(observationInput)) {
      unchangedCount += 1;
      return { changeType: 'unchanged', existing, observationInput };
    }
    if (existing) updatedCount += 1;
    else addedCount += 1;
    return { changeType: existing ? 'updated' : 'added', existing, observationInput };
  });
  return {
    channel,
    capture,
    identity,
    entries,
    addedCount,
    updatedCount,
    unchangedCount
  };
}

function inspectCapturedPage(channelId, input = {}) {
  const plan = planCapturedPage(channelId, input);
  const items = plan.entries.map(function(entry) {
    return Object.assign({}, entry.observationInput, { changeType: entry.changeType });
  });
  return {
    pageUrl: plan.capture.pageUrl,
    pageType: plan.capture.pageType,
    loggedIn: plan.capture.loggedIn,
    identityMatched: plan.identity.matched,
    identityMatchType: plan.identity.matchType,
    capturedCount: plan.capture.items.length,
    addedCount: plan.addedCount,
    updatedCount: plan.updatedCount,
    unchangedCount: plan.unchangedCount,
    items,
    candidates: items.filter(function(item) { return item.changeType !== 'unchanged'; })
  };
}

function importCapturedPage(channelId, input = {}) {
  const plan = planCapturedPage(channelId, input);
  const items = plan.entries.map(function(entry, index) {
    const saved = entry.changeType === 'unchanged' ? entry.existing
      : expertChannels.recordObservation(plan.channel.id, entry.observationInput);
    const capturedItem = plan.capture.items[index] || {};
    const isDetailPage = plan.capture.pageType === 'video' || plan.capture.pageType === 'note';
    if (isDetailPage || (capturedItem.comments || []).length) {
      expertChannels.recordObservationComments(
        plan.channel.id, saved.id, capturedItem.comments, capturedItem.commentCoverage
      );
    }
    return saved;
  });
  return {
    pageUrl: plan.capture.pageUrl,
    pageType: plan.capture.pageType,
    loggedIn: plan.capture.loggedIn,
    identityMatched: plan.identity.matched,
    identityMatchType: plan.identity.matchType,
    capturedCount: plan.capture.items.length,
    addedCount: plan.addedCount,
    updatedCount: plan.updatedCount,
    unchangedCount: plan.unchangedCount,
    items
  };
}

function verifyCapturedIdentity(channelId, input = {}) {
  const channel = expertChannels.getChannel(channelId);
  const capture = normalizeDouyinPageSnapshot(input.capture || input);
  return captureIdentity(channel, capture);
}

function sanitizedAsrMetadata(result = {}) {
  const status = result.status === 'needs_review' ? 'needs_review' : 'complete';
  const normalization = result.normalization && typeof result.normalization === 'object'
    ? result.normalization : {};
  const quality = result.quality && typeof result.quality === 'object' ? result.quality : {};
  const finiteOrNull = function(value) { return value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null; };
  return {
    status,
    engine: String(result.engine || 'faster-whisper').slice(0, 80),
    engineVersion: String(result.engineVersion || '').slice(0, 80),
    model: String(result.model || 'small').slice(0, 80),
    device: String(result.device || 'cpu').slice(0, 40),
    computeType: String(result.computeType || 'int8').slice(0, 40),
    language: String(result.language || '').slice(0, 20),
    languageProbability: Math.min(Math.max(Number(result.languageProbability) || 0, 0), 1),
    durationSeconds: Math.max(Number(result.durationSeconds) || 0, 0),
    elapsedSeconds: Math.max(Number(result.elapsedSeconds) || 0, 0),
    mediaSha256: String(result.mediaSha256 || '').toLowerCase().slice(0, 64),
    mediaBytes: Math.max(Number(result.mediaBytes) || 0, 0),
    mediaContentType: String(result.mediaContentType || '').slice(0, 120),
    localAssetPath: String(result.localAssetPath || result.mediaMetadata && result.mediaMetadata.localAssetPath || '').slice(0, 2000),
    transcribedAt: String(result.transcribedAt || new Date().toISOString()),
    rawTranscript: String(result.rawTranscript || result.transcript || '').trim().slice(0, 800000),
    normalization: {
      script: normalization.script === 'zh-Hans' ? 'zh-Hans' : '',
      sourceHadTraditional: normalization.sourceHadTraditional === true,
      converter: String(normalization.converter || '').slice(0, 80)
    },
    quality: {
      needsReview: status === 'needs_review' || quality.needsReview === true,
      reasons: (Array.isArray(quality.reasons) ? quality.reasons : []).map(function(reason) {
        return String(reason || '').slice(0, 80);
      }).filter(Boolean).slice(0, 20),
      averageLogProbability: finiteOrNull(quality.averageLogProbability),
      averageNoSpeechProbability: finiteOrNull(quality.averageNoSpeechProbability),
      maximumCompressionRatio: finiteOrNull(quality.maximumCompressionRatio)
    },
    segments: (Array.isArray(result.segments) ? result.segments : []).map(function(segment) {
      return {
        start: Math.max(Number(segment.start) || 0, 0),
        end: Math.max(Number(segment.end) || 0, 0),
        rawText: String(segment.rawText || segment.text || '').trim().slice(0, 4000),
        text: String(segment.text || '').trim().slice(0, 4000),
        avgLogProbability: finiteOrNull(segment.avgLogProbability),
        noSpeechProbability: finiteOrNull(segment.noSpeechProbability),
        compressionRatio: finiteOrNull(segment.compressionRatio)
      };
    }).filter(function(segment) { return segment.text && segment.end >= segment.start; }).slice(0, 10000)
  };
}

function sanitizedArchiveMetadata(result = {}) {
  const verificationMode = ['historical_sha256', 'current_content_id']
    .includes(String(result.verificationMode || '')) ? String(result.verificationMode) : '';
  return {
    status: 'complete',
    localAssetPath: String(result.localAssetPath || result.mediaMetadata && result.mediaMetadata.localAssetPath || '').slice(0, 2000),
    mediaSha256: String(result.mediaSha256 || result.sha256 || '').toLowerCase().slice(0, 64),
    mediaBytes: Math.max(Number(result.mediaBytes == null ? result.bytes : result.mediaBytes) || 0, 0),
    mediaContentType: String(result.mediaContentType || result.mimeType || '').slice(0, 120),
    archivedAt: String(result.archivedAt || new Date().toISOString()),
    verificationMode
  };
}

function applyMediaArchive(channelId, contentId, result = {}) {
  const existing = expertChannels.findObservationByIdentity(channelId, { externalContentId: contentId });
  if (!existing || existing.evidenceLevel !== 'primary') throw new Error('找不到身份已核验的抖音视频记录。');
  const archive = sanitizedArchiveMetadata(result);
  if (!archive.localAssetPath || !/^[a-f0-9]{64}$/.test(archive.mediaSha256) || !archive.mediaBytes) {
    throw new Error('本地媒体归档证据不完整。');
  }
  return expertChannels.recordObservation(channelId, {
    externalKey: existing.externalKey,
    archiveStatus: 'downloaded',
    localAssetPath: archive.localAssetPath,
    mediaMetadata: Object.assign({}, existing.mediaMetadata || {}, { archive }),
    lastSeenAt: existing.lastSeenAt
  });
}

function applyTranscription(channelId, contentId, result = {}) {
  const channel = expertChannels.getChannel(channelId);
  const existing = expertChannels.findObservationByIdentity(channel.id, { externalContentId: contentId });
  if (!existing || existing.evidenceLevel !== 'primary') throw new Error('找不到身份已核验的抖音视频记录。');
  const transcript = String(result.transcript || '').trim();
  if (!transcript) throw new Error('语音识别结果为空。');
  const asr = sanitizedAsrMetadata(result);
  const reviewed = existing.mediaMetadata?.asr?.manualReview;
  if (reviewed && reviewed.mediaSha256 === asr.mediaSha256 &&
      reviewed.approvedBodyHash === crypto.createHash('sha256').update(existing.transcript || '').digest('hex')) {
    // A repeat ASR pass over the same archived media is not allowed to replace a human correction.
    return expertChannels.recordObservation(channel.id, { externalKey: existing.externalKey,
      mediaMetadata: { ...existing.mediaMetadata, lastAsrAttempt: asr }, lastSeenAt: asr.transcribedAt });
  }
  const transcriptHistory = [...(existing.mediaMetadata?.transcriptHistory || [])];
  if (existing.transcript && existing.transcript !== transcript) {
    transcriptHistory.push({ text: existing.transcript, asr: existing.mediaMetadata?.asr || {} });
  }
  const previousArchive = existing.mediaMetadata && existing.mediaMetadata.archive || {};
  const preservesHistoricalVerification = previousArchive.verificationMode === 'historical_sha256' &&
    previousArchive.mediaSha256 === asr.mediaSha256 &&
    Number(previousArchive.mediaBytes || 0) === Number(asr.mediaBytes || 0);
  const signal = analyzeInvestmentText({
    title: existing.title,
    description: existing.description,
    transcript,
    summary: existing.summary,
    hashtags: topicsWithoutPreviousSignal(existing)
  });
  const topics = mergeUnique(topicsWithoutPreviousSignal(existing), signal.topics);
  return expertChannels.recordObservation(channel.id, {
    externalKey: existing.externalKey,
    contentRole: 'transcript',
    content: transcript,
    transcript,
    mediaMetadata: Object.assign({}, existing.mediaMetadata || {}, {
      asr,
      transcriptHistory,
      archive: asr.localAssetPath ? sanitizedArchiveMetadata({
        localAssetPath: asr.localAssetPath,
        mediaSha256: asr.mediaSha256,
        mediaBytes: asr.mediaBytes,
        mediaContentType: asr.mediaContentType,
        archivedAt: preservesHistoricalVerification ? previousArchive.archivedAt : asr.transcribedAt,
        verificationMode: preservesHistoricalVerification ? 'historical_sha256' : 'current_content_id'
      }) : previousArchive
    }),
    archiveStatus: asr.localAssetPath ? 'downloaded' : existing.archiveStatus,
    localAssetPath: asr.localAssetPath || existing.localAssetPath,
    signal,
    stockCodes: signal.stockCodes,
    sectors: signal.sectors,
    topics,
    stance: signal.stance,
    horizon: signal.horizon,
    confidence: Math.max(Number(existing.confidence) || 0, 0.92),
    analysisNotes: generatedAnalysisNotes(signal),
    lastSeenAt: asr.transcribedAt
  });
}

async function importCapturedPageAsync(channelId, input = {}) {
  const capture = normalizeDouyinPageSnapshot(input.capture || input);
  const db = require('../db');
  const trace = require('./runtimeDiagnostics');
  if (!capture.items.length) return importCapturedPage(channelId, capture);
  let result;
  for (let offset = 0; offset < capture.items.length; offset += 10) {
    // A transaction belongs to one synchronous batch, never across an await.
    await new Promise(resolve => setImmediate(resolve));
    const batch = trace.traceSync('douyin.capture.persist-batch', () => db.transaction(() =>
      importCapturedPage(channelId, { ...capture, items: capture.items.slice(offset, offset + 10) }))());
    if (!result) result = { ...batch, items: [], capturedCount: 0, addedCount: 0, updatedCount: 0, unchangedCount: 0 };
    for (const key of ['capturedCount', 'addedCount', 'updatedCount', 'unchangedCount']) result[key] += batch[key];
    result.items.push(...batch.items);
  }
  return result;
}

function applyNoteResult(channelId, contentId, result = {}) {
  const existing = expertChannels.findObservationByIdentity(channelId, { externalContentId: contentId });
  if (!existing || existing.evidenceLevel !== 'primary' || existing.mediaType !== 'note') {
    throw new Error('找不到身份已核验的抖音图文记录');
  }
  const note = {schemaVersion:1,engine:'windows-ocr',processedAt:new Date().toISOString(),
    imageCount:Math.min(Math.max(Math.floor(Number(result.imageCount)||0),0),1000),
    status:['needs_review','no_text','partial'].includes(result.status) ? result.status : 'partial',
    pages:(Array.isArray(result.pages)?result.pages:[]).slice(0,50).map((page,index)=>({index:index+1,
      status:['recognized','no_text'].includes(page.status)?page.status:'error',text:String(page.text||'').trim().slice(0,100000),
      rawText:String(page.rawText||page.text||'').trim().slice(0,100000),
      localAssetPath:String(page.localAssetPath||'').slice(0,2000),sha256:String(page.sha256||'').slice(0,64),
      bytes:Math.max(Number(page.bytes)||0,0),mimeType:String(page.mimeType||'').slice(0,80),
      message:String(page.message||'').replace(/https?:\/\/\S+/g,'[图片地址]').slice(0,400)}))};
  const previous = existing.mediaMetadata && existing.mediaMetadata.note;
  const previousPages = previous && previous.pages || [];
  const attempt = JSON.parse(JSON.stringify(note));
  if (previous?.status === 'reviewed' && note.status === 'needs_review' &&
      note.imageCount === previous.imageCount && note.pages.length === previousPages.length &&
      note.pages.every((page, index) => page.index === previousPages[index].index &&
        /^[a-f0-9]{64}$/.test(page.sha256) && page.sha256 === previousPages[index].sha256)) {
    // Re-running OCR on the same archived images must not discard human corrections.
    note.pages = previousPages;
    note.status = 'reviewed';
    note.review = previous.review;
  }
  // An unsuccessful refresh must not erase earlier images or recognized text.
  if (previous && note.status==='partial') {
    note.imageCount=Math.max(note.imageCount,previous.imageCount||0);
    note.pages=Array.from({length:Math.min(note.imageCount,50)},(_,index)=>{
      const current=note.pages[index], old=previousPages[index];
      if (old && (!current || current.status==='error') && (old.text || old.localAssetPath)) {
        return Object.assign({},old,{preservedFromPrior:true,attemptMessage:current&&current.message||'本次未成功读取'});
      }
      return current || {index:index+1,status:'error',text:'',message:'本次未成功读取'};
    });
  }
  const content = [existing.description ? '作者配文：\n'+existing.description : '',
    ...note.pages.filter(page=>page.text).map(page=>'【图片 '+page.index+' · OCR '+(note.status==='reviewed'?'已校对':'待校对')+'】\n'+page.text)].filter(Boolean).join('\n\n');
  const history = (existing.mediaMetadata && existing.mediaMetadata.noteHistory || []).slice();
  const pageSignature=pages=>JSON.stringify(pages.map(page=>[page.index,page.sha256,page.text]));
  if (previousPages.some(page=>page.text) && pageSignature(previousPages)!==pageSignature(note.pages)) history.push(previous);
  const signal = analyzeInvestmentText({title:existing.title,description:content,hashtags:topicsWithoutPreviousSignal(existing)});
  return expertChannels.recordObservation(channelId,{externalKey:existing.externalKey,
    content:content || existing.content, contentRole:'direct_quote',
    archiveStatus:note.pages.length===note.imageCount && note.pages.every(page=>page.localAssetPath)?'downloaded':existing.archiveStatus,
    mediaMetadata:Object.assign({},existing.mediaMetadata,{note,noteHistory:history,lastNoteAttempt:note.status==='partial'?attempt:null}),signal,
    stockCodes:signal.stockCodes,sectors:signal.sectors,topics:mergeUnique(topicsWithoutPreviousSignal(existing),signal.topics),
    analysisNotes:generatedAnalysisNotes(signal),lastSeenAt:existing.lastSeenAt});
}

function applyNoSpeechResult(channelId, contentId, result = {}) {
  const existing = expertChannels.findObservationByIdentity(channelId, { externalContentId: contentId });
  if (!existing || existing.evidenceLevel !== 'primary') throw new Error('找不到身份已核验的抖音视频记录。');
  const asr = Object.assign({}, sanitizedAsrMetadata(result), {
    status: 'no_speech',
    message: '本地语音识别未检测到可转写的口语；视频已永久归档。'
  });
  const archive = sanitizedArchiveMetadata({
    localAssetPath: asr.localAssetPath,
    mediaSha256: asr.mediaSha256,
    mediaBytes: asr.mediaBytes,
    mediaContentType: asr.mediaContentType,
    archivedAt: asr.transcribedAt,
    verificationMode: 'current_content_id'
  });
  if (!archive.localAssetPath || !/^[a-f0-9]{64}$/.test(archive.mediaSha256) || !archive.mediaBytes) {
    throw new Error('无口语视频的本地归档证据不完整。');
  }
  if (existing.transcript && ['complete', 'needs_review'].includes(existing.mediaMetadata?.asr?.status)) {
    return expertChannels.recordObservation(channelId, {
      externalKey: existing.externalKey,
      mediaMetadata: Object.assign({}, existing.mediaMetadata || {}, { lastAsrAttempt: asr })
    });
  }
  return expertChannels.recordObservation(channelId, {
    externalKey: existing.externalKey,
    transcript: '',
    mediaMetadata: Object.assign({}, existing.mediaMetadata || {}, { asr, archive }),
    archiveStatus: 'downloaded',
    localAssetPath: archive.localAssetPath,
    lastSeenAt: asr.transcribedAt
  });
}

function recordTranscriptionError(channelId, contentId, error) {
  const existing = expertChannels.findObservationByIdentity(channelId, { externalContentId: contentId });
  if (!existing || existing.evidenceLevel !== 'primary') return null;
  return expertChannels.recordObservation(channelId, {
    externalKey: existing.externalKey,
    mediaMetadata: Object.assign({}, existing.mediaMetadata || {}, {
      [existing.transcript && ['complete', 'needs_review'].includes(existing.mediaMetadata?.asr?.status) ? 'lastAsrAttempt' : 'asr']: {
        status: 'error',
        message: String(error && error.message || error || '本地语音识别失败').slice(0, 500),
        attemptedAt: new Date().toISOString()
      }
    })
  });
}

function recordTranscriptionUnavailable(channelId, contentId, message) {
  const existing = expertChannels.findObservationByIdentity(channelId, { externalContentId: contentId });
  if (!existing || existing.evidenceLevel !== 'primary') return null;
  return expertChannels.recordObservation(channelId, {
    externalKey: existing.externalKey,
    mediaMetadata: Object.assign({}, existing.mediaMetadata || {}, {
      asr: {
        status: 'media_missing',
        message: String(message || '详情页未提供可下载的 HTTPS 媒体地址').slice(0, 500),
        checkedAt: new Date().toISOString()
      }
    })
  });
}

function recordRemoteUnavailable(channelId, contentId, error, failureCount, options = {}) {
  const existing = expertChannels.findObservationByIdentity(channelId, { externalContentId: contentId });
  if (!existing) return null;
  const checkedAt = new Date().toISOString();
  const remoteStatus = options.reason === 'identity_rejected' ? 'identity_rejected' : 'unavailable';
  return expertChannels.recordObservation(channelId, {
    externalKey: existing.externalKey,
    availabilityStatus: 'unavailable',
    mediaMetadata: Object.assign({}, existing.mediaMetadata || {}, {
      remote: {
        status: remoteStatus,
        checkedAt,
        consecutiveFailures: Math.max(Number(failureCount) || 1, 1),
        message: String(error && error.message || error || '远端详情暂不可用').slice(0, 500)
      }
    }),
    lastSeenAt: existing.lastSeenAt
  });
}

module.exports = {
  normalizeDouyinLink,
  extractDouyinShareLinks,
  douyinPlayerUrl,
  importDouyinLinks,
  inspectCapturedPage,
  importCapturedPage,
  importCapturedPageAsync,
  verifyCapturedIdentity,
  reanalyzeChannelObservations,
  applyMediaArchive,
  applyTranscription,
  applyNoteResult,
  applyNoSpeechResult,
  recordRemoteUnavailable,
  recordTranscriptionUnavailable,
  recordTranscriptionError
};
