const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildIndustryChainMap,
  discoverIndustryChains,
  resolveIndustryChainQuery
} = require('../services/industryChainService');

test('industry-chain query resolves natural Chinese and English stage words', () => {
  const semiconductor = resolveIndustryChainQuery('半导体设备');
  assert.deepEqual(semiconductor.chainIds, ['semiconductor']);
  assert.deepEqual(semiconductor.stages, ['equipment']);

  const cpoMaterials = resolveIndustryChainQuery('CPO materials');
  assert.deepEqual(cpoMaterials.chainIds, ['ai-compute-cpo']);
  assert.deepEqual(cpoMaterials.stages, ['materials']);

  const genericMaterials = resolveIndustryChainQuery('原材料');
  assert.ok(genericMaterials.chainIds.length >= 10);
  assert.deepEqual(genericMaterials.stages, ['materials']);

  assert.deepEqual(resolveIndustryChainQuery('创新药设备').chainIds, ['innovative-medicine']);
  assert.deepEqual(resolveIndustryChainQuery('低空经济零部件').chainIds, ['low-altitude-economy']);
  assert.deepEqual(resolveIndustryChainQuery('商业航天材料').chainIds, ['commercial-space']);
});

test('explicit chain and stage filters override conflicting natural-language terms', () => {
  const resolved = resolveIndustryChainQuery('半导体材料', { chain: 'robotics', stage: 'equipment' });
  assert.deepEqual(resolved.chainIds, ['robotics']);
  assert.deepEqual(resolved.stages, ['equipment']);
});

