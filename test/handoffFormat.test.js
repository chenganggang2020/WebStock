const test = require('node:test');
const assert = require('node:assert/strict');
const { appendOneClickOutputInstructions } = require('../services/handoffFormat');
const screener = require('../services/screenerService');

test('appendOneClickOutputInstructions adds a copyable WebStock result block requirement', () => {
  const prompt = appendOneClickOutputInstructions('请分析候选股。', { title: '智能选股分析' });

  assert.match(prompt, /WEBSTOCK_RESULT_START/);
  assert.match(prompt, /WEBSTOCK_RESULT_END/);
  assert.match(prompt, /不要把边界标记放进代码块/);
  assert.match(prompt, /智能选股分析/);
});

test('screener ChatGPT handoff prompt asks for one-click copy output', () => {
  const prompt = screener.buildPrompt({
    demand: '寻找半导体观察股',
    strategy: 'momentum',
    scope: 'watchlist',
    candidates: [{
      code: '688981',
      name: '中芯国际',
      score: 82,
      factorTags: ['半导体'],
      reasons: ['板块核心'],
      risks: ['波动较大']
    }]
  });

  assert.match(prompt, /WEBSTOCK_RESULT_START/);
  assert.match(prompt, /WEBSTOCK_RESULT_END/);
  assert.match(prompt, /一键复制/);
});
