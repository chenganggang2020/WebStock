function showRealtimeView() {
  const State = window.State;
  State.currentView = 'realtime';
  document.getElementById('viewSwitchBtn').textContent = '历史K线';
  document.getElementById('realtimeView').style.display = 'flex';
  document.getElementById('klineView').style.display = 'none';
  document.getElementById('indicatorBtns').classList.remove('visible');
  document.getElementById('periodToggle').style.display = 'none';
  if (State.currentStock) {
    loadRealtimeData(State.currentStock.code);
  }
}

function stockLimitRatio(quote) {
  const code = String((quote && quote.code) || '');
  const name = String((quote && quote.name) || '').toUpperCase();
  if (name.includes('ST')) return 0.05;
  if (/^(30|68)/.test(code)) return 0.2;
  if (/^(8|4|92)/.test(code)) return 0.3;
  return 0.1;
}

function realtimeFmtVolume(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '--';
  const hands = n / 100;
  return hands >= 10000 ? (hands / 10000).toFixed(2) + '万手' : hands.toFixed(0) + '手';
}

function realtimeFmtAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '--';
  return n >= 100000000 ? (n / 100000000).toFixed(2) + '亿' : (n / 10000).toFixed(2) + '万';
}

function showKlineView() {
  const State = window.State;
  const KlineChart = window.KlineChart;
  State.currentView = 'kline';
  document.getElementById('viewSwitchBtn').textContent = '实时行情';
  document.getElementById('klineView').style.display = 'flex';
  document.getElementById('realtimeView').style.display = 'none';
  document.getElementById('indicatorBtns').classList.add('visible');
  document.getElementById('periodToggle').style.display = 'flex';

  const indSelect = document.getElementById('indicatorSelect');
  if (indSelect) indSelect.value = State.currentIndicator;
  const maBtn = document.getElementById('maSettingsBtn');
  if (maBtn) maBtn.style.display = State.currentIndicator === 'ma' ? 'inline-flex' : 'none';

  const chartTitle = document.getElementById('chartTitle');
  if (chartTitle && State.currentStock) {
    chartTitle.textContent = (State.currentStock.name || '未知') + ' (' + State.currentStock.code + ') 历史数据';
  }

  if (State.currentStock) {
    KlineChart.loadKlineData(State.currentStock.code, State.currentPeriod);
  }
}

async function loadRealtimeData(code) {
  const State = window.State;
  try {
    console.log('📡 加载实时数据:', code);

    const [quotes, minuteData] = await Promise.all([
      window.ApiClient.fetchJsonData('/api/quote?codes=' + code),
      window.ApiClient.fetchJsonData('/api/minute?code=' + code)
    ]);

    console.log('📦 行情数据:', quotes.length, '条');
    console.log('📦 分时数据:', Array.isArray(minuteData) ? minuteData.length : '非数组', '条');

    if (quotes.length > 0) {
      const quote = quotes.find(q => q.code === code) || quotes[0];
      State.currentQuote = quote;
      console.log('📊 当前股票:', State.currentQuote.name, '(' + State.currentQuote.code + ')');
      updateStockInfo(State.currentQuote, minuteData);
      updateOrderBook(State.currentQuote);
    }

    renderTimeChart(minuteData);
    renderVolumeChart(minuteData);
  } catch (e) {
    console.error('❌ 加载实时数据失败:', e);
    renderTimeChart([]);
    renderVolumeChart([]);
  }
}

