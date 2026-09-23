const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadNewsModule(overrides) {
  overrides = overrides || {};
  const window = overrides.window || {};
  const context = vm.createContext({
    window,
    document: overrides.document,
    URLSearchParams,
    console,
    setTimeout,
    clearTimeout
  });
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'modules', 'news.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'news.js' });
  return window.News;
}

function deferred() {
  let resolve;
  const promise = new Promise(function(done) { resolve = done; });
  return { promise, resolve };
}

test('news discovery query keeps stock, sector and keyword targets explicit', () => {
  const News = loadNewsModule();
  const query = new URLSearchParams(News.buildDiscoveryQuery({
    type: 'stock',
    source: 'Fixture Wire',
    code: '000001',
    sector: 'Semiconductor',
    keyword: 'earnings',
    timeRange: '3d',
    withImage: true,
    sort: 'relevance'
  }, { cacheBust: 'fixed-bust' }));

  assert.equal(query.get('type'), 'stock');
  assert.equal(query.get('source'), 'Fixture Wire');
  assert.equal(query.get('codes'), '000001');
  assert.equal(query.get('sectors'), 'Semiconductor');
  assert.equal(query.get('keywords'), 'earnings');
  assert.equal(query.get('keyword'), 'earnings');
  assert.equal(query.get('timeRange'), '3d');
  assert.equal(query.get('withImage'), '1');
  assert.equal(query.get('sort'), 'relevance');
  assert.equal(query.get('cacheBust'), 'fixed-bust');
});

test('news evidence card renders only a validated upstream image with field provenance', () => {
  const News = loadNewsModule();
  const html = News.renderDiscoveryCard({
    title: 'Explicit image',
    source: 'Fixture Wire',
    link: 'https://example.com/not-an-image.jpg',
    image: {
      url: 'https://cdn.example.com/article.jpg',
      provider: 'fixture-provider',
      sourceField: 'image_url',
      upstreamProvided: true
    },
    imageProvenance: {
      provider: 'fixture-provider',
      sourceField: 'image_url',
      upstreamProvided: true
    },
    importance: {
      score: 73,
      level: 'high',
      method: 'local-research-priority-v1',
      reasons: ['Explicit association and recent publication.']
    },
    relevance: {
      score: 85,
      level: 'high',
      method: 'explicit-association-text-match-v1',
      reasons: ['relatedStocks matched 000001.']
    }
  }, 0, { degraded: false });

  assert.match(html, /<img[^>]+https:\/\/cdn\.example\.com\/article\.jpg/);
  assert.match(html, /data-image-provenance/);
  assert.match(html, /fixture-provider/);
  assert.match(html, /image_url/);
  assert.match(html, /onerror="this\.closest\('figure'\)\.hidden=true"/);
  assert.match(html, /外部来源/);
  assert.match(html, /本地研究优先级/);
  assert.match(html, /与你相关/);
  assert.match(html, /评分依据/);
  assert.doesNotMatch(html, /全网热度|globalHeat|globalPopularity/i);
});

test('news evidence card requires matching upstream provenance before rendering an image', () => {
  const News = loadNewsModule();
  const html = News.renderDiscoveryCard({
    title: 'Unverified image',
    source: 'Fixture Wire',
    image: {
      url: 'https://cdn.example.com/article.jpg',
      sourceField: 'imageUrl',
      upstreamProvided: true
    },
    imageProvenance: {
      provider: 'fixture-provider',
      sourceField: 'imageUrl',
      upstreamProvided: false
    },
    importance: { score: 0, reasons: [] },
    relevance: { score: null, reasons: [] }
  }, 0, { degraded: false });

  assert.doesNotMatch(html, /<img/);
});

test('news evidence card never infers an image and labels fallback or degraded data', () => {
  const News = loadNewsModule();
  const html = News.renderDiscoveryCard({
    title: '<script>alert(1)</script>',
    source: 'WebStock Fallback',
    link: 'https://example.com/looks-like-image.jpg',
    evidenceKind: 'local-fallback',
    image: null,
    importance: {
      score: 0,
      level: 'low',
      method: 'local-research-priority-v1',
      reasons: ['No supported local priority signal was available.']
    },
    relevance: {
      score: null,
      level: 'unscored',
      method: 'explicit-association-text-match-v1',
      reasons: ['No target supplied.']
    }
  }, 0, { degraded: true });

  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /本地兜底/);
  assert.match(html, /数据源降级/);
  assert.match(html, /与你相关：未评分/);
});

