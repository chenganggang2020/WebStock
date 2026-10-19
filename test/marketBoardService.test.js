const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadSubject() {
  try {
    return require('../services/marketBoardService');
  } catch (error) {
    assert.fail('marketBoardService contract is not implemented: ' + error.message);
  }
}

function boardRows(prefix, count, metrics) {
  return Array.from({ length: count }, function(_, index) {
    const number = String(index + 1).padStart(4, '0');
    return Object.assign({
      f12: 'BK' + number,
      f14: prefix + (index + 1)
    }, metrics ? {
      f2: 100 + index,
      f3: index % 2 ? -1.25 : 2.5,
      f4: index % 2 ? -1.5 : 2.25,
      f5: 100000 + index,
      f6: 200000000 + index,
      f20: 3000000000 + index,
      f62: index % 2 ? -5000000 : 6000000
    } : {});
  });
}

function taxonomyFromUrl(url) {
  const filter = new URL(url).searchParams.get('fs') || '';
  if (filter.includes('t:2')) return 'industry';
  if (filter.includes('t:3')) return 'concept';
  if (filter.includes('t:1')) return 'region';
  throw new Error('unexpected taxonomy URL: ' + url);
}

function providerResponse(rows) {
  return { data: { data: { total: rows.length, diff: rows } } };
}

function constituentRows(count) {
  return Array.from({ length: count }, function(_, index) {
    return {
      f12: String(600001 + index),
      f14: '\u6210\u5206\u80a1' + (index + 1),
      f2: 10 + index / 100,
      f3: index % 2 ? -1.2 : 2.4,
      f4: index % 2 ? -0.12 : 0.24,
      f5: 100000 + index,
      f6: 200000000 + index,
      f20: 3000000000 + index,
      f62: index % 2 ? -5000000 : 6000000
    };
  });
}

function sinaIndustryNodes(entries) {
  return [
    ['\u5927\u76d8\u6307\u6570', [], '', 'dpzs', 'cn'],
    ['\u65b0\u6d6a\u884c\u4e1a', entries.map(function(entry) {
      return [entry.name, '', entry.node];
    }), '', 'sinahy', 'cn'],
    ['\u6982\u5ff5\u677f\u5757', [['\u6d4b\u8bd5\u6982\u5ff5', '', 'gn_test']], '', 'gainian', 'cn']
  ];
}

function sinaDetailedBoardNodes(input) {
  input = input || {};
  function rows(entries) {
    return (entries || []).map(function(entry) { return [entry.name, '', entry.node]; });
  }
  return [
    ['\u65b0\u6d6a\u884c\u4e1a', rows(input.legacyIndustry), '', 'sinahy', 'cn'],
    ['\u7533\u4e07\u4e8c\u7ea7', rows(input.industry), '', 'sw2_hy', 'cn'],
    ['\u70ed\u95e8\u6982\u5ff5', rows(input.concept), '', 'ch_gn', 'cn'],
    ['\u5730\u57df\u677f\u5757', rows(input.region), '', 'diyu', 'cn']
  ];
}

function sinaStock(code, changePct, amount, nmc, mktcap) {
  return {
    symbol: 'sh' + code,
    code,
    name: '\u6210\u5206' + code,
    trade: '10.00',
    pricechange: String(changePct / 10),
    changepercent: String(changePct),
    settlement: '9.90',
    volume: '1000',
    amount: String(amount),
    nmc: String(nmc),
    mktcap: String(mktcap)
  };
}

test('board catalog returns every provider row and reports coverage for all supported taxonomies', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-catalog-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rowsByTaxonomy = {
    industry: boardRows('行业', 35),
    concept: boardRows('概念', 27),
    region: boardRows('地域', 5)
  };
  const service = createMarketBoardService({
    cachePath: path.join(root, 'catalog.json'),
    now: () => Date.parse('2026-08-29T12:00:00.000Z'),
    catalogGet: async url => providerResponse(rowsByTaxonomy[taxonomyFromUrl(url)])
  });

  const result = await service.fetchCatalog();
  const coverage = new Map(result.coverage.map(item => [item.taxonomy, item]));
  const industries = result.items.filter(item => item.taxonomy === 'industry');

  assert.equal(industries.length, 35);
  assert.ok(industries.length > 12, 'catalog must not be truncated to a dashboard Top 12');
  assert.equal(result.items.filter(item => item.taxonomy === 'concept').length, 27);
  assert.equal(result.items.filter(item => item.taxonomy === 'region').length, 5);
  assert.deepEqual(Array.from(coverage.keys()), ['index', 'industry', 'concept', 'region', 'style']);
  assert.equal(coverage.get('industry').coverageComplete, true);
  assert.equal(coverage.get('industry').status, 'available');
  assert.equal(coverage.get('style').status, 'unavailable');
  assert.equal(result.status, 'partial');

  const item = industries[0];
  assert.equal(item.provider, 'eastmoney-public-board');
  assert.equal(item.taxonomy, 'industry');
  assert.equal(item.capabilities.daily, true);
  assert.equal(item.capabilities.snapshot, true);
  assert.equal(item.observedAt, null);
  assert.equal(item.fetchedAt, '2026-08-29T12:00:00.000Z');
  assert.equal(item.stale, false);
  assert.equal(item.coverageComplete, true);
  assert.equal(item.reason, null);
});

