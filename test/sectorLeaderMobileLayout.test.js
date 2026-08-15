const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('sector leader tables scroll locally instead of widening the mobile page', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');

  assert.match(css, /\.sector-table-scroll\s*\{[^}]*max-width:\s*100%[^}]*overflow-x:\s*auto/is);
  assert.match(css, /#sectorsView[^,{]*\{[^}]*min-width:\s*0[^}]*overflow-x:\s*hidden/is);
  assert.match(css, /#sectorDashboard[\s\S]*?\.sector-grid[\s\S]*?\.sector-card\s*\{[^}]*min-width:\s*0/is);
});
