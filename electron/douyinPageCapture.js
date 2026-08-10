const MAX_ITEMS = 200;

function cleanText(value, maxLength = 1000) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function isAllowedDouyinUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === 'https:' && (host === 'douyin.com' || host.endsWith('.douyin.com'));
  } catch (error) {
    return false;
  }
}

function parseDouyinItemUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch (error) {
    return null;
  }
  if (!isAllowedDouyinUrl(parsed.href)) return null;

  const host = parsed.hostname.toLowerCase();
  const pathMatch = parsed.pathname.match(/\/(?:m\/)?(video|note)\/(\d{12,24})(?:\/|$)/i);
  const playerId = host === 'open.douyin.com' && /^\/player\/video\/?$/i.test(parsed.pathname)
    ? String(parsed.searchParams.get('vid') || '')
    : '';
  const overlayId = String(parsed.searchParams.get('modal_id') || parsed.searchParams.get('aweme_id') || '');
  const mediaType = pathMatch ? pathMatch[1].toLowerCase() : 'video';
  const contentId = pathMatch ? pathMatch[2]
    : /^\d{12,24}$/.test(playerId) ? playerId
      : /^\d{12,24}$/.test(overlayId) ? overlayId : '';
  if (!contentId) return null;
  return {
    sourceUrl: 'https://www.douyin.com/' + mediaType + '/' + contentId,
    contentId,
    mediaType
  };
}

function parseVisibleWorkCount(value) {
  const text = String(value || '').replace(/\s+/g, ' ');
  const match = text.match(/作品\s*([0-9]+(?:\.[0-9]+)?)(万|[wW])?/) ||
    text.match(/([0-9]+(?:\.[0-9]+)?)(万|[wW])?\s*(?:个?作品|作品)/);
  if (!match) return 0;
  return Math.round(Number(match[1]) * (match[2] ? 10000 : 1));
}

function inferVisibleLoggedIn(value, hasVisibleLoginControl) {
  if (hasVisibleLoginControl) return false;
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (/通知\s+消息\s+投稿/.test(text)) return true;
  return !/(^|\s)登录(?:后查看)?(?=\s|$)/.test(text);
}

function normalizeVisibleUrl(value) {
  if (!isAllowedDouyinUrl(value)) return '';
  try {
    const parsed = new URL(String(value));
    parsed.hash = '';
    return parsed.href;
  } catch (error) {
    return '';
  }
}

function normalizeDouyinPageSnapshot(raw = {}) {
  const pageTypes = new Set(['profile', 'video', 'note', 'search', 'other']);
  const pageUrl = normalizeVisibleUrl(raw.pageUrl);
  if (!pageUrl) throw new Error('当前页面不是可采集的抖音 HTTPS 页面');

  const profileInput = raw.profile && typeof raw.profile === 'object' ? raw.profile : {};
  const profileUrl = normalizeVisibleUrl(profileInput.profileUrl);
  const profile = {
    displayName: cleanText(profileInput.displayName, 160),
    profileUrl,
    douyinId: cleanText(profileInput.douyinId, 160),
    workCount: Math.min(Math.max(Math.trunc(Number(profileInput.workCount) || 0), 0), 100000000)
  };

  const items = [];
  const seen = new Set();
  const sourceItems = Array.isArray(raw.items) ? raw.items : [];
  for (const source of sourceItems) {
    if (!source || typeof source !== 'object') continue;
    const parsed = parseDouyinItemUrl(source.sourceUrl);
    if (!parsed || seen.has(parsed.contentId)) continue;
    seen.add(parsed.contentId);
    items.push({
      sourceUrl: parsed.sourceUrl,
      contentId: parsed.contentId,
      mediaType: parsed.mediaType,
      title: cleanText(source.title, 300),
      author: cleanText(source.author, 160),
      publishedAt: cleanText(source.publishedAt, 80),
      summary: cleanText(source.summary, 10000)
    });
    if (items.length >= MAX_ITEMS) break;
  }

  let capturedAt = '';
  try {
    if (raw.capturedAt) capturedAt = new Date(raw.capturedAt).toISOString();
  } catch (error) {}
  if (!capturedAt) capturedAt = new Date().toISOString();

  return {
    pageType: pageTypes.has(String(raw.pageType)) ? String(raw.pageType) : 'other',
    pageUrl,
    loggedIn: raw.loggedIn === true,
    capturedAt,
    profile,
    items
  };
}

