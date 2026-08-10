const test = require('node:test');
const assert = require('node:assert/strict');

const { analyzeInvestmentText } = require('../services/investmentSignalService');

test('investment text analysis extracts named stocks, sectors, stance and horizon without inventing codes', () => {
  const result = analyzeInvestmentText({
    title: '先进封装机会与风险',
    description: '模型先生谈长电科技和先进封装。',
    transcript: '中期继续看好先进封装，但需要警惕订单不及预期，长电科技可以持续关注。',
    summary: '产业趋势向上，短期不要追高。'
  }, {
    catalog: [
      { code: '600584', name: '长电科技', industry: '半导体', boards: ['先进封装'] },
      { code: '000001', name: '平安银行', industry: '银行', boards: [] }
    ]
  });

  assert.deepEqual(result.stockCodes, ['600584']);
  assert.deepEqual(result.stockMentions, [{ code: '600584', name: '长电科技' }]);
  assert.ok(result.sectors.includes('先进封装'));
  assert.ok(result.sectors.includes('半导体'));
  assert.equal(result.stance, 'conditional');
  assert.equal(result.horizon, 'medium');
  assert.ok(result.keyPoints.some(item => item.includes('订单不及预期')));
  assert.ok(result.riskFlags.some(item => item.includes('订单不及预期')));
  assert.equal(result.analysisMethod, 'rule-v2');
});

test('investment text analysis remains unknown when the source contains no directional evidence', () => {
  const result = analyzeInvestmentText({ title: '日常记录', description: '今天复盘。' }, { catalog: [] });
  assert.deepEqual(result.stockCodes, []);
  assert.equal(result.stance, 'unknown');
  assert.equal(result.horizon, 'unspecified');
});

test('investment text analysis maps common creator wording to a canonical sector', () => {
  const result = analyzeInvestmentText({
    summary: '有色资源自主可控具有重要意义，有色板块龙头市值有望与科技龙头相当，目前处于早期阶段。'
  }, { catalog: [] });
  assert.ok(result.sectors.includes('有色金属'));
  assert.equal(result.stance, 'bullish');
});

test('investment text analysis does not map generic two-character words to stocks', () => {
  const result = analyzeInvestmentText({
    summary: '\u6709\u8272\u677f\u5757\u9f99\u5934\u5e02\u503c\u6709\u671b\u4e0e\u79d1\u6280\u9f99\u5934\u76f8\u5f53\uff0c\u76ee\u524d\u5904\u4e8e\u65e9\u671f\u53d1\u5c55\u9636\u6bb5\u3002'
  }, {
    catalog: [{ code: '000838', name: '\u53d1\u5c55', industry: '\u623f\u5730\u4ea7', boards: [] }]
  });

  assert.deepEqual(result.stockCodes, []);
  assert.ok(result.sectors.includes('\u6709\u8272\u91d1\u5c5e'));
});