test('board catalog follows provider pagination instead of silently truncating a large taxonomy', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-pages-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rows = boardRows('概念', 520);
  const requestedPages = [];
  const service = createMarketBoardService({
    staticDefinitions: [],
    cachePath: path.join(root, 'catalog.json'),
    catalogGet: async url => {
      const page = Number(new URL(url).searchParams.get('pn'));
      requestedPages.push(page);
      const offset = (page - 1) * 500;
      return { data: { data: { total: rows.length, diff: rows.slice(offset, offset + 500) } } };
    }
  });

  const result = await service.fetchCatalog({ taxonomy: 'concept' });

  assert.equal(result.status, 'available');
  assert.equal(result.items.length, 520);
  assert.deepEqual(requestedPages, [1, 2]);
});

test('catalog outage returns the persisted last successful taxonomy without claiming it is fresh', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-stale-'));
  const cachePath = path.join(root, 'catalog.json');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const writer = createMarketBoardService({
    staticDefinitions: [],
    cachePath,
    now: () => Date.parse('2026-08-29T10:00:00.000Z'),
    catalogGet: async () => providerResponse(boardRows('行业', 18))
  });
  const fresh = await writer.fetchCatalog({ taxonomy: 'industry' });
  assert.equal(fresh.status, 'available');
  assert.equal(fresh.items.length, 18);

  const reader = createMarketBoardService({
    staticDefinitions: [],
    cachePath,
    now: () => Date.parse('2026-08-29T12:00:00.000Z'),
    catalogGet: async () => { throw new Error('planned provider outage'); }
  });
  const stale = await reader.fetchCatalog({ taxonomy: 'industry', refresh: true });

  assert.equal(stale.status, 'partial');
  assert.equal(stale.items.length, 18);
  assert.equal(stale.stale, true);
  assert.equal(stale.coverageComplete, true);
  assert.equal(stale.items.every(item => item.stale === true), true);
  assert.match(stale.reason, /last successful|provider outage/i);
  assert.match(stale.coverage[0].reason, /last successful|provider outage/i);
});

test('catalog outage without a persisted taxonomy is explicitly unavailable', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-empty-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = createMarketBoardService({
    staticDefinitions: [],
    cachePath: path.join(root, 'missing.json'),
    catalogGet: async () => { throw new Error('planned provider outage'); }
  });

  const result = await service.fetchCatalog({ taxonomy: 'concept' });

  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.items, []);
  assert.equal(result.stale, false);
  assert.equal(result.coverageComplete, false);
  assert.equal(result.coverage[0].taxonomy, 'concept');
  assert.equal(result.coverage[0].status, 'unavailable');
  assert.match(result.reason, /provider outage/i);
});

test('an incomplete provider response never replaces the last complete catalog', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-complete-'));
  const cachePath = path.join(root, 'catalog.json');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  await createMarketBoardService({
    staticDefinitions: [],
    cachePath,
    catalogGet: async () => providerResponse(boardRows('行业', 18))
  }).fetchCatalog({ taxonomy: 'industry' });

  const incompleteRows = boardRows('不完整行业', 12);
  const incomplete = await createMarketBoardService({
    staticDefinitions: [],
    cachePath,
    catalogGet: async () => ({ data: { data: { total: 30, diff: incompleteRows } } })
  }).fetchCatalog({ taxonomy: 'industry', refresh: true });
  assert.equal(incomplete.status, 'partial');
  assert.equal(incomplete.items.length, 12);

  const fallback = await createMarketBoardService({
    staticDefinitions: [],
    cachePath,
    catalogGet: async () => { throw new Error('planned provider outage'); }
  }).fetchCatalog({ taxonomy: 'industry', refresh: true });
  assert.equal(fallback.items.length, 18);
  assert.equal(fallback.items[0].name, '行业1');
});

test('malformed provider rows prevent a false complete-coverage claim', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-invalid-row-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rows = [boardRows('行业', 1)[0], { f12: 'not-a-board', f14: '无效记录' }];
  const service = createMarketBoardService({
    staticDefinitions: [],
    cachePath: path.join(root, 'catalog.json'),
    catalogGet: async () => ({ data: { data: { total: 2, diff: rows } } })
  });

  const result = await service.fetchCatalog({ taxonomy: 'industry' });

  assert.equal(result.items.length, 1);
  assert.equal(result.status, 'partial');
  assert.equal(result.coverageComplete, false);
  assert.equal(result.items[0].coverageComplete, false);
});

test('snapshot outage keeps cached board identities but never fabricates market values', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-snapshot-stale-'));
  const cachePath = path.join(root, 'catalog.json');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  await createMarketBoardService({
    staticDefinitions: [],
    cachePath,
    catalogGet: async () => providerResponse(boardRows('行业', 16))
  }).fetchCatalog({ taxonomy: 'industry' });

  const service = createMarketBoardService({
    staticDefinitions: [],
    cachePath,
    snapshotGet: async () => { throw new Error('planned snapshot outage'); }
  });
  const result = await service.fetchSnapshot({ taxonomy: 'industry', refresh: true });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.items.length, 16);
  assert.equal(result.coverageComplete, false);
  assert.equal(result.coverage[0].coverageComplete, false);
  assert.equal(result.items.every(item => item.status === 'unavailable'), true);
  assert.equal(result.items.every(item => item.stale === true), true);
  for (const item of result.items) {
    assert.equal(item.coverageComplete, false);
    assert.equal(item.price, null);
    assert.equal(item.changePct, null);
    assert.equal(item.amount, null);
    assert.equal(item.mainNetInflow, null);
    assert.match(item.reason, /snapshot outage/i);
  }
});

