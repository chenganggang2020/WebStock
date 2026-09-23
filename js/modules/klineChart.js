let klineRequestSequence = 0;
let maLegendSelection = {};
function parseMAPeriods(input) {
  const values = String(input).trim().split(/[,，\s]+/);
  if (!values.length || values.some(value=>!/^\d+$/.test(value))) throw Error('请输入1–1000的整数周期，用逗号分隔');
  const periods = [...new Set(values.map(Number))];
  if (periods.length>8 || periods.some(value=>value<1 || value>1000)) throw Error('周期范围1–1000，最多8条均线');
  return periods;
}
try {
  const saved=JSON.parse(localStorage.getItem('webstock.maPeriods') || 'null');
  if (Array.isArray(saved)) window.State.maPeriods=parseMAPeriods(saved.join(','));
  maLegendSelection=JSON.parse(localStorage.getItem('webstock.maLegend') || '{}') || {};
} catch (_) { /* Invalid or unavailable preferences leave the existing defaults. */ }

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
    return null;
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
  const localSignalMarks = Array.isArray(State.currentKlineSignalMarks)
    ? State.currentKlineSignalMarks : [];
  if (isDaily && localSignalMarks.length) {
    baseSeries[0].markPoint = {
      symbol: 'pin',
      symbolSize: 42,
      tooltip: { trigger: 'item', showContent: true, formatter: params =>
        window.ChartCoach ? window.ChartCoach.signalTooltip(params.data && params.data.signal) : '' },
      label: { color: '#ffffff', fontWeight: 700, fontSize: 11 },
      data: localSignalMarks
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
      selected: maLegendSelection,
      data: legendData, type: 'scroll', orient: 'horizontal', left: 48, right: 30, top: 0,
      itemGap: 10, textStyle: { color: textColor, fontSize: 11 },
      padding: [5, 0, 2, 0], itemWidth: 14, itemHeight: 8
    },
    grid: grids,
    xAxis: xAxes,
    yAxis: yAxes,
    tooltip: {
      trigger: 'axis',
      showContent: true,
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
        return '';
      }
    },
    dataZoom: [
      { type: 'inside', xAxisIndex: zoomX, start: calcStartPercent(), end: 100, zoomOnMouseWheel: 'ctrl', moveOnMouseWheel: false },
      { type: 'slider', xAxisIndex: zoomX, start: calcStartPercent(), end: 100, height: 20, bottom: 20, textStyle: { color: textColor } }
    ],
    series: baseSeries
  };
  window.ChartTheme.applyToOption(option, { dark: isDark });

  const dom = document.getElementById('chartContainer');
  const frameKey = (State.currentStock && State.currentStock.code || '') + ':' + State.currentPeriod;
  State.klineChart = window.ChartTheme.renderTo(echarts, dom, State.klineChart, option, frameKey);
  const number = value => value == null || !Number.isFinite(Number(value)) ? '--' : Number(value).toFixed(2);
  window.ChartTheme.bindReadout(State.klineChart, {
    labels: dates, color: textColor,
    textAt(index) {
      const day = rawData[index];
      const metrics = window.RealtimeChartModel.dailyBarMetrics(rawData, index);
      return day.date + '   开 ' + number(day.open) + '   高 ' + number(day.high) +
        '   低 ' + number(day.low) + '   收 ' + number(day.close) +
        '   涨跌额 ' + number(metrics.changeAmount) + '   涨跌幅 ' + number(metrics.changePercent) + '%   振幅 ' + number(metrics.amplitudePercent) +
        '%   成交量 ' + number(volumes[index]) + ' 万手' +
        (day.intraday ? (day.incomplete ? '   盘中 · 未收盘' : '   分钟合成') +
          (day.observedAt ? ' · ' + String(day.observedAt).slice(11,16) : '') : '');
    },
    legendAt: index => name => {
      if (name === 'K线') return name;
      const series = baseSeries.find(item => item.name === name);
      const item = series && series.data[index];
      return name + ': ' + number(item && typeof item === 'object' ? item.value : item);
    }
  });
  if (window.ChartCoach && window.ChartCoach.refreshMarks) window.ChartCoach.refreshMarks();

  if (indicator === 'ma') {
    enableLegendDblClick();
  }
  if (State.klineChart && State.klineChart.off && State.klineChart.on) {
    State.klineChart.off('legendselectchanged', saveMALegend);
    State.klineChart.on('legendselectchanged', saveMALegend);
  }
}

