const MAX_ITEMS = 1000;

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

function extractDouyinMediaCandidates(payload = {}, contentId) {
  const targetId = String(contentId || '').trim();
  if (!/^\d{12,24}$/.test(targetId)) return [];

  const mediaHostSuffixes = [
    'douyinvod.com',
    'zjcdn.com',
    'bytecdn.cn',
    'douyin.com',
    'amemv.com',
    'snssdk.com'
  ];

  function approvedMediaUrl(value) {
    try {
      const parsed = new URL(String(value || ''));
      const host = parsed.hostname.toLowerCase();
      if (parsed.protocol !== 'https:') return '';
      if (!mediaHostSuffixes.some(function(suffix) {
        return host === suffix || host.endsWith('.' + suffix);
      })) return '';
      return parsed.href;
    } catch (error) {
      return '';
    }
  }

  function awemeId(value) {
    if (!value || typeof value !== 'object') return '';
    return String(value.aweme_id || value.aweme_id_str || value.group_id || value.group_id_str || '').trim();
  }

  function bytes(value, fallback, lastFallback) {
    const choices = [value, fallback, lastFallback];
    for (const choice of choices) {
      if (choice == null || choice === '') continue;
      const number = Number(choice);
      if (Number.isFinite(number) && number >= 0) return Math.round(number);
    }
    return 0;
  }

  function quality(value, fallback) {
    const text = String(value == null || value === '' ? fallback || '' : value).trim();
    return text.slice(0, 160);
  }

  const awemeDetails = [];
  function appendDetail(value) {
    if (value && typeof value === 'object' && awemeId(value) === targetId) awemeDetails.push(value);
  }
  appendDetail(payload && payload.aweme_detail);
  appendDetail(payload && payload.data && payload.data.aweme_detail);
  ['aweme_list', 'item_list'].forEach(function(key) {
    (Array.isArray(payload && payload[key]) ? payload[key] : []).forEach(appendDetail);
    (Array.isArray(payload && payload.data && payload.data[key]) ? payload.data[key] : []).forEach(appendDetail);
  });

  const result = [];
  const seen = new Set();
  function appendAddress(address, source, qualityLabel, fallbackBytes, videoBytes) {
    if (!address || typeof address !== 'object') return;
    const urls = Array.isArray(address.url_list) ? address.url_list
      : typeof address.url === 'string' ? [address.url] : [];
    urls.forEach(function(value) {
      const url = approvedMediaUrl(value);
      if (!url || seen.has(url)) return;
      seen.add(url);
      result.push({
        url,
        bytes: bytes(address.data_size, fallbackBytes, videoBytes),
        source,
        quality: quality(address.gear_name || address.quality_type, qualityLabel)
      });
    });
  }

  awemeDetails.forEach(function(detail) {
    const video = detail.video && typeof detail.video === 'object' ? detail.video : {};
    (Array.isArray(video.bit_rate) ? video.bit_rate : []).forEach(function(rendition) {
      if (!rendition || typeof rendition !== 'object') return;
      const qualityLabel = rendition.gear_name || rendition.quality_type || rendition.bit_rate || video.ratio || 'bit_rate';
      appendAddress(rendition.play_addr_h264, 'bit_rate', qualityLabel, rendition.data_size, video.data_size);
      appendAddress(rendition.play_addr, 'bit_rate', qualityLabel, rendition.data_size, video.data_size);
    });
    appendAddress(video.play_addr_h264, 'play_addr_h264', video.ratio || 'h264', null, video.data_size);
    appendAddress(video.play_addr, 'play_addr', video.ratio || 'default', null, video.data_size);
    appendAddress(video.download_addr, 'download_addr', video.ratio || 'download', null, video.data_size);
  });
  return result;
}

