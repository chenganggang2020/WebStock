const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('comment strategy workbench is reachable from the primary navigation with four focused tabs', () => {
  const index = read('index.html');
  const sidebarEntries = index.match(/class="sidebar-workspace-btn"[^>]*data-main-view="commentStrategy"/g) || [];
  const topEntries = index.match(/class="main-tab"[^>]*data-main-view="commentStrategy"/g) || [];
  assert.equal(sidebarEntries.length, 0);
  assert.equal(topEntries.length, 1);
  assert.match(index, /id="commentStrategyView"[^>]*class="main-view"/);
  assert.equal((index.match(/data-comment-strategy-tab="[^"]+"/g) || []).length, 4);
  assert.match(index, /data-comment-strategy-tab="evidence"/);
  assert.match(index, /data-comment-strategy-tab="creator"/);
  assert.match(index, /data-comment-strategy-tab="rules"/);
  assert.match(index, /data-comment-strategy-tab="map"/);
});

test('comment strategy workbench exposes source selectors, rule gates and evidence outputs', () => {
  const index = read('index.html');
  [
    'commentStrategyChannelSelect', 'commentStrategyObservationSelect', 'commentStrategyRefreshBtn',
    'commentStrategyCoverage', 'commentStrategyEvidenceList', 'commentStrategyCreatorList',
    'commentRuleCardSelect', 'commentRuleTitle', 'commentRuleUniverse', 'commentRuleTimeframe',
    'commentRuleSignalTiming', 'commentRuleEntry', 'commentRuleExit', 'commentRuleStop',
    'commentRulePosition', 'commentRuleCost', 'commentRuleStatus', 'commentRuleSaveBtn',
    'commentEvidenceMapSummary', 'commentEvidenceMapList'
  ].forEach(id => assert.match(index, new RegExp('id="' + id + '"')));
  assert.match(index, /尚未保存评论[^<]*不能解释为视频没有评论/);
  assert.match(index, /规则完整不等于策略有效/);
});

test('comment strategy runtime reads only the selected observation and keeps drafts local', () => {
  const index = read('index.html');
  const app = read('js/app.js');
  const moduleSource = read('js/modules/commentStrategyLab.js');
  assert.ok(index.indexOf('js/modules/commentStrategyModel.js') < index.indexOf('js/modules/commentStrategyLab.js'));
  assert.ok(index.indexOf('js/modules/commentStrategyLab.js') < index.indexOf('js/app.js'));
  assert.match(app, /view === 'commentStrategy'/);
  assert.match(app, /window\.CommentStrategyLab\.ensureLoaded/);
  assert.match(moduleSource, /\/api\/expert\/channels/);
  assert.match(moduleSource, /\/observations/);
  assert.match(moduleSource, /\/comments/);
  assert.match(moduleSource, /webstock\.commentStrategy\.ruleCards/);
  assert.match(moduleSource, /webstock\.commentStrategy\.evidenceLabels/);
  assert.match(moduleSource, /loadGeneration/);
  assert.match(moduleSource, /generation !== loadGeneration/);
  assert.doesNotMatch(moduleSource, /Math\.random|submitOrder|broker\/trade|callAIModel|method:\s*['"]POST/);
});

test('comment strategy rendering escapes untrusted comment and source text', () => {
  const moduleSource = read('js/modules/commentStrategyLab.js');
  assert.match(moduleSource, /function escapeHtml/);
  assert.match(moduleSource, /escapeHtml\(comment\.text\)/);
  assert.match(moduleSource, /escapeHtml\(comment\.parentText\)/);
  assert.doesNotMatch(moduleSource, /innerHTML\s*=\s*comment\.text/);
});