test('board snapshot returns the complete provider set with provider-classified market fields', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-snapshot-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rows = boardRows('行业', 19, true);
  const service = createMarketBoardService({
    staticDefinitions: [],
    cachePath: path.join(root, 'catalog.json'),
    now: () => Date.parse('2026-08-29T12:30:00.000Z'),
    snapshotGet: async () => providerResponse(rows)
  });

  const result = await service.fetchSnapshot({ taxonomy: 'industry' });

  assert.equal(result.status, 'available');
  assert.equal(result.items.length, 19);
  assert.equal(result.coverageComplete, true);
  assert.equal(result.observedAt, null);
  assert.equal(result.fetchedAt, '2026-08-29T12:30:00.000Z');
  assert.equal(result.items[0].price, 100);
  assert.equal(result.items[0].changePct, 2.5);
  assert.equal(result.items[0].amount, 200000000);
  assert.equal(result.items[0].totalMarketValue, 3000000000);
  assert.equal(result.items[0].mainNetInflow, 6000000);
  assert.equal(result.items[0].capitalFlowClass, 'provider-classified');
  assert.equal(result.items[0].stale, false);
});

test('default board snapshot cache keeps a successful full snapshot for five minutes', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-snapshot-ttl-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let currentTime = Date.parse('2026-08-30T09:00:00.000Z');
  let calls = 0;
  const service = createMarketBoardService({
    staticDefinitions: [],
    cachePath: path.join(root, 'catalog.json'),
    now: () => currentTime,
    snapshotGet: async () => {
      calls += 1;
      return providerResponse(boardRows('行业', 3, true));
    }
  });

  await service.fetchSnapshot({ taxonomy: 'industry' });
  currentTime += 4 * 60 * 1000 + 59 * 1000;
  await service.fetchSnapshot({ taxonomy: 'industry' });
  assert.equal(calls, 1, 'a complete snapshot should be reused throughout the five-minute window');

  currentTime += 2 * 1000;
  await service.fetchSnapshot({ taxonomy: 'industry' });
  assert.equal(calls, 2, 'the provider should be refreshed after the five-minute window expires');
});

test('a forced snapshot refresh reuses an in-flight request for the same taxonomy', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-snapshot-pending-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let calls = 0;
  const resolvers = [];
  const service = createMarketBoardService({
    staticDefinitions: [],
    cachePath: path.join(root, 'catalog.json'),
    snapshotGet: async () => {
      calls += 1;
      return new Promise(resolve => resolvers.push(resolve));
    }
  });

  const regular = service.fetchSnapshot({ taxonomy: 'industry' });
  await Promise.resolve();
  const forced = service.fetchSnapshot({ taxonomy: 'industry', refresh: true });
  await Promise.resolve();
  const observedCalls = calls;
  resolvers.forEach(resolve => resolve(providerResponse(boardRows('行业', 3, true))));
  await Promise.all([regular, forced]);

  assert.equal(observedCalls, 1, 'force refresh must not start a duplicate full-market request');
});

test('Sina fallback catalog exposes every source-declared industry including other industry', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-sina-catalog-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const entries = Array.from({ length: 48 }, function(_, index) {
    return {
      name: index === 47 ? '\u5176\u5b83\u884c\u4e1a' : '\u65b0\u6d6a\u884c\u4e1a' + (index + 1),
      node: index === 47 ? 'new_qtxy' : 'new_test_' + String(index + 1).padStart(2, '0')
    };
  });
  const service = createMarketBoardService({
    staticDefinitions: [],
    cachePath: path.join(root, 'catalog.json'),
    now: () => Date.parse('2026-08-30T01:00:00.000Z'),
    catalogGet: async () => { throw new Error('Eastmoney unavailable'); },
    sinaGet: async (kind, params) => {
      assert.equal(kind, 'nodes');
      assert.deepEqual(params, {}, 'the live Sina tree only exposes industry children when fetched from the root');
      return sinaIndustryNodes(entries);
    }
  });

  const result = await service.fetchCatalog({ taxonomy: 'industry', refresh: true });

  assert.equal(result.status, 'available');
  assert.equal(result.provider, 'sina-public-industry');
  assert.equal(result.items.length, 48);
  assert.equal(result.coverageComplete, true);
  assert.equal(result.coverage[0].provider, 'sina-public-industry');
  assert.equal(result.coverage[0].count, 48);
  assert.equal(result.items.some(item => item.providerId === 'new_qtxy'), true);
  assert.equal(result.items.every(item => item.provider === 'sina-public-industry'), true);
  assert.equal(result.items.every(item => item.capabilities.daily === false), true);
  assert.equal(result.items.every(item => item.capabilities.capitalFlow === false), true);
});

