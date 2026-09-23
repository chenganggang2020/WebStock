let realtimeRequestSequence = 0;
let realtimeRefreshTimer = null;
let realtimeRequestController = null;
let realtimeLoadPromise = null;
let realtimeLoadCode = '';
let lastRenderedRealtimeCode = '';
let lastRenderedRealtimeSnapshot = '';
let realtimeResolution = '1m';
let realtimeAuctionEnabled = true;
let realtimeStatusBase = '1分钟公开行情';
let lastChartSamples = null;
let lastChartSampleCode = '';

function normalizeRealtimeResolution(value) {
  return value === '5s' || value === '30s' ? value : '1m';
}

function realtimeResolutionLabel(value) {
  const resolution = normalizeRealtimeResolution(value || realtimeResolution);
  if (resolution === '5s') return '5秒分时';
  return resolution === '30s' ? '30秒分时' : '1分钟公开行情';
}

function realtimeMinuteUrl(code, resolution, localOnly) {
  const base = '/api/minute?code=' + encodeURIComponent(code);
  const normalized = normalizeRealtimeResolution(resolution);
  if (normalized === '5s') return base + '&resolution=5s' + (localOnly ? '' : '&source=public-detail');
  if (normalized === '30s') return base + '&resolution=30s' + (localOnly ? '' : '&source=public-detail');
  return base;
}

function realtimeSourceLabel(meta) {
  const source = meta || {};
  const stateSuffix = source.marketState === 'latest-close' ? '（最近收盘）' :
    source.marketState === 'delayed' ? '（延迟）' : '';
  if (source.dataSource === 'tencent-public-detail') return '腾讯秒级明细' +
    (source.rawIntervalSeconds ? ' · 原始常见间隔 ' + source.rawIntervalSeconds + '秒' : '') +
    (source.localSupplementPoints ? ' · 本机补充 ' + source.localSupplementPoints + ' 点' : '') +
    (source.paginationComplete === false ? ' · 来源返回不完整' : '') + stateSuffix;
  if (source.dataSource === 'unavailable') return '行情不可用';
  if (source.reason === 'not-yet-collected') return '本机尚未采集该股秒级记录；不能从分钟线还原';
  const localSuffix = source.stale ? '（旧采样，非当前行情）' : stateSuffix;
  if (source.dataSource === 'local-public-quote-5s') return '本机公开报价5秒聚合，非交易所逐笔' + localSuffix;
  if (source.dataSource === 'local-public-quote-30s') return '本机公开报价聚合，非交易所逐笔' + localSuffix;
  if (source.dataSource === 'tencent-1m') return '腾讯公开1分钟' + stateSuffix;
  if (source.dataSource === 'eastmoney-1m') return '东方财富公开1分钟' + stateSuffix;
  return source.stale ? '缓存数据' : '公开行情';
}

