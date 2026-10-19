'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../scripts/validate-industry-research-live');
const loadedDb = require('../db');

test('live research validation refuses non-isolated execution', async () => {
  await assert.rejects(() => run({ topic: 'bellows', url: 'https://example.com/source' }), /--isolated/);
});

test('live research validation refuses a process with a loaded database', async () => {
  assert.ok(loadedDb);
  await assert.rejects(() => run({ isolated: true, topic: 'bellows', url: 'https://example.com/source' }), /首次加载前/);
});