test('Sina fallback uses hot concepts and Shenwan level-two industries instead of legacy broad industries', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-sina-detailed-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tree = sinaDetailedBoardNodes({
    legacyIndustry: [{ name: '\u673a\u68b0\u884c\u4e1a', node: 'new_jxhy' }],
    industry: [
      { name: '\u6d88\u8d39\u7535\u5b50', node: 'sw2_270500' },
      { name: '\u5c0f\u91d1\u5c5e', node: 'sw2_240500' }
    ],
    concept: [
      { name: '\u5546\u4e1a\u822a\u5929\uff08\u822a\u5929\u822a\u7a7a\uff09', node: 'chgn_701264' },
      { name: '\u6d88\u8d39\u7535\u5b50', node: 'chgn_701218' },
      { name: '\u5c0f\u91d1\u5c5e', node: 'chgn_700129' }
    ]
  });
  const service = createMarketBoardService({
    staticDefinitions: [],
    cachePath: path.join(root, 'catalog.json'),
    catalogGet: async () => { throw new Error('Eastmoney unavailable'); },
    sinaGet: async kind => {
      assert.equal(kind, 'nodes');
      return tree;
    }
  });

  const concept = await service.fetchCatalog({ taxonomy: 'concept', refresh: true });
  const industry = await service.fetchCatalog({ taxonomy: 'industry', refresh: true });

  assert.equal(concept.status, 'available');
  assert.equal(concept.provider, 'sina-public-concept');
  assert.deepEqual(concept.items.map(item => item.name), [
    '\u5546\u4e1a\u822a\u5929\uff08\u822a\u5929\u822a\u7a7a\uff09', '\u6d88\u8d39\u7535\u5b50', '\u5c0f\u91d1\u5c5e'
  ]);
  assert.equal(concept.items.every(item => item.taxonomy === 'concept'), true);
  assert.equal(concept.items.every(item => item.provider === 'sina-public-concept'), true);

  assert.equal(industry.status, 'available');
  assert.equal(industry.provider, 'sina-public-industry');
  assert.deepEqual(industry.items.map(item => item.name), ['\u6d88\u8d39\u7535\u5b50', '\u5c0f\u91d1\u5c5e']);
  assert.equal(industry.items.some(item => item.name === '\u673a\u68b0\u884c\u4e1a'), false);
});

test('Sina industry snapshot aggregates all provider-declared constituents, not a top-stock sample', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-sina-snapshot-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const entries = [{ name: '\u7535\u5b50\u4fe1\u606f', node: 'new_dzxx' }];
  const rows = Array.from({ length: 101 }, function(_, index) {
    return sinaStock(String(600000 + index), index === 100 ? 2 : 1, index + 1, 100, 150);
  });
  const requestedPages = [];
  const service = createMarketBoardService({
    staticDefinitions: [],
    cachePath: path.join(root, 'catalog.json'),
    now: () => Date.parse('2026-08-30T01:05:00.000Z'),
    snapshotGet: async () => { throw new Error('Eastmoney unavailable'); },
    sinaGet: async (kind, params) => {
      if (kind === 'nodes') return sinaIndustryNodes(entries);
      if (kind === 'count') return '101';
      if (kind === 'data') {
        requestedPages.push(params.page);
        const offset = (params.page - 1) * params.num;
        return rows.slice(offset, offset + params.num);
      }
      throw new Error('unexpected Sina request');
    }
  });

  const result = await service.fetchSnapshot({ taxonomy: 'industry', refresh: true });
  const item = result.items[0];

  assert.equal(result.status, 'available');
  assert.equal(result.provider, 'sina-public-industry');
  assert.equal(result.coverageComplete, true);
  assert.deepEqual(requestedPages, [1, 2]);
  assert.equal(item.constituentCount, 101);
  assert.equal(item.expectedConstituentCount, 101);
  assert.equal(item.amount, rows.reduce((sum, row) => sum + Number(row.amount), 0));
  assert.ok(item.changePct > 1 && item.changePct < 1.02);
  assert.equal(item.calculationBasis, 'full-constituent-float-market-cap-weighted');
  assert.equal(item.amountBasis, 'full-constituent-sum');
  assert.equal(item.mainNetInflow, null);
  assert.equal(item.capitalFlowClass, 'unavailable');
  assert.equal(item.capabilities.capitalFlow, false);
});

test('Sina fallback boards expose their complete constituent rows for drill-down without fabricating fund flow', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-sina-constituents-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rows = Array.from({ length: 101 }, function(_, index) {
    return sinaStock(String(600000 + index), index % 2 ? -1 : 2, 1000000 + index, 100, 150);
  });
  const requestedPages = [];
  const service = createMarketBoardService({
    staticDefinitions: [],
    cachePath: path.join(root, 'catalog.json'),
    now: () => Date.parse('2026-09-02T01:00:00.000Z'),
    sinaGet: async (kind, params) => {
      assert.equal(params.node, 'new_dzxx');
      if (kind === 'count') return '101';
      if (kind === 'data') {
        requestedPages.push(params.page);
        const offset = (params.page - 1) * params.num;
        return rows.slice(offset, offset + params.num);
      }
      throw new Error('unexpected Sina request');
    }
  });

  const result = await service.fetchConstituents({
    code: 'new_dzxx', taxonomy: 'industry', refresh: true
  });

  assert.equal(result.status, 'available');
  assert.equal(result.provider, 'sina-public-industry');
  assert.equal(result.board.code, 'new_dzxx');
  assert.equal(result.items.length, 101);
  assert.deepEqual(requestedPages, [1, 2]);
  assert.equal(result.coverageComplete, true);
  assert.equal(result.capabilities.constituents, true);
  assert.equal(result.capabilities.capitalFlow, false);
  assert.equal(result.items[0].amount, 1000000);
  assert.equal(result.items[0].mainNetInflow, null);
  assert.equal(result.items[0].capitalFlowClass, 'unavailable');
});