test('industry-chain map classifies sourced stock metadata into beneficiary stages without a hardcoded stock list', () => {
  const result = buildIndustryChainMap({
    query: '半导体',
    now: '2026-08-29T02:00:00.000Z',
    stocks: [
      {
        code: '688012',
        name: '中微公司',
        industry: '半导体设备',
        boardsText: '半导体设备 刻蚀机',
        businessScope: '研发生产半导体刻蚀设备与薄膜沉积设备',
        source: 'Eastmoney F10',
        observedAt: '2026-08-29T01:00:00.000Z'
      },
      {
        code: '688019',
        name: '安集科技',
        industry: '半导体材料',
        businessSummary: '主营半导体CMP抛光液与湿电子化学品',
        source: 'Eastmoney F10',
        observedAt: '2026-08-28T22:00:00.000Z'
      },
      {
        code: '300999',
        name: '待核实公司',
        industry: '半导体设备',
        businessSummary: '布局芯片量测设备相关业务',
        source: '',
        observedAt: ''
      }
    ]
  });

  assert.equal(result.schema, 'webstock.industry-chain/v1');
  assert.equal(result.availability, 'available');
  assert.ok(result.confirmed.some(item => item.stock.code === '688012' && item.stage === 'equipment'));
  assert.ok(result.confirmed.some(item => item.stock.code === '688019' && item.stage === 'materials'));
  assert.ok(result.confirmed.every(item => item.evidence.length > 0));
  assert.ok(result.confirmed.every(item => item.evidence.every(evidence => evidence.source && evidence.observedAt)));
  assert.ok(result.confirmed.every(item => item.evidence.every(evidence => /^https:\/\/emweb\.securities\.eastmoney\.com\//.test(evidence.sourceUrl))));
  const incomplete = result.candidates.find(item => item.stock.code === '300999' && item.reasonCode === 'source-metadata-incomplete');
  assert.ok(incomplete);
  assert.equal(incomplete.stage, 'equipment');
  assert.equal(incomplete.observedAt, null);
  assert.ok(incomplete.evidence.length > 0);
  assert.equal(result.methodology.hardcodedStockMembership, false);
  assert.equal(result.methodology.investmentRecommendation, false);
});

test('explicitly associated knowledge evidence can confirm a CPO component while unassociated text cannot', () => {
  const result = buildIndustryChainMap({
    query: 'CPO零部件',
    now: '2026-08-29T02:00:00.000Z',
    stocks: [
      {
        code: '300308',
        name: '中际旭创',
        industry: '通信设备',
        source: 'Eastmoney F10',
        observedAt: '2026-08-29T01:00:00.000Z'
      },
      {
        code: '000977',
        name: '浪潮信息',
        industry: '计算机设备',
        source: 'Eastmoney F10',
        observedAt: '2026-08-29T01:00:00.000Z'
      }
    ],
    knowledgeEvidence: [
      {
        evidenceId: 'K-cpo-1',
        title: '公司产品资料',
        source: '本地知识库',
        sourceUrl: 'https://example.com/cpo',
        observedAt: '2026-08-28T12:00:00.000Z',
        stockCodes: ['300308'],
        stockAssociationProvenance: 'manual-evidence-field',
        content: '中际旭创的高速光模块与光引擎用于CPO和数据中心互连。'
      },
      {
        evidenceId: 'K-generic-1',
        title: '行业资料',
        source: '本地知识库',
        observedAt: '2026-08-28T12:00:00.000Z',
        stockCodes: [],
        content: 'CPO产业链包括光模块、光引擎和交换芯片。'
      }
    ]
  });

  const relation = result.confirmed.find(item => item.stock.code === '300308' && item.stage === 'components');
  assert.ok(relation);
  assert.ok(relation.evidence.some(evidence => evidence.evidenceId === 'K-cpo-1'));
  assert.ok(!result.confirmed.some(item => item.stock.code === '000977'));
  assert.equal(result.coverage.unassociatedEvidenceCount, 1);
});

test('industry-chain map separates a traceable theme match that lacks stage evidence', () => {
  const result = buildIndustryChainMap({
    query: '机器人',
    stocks: [{
      code: '002999',
      name: '示例公司',
      industry: '机器人概念',
      businessSummary: '公司关注具身智能行业机会',
      source: 'Eastmoney F10',
      observedAt: '2026-08-28T12:00:00.000Z'
    }]
  });

  assert.equal(result.confirmed.length, 0);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].reasonCode, 'needs-stage-evidence');
  assert.equal(result.candidates[0].stage, null);
  assert.equal(result.candidates[0].observedAt, '2026-08-28T12:00:00.000Z');
  assert.ok(result.candidates[0].evidence[0].source);
  assert.equal(result.availability, 'empty');
});

test('industry-chain map reports source unavailability instead of inventing candidates', () => {
  const result = buildIndustryChainMap({ query: '新能源电池', stocks: [], knowledgeEvidence: [], newsEvidence: [] });

  assert.equal(result.availability, 'unavailable');
  assert.deepEqual(result.confirmed, []);
  assert.deepEqual(result.candidates, []);
  assert.ok(result.dataGaps.some(item => /没有可用的本地股票元数据/.test(item)));
});

test('a generic downstream application does not by itself prove PCB-chain exposure', () => {
  const result = buildIndustryChainMap({
    query: 'PCB',
    stocks: [{
      code: '000001',
      name: '消费电子示例',
      industry: '消费电子',
      businessSummary: '主营消费电子终端产品',
      source: 'Eastmoney F10',
      observedAt: '2026-08-28T12:00:00.000Z'
    }]
  });

  assert.equal(result.confirmed.length, 0);
  assert.equal(result.candidates.length, 0);
});

test('an ambiguous photovoltaic silicon-wafer mention does not confirm semiconductor-material exposure', () => {
  const result = buildIndustryChainMap({
    query: '半导体材料',
    stocks: [{
      code: '000012',
      name: '光伏硅片示例',
      industry: '光伏玻璃',
      businessSummary: '生产高纯晶硅、硅片和光伏组件。',
      source: 'Eastmoney F10',
      observedAt: '2026-08-29T01:00:00.000Z'
    }]
  });

  assert.equal(result.confirmed.length, 0);
  assert.equal(result.candidates.length, 0);
});

test('industry-chain company discovery excludes ETF and fund codes', () => {
  const result = buildIndustryChainMap({
    query: '半导体',
    stocks: [{
      code: '588000',
      name: '科创50ETF',
      industry: '半导体芯片设计',
      source: 'local fund list',
      observedAt: '2026-08-29T01:00:00.000Z'
    }]
  });

  assert.equal(result.confirmed.length, 0);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.coverage.stockMetadataCount, 0);
});

test('unclassified candidates appear once at chain level instead of being repeated under every stage', () => {
  const result = buildIndustryChainMap({
    query: '机器人',
    stocks: [{
      code: '002999',
      name: '示例公司',
      industry: '机器人概念',
      source: 'Eastmoney F10',
      observedAt: '2026-08-28T12:00:00.000Z'
    }]
  });

  assert.equal(result.chains[0].candidates.length, 1);
  assert.equal(result.chains[0].stages.reduce((sum, stage) => sum + stage.candidates.length, 0), 0);
});

