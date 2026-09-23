const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'js/mobileApp.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'mobile.html'), 'utf8');

test('mobile page checks the local quote snapshot every second and keeps full content refresh bounded', () => {
  assert.match(appSource, /QUOTE_HEARTBEAT_MS\s*=\s*1000/);
  assert.match(appSource, /FULL_SNAPSHOT_REFRESH_MS\s*=\s*60000/);
  assert.match(appSource, /\/api\/quote\/snapshot\?codes=/);
  assert.match(appSource, /document\.hidden/);
  assert.match(appSource, /quoteRunning/);
  assert.doesNotMatch(appSource, /setInterval/);
  assert.ok(
    htmlSource.indexOf('/js/modules/quoteSnapshotClientModel.js') < htmlSource.indexOf('/js/modules/mobileSnapshotView.js'),
    'quote model must load before the mobile view'
  );
});
