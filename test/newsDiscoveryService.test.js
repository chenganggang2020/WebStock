const test = require('node:test');
const assert = require('node:assert/strict');

const discovery = require('../services/newsDiscoveryService');

const NOW = new Date('2026-08-12T12:00:00.000Z');

test('news discovery uses only valid explicit upstream image fields and preserves provenance', () => {
  const feed = discovery.buildDiscoveryFeed({
    items: [
      {
        title: 'Explicit image',
        imageProvider: 'fixture',
        imageUrl: 'https://cdn.example.com/article.jpg',
        link: 'https://example.com/article'
      },
      {
        title: 'Article link is not an image source',
        link: 'https://example.com/looks-like-an-image.jpg'
      },
      {
        title: 'Unsafe explicit image',
        thumbnailUrl: 'javascript:alert(1)'
      }
    ],
    sourceMeta: { providers: [{ name: 'fixture', ok: true, count: 3 }] },
    query: {},
    now: NOW
  });

  assert.deepEqual(feed.items[0].image, {
    url: 'https://cdn.example.com/article.jpg',
    sourceField: 'imageUrl',
    provider: 'fixture',
    upstreamProvided: true
  });
  assert.deepEqual(feed.items[0].imageProvenance, {
    provider: 'fixture',
    sourceField: 'imageUrl',
    upstreamProvided: true
  });
  assert.equal(feed.items[0].imageUrl, 'https://cdn.example.com/article.jpg');
  assert.equal(feed.items[0].imageSourceField, 'imageUrl');
  assert.equal(feed.items[1].image, null);
  assert.equal(feed.items[1].imageUrl, null);
  assert.equal(feed.items[1].imageSourceField, null);
  assert.equal(feed.items[1].imageProvenance, null);
  assert.equal(feed.items[2].image, null);
  assert.equal(feed.coverage.itemCount, 3);
  assert.equal(feed.coverage.upstreamImageCount, 1);
  assert.equal(feed.coverage.upstreamImageRate, 33.33);
});