function updateRealtimeResolutionControls() {
  document.querySelectorAll('#realtimeResolutionToggle [data-resolution]').forEach(function(button) {
    const active = button.getAttribute('data-resolution') === realtimeResolution;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  const auctionButton = document.querySelector('#realtimeResolutionToggle [data-auction-layer]');
  if (auctionButton) {
    auctionButton.classList.toggle('active', realtimeAuctionEnabled);
    auctionButton.setAttribute('aria-pressed', realtimeAuctionEnabled ? 'true' : 'false');
    auctionButton.textContent = '竞价图层：' + (realtimeAuctionEnabled ? '开' : '关');
  }
}

function isOpeningAuctionRow(row) {
  const key = window.RealtimeChartModel.timeKey(row && row.time);
  const match = key.match(/^(\d{2}):(\d{2})/);
  if (!match) return false;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  return minute >= 9 * 60 + 15 && minute <= 9 * 60 + 25;
}

function mergeRealtimeRows(primaryRows, auctionRows) {
  const merged = new Map();
  const date=String((primaryRows || []).find(row=>/^\d{4}-\d{2}-\d{2}/.test(row.time))?.time || '').slice(0,10);
  (Array.isArray(primaryRows) ? primaryRows : []).forEach(function(row) {
    if (!isOpeningAuctionRow(row) || realtimeAuctionEnabled) merged.set(String(row.time || ''), row);
  });
  if (realtimeAuctionEnabled) {
    (Array.isArray(auctionRows) ? auctionRows : []).filter(row=>isOpeningAuctionRow(row) && date && String(row.time).slice(0,10)===date).forEach(function(row) {
      merged.set(String(row.time || ''), row);
    });
  }
  return Array.from(merged.values()).sort(function(left, right) {
    return String(left.time || '').localeCompare(String(right.time || ''));
  });
}

function updateRealtimeAuctionStatus(meta) {
  const target = document.getElementById('realtimeAuctionStatus');
  if (!target) return;
  target.title = '午休压缩：11:30 后直接连接 13:00；5秒/30秒使用公开原始明细补取与本机记录，缺口不插值。';
  if (!realtimeAuctionEnabled) {
    target.textContent = '固定显示9:30–15:00；可开启本机9:15–9:25竞价快照。';
    return;
  }
  const count = Number(meta && meta.auctionObservedPoints) || 0;
  target.textContent = count
    ? '开盘竞价 9:15–9:25：本机 ' + count + ' 点 · 收盘竞价 14:57–15:00：见图中标记区'
    : '开盘竞价 9:15–9:25：暂无本机记录 · 收盘竞价 14:57–15:00：见图中标记区';
}

function setRealtimeResolution(value) {
  const next = normalizeRealtimeResolution(value);
  if (next === realtimeResolution) {
    updateRealtimeResolutionControls();
    return Promise.resolve({ unchanged: true });
  }
  realtimeResolution = next;
  invalidateRealtimeLoad();
  lastRenderedRealtimeCode = '';
  lastRenderedRealtimeSnapshot = '';
  updateRealtimeResolutionControls();
  setRealtimeStatus(realtimeResolutionLabel() + ' · 正在切换数据源', 'loading');
  return isRealtimeRefreshEligible()
    ? syncRefreshSchedule({ immediate: true })
    : Promise.resolve({ skipped: true });
}

function setRealtimeStatus(message, state) {
  realtimeStatusBase = message || realtimeStatusBase;
  const element = document.getElementById('chartRealtimeStatus');
  if (!element) return;
  element.textContent = realtimeStatusBase;
  element.title = realtimeStatusBase;
  element.setAttribute('data-state', state || 'idle');
}

function isRealtimeRefreshEligible() {
  const State = window.State || {};
  return (State.currentMainView === 'market' || State.currentMainView === 'dashboard') &&
    State.currentView === 'realtime' &&
    document.visibilityState === 'visible' &&
    Boolean(State.currentStock && State.currentStock.code);
}

function isDailyKlineRefreshEligible() {
  const State = window.State || {};
  return (State.currentMainView === 'market' || State.currentMainView === 'dashboard') &&
    State.currentView === 'kline' &&
    State.currentPeriod === 'day' &&
    document.visibilityState === 'visible' &&
    Boolean(State.currentStock && State.currentStock.code);
}

function clearRealtimeRefreshTimer() {
  if (realtimeRefreshTimer !== null) clearTimeout(realtimeRefreshTimer);
  realtimeRefreshTimer = null;
}

function invalidateRealtimeLoad() {
  realtimeRequestSequence += 1;
  if (realtimeRequestController) realtimeRequestController.abort();
  realtimeRequestController = null;
  realtimeLoadPromise = null;
  realtimeLoadCode = '';
}

function stopRealtimeRefresh(options) {
  const settings = options || {};
  clearRealtimeRefreshTimer();
  if (settings.invalidate !== false) invalidateRealtimeLoad();
  if (!settings.silent) setRealtimeStatus(realtimeResolutionLabel() + ' · 自动刷新已暂停', 'paused');
}

function beginStockSelection(code) {
  const State = window.State;
  stopRealtimeRefresh({ invalidate: true, silent: true });
  State.currentQuote = null;
  State.currentMinuteMeta = null;
  State.currentKlineMeta = null;
  State.currentRawData = [];
  lastRenderedRealtimeCode = '';
  lastRenderedRealtimeSnapshot = '';
  lastChartSamples = null;
  ['timeChart', 'volumeChart', 'klineChart'].forEach(function(key) {
    if (State[key] && State[key].clear) State[key].clear();
  });
  document.querySelectorAll('.stock-info-card [id^="info"]').forEach(function(node) { node.textContent = '—'; });
  const deals = document.getElementById('dealsList');
  if (deals) deals.innerHTML = '';
  updateOrderBook({ code, quoteStatus: 'loading' });
  setRealtimeStatus('正在加载所选股票行情', 'loading');
}

function scheduleNextRealtimeRefresh() {
  clearRealtimeRefreshTimer();
  const dailyKline = isDailyKlineRefreshEligible();
  if (!isRealtimeRefreshEligible() && !dailyKline) return;
  const backfilling = window.State.currentMinuteMeta && ['loading', 'busy'].includes(window.State.currentMinuteMeta.backfillState);
  const delay = !dailyKline && backfilling ? 3000 : dailyKline
    ? window.RealtimeChartModel.activeViewRefreshDelayMs('dashboard', new Date())
    : window.RealtimeChartModel.refreshDelayMs(new Date());
  const seconds = Math.round(delay / 1000);
  if (dailyKline) {
    setRealtimeStatus('日线盘中K线 · ' + seconds + '秒后更新', 'scheduled');
  } else {
    const base = realtimeStatusBase.replace(/ · \d+秒后刷新$/, '');
    setRealtimeStatus(base + ' · ' + seconds + '秒后刷新', 'scheduled');
  }
  realtimeRefreshTimer = setTimeout(function() {
    realtimeRefreshTimer = null;
    refreshRealtimeNow();
  }, delay);
}

function refreshRealtimeNow() {
  if (isDailyKlineRefreshEligible()) {
    const code = window.State.currentStock.code;
    setRealtimeStatus('日线盘中K线 · 正在更新', 'loading');
    return window.KlineChart.loadKlineData(code, 'day').finally(function() {
      if (isDailyKlineRefreshEligible() && window.State.currentStock.code === code) {
        scheduleNextRealtimeRefresh();
      }
    });
  }
  if (!isRealtimeRefreshEligible()) {
    stopRealtimeRefresh({ invalidate: true });
    return Promise.resolve({ skipped: true });
  }
  const code = window.State.currentStock.code;
  return loadRealtimeData(code).finally(function() {
    if (isRealtimeRefreshEligible() && window.State.currentStock.code === code) {
      scheduleNextRealtimeRefresh();
    }
  });
}

function syncRefreshSchedule(options) {
  const settings = options || {};
  if (!isRealtimeRefreshEligible() && !isDailyKlineRefreshEligible()) {
    stopRealtimeRefresh({ invalidate: true });
    return Promise.resolve({ skipped: true });
  }
  clearRealtimeRefreshTimer();
  return settings.immediate === true ? refreshRealtimeNow() : (scheduleNextRealtimeRefresh(), Promise.resolve());
}

function showRealtimeView() {
  const State = window.State;
  stopRealtimeRefresh({ invalidate: true, silent: true });
  State.currentView = 'realtime';
  State.currentPeriod = 'minute';
  document.getElementById('realtimeView').style.display = 'flex';
  document.getElementById('klineView').style.display = 'none';
  const klineInsights = document.getElementById('klineInsights');
  const marketSidebarPlaceholder = document.getElementById('marketSidebarPlaceholder');
  if (klineInsights) klineInsights.hidden = true;
  if (marketSidebarPlaceholder) marketSidebarPlaceholder.hidden = false;
  document.getElementById('indicatorBtns').classList.add('visible');
  document.getElementById('indicatorSelect').style.display = 'none';
  document.getElementById('maSettingsBtn').style.display = 'none';
  document.querySelectorAll('.period-btn').forEach(function(button) {
    button.classList.toggle('active', button.getAttribute('data-period') === 'minute');
  });
  const chartTitle = document.getElementById('chartTitle');
  if (chartTitle && State.currentStock) {
    chartTitle.textContent = (State.currentStock.name || '未知') + ' (' + State.currentStock.code + ') 分时行情';
  }
  if (window.ChartCoach && window.ChartCoach.clearMarks) window.ChartCoach.clearMarks();
  updateRealtimeResolutionControls();
  syncRefreshSchedule({ immediate: true });
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

function showKlineView(period) {
  const State = window.State;
  const KlineChart = window.KlineChart;
  const nextPeriod = period && period !== 'minute' ? period : (State.currentPeriod === 'minute' ? 'day' : State.currentPeriod);
  State.currentPeriod = nextPeriod;
  State.currentView = 'kline';
  stopRealtimeRefresh({ invalidate: true, silent: true });
  document.getElementById('klineView').style.display = 'flex';
  document.getElementById('realtimeView').style.display = 'none';
  document.getElementById('indicatorBtns').classList.add('visible');
  document.getElementById('indicatorSelect').style.display = '';
  document.querySelectorAll('.period-btn').forEach(function(button) {
    button.classList.toggle('active', button.getAttribute('data-period') === nextPeriod);
  });

  const indSelect = document.getElementById('indicatorSelect');
  if (indSelect) indSelect.value = State.currentIndicator;
  const maBtn = document.getElementById('maSettingsBtn');
  if (maBtn) maBtn.style.display = State.currentIndicator === 'ma' ? 'inline-flex' : 'none';

  const chartTitle = document.getElementById('chartTitle');
  if (chartTitle && State.currentStock) {
    chartTitle.textContent = (State.currentStock.name || '未知') + ' (' + State.currentStock.code + ') 历史数据';
  }

  if (State.currentStock) {
    if (nextPeriod === 'day') {
      setRealtimeStatus('日线盘中K线 · 正在更新', 'loading');
      syncRefreshSchedule({ immediate: true });
    } else {
      KlineChart.loadKlineData(State.currentStock.code, nextPeriod);
    }
  }
  if (nextPeriod !== 'day') {
    setRealtimeStatus(realtimeResolutionLabel() + ' · 历史K线视图中暂停', 'paused');
  }
}

function loadRealtimeData(code) {
  const State = window.State;
  if (!code) return Promise.resolve({ skipped: true });
  if (realtimeLoadPromise && realtimeLoadCode === code) return realtimeLoadPromise;
  if (realtimeLoadPromise) invalidateRealtimeLoad();

  const requestId = ++realtimeRequestSequence;
  const requestedResolution = realtimeResolution;
  const controller = new AbortController();
  realtimeRequestController = controller;
  realtimeLoadCode = code;

  const request = (async function() {
   try {
    console.log('📡 加载实时数据:', code);

    const auctionRequest = realtimeAuctionEnabled && requestedResolution === '1m'
      ? window.ApiClient.fetchApiEnvelope(realtimeMinuteUrl(code, '30s', true), { signal: controller.signal, dedupe: false })
        .catch(function() { return null; })
      : Promise.resolve(null);
    const quoteRequest = window.ApiClient.fetchJsonData('/api/quote?codes=' + code, { signal: controller.signal, dedupe: false })
      .catch(function() { return []; });
    const minuteEnvelope = await window.ApiClient.fetchApiEnvelope(realtimeMinuteUrl(code, requestedResolution), { signal: controller.signal, dedupe: false });
    function paint(quotes, auctionEnvelope) {
    const primaryMinuteData = Array.isArray(minuteEnvelope.data) ? minuteEnvelope.data : [];
    const auctionData = auctionEnvelope && Array.isArray(auctionEnvelope.data) ? auctionEnvelope.data : primaryMinuteData;
    const minuteData = mergeRealtimeRows(primaryMinuteData, auctionData);
    const auctionObservedPoints = realtimeAuctionEnabled ? minuteData.filter(isOpeningAuctionRow).length : 0;
    const minuteMeta = Object.assign({}, minuteEnvelope.meta || {}, {
      auctionCoverage: realtimeAuctionEnabled ? 'local-observed-09:15-09:25' : 'hidden',
      auctionObservedPoints
    });

    if (controller.signal.aborted || requestId !== realtimeRequestSequence ||
        requestedResolution !== realtimeResolution || !State.currentStock ||
        State.currentStock.code !== code || !isRealtimeRefreshEligible()) return { stale: true };

    console.log('📦 行情数据:', quotes.length, '条');
    console.log('📦 分时数据:', Array.isArray(minuteData) ? minuteData.length : '非数组', '条');

    const rawQuote = quotes.find(q => q.code === code) || (State.currentQuote && State.currentQuote.code === code ? State.currentQuote : {code, name: State.currentStock.name, quoteStatus: 'unavailable'});
    const quote = window.RealtimeChartModel.alignQuoteToMinute(rawQuote, minuteData, minuteMeta);
    if (quote) {
      State.currentQuote = quote;
      State.currentMinuteMeta = Object.assign({}, minuteMeta, {
        code,
        hasData: minuteData.length > 0,
        quoteStatus: quote.quoteStatus || '',
        quoteAlignedFromMinute: quote.minuteAligned === true
      });
      updateRealtimeAuctionStatus(State.currentMinuteMeta);
      State.realtimeSeriesByResolution = State.realtimeSeriesByResolution || {};
      State.realtimeSeriesByResolution[requestedResolution + ':' + code] = minuteData.slice();
      if (requestedResolution === '1m') State.minuteSeriesByCode[code] = minuteData.slice();
      console.log('📊 当前股票:', State.currentQuote.name, '(' + State.currentQuote.code + ')');
      updateStockInfo(State.currentQuote, minuteData, minuteMeta);
      updateOrderBook(rawQuote);
      if (window.StockList && window.StockList.updateVisibleQuoteRows) {
        const quoteMap = {};
        quoteMap[code] = quote;
        window.StockList.updateVisibleQuoteRows(quoteMap);
      }
      if (!minuteData.length) {
        const emptyLabel = realtimeResolutionLabel(requestedResolution);
        if (lastRenderedRealtimeCode === code && (State.timeChart || State.volumeChart)) {
          setRealtimeStatus(emptyLabel + ' · 暂无新数据，保留该股票上次曲线', 'empty');
        } else {
          renderTimeChart([]);
          renderVolumeChart([]);
          lastRenderedRealtimeCode = '';
          lastRenderedRealtimeSnapshot = '';
          setRealtimeStatus(emptyLabel + (requestedResolution !== '1m'
            ? (minuteMeta.backfillState === 'loading' || minuteMeta.backfillState === 'busy'
              ? ' · 正在后台补取原始秒级明细，完成后自动显示'
              : ' · 暂无可用秒级明细；本机记录保留，可切换1分钟行情')
            : ' · 暂无有效曲线'), 'empty');
        }
        return { changed: false, empty: true };
      }
      const snapshot = window.RealtimeChartModel.snapshotKey(minuteData, quote, minuteMeta);
      const changed = snapshot !== lastRenderedRealtimeSnapshot || code !== lastRenderedRealtimeCode;
      if (changed) {
        renderTimeChart(minuteData);
        renderVolumeChart(minuteData);
        lastRenderedRealtimeCode = code;
        lastRenderedRealtimeSnapshot = snapshot;
      }
      const samplingLabel = window.RealtimeChartModel.describeSampling(minuteData, minuteMeta).label ||
        realtimeResolutionLabel(requestedResolution);
      const volumeCoveredPoints = requestedResolution === '1m' ? 0 : minuteData.filter(function(row) {
        return row && row.volume !== null && row.volume !== undefined &&
          Number.isFinite(Number(row.volume)) && Number(row.volume) >= 0;
      }).length;
      const volumeCoverageLabel = requestedResolution === '1m' ? '' :
        ' · 量能有记录 ' + volumeCoveredPoints + '/' + minuteData.length + ' 点（仅本机连续报价，缺失不补零）';
      setRealtimeStatus(samplingLabel + ' · ' + realtimeSourceLabel(minuteMeta) +
        volumeCoverageLabel +
        (minuteMeta.backfillState === 'loading' ? ' · 后台补取中' : minuteMeta.backfillState === 'failed' ? ' · 补取失败，保留已有记录' : '') +
        (changed ? ' · 曲线已更新' : ' · 数据未变化'), changed ? 'updated' : 'unchanged');
      return { changed };
    }
    setRealtimeStatus(realtimeResolutionLabel(requestedResolution) + ' · 行情不可用', 'error');
    return { changed: false };
    }
    // Minute history alone is sufficient to display the price curve. Order
    // book and locally observed auction rows are independent enhancements.
    paint([], null);
    const [quotes, auctionEnvelope] = await Promise.all([quoteRequest, auctionRequest]);
    return paint(quotes, auctionEnvelope);
  } catch (e) {
    if (controller.signal.aborted || requestId !== realtimeRequestSequence) return { aborted: true };
    console.error('❌ 加载实时数据失败:', e);
    if (!State.currentStock || State.currentStock.code !== code) return { stale: true };
    setRealtimeStatus(realtimeResolutionLabel(requestedResolution) + ' · 刷新失败，保留上次曲线', 'error');
    if (lastRenderedRealtimeCode !== code) {
      renderTimeChart([]);
      renderVolumeChart([]);
      lastRenderedRealtimeCode = '';
      lastRenderedRealtimeSnapshot = '';
    }
    return { error: true };
  } finally {
    if (realtimeRequestController === controller) realtimeRequestController = null;
    if (realtimeLoadPromise === request) {
      realtimeLoadPromise = null;
      realtimeLoadCode = '';
    }
  }
  })();
  realtimeLoadPromise = request;
  return request;
}

function updateStockInfo(quote, minuteData, minuteMeta) {
  const State = window.State;
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
  const buy1Val = quote.minuteAligned ? 0 : parseFloat(quote.buy1Price) || 0;
  const sell1Val = quote.minuteAligned ? 0 : parseFloat(quote.sell1Price) || 0;
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
    dataDate = quote.tradeDate || (minuteMeta && minuteMeta.tradingDate) || '日期未提供';
  }
  const chartTitle = document.getElementById('chartTitle');
  if (chartTitle && State.currentView === 'realtime') {
    const stale = Boolean(minuteMeta && minuteMeta.stale);
    const observed = (Array.isArray(minuteData) ? minuteData : []).filter(function(row) {
      return Number.isFinite(Number(row.price)) && Number(row.price) > 0;
    }).at(-1);
    const unavailable = !observed && (Boolean(minuteMeta && minuteMeta.dataSource === 'unavailable') ||
      quote.quoteStatus === 'unavailable');
    const samplingLabel = window.RealtimeChartModel.describeSampling(minuteData, minuteMeta || {}).label ||
      realtimeResolutionLabel();
    chartTitle.textContent = (quote.name || '未知') + ' (' + quote.code + ') ' + dataDate +
      (unavailable ? ' 行情不可用' : stale ? ' ' + samplingLabel + '（缓存）' : ' ' + samplingLabel);
    const priceInfo = document.getElementById('priceInfo');
    if (priceInfo) priceInfo.innerHTML = (quote.minuteAligned ? '分时对齐价 ' : '最新价 ') + '<span style="color:' + color + ';font-weight:600">' + (price > 0 ? price.toFixed(2) : '—') + '</span> | 涨跌幅 <span style="color:' + color + ';font-weight:600">' + (price > 0 ? (change >= 0 ? '+' : '') + change.toFixed(2) + '%' : '—') + '</span>';
    if (priceInfo && observed && (!(price > 0) || quote.quoteStatus === 'unavailable')) {
      priceInfo.textContent = '已观测价格 ' + Number(observed.price).toFixed(2) + ' · ' + (observed.providerLastAt || observed.time) + ' · 独立报价/盘口暂无数据';
    }
    if (unavailable && priceInfo) {
      priceInfo.innerHTML = '<span class="market-source-warning">暂无分时数据（行情源暂不可用）</span>';
    } else if (stale && priceInfo) {
      const fetchedAt = minuteMeta.fetchedAt && window.WebStockTime
        ? window.WebStockTime.formatDateTime(minuteMeta.fetchedAt) : minuteMeta.fetchedAt || '';
      priceInfo.insertAdjacentHTML('beforeend', ' <span class="market-source-warning">· 缓存数据' +
        (fetchedAt ? '（截至 ' + fetchedAt + '）' : '') + '</span>');
    }
  }
}

function updateOrderBook(quote) {
  const original = quote || {};
  if (original.minuteAligned || original.quoteStatus === 'unavailable') quote = { code: original.code };
  else quote = original;
  const status = document.getElementById('orderBookStatus');
  if (status) {
    const hasDepth = Number(quote.buy1Price) > 0 || Number(quote.sell1Price) > 0;
    status.textContent = (original.code || '') + ' · ' + (original.quoteStatus === 'loading' ? '等待盘口' : !hasDepth ? '五档盘口不可用' : [quote.tradeDate, quote.tradeTime].filter(Boolean).join(' ') || '报价时间未提供') + ' · 数量：手';
  }
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
      buyEl.innerHTML = '<span class="order-level">买' + i + '</span><span class="order-price" style="color:' + buyColor + '">' + (buyPrice > 0 ? buyPrice.toFixed(2) : '-') + '</span>' +
        '<span class="order-vol">' + (buyVol ? (buyVol / 100).toFixed(0) : '-') + '</span>';
    }
    if (document.getElementById('sell' + i)) {
      const sellEl = document.getElementById('sell' + i);
      sellEl.innerHTML = '<span class="order-level">卖' + i + '</span><span class="order-price" style="color:' + sellColor + '">' + (sellPrice > 0 ? sellPrice.toFixed(2) : '-') + '</span>' +
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
  const match = item && item.time ? String(item.time).match(/(\d{2}):(\d{2})(?::(\d{2}))?/) : null;
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]) + Number(match[3] || 0) / 60;
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
  lastChartSamples = minuteData;
  lastChartSampleCode = State.currentStock && State.currentStock.code || '';

  const isDark = document.body.classList.contains('dark');
  const chartTheme = window.ChartTheme.get(isDark);
  const upColor = chartTheme.colors.up;
  const downColor = chartTheme.colors.down;
  const textColor = chartTheme.colors.text;
  const bgColor = chartTheme.colors.background;
  const gridColor = chartTheme.colors.grid;
  const axisColor = chartTheme.colors.axis;

  const sampling = window.RealtimeChartModel.describeSampling(minuteData, State.currentMinuteMeta || {});
  const axis = window.RealtimeChartModel.buildCompressedTradingAxis(minuteData, {
    intervalMinutes: sampling.intervalMinutes || 5,
    intervalSeconds: sampling.intervalSeconds,
    timestampMeaning: sampling.timestampMeaning,
    includeAuction: realtimeAuctionEnabled
  });
  const times = axis.times;
  const viewport = window.RealtimeChartModel.buildFixedTradingViewport();
  const subMinuteSamples = sampling.intervalSeconds < 60;
  const observedPreviousClose = Number(State.currentQuote.prevClose);
  const prevClose = Number.isFinite(observedPreviousClose) && observedPreviousClose > 0 ? observedPreviousClose : 0;
  const minuteSeries = window.RealtimeChartModel.buildMinuteSeries(times, minuteData, {
    cutoffMinutes: realtimeCutoffMinutes(minuteData),
    previousClose: prevClose
  });
  const prices = minuteSeries.prices;
  const avgPrices = minuteSeries.averagePrices;
  const intradayMarkers = window.MarketSignalModel && window.MarketSignalModel.buildIntradayMarkers
    ? window.MarketSignalModel.buildIntradayMarkers(minuteData) : [];
  const intradayMarkPoints = intradayMarkers.filter(function(marker) {
    return times.includes(marker.time) && Number.isFinite(Number(marker.price));
  }).map(function(marker) {
    const color = marker.value === '突' ? '#dc2626' : marker.value === '开' ? '#2563eb' : '#475569';
    return {
      name: marker.label,
      value: marker.value,
      coord: [marker.time, Number(marker.price)],
      triggerUsesFutureData: marker.triggerUsesFutureData,
      detail: marker.detail,
      itemStyle: { color },
      label: { color: '#fff', fontWeight: 700 }
    };
  });

  const validPrices = prices.filter(function(p) { return p !== null && p > 0; });
  if (validPrices.length === 0) {
    const dom = document.getElementById('timeChartContainer');
    if (State.timeChart) State.timeChart.dispose();
    State.timeChart = null;
    dom.innerHTML = '<div class="loading">暂无分时数据</div>';
    return;
  }

  const visibleRange = window.RealtimeChartModel.priceRangePercent(validPrices, prevClose);
  const zeroReference = prevClose > 0 ? prevClose : null;
  const priceDomain = window.RealtimeChartModel.buildReadablePriceDomain(validPrices, prevClose);
  const yMin = priceDomain.min;
  const yMax = priceDomain.max;

  const option = {
    backgroundColor: bgColor,
    title: {
      text: sampling.label + ' · 已记录 ' + sampling.observedPoints + ' 点',
      subtext: realtimeResolution === '1m' ? '' :
        (State.currentMinuteMeta?.dataSource === 'tencent-public-detail' ? '公开秒级明细，按区间结束时间聚合' : '本机已记录报价聚合') +
        '；空白格无源记录，非零成交；竞价价格与匹配量分别展示。',
      left: 10,
      top: 2,
      textStyle: { color: textColor, fontSize: 13, fontWeight: 600 },
      subtextStyle: { color: textColor, fontSize: 11 }
    },
    graphic: visibleRange ? [
      { type: 'text', right: 72, top: 8, style: { text: '高 ' + (visibleRange.highPercent > 0 ? '+' : '') + visibleRange.highPercent.toFixed(2) + '%', fill: upColor, fontSize: 12, fontWeight: 600 } },
      { type: 'text', right: 72, bottom: 38, style: { text: '低 ' + (visibleRange.lowPercent > 0 ? '+' : '') + visibleRange.lowPercent.toFixed(2) + '%', fill: downColor, fontSize: 12, fontWeight: 600 } }
    ] : [],
    grid: { top: realtimeResolution === '1m' ? 58 : 76, right: 68, bottom: 27, left: 58 },
    dataZoom: [{
      type: 'inside',
      start: viewport.start,
      end: viewport.end,
      filterMode: 'none',
      zoomOnMouseWheel: 'ctrl',
      moveOnMouseWheel: false,
      moveOnMouseMove: true
    }],
    xAxis: {
      type: 'category',
      data: times,
      axisLine: { lineStyle: { color: axisColor, width: chartTheme.widths.reference } },
      axisLabel: { color: textColor, fontSize: 12, hideOverlap: true, interval: realtimeAxisTick },
      splitLine: { show: false }
    },
    yAxis: [
      {
        type: 'value',
        min: yMin,
        max: yMax,
        axisLine: { lineStyle: { color: axisColor, width: chartTheme.widths.reference } },
        axisLabel: { color: textColor, fontSize: 12 },
        splitLine: { lineStyle: { color: gridColor, width: chartTheme.widths.grid, type: 'dashed' } },
        axisTick: { show: true },
        splitNumber: 5
      },
      {
        type: 'value',
        show: prevClose > 0,
        min: yMin,
        max: yMax,
        axisLine: { lineStyle: { color: axisColor, width: chartTheme.widths.reference } },
        axisLabel: {
          color: textColor,
          fontSize: 12,
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
        referenceRole: 'zero',
        type: 'line',
        yAxisIndex: 0,
          data: times.map(function() { return zeroReference; }),
        smooth: false,
        symbol: 'none',
        lineStyle: {
          color: chartTheme.colors.reference,
          width: chartTheme.widths.reference,
          type: 'dashed'
        },
        zlevel: 0,
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: {
            color: chartTheme.colors.reference,
            width: chartTheme.widths.reference,
            type: 'dashed'
          },
          data: prevClose > 0 ? [{
              yAxis: zeroReference,
            label: {
              formatter: '昨收 ' + prevClose.toFixed(2),
              position: 'insideEndTop',
              color: textColor,
              backgroundColor: bgColor,
              padding: [1, 3],
              fontSize: 12
            }
          }] : []
        }
      },
      {
        name: '分时价格',
        type: 'line',
        yAxisIndex: 0,
        data: prices,
        smooth: false,
        symbol: subMinuteSamples ? 'circle' : 'none',
        showSymbol: sampling.intervalSeconds < 60,
        symbolSize: 3,
        connectNulls: false,
        markArea: realtimeAuctionEnabled ? { silent:true, itemStyle:{color:'rgba(82,167,255,0.08)'},
          label:{color:textColor,fontSize:10}, data:[
            [{name:'开盘竞价',xAxis:'09:15'},{xAxis:'09:25'}],
            [{name:'收盘竞价',xAxis:'14:57'},{xAxis:'15:00'}]
          ] } : {data:[]},
        lineStyle: { color: upColor, width: chartTheme.widths.main },
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
        markPoint: {
          symbol: 'pin',
          symbolSize: 40,
          data: intradayMarkPoints,
          tooltip: {
            trigger: 'item', showContent: true,
            formatter: function(params) {
              const data = params && params.data || {};
              return '<strong>' + (data.name || data.value || '分时标识') + '</strong><br/>' +
                (data.detail || '透明规则观察标识，不是买卖指令');
            }
          }
        },
        zlevel: 1
      },
      {
        name: '均价',
        type: 'line',
        yAxisIndex: 0,
        data: avgPrices,
        smooth: false,
        symbol: 'none',
        connectNulls: false,
        lineStyle: { color: downColor, width: chartTheme.widths.average, type: 'dashed' }
      }
    ],
    tooltip: {
      trigger: 'axis',
      showContent: true,
      backgroundColor: isDark ? '#1e293b' : '#ffffff',
      borderColor: isDark ? '#475569' : '#e0e0e0',
      textStyle: { color: textColor },
      formatter: function() { return ''; }
    }
  };
  window.ChartTheme.applyToOption(option, { dark: isDark });
  option.series[1].lineStyle.width = chartTheme.widths.main;
  option.series[2].lineStyle.width = chartTheme.widths.average;

  const dom = document.getElementById('timeChartContainer');
  const frameKey = realtimeChartFrameKey(minuteData);
  State.timeChart = window.ChartTheme.renderTo(echarts, dom, State.timeChart, option, frameKey);
  const number = value => value == null ? '--' : Number(value).toFixed(2);
  const rowsByTime = new Map(minuteData.map(row => [window.RealtimeChartModel.timeKey(row.time), row]));
  window.ChartTheme.bindReadout(State.timeChart, {
    labels: times, defaultIndex: prices.findLastIndex(value => value != null),
    left: 58, top: realtimeResolution === '1m' ? 29 : 50, color: textColor,
    textAt(index) {
      const row = rowsByTime.get(times[index]);
      const matched = row && row.auctionMatchedVolume;
      return times[index] + '   价格 ' + number(prices[index]) + '   均价 ' + number(avgPrices[index]) +
        (prices[index] == null ? '   此时间格无记录' : '') +
        (times[index] <= '09:25' || times[index] >= '14:57'
          ? '   竞价匹配量 ' + (matched == null ? '来源未提供' : number(matched)) : '');
    }
  });
  State.timeChart.group = 'terminal-intraday';

  renderMinuteDeals(minuteData);
}