function douyinVisiblePageSnapshot(parseWorkCount, inferLoggedIn) {
  function compact(value, limit) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, limit);
  }

  function visible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
  }

  function firstText(selectors, limit) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const value = element && compact(element.textContent || element.getAttribute('content'), limit);
      if (value) return value;
    }
    return '';
  }

  function absoluteUrl(value) {
    try { return new URL(value, window.location.href).href; } catch (error) { return ''; }
  }

  function itemIdentity(value) {
    try {
      const parsed = new URL(value, window.location.href);
      const match = parsed.pathname.match(/\/(?:m\/)?(video|note)\/(\d{12,24})(?:\/|$)/i);
      if (!match) return null;
      return {
        sourceUrl: 'https://www.douyin.com/' + match[1].toLowerCase() + '/' + match[2],
        contentId: match[2],
        mediaType: match[1].toLowerCase()
      };
    } catch (error) {
      return null;
    }
  }

  const href = window.location.href;
  const pathname = window.location.pathname;
  const currentItem = itemIdentity(href);
  const pageType = /^\/user\//i.test(pathname) ? 'profile'
    : currentItem ? currentItem.mediaType
      : /^\/search\//i.test(pathname) ? 'search' : 'other';
  const bodyText = compact(document.body && document.body.innerText, 200000);
  const profileLink = document.querySelector('a[href*="/user/"]');
  const profileUrl = /^\/user\//i.test(pathname) ? href : absoluteUrl(profileLink && profileLink.getAttribute('href'));
  const displayName = firstText([
    '[data-e2e="user-title"]',
    '[data-e2e="video-author-name"]',
    'h1',
    'header h2'
  ], 160);
  const idMatch = bodyText.match(/抖音号\s*[：:]\s*([A-Za-z0-9_.-]{2,160})/);
  const workCount = parseWorkCount(bodyText);

  const itemsById = new Map();
  document.querySelectorAll('a[href*="/video/"], a[href*="/note/"]').forEach(function(anchor) {
    const identity = itemIdentity(anchor.href || anchor.getAttribute('href'));
    if (!identity || itemsById.has(identity.contentId)) return;
    const container = anchor.closest('li, article, [data-e2e], div');
    const title = compact(
      anchor.getAttribute('aria-label') || anchor.getAttribute('title') || anchor.textContent ||
      (container && container.textContent),
      300
    );
    itemsById.set(identity.contentId, Object.assign(identity, { title }));
  });

  if (currentItem) {
    const metaTitle = document.querySelector('meta[property="og:title"]');
    const title = firstText([
      '[data-e2e="video-desc"]',
      '[data-e2e="video-title"]',
      '[data-e2e="note-title"]',
      'main h1',
      'h1'
    ], 300) || compact(metaTitle && metaTitle.getAttribute('content'), 300) || compact(document.title, 300);
    const publishedMatch = bodyText.match(/发布时间\s*[：:]?\s*(\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}(?:日)?(?:\s+\d{1,2}:\d{2})?)/);
    const chapterMatch = bodyText.match(/章节要点\s*([\s\S]{1,10000}?)(?:内容由AI生成|免责声明|评论|相关推荐|$)/);
    itemsById.set(currentItem.contentId, Object.assign(currentItem, {
      title,
      author: displayName,
      publishedAt: publishedMatch ? compact(publishedMatch[1], 80) : '',
      summary: chapterMatch ? compact(chapterMatch[1], 10000) : ''
    }));
  }

  const loginRequired = Array.from(document.querySelectorAll('button, a, [role="button"]')).some(function(element) {
    const label = compact(element.textContent, 40);
    return visible(element) && (/^登录$/.test(label) || /登录后查看/.test(label));
  });

  return {
    pageType,
    pageUrl: href,
    loggedIn: inferLoggedIn(bodyText, loginRequired),
    capturedAt: new Date().toISOString(),
    profile: { displayName, profileUrl, douyinId: idMatch ? idMatch[1] : '', workCount },
    items: Array.from(itemsById.values()).slice(0, 200)
  };
}

function buildDouyinPageSnapshotScript() {
  return '(' + douyinVisiblePageSnapshot.toString() + ')(' +
    parseVisibleWorkCount.toString() + ',' + inferVisibleLoggedIn.toString() + ')';
}

module.exports = {
  isAllowedDouyinUrl,
  parseDouyinItemUrl,
  parseVisibleWorkCount,
  inferVisibleLoggedIn,
  normalizeDouyinPageSnapshot,
  buildDouyinPageSnapshotScript
};
