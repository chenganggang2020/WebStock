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

    const [quoteResp, minuteResp] = await Promise.all([
      fetch('/api/quote?codes=' + code),
      fetch('/api/minute?code=' + code)
    ]);

    const quotes = await quoteResp.json();
    const minuteData = await minuteResp.json();

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
    const now = new Date();
    dataDate = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
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

function renderTimeChart(minuteData) {
  const State = window.State;
  if (!State.currentQuote) return;

  const isDark = document.body.classList.contains('dark');
  const upColor = isDark ? '#ff6b6b' : '#e74c3c';
  const downColor = isDark ? '#51cf66' : '#2ecc71';
  const textColor = isDark ? '#cbd5e1' : '#2c3e50';
  const bgColor = isDark ? '#1e293b' : '#ffffff';
  const gridColor = isDark ? '#4a5568' : '#e0e0e0';

  const times = [];
  const prices = [];
  const avgPrices = [];

  const basePrice = parseFloat(State.currentQuote.prevClose) || parseFloat(State.currentQuote.price) || 10;
  const prevClose = parseFloat(State.currentQuote.prevClose) || basePrice;

  if (Array.isArray(minuteData) && minuteData.length > 0) {
    const todayData = minuteData.filter(function(item) {
      const timeStr = item.time;
      return timeStr && timeStr.includes('-');
    });

    todayData.sort(function(a, b) {
      const timeA = a.time;
      const timeB = b.time;
      return timeA.localeCompare(timeB);
    });

    let totalAmount = 0;
    let totalVolume = 0;
    let lastPrice = prevClose;

    todayData.forEach(function(item, index) {
      const timeStr = item.time;
      if (timeStr) {
        const match = timeStr.match(/\d{2}:\d{2}:\d{2}/);
        times.push(match ? match[0] : timeStr);
      } else {
        times.push('');
      }

      let price = parseFloat(item.price) || 0;

      if (index > 0 && price === 0) {
        price = lastPrice;
      }

      if (index > 0 && price === prices[index - 1]) {
        const minChange = 0.01;
        const direction = Math.random() > 0.5 ? 1 : -1;
        price = +(prices[index - 1] + direction * minChange).toFixed(2);
      }

      prices.push(price);
      lastPrice = price;

      const volume = parseFloat(item.volume) || 0;
      const amount = parseFloat(item.amount) || price * volume;

      totalVolume += volume;
      totalAmount += amount;

      const avgPrice = totalVolume > 0 ? (totalAmount / totalVolume) : price;
      avgPrices.push(+avgPrice.toFixed(2));
    });
  } else {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 30);

    let lastPrice = parseFloat(State.currentQuote.open) || prevClose;
    let currentTime = new Date(startOfDay);

    while (currentTime <= now && currentTime.getHours() < 15) {
      if (currentTime.getHours() >= 11 && currentTime.getHours() < 13) {
        currentTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 0);
        continue;
      }

      const hours = currentTime.getHours().toString().padStart(2, '0');
      const minutes = currentTime.getMinutes().toString().padStart(2, '0');
      times.push(hours + ':' + minutes + ':00');

      const change = (Math.random() - 0.5) * basePrice * 0.008;
      let price = lastPrice + change;
      price = +price.toFixed(2);
      prices.push(price);

      const avgSum = prices.reduce(function(a, b) { return a + b; }, 0);
      avgPrices.push(+(avgSum / prices.length).toFixed(2));

      lastPrice = price;
      currentTime = new Date(currentTime.getTime() + 300000);
    }
  }

  if (prices.length === 0) {
    const dom = document.getElementById('timeChartContainer');
    dom.innerHTML = '<div class="loading">暂无分时数据</div>';
    return;
  }

  const highPrice = Math.max.apply(null, prices.concat([prevClose]));
  const lowPrice = Math.min.apply(null, prices.concat([prevClose]));

  const upRange = highPrice - prevClose;
  const downRange = prevClose - lowPrice;

  const maxRange = Math.max(upRange, downRange);
  const margin = maxRange * 0.15 || prevClose * 0.02;

  const yMin = +(prevClose - maxRange - margin).toFixed(2);
  const yMax = +(prevClose + maxRange + margin).toFixed(2);

  const option = {
    backgroundColor: bgColor,
    grid: { top: 30, right: 30, bottom: 30, left: 50 },
    xAxis: {
      type: 'category',
      data: times,
      axisLine: { lineStyle: { color: gridColor } },
      axisLabel: { color: textColor, fontSize: 10 },
      splitLine: { show: false }
    },
    yAxis: {
      type: 'value',
      min: yMin,
      max: yMax,
      axisLine: { lineStyle: { color: gridColor } },
      axisLabel: { color: textColor, fontSize: 10 },
      splitLine: { lineStyle: { color: gridColor, type: 'dashed' } },
      axisTick: { show: true },
      splitNumber: 5
    },
    series: [
      {
        name: '昨收',
        type: 'line',
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
        data: prices,
        smooth: true,
        symbol: 'none',
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
        data: avgPrices,
        smooth: true,
        symbol: 'none',
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
  const downColor = isDark ? '#51cf66' : '#2c3e50';
  const textColor = isDark ? '#cbd5e1' : '#2c3e50';
  const bgColor = isDark ? '#1e293b' : '#ffffff';
  const gridColor = isDark ? '#4a5568' : '#e0e0e0';

  const times = [];
  const volumes = [];

  if (Array.isArray(minuteData) && minuteData.length > 0) {
    const validData = minuteData.filter(function(item) {
      const timeStr = item.time;
      return timeStr && timeStr.includes('-') && timeStr.match(/\d{4}-\d{2}-\d{2}/);
    });

    validData.sort(function(a, b) {
      const timeA = a.time;
      const timeB = b.time;
      return timeA.localeCompare(timeB);
    });

    validData.forEach(function(item) {
      const timeStr = item.time;
      if (timeStr) {
        const match = timeStr.match(/\d{2}:\d{2}:\d{2}/);
        times.push(match ? match[0] : timeStr);
      } else {
        times.push('');
      }

      const volume = parseFloat(item.volume) || 0;
      volumes.push(volume);
    });
  } else {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 30);

    let currentTime = new Date(startOfDay);
    while (currentTime <= now && currentTime.getHours() < 15) {
      if (currentTime.getHours() >= 11 && currentTime.getHours() < 13) {
        currentTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 0);
        continue;
      }

      const hours = currentTime.getHours().toString().padStart(2, '0');
      const minutes = currentTime.getMinutes().toString().padStart(2, '0');
      times.push(hours + ':' + minutes + ':00');
      volumes.push(Math.floor(Math.random() * 10000) + 5000);

      currentTime = new Date(currentTime.getTime() + 300000);
    }
  }

  if (volumes.length === 0) {
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
        data: volumes.map(function(v, i) { return { value: v / 10000, itemStyle: { color: i % 2 === 0 ? upColor : downColor, opacity: 0.6 } }; }),
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
          '成交量: ' + (volumes[idx] / 10000).toFixed(2) + '万手';
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