function buildDouyinMediaProbeScript(contentId) {
  const targetId = String(contentId || '').trim();
  if (!/^\d{12,24}$/.test(targetId)) return 'Promise.resolve([])';
  return '(async function(extract, targetId) {' +
    'if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function" || typeof fetch !== "function") return [];' +
    'const detailUrls = [];' +
    'const seenRequests = new Set();' +
    'for (let poll = 0; poll < 20 && !detailUrls.length; poll += 1) {' +
      'const entries = performance.getEntriesByType("resource") || [];' +
      'for (const entry of entries) {' +
        'const value = String(entry && entry.name || "");' +
        'let parsed;' +
        'try { parsed = new URL(value); } catch (error) { continue; }' +
        'const host = parsed.hostname.toLowerCase();' +
        'if (parsed.protocol !== "https:" || !(host === "douyin.com" || host.endsWith(".douyin.com"))) continue;' +
        'if (!/^\\/aweme\\/v1\\/web\\/aweme\\/detail\\/?$/.test(parsed.pathname)) continue;' +
        'if (String(parsed.searchParams.get("aweme_id") || "") !== targetId) continue;' +
        'if (seenRequests.has(value)) continue;' +
        'seenRequests.add(value);' +
        'detailUrls.push(value);' +
      '}' +
      'if (!detailUrls.length && poll < 19 && typeof setTimeout === "function") {' +
        'await new Promise(function(resolve) { setTimeout(resolve, 500); });' +
      '}' +
    '}' +
    'const candidates = [];' +
    'const seenMedia = new Set();' +
    'for (const url of detailUrls) {' +
      'try {' +
        'const response = await fetch(url, { credentials: "include" });' +
        'if (!response || response.ok === false || typeof response.json !== "function") continue;' +
        'const extracted = extract(await response.json(), targetId);' +
        'for (const candidate of extracted) {' +
          'if (!candidate || seenMedia.has(candidate.url)) continue;' +
          'seenMedia.add(candidate.url);' +
          'candidates.push(candidate);' +
        '}' +
      '} catch (error) {}' +
    '}' +
    'return candidates;' +
  '})(' + extractDouyinMediaCandidates.toString() + ',' + JSON.stringify(targetId) + ')';
}

function parseVisibleWorkCount(value) {
  const text = String(value || '').replace(/\s+/g, ' ');
  const match = text.match(/作品\s*([0-9]+(?:\.[0-9]+)?)(万|[wW])?/) ||
    text.match(/([0-9]+(?:\.[0-9]+)?)(万|[wW])?\s*(?:个?作品|作品)/);
  if (!match) return 0;
  return Math.round(Number(match[1]) * (match[2] ? 10000 : 1));
}

function parseVisibleMetricCount(value) {
  const text = String(value == null ? '' : value).replace(/,/g, '').trim().toLowerCase();
  const match = text.match(/([0-9]+(?:\.[0-9]+)?)\s*(万|w)?/i);
  if (!match) return null;
  const number = Number(match[1]) * (match[2] ? 10000 : 1);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function inferVisibleLoggedIn(value, hasVisibleLoginControl) {
  if (hasVisibleLoginControl) return false;
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (/通知\s+消息\s+投稿/.test(text)) return true;
  return !/(^|\s)登录(?:后查看)?(?=\s|$)/.test(text);
}

function selectVisibleProfileCandidate(links, currentPageUrl, isItemPage) {
  function normalizedProfile(value) {
    try {
      const parsed = new URL(String(value || ''));
      const host = parsed.hostname.toLowerCase();
      const match = parsed.pathname.match(/^\/user\/([^/]+)\/?$/i);
      if (parsed.protocol !== 'https:' || !(host === 'douyin.com' || host.endsWith('.douyin.com')) || !match) return '';
      if (match[1].toLowerCase() === 'self') return '';
      return 'https://www.douyin.com/user/' + match[1];
    } catch (error) {
      return '';
    }
  }

  const candidates = (Array.isArray(links) ? links : []).map(function(item) {
    return {
      profileUrl: normalizedProfile(item && item.href),
      displayName: String(item && item.text || '').replace(/\s+/g, ' ').trim().slice(0, 160)
    };
  }).filter(function(item) { return item.profileUrl; });
  const currentProfile = isItemPage ? '' : normalizedProfile(currentPageUrl);
  const profileUrl = currentProfile || (candidates[0] && candidates[0].profileUrl) || '';
  if (!profileUrl) return { profileUrl: '', displayName: '' };
  const named = candidates.find(function(item) {
    return item.profileUrl === profileUrl && item.displayName;
  });
  return { profileUrl, displayName: named ? named.displayName : '' };
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

function normalizeHttpsUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'https:' ? parsed.href : '';
  } catch (error) {
    return '';
  }
}

