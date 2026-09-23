const DEFAULT_TITLE = 'WebStock 分析结果';

function appendOneClickOutputInstructions(prompt, options = {}) {
  const source = String(prompt || '').trim();
  if (/WEBSTOCK_RESULT_START/.test(source)) return source;
  const title = String(options.title || DEFAULT_TITLE).trim() || DEFAULT_TITLE;
  const extraSections = Array.isArray(options.sections) && options.sections.length
    ? options.sections.map(function(section) { return '- ' + section; }).join('\n')
    : [
      '- 核心结论：3-5 条，先说判断再说依据。',
      '- 优先观察：列出值得继续看的股票、板块或组合问题。',
      '- 风险与剔除：明确哪些逻辑不成立、哪些需要回避。',
      '- 下一步验证：列出明天或盘中要检查的数据。'
    ].join('\n');

  return source + '\n\n' + [
    '## WebStock 一键复制输出要求',
    '请在回答最后输出一个可直接复制回 WebStock 的结果块。',
    '要求：不要把边界标记放进代码块；边界标记必须单独占一行；块内使用 Markdown；内容要短、清楚、可复盘。',
    '',
    '格式必须严格如下：',
    'WEBSTOCK_RESULT_START',
    '# ' + title,
    extraSections,
    'WEBSTOCK_RESULT_END'
  ].join('\n');
}

module.exports = {
  appendOneClickOutputInstructions
};
