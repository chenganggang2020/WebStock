const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { detectSnapshotChange, buildPrivateNotification, createMobilePushService, comparisonSnapshot } = require('../services/mobilePushService');

test('push detects a holding swap or quantity change even when count and assets are unchanged', () => {
  const first = snapshot();
  first.accounts[0].positions = [{ code: '600000', quantity: 100 }];
  first.accounts[0].valuationStatus = 'live';
  const next = structuredClone(first);
  next.accounts[0].positions[0].code = '600001';
  assert.equal(detectSnapshotChange(comparisonSnapshot(first), comparisonSnapshot(next)).kind, 'portfolio');
  next.accounts[0].positions[0] = { code: '600000', quantity: 200 };
  assert.equal(detectSnapshotChange(comparisonSnapshot(first), comparisonSnapshot(next)).kind, 'portfolio');
});

test('point alerts use fresh crossings, do not repeat unchanged alerts, and ignore stale quotes', () => {
  const make = (price, quoteTime) => ({ generatedAt: '2026-09-07T02:31:00Z', watchlist: { items: [{ code: '600000', currentPrice: price,
    alertHigh: 11, alertLow: 9, quoteDate: '2026-09-07', quoteTime: quoteTime || '10:31:00', quoteStatus: 'live' }] } });
  const before = comparisonSnapshot(make(10));
  const hit = comparisonSnapshot(make(11.1));
  assert.equal(detectSnapshotChange(before, hit).kind, 'price-alert');
  assert.equal(detectSnapshotChange(hit, comparisonSnapshot(make(11.2))), null);
  const stale = comparisonSnapshot(make(11.2, '09:31:00'), hit);
  assert.equal(detectSnapshotChange(hit, stale), null);
  assert.equal(detectSnapshotChange(stale, comparisonSnapshot(make(11.2))), null);
  assert.doesNotMatch(JSON.stringify(buildPrivateNotification({ kind: 'price-alert', code: '600000', price: 11 })), /600000|11/);
});

function snapshot(options = {}) {
  return {
    accounts: [{ id: 1, summary: { totalAssets: options.totalAssets ?? 10000, positionCount: options.positionCount ?? 2 } }],
    research: { totals: { observationCount: options.observationCount ?? 10 } }
  };
}

test('mobile push ignores ordinary price noise but detects material or research changes', () => {
  assert.equal(detectSnapshotChange(snapshot(), snapshot({ totalAssets: 10100 })), null);
  assert.equal(detectSnapshotChange(snapshot(), snapshot({ totalAssets: 10400 })).kind, 'portfolio');
  assert.equal(detectSnapshotChange(snapshot(), snapshot({ observationCount: 11 })).kind, 'research');
  assert.equal(detectSnapshotChange(snapshot(), snapshot({ positionCount: 3 })).kind, 'portfolio');
});

test('mobile push message never includes account names, stock codes, holdings or amounts', () => {
  const payload = buildPrivateNotification({ kind: 'portfolio' });
  const text = JSON.stringify(payload);

  assert.equal(payload.title, 'WebStock 有新的数据变化');
  assert.match(payload.body, /打开应用/);
  assert.doesNotMatch(text, /账户|持仓|\d{6}|10000|元/);
  assert.equal(payload.url, '/mobile.html');
});

test('mobile push stores a valid subscription locally and sends a private test message', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-mobile-push-'));
  const database = new Database(path.join(root, 'push.db'));
  t.after(() => {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  database.exec(`
    CREATE TABLE mobile_push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT NOT NULL UNIQUE,
      subscription_json TEXT NOT NULL,
      user_agent TEXT DEFAULT '',
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE mobile_push_state (id INTEGER PRIMARY KEY, snapshot_json TEXT, updated_at TEXT);
  `);
  const sent = [];
  const service = createMobilePushService({
    database,
    dataDir: root,
    webPush: {
      generateVAPIDKeys() { return { publicKey: 'public-key', privateKey: 'private-key' }; },
      setVapidDetails() {},
      async sendNotification(subscription, payload) { sent.push({ subscription, payload: JSON.parse(payload) }); }
    },
    loadSnapshot: async () => snapshot()
  });
  const subscription = {
    endpoint: 'https://push.example/subscription-1',
    keys: { p256dh: 'p'.repeat(65), auth: 'a'.repeat(16) }
  };

  service.subscribe(subscription, 'iPhone');
  const result = await service.sendTest(subscription.endpoint);

  assert.equal(service.publicStatus().subscriptionCount, 1);
  assert.equal(result.delivered, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.title, 'WebStock 通知已开启');
  assert.doesNotMatch(JSON.stringify(sent[0].payload), /subscription-1|iPhone/);
});
