// Deterministic browser fixture. Requests never reach the business backend.
(function() {
  const el = id => document.getElementById(id);
  const sample = { key: 'sox', name: '费城半导体 · 测试数据', source: 'QA fixture', sessionDate: '2026-10-08',
    group: '测试指数', status: 'available', value: 102, previousClose: 100, changePct: 2,
    observedAt: '2026-10-08T15:00:00Z', fetchedAt: '2026-10-09T01:00:00Z',
    points: Array.from({ length: 60 }, (_, i) => ({ time: Date.parse('2026-10-08T14:00:00Z') + i * 60000, close: i === 20 ? null : 100 + Math.sin(i / 7) * 2 })),
    candles: Array.from({ length: 20 }, (_, i) => ({ date: '2026-09-' + String(i + 1).padStart(2, '0'), open: 100 + i, close: 101 + i, high: 102 + i, low: 99 + i, volume: 1000 + i })) };
  let boardItem = sample, errors = [], results = [], chartUpdates = 0, comparisonRenders = 0, pending = [];
  const originalRender = ChartTheme.renderTo;
  ChartTheme.renderTo = function(...args) { chartUpdates++; return originalRender.apply(this, args); };
  MarketComparison.render = () => comparisonRenders++;
  window.State = {};
  window.ApiClient = { fetchJsonData(url) {
    if (url.startsWith('/api/market/global-board?')) return Promise.resolve({ catalog: [{ key: 'sox', name: sample.name, group: '测试指数' }], items: [boardItem] });
    if (url.startsWith('/api/market/global-board/sox?')) return Promise.resolve(boardItem);
    return new Promise((resolve, reject) => pending.push({ url, resolve, reject }));
  } };
  function check(condition, message) { if (!condition) throw Error(message); results.push('PASS ' + message); el('results').textContent = results.join('\n'); }
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));
  window.addEventListener('error', event => errors.push(event.message));
  el('runChecks').onclick = async function() {
    this.disabled = true;
    try {
      let finishVolume;
      window.VolumePace = { load: () => new Promise(resolve => { finishVolume = resolve; }) };
      const loading = Dashboard.load({ force: true });
      pending.find(row => row.url.includes('/sentiment/')).resolve({ aShare: { score: 51, label: '测试中性' }, updatedAt: '2026-10-09T01:00:00Z' });
      await flush();
      check(el('dashboardSentimentPanel').textContent.includes('测试中性'), '情绪先显示，无需等待历史与量能');
      pending.filter(row => !row.url.includes('/sentiment/')).forEach(row => row.resolve(row.url.includes('index-history') ? { window: 60, series: [] } : {}));
      await flush(); const beforeFinish = comparisonRenders;
      finishVolume(); await loading;
      check(comparisonRenders === beforeFinish, '慢请求结束没有额外重绘');
      pending = [];
      const failure = MarketOverview.load({ refresh: true });
      pending.forEach(row => row.reject(new Error('QA timeout'))); await failure;
      check(el('dashboardSentimentPanel').textContent.includes('测试中性') && el('dashboardMarketSources').textContent.includes('刷新失败'), '失败保留旧内容与状态提示');

      await MarketBoard.load(); await MarketBoard.open('sox');
      const chart = echarts.getInstanceByDom(el('dashboardGlobalDetailChart'));
      chart.dispatchAction({ type: 'dataZoom', start: 25, end: 70 });
      const choices = el('marketBoardChoices'), checkbox = choices.querySelector('input');
      choices.open = true; checkbox.focus();
      const beforePoll = chartUpdates;
      await MarketBoard.load();
      check(chartUpdates === beforePoll && echarts.getInstanceByDom(el('dashboardGlobalDetailChart')) === chart, '相同数据不调用图表重绘');
      check(choices === el('marketBoardChoices') && choices.open && document.activeElement === checkbox, '刷新保留设置展开、控件身份与焦点');
      check(chart.getOption().dataZoom[0].start === 25 && chart.getOption().dataZoom[0].end === 70, '刷新保留局部缩放');
      boardItem = { ...sample, points: [], status: 'loading', reason: 'QA delayed' };
      await MarketBoard.load();
      check(echarts.getInstanceByDom(el('dashboardGlobalDetailChart')) === chart && el('dashboardGlobalDetailSource').textContent.includes('保留'), '加载中响应不清除已有曲线');
      check(chart.getOption().series[0].data[20] === null, '真实缺点仍为 null');
      boardItem = sample;
      await MarketBoard.open('sox', 'daily');
      check(echarts.getInstanceByDom(el('dashboardGlobalDetailChart')).getOption().series[0].type === 'candlestick', '日 K 使用真实图表构建器');
      await MarketBoard.open('sox', 'intraday');
      check(echarts.getInstanceByDom(el('dashboardGlobalDetailChart')).getOption().series[0].type === 'line', '返回分时显示正常');
      check(errors.length === 0, '无页面脚本异常');
      el('results').textContent += '\n完成：' + results.length + ' 项通过（夹具，不是真实行情验收）';
    } catch (error) { el('results').textContent += '\nFAIL ' + error.stack; }
  };
})();