test('news discovery scores transparent local importance and target relevance without global heat claims', () => {
  const feed = discovery.buildDiscoveryFeed({
    items: [{
      title: 'Semiconductor earnings expansion',
      source: 'Fixture Wire',
      time: '2026-08-12T06:00:00.000Z',
      summary: 'Company 000001 expands advanced packaging capacity.',
      link: 'https://example.com/semiconductor',
      type: 'stock',
      relatedStocks: ['000001'],
      relatedSectors: ['Semiconductor']
    }],
    sourceMeta: { sources: ['Fixture Wire'] },
    query: {
      codes: ['000001'],
      sectors: ['Semiconductor'],
      keywords: ['earnings']
    },
    now: NOW
  });

  const item = feed.items[0];
  assert.equal(item.importance.method, 'local-research-priority-v1');
  assert.equal(item.importance.scope, 'local-research-priority');
  assert.ok(Number.isFinite(item.importance.score));
  assert.equal(item.importance.inputs.explicitStockAssociationCount, 1);
  assert.equal(item.importance.inputs.explicitSectorAssociationCount, 1);
  assert.equal(item.relevance.method, 'explicit-association-text-match-v1');
  assert.equal(item.relevance.inputs.requestedCodes[0], '000001');
  assert.ok(item.relevance.inputs.matches.some(match => match.kind === 'stock' && match.value === '000001'));
  assert.ok(item.relevance.inputs.matches.some(match => match.kind === 'sector' && match.value === 'Semiconductor'));
  assert.ok(item.relevance.inputs.matches.some(match => match.kind === 'keyword-title' && match.value === 'earnings'));
  assert.equal(item.relevance.score, 100);
  assert.ok(feed.methodology.importance.doesNotMeasure.includes('all-web popularity'));
  assert.equal(Object.prototype.hasOwnProperty.call(item, 'globalHeat'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(item, 'heat'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(item.importance, 'globalHeat'), false);
});

test('news discovery explains traceable-source points and accepts only explicit upstream priority evidence', () => {
  const feed = discovery.buildDiscoveryFeed({
    items: [
      {
        title: 'Recent policy event with an explicit source marker',
        source: 'Fixture Wire',
        provider: 'fixture-provider',
        link: 'https://example.com/news/priority',
        time: '2026-08-12T10:00:00.000Z',
        timeProvenance: 'upstream-field',
        evidenceKind: 'provider-item',
        sourcePriority: {
          value: 'important',
          field: 'priority',
          provenance: 'upstream-field'
        }
      },
      {
        title: 'Recent ordinary provider item',
        source: 'Fixture Wire',
        provider: 'fixture-provider',
        link: 'https://example.com/news/ordinary',
        time: '2026-08-12T10:00:00.000Z',
        timeProvenance: 'upstream-field',
        evidenceKind: 'provider-item',
        level: 2
      }
    ],
    now: NOW
  });

  const marked = feed.items.find(item => item.title.includes('explicit source marker'));
  const ordinary = feed.items.find(item => item.title.includes('ordinary provider item'));
  assert.equal(marked.importance.inputs.sourceTraceabilityPoints, 8);
  assert.equal(marked.importance.inputs.upstreamPriorityAccepted, true);
  assert.equal(marked.importance.inputs.upstreamPriorityField, 'priority');
  assert.ok(marked.importance.score > ordinary.importance.score);
  assert.equal(ordinary.importance.inputs.upstreamPriorityAccepted, false);
  assert.equal(ordinary.importance.inputs.upstreamPriorityField, null);
  assert.ok(feed.methodology.importance.inputs.includes('traceable provider source'));
  assert.ok(feed.methodology.importance.doesNotMeasure.includes('undocumented provider level fields'));
});

test('news discovery promotes traceable major-risk events without claiming source popularity', () => {
  const feed = discovery.buildDiscoveryFeed({
    items: [{
      title: '公司财务信息涉嫌虚假记载，可能触及重大违法强制退市',
      source: 'Fixture Wire',
      provider: 'fixture-provider',
      link: 'https://example.com/news/major-risk',
      time: '2026-08-12T10:00:00.000Z',
      timeProvenance: 'upstream-field',
      evidenceKind: 'provider-item'
    }],
    now: NOW
  });

  const importance = feed.items[0].importance;
  assert.equal(importance.level, 'high');
  assert.ok(importance.score >= 60);
  assert.ok(importance.inputs.criticalEventTerms.includes('重大违法'));
  assert.ok(importance.reasons.some(reason => reason.includes('重大风险事件词')));
  assert.ok(feed.methodology.importance.inputs.includes('major-risk event terms'));
  assert.equal(Object.prototype.hasOwnProperty.call(importance, 'globalHeat'), false);
});

test('news discovery leaves relevance unscored when no target is supplied and reports coverage limits', () => {
  const feed = discovery.buildDiscoveryFeed({
    items: [{
      title: 'General market note',
      time: 'not-a-time',
      relatedStocks: [],
      relatedSectors: []
    }],
    query: {},
    now: NOW
  });

  assert.equal(feed.items[0].relevance.score, null);
  assert.equal(feed.items[0].relevance.level, 'unscored');
  assert.equal(feed.items[0].evidenceKind, 'provider-item');
  assert.equal(feed.degraded, false);
  assert.equal(feed.coverage.relevanceEvaluatedCount, 0);
  assert.equal(feed.coverage.validTimestampCount, 0);
  assert.equal(feed.coverage.explicitAssociationCount, 0);
  assert.ok(feed.limitations.some(limit => /popularity/i.test(limit)));
  assert.ok(feed.limitations.some(limit => /upstream image/i.test(limit)));
});

test('news discovery marks local fallback and degraded provider state explicitly', () => {
  const feed = discovery.buildDiscoveryFeed({
    items: [{
      title: 'Local fallback checklist',
      source: 'WebStock Fallback',
      time: '2026-08-12T12:00:00.000Z',
      timeProvenance: 'generated-at-normalization',
      evidenceKind: 'local-fallback',
      relatedSectors: ['Workbench']
    }],
    sourceMeta: {
      degraded: true,
      providers: [
        { name: 'remote-wire', ok: false, error: 'offline' },
        { name: 'webstock-fallback', ok: true, count: 1 }
      ]
    },
    query: { sectors: ['Workbench'] },
    now: NOW,
    timeRange: '7d'
  });

  assert.equal(feed.degraded, true);
  assert.equal(feed.items[0].evidenceKind, 'local-fallback');
  assert.equal(feed.items[0].image, null);
  assert.equal(feed.items[0].importance.inputs.publishedTimeValid, false);
  assert.equal(feed.items[0].importance.inputs.explicitSectorAssociationCount, 0);
  assert.equal(feed.items[0].relevance.score, 0);
  assert.equal(feed.filters.unknownPublishedTimeIncluded, true);
});

test('news discovery does not award recency points to future or generated timestamps', () => {
  const feed = discovery.buildDiscoveryFeed({
    items: [
      {
        title: 'Future timestamp',
        time: '2030-01-01T00:00:00.000Z',
        timeProvenance: 'upstream-field'
      },
      {
        title: 'Generated timestamp',
        time: '2026-08-12T11:59:00.000Z',
        timeProvenance: 'generated-at-normalization'
      }
    ],
    query: {},
    now: NOW
  });

  assert.equal(feed.items[0].importance.inputs.publishedTimeValid, false);
  assert.equal(feed.items[0].importance.inputs.ageHours, null);
  assert.equal(feed.items[1].importance.inputs.publishedTimeValid, false);
  assert.equal(feed.coverage.validTimestampCount, 0);
});

test('news discovery applies time, image and relevance sorting filters without inventing coverage', () => {
  const feed = discovery.buildDiscoveryFeed({
    items: [
      {
        title: 'Recent target item',
        source: 'Fixture',
        time: '2026-08-12T11:30:00.000Z',
        imageUrl: 'https://cdn.example.com/recent.jpg',
        relatedStocks: ['000001']
      },
      {
        title: 'Recent unrelated item',
        source: 'Fixture',
        time: '2026-08-12T11:50:00.000Z',
        imageUrl: 'https://cdn.example.com/unrelated.jpg'
      },
      {
        title: 'Old target item',
        source: 'Fixture',
        time: '2026-08-10T11:00:00.000Z',
        imageUrl: 'https://cdn.example.com/old.jpg',
        relatedStocks: ['000001']
      }
    ],
    query: { codes: ['000001'] },
    timeRange: '1h',
    withImage: true,
    sort: 'relevance',
    now: NOW
  });

  assert.deepEqual(feed.items.map(item => item.title), ['Recent target item', 'Recent unrelated item']);
  assert.deepEqual(feed.filters, {
    timeRange: '1h',
    withImage: true,
    sort: 'relevance',
    unknownPublishedTimeIncluded: true
  });
  assert.equal(feed.coverage.sourceItemCount, 3);
  assert.equal(feed.coverage.itemCount, 2);
  assert.equal(feed.coverage.filteredOutCount, 1);
  assert.equal(feed.coverage.truncated, false);
});

test('news discovery distinguishes filtering from result limit truncation', () => {
  const feed = discovery.buildDiscoveryFeed({
    items: [
      { title: 'Best match', time: '2026-08-12T11:00:00.000Z', relatedStocks: ['000001'] },
      { title: 'Second match', time: '2026-08-12T10:00:00.000Z', relatedStocks: ['000001'] },
      { title: 'Filtered old match', time: '2026-08-01T10:00:00.000Z', relatedStocks: ['000001'] }
    ],
    query: { codes: ['000001'] },
    timeRange: '7d',
    sort: 'latest',
    limit: 1,
    now: NOW
  });

  assert.deepEqual(feed.items.map(item => item.title), ['Best match']);
  assert.equal(feed.coverage.sourceItemCount, 3);
  assert.equal(feed.coverage.filteredItemCount, 2);
  assert.equal(feed.coverage.filteredOutCount, 1);
  assert.equal(feed.coverage.truncated, true);
  assert.equal(feed.coverage.limit, 1);
});
