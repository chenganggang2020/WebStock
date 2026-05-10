let allocationChart = null;
let pnlRankChart = null;
let statsAllocationChart = null;
let statsPnlChart = null;

function chartTextColor() {
  return document.body.classList.contains('dark') ? '#cbd5e1' : '#2c3e50';
}

function renderPie(el, data) {
  if (!el || !window.echarts) return null;
  const chart = echarts.init(el);
  chart.setOption({
    tooltip: { trigger: 'item', formatter: '{b}<br/>{c} ({d}%)' },
    legend: { bottom: 0, textStyle: { color: chartTextColor() } },
    series: [{
      name: '持仓占比',
      type: 'pie',
      radius: ['38%', '68%'],
      center: ['50%', '45%'],
      data: data.map(item => ({ name: item.name + '(' + item.code + ')', value: item.marketValue })),
      label: { color: chartTextColor() }
    }]
  });
  return chart;
}

function renderBar(el, positions) {
  if (!el || !window.echarts) return null;
  const chart = echarts.init(el);
  const sorted = positions.slice().sort((a, b) => (b.unrealizedPnl || 0) - (a.unrealizedPnl || 0));
  chart.setOption({
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
      data: sorted.map(item => item.unrealizedPnl || 0),
      itemStyle: {
        color: function(params) {
          return params.value >= 0 ? getComputedStyle(document.body).getPropertyValue('--up').trim() : getComputedStyle(document.body).getPropertyValue('--down').trim();
        }
      }
    }]
  });
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