function saveMALegend(event) {
  maLegendSelection=Object.fromEntries(Object.entries(event.selected || {}).filter(([key])=>/^(?:VOL_)?MA\d+$/.test(key)));
  try { localStorage.setItem('webstock.maLegend',JSON.stringify(maLegendSelection)); } catch (_) {}
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
  const error=document.getElementById('maSettingsError');if(error)error.textContent='';
}

function closeMASettings() {
  document.getElementById('maModalOverlay').style.display = 'none';
}

function applyMASettings() {
  const State = window.State;
  const Indicators = window.Indicators;
  const input = document.getElementById('maPeriodsInput').value;
  let periods;
  try { periods=parseMAPeriods(input); }
  catch(error) { document.getElementById('maSettingsError').textContent=error.message; return; }
  State.maPeriods = periods;
  try { localStorage.setItem('webstock.maPeriods',JSON.stringify(periods)); } catch (_) {}
  Indicators.calcMAFromData(State.currentRawData, State.maPeriods);
  renderKlineChart(State.currentRawData, 'ma');
  closeMASettings();
}

function renderAvailableKlineHeader(State, data, meta) {
  if (State.currentView !== 'kline' || !State.currentStock || !Array.isArray(data) || !data.length) return;
  const latest = data[data.length - 1];
  const metrics = window.RealtimeChartModel && window.RealtimeChartModel.dailyBarMetrics
    ? window.RealtimeChartModel.dailyBarMetrics(data, data.length - 1) : {};
  const change = metrics.changePercent === null || metrics.changePercent === undefined ? null : metrics.changePercent;
  const chartColors = window.ChartTheme.get(document.body.classList.contains('dark')).colors;
  const color = change === null ? chartColors.text : change > 0 ? chartColors.up : change < 0 ? chartColors.down : chartColors.text;
  const periodLabel = { day: '日线', week: '周线', month: '月线' }[State.currentPeriod] || 'K线';
  const sourceLabel = {
    'sina-day': '新浪日线',
    'eastmoney-day': '东方财富日线（新浪不可用时）',
    cache: '本地历史缓存'
  }[meta && meta.dataSource] || '公开历史行情';
  const chartTitle = document.getElementById('chartTitle');
  const priceInfo = document.getElementById('priceInfo');
  if (chartTitle) {
    chartTitle.textContent = (State.currentStock.name || '未知') + ' (' + State.currentStock.code + ') ' +
      periodLabel + ' · 截至 ' + latest.date + (latest.incomplete ? '（盘中）' : '');
  }
  if (priceInfo) {
    const stateLabel = latest.incomplete ? '盘中K线' : latest.intraday ? '分钟合成收盘K线' : 'K线收盘';
    const observed = latest.intraday && latest.observedAt ? '（截至 ' + String(latest.observedAt).slice(11, 16) + '）' : '';
    const minuteSource = {
      'tencent-1m': '腾讯公开1分钟',
      'eastmoney-1m': '东方财富公开1分钟',
      'sina-1m': '新浪公开分钟'
    }[latest.dataSource] || '公开分钟行情';
    priceInfo.innerHTML = latest.date + ' ' + stateLabel + observed + ' <span style="color:' + color + ';font-weight:600">' +
      Number(latest.close).toFixed(2) + '</span>' +
      (change === null ? '' : ' | 涨跌幅 <span style="color:' + color + ';font-weight:600">' +
        (change >= 0 ? '+' : '') + change.toFixed(2) + '%</span>') +
      ' | 来源：' + (latest.intraday ? minuteSource + '；历史：' + sourceLabel : sourceLabel);
  }
}

