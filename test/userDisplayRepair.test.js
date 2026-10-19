const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('daily institutional changes are the headline even when the ending position is short', () => {
  const elements = Object.fromEntries(['dashboardEtfFlowLeaders', 'dashboardFuturesPositions',
    'dashboardCiticAggregate', 'dashboardCffexAggregate'].map(id => [id, { innerHTML: '' }]));
  const view = require('../js/modules/marketInstitutionalFlow').createModule({
    document: { getElementById: id => elements[id] || null }
  });
  view.render({ futures: { availability: 'available', asOf: '2026-09-09', items: [{
    product: 'IF', contract: 'IF2609', disclosedLong: 100, disclosedShort: 112160,
    rankedMemberImbalance: -112060, rankedMemberImbalanceChange: 1900,
    focusMembers: [{ member: '中信期货', disclosedLong: 100, disclosedShort: 78007,
      rankedMemberImbalance: -77907, rankedMemberImbalanceChange: 189 }]
  }] } });
  assert.match(elements.dashboardCffexAggregate.innerHTML, /net-long/);
  assert.match(elements.dashboardCffexAggregate.innerHTML, /<strong[^>]*>今日净增多 1,900 手<\/strong>/);
  assert.match(elements.dashboardCffexAggregate.innerHTML, /日终净空 112,060 手/);
  assert.match(elements.dashboardCiticAggregate.innerHTML, /<strong[^>]*>今日净增多 189 手<\/strong>/);
});

test('index cards initially use intraday charts and expose an explicit enlarge control', () => {
  assert.equal(require('../js/modules/marketComparison').getSelectedPeriod(), 'intraday');
  const source = fs.readFileSync(path.join(__dirname, '../js/modules/marketComparison.js'), 'utf8');
  assert.match(source, /class="dashboard-index-expand"/);
});

test('collection history follows the video workbench instead of hiding its content below audit rows', () => {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.ok(html.indexOf('id="creatorTaskRunAudit"') > html.indexOf('id="expertCreatorVideoDetail"'));
});
