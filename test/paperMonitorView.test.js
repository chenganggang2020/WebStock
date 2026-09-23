const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'modules', 'aiResearch.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');

test('paper portfolio view exposes the paper monitor account and Tonghuashun freshness', () => {
  assert.match(source, /paperMonitorStates/);
  assert.match(source, /同花顺持仓/);
  assert.match(source, /最大回撤/);
  assert.match(source, /data-paper-monitor-run/);
  assert.match(source, /data-paper-monitor-execute/);
  assert.match(source, /data-paper-monitor-toggle/);
  assert.match(source, /09:35/);
  assert.match(source, /10:30/);
  assert.match(source, /14:50/);
  assert.match(source, /同花顺窗口持仓已自动采集/);
  assert.match(source, /当天手动快照已就绪/);
});

test('paper monitor manual handoff saves JSON back to the audited decision endpoint', () => {
  assert.match(source, /\/monitor\/manual/);
  assert.match(source, /window\.AIAssistant\.open/);
  assert.match(source, /rawResponse:\s*savedResult/);
});

test('empty paper portfolio view can explicitly enable the default 100000 monitor account', () => {
  assert.match(source, /enableDefaultPaperMonitorBtn/);
  assert.match(source, /\/paper-portfolios\/default-monitor/);
  assert.match(source, /10\s*万元/);
});

test('paper monitor account has readable responsive metric and ledger styling', () => {
  assert.match(styles, /\.paper-monitor-grid/);
  assert.match(styles, /\.paper-monitor-ledger/);
  assert.match(styles, /grid-template-columns/);
  assert.match(source, /observedMaxDrawdown/);
});

test('monitor distinguishes recorded performance, costs, source time and actual model receipt time', () => {
  assert.match(source, /前向模拟/);
  assert.match(source, /估值过期/);
  assert.match(source, /累计收益率/);
  assert.match(source, /totalCosts/);
  assert.match(source, /marketAsOf/);
  assert.match(source, /实际收到建议/);
  assert.match(source, /nextRetryAt/);
  assert.match(source, /漏跑/);
});

test('simulation account is reachable at the top of AI research instead of below large candidate tables', () => {
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(index.indexOf('id="paperPortfolioPanel"') < index.indexOf('class="gpt-pick-import-band"'));
});

test('monitor exposes readiness, explicit holding modes, candidates and handoff expiry', () => {
  assert.match(source, /data-paper-monitor-mode/);
  assert.match(source, /独立模拟/);
  assert.match(source, /检查运行条件/);
  assert.match(source, /data-paper-monitor-check/);
  assert.match(source, /\/monitor\/check/);
  assert.match(source, /data-paper-monitor-candidates/);
  assert.match(source, /expiresAt/);
  assert.match(source, /validationStatus !== 'valid'/);
});