test('news discovery coverage renders semantic meters from API coverage only', () => {
  const News = loadNewsModule();
  const html = News.renderDiscoveryCoverage({
    itemCount: 4,
    upstreamImageCount: 1,
    upstreamImageRate: 25,
    validTimestampCount: 3,
    validTimestampRate: 75,
    explicitAssociationItemCount: 2,
    explicitAssociationRate: 50,
    relevanceEvaluatedCount: 4,
    relevanceMatchedCount: 2,
    relevanceMatchedRate: 50
  });

  assert.match(html, /data-discovery-coverage/);
  assert.match(html, /<meter[^>]+value="25"/);
  assert.match(html, /上游图片 1\/4/);
  assert.match(html, /相关匹配 2\/4/);
  assert.doesNotMatch(html, /全网热度/);
});

test('opening score details does not trigger the news-card detail modal', () => {
  const News = loadNewsModule();
  const box = {};
  News.bindNewsLinks(box, [{ title: 'Fixture' }]);

  assert.doesNotThrow(function() {
    box.onclick({
      target: {
        closest(selector) {
          if (selector === 'details') return {};
          if (selector === '[data-news-index]') {
            return { getAttribute() { return '0'; } };
          }
          return null;
        }
      }
    });
  });
});

test('sidebar news uses restrained red emphasis only for high local-priority items', () => {
  const News = loadNewsModule({
    window: {
      WebStockTime: {
        formatDateTime() { return '2026-08-12 20:00:00 北京时间'; }
      }
    }
  });
  const important = News.renderSidebarNewsItem({
    title: '重大合同明确落地',
    source: 'Fixture Wire',
    time: '2026-08-12T11:52:00.000Z',
    importance: {
      score: 72,
      level: 'high',
      method: 'local-research-priority-v1',
      reasons: ['Recent and explicitly associated.']
    }
  }, 0, new Date('2026-08-12T12:00:00.000Z'));
  const ordinary = News.renderSidebarNewsItem({
    title: '普通市场资讯',
    source: 'Fixture Wire',
    time: '2026-08-12T11:00:00.000Z',
    importance: {
      score: 25,
      level: 'low',
      method: 'local-research-priority-v1',
      reasons: ['Recent only.']
    }
  }, 1, new Date('2026-08-12T12:00:00.000Z'));

  assert.match(important, /sidebar-news-item is-important/);
  assert.match(important, /本地重点 72/);
  assert.match(important, /Fixture Wire/);
  assert.match(important, /8分钟前/);
  assert.match(important, /2026-08-12 20:00:00 北京时间/);
  assert.doesNotMatch(ordinary, /class="sidebar-news-item is-important"|<em>本地重点/);
  assert.match(ordinary, /普通市场资讯/);

  const unrelatedScore = News.renderSidebarNewsItem({
    title: '外部热度字段不能触发本地重点样式',
    source: 'Fixture Wire',
    time: '2026-08-12T11:30:00.000Z',
    importance: {
      score: 99,
      level: 'high',
      method: 'provider-heat-v1',
      reasons: ['Provider supplied an unrelated score.']
    }
  }, 2, new Date('2026-08-12T12:00:00.000Z'));
  assert.doesNotMatch(unrelatedScore, /class="sidebar-news-item is-important"|<em>本地重点/);
});

test('sidebar relative time uses the current clock when render omits now', () => {
  const News = loadNewsModule();
  const publishedAt = new Date(Date.now() - 8 * 60 * 1000).toISOString();
  const html = News.renderSidebarNewsItem({
    title: '缺省当前时间',
    source: 'Fixture Wire',
    time: publishedAt,
    importance: {
      score: 20,
      level: 'low',
      method: 'local-research-priority-v1',
      reasons: ['Recent publication only.']
    }
  }, 0);

  assert.match(html, /8分钟前/);
  assert.doesNotMatch(html, /时间待核验/);
});

