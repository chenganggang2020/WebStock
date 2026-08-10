const expertChannels = require('./expertChannelService');
const { normalizeDouyinPageSnapshot } = require('../electron/douyinPageCapture');

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = /[)\]}>，。；;！？!?、]+$/u;

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

function normalizedPublishedAt(value, fallback) {
  const raw = String(value || fallback || '').trim();
  if (!raw) return '';
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function comparableObservation(item) {
  return JSON.stringify({
    sourceUrl: item.sourceUrl || '',
    title: item.title || '',
    author: item.author || '',
    publishedAt: item.publishedAt || '',
    evidenceLevel: item.evidenceLevel || '',
    availabilityStatus: item.availabilityStatus || '',
    contentRole: item.contentRole || '',
    summary: item.summary || '',
    topics: item.topics || [],
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
      ? '已在登录后的抖音公开页面确认该作品属于“' + channel.displayName + '”；当前页面未提供可可靠提取的正文摘要。'
      : existingSummary || '从当前抖音页面采集到公开作品链接，作者身份尚未与研究对象核验一致。');
  const topics = mergeUnique(existing && existing.topics, [
    '抖音登录会话同步',
    matched ? '身份已匹配' : '身份待核验'
  ]);

  return {
    externalContentId: item.contentId,
    sourceUrl: item.sourceUrl,
    title,
    author: matched ? channel.displayName : '待核验抖音账号',
    publishedAt: normalizedPublishedAt(item.publishedAt, existing && existing.publishedAt),
    evidenceLevel: matched ? 'primary' : 'commentary',
    availabilityStatus: matched ? 'available' : 'unknown',
    contentRole: 'fact_summary',
    mediaType: item.mediaType,
    archiveStatus: 'linked',
    rightsBasis: 'quotation_only',
    summary,
    topics,
    stance: existing && existing.stance || 'unknown',
    horizon: existing && existing.horizon || 'unspecified',
    confidence: matched ? (identity.matchType === 'profile_url' ? 0.85 : 0.7) : 0.2,
    stockCodes: existing && existing.stockCodes || [],
    sectors: existing && existing.sectors || [],
    lastSeenAt: capture.capturedAt
  };
}

function importCapturedPage(channelId, input = {}) {
  const channel = expertChannels.getChannel(channelId);
  if (channel.platform !== 'douyin') throw new Error('只有抖音创作者频道可以同步抖音页面');
  const capture = normalizeDouyinPageSnapshot(input.capture || input);
  const identity = captureIdentity(channel, capture);
  const items = [];
  let addedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;

  capture.items.forEach(item => {
    const existing = expertChannels.findObservationByIdentity(channel.id, {
      externalContentId: item.contentId,
      sourceUrl: item.sourceUrl
    });
    const observationInput = capturedObservationInput(channel, capture, identity, item, existing);
    if (existing && comparableObservation(existing) === comparableObservation(observationInput)) {
      unchangedCount += 1;
      items.push(existing);
      return;
    }
    const saved = expertChannels.recordObservation(channel.id, observationInput);
    if (existing) updatedCount += 1;
    else addedCount += 1;
    items.push(saved);
  });

  return {
    pageUrl: capture.pageUrl,
    pageType: capture.pageType,
    loggedIn: capture.loggedIn,
    identityMatched: identity.matched,
    identityMatchType: identity.matchType,
    capturedCount: capture.items.length,
    addedCount,
    updatedCount,
    unchangedCount,
    items
  };
}

module.exports = {
  normalizeDouyinLink,
  extractDouyinShareLinks,
  douyinPlayerUrl,
  importDouyinLinks,
  importCapturedPage
};
