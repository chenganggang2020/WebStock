const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

test('desktop page reloads once when an existing service worker is replaced', () => {
  assert.match(appSource, /navigator\.serviceWorker\.controller/);
  assert.match(appSource, /addEventListener\(['"]controllerchange['"]/);
  assert.match(appSource, /window\.location\.reload\(\)/);
  assert.match(appSource, /registration\.update\(\)/);
});
