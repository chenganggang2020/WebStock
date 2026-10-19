const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('compound lab is reachable from the primary navigation', () => {
  const index = read('index.html');
  const sidebarEntries = index.match(/class="sidebar-workspace-btn"[^>]*data-main-view="compoundLab"/g) || [];
  const topEntries = index.match(/class="main-tab"[^>]*data-main-view="compoundLab"/g) || [];
  assert.equal(sidebarEntries.length, 0);
  assert.equal(topEntries.length, 1);
  assert.match(index, /id="compoundLabView"[^>]*class="main-view"/);
  assert.match(index, /class="main-tab"[^>]*data-main-view="compoundLab"[^>]*>复利实验室<\/button>/);
});

test('compound lab exposes exactly twenty modules in four discoverable five-item groups', () => {
  const index = read('index.html');
  const tabTags = (index.match(/<button[^>]*data-compound-module="[^"]+"[^>]*>/g) || []);
  const modules = tabTags.map(tag => tag.match(/data-compound-module="([^"]+)"/)[1]);
  const groups = tabTags.map(tag => tag.match(/data-compound-group="([^"]+)"/)[1]);
  assert.equal(new Set(modules).size, 20);
  assert.deepEqual(Array.from(new Set(groups)).sort(), ['goal', 'portfolio', 'research', 'trade']);
  Array.from(new Set(groups)).forEach(group => assert.equal(groups.filter(value => value === group).length, 5));
  assert.match(index, /data-compound-module="target"/);
  assert.match(index, /data-compound-module="readiness"/);
  assert.match(index, /data-compound-module="stopExposure"/);
  assert.match(index, /data-compound-module="equityPath"/);
  assert.equal((index.match(/data-compound-category="[^"]+"/g) || []).length, 4);
  const picker = index.match(/<select id="compoundModuleSelect"[\s\S]*?<\/select>/);
  assert.ok(picker);
  assert.equal((picker[0].match(/<option value="[^"]+"/g) || []).length, 20);
  assert.ok(index.indexOf('js/modules/compoundLabModel.js') < index.indexOf('js/app.js'));
  assert.ok(index.indexOf('js/modules/compoundLab.js') < index.indexOf('js/app.js'));
  assert.equal((index.match(/aria-controls="compound[A-Za-z]+Panel"/g) || []).length, 20);
  assert.equal((index.match(/aria-labelledby="compoundTab[A-Za-z]+"/g) || []).length, 20);
  const moduleSource = read('js/modules/compoundLab.js');
  assert.match(moduleSource, /ArrowRight/);
  assert.match(moduleSource, /ArrowLeft/);
  assert.match(moduleSource, /renderActiveModule/);
  assert.doesNotMatch(moduleSource, /function renderAll\(/);
  assert.match(moduleSource, /compoundModuleSelect/);
  assert.match(moduleSource, /data-compound-category/);
});

test('compound lab loads on view entry and reads portfolio data without order endpoints', () => {
  const app = read('js/app.js');
  const moduleSource = read('js/modules/compoundLab.js');
  assert.match(app, /view === 'compoundLab'/);
  assert.match(app, /window\.CompoundLab\.ensureLoaded/);
  assert.match(moduleSource, /\/api\/portfolio\/accounts\/overview/);
  assert.match(moduleSource, /\/positions/);
  assert.match(moduleSource, /\/closed-positions/);
  assert.match(moduleSource, /\/trades/);
  assert.match(moduleSource, /\/snapshots/);
  assert.match(moduleSource, /\/api\/portfolio\/watchlist/);
  assert.match(moduleSource, /loadGeneration/);
  assert.match(moduleSource, /generation !== loadGeneration/);
  assert.doesNotMatch(moduleSource, /\/orders|\/broker\/trade|submitOrder/);
  assert.match(moduleSource, /clearResults\('加载失败，请查看上方原因并重试。', 'error'\)/);
});

test('the twelve added tools have explicit inputs, outputs and pure-model wiring', () => {
  const index = read('index.html');
  const moduleSource = read('js/modules/compoundLab.js');
  const requiredIds = [
    'compoundRecoveryContent', 'compoundCashBufferContent', 'compoundStagedAverageContent', 'compoundBreakEvenContent',
    'compoundStopExposureContent', 'compoundPositionSizeContent', 'compoundRiskRewardContent', 'compoundExpectancyContent',
    'compoundLossPathContent', 'compoundLossRunContent', 'compoundPnlDistributionContent', 'compoundEquityPathContent',
    'compoundRecoveryDrawdownInput', 'compoundCashInput', 'compoundStagedPricesInput', 'compoundBreakEvenCostInput',
    'compoundPositionRiskInput', 'compoundRiskRewardTargetInput', 'compoundExpectancyWinRateInput', 'compoundLossPathCountInput',
    'compoundLossRunLengthInput', 'compoundPnlSeriesInput', 'compoundEquityPnlSeriesInput'
  ];
  requiredIds.forEach(id => assert.match(index, new RegExp('id="' + id + '"')));
  [
    'calculateRecoveryTime', 'analyzeCashBuffer', 'calculateStagedAverage', 'calculateBreakEvenExit',
    'analyzeStopExposure', 'calculatePositionSize', 'analyzeRiskReward', 'analyzeExpectancy',
    'calculateLossPath', 'calculateLossRunExperiment', 'analyzePnlDistribution', 'buildSampleEquityPath'
  ].forEach(name => assert.match(moduleSource, new RegExp('CompoundLabModel\\.' + name)));
  assert.doesNotMatch(moduleSource, /Math\.random|submitOrder|broker\/trade/);
  assert.match(moduleSource, /slice\(-30\)/);
  assert.match(moduleSource, /String\(element\.value[^\n]*\)\.trim\(\)/);
  assert.match(moduleSource, /if \(!raw\) return NaN/);
  assert.match(index, /你确认的家庭可用现金（元）/);
  assert.match(index, /18 IID 连亏实验/);
  assert.doesNotMatch(moduleSource, /预计完整月数|接下来连续亏损概率/);
});

test('snapshot history is exposed through an account-scoped read-only route', () => {
  const routes = read('routes/portfolio.js');
  const service = read('services/portfolioService.js');
  assert.match(routes, /router\.get\('\/snapshots'/);
  assert.match(routes, /portfolio\.listSnapshots/);
  assert.match(service, /function listSnapshots/);
  assert.match(service, /WHERE account_id = \?/);
});

test('method gate preserves the authenticated comment sample boundary and the strongest counter-evidence', () => {
  const moduleSource = read('js/modules/compoundLab.js');
  assert.match(moduleSource, /120 条顶层评论/);
  assert.match(moduleSource, /52 条回复/);
  assert.match(moduleSource, /BOLL.*MACD.*RSI/);
  assert.match(moduleSource, /不能跨股票通用/);
  assert.match(moduleSource, /前视偏差/);
  assert.match(moduleSource, /幸存者偏差/);
  assert.match(moduleSource, /实盘过拟合/);
});
