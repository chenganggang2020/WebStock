const test = require('node:test');
const assert = require('node:assert/strict');

const MarketHeatmapModel = require('../js/modules/marketHeatmapModel');

test('turnover heatmap sizes boards by成交额 and colors them by daily change', () => {
  const result = MarketHeatmapModel.buildTreemapModel([
    { code: 'BK0001', name: '半导体', kind: 'industry', amount: 900000000, dailyChangePct: 2.5, mainNetInflow: 80000000 },
    { code: 'new_it', name: '电子信息', kind: 'sina-industry', amount: 1200000000, dailyChangePct: -1.25, mainNetInflow: null, capabilities: { constituents: true } },
    { code: 'BK0002', name: '机器人', kind: 'concept', amount: 600000000, dailyChangePct: 0, mainNetInflow: -30000000 }
  ]);

  assert.equal(result.mode, 'turnover');
  assert.equal(result.availability, 'available');
  assert.deepEqual(result.nodes.map(function(node) {
    return [node.name, node.group, node.areaValue, node.colorValue, node.value];
  }), [
    ['电子信息', 'industry', 1200000000, -1.25, [1200000000, -1.25]],
    ['半导体', 'industry', 900000000, 2.5, [900000000, 2.5]],
    ['机器人', 'concept', 600000000, 0, [600000000, 0]]
  ]);
  assert.equal(result.areaMetric.key, 'amount');
  assert.equal(result.colorMetric.key, 'dailyChangePct');
  assert.equal(result.nodes.find(function(node) { return node.code === 'BK0001'; }).drillable, true);
  assert.equal(result.nodes.find(function(node) { return node.code === 'new_it'; }).drillable, true);
});

test('fund-flow heatmap uses absolute net flow for area and signed net flow for color', () => {
  const result = MarketHeatmapModel.buildTreemapModel([
    { code: 'BK001', name: '净流出板块', kind: 'industry', amount: 1, dailyChangePct: 8, mainNetInflow: -320000000 },
    { code: 'BK002', name: '净流入板块', kind: 'concept', amount: 1, dailyChangePct: -4, mainNetInflow: 120000000 }
  ], { mode: 'flow' });

  assert.deepEqual(result.nodes.map(function(node) {
    return [node.name, node.areaValue, node.colorValue, node.value];
  }), [
    ['净流出板块', 320000000, -320000000, [320000000, -320000000]],
    ['净流入板块', 120000000, 120000000, [120000000, 120000000]]
  ]);
  assert.equal(result.areaMetric.key, 'absoluteMainNetInflow');
  assert.equal(result.colorMetric.key, 'mainNetInflow');
});

test('missing or zero-sized metrics are excluded without fabricated fallback values', () => {
  const turnover = MarketHeatmapModel.buildTreemapModel([
    { code: 'A', name: '缺成交额', kind: 'industry', amount: null, dailyChangePct: 1 },
    { code: 'B', name: '缺涨跌幅', kind: 'industry', amount: 100, dailyChangePct: null },
    { code: 'C', name: '零成交额', kind: 'concept', amount: 0, dailyChangePct: -1 },
    { code: 'D', name: '本地观察板块', kind: 'local-watch', amount: 100, dailyChangePct: 2 }
  ]);
  const flow = MarketHeatmapModel.buildTreemapModel([
    { code: 'A', name: '缺资金', kind: 'industry', mainNetInflow: null },
    { code: 'B', name: '零资金', kind: 'concept', mainNetInflow: 0 }
  ], { mode: 'flow' });

  assert.equal(turnover.availability, 'unavailable');
  assert.deepEqual(turnover.nodes, []);
  assert.equal(turnover.includedCount, 0);
  assert.equal(turnover.excludedCount, 4);
  assert.equal(flow.availability, 'unavailable');
  assert.deepEqual(flow.nodes, []);
  assert.equal(flow.excludedCount, 2);
});

test('board type filtering treats Sina industry as industry and never relabels local watch groups', () => {
  const result = MarketHeatmapModel.buildTreemapModel([
    { code: 'A', name: '新浪行业', kind: 'sina-industry', amount: 100, dailyChangePct: 1 },
    { code: 'B', name: '概念', kind: 'concept', amount: 200, dailyChangePct: 2 },
    { code: 'C', name: '本地观察', kind: 'local-watch', amount: 300, dailyChangePct: 3 }
  ], { boardType: 'industry' });

  assert.deepEqual(result.nodes.map(function(node) { return node.name; }), ['新浪行业']);
  assert.equal(result.totalCount, 3);
  assert.equal(result.includedCount, 1);
  assert.equal(result.excludedCount, 2);
});

test('dense board clouds can focus on the largest 120 cells without losing total coverage metadata', () => {
  const boards = Array.from({ length: 145 }, function(_, index) {
    return {
      code: 'BK' + String(index + 1).padStart(4, '0'),
      name: '概念' + (index + 1),
      kind: 'concept',
      amount: 1000 + index,
      dailyChangePct: index % 2 ? -1 : 1
    };
  });
  const result = MarketHeatmapModel.buildTreemapModel(boards, { boardType: 'concept', limit: 120 });

  assert.equal(result.validCount, 145);
  assert.equal(result.displayedCount, 120);
  assert.equal(result.omittedCount, 25);
  assert.equal(result.nodes.length, 120);
  assert.equal(result.nodes[0].name, '概念145');
  assert.equal(result.nodes[result.nodes.length - 1].name, '概念26');
});
