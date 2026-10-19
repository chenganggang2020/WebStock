const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const terminal = require('../js/modules/compactTerminal');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

test('evidence owns an independent view instead of aliasing AI research', () => {
  assert.equal(terminal.resolve('evidence').view, 'evidence');
  assert.match(html, /id="evidenceView"/);
});
test('all capital panels have canonical pages so title and history cannot drift', () => {
  const pages = terminal.pages.filter(page => page.workspace === 'capital');
  assert.equal(pages.length, 5);
  assert.equal(terminal.resolve('capitalDaily').target, 'institutionalFlowTitle');
  assert.equal(terminal.resolve('capitalIntraday').id, 'capitalDaily');
  assert.equal(terminal.resolve('etf').view, 'etf');
  const layout=fs.readFileSync(path.join(__dirname,'../js/modules/fixedWorkspace.js'),'utf8');
  assert.match(layout,/fixed-institutional-workspace/);
  assert.match(layout,/institutional-intraday-panel/);
  assert.match(layout,/institutionalFlowTitle/);
});
