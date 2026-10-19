const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('local quote polling also reloads account holdings, including an initially empty account', async () => {
  let reloads = 0;
  const urls = [];
  const window = {
    State: { currentMainView: 'portfolio', positions: [] },
    Portfolio: {
      async refreshHoldingSnapshot() {
        reloads += 1;
        window.State.positions = [{ code: '600000', quantity: 200 }];
        return { ok: true };
      },
      applyQuoteSnapshot() {}
    },
    ApiClient: { async fetchApiEnvelope(url) { urls.push(url); return { data: [], meta: {} }; } },
    addEventListener() {}
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/modules/liveRefresh.js'), 'utf8'), {
    window, document: { visibilityState: 'visible', getElementById() { return null; },
      querySelector() { return null; }, addEventListener() {} },
    setTimeout() { return 1; }, clearTimeout() {}, console
  });
  await window.LiveRefresh.sync({ immediate: true });
  assert.equal(reloads, 1);
  assert.ok(urls.some(url => url.includes('600000')));
});