test('Sina constituent drill marks retained rows partial when duplicate provider rows break declared coverage', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-sina-constituents-partial-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const duplicate = sinaStock('600000', 2, 1000000, 100, 150);
  const service = createMarketBoardService({
    staticDefinitions: [],
    cachePath: path.join(root, 'catalog.json'),
    now: () => Date.parse('2026-09-02T01:00:00.000Z'),
    sinaGet: async kind => kind === 'count' ? '2' : [duplicate, duplicate]
  });

  const result = await service.fetchConstituents({
    code: 'new_dzxx', taxonomy: 'industry', refresh: true
  });

  assert.equal(result.status, 'partial');
  assert.equal(result.coverageComplete, false);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].coverageComplete, false);
  assert.match(result.items[0].reason, /not-fully-covered/);
});

test('Sina industry fallback reports partial coverage when a declared node cannot be aggregated', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-sina-partial-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const entries = [
    { name: '\u7535\u5b50\u4fe1\u606f', node: 'new_dzxx' },
    { name: '\u751f\u7269\u533b\u836f', node: 'new_swyy' }
  ];
  const service = createMarketBoardService({
    staticDefinitions: [],
    cachePath: path.join(root, 'catalog.json'),
    snapshotGet: async () => { throw new Error('Eastmoney unavailable'); },
    sinaGet: async (kind, params) => {
      if (kind === 'nodes') return sinaIndustryNodes(entries);
      if (kind === 'count') return params.node === 'new_dzxx' ? '1' : '2';
      if (kind === 'data' && params.node === 'new_dzxx') {
        return [sinaStock('600000', 3, 5000, 103, 150)];
      }
      throw new Error('planned Sina node outage');
    }
  });

  const result = await service.fetchSnapshot({ taxonomy: 'industry', refresh: true });

  assert.equal(result.status, 'partial');
  assert.equal(result.items.length, 2, 'partial snapshots keep every verified board identity');
  const unavailable = result.items.find(item => item.providerId === 'new_swyy');
  assert.ok(unavailable);
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.changePct, null);
  assert.equal(unavailable.amount, null);
  assert.equal(result.coverageComplete, false);
  assert.equal(result.coverage[0].status, 'partial');
  assert.match(result.reason, /not fully covered|node/i);
});

test('two partial public snapshots are merged by board name instead of discarding valid coverage', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-merge-partials-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const eastmoneyRows = boardRows('概念', 2, true);
  eastmoneyRows[0].f14 = '共同概念';
  eastmoneyRows[1].f14 = '东财独有';
  const tree = sinaDetailedBoardNodes({
    concept: [
      { name: '共同概念', node: 'chgn_700001' },
      { name: '新浪独有', node: 'chgn_700002' },
      { name: '暂不可用', node: 'chgn_700003' }
    ]
  });
  const service = createMarketBoardService({
    staticDefinitions: [],
    cachePath: path.join(root, 'catalog.json'),
    snapshotGet: async () => ({ data: { data: { total: 3, diff: eastmoneyRows } } }),
    sinaGet: async (kind, params) => {
      if (kind === 'nodes') return tree;
      if (kind === 'count') return '1';
      if (kind === 'data' && params.node === 'chgn_700003') throw new Error('planned node outage');
      if (kind === 'data') return [sinaStock(params.node === 'chgn_700001' ? '600001' : '600002', 1, 1000, 100, 150)];
      throw new Error('unexpected Sina request');
    }
  });

  const result = await service.fetchSnapshot({ taxonomy: 'concept', refresh: true });

  assert.equal(result.status, 'partial');
  assert.equal(result.provider, 'mixed-public');
  assert.equal(result.coverageComplete, false);
  assert.equal(result.items.length, 4);
  assert.equal(result.items.filter(item => item.status === 'available').length, 3);
  assert.equal(result.items.find(item => item.name === '共同概念').provider, 'eastmoney-public-board');
  assert.ok(result.items.some(item => item.name === '东财独有'));
  assert.ok(result.items.some(item => item.name === '新浪独有'));
  assert.match(result.reason, /combined partial public providers/i);
});

test('concept and region outages stay unavailable and never relabel unrelated Sina rows', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-no-fake-taxonomy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let sinaCalls = 0;
  const service = createMarketBoardService({
    staticDefinitions: [],
    cachePath: path.join(root, 'catalog.json'),
    snapshotGet: async () => { throw new Error('Eastmoney unavailable'); },
    sinaGet: async () => {
      sinaCalls += 1;
      return sinaIndustryNodes([{ name: '\u7535\u5b50\u4fe1\u606f', node: 'new_dzxx' }]);
    }
  });

  const [concept, region] = await Promise.all([
    service.fetchSnapshot({ taxonomy: 'concept', refresh: true }),
    service.fetchSnapshot({ taxonomy: 'region', refresh: true })
  ]);

  assert.equal(concept.status, 'unavailable');
  assert.equal(region.status, 'unavailable');
  assert.deepEqual(concept.items, []);
  assert.deepEqual(region.items, []);
  assert.equal(sinaCalls, 3);
});