function updateStockInfo(quote, minuteData) {
  const isDark = document.body.classList.contains('dark');
  const upColor = isDark ? '#ff6b6b' : '#e74c3c';
  const downColor = isDark ? '#51cf66' : '#2ecc71';

  const price = parseFloat(quote.price) || 0;
  const prevClose = parseFloat(quote.prevClose) || 0;
  const change = parseFloat(quote.change) || 0;
  const color = price === 0 ? '#999' : (change >= 0 ? upColor : downColor);

  const openVal = parseFloat(quote.open) || 0;
  const highVal = parseFloat(quote.high) || 0;
  const lowVal = parseFloat(quote.low) || 0;
  const buy1Val = parseFloat(quote.buy1Price) || 0;
  const sell1Val = parseFloat(quote.sell1Price) || 0;
  const limitRatio = stockLimitRatio(quote);
  const limitUp = prevClose > 0 ? prevClose * (1 + limitRatio) : 0;
  const limitDown = prevClose > 0 ? prevClose * (1 - limitRatio) : 0;

  const openColor = prevClose > 0 ? (openVal >= prevClose ? upColor : downColor) : '#999';
  const highColor = prevClose > 0 ? (highVal >= prevClose ? upColor : downColor) : '#999';
  const lowColor = prevClose > 0 ? (lowVal >= prevClose ? upColor : downColor) : '#999';
  const buy1Color = prevClose > 0 ? (buy1Val >= prevClose ? upColor : downColor) : '#999';
  const sell1Color = prevClose > 0 ? (sell1Val >= prevClose ? upColor : downColor) : '#999';

  document.getElementById('infoOpen').textContent = openVal > 0 ? openVal.toFixed(2) : '--';
  document.getElementById('infoOpen').style.color = openColor;
  document.getElementById('infoPrevClose').textContent = prevClose > 0 ? prevClose.toFixed(2) : '--';
  document.getElementById('infoPrice').textContent = price === 0 ? '--' : price.toFixed(2);
  document.getElementById('infoPrice').style.color = color;
  document.getElementById('infoHigh').textContent = highVal > 0 ? highVal.toFixed(2) : '--';
  document.getElementById('infoHigh').style.color = highColor;
  document.getElementById('infoLow').textContent = lowVal > 0 ? lowVal.toFixed(2) : '--';
  document.getElementById('infoLow').style.color = lowColor;
  if (document.getElementById('infoLimitUp')) {
    document.getElementById('infoLimitUp').textContent = limitUp > 0 ? limitUp.toFixed(2) : '--';
    document.getElementById('infoLimitUp').style.color = upColor;
  }
  if (document.getElementById('infoLimitDown')) {
    document.getElementById('infoLimitDown').textContent = limitDown > 0 ? limitDown.toFixed(2) : '--';
    document.getElementById('infoLimitDown').style.color = downColor;
  }
  if (document.getElementById('infoVolume')) document.getElementById('infoVolume').textContent = realtimeFmtVolume(quote.volume);
  if (document.getElementById('infoAmount')) document.getElementById('infoAmount').textContent = realtimeFmtAmount(quote.amount);
  document.getElementById('infoBuy1').textContent = buy1Val > 0 ? buy1Val.toFixed(2) + ' / ' + ((quote.buy1Vol / 100).toFixed(0)) + '手' : '--';
  document.getElementById('infoBuy1').style.color = buy1Color;
  document.getElementById('infoSell1').textContent = sell1Val > 0 ? sell1Val.toFixed(2) + ' / ' + ((quote.sell1Vol / 100).toFixed(0)) + '手' : '--';
  document.getElementById('infoSell1').style.color = sell1Color;

  const data = minuteData;
  let dataDate = '';
  if (data && data.length > 0) {
    const validData = data.filter(function(item) {
      return item.time && item.time.includes('-');
    });
    if (validData.length > 0) {
      const firstItem = validData[0];
      const timeStr = firstItem.time || '';
      const dateMatch = timeStr.match(/\d{4}-\d{2}-\d{2}/);
      if (dateMatch) {
        dataDate = dateMatch[0];
      }
    }
  }
  if (!dataDate) {
    dataDate = window.WebStockTime && window.WebStockTime.todayDate ? window.WebStockTime.todayDate() : new Date().toISOString().slice(0, 10);
  }
  const chartTitle = document.getElementById('chartTitle');
  if (chartTitle) {
    chartTitle.textContent = (quote.name || '未知') + ' (' + quote.code + ') ' + dataDate + ' 实时行情';
  }
}

