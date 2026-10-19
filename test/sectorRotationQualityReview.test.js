const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createSectorRotationService } = require('../services/capitalFlow/sectorRotationService');
const { rotationResult } = require('../services/capitalFlow/sectorRotationModel');

test('a non-reconciled historical daily refresh preserves the last verified cache', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'webstock-rotation-quality-'));
  let now = new Date('2026-09-17T22:00:00+08:00');
  let invalidMoney = false;
  const service = createSectorRotationService({
    directory,
    now: () => now,
    load: async query => ({
      scope: query.scope,
      tradingDay: query.date,
      receivedAt: now.toISOString(),
      source: { id: 'quality-test', fieldMapping: 'v1' },
      coverage: { page: query.page, pageSize: 100, totalReported: 1 },
      rows: [{
        code: 'BK0001', name: '测试板块',
        darkNetCents: '100', visibleNetCents: '200',
        combinedNetCents: invalidMoney ? '999' : '300',
        reconciled: !invalidMoney
      }]
    })
  });

  try {
    const query = { scope: 'industry', date: '2026-09-16' };
    const first = await service.refreshDaily(query);
    assert.equal(first.snapshot.rows[0].combinedNetCents, '300');
    const verifiedAt = first.snapshot.retrievedAt;

    now = new Date('2026-09-17T22:01:01+08:00');
    invalidMoney = true;
    const failed = await service.refreshDaily(query);

    assert.equal(failed.refreshFailed, true);
    assert.equal(failed.snapshot.retrievedAt, verifiedAt);
    assert.equal(failed.snapshot.rows[0].combinedNetCents, '300');
    assert.equal((await service.getDaily(query)).snapshot.rows[0].combinedNetCents, '300');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('after-hours fallback selects the last common window with actual valid board money', () => {
  const start = Date.parse('2026-09-17T10:00:00+08:00');
  const snapshots = Array.from({ length: 11 }, (_, index) => ({
    date: '2026-09-17', scope: 'industry', sourceKey: 'quality-test:v1',
    receivedAt: new Date(start + index * 60000).toISOString(),
    coverage: { complete: true, totalReported: 2 },
    rows: ['BK0001', 'BK0002'].map((code, board) => ({
      code, name: code,
      darkNetCents: String((board ? -1 : 1) * index * 50),
      visibleNetCents: String((board ? -1 : 1) * index * 50),
      combinedNetCents: String((board ? -1 : 1) * index * 100),
      reconciled: index !== 10
    }))
  }));
  const night = {
    ...snapshots[10],
    receivedAt: '2026-09-17T14:54:00.000Z',
    rows: snapshots[10].rows.map(row => ({ ...row, reconciled: true }))
  };

  const result = rotationResult(snapshots.concat(night), {
    scope: 'industry', metric: 'combined', minutes: 5,
    now: Date.parse(night.receivedAt)
  });

  assert.equal(result.eligible, 2);
  assert.equal(result.displayMode, 'historical-window');
  assert.equal(result.windowEndAt, snapshots[9].receivedAt);
  assert.equal(result.receivedAt, night.receivedAt);
  assert.equal(result.stale, true);
  assert.equal(result.inflow[0].endAt, snapshots[9].receivedAt);
  assert.equal(result.outflow[0].endAt, snapshots[9].receivedAt);
  assert.equal(result.inflow[0].deltaCents, '500');
  assert.equal(result.outflow[0].deltaCents, '-500');
});
