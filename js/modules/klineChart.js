let klineRequestSequence = 0;

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
  const chartTheme = window.ChartTheme.get(isDark);
  const upColor = chartTheme.colors.up;
  const downColor = chartTheme.colors.down;
  const textColor = chartTheme.colors.text;
  const bgColor = chartTheme.colors.background;
  const gridColor = chartTheme.colors.grid;
  const axisColor = chartTheme.colors.axis;
  const indicatorColors = chartTheme.colors.indicators;

  const tooltipBg = isDark ? '#1e293b' : '#ffffff';
  const tooltipBorder = isDark ? '#475569' : '#e0e0e0';
  const tooltipTextColor = isDark ? '#cbd5e1' : '#2c3e50';

  const axisLabelBg = isDark ? '#1e293b' : '#ffffff';
  const axisLabelColor = chartTheme.colors.text;
  const axisLabelBorder = isDark ? '#475569' : '#d1d5db';

  const dates = rawData.map(d => d.date);
  const isDaily = State.currentPeriod === 'day';
  const candleVisuals = window.MarketVisualModel
    ? window.MarketVisualModel.candleColors(State.currentStock || {}, rawData, isDark)
    : rawData.map(function(d) { return { color: d.close >= d.open ? upColor : downColor }; });
  const ohlc = rawData.map(function(d, index) {
    const value = [d.open, d.close, d.low, d.high];
    if (!isDaily) return value;
    const color = candleVisuals[index].color;
    return {
      value: value,
      itemStyle: { color: color, color0: color, borderColor: color, borderColor0: color }
    };
  });
  const volumes = rawData.map(d => {
    if (typeof d.volume === 'number') return +(d.volume / 10000).toFixed(0);
    return 0;
  });

  const baseSeries = [{
    name: 'K线',
    type: 'candlestick',
    data: ohlc,
    itemStyle: { color: upColor, color0: downColor, borderColor: upColor, borderColor0: downColor, borderWidth: chartTheme.widths.reference },
    xAxisIndex: 0, yAxisIndex: 0, z: 1
  }];

  const watchlistItem = (State.watchlist || []).find(function(item) {
    return State.currentStock && item.code === State.currentStock.code;
  });
  const watchlistMarks = window.MarketVisualModel && watchlistItem
    ? window.MarketVisualModel.watchlistMarks(watchlistItem)
    : { lines: [], areas: [] };
  const markColors = {
    defense: downColor,
    breakout: '#f97316',
    confirm: '#7c3aed',
    observe: '#2563eb'
  };
  if (watchlistMarks.lines.length) {
    baseSeries[0].markLine = {
      symbol: ['none', 'none'],
      silent: true,
      label: { show: true, position: 'insideEndTop', color: textColor, formatter: '{b} {c}' },
      data: watchlistMarks.lines.map(function(mark) {
        const color = markColors[mark.kind] || chartTheme.colors.reference;
        return {
          name: mark.name,
          yAxis: mark.value,
          lineStyle: { color: color, width: 1.1, type: 'dashed' },
          label: { color: color }
        };
      })
    };
  }
  if (watchlistMarks.areas.length) {
    baseSeries[0].markArea = {
      silent: true,
      itemStyle: { color: 'rgba(37, 99, 235, 0.08)' },
      label: { color: '#2563eb', position: 'insideTopRight' },
      data: watchlistMarks.areas.map(function(area) {
        return [{ name: area.name, yAxis: area.from }, { yAxis: area.to }];
      })
    };
  }

  let needThreeGrids = false;
  let legendData = ['K线'];

  if (indicator === 'ma') {
    const priceColors = chartTheme.colors.movingAverages;
    const volColors = chartTheme.colors.movingAverages;

    State.maPeriods.forEach((p, idx) => {
      const key = 'ma' + p;
      const data = rawData.map(d => (typeof d[key] === 'number' ? d[key] : null));
      const name = 'MA' + p;
      baseSeries.push({
        name: name, type: 'line', data: data, smooth: false, connectNulls: true,
        lineStyle: { width: chartTheme.widths.average, color: priceColors[idx % priceColors.length] },
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
        name: name, type: 'line', data: volMA, smooth: false, connectNulls: true,
        lineStyle: { width: chartTheme.widths.average, color: volColors[idx % volColors.length], opacity: 0.72 },
        symbol: 'none', xAxisIndex: 1, yAxisIndex: 1, z: 5
      });
      legendData.push(name);
    });
  } else if (indicator === 'macd') {
    needThreeGrids = true;
    baseSeries.push(
      { name: 'DIF', type: 'line', data: rawData.map(d => d.macd_dif), lineStyle: { color: indicatorColors[0], width: chartTheme.widths.indicator }, symbol: 'none', xAxisIndex: 1, yAxisIndex: 1 },
      { name: 'DEA', type: 'line', data: rawData.map(d => d.macd_dea), lineStyle: { color: indicatorColors[1], width: chartTheme.widths.indicator }, symbol: 'none', xAxisIndex: 1, yAxisIndex: 1 },
      {
        name: 'MACD柱', type: 'bar', data: rawData.map(d => d.macd_bar), xAxisIndex: 1, yAxisIndex: 1,
        itemStyle: { color: function(params) { return params.data >= 0 ? upColor : downColor; } }
      }
    );
    legendData.push('DIF', 'DEA', 'MACD柱');
  } else if (indicator === 'kdj') {
    needThreeGrids = true;
    baseSeries.push(
      { name: 'K', type: 'line', data: rawData.map(d => d.kdj_k), lineStyle: { color: indicatorColors[2], width: chartTheme.widths.indicator }, symbol: 'none', xAxisIndex: 1, yAxisIndex: 1 },
      { name: 'D', type: 'line', data: rawData.map(d => d.kdj_d), lineStyle: { color: indicatorColors[0], width: chartTheme.widths.indicator }, symbol: 'none', xAxisIndex: 1, yAxisIndex: 1 },
      { name: 'J', type: 'line', data: rawData.map(d => d.kdj_j), lineStyle: { color: indicatorColors[3], width: chartTheme.widths.indicator }, symbol: 'none', xAxisIndex: 1, yAxisIndex: 1 }
    );
    legendData.push('K', 'D', 'J');
  } else if (indicator === 'rsi') {
    baseSeries.push({
      name: 'RSI(14)', type: 'line', data: rawData.map(d => d.rsi), lineStyle: { color: indicatorColors[4], width: chartTheme.widths.indicator }, symbol: 'none',
      xAxisIndex: 1, yAxisIndex: 1
    });
    needThreeGrids = true;
    legendData.push('RSI(14)');
  } else if (indicator === 'cci') {
    baseSeries.push({
      name: 'CCI(14)', type: 'line', data: rawData.map(d => d.cci), lineStyle: { color: indicatorColors[6], width: chartTheme.widths.indicator }, symbol: 'none',
      xAxisIndex: 1, yAxisIndex: 1
    });
    needThreeGrids = true;
    legendData.push('CCI(14)');
  } else if (indicator === 'obv') {
    baseSeries.push({
      name: 'OBV', type: 'line', data: rawData.map(d => d.obv), lineStyle: { color: indicatorColors[5], width: chartTheme.widths.indicator }, symbol: 'none',
      xAxisIndex: 1, yAxisIndex: 1
    });
    needThreeGrids = true;
    legendData.push('OBV');
  } else if (indicator === 'vwap') {
    baseSeries.push({
      name: 'VWAP', type: 'line', data: rawData.map(d => d.vwap), lineStyle: { color: indicatorColors[3], width: chartTheme.widths.indicator }, symbol: 'none',
      xAxisIndex: 0, yAxisIndex: 0, z: 5
    });
    legendData.push('VWAP');
  } else if (indicator === 'atr') {
    baseSeries.push({
      name: 'ATR(14)', type: 'line', data: rawData.map(d => d.atr), lineStyle: { color: indicatorColors[2], width: chartTheme.widths.indicator }, symbol: 'none',
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
    data: volumes.map(function(v, i) {
      const color = isDaily ? candleVisuals[i].color : rawData[i].close >= rawData[i].open ? upColor : downColor;
      return { value: v, itemStyle: { color: color } };
    }),
    xAxisIndex: volX, yAxisIndex: volY,
    barWidth: chartTheme.volumeBarWidth
  };
  baseSeries.push(volSeries);
  legendData.push('成交量(万手)');

  const topMargin = '12%';
  const axisCommon = {
    axisLine: { lineStyle: { color: axisColor, width: chartTheme.widths.reference } },
    splitLine: { lineStyle: { color: gridColor, width: chartTheme.widths.grid } }
  };
  const crossLineStyle = {
    color: chartTheme.colors.reference,
    width: chartTheme.widths.reference,
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
        const signalParam = Array.isArray(params)
          ? params.find(function(item) { return item && item.data && item.data.signal; })
          : params && params.data && params.data.signal ? params : null;
        if (signalParam && window.ChartCoach && typeof window.ChartCoach.signalTooltip === 'function') {
          return window.ChartCoach.signalTooltip(signalParam.data.signal);
        }
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
  window.ChartTheme.applyToOption(option, { dark: isDark });

  if (State.klineChart) State.klineChart.dispose();
  const dom = document.getElementById('chartContainer');
  dom.innerHTML = '';
  State.klineChart = echarts.init(dom);
  State.klineChart.setOption(option);
  if (window.ChartCoach && window.ChartCoach.refreshMarks) window.ChartCoach.refreshMarks();

  if (indicator === 'ma') {
    enableLegendDblClick();
  }
}

function enableLegendDblClick() {
  const State = window.State;
  if (!State.klineChart || typeof State.klineChart.getDom !== 'function') return;
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

function showUnavailableKline(State, code, period, meta, message) {
  State.currentRawData = [];
  State.klineSnapshots[code] = [];
  State.currentKlineMeta = Object.assign({}, meta || {}, { code, period, hasData: false });
  if (State.klineChart && typeof State.klineChart.dispose === 'function') {
    State.klineChart.dispose();
  }
  State.klineChart = null;
  const chartContainer = document.getElementById('chartContainer');
  if (chartContainer) chartContainer.innerHTML = '<div class="loading">暂无K线数据</div>';
  if (State.currentView !== 'kline') return;
  const chartTitle = document.getElementById('chartTitle');
  const priceInfo = document.getElementById('priceInfo');
  if (chartTitle && State.currentStock) {
    chartTitle.textContent = (State.currentStock.name || '未知') + ' (' + State.currentStock.code +
      ') 历史数据不可用';
  }
  if (priceInfo) {
    priceInfo.innerHTML = '<span class="market-source-warning">' + message + '</span>';
  }
}

async function loadKlineData(code, period) {
  const State = window.State;
  const Indicators = window.Indicators;
  const requestId = ++klineRequestSequence;
  try {
    const envelope = await window.ApiClient.fetchApiEnvelope('/api/kline?code=' + code + '&period=' + period);
    const data = Array.isArray(envelope.data) ? envelope.data : [];
    const meta = envelope.meta || {};
    if (requestId !== klineRequestSequence || !State.currentStock || State.currentStock.code !== code || State.currentPeriod !== period) return;
    State.currentKlineMeta = Object.assign({}, meta, { code, period, hasData: data.length > 0 });
    if (Array.isArray(data) && data.length > 0) {
      State.currentRawData = data;
      State.klineSnapshots[code] = data.slice(-80);
      Indicators.calcMAFromData(State.currentRawData, State.maPeriods);
      renderKlineChart(State.currentRawData, State.currentIndicator);
      if (meta.stale && State.currentView === 'kline') {
        const priceInfo = document.getElementById('priceInfo');
        const chartTitle = document.getElementById('chartTitle');
        if (chartTitle && State.currentStock) {
          chartTitle.textContent = (State.currentStock.name || '未知') + ' (' + State.currentStock.code +
            ') 历史数据（缓存）';
        }
        if (priceInfo) {
          const fetchedAt = meta.fetchedAt && window.WebStockTime
            ? window.WebStockTime.formatDateTime(meta.fetchedAt) : meta.fetchedAt || '';
          priceInfo.innerHTML = '<span class="market-source-warning">历史K线使用缓存数据' +
            (fetchedAt ? '（截至 ' + fetchedAt + '）' : '') + '</span>';
        }
      }
    } else if (meta.dataSource === 'unavailable') {
      showUnavailableKline(State, code, period, meta, '暂无K线数据（行情源暂不可用）');
    }
  } catch (e) {
    if (requestId !== klineRequestSequence || !State.currentStock ||
      State.currentStock.code !== code || State.currentPeriod !== period) return;
    showUnavailableKline(State, code, period, {
      dataSource: 'unavailable',
      stale: false,
      reason: 'request_failed'
    }, 'K线请求失败，暂无K线数据');
    console.error('加载K线数据失败:', e);
  }
}

async function prefetchKlineSnapshot(code, period) {
  const State = window.State;
  const nextPeriod = period && period !== 'minute' ? period : 'day';
  const envelope = await window.ApiClient.fetchApiEnvelope('/api/kline?code=' + code + '&period=' + nextPeriod);
  const data = Array.isArray(envelope.data) ? envelope.data : [];
  if (!State.currentStock || State.currentStock.code !== code || !data.length) return [];
  State.klineSnapshots[code] = data.slice(-80);
  return State.klineSnapshots[code];
}

window.KlineChart = {
  renderKlineChart,
  enableLegendDblClick,
  openMASettings,
  closeMASettings,
  applyMASettings,
  loadKlineData,
  prefetchKlineSnapshot
};