function updateOrderBook(quote) {
  const isDark = document.body.classList.contains('dark');
  const upColor = isDark ? '#ff6b6b' : '#e74c3c';
  const downColor = isDark ? '#51cf66' : '#2ecc71';
  const prevClose = parseFloat(quote.prevClose) || 0;

  for (let i = 1; i <= 5; i++) {
    const buyPrice = parseFloat(quote['buy' + i + 'Price']) || 0;
    const buyVol = quote['buy' + i + 'Vol'];
    const sellPrice = parseFloat(quote['sell' + i + 'Price']) || 0;
    const sellVol = quote['sell' + i + 'Vol'];

    const buyColor = prevClose > 0 ? (buyPrice >= prevClose ? upColor : downColor) : '#999';
    const sellColor = prevClose > 0 ? (sellPrice >= prevClose ? upColor : downColor) : '#999';

    if (document.getElementById('buy' + i)) {
      const buyEl = document.getElementById('buy' + i);
      buyEl.innerHTML = '<span class="order-price" style="color:' + buyColor + '">' + (buyPrice > 0 ? buyPrice.toFixed(2) : '-') + '</span>' +
        '<span class="order-vol">' + (buyVol ? (buyVol / 100).toFixed(0) : '-') + '</span>';
    }
    if (document.getElementById('sell' + i)) {
      const sellEl = document.getElementById('sell' + i);
      sellEl.innerHTML = '<span class="order-price" style="color:' + sellColor + '">' + (sellPrice > 0 ? sellPrice.toFixed(2) : '-') + '</span>' +
        '<span class="order-vol">' + (sellVol ? (sellVol / 100).toFixed(0) : '-') + '</span>';
    }
  }
}

