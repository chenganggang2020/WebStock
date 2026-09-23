let allocationChart = null;
let pnlRankChart = null;
let statsAllocationChart = null;
let statsPnlChart = null;

function chartTextColor() {
  const dark = document.body.classList.contains('dark');
  return window.ChartTheme ? window.ChartTheme.get(dark).colors.text : (dark ? '#91a7bd' : '#586c81');
}

function chartNumber(value) {
  if (value == null || typeof value === 'boolean' || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function renderPie(el, data) {
  if (!el || !window.echarts) return null;
  const chart = echarts.init(el);
  const complete = data.every(item => chartNumber(item.marketValue) !== null && chartNumber(item.ratio) !== null);
  const option = {
    tooltip: { trigger: 'item', formatter: '{b}<br/>{c} ({d}%)' },
    legend: { bottom: 0, textStyle: { color: chartTextColor() } },
    graphic: complete ? [] : [{
      type: 'text', left: 'center', top: 'middle', z: 10,
      style: { text: '报价不完整，暂无法计算持仓占比', fill: chartTextColor(), textAlign: 'center' }
    }],
    series: [{
      name: '持仓占比',
      type: 'pie',
      showEmptyCircle: false,
      radius: ['38%', '68%'],
      center: ['50%', '45%'],
      data: complete ? data.map(item => ({ name: item.name + '(' + item.code + ')', value: chartNumber(item.marketValue) })) : [],
      label: { color: chartTextColor() }
    }]
  };
  if (window.ChartTheme) window.ChartTheme.applyToOption(option, {dark:document.body.classList.contains('dark')});
  chart.setOption(option);
  return chart;
}

function renderBar(el, positions) {
  if (!el || !window.echarts) return null;
  const chart = echarts.init(el);
  const sorted = positions.slice().sort((a, b) => {
    const left = chartNumber(a.unrealizedPnl);
    const right = chartNumber(b.unrealizedPnl);
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    return right - left;
  });
  const option = {
    tooltip: { trigger: 'axis' },
    grid: { left: 48, right: 20, top: 30, bottom: 48 },
    xAxis: {
      type: 'category',
      data: sorted.map(item => item.name || item.code),
      axisLabel: { color: chartTextColor(), rotate: sorted.length > 6 ? 25 : 0 }
    },
    yAxis: { type: 'value', axisLabel: { color: chartTextColor() } },
    series: [{
      name: '浮动盈亏',
      type: 'bar',
      data: sorted.map(item => chartNumber(item.unrealizedPnl)),
      itemStyle: {
        color: function(params) {
          if (chartNumber(params.value) === null) return chartTextColor();
          return params.value >= 0 ? getComputedStyle(document.body).getPropertyValue('--up').trim() : getComputedStyle(document.body).getPropertyValue('--down').trim();
        }
      }
    }]
  };
  if (window.ChartTheme) window.ChartTheme.applyToOption(option, {dark:document.body.classList.contains('dark')});
  chart.setOption(option);
  return chart;
}

function renderAllocationChart(data) {
  if (allocationChart) allocationChart.dispose();
  if (statsAllocationChart) statsAllocationChart.dispose();
  allocationChart = renderPie(document.getElementById('allocationChart'), data || []);
  statsAllocationChart = renderPie(document.getElementById('statsAllocationChart'), data || []);
}

function renderPnlRankChart(positions) {
  if (pnlRankChart) pnlRankChart.dispose();
  if (statsPnlChart) statsPnlChart.dispose();
  pnlRankChart = renderBar(document.getElementById('pnlRankChart'), positions || []);
  statsPnlChart = renderBar(document.getElementById('statsPnlChart'), positions || []);
}

function resizePortfolioCharts() {
  [allocationChart, pnlRankChart, statsAllocationChart, statsPnlChart].forEach(chart => {
    if (chart) chart.resize();
  });
}

window.PortfolioCharts = {
  renderAllocationChart,
  renderPnlRankChart,
  resizePortfolioCharts
};