test('sidebar detail stays in app and preserves the original article entry', () => {
  const elements = {
    newsDetailOverlay: { style: { display: 'none' } },
    newsDetailTitle: { textContent: '' },
    newsDetailMeta: { textContent: '' },
    newsDetailSummary: { textContent: '' },
    newsDetailTags: { innerHTML: '' },
    newsDetailOriginalBtn: { style: { display: 'none' }, onclick: null }
  };
  const opened = [];
  const News = loadNewsModule({
    window: {
      open() { opened.push(Array.from(arguments)); },
      WebStockTime: { formatDateTime() { return '2026-08-12 20:00:00 北京时间'; } }
    },
    document: {
      getElementById(id) { return elements[id] || null; }
    }
  });

  News.showNewsDetail({
    title: '侧栏资讯详情',
    source: 'Fixture Wire',
    time: '2026-08-12T12:00:00.000Z',
    summary: '先在软件内阅读摘要，再按需打开原文。',
    link: 'https://example.com/article',
    relatedStocks: ['000001'],
    relatedSectors: ['半导体']
  });

  assert.equal(elements.newsDetailOverlay.style.display, 'flex');
  assert.equal(elements.newsDetailTitle.textContent, '侧栏资讯详情');
  assert.match(elements.newsDetailSummary.textContent, /软件内阅读摘要/);
  assert.match(elements.newsDetailTags.innerHTML, /000001/);
  assert.equal(elements.newsDetailOriginalBtn.style.display, '');
  assert.equal(typeof elements.newsDetailOriginalBtn.onclick, 'function');
  elements.newsDetailOriginalBtn.onclick();
  assert.deepEqual(opened, [['https://example.com/article', '_blank', 'noopener']]);
});

test('application starts sidebar news before the first stock-list request', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
  const sidebarLoad = appSource.indexOf('window.News.loadSidebarNews()');
  const firstStockListRequest = appSource.indexOf("window.ApiClient.fetchJsonData('/api/stocklist')");

  assert.ok(sidebarLoad >= 0, 'initial sidebar news invocation should exist');
  assert.ok(firstStockListRequest >= 0, 'stock-list request should exist');
  assert.ok(sidebarLoad < firstStockListRequest, 'sidebar news should start before the first stock-list wait');
  assert.doesNotMatch(
    fs.readFileSync(path.join(__dirname, '..', 'js', 'modules', 'hotMarket.js'), 'utf8'),
    /renderHotStatus\(['"]hotSidebarPanel['"]/,
    'hot-market refresh must not overwrite the sidebar news panel'
  );
});

test('news discovery renders only the latest filter request', async () => {
  const requests = [];
  const elements = {
    newsList: { innerHTML: '', onclick: null },
    newsProviderStatus: { textContent: '' },
    newsTypeFilter: { value: '' },
    newsKeywordInput: { value: 'old' },
    newsSourceFilter: { value: '', innerHTML: '', appendChild() {} },
    newsDiscoveryTimeFilter: { value: '7d' },
    newsDiscoveryImageFilter: { checked: false },
    newsDiscoverySort: { value: 'latest' }
  };
  const window = {
    ApiClient: {
      fetchJsonData(url) {
        const request = deferred();
        request.url = url;
        requests.push(request);
        return request.promise;
      }
    }
  };
  const News = loadNewsModule({
    window,
    document: {
      getElementById(id) { return elements[id] || null; },
      createElement() { return { value: '', textContent: '' }; }
    }
  });

  const firstLoad = News.load();
  elements.newsKeywordInput.value = 'new';
  const secondLoad = News.load();
  requests[1].resolve({ items: [{ title: 'Newest result', source: 'Fixture' }] });
  await secondLoad;
  assert.match(elements.newsList.innerHTML, /Newest result/);

  requests[0].resolve({ items: [{ title: 'Stale result', source: 'Fixture' }] });
  await firstLoad;
  assert.match(elements.newsList.innerHTML, /Newest result/);
  assert.doesNotMatch(elements.newsList.innerHTML, /Stale result/);
});