test('local fallback news is labeled fallback rather than available provider evidence', async () => {
  const result = await discoverIndustryChains({
    query: 'CPO',
    sources: {
      stocks: async function() { return []; },
      knowledge: async function() { return []; },
      news: async function() {
        return [{
          id: 'fallback-1',
          title: 'CPO研究提示',
          source: 'WebStock Fallback',
          time: '2026-08-29T01:00:00.000Z',
          relatedStocks: ['300308'],
          summary: '光模块研究提示',
          evidenceKind: 'local-fallback'
        }];
      }
    }
  });

  assert.equal(result.sourceMeta.news.status, 'fallback');
  assert.equal(result.confirmed.length, 0);
  assert.ok(result.dataGaps.some(item => /兜底资讯/.test(item)));
});

test('explicit negative CPO disclosure is not confirmed and remains a negative-evidence candidate', () => {
  const result = buildIndustryChainMap({
    query: 'CPO光模块',
    stocks: [{
      code: '300308',
      name: '否认相关业务示例',
      industry: '通信设备',
      businessSummary: '公司目前没有 CPO 光模块相关产品或业务。',
      source: 'Eastmoney F10',
      observedAt: '2026-08-29T01:00:00.000Z'
    }]
  });

  assert.equal(result.confirmed.length, 0);
  const candidate = result.candidates.find(function(item) {
    return item.stock.code === '300308' && item.reasonCode === 'negative-evidence';
  });
  assert.ok(candidate);
  assert.equal(candidate.status, 'candidate');
});

test('an unknown natural-language query does not silently expand to every industry chain', () => {
  const resolved = resolveIndustryChainQuery('银行');

  assert.deepEqual(resolved.chainIds, []);

  const result = buildIndustryChainMap({
    query: '银行',
    stocks: [{
      code: '600000',
      name: '浦发银行',
      industry: '银行',
      source: 'Eastmoney F10',
      observedAt: '2026-08-29T01:00:00.000Z'
    }]
  });
  assert.deepEqual(result.query.chainIds, []);
  assert.deepEqual(result.chains, []);
});

test('tags alone do not confirm CPO or optical-module business exposure', () => {
  const result = buildIndustryChainMap({
    query: 'CPO光模块',
    stocks: [{
      code: '300001',
      name: '标签命中示例',
      industry: '通信设备',
      businessSummary: '主营业务为企业网络服务。',
      tagsText: 'CPO/光模块',
      source: 'Eastmoney F10',
      observedAt: '2026-08-29T01:00:00.000Z'
    }]
  });

  assert.equal(result.confirmed.length, 0);
});

test('a six-digit sequence embedded in another identifier is not treated as a stock association', () => {
  const result = buildIndustryChainMap({
    query: 'CPO零部件',
    stocks: [{
      code: '300308',
      name: '中际旭创',
      industry: '通信设备',
      source: 'Eastmoney F10',
      observedAt: '2026-08-29T01:00:00.000Z'
    }],
    knowledgeEvidence: [{
      evidenceId: 'K-invoice-reference',
      title: '采购发票说明',
      source: '本地知识库',
      sourceUrl: 'https://example.com/invoice-reference',
      observedAt: '2026-08-29T01:00:00.000Z',
      stockCodes: ['invoice-999300308'],
      content: '该发票说明提到 CPO 光模块，但没有关联任何上市公司证券代码。'
    }]
  });

  assert.equal(result.confirmed.length, 0);
  assert.ok(!result.confirmed.some(function(item) { return item.stock.code === '300308'; }));
});