function metricText(value, suffix, signed) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '--';
  const number = Number(value);
  return (signed && number > 0 ? '+' : '') + number.toFixed(2) + (suffix || '');
}

function compactVolume(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return '--';
  if (number >= 100000000) return (number / 100000000).toFixed(2) + '亿股';
  if (number >= 10000) return (number / 10000).toFixed(2) + '万股';
  return number.toFixed(0) + '股';
}

function appendMetric(container, label, value, note, tone) {
  const item = document.createElement('div');
  item.className = 'kline-metric';
  if (tone) item.dataset.tone = tone;
  const title = document.createElement('span');
  title.textContent = label;
  const strong = document.createElement('b');
  strong.textContent = value;
  const detail = document.createElement('small');
  detail.textContent = note || '';
  item.append(title, strong, detail);
  container.appendChild(item);
}

function setAuctionCard(targetId, lines) {
  const target = document.getElementById(targetId);
  if (!target) return;
  target.innerHTML = '';
  lines.forEach(function(line, index) {
    const paragraph = document.createElement('p');
    if (index === 0) {
      const strong = document.createElement('strong');
      strong.textContent = line;
      paragraph.appendChild(strong);
    } else {
      paragraph.textContent = line;
    }
    target.appendChild(paragraph);
  });
}

function hideKlineInsights(State) {
  State.currentKlineSignalMarks = [];
  const panel = document.getElementById('klineInsights');
  const placeholder = document.getElementById('marketSidebarPlaceholder');
  if (panel) panel.hidden = true;
  if (placeholder) placeholder.hidden = false;
}

function nineTurnOutcomeText(outcome) {
  return outcome.status === 'available' ? metricText(outcome.returnPct, '%', true)
    : outcome.status === 'invalid' ? '数据缺口' : '待满窗口';
}

function renderNineTurnHistory(history, meta) {
  const summary = document.getElementById('nineTurnHistorySummary');
  const coverage = document.getElementById('nineTurnHistoryCoverage');
  const target = document.getElementById('nineTurnHistoryEvents');
  if (!summary || !coverage || !target) return;
  summary.textContent = '简化九转 · 历史核对（' + history.events.length + '次）';
  coverage.textContent = history.from + '—' + history.to + ' · 已加载' + history.barCount +
    '根日线 · ' + (meta && meta.dataSource || '来源未标注') + '。仅覆盖当前加载范围，非全市场历史库。';
  target.replaceChildren();
  if (!history.events.length) target.textContent = '当前日线范围未出现确认九转。';
  history.events.slice().reverse().forEach(function(event) {
    const item = document.createElement('article');
    const heading = document.createElement('b');
    heading.textContent = event.date + ' · ' + event.label;
    const results = document.createElement('div');
    results.className = 'nine-turn-outcomes';
    [1, 5, 20].forEach(function(horizon) {
      const cell = document.createElement('span');
      cell.textContent = horizon + '根后 ' + nineTurnOutcomeText(event.outcomes[horizon]);
      cell.title = event.outcomes[horizon].endDate || '不把缺失数据或未收盘K线计为已完成结果';
      results.appendChild(cell);
    });
    item.append(heading, results);
    target.appendChild(item);
  });
}

