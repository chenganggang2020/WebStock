const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadSubject() {
  try {
    return require('../js/modules/marketComparison');
  } catch (error) {
    assert.fail('marketComparison view model is not implemented: ' + error.message);
  }
}

test('external K line uses true OHLC order, gaps and source-unit volume',()=>{
  const view=loadSubject();
  const item={name:'纽约原油 CFD',candles:[
    {date:'2026-10-07',open:90,high:94,low:88,close:92,volume:150},
    {date:'2026-10-08',open:93,high:94,low:90,close:null,volume:null}
  ]};
  const option=view.buildGlobalKlineOption(item);
  assert.equal(option.series[0].type,'candlestick');
  assert.deepEqual(option.series[0].data,[[90,92,88,94],['-','-','-','-']]);
  assert.deepEqual(option.series[1].data,[150,null]);
  assert.match(option.series[1].name,/来源原值/);
  assert.match(option.tooltip.formatter([{dataIndex:0}]),/开.*90.*高.*94.*低.*88.*收.*92/);
  assert.match(option.tooltip.formatter([{dataIndex:1}]),/未提供/);
  assert.equal(option.dataZoom[0].type,'inside');
  assert.equal(option.dataZoom[0].filterMode,'filter','price scale follows the visible candle window');
  const withoutVolume=view.buildGlobalKlineOption({candles:[{date:'2026-10-07',open:10,high:12,low:9,close:11,volume:null}]});
  assert.equal(withoutVolume.series.length,1,'an unavailable volume source must not render an all-zero panel');
  assert.equal(withoutVolume.grid.length,1);
});

test('external history must not overwrite current quote price, timestamp or source',()=>{
  const view=loadSubject();
  const quote={key:'nikkei225',status:'available',value:69042.11,changePct:-1.42,observedAt:'2026-10-08 15:00',source:'新浪快照'};
  const history={key:'nikkei225',status:'available',value:70000,changePct:1,observedAt:'2026-10-07',source:'Yahoo Finance',
    candles:[{date:'2026-10-07',open:69000,high:71000,low:68000,close:70000}],fetchedAt:'2026-10-08T15:00:00Z',historyStatus:'cached'};
  const result=view.mergeGlobalSignalHistory([quote],[history])[0];
  assert.equal(result.value,quote.value);
  assert.equal(result.changePct,quote.changePct);
  assert.equal(result.observedAt,quote.observedAt);
  assert.equal(result.source,quote.source);
  assert.equal(result.historySource,history.source);
  assert.equal(result.historyStatus,'cached');
  assert.deepEqual(result.candles,history.candles);
  const missing=view.mergeGlobalSignalHistory([{key:quote.key,status:'unavailable',reason:'quote failed'}],[history])[0];
  assert.equal(missing.value,null,'history close is not a current quote');
  assert.equal(missing.status,'unavailable');
  assert.equal(missing.candles.length,1,'history remains accessible during a quote outage');
});

test('external quotes render before slow history and the clicked dialog uses candles',async()=>{
  const nodes=new Map(['dashboardGlobalSignals','dashboardGlobalDetailOverlay','dashboardGlobalDetailTitle','dashboardGlobalDetailMeta','dashboardGlobalDetailChart','dashboardGlobalDetailSource']
    .map(id=>[id,{innerHTML:'',textContent:'',style:{}}]));
  let resolveHistory,chartOption;
  const historyPromise=new Promise(resolve=>{resolveHistory=resolve;});
  const browser={document:{getElementById:id=>nodes.get(id)||null},
    ApiClient:{fetchJsonData:async url=>url.includes('global-index-trends')?historyPromise:
      {items:[{key:'gold-future',name:'纽约黄金 CFD',value:4150,status:'available',observedAt:'2026-10-08 23:00'}]}},
    echarts:{init:()=>({setOption:option=>{chartOption=option;},resize(){},dispose(){}})}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'js/modules/marketComparison.js'),'utf8'),{window:browser});
  const loading=browser.MarketComparison.loadGlobalSignals();
  try {
    await settleHeatmapDrillTasks(1);
    assert.match(nodes.get('dashboardGlobalSignals').innerHTML,/4150.00/,'history latency must not hide ready quotes');
    resolveHistory({items:[{key:'gold-future',source:'新浪公开行情 · 日 K',status:'available',validCandleCount:1,volumeStatus:'unavailable',
      candles:[{date:'2026-10-08',open:4136,high:4166,low:4128,close:4148,volume:null}],trend:[{date:'2026-10-08',close:4148}]}]});
    await loading;
    browser.MarketComparison.openGlobalSignalDetail('gold-future');
    assert.equal(chartOption.series[0].type,'candlestick');
    assert.deepEqual(Array.from(chartOption.series[0].data[0]),[4136,4148,4128,4166]);
    assert.match(nodes.get('dashboardGlobalDetailMeta').textContent,/4150.00/);
    assert.match(nodes.get('dashboardGlobalDetailSource').textContent,/成交量.*未提供/);
  } finally {resolveHistory({items:[]});await loading;}
});

test('external quote refresh preserves the current K-line zoom window',()=>{
  const nodes=new Map(['dashboardGlobalSignals','dashboardGlobalDetailOverlay','dashboardGlobalDetailTitle','dashboardGlobalDetailMeta','dashboardGlobalDetailChart','dashboardGlobalDetailSource']
    .map(id=>[id,{innerHTML:'',textContent:'',style:{}}]));
  let chartOption;
  const chart={setOption:option=>{chartOption=option;},getOption:()=>chartOption,resize(){},dispose(){}};
  const browser={document:{getElementById:id=>nodes.get(id)||null},echarts:{init:()=>chart},ChartTheme:require('../js/modules/chartTheme')};
  vm.runInNewContext(fs.readFileSync(path.join(root,'js/modules/marketComparison.js'),'utf8'),{window:browser});
  const item={key:'gold-future',name:'黄金 CFD',value:4150,status:'available',candles:[{date:'2026-10-08',open:4136,high:4166,low:4128,close:4148,volume:null}]};
  browser.MarketComparison.renderGlobalSignals({items:[item]});
  browser.MarketComparison.openGlobalSignalDetail(item.key);
  chartOption.dataZoom.forEach(zoom=>{zoom.start=10;zoom.end=50;});
  browser.MarketComparison.renderGlobalSignals({items:[{...item,value:4151}]});
  assert.equal(chartOption.dataZoom[0].start,10);
  assert.equal(chartOption.dataZoom[0].end,50);
});

test('homepage exposes index comparison, correlation and sector heatmap containers', () => {
  const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(source, /id="dashboardIndexComparisonChart"/);
  assert.match(source, /id="dashboardIndexCorrelation"/);
  assert.match(source, /id="dashboardGlobalSignals"/);
  assert.match(source, /data-index-window="20"/);
  assert.match(source, /data-index-window="60"/);
  assert.match(source, /data-index-window="120"/);
  assert.match(source, /id="dashboardMarketHeatmap"/);
  assert.match(source, /data-heatmap-mode="turnover"/);
  assert.match(source, /data-heatmap-mode="flow"/);
  assert.match(source, /data-heatmap-density="focus"/);
  assert.match(source, /data-heatmap-density="all"/);
  assert.match(source, /data-index-period="intraday"/);
  assert.match(source, /data-index-period="daily"/);
  assert.match(source, /id="dashboardComparisonPickerButton"/);
  assert.match(source, /id="dashboardComparisonSearch"/);
  assert.match(source, /id="dashboardComparisonOptions"/);
  assert.match(source, /id="dashboardComparisonSelection"/);
  assert.match(source, /data-comparison-kind="region"[^>]*>地域</);
  assert.match(source, /data-comparison-kind="style"[^>]*>风格/);
  assert.match(source, /id="dashboardIndexDetailOverlay"/);
  assert.match(source, /id="dashboardIndexDetailChart"/);
  assert.match(source, /id="dashboardGlobalDetailOverlay"/);
  assert.match(source, /id="dashboardGlobalDetailChart"/);
  assert.match(source, /data-index-detail-period="intraday"/);
  assert.match(source, /data-index-detail-period="daily"/);
});

test('correlation area is readable and places cross-market watch signals before the matrix', () => {
  const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/styles.css'), 'utf8');
  const signalIndex = source.indexOf('id="dashboardGlobalSignals"');
  const matrixIndex = source.indexOf('id="dashboardIndexCorrelation"');

  assert.ok(signalIndex > 0 && signalIndex < matrixIndex);
  assert.match(css, /\.dashboard-index-correlation td\s*\{[^}]*height:\s*58px/s);
  assert.match(css, /\.dashboard-index-correlation th\s*\{[^}]*font-size:\s*12px/s);
  assert.match(css, /\.dashboard-index-correlation td b\s*\{[^}]*font-size:\s*15px/s);
  assert.match(css, /\.dashboard-global-signals\s*\{[^}]*grid-template-columns:/s);
});

test('global signal display marks USD CNH as inverse for A-share interpretation', () => {
  const { globalSignalDisplay } = loadSubject();
  const display = globalSignalDisplay({ key: 'usd-cnh', value: 7.1, changePct: 0.3, inverseForAShares: true });

  assert.equal(display.value, '7.1000');
  assert.equal(display.change, '+0.30%');
  assert.equal(display.direction, 'risk-off');
});

test('cross-market cards open a sourced detail and distinguish quote-only history', () => {
  const nodes = new Map(['dashboardGlobalSignals','dashboardGlobalDetailOverlay','dashboardGlobalDetailTitle','dashboardGlobalDetailMeta','dashboardGlobalDetailChart','dashboardGlobalDetailSource'].map(id => [id,{innerHTML:'',textContent:'',style:{}}]));
  const browser = {document:{getElementById:id=>nodes.get(id)||null}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'js/modules/marketComparison.js'),'utf8'),{window:browser});
  const view = browser.MarketComparison;
  view.renderGlobalSignals({items:[{key:'sp500-future',name:'标普500期货 CFD',status:'available',value:5900,changePct:0.2,source:'新浪公开快照',observedAt:'2026-10-08 21:00'}]});
  assert.match(nodes.get('dashboardGlobalSignals').innerHTML,/data-global-signal-key="sp500-future"[^>]*role="button"[^>]*tabindex="0"/);
  view.openGlobalSignalDetail('sp500-future');
  assert.equal(nodes.get('dashboardGlobalDetailOverlay').style.display,'grid');
  assert.match(nodes.get('dashboardGlobalDetailTitle').textContent,/标普500期货 CFD/);
  assert.match(nodes.get('dashboardGlobalDetailChart').innerHTML,/暂无可核验历史/);
  assert.match(nodes.get('dashboardGlobalDetailSource').textContent,/新浪公开快照/);
});

test('cross-market index detail plots only observed daily points and preserves source', () => {
  const nodes = new Map(['dashboardGlobalSignals','dashboardGlobalDetailOverlay','dashboardGlobalDetailTitle','dashboardGlobalDetailMeta','dashboardGlobalDetailChart','dashboardGlobalDetailSource','dashboardGlobalDetailLink'].map(id => [id,{innerHTML:'',textContent:'',style:{},hidden:true}]));
  let chartOption;
  const browser = {document:{getElementById:id=>nodes.get(id)||null},echarts:{init:()=>({setOption:option=>{chartOption=option;},resize(){},dispose(){}})}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'js/modules/marketComparison.js'),'utf8'),{window:browser});
  const view = browser.MarketComparison;
  view.renderGlobalSignals({items:[{key:'nikkei225',name:'日经225',status:'available',value:69000,changePct:-1,
    source:'Yahoo Finance · 日线',sourceUrl:'https://finance.yahoo.com/quote/%5EN225/history/',
    trend:[{date:'2026-10-06',close:70000},{date:'2026-10-07',close:null},{date:'2026-10-08',close:69000}]}]});
  view.openGlobalSignalDetail('nikkei225');
  assert.deepEqual(Array.from(chartOption.series[0].data),[70000,null,69000]);
  assert.equal(chartOption.series[0].connectNulls,false);
  assert.match(nodes.get('dashboardGlobalDetailSource').textContent,/Yahoo Finance.*3 个日期/);
  assert.equal(nodes.get('dashboardGlobalDetailLink').hidden,false);
  view.closeGlobalSignalDetail();
  assert.equal(nodes.get('dashboardGlobalDetailOverlay').style.display,'none');
});

