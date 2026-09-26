const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'detail-api-'));
process.env.WEBSTOCK_DB_PATH = path.join(directory, 'test.db');
const express = require('express');
const { createPublicPriceDetailService, fetchSnapshot } = require('../services/publicPriceDetailService');
const app = express();
app.use('/api', require('../routes/market'));

test('price backfill API reads dated cache, leaves local-only API intact and rejects invalid dates', async t => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    require('../db').close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const snapshot = await fetchSnapshot('000001', {
    get: async p => p.action === 'info' ? 'v_detail_time_sz000001=[20260918,"09:30:00~09:30:03"]'
      : 'v_detail_data_sz000001=[0,"0/09:30:00/10/0/1/1000/B|1/09:30:03/11/1/1/1100/B"]',
    delay: async () => {}
  });
  const service = createPublicPriceDetailService({ cacheDir: path.join(directory, 'public-price-details'), download: async () => snapshot });
  await service.refresh('000001');
  const base = 'http://127.0.0.1:' + server.address().port;
  const read = async query => (await fetch(base + '/api/minute?code=000001&resolution=5s' + query)).json();
  const remote = await read('&source=public-detail&date=2026-09-18');
  assert.equal(remote.success, true);
  assert.equal(remote.meta.dataSource, 'tencent-public-detail');
  assert.equal(remote.meta.sampling.intervalSeconds, 5);
  assert.equal(remote.data[0].price, 11);
  assert.equal(remote.data[0].volume, 200);
  assert.equal(remote.data[0].amount, 2100);
  assert.equal(remote.data[0].volumeSource, 'tencent-public-detail-derived');
  assert.equal(remote.meta.volumeCoverage, 'public-detail-derived');
  assert.equal((await read('&date=2026-09-18')).data.length, 0);
  const missing = await read('&source=public-detail&date=2026-09-17');
  assert.equal(missing.data.length, 0);
  assert.equal(missing.meta.backfillState, 'date-not-cached');
  const invalid = await fetch(base + '/api/minute?code=000001&resolution=5s&source=public-detail&date=../../test');
  assert.equal(invalid.status, 400);
  assert.equal((await fetch(base + '/api/minute?code=000001&resolution=5s&source=public-detail&date=2026-02-30')).status, 400);
});
