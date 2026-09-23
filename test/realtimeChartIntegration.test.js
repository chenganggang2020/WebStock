const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const chartSource = fs.readFileSync(path.join(root, 'js/modules/realtimeChart.js'), 'utf8');
const klineSource = fs.readFileSync(path.join(root, 'js/modules/klineChart.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const stockListSource = fs.readFileSync(path.join(root, 'js/modules/stockList.js'), 'utf8');

test('realtime chart loads the truthful series model before the runtime module', () => {
  const modelIndex = indexSource.indexOf('js/modules/realtimeChartModel.js');
  const runtimeIndex = indexSource.indexOf('js/modules/realtimeChart.js');

  assert.ok(modelIndex >= 0, 'realtimeChartModel.js must be loaded by index.html');
  assert.ok(modelIndex < runtimeIndex, 'the model must load before realtimeChart.js');
  assert.match(chartSource, /window\.RealtimeChartModel/);
  assert.match(chartSource, /\.buildMinuteSeries\(/);
  assert.doesNotMatch(chartSource, /lastValidPrice/);
});

test('price and average lines preserve gaps without visual smoothing', () => {
  assert.match(chartSource, /name:\s*'分时价格'[\s\S]{0,260}smooth:\s*false[\s\S]{0,180}connectNulls:\s*false/);
  assert.match(chartSource, /name:\s*'均价'[\s\S]{0,260}smooth:\s*false[\s\S]{0,180}connectNulls:\s*false/);
});

test('auto refresh is guarded, recursive, and synchronized with main-view changes', () => {
  assert.match(chartSource, /currentMainView\s*===\s*'market'/);
  assert.match(chartSource, /currentView\s*===\s*'realtime'/);
  assert.match(chartSource, /document\.visibilityState\s*===\s*'visible'/);
  assert.match(chartSource, /\.refreshDelayMs\(/);
  assert.match(chartSource, /realtimeLoadPromise/);
  assert.match(chartSource, /\.snapshotKey\(/);
  assert.doesNotMatch(chartSource, /setInterval\s*\(/);
  assert.match(appSource, /RealtimeChart\.syncRefreshSchedule/);
});

test('chart controls use one minute-day-week-month switch and remove the floating history button', () => {
  const minuteIndex = indexSource.indexOf('data-period="minute"');
  const dayIndex = indexSource.indexOf('data-period="day"');

  assert.ok(minuteIndex >= 0, 'minute period control must exist');
  assert.ok(minuteIndex < dayIndex, 'minute must be the first period control');
  assert.doesNotMatch(indexSource, /id="viewSwitchBtn"|class="view-switch-btn"/);
  assert.match(appSource, /period\s*===\s*'minute'/);
});

test('intraday chart compresses lunch, exposes sampling, and draws a visible zero reference', () => {
  assert.match(chartSource, /buildCompressedTradingAxis/);
  assert.match(chartSource, /describeSampling/);
  assert.match(chartSource, /intervalSeconds:\s*sampling\.intervalSeconds/);
  assert.match(chartSource, /zeroReference/);
  assert.match(chartSource, /午休/);
  assert.match(chartSource, /v\s*\/\s*1000000/);
  assert.match(chartSource, /成交量\(万手\)/);
});

test('intraday price and volume charts share a fixed full-session viewport with readable monitoring styles', () => {
  assert.match(chartSource, /buildFixedTradingViewport/);
  assert.match(chartSource, /dataZoom:\s*\[/);
  assert.match(chartSource, /showSymbol:\s*sampling\.intervalSeconds\s*<\s*60/);
  assert.match(chartSource, /symbolSize:\s*3/);
  assert.match(chartSource, /lineStyle\.width\s*=\s*chartTheme\.widths\.main/);
  assert.match(chartSource, /zoomOnMouseWheel:\s*'ctrl'/);
  assert.match(chartSource, /ChartTheme\.renderTo/);
  assert.match(chartSource, /axisLabel:\s*\{\s*color:\s*textColor,\s*fontSize:\s*12/);
});

test('intraday chart draws truthful open, local breakout and closing-auction markers', () => {
  assert.match(chartSource, /buildIntradayMarkers\(minuteData\)/);
  assert.match(chartSource, /markPoint/);
  assert.match(chartSource, /triggerUsesFutureData/);
});

test('intraday view lets the user choose truthful one-minute or derived thirty-second data', () => {
  assert.match(indexSource, /id="realtimeResolutionToggle"/);
  assert.match(indexSource, /data-resolution="1m"/);
  assert.match(indexSource, /data-resolution="30s"/);
  assert.match(indexSource, /30秒分时/);
  assert.match(chartSource, /resolution=30s/);
  assert.match(chartSource, /local-public-quote-30s/);
  assert.match(chartSource, /tencent-1m/);
  assert.match(chartSource, /eastmoney-1m/);
  assert.doesNotMatch(chartSource, /新浪5分钟自动降级/);
  assert.match(chartSource, /setRealtimeResolution/);
  assert.match(chartSource, /let realtimeResolution = '1m'/);
});

test('intraday view offers an optional locally observed opening-auction layer', () => {
  assert.match(indexSource, /data-auction-layer/);
  assert.match(indexSource, /竞价图层/);
  assert.match(chartSource, /resolution=30s/);
  assert.match(chartSource, /includeAuction/);
  assert.match(chartSource, /auctionCoverage/);
});

test('intraday view offers honest local five-second sampling without relabelling it as exchange ticks', () => {
  assert.match(indexSource, /data-resolution="5s"/);
  assert.match(indexSource, /5秒分时/);
  assert.match(chartSource, /source=public-detail/);
  assert.match(indexSource, /不是交易所逐笔/);
  assert.match(chartSource, /resolution=5s/);
  assert.match(chartSource, /local-public-quote-5s/);
  assert.doesNotMatch(indexSource, /5秒逐笔|Level-2 5秒/);
});

test('mini charts do not fall back to misleading OHLC crosses', () => {
  assert.doesNotMatch(stockListSource, />OHLC</);
  assert.match(stockListSource, /priceRangePercent/);
  assert.match(stockListSource, /5分钟采样|sampling\.label/);
  assert.match(stockListSource, /暂无真实分时|分时样本不足|行情源无分时/);
});

test('visible mini charts lazily prefetch real minute data with bounded concurrency', () => {
  assert.match(stockListSource, /MINUTE_PREFETCH_CONCURRENCY\s*=\s*3/);
  assert.match(stockListSource, /IntersectionObserver/);
  assert.match(stockListSource, /fetchApiEnvelope\('\/api\/minute\?code='/);
  assert.match(stockListSource, /observeMinuteRows\(tbody\)/);
});

test('chart-related sampling labels stay valid UTF-8 Chinese', () => {
  const modelSource = fs.readFileSync(path.join(root, 'js/modules/realtimeChartModel.js'), 'utf8');
  const modelTestSource = fs.readFileSync(path.join(root, 'test/realtimeChartModel.test.js'), 'utf8');
  const combined = modelSource + '\n' + modelTestSource + '\n' + chartSource + '\n' + stockListSource;

  assert.match(combined, /分时价格/);
  assert.match(combined, /均价/);
  assert.match(combined, /午休/);
  assert.match(combined, /5分钟采样/);
  assert.match(combined, /暂无真实分时/);
  assert.match(combined, /分时样本不足/);
  assert.match(combined, /行情源无分时/);
  assert.doesNotMatch(combined, /åˆ†æ—¶|å‡ä»·|åˆä¼‘|åˆ†é’Ÿ/);
});

test('K-line header uses the loaded bar date and close instead of a stale realtime quote', () => {
  assert.match(klineSource, /function renderAvailableKlineHeader/);
  assert.match(klineSource, /latest\.date/);
  assert.match(klineSource, /eastmoney-day/);
  assert.match(klineSource, /K线收盘/);
  assert.match(klineSource, /renderAvailableKlineHeader\(State, data, meta\)/);
});

test('daily chart merges the current minute session, explains its live state and refreshes it automatically', () => {
  assert.match(klineSource, /mergeCurrentDailyBar\(data, minuteRows, minuteMeta\)/);
  assert.match(klineSource, /bindReadout\([\s\S]*textAt\(index\)\s*\{[\s\S]*dailyBarMetrics\(rawData, index\)/);
  assert.match(klineSource, /涨跌额/);
  assert.match(klineSource, /涨跌幅/);
  assert.match(klineSource, /振幅/);
  assert.match(klineSource, /盘中K线/);
  assert.match(chartSource, /function isDailyKlineRefreshEligible/);
  assert.match(chartSource, /KlineChart\.loadKlineData\(code, 'day'\)/);
  assert.match(chartSource, /日线盘中K线/);
});

test('daily view renders transparent metrics, auction cards and local signal rules', () => {
  const modelIndex = indexSource.indexOf('js/modules/marketSignalModel.js');
  const klineIndex = indexSource.indexOf('js/modules/klineChart.js');

  assert.ok(modelIndex >= 0 && modelIndex < klineIndex, 'market signal model must load before K-line runtime');
  assert.match(indexSource, /id="klineInsights"/);
  assert.match(indexSource, /开盘竞价观察/);
  assert.match(indexSource, /尾盘竞价观察/);
  assert.match(indexSource, /上交所集合竞价说明/);
  assert.match(klineSource, /analyzeDaily\(data\)/);
  assert.match(klineSource, /calculateNineTurn\(data, nineTurnContext\)/);
  assert.match(klineSource, /evaluateNineTurnHistory\(data, nineTurnContext\)/);
  assert.match(klineSource, /analyzeAuction\(data, minuteRows, minuteMeta, localRows, localMeta\)/);
  assert.match(klineSource, /detectLocalSignals\(data, minuteRows, minuteMeta\)/);
  assert.match(klineSource, /\/api\/minute\?code=/);
  assert.match(klineSource, /resolution=30s/);
  assert.match(klineSource, /非纯竞价量/);
});
