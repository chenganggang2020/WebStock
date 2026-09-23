const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('merged navigation keeps industry research without exposing static industry brief figures', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const routes = fs.readFileSync(path.join(root, 'routes/index.js'), 'utf8');

  assert.match(html, /id="industryChainView"/);
  assert.match(routes, /industryChainRouter/);
  assert.doesNotMatch(html, /id="industryBtn"|id="industryOverlay"|js\/modules\/industry\.js/);
  assert.doesNotMatch(routes, /require\('\.\/industry'\)|router\.use\('\/api\/industry', industryRouter\)/);
});