test('Eastmoney hosts use a short no-retry parallel failure boundary inside market board service', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-fast-failure-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  const timeouts = [];
  const service = createMarketBoardService({
    staticDefinitions: [],
    cachePath: path.join(root, 'catalog.json'),
    eastmoneyHttpGet: async (url, config) => {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      timeouts.push(config.timeout);
      await new Promise(resolve => setTimeout(resolve, 40));
      active -= 1;
      throw new Error('planned host outage');
    },
    sinaGet: async () => { throw new Error('planned Sina outage'); }
  });
  const startedAt = Date.now();

  const result = await service.fetchCatalog({ taxonomy: 'concept', refresh: true });
  const elapsed = Date.now() - startedAt;

  assert.equal(result.status, 'unavailable');
  assert.equal(calls, 3);
  assert.equal(maxActive, 3);
  assert.equal(timeouts.every(timeout => timeout > 0 && timeout <= 3000), true);
  assert.ok(elapsed < 500, 'parallel host failure should not accumulate three sequential waits');
});

test('a successful Sina industry catalog does not wait for stalled Eastmoney hosts', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-sina-wins-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let eastmoneyCalls = 0;
  const service = createMarketBoardService({
    staticDefinitions: [],
    cachePath: path.join(root, 'catalog.json'),
    eastmoneyHttpGet: async () => {
      eastmoneyCalls += 1;
      return new Promise(() => {});
    },
    sinaGet: async kind => {
      assert.equal(kind, 'nodes');
      return sinaIndustryNodes([{ name: '\u7535\u5b50\u4fe1\u606f', node: 'new_dzxx' }]);
    }
  });
  const startedAt = Date.now();

  const result = await service.fetchCatalog({ taxonomy: 'industry', refresh: true });
  const elapsed = Date.now() - startedAt;

  assert.equal(result.status, 'available');
  assert.equal(result.provider, 'sina-public-industry');
  assert.equal(eastmoneyCalls, 3);
  assert.ok(elapsed < 500, 'Sina success should win without awaiting stalled Eastmoney requests');
});

test('Sina catalog cache preserves its provider when both live sources later fail', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-sina-cache-'));
  const cachePath = path.join(root, 'catalog.json');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const entries = [{ name: '\u7535\u5b50\u4fe1\u606f', node: 'new_dzxx' }];

  await createMarketBoardService({
    staticDefinitions: [],
    cachePath,
    catalogGet: async () => { throw new Error('Eastmoney unavailable'); },
    sinaGet: async () => sinaIndustryNodes(entries)
  }).fetchCatalog({ taxonomy: 'industry', refresh: true });

  const result = await createMarketBoardService({
    staticDefinitions: [],
    cachePath,
    catalogGet: async () => { throw new Error('Eastmoney unavailable'); },
    sinaGet: async () => { throw new Error('Sina unavailable'); }
  }).fetchCatalog({ taxonomy: 'industry', refresh: true });

  assert.equal(result.status, 'partial');
  assert.equal(result.provider, 'sina-public-industry');
  assert.equal(result.coverage[0].provider, 'sina-public-industry');
  assert.equal(result.items[0].provider, 'sina-public-industry');
  assert.equal(result.items[0].stale, true);
});

test('malformed Sina nodes are rejected and prevent a false complete-coverage claim', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-sina-invalid-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const payload = sinaIndustryNodes([
    { name: '\u7535\u5b50\u4fe1\u606f', node: 'new_dzxx' },
    { name: '\u6076\u610f\u8282\u70b9', node: '../../secrets' },
    { name: '\u91cd\u590d\u8282\u70b9', node: 'new_dzxx' },
    { name: '', node: 'new_blank' }
  ]);
  const service = createMarketBoardService({
    staticDefinitions: [],
    cachePath: path.join(root, 'catalog.json'),
    catalogGet: async () => { throw new Error('Eastmoney unavailable'); },
    sinaGet: async () => payload
  });

  const result = await service.fetchCatalog({ taxonomy: 'industry', refresh: true });

  assert.equal(result.status, 'partial');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].providerId, 'new_dzxx');
  assert.equal(result.coverageComplete, false);
});

test('a failed cache rename leaves no partial temporary catalog behind', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-cache-atomic-'));
  const cachePath = path.join(root, 'catalog-target');
  fs.mkdirSync(cachePath);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = createMarketBoardService({
    staticDefinitions: [],
    cachePath,
    catalogGet: async () => providerResponse(boardRows('\u884c\u4e1a', 2))
  });

  const result = await service.fetchCatalog({ taxonomy: 'industry', refresh: true });

  assert.equal(result.status, 'available');
  assert.deepEqual(fs.readdirSync(root).filter(name => name.startsWith('catalog-target.tmp-')), []);
});

