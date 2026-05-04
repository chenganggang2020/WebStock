function renderKlineChart(rawData, indicator) {
  const State = window.State;
  const Indicators = window.Indicators;

  function calcStartPercent() {
    const halfYearDays = 126;
    const total = rawData.length;
    if (total <= halfYearDays) return 0;
    return +(((total - halfYearDays) / total) * 100).toFixed(1);
  }

  if (indicator === 'macd') Indicators.calcMACD(rawData);
  else if (indicator === 'kdj') Indicators.calcKDJ(rawData);
  else if (indicator === 'rsi') Indicators.calcRSI(rawData);
  else if (indicator === 'cci') Indicators.calcCCI(rawData);
  else if (indicator === 'obv') Indicators.calcOBV(rawData);
  else if (indicator === 'vwap') Indicators.calcVWAP(rawData);
  else if (indicator === 'atr') Indicators.calcATR(rawData);

  const isDark = document.body.classList.contains('dark');
  const upColor = isDark ? '#ff6b6b' : '#e74c3c';
  const downColor = isDark ? '#51cf66' : '#2ecc71';
  const textColor = isDark ? '#cbd5e1' : '#2c3e50';
  const bgColor = isDark ? '#1e293b' : '#ffffff';
  const gridColor = isDark ? '#4a5568' : '#e0e0e0';
  const axisColor = gridColor;

  const tooltipBg = isDark ? '#1e293b' : '#ffffff';
  const tooltipBorder = isDark ? '#475569' : '#e0e0e0';
  const tooltipTextColor = isDark ? '#cbd5e1' : '#2c3e50';

  const axisLabelBg = isDark ? '#1e293b' : '#ffffff';
  const axisLabelColor = isDark ? '#cbd5e1' : '#2c3e50';
  const axisLabelBorder = isDark ? '#475569' : '#d1d5db';

  const dates = rawData.map(d => d.date);
  const ohlc = rawData.map(d => [d.open, d.close, d.low, d.high]);
  const volumes = rawData.map(d => {
    if (typeof d.volume === 'number') return +(d.volume / 10000).toFixed(0);
    return 0;
  });

  const baseSeries = [{
    name: 'K线',
    type: 'candlestick',
    data: ohlc,
    itemStyle: { color: upColor, color0: downColor, borderColor: upColor, borderColor0: downColor },
    xAxisIndex: 0, yAxisIndex: 0, z: 1
  }];

  let needThreeGrids = false;
  let legendData = ['K线'];

  if (indicator === 'ma') {
    const priceColors = ['#f1c40f', '#e74c3c', '#3498db', '#9b59b6', '#2ecc71', '#e67e22', '#1abc9c'];
    const volColors = ['rgba(241,196,15,0.6)', 'rgba(231,76,60,0.6)', 'rgba(52,152,219,0.6)', 'rgba(155,89,182,0.6)', 'rgba(46,204,113,0.6)', 'rgba(230,126,34,0.6)', 'rgba(26,188,156,0.6)'];

    State.maPeriods.forEach((p, idx) => {
      const key = 'ma' + p;
      const data = rawData.map(d => (typeof d[key] === 'number' ? d[key] : null));
      const name = 'MA' + p;
      baseSeries.push({
        name: name, type: 'line', data: data, smooth: true, connectNulls: true,
        lineStyle: { width: 2, color: priceColors[idx % priceColors.length] },
        symbol: 'none', xAxisIndex: 0, yAxisIndex: 0, z: 10
      });
      legendData.push(name);
    });

    const volData = rawData.map(d => {
      if (typeof d.volume === 'number') return +(d.volume / 10000).toFixed(2);
      return 0;
    });
    State.maPeriods.forEach((p, idx) => {
      const volMA = (function () {
        const result = [];
        for (let i = 0; i < volData.length; i++) {
          if (i < p - 1) { result.push(null); continue; }
          let sum = 0;
          for (let j = i - p + 1; j <= i; j++) sum += volData[j];
          result.push(+(sum / p).toFixed(2));
        }
        return result;
      })();
      const name = 'VOL_MA' + p;
      baseSeries.push({
        name: name, type: 'line', data: volMA, smooth: true, connectNulls: true,
        lineStyle: { width: 1, color: volColors[idx % volColors.length] },
        symbol: 'none', xAxisIndex: 1, yAxisIndex: 1, z: 5
      });
      legendData.push(name);
    });
  } else if (indicator === 'macd') {
    needThreeGrids = true;
    baseSeries.push(
      { name: 'DIF', type: 'line', data: rawData.map(d => d.macd_dif), lineStyle: { color: '#2196F3' }, symbol: 'none', xAxisIndex: 1, yAxisIndex: 1 },
      { name: 'DEA', type: 'line', data: rawData.map(d => d.macd_dea), lineStyle: { color: '#FF9800' }, symbol: 'none', xAxisIndex: 1, yAxisIndex: 1 },
      {
        name: 'MACD柱', type: 'bar', data: rawData.map(d => d.macd_bar), xAxisIndex: 1, yAxisIndex: 1,
        itemStyle: { color: function(params) { return params.data >= 0 ? upColor : downColor; } }
      }
    );
    legendData.push('DIF', 'DEA', 'MACD柱');
  } else if (indicator === 'kdj') {
    needThreeGrids = true;
    baseSeries.push(
      { name: 'K', type: 'line', data: rawData.map(d => d.kdj_k), lineStyle: { color: '#E91E63' }, symbol: 'none', xAxisIndex: 1, yAxisIndex: 1 },
      { name: 'D', type: 'line', data: rawData.map(d => d.kdj_d), lineStyle: { color: '#2196F3' }, symbol: 'none', xAxisIndex: 1, yAxisIndex: 1 },
      { name: 'J', type: 'line', data: rawData.map(d => d.kdj_j), lineStyle: { color: '#4CAF50' }, symbol: 'none', xAxisIndex: 1, yAxisIndex: 1 }
    );
    legendData.push('K', 'D', 'J');
  } else if (indicator === 'rsi') {
    baseSeries.push({
      name: 'RSI(14)', type: 'line', data: rawData.map(d => d.rsi), lineStyle: { color: '#9b59b6' }, symbol: 'none',
      xAxisIndex: 1, yAxisIndex: 1
    });
    needThreeGrids = true;
    legendData.push('RSI(14)');
  } else if (indicator === 'cci') {
    baseSeries.push({
      name: 'CCI(14)', type: 'line', data: rawData.map(d => d.cci), lineStyle: { color: '#e67e22' }, symbol: 'none',
      xAxisIndex: 1, yAxisIndex: 1
    });
    needThreeGrids = true;
    legendData.push('CCI(14)');
  } else if (indicator === 'obv') {
    baseSeries.push({
      name: 'OBV', type: 'line', data: rawData.map(d => d.obv), lineStyle: { color: '#1abc9c' }, symbol: 'none',
      xAxisIndex: 1, yAxisIndex: 1
    });
    needThreeGrids = true;
    legendData.push('OBV');
  } else if (indicator === 'vwap') {
    baseSeries.push({
      name: 'VWAP', type: 'line', data: rawData.map(d => d.vwap), lineStyle: { color: '#2ecc71', width: 1 }, symbol: 'none',
      xAxisIndex: 0, yAxisIndex: 0, z: 5
    });
    legendData.push('VWAP');
  } else if (indicator === 'atr') {
    baseSeries.push({
      name: 'ATR(14)', type: 'line', data: rawData.map(d => d.atr), lineStyle: { color: '#e74c3c' }, symbol: 'none',
      xAxisIndex: 1, yAxisIndex: 1
    });
    needThreeGrids = true;
    legendData.push('ATR(14)');
  }

  const volX = (indicator === 'ma') ? 1 : (needThreeGrids ? 2 : 1);
  const volY = (indicator === 'ma') ? 1 : (needThreeGrids ? 2 : 1);
  const volSeries = {
    name: '成交量(万手)',
    type: 'bar',
    data: volumes.map(function(v, i) { return { value: v, itemStyle: { color: rawData[i].close >= rawData[i].open ? upColor : downColor } }; }),
    xAxisIndex: volX, yAxisIndex: volY
  };
  baseSeries.push(volSeries);
  legendData.push('成交量(万手)');

  const topMargin = '12%';
  const axisCommon = {
    axisLine: { lineStyle: { color: axisColor } },
    splitLine: { lineStyle: { color: gridColor } }
  };
  const crossLineStyle = {
    color: isDark ? '#718096' : '#ccc',
    width: 1,
    type: 'dashed',
    opacity: 0.6
  };

  let grids, xAxes, yAxes;
  if (indicator === 'ma' || !needThreeGrids) {
    grids = [
      { left: '8%', right: '3%', top: topMargin, height: '55%' },
      { left: '8%', right: '3%', top: '75%', height: '15%' }
    ];
    xAxes = [0, 1].map(function(idx) {
      return {
        type: 'category',
        data: dates,
        gridIndex: idx,
        axisLabel: idx === 0 ? { color: textColor, fontSize: 11 } : { show: false },
        axisTick: { show: false },
        ...axisCommon
      };
    });
    yAxes = [0, 1].map(function(idx) {
      return {
        scale: true,
        gridIndex: idx,
        axisLabel: { color: textColor, formatter: idx === 1 ? function(v) { return v; } : function(v) { return v.toFixed(2); } },
        ...axisCommon,
        name: idx === 1 ? '成交量(万手)' : undefined,
        nameTextStyle: idx === 1 ? { color: textColor } : undefined
      };
    });
  } else {
    grids = [
      { left: '8%', right: '3%', top: topMargin, height: '35%' },
      { left: '8%', right: '3%', top: '55%', height: '15%' },
      { left: '8%', right: '3%', top: '78%', height: '12%' }
    ];
    xAxes = [0, 1, 2].map(function(idx) {
      return {
        type: 'category',
        data: dates,
        gridIndex: idx,
        axisLabel: idx === 0 ? { color: textColor, fontSize: 11 } : { show: false },
        axisTick: { show: false },
        ...axisCommon
      };
    });
    yAxes = [0, 1, 2].map(function(idx) {
      return {
        scale: true,
        gridIndex: idx,
        axisLabel: { color: textColor, formatter: idx === 2 ? function(v) { return v; } : function(v) { return v.toFixed(2); } },
        ...axisCommon,
        name: idx === 2 ? '成交量(万手)' : undefined,
        nameTextStyle: idx === 2 ? { color: textColor } : undefined
      };
    });
  }

  const zoomX = (indicator === 'ma' || !needThreeGrids) ? [0, 1] : [0, 1, 2];
  const option = {
    backgroundColor: bgColor,
    legend: {
      data: legendData, orient: 'horizontal', left: 'center', top: 0,
      itemGap: 10, textStyle: { color: textColor, fontSize: 11 },
      padding: [5, 0, 2, 0], itemWidth: 14, itemHeight: 8
    },
    grid: grids,
    xAxis: xAxes,
    yAxis: yAxes,
    tooltip: {
      trigger: 'axis',
      backgroundColor: tooltipBg,
      borderColor: tooltipBorder,
      textStyle: {
        color: tooltipTextColor,
        fontSize: 12
      },
      axisPointer: {
        type: 'cross',
        crossStyle: {
          color: crossLineStyle.color,
          width: crossLineStyle.width,
          type: crossLineStyle.type
        },
        lineStyle: crossLineStyle,
        label: {
          backgroundColor: axisLabelBg,
          color: axisLabelColor,
          borderColor: axisLabelBorder,
          borderWidth: 1,
          shadowBlur: 0,
          shadowColor: 'transparent',
          textStyle: {
            color: axisLabelColor
          },
          formatter: function(params) {
            return typeof params.value === 'number' ? params.value.toFixed(2) : params.value;
          }
        }
      },
      formatter: function(params) {
        if (!params || params.length === 0) return '';
        const idx = params[0].dataIndex;
        const day = rawData[idx];
        if (!day) return '';
        let html = '<strong>' + day.date + '</strong><br/>';
        html += '开: ' + day.open.toFixed(2) + ' &nbsp; 高: ' + day.high.toFixed(2) + ' &nbsp; 低: ' + day.low.toFixed(2) + ' &nbsp; 收: ' + day.close.toFixed(2) + '<br/>';
        params.forEach(function(p) {
          if (p.seriesName === 'K线') return;
          if (p.seriesName === '成交量(万手)') {
            html += p.marker + p.seriesName + ': ' + p.value + '<br/>';
          } else {
            const val = p.value;
            html += p.marker + p.seriesName + ': ' + (val !== null && val !== undefined ? (typeof val === 'number' ? val.toFixed(2) : val) : '--') + '<br/>';
          }
        });
        return html;
      }
    },
    dataZoom: [
      { type: 'inside', xAxisIndex: zoomX, start: calcStartPercent(), end: 100 },
      { type: 'slider', xAxisIndex: zoomX, start: calcStartPercent(), end: 100, height: 20, bottom: 20, textStyle: { color: textColor } }
    ],
    series: baseSeries
  };

  if (State.klineChart) State.klineChart.dispose();
  const dom = document.getElementById('chartContainer');
  dom.innerHTML = '';
  State.klineChart = echarts.init(dom);
  State.klineChart.setOption(option);

  if (indicator === 'ma') {
    enableLegendDblClick();
  }
}

