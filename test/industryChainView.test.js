const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const moduleSource = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'modules', 'industryChain.js'),
  'utf8'
);

function createElement() {
  return {
    innerHTML: '',
    textContent: '',
    value: '',
    disabled: false,
    checked: false,
    dataset: {},
    listeners: {},
    addEventListener(type, listener) {
      const previous = this.listeners[type];
      this.listeners[type] = event => { if (previous) previous(event); listener(event); };
    }
  };
}

function loadModule(fetchJsonData) {
  const ids = [
    'industryChainSearchInput',
    'industryChainSearchBtn',
    'industryChainCatalog',
    'industryChainStageMap',
    'industryChainConfirmed',
    'industryChainCandidates',
    'industryChainEvidenceState',
    'industryResearchPanel',
    'industryResearchTopics',
    'industryResearchDetail',
    'industryResearchProposalInput',
    'industryResearchSourceUrls',
    'industryResearchUseAi',
    'industryResearchStatus',
    'industryConceptSearchInput',
    'industryConceptRefreshBtn',
    'industryConceptRadarStatus',
    'industryConceptRadarList',
    'industryConceptRadarDetail'
  ];
  const elements = Object.fromEntries(ids.map(id => [id, createElement()]));
  const context = {
    window: { ApiClient: { fetchJsonData } },
    document: {
      getElementById(id) { return elements[id] || null; }
    },
    URLSearchParams,
    console,
    setTimeout,
    clearTimeout
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(moduleSource, context);
  return { api: context.window.IndustryChain, elements };
}

test('industry-chain catalog and discover requests use one configurable endpoint contract', async () => {
  const calls = [];
  const { api, elements } = loadModule(async function(url) {
    calls.push(url);
    if (/taxonomy/.test(url)) {
      return [{
        id: 'semiconductor',
        name: '半导体',
        stages: { materials: ['光刻胶'], equipment: ['刻蚀机'] }
      }];
    }
    return {
      availability: 'available',
      confirmed: [],
      candidates: [],
      dataGaps: []
    };
  });

  await api.loadCatalog();
  api.setSelection('semiconductor', 'equipment');
  await api.discover('半导体设备');

  assert.equal(calls[0], '/api/industry-chain/taxonomy');
  assert.match(calls[1], /^\/api\/industry-chain\?/);
  assert.match(calls[1], /q=%E5%8D%8A%E5%AF%BC%E4%BD%93%E8%AE%BE%E5%A4%87/);
  assert.match(calls[1], /chain=semiconductor/);
  assert.match(calls[1], /stage=equipment/);
  assert.match(calls[1], /limit=30/);
  assert.match(elements.industryChainCatalog.innerHTML, /data-industry-chain-id="semiconductor"/);
  assert.match(elements.industryChainStageMap.innerHTML, /data-industry-chain-stage="equipment"/);
});

test('manual evidence update submits visible source URLs instead of silently using old saved sources', async () => {
  let submitted;
  const {api,elements}=loadModule(async (url,options)=>{
    if(url.endsWith('/update')) {submitted=JSON.parse(options.body);return {data:{run:{status:'failed'}}};}
    return {data:{topic:{id:'bellows',name:'波纹管',sourceUrls:[]},currentVersion:null}};
  });
  await api.selectResearchTopic('bellows');
  elements.industryResearchSourceUrls.value='https://example.com/new-source';
  await api.updateResearchTopic();
  assert.deepEqual(submitted.sourceUrls,['https://example.com/new-source']);
});

test('switching graph and table keeps unsaved source edits', async () => {
 const {api,elements}=loadModule(async()=>({data:{topic:{id:'test',name:'测试',sourceUrls:['https://example.com/saved']},currentVersion:{id:'v1',relations:[],evidence:[]}}}));
 await api.selectResearchTopic('test');api.bind();
 elements.industryResearchSourceUrls.value='https://example.com/draft';
 const target={'data-research-view':'table',getAttribute:name=>name==='data-research-view'?'table':null};
 elements.industryResearchDetail.listeners.click({target});
 assert.equal(elements.industryResearchSourceUrls.value,'https://example.com/draft');
});

test('late post-update detail refresh cannot report success on a different topic', async () => {
 let release,reads=0;
 const {api,elements}=loadModule(async(url)=>{
  if(url.endsWith('/update'))return {data:{run:{status:'complete'}}};
  if(url.endsWith('/A')) {if(++reads===2)return new Promise(resolve=>{release=resolve;});return {data:{topic:{id:'A',name:'A',sourceUrls:['https://example.com/a']},currentVersion:null}};}
  return {data:{topic:{id:'B',name:'B',sourceUrls:[]},currentVersion:null}};
 });
 await api.selectResearchTopic('A');const update=api.updateResearchTopic();
 await new Promise(resolve=>setImmediate(resolve));await api.selectResearchTopic('B');
 release({data:{topic:{id:'A',name:'A'},currentVersion:null}});await update;
 assert.equal(elements.industryResearchStatus.textContent,'已加载研究主题：B');
});

test('industry-chain catalog can be force-refreshed instead of staying on the first cached taxonomy', async () => {
  let catalogCalls = 0;
  const { api } = loadModule(async function(url) {
    if (/taxonomy/.test(url)) {
      catalogCalls += 1;
      return [{ id: 'semiconductor', name: '半导体', stages: { materials: ['光刻胶'] } }];
    }
    return { availability: 'available', confirmed: [], candidates: [], dataGaps: [] };
  });

  await api.loadCatalog();
  await api.loadCatalog();
  await api.loadCatalog({ force: true });

  assert.equal(catalogCalls, 2);
});

test('industry-chain results separate confirmed relations from research candidates and show evidence', () => {
  const { api, elements } = loadModule(async function() { return {}; });

  api.renderResult({
    availability: 'available',
    confirmed: [{
      chain: 'semiconductor',
      stage: 'materials',
      stock: { code: '688019', name: '安集科技' },
      confidence: 0.92,
      observedAt: '2026-08-29T01:00:00.000Z',
      evidence: [{
        evidenceId: 'K-1',
        source: '公司公告',
        title: 'CMP 抛光液产品说明',
        sourceUrl: 'https://example.com/evidence/1',
        observedAt: '2026-08-28T12:00:00.000Z',
        matchReason: '主题与原材料环节同时命中'
      }]
    }],
    candidates: [{
      chain: 'semiconductor',
      stage: 'equipment',
      stock: { code: '300999', name: '待核实公司' },
      reasonCode: 'source-metadata-incomplete',
      evidence: []
    }],
    dataGaps: ['待补充公司官网或定期报告。']
  });

  assert.match(elements.industryChainConfirmed.innerHTML, /安集科技/);
  assert.match(elements.industryChainConfirmed.innerHTML, /CMP 抛光液产品说明/);
  assert.match(elements.industryChainConfirmed.innerHTML, /href="https:\/\/example\.com\/evidence\/1"/);
  assert.match(elements.industryChainCandidates.innerHTML, /待核实公司/);
  assert.match(elements.industryChainCandidates.innerHTML, /来源元数据不完整/);
  assert.doesNotMatch(elements.industryChainConfirmed.innerHTML, /待核实公司/);
  assert.match(elements.industryChainEvidenceState.innerHTML, /研究候选，不是荐股/);
  assert.match(elements.industryChainEvidenceState.innerHTML, /待补充公司官网或定期报告/);
});

test('industry-chain renderer accepts the backend chain identity object', () => {
  const { api, elements } = loadModule(async function() { return {}; });
  api.renderResult({
    availability: 'available',
    confirmed: [{
      chain: { id: 'ai-compute-cpo', name: 'AI算力与CPO' },
      stage: 'components',
      stockCode: '300308',
      stockName: '中际旭创',
      evidence: []
    }],
    candidates: []
  });

  assert.match(elements.industryChainConfirmed.innerHTML, /AI算力与CPO · 核心器件与零部件/);
  assert.doesNotMatch(elements.industryChainConfirmed.innerHTML, /\[object Object\]/);
});

test('industry-chain renderer escapes service text and blocks unsafe evidence links', () => {
  const { api, elements } = loadModule(async function() { return {}; });

  api.renderResult({
    availability: 'available',
    confirmed: [{
      chain: '<img src=x onerror=alert(1)>',
      stage: 'components',
      stock: {
        code: '1" onmouseover="alert(2)',
        name: '<script>alert(3)</script>'
      },
      evidence: [{
        source: '<img src=x onerror=alert(4)>',
        title: '<script>alert(5)</script>',
        sourceUrl: 'javascript:alert(6)',
        matchReason: '" onfocus="alert(7)'
      }]
    }],
    candidates: [],
    dataGaps: ['<img src=x onerror=alert(8)>']
  });

  const html = elements.industryChainConfirmed.innerHTML + elements.industryChainEvidenceState.innerHTML;
  assert.doesNotMatch(html, /<(?:script|img)\b/i);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.doesNotMatch(html, /<[^>]*\son(?:error|focus|mouseover)=/i);
  assert.match(html, /&lt;script&gt;alert\(3\)&lt;\/script&gt;/);
});

test('industry-chain renderer keeps unavailable and empty evidence states honest', () => {
  const { api, elements } = loadModule(async function() { return {}; });

  api.renderResult({ availability: 'unavailable', confirmed: [], candidates: [], dataGaps: [] });
  assert.match(elements.industryChainConfirmed.innerHTML, /证据源暂不可用/);
  assert.match(elements.industryChainCandidates.innerHTML, /没有待核验候选/);
  assert.match(elements.industryChainEvidenceState.innerHTML, /没有用 0 或猜测结果代替/);

  api.renderResult({ availability: 'empty', confirmed: [], candidates: [], dataGaps: ['需要补充主营业务证据。'] });
  assert.match(elements.industryChainConfirmed.innerHTML, /暂无已确认关联/);
  assert.match(elements.industryChainEvidenceState.innerHTML, /需要补充主营业务证据/);
});

test('industry-chain degraded state shows safe source coverage and keeps usable results', () => {
  const { api, elements } = loadModule(async function() { return {}; });

  api.renderResult({
    availability: 'degraded',
    confirmed: [{
      chain: { id: 'semiconductor', name: '半导体' },
      stage: 'materials',
      stock: { code: '688019', name: '安集科技' },
      evidence: []
    }],
    candidates: [],
    dataGaps: [
      '知识库需要稍后重试。',
      'knowledge 数据不可用：ENOENT C:\\private\\research.db'
    ],
    sourceMeta: {
      stockMetadata: {
        status: 'available',
        count: 6992,
        updatedAt: '2026-08-29T01:30:00.000Z'
      },
      knowledge: {
        status: 'unavailable',
        count: 0
      },
      news: {
        status: 'fallback',
        count: 12,
        usableEvidenceCount: 0,
        fetchedAt: '2026-08-29T01:35:00.000Z'
      },
      errors: [{
        source: 'knowledge',
        message: 'ENOENT C:\\private\\research.db'
      }]
    }
  });

  assert.match(elements.industryChainConfirmed.innerHTML, /安集科技/);
  assert.match(elements.industryChainEvidenceState.innerHTML, /部分数据源暂不可用/);
  assert.match(elements.industryChainEvidenceState.innerHTML, /股票基础资料/);
  assert.match(elements.industryChainEvidenceState.innerHTML, /可用 · 6992 条/);
  assert.match(elements.industryChainEvidenceState.innerHTML, /本地研究资料/);
  assert.match(elements.industryChainEvidenceState.innerHTML, /暂不可用 · 0 条/);
  assert.match(elements.industryChainEvidenceState.innerHTML, /公开资讯证据/);
  assert.match(elements.industryChainEvidenceState.innerHTML, /仅本地兜底 · 12 条/);
  assert.match(elements.industryChainEvidenceState.innerHTML, /更新时间未提供/);
  assert.match(elements.industryChainEvidenceState.innerHTML, /知识库需要稍后重试/);
  assert.doesNotMatch(elements.industryChainEvidenceState.innerHTML, /private/);
  assert.doesNotMatch(elements.industryChainEvidenceState.innerHTML, /ENOENT/);
});

test('a slower earlier discovery request cannot overwrite the latest selection', async () => {
  const pending = {};
  const { api, elements } = loadModule(function(url) {
    return new Promise(function(resolve) {
      pending[new URL('http://local' + url).searchParams.get('q')] = resolve;
    });
  });

  const first = api.discover('第一次');
  const second = api.discover('第二次');
  pending['第二次']({
    availability: 'available',
    confirmed: [{ stock: { code: '000002', name: '第二次结果' }, chain: 'robotics', stage: 'equipment', evidence: [] }],
    candidates: []
  });
  await second;
  assert.match(elements.industryChainConfirmed.innerHTML, /第二次结果/);

  pending['第一次']({
    availability: 'available',
    confirmed: [{ stock: { code: '000001', name: '过期结果' }, chain: 'semiconductor', stage: 'materials', evidence: [] }],
    candidates: []
  });
  await first;
  assert.match(elements.industryChainConfirmed.innerHTML, /第二次结果/);
  assert.doesNotMatch(elements.industryChainConfirmed.innerHTML, /过期结果/);
});

test('truncated results disclose visible and total relation counts', () => {
  const { api, elements } = loadModule(async function() { return {}; });
  api.renderResult({
    availability: 'available',
    confirmed: [{ stock: { code: '000001', name: '确认样本' }, evidence: [] }],
    candidates: [{ stock: { code: '000002', name: '候选样本' }, evidence: [] }],
    coverage: {
      totalConfirmedRelationCount: 7,
      totalCandidateRelationCount: 43,
      truncated: true
    }
  });

  assert.match(elements.industryChainEvidenceState.innerHTML, /已确认 1 \/ 7 条/);
  assert.match(elements.industryChainEvidenceState.innerHTML, /待核验 1 \/ 43 条/);
  assert.match(elements.industryChainEvidenceState.innerHTML, /缩小产业链或环节/);

  api.renderResult({
    availability: 'empty',
    confirmed: [],
    candidates: [{ stock: { code: '000002', name: '候选样本' }, evidence: [] }],
    coverage: { totalConfirmedRelationCount: 0, totalCandidateRelationCount: 43, truncated: true }
  });
  assert.match(elements.industryChainEvidenceState.innerHTML, /当前证据不足/);
  assert.match(elements.industryChainEvidenceState.innerHTML, /待核验 1 \/ 43 条/);
});

test('research panel loads topics, keeps AI opt-in, renders evidence states and saves config', async () => {
  const calls = [];
  const { api, elements } = loadModule(async function(url, options) {
    calls.push({ url, options });
    if (url.endsWith('/research/topics')) return { data: [{ id: 'bellows', name: '波纹管', enabled: false, intervalMinutes: 1440, nextDueAt: null }] };
    if (url.endsWith('/research/topics/bellows')) return { data: { topic: { id: 'bellows', name: '波纹管', enabled: false, intervalMinutes: 1440, nextDueAt: null }, currentVersion: { analysis: { kind: 'none' }, relations: [{ id: 'r1', stage: 'components', product: '具体器件', company: null, claim: '支持某用途', status: 'candidate', polarity: 'supports', evidenceRefs: [{ evidenceId: 'e1', quote: '支持某用途', position: { start: 1, end: 5 } }], metrics: [{ name: '效率', value: null, unit: null, scope: null }], evidence: [{ id: 'e1', finalUrl: 'https://example.com/source', publishedAt: null, publishedTimePrecision: 'unknown', fetchedAt: '2026-09-08T01:00:00.000Z', contentSha256: 'hash' }] }], evidence: [] }, versions: [] } };
    return { data: { id: 'bellows', enabled: true, intervalMinutes: 120, nextDueAt: '2026-09-09T03:00:00.000Z' } };
  });
  await api.loadResearchTopics();
  assert.match(elements.industryResearchTopics.innerHTML, /波纹管/);
  assert.equal(elements.industryResearchUseAi.checked, false);
  await api.selectResearchTopic('bellows');
  assert.match(elements.industryResearchDetail.innerHTML, /具体器件/);
  assert.match(elements.industryResearchDetail.innerHTML, /发布时间未知/);
  assert.match(elements.industryResearchDetail.innerHTML, /candidate/);
  await api.saveResearchConfig('bellows', { enabled: true, intervalMinutes: 120 });
  assert.equal(calls[calls.length - 1].options.method, 'PUT');
  assert.match(elements.industryResearchStatus.textContent, /已保存/);
});

test('stale research detail response cannot overwrite the latest topic selection', async () => {
  const pending = {};
  const { api, elements } = loadModule(function(url) {
    const id = url.match(/topics\/([^/?]+)/)[1];
    return new Promise(resolve => { pending[id] = resolve; });
  });
  const first = api.selectResearchTopic('bellows');
  const second = api.selectResearchTopic('diamond-thermal');
  pending['diamond-thermal']({ data: { topic: { name: '金刚石散热' }, currentVersion: null, versions: [] } });
  await second;
  assert.match(elements.industryResearchDetail.innerHTML, /金刚石散热/);
  pending.bellows({ data: { topic: { name: '波纹管' }, currentVersion: null, versions: [] } });
  await first;
  assert.match(elements.industryResearchDetail.innerHTML, /金刚石散热/);
  assert.doesNotMatch(elements.industryResearchDetail.innerHTML, /波纹管/);
});

test('concept radar discovers unknown concepts, previews constituents and adds a research topic', async () => {
  const calls = [];
  let tracked = false;
  const { api, elements } = loadModule(async function(url, options) {
    calls.push({ url, options });
    if (url.startsWith('/api/industry-chain/research/concepts?')) return { data: {
      summary: { total: 705, shown: 1, newCount: 1, trackedCount: tracked ? 1 : 0, baselineInitialized: false },
      source: { provider: 'sina-public-concept', status: 'available', fetchedAt: '2026-09-09T01:00:00.000Z', stale: false, coverageComplete: true },
      items: [{ name: '盾构机', isNew: true, trackedTopicId: tracked ? 'concept_1' : null, classification: '热门概念', source: { provider: 'sina-public-concept', providerId: 'chgn_730628' } }]
    } };
    if (url.startsWith('/api/market/boards/constituents?')) return { data: {
      status: 'available', coverageComplete: true, items: [{ code: '600000', name: '示例公司', status: 'available' }]
    } };
    if (url.endsWith('/research/concepts/track')) {
      tracked = true;
      return { data: { created: true, topic: { id: 'concept_1', name: '盾构机', enabled: false, intervalMinutes: 1440, config: { origin: 'concept-directory' } } } };
    }
    if (url.endsWith('/research/topics')) return { data: tracked ? [{ id: 'concept_1', name: '盾构机', enabled: false, intervalMinutes: 1440 }] : [] };
    return { data: {} };
  });

  await api.loadConceptDiscovery({ query: '盾构' });
  assert.match(calls[0].url, /\/research\/concepts\?/);
  assert.match(calls[0].url, /q=%E7%9B%BE%E6%9E%84/);
  assert.match(elements.industryConceptRadarStatus.textContent, /705/);
  assert.match(elements.industryConceptRadarList.innerHTML, /盾构机/);
  assert.match(elements.industryConceptRadarList.innerHTML, /新发现/);

  await api.selectConcept('sina-public-concept', 'chgn_730628', '盾构机');
  assert.match(elements.industryConceptRadarStatus.textContent, /705/);
  assert.match(elements.industryConceptRadarStatus.textContent, /新浪公开概念目录/);
  assert.match(elements.industryConceptRadarDetail.innerHTML, /示例公司/);
  assert.match(elements.industryConceptRadarDetail.innerHTML, /加入持续研究/);

  await api.trackConcept('sina-public-concept', 'chgn_730628');
  const write = calls.find(call => call.url.endsWith('/research/concepts/track'));
  assert.equal(write.options.method, 'POST');
  assert.match(elements.industryResearchTopics.innerHTML, /盾构机/);
  assert.match(elements.industryConceptRadarDetail.innerHTML, /已加入研究/);
});