test('confirmed relations require an http(s) source URL or a generated Eastmoney F10 URL', () => {
  const result = buildIndustryChainMap({
    query: '半导体设备',
    stocks: [
      {
        code: '688111',
        name: '缺少来源链接示例',
        industry: '半导体设备',
        businessSummary: '主营半导体刻蚀设备。',
        source: '本地导入资料',
        observedAt: '2026-08-29T01:00:00.000Z'
      },
      {
        code: '688112',
        name: '原始链接示例',
        industry: '半导体设备',
        businessSummary: '主营半导体刻蚀设备。',
        source: '公司公告',
        sourceUrl: 'https://example.com/company-disclosure',
        observedAt: '2026-08-29T01:00:00.000Z'
      },
      {
        code: '688113',
        name: 'F10链接示例',
        industry: '半导体设备',
        businessSummary: '主营半导体刻蚀设备。',
        source: 'Eastmoney F10',
        observedAt: '2026-08-29T01:00:00.000Z'
      }
    ]
  });

  assert.ok(!result.confirmed.some(function(item) { return item.stock.code === '688111'; }));
  assert.ok(result.confirmed.some(function(item) { return item.stock.code === '688112'; }));
  assert.ok(result.confirmed.some(function(item) { return item.stock.code === '688113'; }));
  assert.ok(result.confirmed.every(function(item) {
    return item.evidence.every(function(evidence) { return /^https?:\/\//i.test(evidence.sourceUrl); });
  }));
});

test('derived text associations remain candidates instead of confirmed relations', () => {
  const result = buildIndustryChainMap({
    query: 'CPO零部件',
    stocks: [{
      code: '300308',
      name: '中际旭创',
      industry: '通信设备',
      source: 'Eastmoney F10',
      observedAt: '2026-08-29T01:00:00.000Z'
    }],
    newsEvidence: [{
      id: 'derived-news',
      title: 'CPO光模块行业观察',
      source: '公开资讯',
      sourceUrl: 'https://example.com/derived-news',
      observedAt: '2026-08-29T02:00:00.000Z',
      relatedStocks: ['300308'],
      associationProvenance: { relatedStocks: 'derived-text-match' },
      summary: '正文提到了中际旭创代码和CPO光模块。'
    }]
  });

  assert.equal(result.confirmed.length, 0);
  assert.ok(result.candidates.some(function(item) {
    return item.stock.code === '300308' && item.reasonCode === 'association-not-verified';
  }));
});

test('limit truncation does not repeat a confirmed relation in the candidate list', () => {
  const stocks = ['688201', '688202'].map(function(code, index) {
    return {
      code,
      name: '设备公司' + (index + 1),
      industry: '半导体设备',
      businessSummary: '主营半导体刻蚀设备与薄膜沉积设备。',
      tagsText: '半导体设备',
      source: 'Eastmoney F10',
      observedAt: '2026-08-29T01:00:00.000Z'
    };
  });
  const result = buildIndustryChainMap({ query: '半导体设备', stocks, limit: 1 });

  assert.equal(result.confirmed.length, 1);
  assert.equal(result.coverage.totalConfirmedRelationCount, 2);
  assert.ok(!result.candidates.some(function(item) {
    return item.stockCode === '688202' && item.stage === 'equipment';
  }));
});

test('prefix-style nonexistence language is treated as negative evidence', () => {
  const result = buildIndustryChainMap({
    query: 'CPO零部件',
    stocks: [{
      code: '300777',
      name: '否定示例',
      businessSummary: '公司不存在CPO和光模块相关业务。',
      source: 'Eastmoney F10',
      observedAt: '2026-08-29T01:00:00.000Z'
    }]
  });
  assert.equal(result.confirmed.length, 0);
  assert.ok(result.candidates.some(function(item) { return item.reasonCode === 'negative-evidence'; }));
});

test('industry classification alone cannot confirm a company relationship', () => {
  const result = buildIndustryChainMap({
    query: 'CPO零部件',
    stocks: [{
      code: '300778',
      name: '行业分类示例',
      industry: 'CPO光模块',
      businessSummary: '主营企业管理软件服务。',
      source: 'Eastmoney F10',
      observedAt: '2026-08-29T01:00:00.000Z'
    }]
  });
  assert.equal(result.confirmed.length, 0);
  assert.ok(result.candidates.some(function(item) { return item.reasonCode === 'classification-only'; }));
});

test('only explicit association provenance values can confirm external evidence', () => {
  const result = buildIndustryChainMap({
    query: 'CPO零部件',
    stocks: [{ code: '300308', name: '中际旭创', source: 'Eastmoney F10', observedAt: '2026-08-29T01:00:00.000Z' }],
    newsEvidence: [{
      title: '模型归纳结果',
      source: '研究模型',
      sourceUrl: 'https://example.com/model-result',
      observedAt: '2026-08-29T02:00:00.000Z',
      relatedStocks: ['300308'],
      associationProvenance: { relatedStocks: 'model-inferred' },
      summary: '中际旭创涉及CPO光模块。'
    }]
  });
  assert.equal(result.confirmed.length, 0);
  assert.ok(result.candidates.some(function(item) { return item.reasonCode === 'association-not-verified'; }));
});

test('exchange prefixes must match the code market and Beijing 92 codes use BJ links', () => {
  const mismatched = buildIndustryChainMap({
    query: 'CPO零部件',
    stocks: [{ code: '300308', name: '中际旭创' }],
    knowledgeEvidence: [{
      source: '公司公告',
      sourceUrl: 'https://example.com/mismatch',
      observedAt: '2026-08-29T02:00:00.000Z',
      stockCodes: ['SH300308'],
      content: 'CPO光模块业务。'
    }]
  });
  assert.equal(mismatched.confirmed.length, 0);

  const beijing = buildIndustryChainMap({
    query: '半导体设备',
    stocks: [{
      code: 'BJ920001',
      name: '北交所示例',
      businessSummary: '主营半导体刻蚀设备。',
      source: 'Eastmoney F10',
      observedAt: '2026-08-29T01:00:00.000Z'
    }]
  });
  assert.ok(beijing.confirmed.some(function(item) { return item.stockCode === '920001'; }));
  assert.match(beijing.confirmed[0].evidence[0].sourceUrl, /code=BJ920001/);
});

test('non-http local evidence locators remain candidates because the web UI cannot open them', () => {
  const result = buildIndustryChainMap({
    query: 'CPO零部件',
    stocks: [{ code: '300308', name: '中际旭创' }],
    knowledgeEvidence: [{
      source: '本地知识库',
      sourceUrl: 'local-evidence://knowledge/K-1',
      observedAt: '2026-08-29T02:00:00.000Z',
      stockCodes: ['300308'],
      stockAssociationProvenance: 'manual-evidence-field',
      content: '中际旭创涉及CPO光模块。'
    }]
  });
  assert.equal(result.confirmed.length, 0);
  assert.ok(result.candidates.some(function(item) { return item.reasonCode === 'source-metadata-incomplete'; }));
});

test('common negative prefixes never confirm an industry-chain relationship', () => {
  ['尚无', '未有', '不做', '否认有', '未曾涉及', '目前无', '不拥有'].forEach(function(prefix, index) {
    const result = buildIndustryChainMap({
      query: 'CPO零部件',
      stocks: [{
        code: '3008' + String(index).padStart(2, '0'),
        name: '否定前缀示例' + index,
        businessSummary: '公司' + prefix + 'CPO光模块相关业务。',
        source: 'Eastmoney F10',
        observedAt: '2026-08-29T01:00:00.000Z'
      }]
    });
    assert.equal(result.confirmed.length, 0, prefix);
  });
});

test('external tags, sectors and a matching company name are discovery hints only', () => {
  const external = buildIndustryChainMap({
    query: 'CPO零部件',
    stocks: [{ code: '300308', name: '中际旭创' }],
    knowledgeEvidence: [{
      title: '普通企业资料',
      source: '本地知识库',
      sourceUrl: 'https://example.com/plain',
      observedAt: '2026-08-29T02:00:00.000Z',
      stockCodes: ['300308'],
      stockAssociationProvenance: 'manual-evidence-field',
      tags: ['CPO', '光模块'],
      sectors: ['光通信'],
      content: '正文只讨论一般企业管理事项。'
    }]
  });
  assert.equal(external.confirmed.length, 0);
  assert.ok(external.candidates.some(function(item) { return item.reasonCode === 'classification-only'; }));

  const nameOnly = buildIndustryChainMap({
    query: '机器人',
    stocks: [{
      code: '002888',
      name: '机器人示例公司',
      businessSummary: '主营餐饮服务。',
      source: 'Eastmoney F10',
      observedAt: '2026-08-29T01:00:00.000Z'
    }]
  });
  assert.equal(nameOnly.confirmed.length, 0);
});

test('missing association provenance defaults to candidate rather than an allowed source', () => {
  ['knowledgeEvidence', 'newsEvidence'].forEach(function(field) {
    const input = {
      query: 'CPO零部件',
      stocks: [{ code: '300308', name: '中际旭创' }]
    };
    input[field] = [{
      title: 'CPO光模块资料',
      source: '外部资料',
      sourceUrl: 'https://example.com/no-provenance',
      observedAt: '2026-08-29T02:00:00.000Z',
      stockCodes: ['300308'],
      relatedStocks: ['300308'],
      content: '公司涉及CPO光模块。'
    }];
    const result = buildIndustryChainMap(input);
    assert.equal(result.confirmed.length, 0, field);
    assert.ok(result.candidates.some(function(item) { return item.reasonCode === 'association-not-verified'; }));
  });
});

test('malformed http-like URLs cannot make evidence traceable', () => {
  ['https://#', 'https://?x', 'http://.'].forEach(function(sourceUrl, index) {
    const result = buildIndustryChainMap({
      query: 'CPO零部件',
      stocks: [{ code: '300308', name: '中际旭创' }],
      knowledgeEvidence: [{
        title: 'CPO光模块资料',
        source: '本地知识库',
        sourceUrl,
        observedAt: '2026-08-29T02:00:00.000Z',
        stockCodes: ['300308'],
        stockAssociationProvenance: 'manual-evidence-field',
        content: '公司涉及CPO光模块。' + index
      }]
    });
    assert.equal(result.confirmed.length, 0, sourceUrl);
  });
});