test('persisted catalog input is revalidated before an outage fallback is exposed', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-cache-input-'));
  const cachePath = path.join(root, 'catalog.json');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(cachePath, JSON.stringify({
    version: 1,
    taxonomies: {
      industry: {
        provider: 'sina-public-industry',
        fetchedAt: '2026-08-30T01:00:00.000Z',
        coverageComplete: true,
        items: [
          { provider: 'sina-public-industry', providerId: 'new_dzxx', name: '\u7535\u5b50\u4fe1\u606f' },
          { provider: 'sina-public-industry', providerId: '../../secrets', name: '\u6076\u610f\u8282\u70b9' },
          { provider: 'unknown-provider', code: 'BK0001', name: '\u4f2a\u9020\u884c\u4e1a' }
        ]
      }
    }
  }), 'utf8');
  const service = createMarketBoardService({
    staticDefinitions: [],
    cachePath,
    catalogGet: async () => { throw new Error('planned provider outage'); }
  });

  const result = await service.fetchCatalog({ taxonomy: 'industry', refresh: true });

  assert.equal(result.status, 'partial');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].providerId, 'new_dzxx');
  assert.equal(result.coverageComplete, false);
});

test('Sina snapshot deadline includes catalog latency and stops starting pages after return', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-hard-deadline-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let dataCalls = 0;
  const service = createMarketBoardService({
    staticDefinitions: [],
    cachePath: path.join(root, 'catalog.json'),
    sinaDeadlineMs: 150,
    snapshotGet: async () => { throw new Error('Eastmoney unavailable'); },
    sinaGet: async kind => {
      if (kind === 'nodes') {
        await new Promise(resolve => setTimeout(resolve, 100));
        return sinaIndustryNodes([{ name: '\u7535\u5b50\u4fe1\u606f', node: 'new_dzxx' }]);
      }
      if (kind === 'count') return '10000';
      if (kind === 'data') {
        dataCalls += 1;
        await new Promise(resolve => setTimeout(resolve, 60));
        return Array.from({ length: 100 }, function(_, index) {
          return sinaStock(String(600000 + index), 1, 1, 100, 100);
        });
      }
      throw new Error('unexpected Sina request');
    }
  });
  const startedAt = Date.now();

  const result = await service.fetchSnapshot({ taxonomy: 'industry', refresh: true });
  const elapsed = Date.now() - startedAt;
  const callsAtReturn = dataCalls;
  await new Promise(resolve => setTimeout(resolve, 180));

  assert.equal(result.status, 'unavailable');
  assert.ok(elapsed < 350, 'catalog time and page time must share one absolute deadline');
  assert.equal(dataCalls, callsAtReturn, 'no additional page may start after the API has returned');
});

test('a partial Sina catalog does not preempt a slightly slower complete Eastmoney catalog', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-complete-source-wins-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const partialSina = sinaIndustryNodes([
    { name: '\u7535\u5b50\u4fe1\u606f', node: 'new_dzxx' },
    { name: '\u65e0\u6548\u8282\u70b9', node: '../invalid' }
  ]);
  const service = createMarketBoardService({
    staticDefinitions: [],
    cachePath: path.join(root, 'catalog.json'),
    catalogGet: async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
      return providerResponse(boardRows('\u5b8c\u6574\u884c\u4e1a', 2));
    },
    sinaGet: async () => partialSina
  });

  const result = await service.fetchCatalog({ taxonomy: 'industry', refresh: true });

  assert.equal(result.status, 'available');
  assert.equal(result.provider, 'eastmoney-public-board');
  assert.equal(result.items.length, 2);
  assert.equal(result.items.every(item => item.coverageComplete === true), true);
});

test('oversized or numerically overflowing Sina constituent pages are unavailable, never complete', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-sina-bounds-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const entry = [{ name: '\u7535\u5b50\u4fe1\u606f', node: 'new_dzxx' }];

  async function runCase(count, rows) {
    const service = createMarketBoardService({
      staticDefinitions: [],
      cachePath: path.join(root, 'catalog-' + count + '-' + rows.length + '.json'),
      snapshotGet: async () => { throw new Error('Eastmoney unavailable'); },
      sinaGet: async kind => {
        if (kind === 'nodes') return sinaIndustryNodes(entry);
        if (kind === 'count') return String(count);
        if (kind === 'data') return rows;
        throw new Error('unexpected Sina request');
      }
    });
    return service.fetchSnapshot({ taxonomy: 'industry', refresh: true });
  }

  const oversized = await runCase(100, Array.from({ length: 101 }, function(_, index) {
    return sinaStock(String(600000 + index), 1, 1, 100, 100);
  }));
  const overflowing = await runCase(2, [
    sinaStock('600000', 1, Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE),
    sinaStock('600001', 1, Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE)
  ]);

  assert.equal(oversized.status, 'unavailable');
  assert.deepEqual(oversized.items, []);
  assert.equal(overflowing.status, 'unavailable');
  assert.deepEqual(overflowing.items, []);
});

