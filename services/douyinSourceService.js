const expertChannels = require('./expertChannelService');

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

  const pathMatch = parsed.pathname.match(/\/(?:m\/)?video\/(\d{12,24})(?:\/|$)/i);
  const playerId = host === 'open.douyin.com' && /^\/player\/video\/?$/i.test(parsed.pathname)
    ? String(parsed.searchParams.get('vid') || '')
    : '';
  const overlayId = String(parsed.searchParams.get('modal_id') || parsed.searchParams.get('aweme_id') || '');
  const videoId = pathMatch ? pathMatch[1]
    : /^\d{12,24}$/.test(playerId) ? playerId
      : /^\d{12,24}$/.test(overlayId) ? overlayId : '';
  if (videoId) {
    return {
      sourceUrl: 'https://www.douyin.com/video/' + videoId,
      videoId,
      kind: 'video'
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

module.exports = {
  normalizeDouyinLink,
  extractDouyinShareLinks,
  douyinPlayerUrl,
  importDouyinLinks
};