function generateFullTimeAxis() {
  const times = [];
  for (let h = 9; h <= 11; h++) {
    const startMin = h === 9 ? 30 : 0;
    const endMin = h === 11 ? 30 : 55;
    for (let m = startMin; m <= endMin; m += 5) {
      times.push(String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'));
    }
  }
  for (let h = 13; h <= 15; h++) {
    const endMin = h === 15 ? 0 : 55;
    for (let m = 0; m <= endMin; m += 5) {
      times.push(String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'));
    }
  }
  return times;
}

function minuteItemMinutes(item) {
  const match = item && item.time ? String(item.time).match(/(\d{2}):(\d{2})(?::\d{2})?/) : null;
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minuteDataDate(minuteData) {
  if (!Array.isArray(minuteData)) return '';
  const item = minuteData.find(function(row) {
    return row && row.time && /\d{4}-\d{2}-\d{2}/.test(row.time);
  });
  const match = item && String(item.time).match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}

function latestMinuteFromData(minuteData) {
  if (!Array.isArray(minuteData)) return null;
  return minuteData.reduce(function(max, item) {
    const minutes = minuteItemMinutes(item);
    return Number.isFinite(minutes) ? Math.max(max, minutes) : max;
  }, -1);
}

function realtimeCutoffMinutes(minuteData) {
  const latest = latestMinuteFromData(minuteData);
  const today = window.WebStockTime && window.WebStockTime.todayDate ? window.WebStockTime.todayDate() : '';
  const dataDate = minuteDataDate(minuteData);
  if (dataDate && today && dataDate !== today && latest >= 0) return latest;
  const current = window.WebStockTime && window.WebStockTime.currentMinutes
    ? window.WebStockTime.currentMinutes()
    : (new Date().getHours() * 60 + new Date().getMinutes());
  return latest >= 0 ? Math.max(current, latest) : current;
}

function renderTimeChart(minuteData) {
  const State = window.State;
  if (!State.currentQuote) return;

  const isDark = document.body.classList.contains('dark');
  const upColor = isDark ? '#ff6b6b' : '#e74c3c';
  const downColor = isDark ? '#51cf66' : '#2ecc71';
  const textColor = isDark ? '#cbd5e1' : '#2c3e50';
  const bgColor = isDark ? '#1e293b' : '#ffffff';
  const gridColor = isDark ? '#4a5568' : '#e0e0e0';

  const fullTimes = generateFullTimeAxis();
  const times = [];
  const prices = [];
  const avgPrices = [];

  const prevClose = parseFloat(State.currentQuote.prevClose) || parseFloat(State.currentQuote.price) || 10;
  const openPrice = parseFloat(State.currentQuote.open) || prevClose;

  const currentMinutes = realtimeCutoffMinutes(minuteData);

  const dataMap = {};
  if (Array.isArray(minuteData) && minuteData.length > 0) {
    minuteData.forEach(function(item) {
      const timeStr = item.time;
      if (timeStr) {
        const match = timeStr.match(/(\d{2}):(\d{2}):\d{2}/);
        if (match) {
          const key = match[1] + ':' + match[2];
          dataMap[key] = item;
        }
      }
    });
  }

  let totalAmount = 0;
  let totalVolume = 0;
  let lastValidPrice = openPrice;

  fullTimes.forEach(function(timeStr) {
    const timeMatch = timeStr.match(/(\d{2}):(\d{2})/);
    if (!timeMatch) return;
    
    const itemMinutes = parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2]);
    
    if (itemMinutes > currentMinutes + 5) {
      times.push(timeStr);
      prices.push(null);
      avgPrices.push(null);
      return;
    }

    times.push(timeStr);
    
    const dataItem = dataMap[timeStr];
    let price = 0;
    let volume = 0;

    if (dataItem) {
      price = parseFloat(dataItem.price) || 0;
      volume = parseFloat(dataItem.volume) || 0;
    }

    if (price <= 0) {
      price = lastValidPrice;
    } else {
      lastValidPrice = price;
    }

    prices.push(price);

    if (volume > 0) {
      const amount = parseFloat(dataItem.amount) || price * volume;
      totalVolume += volume;
      totalAmount += amount;
    }

    let avgPrice = prevClose;
    if (totalVolume > 0) {
      avgPrice = totalAmount / totalVolume;
    } else if (prices.length > 0) {
      const validPrices = prices.filter(function(p) { return p !== null && p > 0; });
      if (validPrices.length > 0) {
        avgPrice = validPrices.reduce(function(a, b) { return a + b; }, 0) / validPrices.length;
      }
    }
    avgPrices.push(+avgPrice.toFixed(2));
  });

  const validPrices = prices.filter(function(p) { return p !== null && p > 0; });
  if (validPrices.length === 0) {
    const dom = document.getElementById('timeChartContainer');
    dom.innerHTML = '<div class="loading">暂无分时数据</div>';
    return;
  }

  const highPrice = Math.max.apply(null, prices);
  const lowPrice = Math.min.apply(null, prices.filter(function(p) { return p !== null && p > 0; }));

  const upDiff = highPrice - prevClose;
  const downDiff = prevClose - lowPrice;
  const maxDiff = Math.max(upDiff, downDiff);
  const unit = 0.06;
  const range = Math.ceil(maxDiff * 1.01 / unit) * unit;

  const yMin = +(prevClose - range).toFixed(2);
  const yMax = +(prevClose + range).toFixed(2);

  const option = {
    backgroundColor: bgColor,
    grid: { top: 30, right: 58, bottom: 30, left: 50 },
    xAxis: {
      type: 'category',
      data: times,
      axisLine: { lineStyle: { color: gridColor } },
      axisLabel: { color: textColor, fontSize: 10 },
      splitLine: { show: false }
    },
    yAxis: [
      {
        type: 'value',
        min: yMin,
        max: yMax,
        axisLine: { lineStyle: { color: gridColor } },
        axisLabel: { color: textColor, fontSize: 10 },
        splitLine: { lineStyle: { color: gridColor, type: 'dashed' } },
        axisTick: { show: true },
        splitNumber: 5
      },
      {
        type: 'value',
        min: yMin,
        max: yMax,
        axisLine: { lineStyle: { color: gridColor } },
        axisLabel: {
          color: textColor,
          fontSize: 10,
          formatter: function(v) {
            if (!prevClose) return '--';
            const pct = (v - prevClose) / prevClose * 100;
            return (pct > 0 ? '+' : '') + pct.toFixed(2) + '%';
          }
        },
        splitLine: { show: false },
        axisTick: { show: true }
      }
    ],
    series: [
      {
        name: '昨收',
        type: 'line',
        yAxisIndex: 0,
        data: times.map(function() { return prevClose; }),
        smooth: false,
        symbol: 'none',
        lineStyle: {
          color: '#94a3b8',
          width: 2,
          type: 'dashed'
        },
        zlevel: 0,
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: {
            color: '#94a3b8',
            width: 2,
            type: 'dashed'
          },
          data: [{
            yAxis: prevClose,
            label: {
              formatter: '昨收 ' + prevClose.toFixed(2),
              position: 'end',
              color: textColor,
              fontSize: 10
            }
          }]
        }
      },
      {
        name: '分时价格',
        type: 'line',
        yAxisIndex: 0,
        data: prices,
        smooth: true,
        symbol: 'none',
        connectNulls: false,
        lineStyle: { color: upColor, width: 2 },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: upColor + '30' },
              { offset: 1, color: upColor + '05' }
            ]
          }
        },
        zlevel: 1
      },
      {
        name: '均价',
        type: 'line',
        yAxisIndex: 0,
        data: avgPrices,
        smooth: true,
        symbol: 'none',
        connectNulls: false,
        lineStyle: { color: downColor, width: 1, type: 'dashed' }
      }
    ],
    tooltip: {
      trigger: 'axis',
      backgroundColor: isDark ? '#1e293b' : '#ffffff',
      borderColor: isDark ? '#475569' : '#e0e0e0',
      textStyle: { color: textColor },
      formatter: function(params) {
        if (!params || params.length === 0) return '';
        const idx = params[0].dataIndex;
        return '<strong>' + times[idx] + '</strong><br/>' +
          '价格: ' + prices[idx] + '<br/>' +
          '均价: ' + avgPrices[idx];
      }
    }
  };

  if (State.timeChart) State.timeChart.dispose();
  const dom = document.getElementById('timeChartContainer');
  dom.innerHTML = '';
  State.timeChart = echarts.init(dom);
  State.timeChart.setOption(option);

  renderMinuteDeals(minuteData);
}