test('available cross-market quotes without a provider timestamp stay labeled honestly', () => {
  const source = fs.readFileSync(path.join(root, 'js/modules/marketComparison.js'), 'utf8');
  assert.match(source, /来源未提供更新时间/);
  assert.match(source, /available\s*\?\s*'来源未提供更新时间'\s*:\s*\(item\.reason/);
});

test('comparison picker uses large readable controls for fast watchlist selection', () => {
  const css = fs.readFileSync(path.join(root, 'css/styles.css'), 'utf8');
  assert.match(css, /\.dashboard-comparison-picker\s*\{[^}]*width:\s*min\(1120px/s);
  assert.match(css, /#dashboardComparisonPickerButton\s*\{[^}]*font-size:\s*14px/s);
  assert.match(css, /\.dashboard-comparison-option\s*\{[^}]*min-height:\s*46px/s);
  assert.match(css, /\.dashboard-comparison-option span\s*\{[^}]*font-size:\s*14px/s);
  assert.match(css, /\.dashboard-comparison-option input\s*\{[^}]*width:\s*18px/s);
});

test('homepage heatmap exposes industry, concept and region taxonomies with an explicit today period', () => {
  const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/styles.css'), 'utf8');

  assert.match(source, /data-heatmap-board-type="industry"/);
  assert.match(source, /data-heatmap-board-type="concept"/);
  assert.match(source, /data-heatmap-board-type="region"/);
  assert.match(source, /data-heatmap-period="day"[^>]*>\s*\u4eca\u65e5\s*</);
  assert.match(source, /id="dashboardHeatmapBreadcrumb"/);
  assert.match(source, /id="dashboardHeatmapConstituentSummary"/);
  assert.match(source, /data-heatmap-density="all"[^>]*>\s*全部·横向滑动\s*</);
  assert.doesNotMatch(source, /全部·横向拖动/);
  assert.match(source, /class="active"[^>]*data-heatmap-board-type="concept"|data-heatmap-board-type="concept"[^>]*class="active"/);
  assert.match(source, /class="active"[^>]*data-heatmap-density="focus"|data-heatmap-density="focus"[^>]*class="active"/);
  assert.match(css, /\.dashboard-market-heatmap-scroll\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(source, /data-heatmap-density="focus"[^>]*>\s*核心80\s*</);
  assert.match(css, /dashboard-market-heatmap-wrap\s*\{[^}]*min-width:\s*3000px/s);
  assert.match(css, /data-density="all"[^}]*\.dashboard-market-heatmap\s*\{[^}]*width:\s*9000px/s);
  assert.match(css, /data-density="drill"[^}]*\.dashboard-market-heatmap\s*\{[^}]*width:\s*5000px/s);
  assert.match(css, /\.dashboard-heatmap-constituents\s*\{[^}]*max-height:\s*320px/s);
});

test('heatmap canvas widens with very large constituent groups instead of shrinking every stock cell', () => {
  const { heatmapCanvasWidth } = loadSubject();

  assert.equal(heatmapCanvasWidth(80, 'focus'), 3000);
  assert.equal(heatmapCanvasWidth(357, 'all'), 9000);
  assert.equal(heatmapCanvasWidth(135, 'drill'), 5000);
  assert.equal(heatmapCanvasWidth(812, 'drill'), 11368);
  assert.equal(heatmapCanvasWidth(2000, 'drill'), 14000);
});

test('homepage defaults to concept hotspots and schedules board refreshes while the market is live', () => {
  const subject = loadSubject();
  assert.equal(subject.getHeatmapBoardType(), 'concept');
  assert.deepEqual(subject.heatmapRefreshPlan(true), { delayMs: 60000, force: true });
  const closed = subject.heatmapRefreshPlan(false);
  assert.equal(closed.force, false);
  assert.ok(closed.delayMs >= 5 * 60 * 1000);
});

test('index detail chart supports a large intraday line and daily candlesticks', () => {
  const { buildIndexDetailOption } = loadSubject();
  const intraday = buildIndexDetailOption({
    period: 'intraday',
    name: '上证指数',
    history: {
      previousClose: 3900,
      points: [
        { time: '2026-08-28 09:30:00', price: 3901, volume: 100 },
        { time: '2026-08-28 09:31:00', price: 3902, volume: 120 }
      ]
    }
  });
  assert.equal(intraday.series[0].type, 'line');
  assert.equal(intraday.series[0].markLine.data[0].yAxis, 3900);
  assert.deepEqual(intraday.series[0].data.slice(0, 2), [3901, 3902]);
  assert.equal(intraday.series[0].data.length, 242);
  assert.equal(intraday.series[0].data[121], null);

  const daily = buildIndexDetailOption({
    period: 'daily',
    name: '上证指数',
    history: {
      points: [
        { date: '2026-08-27', open: 3900, close: 3910, low: 3890, high: 3920, volume: 1000 },
        { date: '2026-08-28', open: 3910, close: 3920, low: 3905, high: 3930, volume: 1200 }
      ]
    }
  });
  assert.equal(daily.series[0].type, 'candlestick');
  assert.deepEqual(daily.series[0].data[0], [3900, 3910, 3890, 3920]);
  assert.equal(daily.series[1].type, 'bar');
});

test('comparison selection keeps order, removes duplicates and enforces the two-to-eight boundary', () => {
  const { normalizeSelectedKeys } = loadSubject();
  const allowed = new Set(['index:sse', 'sector-index:bank', 'index:star50']);
  assert.deepEqual(normalizeSelectedKeys(
    ['sector-index:bank', 'index:sse', 'sector-index:bank'], allowed
  ), ['sector-index:bank', 'index:sse']);
  assert.throws(() => normalizeSelectedKeys(['index:sse'], allowed), /至少选择 2/);
  assert.throws(() => normalizeSelectedKeys(Array.from({ length: 9 }, (_, index) => 'k:' + index)), /最多选择 8/);
});

test('default comparison selection uses the broad Shenzhen index rather than CSI 300', () => {
  const { getSelectedKeys } = loadSubject();
  assert.deepEqual(getSelectedKeys(), [
    'index:sse', 'index:szse', 'index:chinext', 'index:star50'
  ]);
});

test('catalog reconciliation preserves dynamic selections while partial and persists removals only after a complete catalog', () => {
  const { reconcileCatalogSelection } = loadSubject();
  const current = ['index:sse', 'eastmoney-industry:BK0475', 'index:chinext'];
  const partial = reconcileCatalogSelection(current, {
    status: 'partial',
    items: [{ key: 'index:sse' }, { key: 'index:chinext' }]
  });
  assert.deepEqual(partial, { keys: current, changed: false });

  const complete = reconcileCatalogSelection(current, {
    status: 'available',
    items: [{ key: 'index:sse' }, { key: 'index:chinext' }, { key: 'index:star50' }]
  });
  assert.deepEqual(complete, {
    keys: ['index:sse', 'index:chinext'],
    changed: true
  });
});

test('index card quote always prefers an available intraday row regardless of chart period', () => {
  const { indexCardDisplayQuote } = loadSubject();
  const snapshotQuote = { price: 3000, changePct: -0.5 };
  const intradayRow = { status: 'available', latestPrice: 3123.45, changePct: 1.25 };
  assert.deepEqual(indexCardDisplayQuote(snapshotQuote, intradayRow, 'intraday'), {
    price: 3123.45,
    changePct: 1.25
  });
  assert.deepEqual(indexCardDisplayQuote(snapshotQuote, intradayRow, 'daily'), {
    price: 3123.45,
    changePct: 1.25
  });
  assert.deepEqual(indexCardDisplayQuote(snapshotQuote, { status: 'unavailable' }, 'daily'), {
    price: 3000,
    changePct: -0.5
  });
});

test('intraday index card status includes the latest observed minute', () => {
  const { indexCardIntradayStatus } = loadSubject();
  assert.equal(indexCardIntradayStatus({
    status: 'available',
    marketState: 'live',
    tradingDate: '2026-08-29',
    points: [
      { time: '2026-08-29 09:30:00', price: 100 },
      { time: '2026-08-29 10:07:00', price: 101 }
    ]
  }), '盘中分时 08-29 · 截至 10:07');
});

test('intraday refresh uses forced 15-second polling only while live', () => {
  const { intradayRefreshPlan } = loadSubject();
  assert.deepEqual(intradayRefreshPlan(true), { delayMs: 15000, force: true });
  const closed = intradayRefreshPlan(false);
  assert.equal(closed.force, false);
  assert.ok(closed.delayMs >= 5 * 60 * 1000);

  const source = fs.readFileSync(path.join(root, 'js', 'modules', 'marketComparison.js'), 'utf8');
  const scheduler = source.slice(
    source.indexOf('function scheduleIntradayRefresh'),
    source.indexOf('async function loadActivePeriod')
  );
  assert.match(scheduler, /intradayRefreshPlan\(live\)/);
  assert.match(scheduler, /loadActivePeriod\(\{\s*force:\s*refreshPlan\.force\s*\}\)/);
});

test('visual history signatures ignore fetchedAt-only changes', () => {
  const { historySnapshotSignature } = loadSubject();
  const payload = {
    mode: 'intraday',
    requestedKeys: ['index:sse', 'index:szse'],
    status: 'available',
    series: [
      { key: 'index:sse', status: 'available' },
      { key: 'index:szse', status: 'available' }
    ],
    comparison: { labels: ['09:30'], series: [{ key: 'index:sse', values: [100] }] },
    correlation: { keys: ['index:sse'], values: [[1]], sampleCounts: [[1]] }
  };
  assert.equal(
    historySnapshotSignature(Object.assign({ fetchedAt: '2026-08-29T01:30:00.000Z' }, payload)),
    historySnapshotSignature(Object.assign({ fetchedAt: '2026-08-29T01:30:15.000Z' }, payload))
  );
});

test('comparison and index intraday loaders let render signatures decide whether data changed', () => {
  const source = fs.readFileSync(path.join(root, 'js', 'modules', 'marketComparison.js'), 'utf8');
  const comparisonLoader = source.slice(
    source.indexOf('async function loadComparisonData'),
    source.indexOf('async function loadIndexIntraday')
  );
  const intradayLoader = source.slice(
    source.indexOf('async function loadIndexIntraday'),
    source.indexOf('function activeDashboardVisible')
  );
  assert.doesNotMatch(comparisonLoader, /historyRenderSignature\s*=\s*['"]['"]/);
  assert.doesNotMatch(intradayLoader, /indexCardsSignature\s*=\s*['"]['"]/);
});

test('a partial comparison catalog preserves prior dynamic sector selections', () => {
  const { reconcileSelectionWithCatalog } = loadSubject();
  const selected = ['eastmoney-industry:BK0475', 'index:star50'];
  const partial = {
    status: 'partial',
    items: [{ key: 'index:star50', name: '科创50' }]
  };
  assert.deepEqual(reconcileSelectionWithCatalog(selected, partial), selected);
});

test('intraday index cards prefer the latest minute quote over the initial homepage snapshot', () => {
  const { indexCardDisplayQuote } = loadSubject();
  assert.deepEqual(indexCardDisplayQuote(
    { price: 3900, changePct: -0.5 },
    { status: 'available', latestPrice: 3952.18, changePct: -0.11 },
    'intraday'
  ), { price: 3952.18, changePct: -0.11 });
});

test('Shanghai intraday mini chart uses a weighted white line and the public unweighted yellow line', () => {
  const { buildMiniIntradayOption } = loadSubject();
  const option = buildMiniIntradayOption([
    { time: '2026-08-28 09:30:00', price: 100, equalWeightPrice: 100.4 },
    { time: '2026-08-28 09:31:00', price: 101, equalWeightPrice: 101.7 }
  ], { previousClose: 100, changePct: 1 });
  assert.equal(option.series[0].type, 'line');
  assert.equal(option.series[0].name, '白线·加权指数');
  assert.deepEqual(option.series[0].data.slice(0, 2), [100, 101]);
  assert.equal(option.series[1].name, '黄线·不加权领先');
  assert.deepEqual(option.series[1].data.slice(0, 2), [100.4, 101.7]);
  assert.equal(option.xAxis.data.length, 242);
  assert.equal(option.series[0].data[121], null);
  assert.equal(option.series[0].markLine.data[0].yAxis, 100);
  assert.equal(option.series[0].lineStyle.color, '#f8fafc');
  assert.equal(option.series[1].lineStyle.color, '#f6c445');
  assert.notEqual(option.series[0].markLine.lineStyle.color, '#f6c445');
  assert.equal(option.backgroundColor, '#0b1020');
});

test('intraday index charts keep a full compressed trading-day axis and leave future minutes blank', () => {
  const { buildFullTradingMinuteAxis, alignIntradayValues, buildIntradayComparisonOption } = loadSubject();
  const axis = buildFullTradingMinuteAxis();

  assert.equal(axis.length, 242);
  assert.equal(axis[0], '09:30');
  assert.equal(axis[120], '11:30');
  assert.equal(axis[121], '13:00');
  assert.equal(axis[axis.length - 1], '15:00');
  assert.equal(axis.includes('12:00'), false);

  const values = alignIntradayValues(
    ['2026-09-02 09:30:00', '09:31', '2026-09-02T11:30:00+08:00'],
    [100, 101, 103],
    axis
  );
  assert.equal(values[0], 100);
  assert.equal(values[1], 101);
  assert.equal(values[120], 103);
  assert.equal(values[121], null);
  assert.equal(values[values.length - 1], null);

  const comparison = buildIntradayComparisonOption({
    basis: 'previous-close-100',
    labels: ['09:30', '09:31', '11:30'],
    series: [{ key: 'index:sse', name: '上证指数', values: [100, 99.8, 99.1] }]
  });
  assert.equal(comparison.xAxis.data[121], '13:00');
  assert.equal(comparison.xAxis.data[241], '15:00');
  assert.equal(comparison.series[0].data[120], 99.1);
  assert.equal(comparison.series[0].data[121], null);
  assert.equal(comparison.series[0].data[241], null);
});

test('Shanghai index detail keeps the true yellow-white lines above volume', () => {
  const { buildIndexDetailOption } = loadSubject();
  const option = buildIndexDetailOption({
    period: 'intraday',
    name: '上证指数',
    history: {
      previousClose: 100,
      points: [
        { time: '2026-08-28 09:30:00', price: 100, equalWeightPrice: 100.4, volume: 10 },
        { time: '2026-08-28 09:31:00', price: 101, equalWeightPrice: 101.7, volume: 12 }
      ]
    }
  });

  assert.deepEqual(option.series.slice(0, 2).map(function(series) { return series.name; }), [
    '白线·加权指数', '黄线·不加权领先'
  ]);
  assert.deepEqual(option.series[1].data.slice(0, 2), [100.4, 101.7]);
  assert.equal(option.xAxis[0].data[121], '13:00');
  assert.equal(option.series[1].data[121], null);
  assert.equal(option.series[2].name, '成交量');
});

test('theme control switches the whole UI between clarity light and terminal dark styles', () => {
  const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const appSource = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'css', 'styles.css'), 'utf8');

  assert.match(indexSource, /id="themeToggle"[^>]*aria-pressed/);
  assert.match(indexSource, /data-theme-label/);
  assert.match(appSource, /webstock-ui-style/);
  assert.match(appSource, /dataset\.uiStyle/);
  assert.match(appSource, /MarketComparison\.rerenderTheme/);
  assert.match(styles, /body\[data-ui-style="terminal"\]/);
  assert.match(styles, /body\[data-ui-style="clarity"\]/);
});

test('dashboard copy describes verified yellow-white lines for every supported index without an SSE-only claim', () => {
  const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(indexSource, /白线=加权指数/);
  assert.match(indexSource, /黄线=不加权领先指标/);
  assert.match(indexSource, /灰虚线=昨收基准/);
  assert.match(indexSource, /对应指数的公开领先字段可用时显示黄白线/);
  assert.doesNotMatch(indexSource, /黄线仅用于上证分时/);
  assert.doesNotMatch(indexSource, /白线：上证加权指数/);
  assert.doesNotMatch(indexSource, /黄虚线=昨收基准/);
});

test('flat intraday mini chart keeps the restrained dark terminal treatment', () => {
  const { buildMiniIntradayOption } = loadSubject();
  const option = buildMiniIntradayOption([{ time: '2026-08-28 09:30:00', price: 100 }], { changePct: 0 });
  assert.equal(option.series[0].lineStyle.color, '#f8fafc');
  assert.equal(option.series[0].areaStyle.color, 'rgba(73,79,223,0.18)');
});

test('comparison request URL preserves selected order and encodes stable namespaced keys', () => {
  const { comparisonRequestUrl } = loadSubject();
  assert.equal(
    comparisonRequestUrl('daily', 60, ['sector-index:bank', 'index:star50']),
    '/api/market/comparison-history?window=60&keys=sector-index%3Abank%2Cindex%3Astar50'
  );
  assert.equal(
    comparisonRequestUrl('intraday', 60, ['sector-index:bank', 'index:star50']),
    '/api/market/comparison-intraday?keys=sector-index%3Abank%2Cindex%3Astar50'
  );
});

test('index comparison option plots normalized base-100 lines rather than raw index points', () => {
  const { buildComparisonOption } = loadSubject();
  const option = buildComparisonOption({
    dates: ['2026-08-01', '2026-08-02'],
    series: [
      { key: 'sse', name: '上证指数', values: [100, 102.5] },
      { key: 'chinext', name: '创业板指', values: [100, 97.5] }
    ]
  });

  assert.deepEqual(option.xAxis.data, ['2026-08-01', '2026-08-02']);
  assert.deepEqual(option.series.map(item => item.data), [[100, 102.5], [100, 97.5]]);
  assert.match(option.yAxis.name, /起点=100/);
  assert.deepEqual(option.dataZoom.map(item => item.type), ['inside', 'slider']);
  assert.equal(option.dataZoom[0].xAxisIndex, 0);
  assert.ok(option.grid.bottom >= 52, 'the horizontal slider must not cover date labels');
  assert.deepEqual(option.color.slice(0, 4), ['#494fdf', '#f6c445', '#a78bfa', '#e23b4a']);
  assert.equal(option.legend.textStyle.fontSize, 12);
  assert.equal(option.series[0].lineStyle.width, 2.4);
  const styles = fs.readFileSync(path.join(root, 'css', 'styles.css'), 'utf8');
  assert.match(styles, /\.dashboard-index-comparison-chart\s*\{[^}]*height:\s*420px/s);
});

test('homepage and index detail expose intraday daily weekly and yearly periods', () => {
  const subject = loadSubject();
  const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  ['intraday', 'daily', 'weekly', 'yearly'].forEach(function(period) {
    assert.match(indexSource, new RegExp('data-index-period="' + period + '"'));
    assert.match(indexSource, new RegExp('data-index-detail-period="' + period + '"'));
  });
  assert.match(subject.comparisonRequestUrl('weekly', 60, ['index:sse', 'index:star50']), /period=weekly/);
  assert.match(subject.comparisonRequestUrl('yearly', 60, ['index:sse', 'index:star50']), /period=yearly/);
});

test('mini index chart uses actual OHLC candles when the provider supplies them', () => {
  const { buildMiniIndexOption } = loadSubject();
  const option = buildMiniIndexOption([
    { date: '2026-08-01', open: 10, close: 11, low: 9, high: 12 },
    { date: '2026-08-02', open: 11, close: 10, low: 9.5, high: 11.5 }
  ]);

  assert.equal(option.series[0].type, 'candlestick');
  assert.deepEqual(option.series[0].data, [[10, 11, 9, 12], [11, 10, 9.5, 11.5]]);
  assert.equal(option.series[0].itemStyle.color, '#f23645');
  assert.equal(option.series[0].itemStyle.color0, '#00a87b');
});

test('correlation cells retain numeric values and sample counts and do not infer causality', () => {
  const { correlationCells } = loadSubject();
  const cells = correlationCells({
    keys: ['sse', 'chinext'],
    values: [[1, 0.8123], [0.8123, 1]],
    sampleCounts: [[59, 57], [57, 59]]
  }, [
    { key: 'sse', name: '上证指数' },
    { key: 'chinext', name: '创业板指' }
  ]);

  assert.equal(cells[1].value, 0.8123);
  assert.equal(cells[1].sampleCount, 57);
  assert.equal(cells[1].label, '0.81');
});

test('correlation cells label unavailable values as sample insufficient', () => {
  const { correlationCells } = loadSubject();
  const cells = correlationCells({
    keys: ['sse'], values: [[null]], sampleCounts: [[12]]
  }, [{ key: 'sse', name: '上证指数' }]);

  assert.equal(cells[0].value, null);
  assert.equal(cells[0].label, '样本不足');
  const styles = fs.readFileSync(path.join(root, 'css/styles.css'), 'utf8');
  assert.match(styles, /td\.correlation-missing\s*\{[^}]*color:/s);
  assert.match(styles, /\.dashboard-segmented\[hidden\]\s*\{\s*display:\s*none/);
});

test('a homepage index-history snapshot never substitutes for the active comparison request', () => {
  const modulePath = require.resolve('../js/modules/marketComparison');
  const previousWindow = global.window;
  let setOptionCalls = 0;
  const elements = new Map();
  ['dashboardIndexComparisonChart', 'dashboardIndexCorrelation', 'dashboardIndexHistoryStatus'].forEach(function(id) {
    elements.set(id, {
      innerHTML: '', textContent: '', dataset: {},
      setAttribute: function() {}
    });
  });
  const fakeWindow = {
    document: {
      getElementById: function(id) { return elements.get(id) || null; },
      querySelectorAll: function() { return []; },
      addEventListener: function() {}
    },
    echarts: {
      init: function() {
        return {
          setOption: function() { setOptionCalls += 1; },
          isDisposed: function() { return false; },
          dispose: function() {}
        };
      }
    }
  };
  const staleFixedIndices = {
    mode: 'daily', window: 60, status: 'available',
    series: [{ key: 'sse', name: '上证指数', status: 'available' }],
    comparison: {
      dates: ['2026-08-28', '2026-08-29'],
      series: [{ key: 'sse', name: '上证指数', values: [100, 101] }]
    },
    correlation: { keys: ['sse'], values: [[1]], sampleCounts: [[2]] }
  };

  try {
    delete require.cache[modulePath];
    global.window = fakeWindow;
    const api = require(modulePath);
    api.render({ indexHistory: staleFixedIndices });

    assert.equal(setOptionCalls, 0);
    assert.match(elements.get('dashboardIndexComparisonChart').innerHTML, /加载|不可用/);
  } finally {
    delete require.cache[modulePath];
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});

test('an explicit 20-day choice survives a stale 60-day dashboard render while its comparison response is pending', async () => {
  const modulePath = require.resolve('../js/modules/marketComparison');
  const previousWindow = global.window;
  let resolveComparison20;
  let latestComparisonOption = null;
  const windowButtons = [20, 60, 120].map(function(value) {
    return {
      value,
      active: false,
      pressed: 'false',
      getAttribute: function(name) { return name === 'data-index-window' ? String(value) : null; },
      setAttribute: function(name, next) { if (name === 'aria-pressed') this.pressed = next; },
      classList: { toggle: function(_name, active) { this.owner.active = active; } }
    };
  });
  windowButtons.forEach(function(button) { button.classList.owner = button; });
  const chartElement = {
    innerHTML: '',
    setAttribute: function() {}
  };
  const status = { textContent: '', dataset: {} };
  const fakeWindow = {
    localStorage: { getItem(key) { return key === 'webstock.marketComparison.period.v3' ? 'daily' : null; }, setItem() {} },
    document: {
      getElementById: function(id) {
        if (id === 'dashboardIndexComparisonChart') return chartElement;
        if (id === 'dashboardIndexHistoryStatus') return status;
        return null;
      },
      querySelectorAll: function(selector) { return selector === '[data-index-window]' ? windowButtons : []; },
      addEventListener: function() {}
    },
    ApiClient: {
      fetchJsonData: function(url) {
        if (url === '/api/market/index-history?window=20') {
          return Promise.resolve({ window: 20, status: 'available', series: [] });
        }
        if (url.includes('/api/market/comparison-history?window=20')) {
          return new Promise(function(resolve) { resolveComparison20 = resolve; });
        }
        throw new Error('unexpected URL ' + url);
      }
    },
    echarts: {
      init: function() {
        return {
          setOption: function(option) { latestComparisonOption = option; },
          isDisposed: function() { return false; },
          dispose: function() {}
        };
      }
    }
  };

  try {
    delete require.cache[modulePath];
    global.window = fakeWindow;
    const api = require(modulePath);
    await api.loadWindow(20);
    const pending20 = api.loadActivePeriod({ force: true });
    api.render({ indexHistory: { window: 60, status: 'available', series: [] } });
    resolveComparison20({
      mode: 'daily', window: 20, status: 'available',
      requestedKeys: api.getSelectedKeys(),
      series: api.getSelectedKeys().map(function(key) { return { key, name: key, status: 'available' }; }),
      comparison: {
        dates: ['2026-08-28', '2026-08-29'],
        series: [{ key: 'index:sse', name: '上证指数', values: [100, 105] }]
      },
      correlation: { keys: ['index:sse'], values: [[1]], sampleCounts: [[2]] }
    });
    await pending20;

    assert.equal(api.getSelectedWindow(), 20);
    assert.equal(windowButtons[0].active, true);
    assert.equal(windowButtons[0].pressed, 'true');
    assert.deepEqual(latestComparisonOption.series[0].data, [100, 105]);
  } finally {
    delete require.cache[modulePath];
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});

test('a comparison response is ignored when the selected daily window changed after request start', async () => {
  const modulePath = require.resolve('../js/modules/marketComparison');
  const previousWindow = global.window;
  let resolveComparison60;
  const fakeWindow = {
    localStorage: { getItem(key) { return key === 'webstock.marketComparison.period.v3' ? 'daily' : null; }, setItem() {} },
    document: {
      getElementById: function() { return null; },
      querySelectorAll: function() { return []; },
      addEventListener: function() {}
    },
    ApiClient: {
      fetchJsonData: function(url) {
        if (url.includes('/api/market/comparison-history?window=60')) {
          return new Promise(function(resolve) { resolveComparison60 = resolve; });
        }
        if (url === '/api/market/index-history?window=120') {
          return Promise.resolve({ window: 120, status: 'available', series: [] });
        }
        throw new Error('unexpected URL ' + url);
      }
    }
  };

  try {
    delete require.cache[modulePath];
    global.window = fakeWindow;
    const api = require(modulePath);
    const oldRequest = api.loadActivePeriod({ force: true });
    await api.loadWindow(120);
    resolveComparison60({
      mode: 'daily', window: 60, status: 'available',
      requestedKeys: api.getSelectedKeys(), series: [], comparison: { dates: [], series: [] }
    });
    assert.equal(await oldRequest, null);
    assert.equal(api.getSelectedWindow(), 120);
  } finally {
    delete require.cache[modulePath];
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});

test('a complete catalog immediately persists a reconciled stored selection', async () => {
  const modulePath = require.resolve('../js/modules/marketComparison');
  const previousWindow = global.window;
  const stored = new Map([
    ['webstock.marketComparison.selection.v1', JSON.stringify([
      'index:sse', 'eastmoney-industry:missing', 'index:chinext'
    ])],
    ['webstock.marketComparison.period.v3', 'daily']
  ]);
  const writes = [];
  const fakeWindow = {
    document: {
      getElementById: function() { return null; },
      querySelectorAll: function() { return []; },
      addEventListener: function() {}
    },
    localStorage: {
      getItem: function(key) { return stored.has(key) ? stored.get(key) : null; },
      setItem: function(key, value) { writes.push([key, value]); stored.set(key, value); }
    },
    ApiClient: {
      fetchJsonData: async function(url) {
        if (url === '/api/market/comparison-catalog') {
          return {
            status: 'available',
            items: [{ key: 'index:sse' }, { key: 'index:chinext' }, { key: 'index:star50' }]
          };
        }
        if (url.includes('/api/market/comparison-history')) {
          const keys = new URL(url, 'http://localhost').searchParams.get('keys').split(',');
          return { mode: 'daily', window: 60, status: 'unavailable', requestedKeys: keys, series: [] };
        }
        throw new Error('unexpected URL ' + url);
      }
    },
    console: { warn: function() {} }
  };

  try {
    delete require.cache[modulePath];
    global.window = fakeWindow;
    const api = require(modulePath);
    api.bind();
    await new Promise(function(resolve) { setImmediate(resolve); });
    await new Promise(function(resolve) { setImmediate(resolve); });

    assert.ok(writes.some(function(entry) {
      return entry[0] === 'webstock.marketComparison.selection.v1' &&
        entry[1] === JSON.stringify(['index:sse', 'index:chinext']);
    }));
  } finally {
    delete require.cache[modulePath];
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});

test('fallback to the legacy narrow catalog is marked partial and preserves a stored dynamic board selection', async () => {
  const modulePath = require.resolve('../js/modules/marketComparison');
  const previousWindow = global.window;
  const originalSelection = ['index:sse', 'eastmoney-region:BK0101', 'index:chinext'];
  const stored = new Map([
    ['webstock.marketComparison.selection.v1', JSON.stringify(originalSelection)],
    ['webstock.marketComparison.period.v3', 'daily']
  ]);
  const writes = [];
  const status = { textContent: '', dataset: {} };
  const fakeWindow = {
    document: {
      getElementById: function(id) {
        if (id === 'dashboardComparisonSelectionStatus') return status;
        return null;
      },
      querySelectorAll: function() { return []; },
      addEventListener: function() {},
      hidden: false
    },
    localStorage: {
      getItem: function(key) { return stored.has(key) ? stored.get(key) : null; },
      setItem: function(key, value) { writes.push([key, value]); stored.set(key, value); }
    },
    ApiClient: {
      fetchJsonData: async function(url) {
        if (url === '/api/market/comparison-catalog') throw new Error('planned full catalog outage');
        if (url === '/api/market/boards/catalog') {
          return {
            status: 'available',
            items: [{ key: 'index:sse' }, { key: 'index:chinext' }]
          };
        }
        if (url.startsWith('/api/market/boards/snapshot')) throw new Error('planned snapshot outage');
        if (url.includes('/api/market/comparison-history')) {
          return {
            mode: 'daily', window: 60, status: 'partial', requestedKeys: originalSelection,
            series: [], comparison: { dates: [], series: [] }, correlation: { keys: [], values: [] }
          };
        }
        throw new Error('unexpected URL ' + url);
      }
    },
    console: { warn: function() {} }
  };

  try {
    delete require.cache[modulePath];
    global.window = fakeWindow;
    const api = require(modulePath);
    api.bind();
    for (let index = 0; index < 5; index += 1) {
      await new Promise(function(resolve) { setImmediate(resolve); });
    }

    assert.deepEqual(api.getSelectedKeys(), originalSelection);
    assert.equal(writes.some(function(entry) {
      return entry[0] === 'webstock.marketComparison.selection.v1' && entry[1] !== JSON.stringify(originalSelection);
    }), false);
    assert.match(status.textContent, /部分可用/);
  } finally {
    delete require.cache[modulePath];
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});

test('comparison picker shows an escaped data type and public provider for every catalog item', async () => {
  const modulePath = require.resolve('../js/modules/marketComparison');
  const previousWindow = global.window;
  const optionsBox = { innerHTML: '' };
  const search = { value: '', addEventListener: function() {} };
  const defaultKeys = ['index:sse', 'index:szse', 'index:chinext', 'index:star50'];
  const catalogItems = defaultKeys.map(function(key) {
    return { key, kind: 'index', name: key, provider: 'sina-index', capabilities: { daily: true, intraday: true } };
  }).concat([{
    key: 'sector-index:bank', kind: 'sector-index', name: '中证银行',
    provider: 'sina-index', providerLabel: '新浪公开指数 <script>alert(1)</script>',
    capabilities: { daily: true, intraday: true }
  }]);
  const fakeWindow = {
    document: {
      getElementById: function(id) {
        if (id === 'dashboardComparisonOptions') return optionsBox;
        if (id === 'dashboardComparisonSearch') return search;
        return null;
      },
      querySelectorAll: function() { return []; },
      addEventListener: function() {}
    },
    localStorage: {
      getItem: function(key) {
        if (key === 'webstock.marketComparison.selection.v1') return JSON.stringify(defaultKeys);
        if (key === 'webstock.marketComparison.period.v3') return 'daily';
        return null;
      },
      setItem: function() {}
    },
    ApiClient: {
      fetchJsonData: async function(url) {
        if (url === '/api/market/comparison-catalog') return { status: 'available', items: catalogItems };
        if (url.includes('/api/market/comparison-history')) {
          return { mode: 'daily', window: 60, status: 'unavailable', requestedKeys: defaultKeys, series: [] };
        }
        throw new Error('unexpected URL ' + url);
      }
    },
    console: { warn: function() {} }
  };

  try {
    delete require.cache[modulePath];
    global.window = fakeWindow;
    const api = require(modulePath);
    api.bind();
    await new Promise(function(resolve) { setImmediate(resolve); });
    await new Promise(function(resolve) { setImmediate(resolve); });

    assert.match(optionsBox.innerHTML, /指数 · 来源 sina-index/);
    assert.match(optionsBox.innerHTML, /板块指数 · 来源 新浪公开指数 &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(optionsBox.innerHTML, /<script>/);
  } finally {
    delete require.cache[modulePath];
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});

test('a comparison request failure replaces loading placeholders with an explicit unavailable state', async () => {
  const modulePath = require.resolve('../js/modules/marketComparison');
  const previousWindow = global.window;
  const chart = { innerHTML: '' };
  const correlation = { innerHTML: '' };
  const status = { textContent: '', dataset: {} };
  const fakeWindow = {
    document: {
      getElementById: function(id) {
        if (id === 'dashboardIndexComparisonChart') return chart;
        if (id === 'dashboardIndexCorrelation') return correlation;
        if (id === 'dashboardIndexHistoryStatus') return status;
        return null;
      },
      querySelectorAll: function() { return []; },
      addEventListener: function() {}
    },
    ApiClient: {
      fetchJsonData: async function() { throw new Error('公开行情源 <网络断开>'); }
    }
  };

  try {
    delete require.cache[modulePath];
    global.window = fakeWindow;
    const api = require(modulePath);
    api.render({});
    assert.match(chart.innerHTML, /正在加载/);

    await assert.rejects(api.loadActivePeriod({ force: true }), /网络断开/);
    assert.match(chart.innerHTML, /失败|不可用/);
    assert.match(correlation.innerHTML, /失败|不可用/);
    assert.doesNotMatch(chart.innerHTML + correlation.innerHTML, /正在加载/);
    assert.doesNotMatch(chart.innerHTML + correlation.innerHTML, /<网络断开>/);
    assert.equal(status.dataset.state, 'unavailable');
  } finally {
    delete require.cache[modulePath];
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});

test('initial bind does not duplicate an in-flight comparison request when catalog reconciliation keeps the same keys', async () => {
  const modulePath = require.resolve('../js/modules/marketComparison');
  const previousWindow = global.window;
  const defaultKeys = ['index:sse', 'index:szse', 'index:chinext', 'index:star50'];
  let comparisonRequests = 0;
  const pending = [];
  const fakeWindow = {
    document: {
      getElementById: function() { return null; },
      querySelectorAll: function() { return []; },
      addEventListener: function() {}
    },
    localStorage: {
      getItem: function(key) {
        if (key === 'webstock.marketComparison.selection.v1') return JSON.stringify(defaultKeys);
        if (key === 'webstock.marketComparison.period.v3') return 'daily';
        return null;
      },
      setItem: function() {}
    },
    ApiClient: {
      fetchJsonData: function(url) {
        if (url === '/api/market/comparison-catalog') {
          return Promise.resolve({
            status: 'available',
            items: defaultKeys.map(function(key) { return { key, kind: 'index' }; })
          });
        }
        if (url.includes('/api/market/comparison-history')) {
          comparisonRequests += 1;
          return new Promise(function(resolve) { pending.push(resolve); });
        }
        throw new Error('unexpected URL ' + url);
      }
    },
    console: { warn: function() {} }
  };

  try {
    delete require.cache[modulePath];
    global.window = fakeWindow;
    const api = require(modulePath);
    api.bind();
    await new Promise(function(resolve) { setImmediate(resolve); });
    await new Promise(function(resolve) { setImmediate(resolve); });

    assert.equal(comparisonRequests, 1);
    pending.forEach(function(resolve) {
      resolve({ mode: 'daily', window: 60, status: 'unavailable', requestedKeys: defaultKeys, series: [] });
    });
    await new Promise(function(resolve) { setImmediate(resolve); });
  } finally {
    delete require.cache[modulePath];
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});

test('a slower old window response cannot replace the latest selection', async () => {
  const modulePath = require.resolve('../js/modules/marketComparison');
  const previousWindow = global.window;
  const pending = new Map();
  const applied = [];
  const status = { textContent: '', dataset: {} };
  const fakeWindow = {
    localStorage: { getItem(key) { return key === 'webstock.marketComparison.period.v3' ? 'daily' : null; }, setItem() {} },
    document: {
      getElementById: function(id) { return id === 'dashboardIndexHistoryStatus' ? status : null; },
      querySelectorAll: function() { return []; },
      addEventListener: function() {}
    },
    ApiClient: {
      fetchJsonData: function(url) {
        const requested = Number(new URL(url, 'http://localhost').searchParams.get('window'));
        return new Promise(function(resolve) { pending.set(requested, resolve); });
      }
    },
    MarketOverview: { setIndexHistory: function(data) { applied.push(data.window); } },
    console: { warn: function() {} }
  };

  try {
    delete require.cache[modulePath];
    global.window = fakeWindow;
    const api = require(modulePath);
    const older = api.loadWindow(20);
    const latest = api.loadWindow(120);
    pending.get(120)({ window: 120, status: 'available', series: [], comparison: { dates: [], series: [] } });
    await latest;
    pending.get(20)({ window: 20, status: 'available', series: [], comparison: { dates: [], series: [] } });
    assert.equal(await older, null);
    assert.equal(api.getSelectedWindow(), 120);
    assert.deepEqual(applied, [120]);
  } finally {
    delete require.cache[modulePath];
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});

test('repeated dashboard renders do not extend an expired history cache', async () => {
  const modulePath = require.resolve('../js/modules/marketComparison');
  const previousWindow = global.window;
  const originalNow = Date.now;
  let now = 1000;
  let requests = 0;
  const fakeWindow = {
    document: {
      getElementById: function() { return null; },
      querySelectorAll: function() { return []; },
      addEventListener: function() {}
    },
    ApiClient: {
      fetchJsonData: async function() {
        requests += 1;
        return { window: 20, fetchedAt: '2026-08-29T13:00:00.000Z', status: 'available' };
      }
    }
  };

  try {
    delete require.cache[modulePath];
    global.window = fakeWindow;
    Date.now = function() { return now; };
    const api = require(modulePath);
    const initial = { window: 20, fetchedAt: '2026-08-29T12:00:00.000Z', status: 'partial' };
    api.render({ indexHistory: initial });
    now += 4 * 60 * 1000;
    api.render({ indexHistory: Object.assign({}, initial) });
    now += 2 * 60 * 1000;

    await api.loadWindow(20);
    assert.equal(requests, 1);
  } finally {
    Date.now = originalNow;
    delete require.cache[modulePath];
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});

test('identical cockpit snapshots do not redraw the active comparison, heatmap or correlation table', async () => {
  const modulePath = require.resolve('../js/modules/marketComparison');
  const previousWindow = global.window;
  let setOptionCalls = 0;
  const elements = new Map();
  ['dashboardIndexComparisonChart', 'dashboardIndexCorrelation', 'dashboardIndexHistoryStatus',
    'dashboardMarketHeatmap', 'dashboardMarketHeatmapLegend'].forEach(function(id) {
    elements.set(id, { innerHTML: '', textContent: '', dataset: {} });
  });
  const fakeWindow = {
    localStorage: { getItem(key) { return key === 'webstock.marketComparison.period.v3' ? 'daily' : null; }, setItem() {} },
    document: {
      getElementById: function(id) { return elements.get(id) || null; },
      querySelectorAll: function() { return []; },
      addEventListener: function() {}
    },
    ApiClient: {
      fetchJsonData: async function(url) {
        if (!url.includes('/api/market/comparison-history?window=60')) throw new Error('unexpected URL ' + url);
        const requestedKeys = ['index:sse', 'index:szse', 'index:chinext', 'index:star50'];
        return {
          mode: 'daily', window: 60, status: 'available', requestedKeys,
          fetchedAt: '2026-08-29T13:00:00.000Z',
          series: requestedKeys.map(function(key) { return { key, name: key, status: 'available', availableDays: 60 }; }),
          comparison: {
            dates: ['2026-08-28', '2026-08-29'],
            series: [{ key: 'index:sse', name: '上证指数', values: [100, 101] }]
          },
          correlation: { keys: ['index:sse'], values: [[1]], sampleCounts: [[60]] },
          source: { label: '测试源' }
        };
      }
    },
    echarts: {
      init: function() {
        return {
          setOption: function() { setOptionCalls += 1; },
          isDisposed: function() { return false; },
          dispose: function() {}
        };
      }
    },
    MarketHeatmapModel: {
      buildTreemapModel: function() {
        return { availability: 'available', mode: 'turnover', nodes: [
          { name: '电子', areaValue: 100, colorValue: 2, amount: 100 }
        ] };
      }
    }
  };
  const history = {
    window: 60,
    status: 'available',
    fetchedAt: '2026-08-29T13:00:00.000Z',
    series: [{ key: 'sse', name: '上证指数', status: 'available', availableDays: 60 }],
    comparison: { dates: ['2026-08-28', '2026-08-29'], series: [{ key: 'sse', name: '上证指数', values: [100, 101] }] },
    correlation: { keys: ['sse'], values: [[1]], sampleCounts: [[60]] },
    source: { label: '测试源' }
  };
  const hot = {
    marketStatus: 'available',
    boards: { day: [{ code: 'bk1', name: '电子', kind: 'industry', amount: 100, dailyChangePct: 2, mainNetInflow: null }] }
  };

  try {
    delete require.cache[modulePath];
    global.window = fakeWindow;
    const api = require(modulePath);
    await api.loadActivePeriod({ force: true });
    api.render({ indexHistory: history, hot: hot });
    const firstCalls = setOptionCalls;
    const firstCorrelation = elements.get('dashboardIndexCorrelation').innerHTML;
    api.render({ indexHistory: Object.assign({}, history), hot: JSON.parse(JSON.stringify(hot)) });

    assert.equal(firstCalls, 2);
    assert.equal(setOptionCalls, firstCalls);
    assert.equal(elements.get('dashboardIndexCorrelation').innerHTML, firstCorrelation);
  } finally {
    delete require.cache[modulePath];
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});

test('comparison picker loads the complete market-board catalog and exposes matches beyond the first 100 rows', async () => {
  const modulePath = require.resolve('../js/modules/marketComparison');
  const previousWindow = global.window;
  const requests = [];
  const optionsBox = { innerHTML: '' };
  const search = { value: '', addEventListener: function() {}, focus: function() {} };
  const status = { textContent: '', dataset: {} };
  const defaultKeys = ['index:sse', 'index:szse', 'index:chinext', 'index:star50'];
  const catalogItems = defaultKeys.map(function(key, index) {
    return {
      key,
      code: String(index),
      name: '指数' + (index + 1),
      taxonomy: 'index',
      provider: 'sina-index',
      capabilities: { daily: true, intraday: true }
    };
  }).concat(Array.from({ length: 121 }, function(_, index) {
    return {
      key: 'eastmoney-industry:BK' + String(index + 1).padStart(4, '0'),
      code: 'BK' + String(index + 1).padStart(4, '0'),
      name: '完整行业' + (index + 1),
      taxonomy: 'industry',
      provider: 'eastmoney-public-board',
      capabilities: { daily: true, intraday: false }
    };
  }));
  const fakeWindow = {
    document: {
      getElementById: function(id) {
        if (id === 'dashboardComparisonOptions') return optionsBox;
        if (id === 'dashboardComparisonSearch') return search;
        if (id === 'dashboardComparisonSelectionStatus') return status;
        return null;
      },
      querySelectorAll: function() { return []; },
      addEventListener: function() {}
    },
    localStorage: {
      getItem: function(key) {
        if (key === 'webstock.marketComparison.selection.v1') return JSON.stringify(defaultKeys);
        if (key === 'webstock.marketComparison.period.v3') return 'daily';
        return null;
      },
      setItem: function() {}
    },
    ApiClient: {
      fetchJsonData: async function(url) {
        requests.push(url);
        if (url.startsWith('/api/market/comparison-catalog')) {
          return { status: 'available', taxonomy: 'mixed', items: catalogItems };
        }
        if (url.includes('/api/market/comparison-history')) {
          return {
            mode: 'daily', window: 60, status: 'unavailable', requestedKeys: defaultKeys,
            series: [], comparison: { dates: [], series: [] }, correlation: { keys: [], values: [] }
          };
        }
        throw new Error('unexpected URL ' + url);
      }
    },
    console: { warn: function() {} }
  };

  try {
    delete require.cache[modulePath];
    global.window = fakeWindow;
    const api = require(modulePath);
    api.bind();
    for (let index = 0; index < 5; index += 1) {
      await new Promise(function(resolve) { setImmediate(resolve); });
    }

    assert.ok(requests.some(function(url) { return url.startsWith('/api/market/comparison-catalog'); }));
    assert.equal(requests.some(function(url) { return url.startsWith('/api/market/boards/catalog'); }), false);
    assert.match(optionsBox.innerHTML, /完整行业121/);
    assert.doesNotMatch(optionsBox.innerHTML, /请继续输入关键词缩小范围/);
    assert.match(status.textContent, /匹配\s*125\s*项/);
  } finally {
    delete require.cache[modulePath];
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});

function createPeriodCapabilityHarness(period, unsupportedKey) {
  const modulePath = require.resolve('../js/modules/marketComparison');
  const optionsBox = { innerHTML: '' };
  const selectionBox = { innerHTML: '' };
  const search = { value: '', addEventListener: function() {}, focus: function() {} };
  const status = { textContent: '', dataset: {} };
  const documentHandlers = { click: [], change: [], keydown: [] };
  const selected = ['index:dual-a', 'index:dual-b', unsupportedKey];
  const catalogItems = [
    { key: 'index:dual-a', name: '双周期甲', taxonomy: 'index', provider: 'test', capabilities: { daily: true, intraday: true } },
    { key: 'index:dual-b', name: '双周期乙', taxonomy: 'index', provider: 'test', capabilities: { daily: true, intraday: true } },
    { key: 'industry:daily-only', name: '仅日线行业', taxonomy: 'industry', provider: 'test', capabilities: { daily: true, intraday: false } },
    { key: 'concept:intraday-only', name: '仅分时概念', taxonomy: 'concept', provider: 'test', capabilities: { daily: false, intraday: true } }
  ];
  const requests = [];
  const fakeWindow = {
    document: {
      hidden: false,
      getElementById: function(id) {
        if (id === 'dashboardComparisonOptions') return optionsBox;
        if (id === 'dashboardComparisonSearch') return search;
        if (id === 'dashboardComparisonSelectionStatus') return status;
        if (id === 'dashboardComparisonSelection') return selectionBox;
        return null;
      },
      querySelectorAll: function() { return []; },
      addEventListener: function(type, handler) {
        if (documentHandlers[type]) documentHandlers[type].push(handler);
      }
    },
    localStorage: {
      getItem: function(key) {
        if (key === 'webstock.marketComparison.selection.v1') return JSON.stringify(selected);
        if (key === 'webstock.marketComparison.period.v3') return period;
        return null;
      },
      setItem: function() {}
    },
    ApiClient: {
      fetchJsonData: async function(url) {
        requests.push(url);
        if (url.startsWith('/api/market/boards/catalog')) {
          return { status: 'available', taxonomy: 'mixed', items: catalogItems };
        }
        if (url.startsWith('/api/market/boards/snapshot')) {
          return { status: 'unavailable', taxonomy: 'industry', coverageComplete: false, items: [] };
        }
        if (url.includes('/api/market/comparison-history')) {
          const keys = new URL(url, 'http://localhost').searchParams.get('keys').split(',');
          return { mode: 'daily', window: 60, status: 'unavailable', requestedKeys: keys, series: [] };
        }
        if (url.includes('/api/market/comparison-intraday')) {
          const keys = new URL(url, 'http://localhost').searchParams.get('keys').split(',');
          return { mode: 'intraday', status: 'unavailable', requestedKeys: keys, series: [] };
        }
        throw new Error('unexpected URL ' + url);
      }
    },
    console: { warn: function() {} }
  };
  return { modulePath, fakeWindow, optionsBox, selectionBox, status, documentHandlers, requests };
}

async function verifyUnsupportedSelectionCannotApply(period, unsupportedKey, expectedTitle, expectedLabel) {
  const previousWindow = global.window;
  const harness = createPeriodCapabilityHarness(period, unsupportedKey);
  try {
    delete require.cache[harness.modulePath];
    global.window = harness.fakeWindow;
    const api = require(harness.modulePath);
    api.bind();
    for (let index = 0; index < 6; index += 1) {
      await new Promise(function(resolve) { setImmediate(resolve); });
    }

    const escapedKey = unsupportedKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(harness.optionsBox.innerHTML, new RegExp('data-comparison-key="' + escapedKey + '"[^>]*checked[^>]*disabled'));
    assert.match(harness.optionsBox.innerHTML, new RegExp('title="' + expectedTitle + '"'));
    assert.match(harness.optionsBox.innerHTML, new RegExp(expectedLabel));
    assert.match(harness.selectionBox.innerHTML, new RegExp(period === 'daily' ? '不支持日线' : '不支持分时'));

    const applyButton = {
      getAttribute: function(name) { return name === 'data-comparison-action' ? 'apply' : null; }
    };
    const event = {
      target: {
        closest: function(selector) { return selector === '[data-comparison-action]' ? applyButton : null; }
      }
    };
    harness.documentHandlers.click.forEach(function(handler) { handler(event); });
    await new Promise(function(resolve) { setImmediate(resolve); });

    assert.deepEqual(api.getSelectedKeys(), ['index:dual-a', 'index:dual-b']);
    assert.equal(api.getSelectedKeys().includes(unsupportedKey), false);
  } finally {
    delete require.cache[harness.modulePath];
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
}

test('daily comparison disables even preselected intraday-only objects and excludes them on apply', async () => {
  await verifyUnsupportedSelectionCannotApply(
    'daily', 'concept:intraday-only', '请切换到分时后选择', '仅分时 · 当前日线不可用'
  );
});

test('intraday comparison disables even preselected daily-only objects and excludes them on apply', async () => {
  await verifyUnsupportedSelectionCannotApply(
    'intraday', 'industry:daily-only', '请切换到日线后选择', '仅日线 · 当前分时不可用'
  );
});

test('default concept heatmap focuses the largest 80 boards and groups them by rise and fall', async () => {
  const modulePath = require.resolve('../js/modules/marketComparison');
  const previousWindow = global.window;
  const requests = [];
  const heatmap = { innerHTML: '' };
  const legend = { textContent: '', dataset: {} };
  let heatmapOption = null;
  const defaultKeys = ['index:sse', 'index:szse', 'index:chinext', 'index:star50'];
  const boardItems = Array.from({ length: 125 }, function(_, index) {
    return {
      key: 'eastmoney-concept:BK' + String(index + 1).padStart(4, '0'),
      code: 'BK' + String(index + 1).padStart(4, '0'),
      name: '全量概念' + (index + 1),
      taxonomy: 'concept',
      kind: 'concept',
      status: 'available',
      amount: 100000000 + index,
      changePct: index % 2 ? -1.2 : 2.3,
      mainNetInflow: index % 2 ? -3000000 : 5000000
    };
  });
  const fakeWindow = {
    document: {
      getElementById: function(id) {
        if (id === 'dashboardMarketHeatmap') return heatmap;
        if (id === 'dashboardMarketHeatmapLegend') return legend;
        return null;
      },
      querySelectorAll: function() { return []; },
      addEventListener: function() {},
      hidden: false
    },
    localStorage: {
      getItem: function(key) {
        if (key === 'webstock.marketComparison.selection.v1') return JSON.stringify(defaultKeys);
        if (key === 'webstock.marketComparison.period.v3') return 'daily';
        return null;
      },
      setItem: function() {}
    },
    ApiClient: {
      fetchJsonData: async function(url) {
        requests.push(url);
        if (url.startsWith('/api/market/boards/catalog')) {
          return {
            status: 'available',
            items: defaultKeys.map(function(key) {
              return { key, name: key, taxonomy: 'index', capabilities: { daily: true, intraday: true } };
            })
          };
        }
        if (url.startsWith('/api/market/boards/snapshot')) {
          return { status: 'available', taxonomy: 'concept', coverageComplete: true, items: boardItems };
        }
        if (url.includes('/api/market/comparison-history')) {
          return {
            mode: 'daily', window: 60, status: 'unavailable', requestedKeys: defaultKeys,
            series: [], comparison: { dates: [], series: [] }, correlation: { keys: [], values: [] }
          };
        }
        throw new Error('unexpected URL ' + url);
      }
    },
    echarts: {
      init: function() {
        return {
          setOption: function(option) { heatmapOption = option; },
          isDisposed: function() { return false; },
          dispose: function() {},
          on: function() {},
          off: function() {}
        };
      }
    },
    MarketHeatmapModel: require('../js/modules/marketHeatmapModel'),
    console: { warn: function() {} }
  };

  try {
    delete require.cache[modulePath];
    global.window = fakeWindow;
    const api = require(modulePath);
    api.bind();
    for (let index = 0; index < 5; index += 1) {
      await new Promise(function(resolve) { setImmediate(resolve); });
    }

    const snapshotRequest = requests.find(function(url) {
      return url.startsWith('/api/market/boards/snapshot');
    });
    assert.ok(snapshotRequest);
    assert.equal(new URL(snapshotRequest, 'http://localhost').searchParams.get('taxonomy'), 'concept');
    assert.ok(heatmapOption);
    const groups = heatmapOption.series[0].data;
    const cells = groups.flatMap(function(item) { return item.children || []; });
    assert.deepEqual(groups.map(function(item) { return item.direction; }).sort(), ['down', 'up']);
    assert.equal(cells.length, 80);
    assert.equal(cells.some(function(item) { return item.name === '全量概念125'; }), true);
    assert.equal(cells.some(function(item) { return item.name === '全量概念1'; }), false);
    assert.equal(heatmapOption.series[0].roam, false);
    assert.equal(heatmapOption.series[0].left, 0);
    assert.equal(heatmapOption.series[0].right, 0);
    assert.equal(heatmapOption.series[0].top, 0);
    assert.equal(heatmapOption.series[0].bottom, 0);
    assert.equal(heatmapOption.series[0].upperLabel.show, true);
    assert.equal(heatmapOption.series[0].label.formatter({ data: {} }), '');
    assert.equal(heatmapOption.series[0].label.formatter({ data: groups[0] }), groups[0].name);
    assert.match(heatmapOption.series[0].label.formatter({ data: cells[0] }), /成交额/);
    assert.match(heatmapOption.series[0].label.formatter({ data: cells[0] }), /主力/);
    assert.match(legend.textContent, /核心 80/);
  } finally {
    delete require.cache[modulePath];
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});

test('same-value heatmap refresh updates provenance and partial state without redrawing ECharts', async () => {
  const modulePath = require.resolve('../js/modules/marketComparison');
  const previousWindow = global.window;
  const heatmap = { innerHTML: '' };
  const legend = { textContent: '', dataset: {} };
  let setOptionCalls = 0;
  let snapshotIndex = 0;
  const boards = [{
    code: 'BK0816', name: '人工智能', taxonomy: 'concept', kind: 'concept', status: 'available',
    amount: 900000000, changePct: 2.5, mainNetInflow: 80000000
  }];
  const snapshots = [
    { status: 'available', taxonomy: 'concept', provider: 'source-a', fetchedAt: '2026-08-30T01:00:00.000Z', coverageComplete: true, items: boards },
    { status: 'partial', taxonomy: 'concept', provider: 'source-b', fetchedAt: '2026-08-30T01:01:00.000Z', coverageComplete: true, reason: '部分分类等待更新', items: boards },
    { status: 'available', taxonomy: 'concept', provider: 'source-c', fetchedAt: '2026-08-30T01:02:00.000Z', stale: true, coverageComplete: true, reason: '使用最后成功缓存', items: boards },
    { status: 'available', taxonomy: 'concept', provider: 'source-d', fetchedAt: '2026-08-30T01:03:00.000Z', stale: false, coverageComplete: false, reason: '仅返回 46/48', items: boards }
  ];
  const defaultKeys = ['index:sse', 'index:szse', 'index:chinext', 'index:star50'];
  const fakeWindow = {
    document: {
      hidden: false,
      getElementById: function(id) {
        if (id === 'dashboardMarketHeatmap') return heatmap;
        if (id === 'dashboardMarketHeatmapLegend') return legend;
        return null;
      },
      querySelectorAll: function() { return []; },
      addEventListener: function() {}
    },
    localStorage: {
      getItem: function(key) {
        if (key === 'webstock.marketComparison.selection.v1') return JSON.stringify(defaultKeys);
        if (key === 'webstock.marketComparison.period.v3') return 'daily';
        return null;
      },
      setItem: function() {}
    },
    ApiClient: {
      fetchJsonData: async function(url) {
        if (url.startsWith('/api/market/boards/catalog')) {
          return { status: 'available', items: defaultKeys.map(function(key) {
            return { key, name: key, taxonomy: 'index', capabilities: { daily: true, intraday: true } };
          }) };
        }
        if (url.startsWith('/api/market/boards/snapshot')) {
          const response = snapshots[Math.min(snapshotIndex, snapshots.length - 1)];
          snapshotIndex += 1;
          return response;
        }
        if (url.includes('/api/market/comparison-history')) {
          return { mode: 'daily', window: 60, status: 'unavailable', requestedKeys: defaultKeys, series: [] };
        }
        throw new Error('unexpected URL ' + url);
      }
    },
    echarts: {
      init: function() {
        return {
          setOption: function() { setOptionCalls += 1; },
          isDisposed: function() { return false; },
          dispose: function() {},
          on: function() {},
          off: function() {}
        };
      }
    },
    MarketHeatmapModel: require('../js/modules/marketHeatmapModel'),
    console: { warn: function() {} }
  };

  try {
    delete require.cache[modulePath];
    global.window = fakeWindow;
    const api = require(modulePath);
    api.bind();
    for (let index = 0; index < 6; index += 1) await new Promise(function(resolve) { setImmediate(resolve); });
    assert.equal(setOptionCalls, 1);
    assert.match(legend.textContent, /source-a/);
    assert.equal(legend.dataset.state, 'available');

    await api.loadHeatmapSnapshot({ force: true });
    assert.equal(setOptionCalls, 1);
    assert.match(legend.textContent, /source-b/);
    assert.match(legend.textContent, /部分分类等待更新/);
    assert.equal(legend.dataset.state, 'partial');

    await api.loadHeatmapSnapshot({ force: true });
    assert.equal(setOptionCalls, 1);
    assert.match(legend.textContent, /source-c/);
    assert.match(legend.textContent, /缓存已过期/);
    assert.equal(legend.dataset.state, 'partial');

    await api.loadHeatmapSnapshot({ force: true });
    assert.equal(setOptionCalls, 1);
    assert.match(legend.textContent, /source-d/);
    assert.match(legend.textContent, /目录部分可用/);
    assert.match(legend.textContent, /仅返回 46\/48/);
    assert.equal(legend.dataset.state, 'partial');
  } finally {
    delete require.cache[modulePath];
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});

test('partial heatmap legend state has an explicit yellow visual treatment', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');
  assert.match(css, /\.dashboard-market-heatmap-legend\[data-state="partial"\]\s*\{[^}]*color:\s*#(?:d97706|f59e0b)/i);
});

test('an unavailable complete-board snapshot stays explicit and never falls back to the legacy hot Top 12', async () => {
  const modulePath = require.resolve('../js/modules/marketComparison');
  const previousWindow = global.window;
  const heatmap = { innerHTML: '' };
  const legend = { textContent: '', dataset: {} };
  let setOptionCalls = 0;
  const defaultKeys = ['index:sse', 'index:szse', 'index:chinext', 'index:star50'];
  const unavailableItems = Array.from({ length: 18 }, function(_, index) {
    return {
      key: 'eastmoney-industry:BK' + String(index + 1).padStart(4, '0'),
      code: 'BK' + String(index + 1).padStart(4, '0'),
      name: '缓存行业' + (index + 1),
      taxonomy: 'industry',
      kind: 'industry',
      status: 'unavailable',
      stale: true,
      amount: null,
      changePct: null,
      mainNetInflow: null,
      reason: 'planned snapshot outage'
    };
  });
  const fakeWindow = {
    document: {
      getElementById: function(id) {
        if (id === 'dashboardMarketHeatmap') return heatmap;
        if (id === 'dashboardMarketHeatmapLegend') return legend;
        return null;
      },
      querySelectorAll: function() { return []; },
      addEventListener: function() {},
      hidden: false
    },
    localStorage: {
      getItem: function(key) {
        if (key === 'webstock.marketComparison.selection.v1') return JSON.stringify(defaultKeys);
        if (key === 'webstock.marketComparison.period.v3') return 'daily';
        return null;
      },
      setItem: function() {}
    },
    ApiClient: {
      fetchJsonData: async function(url) {
        if (url.startsWith('/api/market/boards/catalog')) {
          return {
            status: 'available',
            items: defaultKeys.map(function(key) {
              return { key, name: key, taxonomy: 'index', capabilities: { daily: true, intraday: true } };
            })
          };
        }
        if (url.startsWith('/api/market/boards/snapshot')) {
          return {
            status: 'unavailable', taxonomy: 'industry', stale: true,
            coverageComplete: true, reason: 'planned snapshot outage', items: unavailableItems
          };
        }
        if (url.includes('/api/market/comparison-history')) {
          return {
            mode: 'daily', window: 60, status: 'unavailable', requestedKeys: defaultKeys,
            series: [], comparison: { dates: [], series: [] }, correlation: { keys: [], values: [] }
          };
        }
        throw new Error('unexpected URL ' + url);
      }
    },
    echarts: {
      init: function() {
        return {
          setOption: function() { setOptionCalls += 1; },
          isDisposed: function() { return false; },
          dispose: function() {},
          on: function() {},
          off: function() {}
        };
      }
    },
    MarketHeatmapModel: require('../js/modules/marketHeatmapModel'),
    console: { warn: function() {} }
  };
  const legacyTop12 = Array.from({ length: 12 }, function(_, index) {
    return {
      code: 'LEGACY' + index,
      name: '旧热点' + (index + 1),
      kind: 'industry',
      amount: 900000000 - index,
      dailyChangePct: 3,
      mainNetInflow: 5000000
    };
  });

  try {
    delete require.cache[modulePath];
    global.window = fakeWindow;
    const api = require(modulePath);
    api.bind();
    for (let index = 0; index < 5; index += 1) {
      await new Promise(function(resolve) { setImmediate(resolve); });
    }
    api.render({ hot: { marketStatus: 'available', boards: { day: legacyTop12 } } });

    assert.equal(setOptionCalls, 0);
    assert.match(heatmap.innerHTML + legend.textContent, /暂不可用|不可用/);
    assert.doesNotMatch(heatmap.innerHTML + legend.textContent, /旧热点/);
  } finally {
    delete require.cache[modulePath];
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});

function createHeatmapDrillHarness() {
  const modulePath = require.resolve('../js/modules/marketComparison');
  const elements = new Map([
    ['dashboardMarketHeatmap', { innerHTML: '', setAttribute: function() {} }],
    ['dashboardMarketHeatmapLegend', { textContent: '', dataset: {} }],
    ['dashboardHeatmapBreadcrumb', { innerHTML: '', hidden: true, dataset: {} }],
    ['dashboardHeatmapConstituentSummary', { innerHTML: '', hidden: true, dataset: {} }],
    ['dashboardMarketSectors', { dataset: {}, parentElement: { scrollLeft: 900 } }]
  ]);
  const documentHandlers = { click: [], change: [], keydown: [] };
  const chartHandlers = {};
  const chartEventOperations = [];
  const chartOptions = [];
  const requests = [];
  const detailCalls = [];
  const mainViewCalls = [];
  const windowHandlers = { popstate: [] };
  const historyCalls = [];
  const defaultKeys = ['index:sse', 'index:szse', 'index:chinext', 'index:star50'];
  const constituents = Array.from({ length: 135 }, function(_, index) {
    const code = String(600001 + index);
    return {
      code,
      name: '真实成分股' + (index + 1),
      status: 'available',
      price: 10 + index / 10,
      changePct: index % 2 ? -1.1 : 2.2,
      amount: 100000000 + index,
      totalMarketValue: 3000000000 + index,
      mainNetInflow: index % 2 ? -2000000 : 3000000
    };
  });
  const snapshots = {
    industry: {
      status: 'available', taxonomy: 'industry', coverageComplete: true,
      items: [
        { code: 'BK0475', name: '半导体', taxonomy: 'industry', kind: 'industry', status: 'available', amount: 900000000, changePct: 2.5, mainNetInflow: 80000000 },
        { code: 'BK0420', name: '软件开发', taxonomy: 'industry', kind: 'industry', status: 'available', amount: 600000000, changePct: -0.8, mainNetInflow: -20000000 }
      ]
    },
    concept: {
      status: 'available', taxonomy: 'concept', coverageComplete: true,
      items: [
        { code: 'BK0816', name: '人工智能', taxonomy: 'concept', kind: 'concept', status: 'available', amount: 700000000, changePct: 1.7, mainNetInflow: 60000000 }
      ]
    },
    region: {
      status: 'available', taxonomy: 'region', coverageComplete: true,
      items: [
        { code: 'BK0153', name: '北京板块', taxonomy: 'region', kind: 'region', status: 'available', amount: 500000000, changePct: 0.7, mainNetInflow: 10000000 }
      ]
    }
  };
  const chart = {
    setOption: function(option) { chartOptions.push(option); },
    isDisposed: function() { return false; },
    dispose: function() {},
    off: function(eventName) {
      chartEventOperations.push(['off', eventName]);
      delete chartHandlers[eventName];
    },
    on: function(eventName, handler) {
      chartEventOperations.push(['on', eventName]);
      chartHandlers[eventName] = handler;
    }
  };
  const fakeWindow = {
    location: { href: 'http://localhost/#dashboard' },
    history: {
      state: { mainView: 'dashboard' },
      pushState: function(state, title, url) {
        this.state = state;
        historyCalls.push(['push', state, url]);
      },
      back: function() {
        historyCalls.push(['back']);
        this.state = { mainView: 'dashboard' };
        windowHandlers.popstate.forEach(function(handler) { handler({ state: this.state }); }, this);
      }
    },
    addEventListener: function(type, handler) {
      if (windowHandlers[type]) windowHandlers[type].push(handler);
    },
    document: {
      hidden: false,
      getElementById: function(id) { return elements.get(id) || null; },
      querySelectorAll: function() { return []; },
      addEventListener: function(type, handler) {
        if (documentHandlers[type]) documentHandlers[type].push(handler);
      }
    },
    localStorage: {
      getItem: function(key) {
        if (key === 'webstock.marketComparison.selection.v1') return JSON.stringify(defaultKeys);
        if (key === 'webstock.marketComparison.period.v3') return 'daily';
        return null;
      },
      setItem: function() {}
    },
    ApiClient: {
      fetchJsonData: async function(url) {
        requests.push(url);
        if (url.startsWith('/api/market/boards/catalog')) {
          return {
            status: 'available',
            items: defaultKeys.map(function(key) {
              return { key, name: key, taxonomy: 'index', kind: 'index', capabilities: { daily: true, intraday: true } };
            })
          };
        }
        if (url.startsWith('/api/market/boards/snapshot')) {
          const taxonomy = new URL(url, 'http://localhost').searchParams.get('taxonomy');
          return snapshots[taxonomy];
        }
        if (url.startsWith('/api/market/boards/constituents')) {
          const parsed = new URL(url, 'http://localhost');
          return {
            status: 'available',
            taxonomy: parsed.searchParams.get('taxonomy'),
            board: { code: parsed.searchParams.get('code'), name: '半导体' },
            coverageComplete: true,
            items: constituents
          };
        }
        if (url.includes('/api/market/comparison-history')) {
          return {
            mode: 'daily', window: 60, status: 'unavailable', requestedKeys: defaultKeys,
            series: [], comparison: { dates: [], series: [] }, correlation: { keys: [], values: [] }
          };
        }
        throw new Error('unexpected URL ' + url);
      }
    },
    echarts: { init: function() { return chart; } },
    MarketHeatmapModel: require('../js/modules/marketHeatmapModel'),
    State: { allStocks: constituents.slice() },
    StockList: {
      runRowAction: async function(action, stock) { detailCalls.push([action, stock]); }
    },
    switchMainView: function(view) { mainViewCalls.push(view); },
    console: { warn: function() {} }
  };

  return {
    modulePath,
    fakeWindow,
    elements,
    documentHandlers,
    chartHandlers,
    chartEventOperations,
    chartOptions,
    requests,
    detailCalls,
    mainViewCalls,
    windowHandlers,
    historyCalls,
    constituents
  };
}

async function settleHeatmapDrillTasks(count) {
  for (let index = 0; index < (count || 6); index += 1) {
    await new Promise(function(resolve) { setImmediate(resolve); });
  }
}

function delegatedClickTarget(selector, element) {
  return {
    closest: function(requestedSelector) { return requestedSelector === selector ? element : null; }
  };
}

test('cross-market card click reaches the detail dialog and Escape closes it', async () => {
  const previousWindow = global.window;
  const harness = createHeatmapDrillHarness();
  for (const id of ['dashboardGlobalSignals','dashboardGlobalDetailOverlay','dashboardGlobalDetailTitle','dashboardGlobalDetailMeta','dashboardGlobalDetailChart','dashboardGlobalDetailSource']) {
    harness.elements.set(id,{innerHTML:'',textContent:'',style:{}});
  }
  try {
    delete require.cache[harness.modulePath];
    global.window = harness.fakeWindow;
    const view = require(harness.modulePath);
    view.bind();
    await settleHeatmapDrillTasks();
    view.renderGlobalSignals({items:[{key:'sp500-future',name:'标普500期货 CFD',status:'available',value:5900,source:'新浪公开快照'}]});
    const card = {getAttribute:()=> 'sp500-future'};
    harness.documentHandlers.click[0]({target:delegatedClickTarget('[data-global-signal-key]',card)});
    assert.equal(harness.elements.get('dashboardGlobalDetailOverlay').style.display,'grid');
    harness.documentHandlers.keydown[0]({key:'Escape',target:{matches:()=>false}});
    assert.equal(harness.elements.get('dashboardGlobalDetailOverlay').style.display,'none');
  } finally {
    delete require.cache[harness.modulePath];
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});

test('heatmap replaces its prior click handler before binding board drill behavior', async () => {
  const previousWindow = global.window;
  const harness = createHeatmapDrillHarness();

  try {
    delete require.cache[harness.modulePath];
    global.window = harness.fakeWindow;
    const api = require(harness.modulePath);
    api.bind();
    await settleHeatmapDrillTasks();

    assert.equal(typeof harness.chartHandlers.click, 'function');
    const clickOperations = harness.chartEventOperations.filter(function(operation) {
      return operation[1] === 'click';
    });
    assert.ok(clickOperations.length >= 2);
    for (let index = 0; index < clickOperations.length; index += 2) {
      assert.deepEqual(clickOperations.slice(index, index + 2), [['off', 'click'], ['on', 'click']]);
    }
  } finally {
    delete require.cache[harness.modulePath];
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});

test('clicking a board requests every constituent and renders the complete second-level treemap', async () => {
  const previousWindow = global.window;
  const harness = createHeatmapDrillHarness();

  try {
    delete require.cache[harness.modulePath];
    global.window = harness.fakeWindow;
    const api = require(harness.modulePath);
    api.bind();
    await settleHeatmapDrillTasks();

    assert.equal(typeof harness.chartHandlers.click, 'function');
    harness.chartHandlers.click({
      data: { id: 'BK0475', code: 'BK0475', name: '半导体', group: 'industry', sourceKind: 'industry', nodeType: 'board' }
    });
    await settleHeatmapDrillTasks();

    const request = harness.requests.find(function(url) {
      return url.startsWith('/api/market/boards/constituents');
    });
    assert.ok(request);
    const parsed = new URL(request, 'http://localhost');
    assert.equal(parsed.searchParams.get('code'), 'BK0475');
    assert.equal(parsed.searchParams.get('taxonomy'), 'industry');

    const drilled = harness.chartOptions[harness.chartOptions.length - 1];
    assert.equal(drilled.series[0].data.length, 135);
    assert.equal(drilled.series[0].data.some(function(item) {
      return item.code === harness.constituents[134].code && item.name === '真实成分股135';
    }), true);
    const legend = harness.elements.get('dashboardMarketHeatmapLegend');
    assert.match(legend.textContent, /个股成交额/);
    assert.doesNotMatch(legend.textContent, /面积=板块成交额/);
    const summary = harness.elements.get('dashboardHeatmapConstituentSummary');
    assert.equal(summary.hidden, false);
    assert.match(summary.innerHTML, /真实成分股1/);
    assert.match(summary.innerHTML, /成交额/);
    assert.match(summary.innerHTML, /主力净流入/);
    assert.match(summary.innerHTML, /按成交额前 135\/135/);
    assert.match(summary.innerHTML, /data-heatmap-stock="600001"/);
    assert.equal(harness.elements.get('dashboardMarketSectors').dataset.density, 'drill');
    assert.equal(drilled.series[0].roam, false);

    const flowButton = {
      getAttribute: function(name) { return name === 'data-heatmap-mode' ? 'flow' : null; }
    };
    const flowEvent = { target: delegatedClickTarget('[data-heatmap-mode]', flowButton) };
    harness.documentHandlers.click.forEach(function(handler) { handler(flowEvent); });
    assert.match(legend.textContent, /个股资金/);
  } finally {
    delete require.cache[harness.modulePath];
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});

test('clicking a source-only board does not request an unsupported constituent drill', async () => {
  const previousWindow = global.window;
  const harness = createHeatmapDrillHarness();

  try {
    delete require.cache[harness.modulePath];
    global.window = harness.fakeWindow;
    const api = require(harness.modulePath);
    api.bind();
    await settleHeatmapDrillTasks();

    const initialRequestCount = harness.requests.filter(function(url) {
      return url.startsWith('/api/market/boards/constituents');
    }).length;
    harness.chartHandlers.click({
      data: {
        id: 'new_it', code: 'new_it', name: '电子信息', group: 'industry',
        sourceKind: 'sina-industry', nodeType: 'board', drillable: false
      }
    });
    await settleHeatmapDrillTasks();

    const finalRequestCount = harness.requests.filter(function(url) {
      return url.startsWith('/api/market/boards/constituents');
    }).length;
    assert.equal(finalRequestCount, initialRequestCount);
    assert.equal(harness.elements.get('dashboardHeatmapBreadcrumb').hidden, true);
  } finally {
    delete require.cache[harness.modulePath];
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});

async function verifyMismatchedConstituentResponse(response) {
  const previousWindow = global.window;
  const harness = createHeatmapDrillHarness();
  const originalFetch = harness.fakeWindow.ApiClient.fetchJsonData;
  harness.fakeWindow.ApiClient.fetchJsonData = async function(url) {
    if (url.startsWith('/api/market/boards/constituents')) {
      harness.requests.push(url);
      return response;
    }
    return originalFetch(url);
  };
  try {
    delete require.cache[harness.modulePath];
    global.window = harness.fakeWindow;
    const api = require(harness.modulePath);
    api.bind();
    await settleHeatmapDrillTasks();
    harness.chartHandlers.click({
      data: { id: 'BK0475', code: 'BK0475', name: '半导体', group: 'industry', sourceKind: 'industry', nodeType: 'board' }
    });
    await settleHeatmapDrillTasks();

    const heatmap = harness.elements.get('dashboardMarketHeatmap');
    const legend = harness.elements.get('dashboardMarketHeatmapLegend');
    const breadcrumb = harness.elements.get('dashboardHeatmapBreadcrumb');
    assert.match(heatmap.innerHTML + legend.textContent, /响应.*不匹配|不匹配/);
    assert.match(breadcrumb.innerHTML, /半导体/);
    assert.doesNotMatch(breadcrumb.innerHTML, /越界板块/);
  } finally {
    delete require.cache[harness.modulePath];
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
}

test('constituent drill rejects a response from a different taxonomy', async () => {
  await verifyMismatchedConstituentResponse({
    status: 'available', taxonomy: 'concept', board: { code: 'BK0475', name: '越界板块' },
    coverageComplete: true, items: [{ code: '600001', name: '不应展示', amount: 1, changePct: 1 }]
  });
});

test('constituent drill rejects a response for a different board code', async () => {
  await verifyMismatchedConstituentResponse({
    status: 'available', taxonomy: 'industry', board: { code: 'BK9999', name: '越界板块' },
    coverageComplete: true, items: [{ code: '600001', name: '不应展示', amount: 1, changePct: 1 }]
  });
});

test('drilled heatmap exposes a clickable return breadcrumb and constituent clicks open stock detail', async () => {
  const previousWindow = global.window;
  const harness = createHeatmapDrillHarness();

  try {
    delete require.cache[harness.modulePath];
    global.window = harness.fakeWindow;
    const api = require(harness.modulePath);
    api.bind();
    await settleHeatmapDrillTasks();
    assert.equal(typeof harness.chartHandlers.click, 'function');

    harness.chartHandlers.click({
      data: { id: 'BK0475', code: 'BK0475', name: '半导体', group: 'industry', sourceKind: 'industry', nodeType: 'board' }
    });
    await settleHeatmapDrillTasks();

    const breadcrumb = harness.elements.get('dashboardHeatmapBreadcrumb');
    assert.equal(breadcrumb.hidden, false);
    assert.match(breadcrumb.innerHTML, /data-heatmap-back/);
    assert.match(breadcrumb.innerHTML, /返回全部行业/);

    assert.equal(typeof harness.chartHandlers.click, 'function');
    harness.chartHandlers.click({
      data: {
        code: harness.constituents[0].code,
        name: harness.constituents[0].name,
        nodeType: 'stock'
      }
    });
    await settleHeatmapDrillTasks(2);
    assert.equal(harness.detailCalls.length, 1);
    assert.equal(harness.detailCalls[0][0], 'view');
    assert.equal(harness.detailCalls[0][1].code, harness.constituents[0].code);

    const backButton = { getAttribute: function() { return ''; } };
    const clickEvent = { target: delegatedClickTarget('[data-heatmap-back]', backButton) };
    harness.documentHandlers.click.forEach(function(handler) { handler(clickEvent); });
    await settleHeatmapDrillTasks(2);
    assert.equal(breadcrumb.hidden || !/返回全部行业/.test(breadcrumb.innerHTML), true);
  } finally {
    delete require.cache[harness.modulePath];
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});

test('browser mouse back returns a drilled heatmap to the complete board cloud', async () => {
  const previousWindow = global.window;
  const harness = createHeatmapDrillHarness();

  try {
    delete require.cache[harness.modulePath];
    global.window = harness.fakeWindow;
    const api = require(harness.modulePath);
    api.bind();
    await settleHeatmapDrillTasks();

    harness.chartHandlers.click({
      data: { id: 'BK0816', code: 'BK0816', name: '人工智能', group: 'concept', sourceKind: 'concept', nodeType: 'board' }
    });
    await settleHeatmapDrillTasks();

    assert.equal(harness.fakeWindow.history.state.webstockHeatmapDrill.code, 'BK0816');
    assert.equal(harness.historyCalls.filter(function(call) { return call[0] === 'push'; }).length, 1);
    const breadcrumb = harness.elements.get('dashboardHeatmapBreadcrumb');
    assert.equal(breadcrumb.hidden, false);

    harness.fakeWindow.history.back();
    await settleHeatmapDrillTasks(2);

    assert.equal(breadcrumb.hidden, true);
    assert.equal(harness.elements.get('dashboardHeatmapConstituentSummary').hidden, true);
    assert.equal(harness.elements.get('dashboardMarketSectors').dataset.density, 'focus');
    assert.equal(harness.elements.get('dashboardMarketSectors').parentElement.scrollLeft, 0);
  } finally {
    delete require.cache[harness.modulePath];
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});

test('switching heatmap taxonomy clears the active drill before rendering the new complete snapshot', async () => {
  const previousWindow = global.window;
  const harness = createHeatmapDrillHarness();

  try {
    delete require.cache[harness.modulePath];
    global.window = harness.fakeWindow;
    const api = require(harness.modulePath);
    api.bind();
    await settleHeatmapDrillTasks();
    assert.equal(typeof harness.chartHandlers.click, 'function');

    harness.chartHandlers.click({
      data: { id: 'BK0475', code: 'BK0475', name: '半导体', group: 'industry', sourceKind: 'industry', nodeType: 'board' }
    });
    await settleHeatmapDrillTasks();
    const breadcrumb = harness.elements.get('dashboardHeatmapBreadcrumb');
    assert.match(breadcrumb.innerHTML, /返回全部行业/);

    const conceptButton = {
      getAttribute: function(name) { return name === 'data-heatmap-board-type' ? 'concept' : null; }
    };
    const clickEvent = {
      target: delegatedClickTarget('[data-heatmap-board-type]', conceptButton)
    };
    harness.documentHandlers.click.forEach(function(handler) { handler(clickEvent); });
    await settleHeatmapDrillTasks();

    const lastSnapshotRequest = harness.requests.filter(function(url) {
      return url.startsWith('/api/market/boards/snapshot');
    }).pop();
    assert.equal(new URL(lastSnapshotRequest, 'http://localhost').searchParams.get('taxonomy'), 'concept');
    assert.equal(breadcrumb.hidden || !/返回全部行业/.test(breadcrumb.innerHTML), true);
    const latest = harness.chartOptions[harness.chartOptions.length - 1];
    const latestNodes = latest.series[0].data.flatMap(function(item) {
      return Array.isArray(item.children) ? item.children : [item];
    });
    assert.equal(latestNodes.some(function(item) { return item.name === '人工智能'; }), true);
    assert.equal(latestNodes.some(function(item) { return item.name === '真实成分股135'; }), false);
  } finally {
    delete require.cache[harness.modulePath];
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});