function renderKlineInsights(State, data, minuteRows, minuteMeta, localRows, localMeta) {
  const panel = document.getElementById('klineInsights');
  const model = window.MarketSignalModel;
  if (!panel || !model || State.currentPeriod !== 'day' || !Array.isArray(data) || !data.length) {
    hideKlineInsights(State);
    return;
  }
  const daily = model.analyzeDaily(data);
  const nineTurnContext = { asOf: new Date().toISOString() };
  const nineTurn = model.calculateNineTurn(data, nineTurnContext);
  const nineTurnHistory = model.evaluateNineTurnHistory(data, nineTurnContext);
  const auction = model.analyzeAuction(data, minuteRows, minuteMeta, localRows, localMeta);
  const signals = model.detectLocalSignals(data, minuteRows, minuteMeta);
  const metricGrid = document.getElementById('klineMetricGrid');
  const signalList = document.getElementById('klineSignalList');
  const asOf = document.getElementById('klineInsightsAsOf');
  if (!daily.available || !metricGrid || !signalList) {
    hideKlineInsights(State);
    return;
  }

  panel.hidden = false;
  const placeholder = document.getElementById('marketSidebarPlaceholder');
  if (placeholder) placeholder.hidden = true;
  metricGrid.innerHTML = '';
  const changeTone = daily.changePercent > 0 ? 'up' : daily.changePercent < 0 ? 'down' : '';
  appendMetric(metricGrid, '今日涨跌', metricText(daily.changePercent, '%', true),
    '收盘 ' + metricText(daily.close, ''), changeTone);
  appendMetric(metricGrid, '开盘跳空', metricText(daily.gapPercent, '%', true), '相对昨收',
    daily.gapPercent > 0 ? 'up' : daily.gapPercent < 0 ? 'down' : '');
  appendMetric(metricGrid, '日内振幅', metricText(daily.amplitudePercent, '%'), '高低价/昨收');
  appendMetric(metricGrid, '5日量比', metricText(daily.volumeRatio5, '×'), '今日量/此前5日均量');
  appendMetric(metricGrid, 'MA5', metricText(daily.ma5, ''), '短期均价');
  appendMetric(metricGrid, 'MA10', metricText(daily.ma10, ''), '中短期均价');
  appendMetric(metricGrid, 'MA20', metricText(daily.ma20, ''), '月度均价');
  appendMetric(metricGrid, '均线状态', daily.trend, '仅描述，不是预测');
  if (asOf) asOf.textContent = '截至 ' + daily.date + ' · 公开日线与分钟行情';
  renderNineTurnHistory(nineTurnHistory, State.currentKlineMeta);

  signalList.innerHTML = '';
  const displaySignals = [{
    label: nineTurn.label,
    active: nineTurn.completed,
    reason: nineTurn.rule || '样本不足',
    rule: nineTurn.rule || ''
  }].concat(signals);
  displaySignals.forEach(function(signal) {
    const chip = document.createElement('span');
    chip.className = 'kline-signal-chip' + (signal.active ? ' active' : '');
    chip.textContent = signal.active ? signal.label : signal.label + '·未触发';
    chip.title = (signal.reason || '') + (signal.rule ? '\n' + signal.rule : '');
    signalList.appendChild(chip);
  });

  const opening = auction.opening;
  const openingLines = [
    '形态数据等级：' + opening.dataLevel + ' · ' + (opening.process ? opening.process.reason : '缺少过程数据，不能判定'),
    opening.dataStatus === 'local-public-auction-observed'
      ? '数据状态：已保存竞价时段公开报价快照'
      : opening.dataStatus === 'public-minute-proxy'
        ? '数据状态：仅有公开分钟替代数据'
        : '数据状态：竞价数据不可用',
    '开盘 ' + metricText(opening.openPrice, '') + ' · 高低开 ' + metricText(opening.gapPercent, '%', true),
    opening.localObserved
      ? '本机竞价快照 ' + opening.localObservedFrom + '—' + opening.localObservedTo + ' · ' +
        opening.localSampleCount + '点 · 报价变化 ' + metricText(opening.localObservedChangePercent, '%', true)
      : '本机未采到当日09:15—09:25快照（需程序当时运行并刷新该股票）',
    opening.localObserved
      ? '本机观测增量 ' + compactVolume(opening.localObservedVolume) + '（仅采样窗口）'
      : '09:30首分钟量 ' + compactVolume(opening.firstMinuteVolume) + '（非纯竞价量）',
    opening.interpretation
  ];
  if (opening.indicativePrice !== null || opening.indicativeMatchedVolume !== null) {
    openingLines.splice(3, 0,
      '竞价专用字段：参考价 ' + metricText(opening.indicativePrice, '') + ' · 匹配量 ' +
      compactVolume(opening.indicativeMatchedVolume),
      '未匹配 买 ' + compactVolume(opening.indicativeUnmatchedBuyVolume) +
      ' / 卖 ' + compactVolume(opening.indicativeUnmatchedSellVolume));
  }
  if (opening.localObserved) {
    openingLines.splice(openingLines.length - 1, 0,
      '09:30首分钟量 ' + compactVolume(opening.firstMinuteVolume) + '（非纯竞价量）');
  }
  setAuctionCard('openingAuctionSummary', openingLines);
  const closing = auction.closing;
  setAuctionCard('closingAuctionSummary', [
    '形态数据等级：' + closing.dataLevel + ' · ' + (closing.process ? closing.process.reason : '缺少过程数据，不能判定'),
    closing.dataStatus === 'public-minute-interval'
      ? '数据状态：公开分钟区间（' + closing.sampleCount + '点）'
      : '数据状态：尾盘竞价分钟数据不可用',
    (closing.from && closing.to ? closing.from + '—' + closing.to : '14:57—15:00') +
      ' 涨跌 ' + metricText(closing.returnPercent, '%', true),
    '区间量 ' + compactVolume(closing.volume) + ' · 占全天 ' + metricText(closing.volumeSharePercent, '%'),
    closing.interpretation
  ]);
  if (window.AuctionRules) {
    ['opening','closing'].forEach(function(phase) {
      const process=auction[phase].process, target=document.getElementById(phase+'AuctionProcessChart');
      const labels=document.getElementById(phase+'AuctionPatterns');
      if(labels)labels.textContent=process && process.patterns.length?process.patterns.map(p=>p.label+'：'+p.explanation).join('\n'):'尚无可验证的形态结论';
      if(target) {
        const chart=window.echarts && window.echarts.getInstanceByDom(target);
        target.hidden=!(process && process.dataLevel==='D2' && process.points.length);
        if(target.hidden) {if(chart)chart.clear();}
        else if(window.echarts) {const instance=chart||window.echarts.init(target);instance.setOption(window.AuctionRules.chartOption(process,auction.tradingDate),true);instance.resize();}
      }
    });
    const guide=document.getElementById('auctionRuleGuide');
    if(guide) {guide.innerHTML='';window.AuctionRules.descriptions.forEach(function(rule) {
      const item=document.createElement('p');item.textContent=rule.label+'：'+rule.explanation;guide.appendChild(item);
    });}
  }
  const limitation = document.getElementById('auctionDataLimitation');
  if (limitation) limitation.textContent = auction.limitation + ' 数据源：' + auction.source + '。';

  const latest = data[data.length - 1];
  const marks = [];
  nineTurnHistory.events.forEach(function(event) {
    marks.push({
      name: event.label,
      coord: [event.date, event.close],
      value: '9',
      symbolOffset: [0, event.direction === 'up' ? '-65%' : '65%'],
      itemStyle: { color: event.direction === 'up' ? '#f59e0b' : '#2563eb' },
      signal: {
        label: event.date + ' · ' + event.label,
        detail: event.rule,
        basis: '事件后收盘涨跌（事后核对）：' + [1, 5, 20].map(function(horizon) {
          return horizon + '根后 ' + nineTurnOutcomeText(event.outcomes[horizon]);
        }).join('；'),
        limitations: [nineTurnHistory.limitation],
        triggerUsesFutureData: false
      }
    });
  });
  signals.filter(function(signal) {
    return signal.active && signal.key !== 'intraday-breakout';
  }).forEach(function(signal, index) {
    marks.push({
      name: signal.label,
      coord: [latest.date, Number(latest.close)],
      value: signal.key === 'breakout' ? '突' : '积',
      symbolOffset: [(index + 1) * -32, '-65%'],
      itemStyle: { color: signal.key === 'breakout' ? '#dc2626' : '#7c3aed' },
      signal: {
        label: signal.label,
        detail: signal.reason,
        basis: signal.rule,
        limitations: ['本地透明规则，不等同于同花顺专有Level-2信号。'],
        triggerUsesFutureData: false
      }
    });
  });
  State.currentKlineSignalMarks = marks;
}