function renderMinuteDeals(minuteData) {
  const State = window.State;
  const dealsList = document.getElementById('dealsList');
  if (!dealsList) return;
  if (!minuteData || minuteData.length === 0) {
    dealsList.innerHTML = '<div class="loading">暂无分时成交数据</div>';
    return;
  }

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
  const chartTheme = window.ChartTheme.get(isDark);
  const upColor = chartTheme.colors.up;
  const downColor = chartTheme.colors.down;
  const textColor = chartTheme.colors.text;
  const bgColor = chartTheme.colors.background;
  const gridColor = chartTheme.colors.grid;
  const axisColor = chartTheme.colors.axis;

  const sampling = window.RealtimeChartModel.describeSampling(minuteData, State.currentMinuteMeta || {});
  const axis = window.RealtimeChartModel.buildCompressedTradingAxis(minuteData, {
    intervalMinutes: sampling.intervalMinutes || 5,
    intervalSeconds: sampling.intervalSeconds,
    timestampMeaning: sampling.timestampMeaning,
    includeAuction: realtimeAuctionEnabled
  });
  const times = axis.times;
  const viewport = window.RealtimeChartModel.buildFixedTradingViewport();
  const volumeColors = [];

  const prevClose = parseFloat(State.currentQuote.prevClose) || parseFloat(State.currentQuote.price) || 0;
  const minuteSeries = window.RealtimeChartModel.buildMinuteSeries(times, minuteData, {
    cutoffMinutes: realtimeCutoffMinutes(minuteData),
    previousClose: prevClose
  });
  const volumes = minuteSeries.volumes;
  let lastPrice = parseFloat(State.currentQuote.prevClose) || parseFloat(State.currentQuote.open) || parseFloat(State.currentQuote.price) || 0;

  const dataMap = {};
  if (Array.isArray(minuteData) && minuteData.length > 0) {
    minuteData.forEach(function(item) {
      const key = window.RealtimeChartModel.timeKey(item && item.time);
      if (key) dataMap[key] = item;
    });
  }

  times.forEach(function(timeStr, index) {
    const dataItem = dataMap[timeStr];
    const price = dataItem ? (parseFloat(dataItem.price) || 0) : 0;
    const volume = volumes[index];
    if (!dataItem || volume == null || volume <= 0) {
      volumeColors.push('rgba(148, 163, 184, 0.45)');
    } else {
      volumeColors.push(price >= lastPrice ? upColor : downColor);
      if (price > 0) lastPrice = price;
    }
  });

  if (volumes.filter(function(v) { return v !== null && v > 0; }).length === 0) {
    const dom = document.getElementById('volumeChartContainer');
    if (State.volumeChart) State.volumeChart.dispose();
    State.volumeChart = null;
    dom.innerHTML = '<div class="loading">暂无成交量数据</div>';
    return;
  }

  const option = {
    backgroundColor: bgColor,
    grid: { top: 22, right: 68, bottom: 34, left: 58 },
    dataZoom: [{
      type: 'inside',
      start: viewport.start,
      end: viewport.end,
      filterMode: 'none',
      zoomOnMouseWheel: 'ctrl',
      moveOnMouseWheel: false,
      moveOnMouseMove: true
    }],
    xAxis: {
      type: 'category',
      data: times,
      axisLine: { lineStyle: { color: axisColor, width: chartTheme.widths.reference } },
      axisLabel: { color: textColor, fontSize: 12, hideOverlap: true, interval: realtimeAxisTick },
      splitLine: { show: false }
    },
    yAxis: {
      type: 'value',
      name: '万手',
      nameGap: 6,
      nameTextStyle: { color: textColor, fontSize: 11 },
      axisLine: { lineStyle: { color: axisColor, width: chartTheme.widths.reference } },
      axisLabel: { color: textColor, fontSize: 12, formatter: window.ChartTheme.formatAxisNumber },
      splitLine: { lineStyle: { color: gridColor, width: chartTheme.widths.grid, type: 'dashed' } }
    },
    series: [
      {
        name: '成交量(万手)',
        type: 'bar',
        data: volumes.map(function(v, i) {
          return { value: v === null ? null : v / 1000000, itemStyle: { color: volumeColors[i], opacity: 0.78 } };
        }),
        barWidth: chartTheme.volumeBarWidth
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
          '成交量: ' + (volumes[idx] == null ? '--' : window.ChartTheme.formatAxisNumber(volumes[idx] / 100) + '手');
      }
    }
  };
  window.ChartTheme.applyToOption(option, { dark: isDark });
  option.series[0].barWidth = sampling.intervalSeconds < 60 ? '68%' : chartTheme.volumeBarWidth;

  const dom = document.getElementById('volumeChartContainer');
  State.volumeChart = window.ChartTheme.renderTo(echarts, dom, State.volumeChart, option, realtimeChartFrameKey(minuteData));
  State.volumeChart.group = 'terminal-intraday';
  if (State.timeChart && typeof echarts.connect === 'function') echarts.connect('terminal-intraday');
}