test('board constituents return every provider row across pages with explicit market provenance', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-constituents-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rows = constituentRows(520);
  const requestedPages = [];
  const service = createMarketBoardService({
    staticDefinitions: [],
    cachePath: path.join(root, 'catalog.json'),
    now: () => Date.parse('2026-08-30T02:00:00.000Z'),
    constituentsGet: async url => {
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get('fs'), 'b:BK0475');
      assert.equal(parsed.searchParams.get('fid'), 'f12');
      const page = Number(parsed.searchParams.get('pn'));
      requestedPages.push(page);
      const offset = (page - 1) * 500;
      return { data: { data: { total: rows.length, diff: rows.slice(offset, offset + 500) } } };
    }
  });

  const result = await service.fetchConstituents({
    code: 'BK0475', taxonomy: 'industry', refresh: true
  });

  assert.equal(result.status, 'available');
  assert.equal(result.provider, 'eastmoney-public-board');
  assert.equal(result.taxonomy, 'industry');
  assert.equal(result.board.code, 'BK0475');
  assert.equal(result.items.length, 520);
  assert.deepEqual(requestedPages, [1, 2]);
  assert.equal(result.coverageComplete, true);
  assert.equal(result.stale, false);
  assert.equal(result.observedAt, null);
  assert.equal(result.fetchedAt, '2026-08-30T02:00:00.000Z');
  assert.deepEqual({
    code: result.items[0].code,
    name: result.items[0].name,
    changePct: result.items[0].changePct,
    amount: result.items[0].amount,
    netFlow: result.items[0].netFlow,
    marketCap: result.items[0].marketCap
  }, {
    code: '600001', name: '\u6210\u5206\u80a11', changePct: 2.4,
    amount: 200000000, netFlow: 6000000, marketCap: 3000000000
  });
  assert.equal(result.items[0].capitalFlowClass, 'provider-classified');
});

test('board constituent provider outage is explicit and cached identities never receive fabricated values', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-constituent-outage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let unavailable = false;
  const service = createMarketBoardService({
    staticDefinitions: [],
    cachePath: path.join(root, 'catalog.json'),
    constituentsGet: async () => {
      if (unavailable) throw new Error('planned constituent outage');
      return providerResponse(constituentRows(3));
    }
  });
  const fresh = await service.fetchConstituents({ code: 'BK0475', taxonomy: 'concept' });
  assert.equal(fresh.status, 'available');
  unavailable = true;

  const result = await service.fetchConstituents({
    code: 'BK0475', taxonomy: 'concept', refresh: true
  });

  assert.equal(result.status, 'unavailable');
  assert.equal(result.stale, true);
  assert.equal(result.coverageComplete, false);
  assert.equal(result.items.length, 3);
  assert.match(result.reason, /constituent outage/i);
  for (const item of result.items) {
    assert.equal(item.status, 'unavailable');
    assert.equal(item.changePct, null);
    assert.equal(item.amount, null);
    assert.equal(item.netFlow, null);
    assert.equal(item.marketCap, null);
  }
});

test('board constituents validate board identity and taxonomy before any provider request', async () => {
  const { createMarketBoardService } = loadSubject();
  let calls = 0;
  const service = createMarketBoardService({
    staticDefinitions: [],
    constituentsGet: async () => { calls += 1; }
  });

  await assert.rejects(
    service.fetchConstituents({ code: '../../BK0475', taxonomy: 'industry' }),
    error => error && error.code === 'MARKET_BOARD_CODE_INVALID'
  );
  await assert.rejects(
    service.fetchConstituents({ code: 'BK0475', taxonomy: 'index' }),
    error => error && error.code === 'MARKET_BOARD_TAXONOMY_INVALID'
  );
  assert.equal(calls, 0);
});

test('board constituent host failures are parallel and bounded without global retries', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-constituent-timeout-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  const timeouts = [];
  const service = createMarketBoardService({
    staticDefinitions: [],
    cachePath: path.join(root, 'catalog.json'),
    eastmoneyHttpGet: async (url, config) => {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      timeouts.push(config.timeout);
      await new Promise(resolve => setTimeout(resolve, 40));
      active -= 1;
      throw new Error('planned host outage');
    }
  });
  const startedAt = Date.now();

  const result = await service.fetchConstituents({
    code: 'BK0475', taxonomy: 'region', refresh: true
  });
  const elapsed = Date.now() - startedAt;

  assert.equal(result.status, 'unavailable');
  assert.equal(calls, 3);
  assert.equal(maxActive, 3);
  assert.equal(timeouts.every(timeout => timeout > 0 && timeout <= 3000), true);
  assert.ok(elapsed < 500);
});

test('oversized constituent pages are rejected instead of being exposed as complete', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-constituent-bounds-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = createMarketBoardService({
    staticDefinitions: [],
    cachePath: path.join(root, 'catalog.json'),
    constituentsGet: async () => ({
      data: { data: { total: 500, diff: constituentRows(501) } }
    })
  });

  const result = await service.fetchConstituents({
    code: 'BK0475', taxonomy: 'industry', refresh: true
  });

  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.items, []);
  assert.equal(result.coverageComplete, false);
});

test('complete constituent identity coverage stays partial when market observations are missing', async t => {
  const { createMarketBoardService } = loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-board-constituent-observation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = createMarketBoardService({
    staticDefinitions: [],
    cachePath: path.join(root, 'catalog.json'),
    constituentsGet: async () => providerResponse([{ f12: '600001', f14: '\u6210\u5206\u80a11' }])
  });

  const result = await service.fetchConstituents({
    code: 'BK0475', taxonomy: 'industry', refresh: true
  });

  assert.equal(result.status, 'partial');
  assert.equal(result.coverageComplete, true);
  assert.equal(result.items[0].status, 'unavailable');
  assert.match(result.reason, /market[- ]observation/i);
});