function normalizeStringArray(value, maxItems = 30, maxLength = 100) {
  return (Array.isArray(value) ? value : []).map(function(item) {
    return cleanText(item, maxLength).replace(/^#/, '');
  }).filter(Boolean).filter(function(item, index, items) {
    return items.indexOf(item) === index;
  }).slice(0, maxItems);
}

function normalizeEngagement(value) {
  const source = value && typeof value === 'object' ? value : {};
  const result = {};
  ['likes', 'comments', 'favorites', 'shares', 'plays'].forEach(function(key) {
    const number = Number(source[key]);
    if (Number.isFinite(number) && number >= 0) result[key] = Math.round(number);
  });
  return result;
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
    const normalizedItem = {
      sourceUrl: parsed.sourceUrl,
      contentId: parsed.contentId,
      mediaType: parsed.mediaType,
      title: cleanText(source.title, 300),
      author: cleanText(source.author, 160),
      publishedAt: cleanText(source.publishedAt, 80),
      description: cleanText(source.description, 20000),
      transcript: cleanText(source.transcript, 200000),
      summary: cleanText(source.summary, 20000),
      hashtags: normalizeStringArray(source.hashtags),
      engagement: normalizeEngagement(source.engagement),
      coverUrl: normalizeHttpsUrl(source.coverUrl),
      durationSeconds: Math.min(Math.max(Number(source.durationSeconds) || 0, 0), 86400)
    };
    if ((raw.pageType === 'video' || raw.pageType === 'note') && source.contentId !== '') {
      normalizedItem.mediaUrl = normalizeHttpsUrl(source.mediaUrl);
    }
    items.push(normalizedItem);
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
    loadError: raw.loadError === true,
    capturedAt,
    profile,
    items
  };
}