function realtimeAxisTick(index, value) {
  return index === 0 || /^\d{2}:(00|30)(:00)?$/.test(String(value));
}

function realtimeChartFrameKey(samples) {
  const State = window.State;
  const date = State.currentMinuteMeta && State.currentMinuteMeta.tradingDate ||
    (samples && samples[0] && String(samples[0].time).slice(0, 10)) || '';
  return [State.currentStock && State.currentStock.code, realtimeResolution, date, realtimeAuctionEnabled].join(':');
}

function rerenderTheme() {
  const code = window.State.currentStock && window.State.currentStock.code || '';
  if (!lastChartSamples || code !== lastChartSampleCode) return;
  renderTimeChart(lastChartSamples);
  renderVolumeChart(lastChartSamples);
}

function bindRealtimeResolutionToggle() {
  const toggle = document.getElementById('realtimeResolutionToggle');
  if (!toggle || toggle.dataset.bound === 'true') return;
  toggle.dataset.bound = 'true';
  toggle.addEventListener('click', function(event) {
    const auctionButton = event.target.closest('[data-auction-layer]');
    if (auctionButton) {
      realtimeAuctionEnabled = !realtimeAuctionEnabled;
      invalidateRealtimeLoad();
      lastRenderedRealtimeCode = '';
      lastRenderedRealtimeSnapshot = '';
      updateRealtimeResolutionControls();
      updateRealtimeAuctionStatus(null);
      if (isRealtimeRefreshEligible()) syncRefreshSchedule({ immediate: true });
      return;
    }
    const button = event.target.closest('[data-resolution]');
    if (!button) return;
    setRealtimeResolution(button.getAttribute('data-resolution'));
  });
  updateRealtimeResolutionControls();
}

bindRealtimeResolutionToggle();

document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible') syncRefreshSchedule({ immediate: true });
  else stopRealtimeRefresh({ invalidate: true });
});

window.addEventListener('beforeunload', function() {
  stopRealtimeRefresh({ invalidate: true, silent: true });
});

window.RealtimeChart = {
  beginStockSelection,
  showRealtimeView,
  showKlineView,
  loadRealtimeData,
  updateStockInfo,
  updateOrderBook,
  renderTimeChart,
  renderMinuteDeals,
  formatVolume,
  renderVolumeChart,
  rerenderTheme,
  setRealtimeResolution,
  getRealtimeResolution: function() { return realtimeResolution; },
  getRealtimeAuctionEnabled: function() { return realtimeAuctionEnabled; },
  syncRefreshSchedule,
  stopRealtimeRefresh,
  isRealtimeRefreshEligible
};