function renderMinuteDeals(minuteData) {
  const State = window.State;
  const dealsList = document.getElementById('dealsList');
  if (!dealsList || !minuteData || minuteData.length === 0) return;

  const validData = minuteData.filter(function(item) {
    const timeStr = item.time;
    return timeStr && timeStr.includes('-') && timeStr.match(/\d{4}-\d{2}-\d{2}/);
  });

  validData.sort(function(a, b) { return b.time.localeCompare(a.time); });

  const recentDeals = validData.slice(0, 20);

  let html = '<div class="deal-row header"><span>时间</span><span>价格</span><span>成交量</span></div>';
  const prevClose = State.currentQuote ? State.currentQuote.prevClose : 0;

  recentDeals.forEach(function(deal) {
    const price = deal.price || 0;
    const direction = price >= prevClose ? 'up' : 'down';
    let timeStr = deal.time || '-';
    if (timeStr.includes(' ')) {
      timeStr = timeStr.split(' ')[1];
    }
    html += '<div class="deal-row ' + direction + '">';
    html += '<span>' + timeStr + '</span>';
    html += '<span>' + (price > 0 ? price.toFixed(2) : '-') + '</span>';
    html += '<span>' + ((deal.volume || 0) > 0 ? formatVolume(deal.volume) : '-') + '</span>';
    html += '</div>';
  });

  dealsList.innerHTML = html;
}

function formatVolume(vol) {
  if (vol >= 100000000) {
    return (vol / 100000000).toFixed(2) + '亿';
  } else if (vol >= 10000) {
    return (vol / 10000).toFixed(2) + '万';
  }
  return vol.toString();
}

