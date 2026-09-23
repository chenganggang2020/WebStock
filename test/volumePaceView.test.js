const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const indexSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(root, 'js/modules/dashboard.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'css/styles.css'), 'utf8');

test('homepage embeds volume pace beside market sentiment with prominent ratios and amounts', () => {
  ['volumePaceStatus', 'volumePaceCumulative', 'volumePaceCumulativeDetail', 'volumePaceRolling5',
    'volumePaceRolling5Detail', 'volumePaceSequential5', 'volumePaceSequential5Detail',
    'volumePaceCumulativeValue', 'volumePaceRolling5Value', 'volumePaceSequential5Value',
    'volumePaceChart', 'volumePaceSource'].forEach(function(id) {
    assert.match(indexSource, new RegExp('id="' + id + '"'));
  });
  assert.match(indexSource, /沪深量能速度/);
  assert.match(indexSource, /同比：今日与前一交易日同一时间段相比/);
  assert.match(indexSource, /环比：今日最近 5 分钟与紧邻前 5 分钟相比/);
  assert.match(cssSource, /\.dashboard-volume-stage/);
  assert.match(cssSource, /\.dashboard-volume-stage\s*\{[^}]*background:\s*#0b1020/s);
  assert.match(cssSource, /\.volume-pace-metrics\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(cssSource, /\.volume-pace-chart/);
});

test('homepage keeps volume pace inside the leading sentiment stage and ETF and futures below indices', () => {
  const sentiment = indexSource.indexOf('id="dashboardMarketSentiment"');
  const volume = indexSource.indexOf('id="volumePaceHeading"');
  const indices = indexSource.indexOf('id="dashboardMarketCockpit"');
  const institutional = indexSource.indexOf('id="dashboardInstitutionalFlow"');
  assert.ok(sentiment < volume);
  assert.ok(volume < indices);
  assert.ok(indices < institutional);
  assert.doesNotMatch(indexSource, /class="dashboard-card full volume-pace-card"/);
});

test('volume pace module is loaded before dashboard and participates in dashboard refresh', () => {
  assert.ok(indexSource.indexOf('js/modules/volumePace.js') < indexSource.indexOf('js/modules/dashboard.js'));
  assert.match(dashboardSource, /VolumePace\.load/);
  assert.match(appSource, /VolumePace\.resize/);
});

test('volume pace display keeps data truth and refresh cadence visible', () => {
  const source = fs.readFileSync(path.join(root, 'js/modules/volumePace.js'), 'utf8');
  const api = require('../js/modules/volumePace');
  assert.match(source, /\/api\/market\/volume-pace/);
  assert.match(source, /15000/);
  assert.match(source, /公开行情不保证交易所逐笔实时/);
  assert.match(source, /cumulative-up-short-down/);
  assert.match(source, /rolling5SequentialPct/);
  assert.match(source, /intervalSeconds/);
  assert.match(source, /分钟时点/);
  assert.match(source, /优先1分钟成交额/);
  assert.match(source, /5分钟成交量降级/);
  assert.match(source, /fixedMinuteAxis/);
  assert.equal(api.formatPct(null), '暂无');
  assert.equal(api.formatMeasure(null, 'amount'), '暂无');
  assert.match(api.stateText({ cumulativeState: 'expanding', shortTermState: 'unavailable' }), /预热|不可用/);
  const axis = api.fixedMinuteAxis();
  assert.equal(axis[0], '09:30');
  assert.equal(axis[axis.length - 1], '15:00');
  assert.equal(axis.includes('12:00'), false);
  const visibleAxisLabel = api.visibleAxisLabel;
  assert.equal(visibleAxisLabel(120, '11:30'), true);
  assert.equal(visibleAxisLabel(121, '13:00'), false);
  assert.equal(visibleAxisLabel(150, '13:29'), false);
});

test('volume pace chart joins valid minutes across lunch and isolated missing snapshots', () => {
  const source = fs.readFileSync(path.join(root, 'js/modules/volumePace.js'), 'utf8');
  const joinedSeries = source.match(/connectNulls:\s*true/g) || [];
  assert.equal(joinedSeries.length, 3);
  const api = require('../js/modules/volumePace');
  assert.equal(api.chartAxis({ coverage: { intervalSeconds: 60 } }).find(label => label >= '13:00'), '13:00');
  assert.equal(api.chartAxis({ coverage: { intervalSeconds: 300 } }).find(label => label >= '13:00'), '13:05');
  assert.match(cssSource, /\.volume-pace-chart\s*\{[^}]*height:\s*260px/s);
});

test('volume pace exposes expected-slot coverage and labels incomplete cumulative totals', () => {
  const api = require('../js/modules/volumePace');
  const elements = {
    volumePaceSource: { textContent: '' },
    volumePaceAsOf: { textContent: '' },
    volumePaceCumulative: { textContent: '' },
    volumePaceCumulativeValue: { textContent: '' },
    volumePaceCumulativeDetail: { textContent: '' }
  };
  const original = global.document;
  global.document = { getElementById: id => elements[id] || null };
  try {
    api.render({
      status: 'partial', quality: { usable: false }, reason: '对齐覆盖不足',
      tradingDate: '2026-08-31', asOf: '09:39', marketState: 'delayed',
      coverage: { alignedPoints: 10, expectedAlignedPoints: 241, alignedCoveragePct: 4.15, intervalSeconds: 60 },
      metrics: { cumulativeYoYPct: 0, todayCumulativeValue: 2000, previousCumulativeValue: 2000 }
    });
    assert.match(elements.volumePaceSource.textContent, /10\s*\/\s*241/);
    assert.match(elements.volumePaceSource.textContent, /4\.15%/);
    assert.match(elements.volumePaceSource.textContent, /覆盖不足/);
    assert.match(elements.volumePaceCumulativeDetail.textContent, /非完整累计/);
    assert.equal(elements.volumePaceCumulative.textContent, '暂无');
    assert.equal(elements.volumePaceCumulativeValue.textContent, '暂无');
    assert.match(elements.volumePaceAsOf.textContent, /延迟/);
  } finally {
    if (original === undefined) delete global.document;
    else global.document = original;
  }
});