function enableLegendDblClick() {
  const State = window.State;
  if (!State.klineChart) return;
  const dom = State.klineChart.getDom();
  const legendEl = dom.querySelector('.echarts-legend');
  if (!legendEl) return;
  legendEl.removeEventListener('dblclick', onLegendDblClick);
  legendEl.addEventListener('dblclick', onLegendDblClick);
}

function onLegendDblClick(e) {
  const target = e.target.closest('.echarts-legend-item');
  if (target) {
    const nameEl = target.querySelector('.echarts-legend-text');
    if (nameEl && nameEl.textContent && nameEl.textContent.startsWith('MA')) {
      openMASettings();
    }
  }
}

function openMASettings() {
  const State = window.State;
  document.getElementById('maPeriodsInput').value = State.maPeriods.join(',');
  document.getElementById('maModalOverlay').style.display = 'flex';
}

function closeMASettings() {
  document.getElementById('maModalOverlay').style.display = 'none';
}

function applyMASettings() {
  const State = window.State;
  const Indicators = window.Indicators;
  const input = document.getElementById('maPeriodsInput').value;
  const periods = input.split(',').map(function(s) { return parseInt(s.trim()); }).filter(function(n) { return !isNaN(n) && n > 0; });
  if (periods.length === 0) {
    alert('请输入至少一个有效周期数字');
    return;
  }
  State.maPeriods = periods;
  Indicators.calcMAFromData(State.currentRawData, State.maPeriods);
  renderKlineChart(State.currentRawData, 'ma');
  closeMASettings();
}

async function loadKlineData(code, period) {
  const State = window.State;
  const Indicators = window.Indicators;
  try {
    const resp = await fetch('/api/kline?code=' + code + '&period=' + period);
    const data = await resp.json();
    if (Array.isArray(data) && data.length > 0) {
      State.currentRawData = data;
      Indicators.calcMAFromData(State.currentRawData, State.maPeriods);
      renderKlineChart(State.currentRawData, State.currentIndicator);
    }
  } catch (e) {
    console.error('加载K线数据失败:', e);
  }
}

window.KlineChart = {
  renderKlineChart,
  enableLegendDblClick,
  openMASettings,
  closeMASettings,
  applyMASettings,
  loadKlineData
};
