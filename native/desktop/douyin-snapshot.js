// Generated from the legacy visible-page extractor plus strict native media binding. No cookies or fetch.
(function bindEmbeddedMedia(snapshot, extract) {
  // Counts and known field names only; never export script bodies or signed URLs.
  const scripts = Array.from(document.querySelectorAll('script'));
  const currentId = new URL(snapshot.pageUrl).pathname.match(/^\/(?:video|note)\/(\d{12,24})\/?$/)?.[1];
  snapshot.structure = {scripts: scripts.length, inlineScripts: 0, matchingScripts: [],
    authorLabels: document.querySelectorAll('[data-e2e="video-author-name"], [data-e2e="note-author-name"]').length};
  let diagnosticBudget = 4000000;
  for (let index = 0; index < Math.min(scripts.length, 200); index++) {
    const script = scripts[index]; if (script.src) continue;
    ++snapshot.structure.inlineScripts;
    const text = String(script.textContent || '').trim();
    if (text.length > 2000000 || (diagnosticBudget -= text.length) < 0) break;
    if (!currentId || !text.includes(currentId) || snapshot.structure.matchingScripts.length >= 8) continue;
    const row = {index, bytes:text.length, pace:text.startsWith('self.__pace_f.push('),
      keys:Array.from(new Set(text.match(/(?:aweme_id_str|aweme_id|awemeId|sec_uid|secUid|authorInfo|author|play_addr|playAddr|url_list|urlList)/g) || []))};
    try {
      const frame = text.match(/^self\.__pace_f\.push\((\[[\s\S]*\])\);?\s*$/);
      let serialized = text;
      if (frame) { const part = JSON.parse(frame[1]); row.frameType = part[0]; serialized = part[1]; row.frameLines = typeof serialized === 'string' ? serialized.split('\n').length : 0; serialized = serialized.replace(/^[0-9a-f]+:/i, '').trim(); }
      const payload = JSON.parse(serialized.startsWith('%') ? decodeURIComponent(serialized) : serialized);
      row.json = true; row.rootType = Array.isArray(payload) ? 'array' : typeof payload;
      row.workShapes = [];
      let checked = 0;
      const shape = value => value && typeof value === 'object'
        ? Object.keys(value).filter(key => /^[A-Za-z_][A-Za-z0-9_]{0,47}$/.test(key)).slice(0,40) : [];
      function inspect(value, depth) {
        if (!value || typeof value !== 'object' || depth > 30 || ++checked > 20000 || row.workShapes.length >= 3) return;
        if (String(value.aweme_id || value.aweme_id_str || value.awemeId || value.id || '') === currentId) {
          row.workShapes.push({depth, keys:shape(value), author:shape(value.author || value.authorInfo),
            video:shape(value.video), awemeType:typeof value.aweme, awemeKeys:shape(value.aweme),
            awemeRef:typeof value.aweme === 'string' && /^\$[0-9a-f]+$/i.test(value.aweme) ? value.aweme : '',
            childShapes:Object.fromEntries(['aweme','author','video'].filter(key=>value[key] && typeof value[key]==='object')
              .map(key=>[key,Object.fromEntries(Object.entries(value[key]).filter(([name,child])=>
                /^[A-Za-z_][A-Za-z0-9_]{0,47}$/.test(name) && child && typeof child==='object').slice(0,12)
                .map(([name,child])=>[name,shape(child)]))]))});
        }
        for (const child of Object.values(value)) inspect(child, depth + 1);
      }
      inspect(payload, 0);
    } catch (_) { row.json = false; }
    snapshot.structure.matchingScripts.push(row);
  }
  for (const item of snapshot.items || []) { item.mediaUrl = ''; delete item.mediaBinding; delete item.mediaCandidates; }
  const match = new URL(snapshot.pageUrl).pathname.match(/^\/(?:video|note)\/(\d{12,24})\/?$/);
  if (!match) return snapshot;
  const id = match[1], author = snapshot.profile && snapshot.profile.profileUrl;
  const item = (snapshot.items || []).find(value => value.contentId === id);
  if (!item || !author) return snapshot;
  let visited = 0, budget = 4000000;
  function find(value, depth, source = 'embedded_detail') {
    if (!value || typeof value !== 'object' || depth > 16 || ++visited > 12000) return false;
    const who = value.author || value.authorInfo || {};
    if (String(value.aweme_id || value.aweme_id_str || value.awemeId || '') === id &&
        'https://www.douyin.com/user/' + String(who.sec_uid || who.secUid || '') === author) {
      const candidates = extract({aweme_detail: value}, id);
      const mirrors = [];
      for (const candidate of candidates) {
        const url = new URL(candidate.url);
        if (candidate.url.length > 8000 || url.username || url.password || url.port || url.hash) continue;
        if (!mirrors.includes(candidate.url)) mirrors.push(candidate.url);
        if (mirrors.length >= 8) break;
      }
      if (mirrors.length) {
        item.mediaUrl = mirrors[0];
        item.mediaCandidates = mirrors;
        item.mediaBinding = {contentId: id, profileUrl: author, source};
        return true;
      }
    }
    for (const child of Object.values(value)) if (find(child, depth + 1, source)) return true;
    return false;
  }
  if (typeof sourceResponseDetail !== 'undefined' && find(sourceResponseDetail, 0, 'detail_response')) return snapshot;
  for (const script of Array.from(document.querySelectorAll('script')).filter(value => !value.src).slice(0, 150)) {
    let text = String(script.textContent || '').trim();
    if (text.length > 2000000 || (budget -= text.length) < 0) break;
    if (!text.includes(id)) continue;
    try {
      if (text.startsWith('self.__pace_f.push(')) {
        const frame = text.match(/^self\.__pace_f\.push\((\[[\s\S]*\])\);?\s*$/);
        if (!frame) continue;
        const part = JSON.parse(frame[1]);
        if (part[0] !== 1 || typeof part[1] !== 'string') continue;
        text = part[1].replace(/^[0-9a-f]+:/i, '').trim();
      }
      if (find(JSON.parse(text.startsWith('%') ? decodeURIComponent(text) : text), 0)) break;
    } catch (_) { /* Non-JSON script is not executed or considered media proof. */ }
  }
  return snapshot;
})((() => {function cleanText(value, maxLength = 1000) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}function isAllowedDouyinImageUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && !url.username && !url.password &&
      ['douyinpic.com', 'byteimg.com', 'ibytedtos.com'].some(host => url.hostname === host || url.hostname.endsWith('.' + host));
  } catch (_) { return false; }
}function extractDouyinDetail(payload, contentId) {
  const id = String(contentId || '');
  if (!/^\d{12,24}$/.test(id)) return null;
  const candidates = [payload && payload.aweme_detail, payload && payload.data && payload.data.aweme_detail]
    .concat(payload && payload.aweme_list || [], payload && payload.item_list || []);
  const detail = candidates.find(item => item && String(item.aweme_id || item.aweme_id_str || item.awemeId || '') === id);
  if (!detail) return null;
  const author = detail.author || detail.authorInfo || {};
  const secUid = String(author.sec_uid || author.secUid || '');
  const profile = /^[A-Za-z0-9_-]{6,200}$/.test(secUid)
    ? { profileUrl: 'https://www.douyin.com/user/' + secUid, displayName: cleanText(author.nickname, 160) } : null;
  const imageList = Array.isArray(detail.images) ? detail.images : [];
  const images = imageList.slice(0, 50).map(function(item, index) {
    const urls = Array.isArray(item && item.url_list) ? item.url_list : Array.isArray(item && item.urlList) ? item.urlList : [];
    const url = urls.find(isAllowedDouyinImageUrl) || '';
    return { index: index + 1, url, width: Math.max(Number(item && item.width) || 0, 0), height: Math.max(Number(item && item.height) || 0, 0) };
  });
  const seconds = Number(detail.create_time || detail.createTime);
  const publishedAt = Number.isFinite(seconds) && seconds > 946684800 && seconds < 4102444800
    ? new Date(seconds * 1000).toISOString() : '';
  return { contentId: id, profile, description: String(detail.desc || '').trim().slice(0, 200000),
    publishedAt, images, imageCount: imageList.length,
    mediaType: imageList.length || Number(detail.aweme_type || detail.awemeType) === 68 ? 'note' : 'video' };
}return (function douyinVisiblePageSnapshot(parseWorkCount, parseMetricCount, inferLoggedIn, selectProfile, embeddedDetail) {
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

  function firstWithin(root, selectors, limit) {
    for (const selector of selectors) {
      const element = root && root.querySelector(selector);
      const value = element && compact(element.textContent || element.getAttribute('content'), limit);
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
  if (currentItem) {
    // Only author-labelled elements belonging to the work can supply the DOM fallback.
    document.querySelectorAll('[data-e2e="video-author-name"], [data-e2e="note-author-name"]').forEach(function(element) {
      const anchor = element.closest('a[href*="/user/"]') || element.querySelector('a[href*="/user/"]');
      if (anchor && visible(element)) profileLinks.push({ href: absoluteUrl(anchor.getAttribute('href')),
        text: compact(element.textContent, 160), contentId: currentItem.contentId });
    });
  }
  const selectedProfile = selectProfile(profileLinks, href, Boolean(currentItem));
  const profileUrl = selectedProfile.profileUrl;
  const displayName = currentItem
    ? selectedProfile.displayName
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
      const image = anchor.querySelector('img');
      const title = compact(
        anchor.getAttribute('aria-label') || anchor.getAttribute('title') ||
        (image && image.getAttribute('alt')) || anchor.textContent || (container && container.textContent),
        300
      );
      itemsById.set(identity.contentId, Object.assign(identity, {
        title,
        coverUrl: image && (image.currentSrc || image.src) || ''
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
    const commentNodes = Array.from(document.querySelectorAll(
      '[data-e2e*="comment-item"], [data-comment-id], [class*="comment-item"]'
    )).filter(visible).slice(0, 200);
    const comments = commentNodes.map(function(node, index) {
      const authorLink = node.querySelector('a[href*="/user/"]');
      const authorName = firstWithin(node, ['[data-e2e*="comment-user"]', '[class*="author"]', 'a[href*="/user/"]'], 160);
      const text = firstWithin(node, ['[data-e2e*="comment-content"]', '[class*="comment-content"]', '[class*="content"]'], 10000);
      const commentId = compact(node.getAttribute('data-comment-id') || node.getAttribute('data-id'), 200) ||
        compact('visible:' + currentItem.contentId + ':' + index + ':' + authorName + ':' + text.slice(0, 80), 200);
      return {
        commentId,
        parentCommentId: compact(node.getAttribute('data-parent-comment-id'), 200),
        replyToCommentId: compact(node.getAttribute('data-reply-to-comment-id'), 200),
        authorName,
        authorProfileUrl: authorLink ? absoluteUrl(authorLink.getAttribute('href')) : '',
        authorPlatformId: compact(node.getAttribute('data-user-id') || node.getAttribute('data-sec-uid'), 200),
        text,
        publishedAt: firstWithin(node, ['time', '[class*="time"]'], 80),
        likes: parseMetricCount(firstWithin(node, ['[data-e2e*="like"]', '[class*="like"]'], 80)),
        isCreatorLabel: /(?:^|\s)(?:作者|创作者)(?:\s|$)/.test(compact(node.textContent, 1000))
      };
    }).filter(function(comment) { return comment.text; });
    itemsById.set(currentItem.contentId, Object.assign(currentItem, {
      title,
      author: displayName,
      publishedAt: publishedMatch ? compact(publishedMatch[1], 80) : '',
      description,
      transcript,
      summary: chapterMatch ? compact(chapterMatch[1], 20000) : '',
      hashtags: hashtagValues,
      engagement,
      coverUrl: firstAttribute(['meta[property="og:image"]'], 'content', 2000) || (video && video.poster) || '',
      durationSeconds: Number(durationRaw) || 0,
      mediaUrl: compact(video && (video.currentSrc || video.src), 4000),
      comments,
      commentCoverage: {
        status: comments.length ? 'visible_partial' : 'not_loaded',
        message: comments.length
          ? '仅采集当前页面可见范围，未自动展开全部分页。'
          : '当前详情快照没有读取到可见评论，不能据此断言没有评论。'
      }
    }));
  }

  const loginRequired = Array.from(document.querySelectorAll('button, a, [role="button"]')).some(function(element) {
    const label = compact(element.textContent, 40);
    return visible(element) && (/^登录$/.test(label) || /登录后查看/.test(label));
  });
  const verificationRequired = Array.from(document.querySelectorAll('#captcha_container, #captcha-verify-container, [data-e2e="verify-dialog"]')).some(visible) ||
    Array.from(document.querySelectorAll('[role="dialog"]')).some(function(element) {
      return visible(element) && /完成验证后继续|拖动滑块完成验证|请完成安全验证/.test(compact(element.textContent, 1000));
    });

  const embedded = currentItem && embeddedDetail(Array.from(document.querySelectorAll('script'))
    .filter(element => !element.src).map(element => element.textContent), currentItem.contentId);
  const capturedItem = currentItem && itemsById.get(currentItem.contentId);
  if (embedded && capturedItem) {
    if (embedded.description) capturedItem.description = embedded.description;
    // Only this exact work's detail may fill a not-yet-rendered DOM title.
    if (!capturedItem.title && embedded.description) capturedItem.title = compact(embedded.description, 300);
    if (embedded.publishedAt) capturedItem.publishedAt = embedded.publishedAt;
    capturedItem.images = embedded.images;
    capturedItem.imageCount = embedded.imageCount;
    capturedItem.mediaType = embedded.mediaType;
    capturedItem.sourceUrl = 'https://www.douyin.com/' + embedded.mediaType + '/' + currentItem.contentId;
    if (embedded.profile) capturedItem.author = embedded.profile.displayName;
  }
  return {
    pageType,
    pageUrl: href,
    loggedIn: inferLoggedIn(bodyText, loginRequired),
    loginRequired,
    verificationRequired,
    loadError: /服务异常[，,]?\s*重新刷新拉取数据/.test(bodyText),
    capturedAt: new Date().toISOString(),
    profile: Object.assign({ displayName, profileUrl, douyinId: idMatch ? idMatch[1] : '', workCount }, embedded && embedded.profile || {}),
    items: Array.from(itemsById.values()).slice(0, 1000)
  };
})(function parseVisibleWorkCount(value) {
  const text = String(value || '').replace(/\s+/g, ' ');
  const match = text.match(/作品\s*([0-9]+(?:\.[0-9]+)?)(万|[wW])?/) ||
    text.match(/([0-9]+(?:\.[0-9]+)?)(万|[wW])?\s*(?:个?作品|作品)/);
  if (!match) return 0;
  return Math.round(Number(match[1]) * (match[2] ? 10000 : 1));
},function parseVisibleMetricCount(value) {
  const text = String(value == null ? '' : value).replace(/,/g, '').trim().toLowerCase();
  const match = text.match(/([0-9]+(?:\.[0-9]+)?)\s*(万|w)?/i);
  if (!match) return null;
  const number = Number(match[1]) * (match[2] ? 10000 : 1);
  return Number.isFinite(number) ? Math.round(number) : null;
},function inferVisibleLoggedIn(value, hasVisibleLoginControl) {
  if (hasVisibleLoginControl) return false;
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  // The logged-out page retains the navigation and old video cards. Those are not proof of authentication.
  if (/看更多\s*最新作品|登录后免费畅享高清(?:视频)?/.test(text)) return false;
  if (/扫码登录/.test(text) && /验证码登录|密码登录/.test(text)) return false;
  if (/最新作品\s+登录(?=\s|$)/.test(text)) return false;
  if (/通知\s+消息\s+投稿/.test(text)) return true;
  return !/(^|\s)登录(?:后查看)?(?=\s|$)/.test(text);
},function selectVisibleProfileCandidate(links, currentPageUrl, isItemPage) {
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

  const itemMatch = String(currentPageUrl || '').match(/\/(?:video|note)\/(\d{12,24})(?:[/?#]|$)/);
  const candidates = (Array.isArray(links) ? links : []).filter(function(item) {
    // A global profile link (recommendations, comments or navigation) is not authorship evidence.
    return !isItemPage || Boolean(itemMatch && item && item.contentId === itemMatch[1]);
  }).map(function(item) {
    return {
      profileUrl: normalizedProfile(item && item.href),
      displayName: String(item && item.text || '').replace(/\s+/g, ' ').trim().slice(0, 160)
    };
  }).filter(function(item) { return item.profileUrl; });
  if (isItemPage && new Set(candidates.map(item => item.profileUrl)).size !== 1) {
    return { profileUrl: '', displayName: '' };
  }
  const currentProfile = isItemPage ? '' : normalizedProfile(currentPageUrl);
  const profileUrl = currentProfile || (candidates[0] && candidates[0].profileUrl) || '';
  if (!profileUrl) return { profileUrl: '', displayName: '' };
  const named = candidates.find(function(item) {
    return item.profileUrl === profileUrl && item.displayName;
  });
  return { profileUrl, displayName: named ? named.displayName : '' };
},function extractDouyinEmbeddedDetail(scripts, contentId) {
  let visited = 0;
  function find(value, depth) {
    if (!value || typeof value !== 'object' || depth > 16 || ++visited > 12000) return null;
    if (String(value.aweme_id || value.awemeId || '') === String(contentId) &&
        (value.author || value.authorInfo)) return extractDouyinDetail({ aweme_detail: value }, contentId);
    for (const child of Object.values(value)) {
      const result = find(child, depth + 1);
      if (result) return result;
    }
    return null;
  }
  if (typeof sourceResponseDetail !== 'undefined') {
    const observed = find(sourceResponseDetail, 0);
    if (observed) return observed;
  }
  for (const text of (Array.isArray(scripts) ? scripts : []).slice(0, 150)) {
    if (typeof text !== 'string' || text.length > 2000000 || !text.includes(String(contentId))) continue;
    try {
      let payload;
      if (text.startsWith('self.__pace_f.push(')) {
        const match = text.match(/^self\.__pace_f\.push\((\[[\s\S]*\])\);?\s*$/);
        if (!match) continue;
        const part = JSON.parse(match[1]);
        if (part[0] !== 1 || typeof part[1] !== 'string') continue;
        const serialized = part[1].replace(/^[0-9a-f]+:/i, '').trim();
        payload = JSON.parse(serialized.startsWith('%') ? decodeURIComponent(serialized) : serialized);
      } else payload = JSON.parse(text.startsWith('%') ? decodeURIComponent(text) : text);
      const result = find(payload, 0);
      if (result) return result;
    } catch (_) { /* Other streaming frames are not detail records. */ }
  }
  return null;
});})(),function extractDouyinMediaCandidates(payload = {}, contentId) {
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
    return String(value.aweme_id || value.aweme_id_str || value.awemeId || value.group_id || value.group_id_str || '').trim();
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
    const urls = Array.isArray(address) ? address
      : Array.isArray(address.url_list) ? address.url_list
      : Array.isArray(address.urlList) ? address.urlList
      : typeof address.url === 'string' ? [address.url] : [];
    urls.slice(0, 64).forEach(function(value) {
      if (typeof value !== 'string') return;
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
    (Array.isArray(video.bit_rate) ? video.bit_rate : Array.isArray(video.bitRateList) ? video.bitRateList : []).slice(0, 32).forEach(function(rendition) {
      if (!rendition || typeof rendition !== 'object') return;
      const qualityLabel = rendition.gear_name || rendition.quality_type || rendition.bit_rate || video.ratio || 'bit_rate';
      appendAddress(rendition.play_addr_h264, 'bit_rate', qualityLabel, rendition.data_size, video.data_size);
      appendAddress(rendition.play_addr || rendition.playAddr, 'bit_rate', qualityLabel, rendition.data_size || rendition.dataSize, video.data_size || video.dataSize);
    });
    appendAddress(video.play_addr_h264, 'play_addr_h264', video.ratio || 'h264', null, video.data_size);
    appendAddress(video.play_addr || video.playAddr, 'play_addr', video.ratio || 'default', null, video.data_size || video.dataSize);
    appendAddress(video.download_addr, 'download_addr', video.ratio || 'download', null, video.data_size);
  });
  return result;
})
