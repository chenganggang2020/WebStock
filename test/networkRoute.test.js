const test = require('node:test');
const assert = require('node:assert/strict');

const { inspectNetworkRoute } = require('../electron/networkRoute');

test('network route reports the resolved Electron proxy endpoint', async () => {
  const route = await inspectNetworkRoute({
    resolveProxy() { return Promise.resolve('PROXY 127.0.0.1:7891; DIRECT'); }
  }, 'https://www.douyin.com/');

  assert.deepEqual(route, {
    mode: 'proxy',
    label: '系统代理',
    endpoint: '127.0.0.1:7891',
    target: 'www.douyin.com',
    raw: 'PROXY 127.0.0.1:7891; DIRECT'
  });
});

test('network route distinguishes a direct Electron connection', async () => {
  const route = await inspectNetworkRoute({
    resolveProxy() { return Promise.resolve('DIRECT'); }
  }, 'https://www.douyin.com/');

  assert.equal(route.mode, 'direct');
  assert.equal(route.label, '直连');
  assert.equal(route.endpoint, '');
});