function showUnavailableKline(State, code, period, meta, message) {
  hideKlineInsights(State);
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
    const minutePromise = period === 'day'
      ? window.ApiClient.fetchApiEnvelope('/api/minute?code=' + code + '&resolution=1m')
        .catch(function() { return { data: [], meta: { dataSource: 'unavailable' } }; })
      : Promise.resolve({ data: [], meta: {} });
    const localAuctionPromise = period === 'day'
      ? window.ApiClient.fetchApiEnvelope('/api/minute?code=' + code + '&resolution=30s')
        .catch(function() { return { data: [], meta: { dataSource: 'local-30s-unavailable' } }; })
      : Promise.resolve({ data: [], meta: {} });
    const envelope = await window.ApiClient.fetchApiEnvelope('/api/kline?code=' + code + '&period=' + period);
    if (requestId !== klineRequestSequence || !State.currentStock || State.currentStock.code !== code || State.currentPeriod !== period) return;
    // Historical candles are the primary result. Do not hold them behind a
    // slower optional minute/auction source; enrich only this same selection.
    if (Array.isArray(envelope.data) && envelope.data.length) {
      State.currentRawData = envelope.data;
      State.currentKlineMeta = Object.assign({}, envelope.meta || {}, {code,period,hasData:true});
      State.klineSnapshots[code] = envelope.data.slice(-80);
      Indicators.calcMAFromData(State.currentRawData, State.maPeriods);
      hideKlineInsights(State);
      renderAvailableKlineHeader(State, envelope.data, envelope.meta || {});
      renderKlineChart(State.currentRawData, State.currentIndicator);
    }
    const results = [envelope, ...await Promise.all([minutePromise, localAuctionPromise])];
    const minuteEnvelope = results[1];
    const data = Array.isArray(envelope.data) ? envelope.data : [];
    const meta = envelope.meta || {};
    const minuteRows = Array.isArray(minuteEnvelope.data) ? minuteEnvelope.data : [];
    const minuteMeta = minuteEnvelope.meta || {};
    const localEnvelope = results[2];
    const localRows = Array.isArray(localEnvelope.data) ? localEnvelope.data : [];
    const localMeta = localEnvelope.meta || {};
    if (requestId !== klineRequestSequence || !State.currentStock || State.currentStock.code !== code || State.currentPeriod !== period) return;
    const chartData = period === 'day' && window.RealtimeChartModel && window.RealtimeChartModel.mergeCurrentDailyBar
      ? window.RealtimeChartModel.mergeCurrentDailyBar(data, minuteRows, minuteMeta)
      : data;
    State.currentKlineMeta = Object.assign({}, meta, { code, period, hasData: chartData.length > 0 });
    if (Array.isArray(chartData) && chartData.length > 0) {
      State.currentRawData = chartData;
      State.klineSnapshots[code] = chartData.slice(-80);
      Indicators.calcMAFromData(State.currentRawData, State.maPeriods);
      renderAvailableKlineHeader(State, chartData, meta);
      renderKlineInsights(State, chartData, minuteRows, minuteMeta, localRows, localMeta);
      renderKlineChart(State.currentRawData, State.currentIndicator);
      if (meta.stale && State.currentView === 'kline') {
        const priceInfo = document.getElementById('priceInfo');
        const chartTitle = document.getElementById('chartTitle');
        if (chartTitle && State.currentStock) {
          chartTitle.textContent += '（缓存）';
        }
        if (priceInfo) {
          const fetchedAt = meta.fetchedAt && window.WebStockTime
            ? window.WebStockTime.formatDateTime(meta.fetchedAt) : meta.fetchedAt || '';
          priceInfo.insertAdjacentHTML('beforeend', ' <span class="market-source-warning">· 历史K线使用缓存数据' +
            (fetchedAt ? '（缓存时间 ' + fetchedAt + '）' : '') + '</span>');
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
  parseMAPeriods,
  renderKlineChart,
  enableLegendDblClick,
  openMASettings,
  closeMASettings,
  applyMASettings,
  loadKlineData,
  prefetchKlineSnapshot
};