function douyinVisiblePageSnapshot(parseWorkCount, parseMetricCount, inferLoggedIn, selectProfile) {
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

  function firstAttribute(selectors, attribute, limit) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const value = element && compact(element.getAttribute(attribute), limit);
      if (value) return value;
    }
    return '';
  }

  function visibleTextList(selectors, limit) {
    const values = [];
    selectors.forEach(function(selector) {
      document.querySelectorAll(selector).forEach(function(element) {
        if (!visible(element)) return;
        const value = compact(element.textContent, limit);
        if (value && !values.includes(value)) values.push(value);
      });
    });
    return values;
  }

  function visibleCount(selectors, fallbackLabel) {
    const value = firstText(selectors, 80);
    const direct = parseMetricCount(value);
    if (direct != null) return direct;
    const pattern = new RegExp(fallbackLabel + '\\s*[：:]?\\s*([0-9]+(?:\\.[0-9]+)?(?:万|[wW])?)');
    const match = bodyText.match(pattern);
    return match ? parseMetricCount(match[1]) : null;
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
  const profileLinks = Array.from(document.querySelectorAll('a[href*="/user/"]')).map(function(anchor) {
    return { href: absoluteUrl(anchor.getAttribute('href')), text: compact(anchor.textContent, 160) };
  });
  const selectedProfile = selectProfile(profileLinks, href, Boolean(currentItem));
  const profileUrl = selectedProfile.profileUrl;
  const displayName = currentItem
    ? selectedProfile.displayName || firstText(['[data-e2e="video-author-name"]', 'main header h2'], 160)
    : firstText(['[data-e2e="user-title"]', 'h1', 'header h2'], 160) || selectedProfile.displayName;
  const idMatch = bodyText.match(/抖音号\s*[：:]\s*([A-Za-z0-9_.-]{2,160})/);
  const workCount = parseWorkCount(bodyText);

  const itemsById = new Map();
  if (!currentItem) {
    const itemRoot = pageType === 'profile' ? document.querySelector('[data-e2e="user-post-list"]') : document;
    if (itemRoot) itemRoot.querySelectorAll('a[href*="/video/"], a[href*="/note/"]').forEach(function(anchor) {
      const identity = itemIdentity(anchor.href || anchor.getAttribute('href'));
      if (!identity || itemsById.has(identity.contentId)) return;
      const container = anchor.closest('li, article, [data-e2e], div');
      const image = anchor.querySelector('img[alt]');
      const title = compact(
        anchor.getAttribute('aria-label') || anchor.getAttribute('title') ||
        (image && image.getAttribute('alt')) || anchor.textContent || (container && container.textContent),
        300
      );
      itemsById.set(identity.contentId, Object.assign(identity, {
        title
      }));
    });
  }

  if (currentItem) {
    const video = document.querySelector('video');
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
    const description = firstText(['[data-e2e="video-desc"]', '[data-e2e="video-title"]', '[data-e2e="note-desc"]'], 20000) ||
      firstAttribute(['meta[property="og:description"]', 'meta[name="description"]'], 'content', 20000);
    const transcript = visibleTextList([
      '[data-e2e*="subtitle"]',
      '[data-e2e*="caption"]',
      '[class*="subtitle"]',
      '[class*="caption"]'
    ], 20000).join('\n').slice(0, 200000);
    const hashtagValues = Array.from(document.querySelectorAll('a[href*="/search/"]')).map(function(anchor) {
      const value = compact(anchor.textContent, 100);
      return /^#/.test(value) ? value.slice(1) : '';
    }).filter(Boolean);
    const engagement = {
      likes: visibleCount(['[data-e2e="video-player-digg"]', '[data-e2e="video-digg-count"]', '[data-e2e*="like-count"]'], '点赞'),
      comments: visibleCount(['[data-e2e="feed-comment-icon"]', '[data-e2e="video-comment-count"]', '[data-e2e*="comment-count"]'], '评论'),
      favorites: visibleCount(['[data-e2e="video-player-collect"]', '[data-e2e="video-collect-count"]', '[data-e2e*="collect-count"]'], '收藏'),
      shares: visibleCount(['[data-e2e="video-player-share"]', '[data-e2e="video-share-count"]', '[data-e2e*="share-count"]'], '分享'),
      plays: visibleCount(['[data-e2e="video-play-count"]', '[data-e2e*="play-count"]'], '播放')
    };
    Object.keys(engagement).forEach(function(key) {
      if (engagement[key] == null) delete engagement[key];
    });
    const durationRaw = firstAttribute(['meta[property="video:duration"]'], 'content', 30);
    itemsById.set(currentItem.contentId, Object.assign(currentItem, {
      title,
      author: displayName,
      publishedAt: publishedMatch ? compact(publishedMatch[1], 80) : '',
      description,
      transcript,
      summary: chapterMatch ? compact(chapterMatch[1], 20000) : '',
      hashtags: hashtagValues,
      engagement,
      coverUrl: firstAttribute(['meta[property="og:image"]'], 'content', 2000),
      durationSeconds: Number(durationRaw) || 0,
      mediaUrl: compact(video && (video.currentSrc || video.src), 4000)
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
    loadError: /服务异常[，,]?\s*重新刷新拉取数据/.test(bodyText),
    capturedAt: new Date().toISOString(),
    profile: { displayName, profileUrl, douyinId: idMatch ? idMatch[1] : '', workCount },
    items: Array.from(itemsById.values()).slice(0, 1000)
  };
}

function buildDouyinPageSnapshotScript() {
  return '(' + douyinVisiblePageSnapshot.toString() + ')(' +
    parseVisibleWorkCount.toString() + ',' + parseVisibleMetricCount.toString() + ',' + inferVisibleLoggedIn.toString() + ',' +
    selectVisibleProfileCandidate.toString() + ')';
}

module.exports = {
  isAllowedDouyinUrl,
  parseDouyinItemUrl,
  extractDouyinMediaCandidates,
  buildDouyinMediaProbeScript,
  parseVisibleWorkCount,
  parseVisibleMetricCount,
  inferVisibleLoggedIn,
  selectVisibleProfileCandidate,
  normalizeDouyinPageSnapshot,
  buildDouyinPageSnapshotScript
};