function renderVolumeChart(minuteData) {
  const State = window.State;
  if (!State.currentQuote) return;

  const isDark = document.body.classList.contains('dark');
  const upColor = isDark ? '#ff6b6b' : '#e74c3c';
  const downColor = isDark ? '#51cf66' : '#2ecc71';
  const textColor = isDark ? '#cbd5e1' : '#2c3e50';
  const bgColor = isDark ? '#1e293b' : '#ffffff';
  const gridColor = isDark ? '#4a5568' : '#e0e0e0';

  const times = [];
  const volumes = [];
  const volumeColors = [];

  const currentMinutes = realtimeCutoffMinutes(minuteData);
  let lastPrice = parseFloat(State.currentQuote.prevClose) || parseFloat(State.currentQuote.open) || parseFloat(State.currentQuote.price) || 0;

  const dataMap = {};
  if (Array.isArray(minuteData) && minuteData.length > 0) {
    minuteData.forEach(function(item) {
      const timeStr = item.time;
      if (timeStr) {
        const match = timeStr.match(/(\d{2}):(\d{2}):\d{2}/);
        if (match) {
          const key = match[1] + ':' + match[2];
          dataMap[key] = item;
        }
      }
    });
  }

  const fullTimes = generateFullTimeAxis();
  fullTimes.forEach(function(timeStr) {
    const timeMatch = timeStr.match(/(\d{2}):(\d{2})/);
    if (!timeMatch) return;

    const itemMinutes = parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2]);

    if (itemMinutes > currentMinutes + 5) {
      times.push(timeStr);
      volumes.push(null);
      volumeColors.push('rgba(148, 163, 184, 0.25)');
      return;
    }

    times.push(timeStr);

    const dataItem = dataMap[timeStr];
    const volume = dataItem ? (parseFloat(dataItem.volume) || 0) : 0;
    const price = dataItem ? (parseFloat(dataItem.price) || 0) : 0;
    volumes.push(volume);
    if (!dataItem || volume <= 0) {
      volumeColors.push('rgba(148, 163, 184, 0.45)');
    } else {
      volumeColors.push(price >= lastPrice ? upColor : downColor);
      if (price > 0) lastPrice = price;
    }
  });

  if (volumes.filter(function(v) { return v !== null && v > 0; }).length === 0) {
    const dom = document.getElementById('volumeChartContainer');
    dom.innerHTML = '<div class="loading">暂无成交量数据</div>';
    return;
  }

  const option = {
    backgroundColor: bgColor,
    grid: { top: 20, right: 20, bottom: 30, left: 50 },
    xAxis: {
      type: 'category',
      data: times,
      axisLine: { lineStyle: { color: gridColor } },
      axisLabel: { color: textColor, fontSize: 10 },
      splitLine: { show: false }
    },
    yAxis: {
      type: 'value',
      axisLine: { lineStyle: { color: gridColor } },
      axisLabel: { color: textColor, fontSize: 10, formatter: function(v) { return v.toFixed(1); } },
      splitLine: { lineStyle: { color: gridColor, type: 'dashed' } }
    },
    series: [
      {
        name: '成交量(万手)',
        type: 'bar',
        data: volumes.map(function(v, i) {
          return { value: v === null ? null : v / 10000, itemStyle: { color: volumeColors[i], opacity: 0.78 } };
        }),
        barWidth: '60%'
      }
    ],
    tooltip: {
      trigger: 'axis',
      backgroundColor: isDark ? '#1e293b' : '#ffffff',
      borderColor: isDark ? '#475569' : '#e0e0e0',
      textStyle: { color: textColor },
      formatter: function(params) {
        if (!params || params.length === 0) return '';
        const idx = params[0].dataIndex;
        return '<strong>' + times[idx] + '</strong><br/>' +
          '成交量: ' + (volumes[idx] == null ? '--' : (volumes[idx] / 10000).toFixed(2) + '万手');
      }
    }
  };

  if (State.volumeChart) State.volumeChart.dispose();
  const dom = document.getElementById('volumeChartContainer');
  dom.innerHTML = '';
  State.volumeChart = echarts.init(dom);
  State.volumeChart.setOption(option);
}

window.RealtimeChart = {
  showRealtimeView,
  showKlineView,
  loadRealtimeData,
  updateStockInfo,
  updateOrderBook,
  renderTimeChart,
  renderMinuteDeals,
  formatVolume,
  renderVolumeChart
};
