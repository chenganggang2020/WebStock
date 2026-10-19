const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'modules', 'externalResearch.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

test('latest external AI hotspots and industry chains render with provenance and escaped content', async () => {
  const elements = {
    externalHotspotResearch: { innerHTML: '' },
    externalIndustryChainResearch: { innerHTML: '' }
  };
  const payload = {
    hotspots: {
      marketDate: '2026-08-31', source: { model: 'Pro' },
      payload: { summary: '<img src=x onerror=alert(1)>', items: [{ name: '算力', state: '升温', thesis: '成交活跃', drivers: ['订单'], risks: ['高位'], evidenceRefs: ['https://example.com/hot'] }] }
    },
    industryChains: {
      marketDate: '2026-08-31', source: { model: 'Pro' },
      payload: { summary: '设备更新', chains: [{ name: '半导体设备', state: '跟踪', thesis: '国产化', stages: ['设备'], catalysts: ['招标'], risks: ['验证不足'], evidenceRefs: ['javascript:alert(2)'] }] }
    }
  };
  const context = {
    window: { ApiClient: { fetchJsonData: async function(url) { assert.equal(url, '/api/external-research-batches/latest-artifacts'); return payload; } } },
    document: { getElementById: function(id) { return elements[id] || null; } },
    module: { exports: {} }, exports: {}, console
  };
  vm.runInNewContext(source, context);
  await context.window.ExternalResearch.load();
  assert.match(elements.externalHotspotResearch.innerHTML, /算力/);
  assert.match(elements.externalHotspotResearch.innerHTML, /2026-08-31 · Pro · 外部 AI 研究，未由本程序独立验证/);
  assert.doesNotMatch(elements.externalHotspotResearch.innerHTML, /<img\b|<[^>]+\sonerror=/i);
  assert.match(elements.externalIndustryChainResearch.innerHTML, /半导体设备/);
  assert.match(elements.externalIndustryChainResearch.innerHTML, /跟踪产业链/);
  assert.match(elements.externalIndustryChainResearch.innerHTML, /催化线索/);
  assert.match(elements.externalIndustryChainResearch.innerHTML, /招标/);
  assert.match(elements.externalIndustryChainResearch.innerHTML, /风险反证/);
  assert.doesNotMatch(elements.externalIndustryChainResearch.innerHTML, /href="javascript:/i);
});

test('external research panels are mounted on hotspot and industry-chain pages and refreshed on navigation', () => {
  assert.match(indexSource, /id="externalHotspotResearch"/);
  assert.match(indexSource, /id="externalIndustryChainResearch"/);
  assert.match(indexSource, /js\/modules\/externalResearch\.js/);
  assert.match(appSource, /ExternalResearch\.load/);
  assert.match(indexSource, /id="refreshIndustryChainBtn"/);
  assert.match(indexSource, /id="industryChainResearchFile"/);
  assert.match(indexSource, /id="industryChainRefreshStatus"/);
});
