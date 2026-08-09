const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const lanHost = require('../services/lanHostService');

test('LAN host persists one pairing token in the selected user data directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-lan-token-'));
  try {
    const first = lanHost.ensurePairingToken(root);
    const second = lanHost.ensurePairingToken(root);

    assert.match(first, /^[a-f0-9]{64}$/);
    assert.equal(second, first);
    assert.equal(fs.readFileSync(path.join(root, 'lan-pairing-token'), 'utf8'), first);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('LAN host preference is disabled by default and round-trips explicitly', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-lan-pref-'));
  try {
    assert.equal(lanHost.readLanEnabled(root), false);
    lanHost.writeLanEnabled(root, true);
    assert.equal(lanHost.readLanEnabled(root), true);
    lanHost.writeLanEnabled(root, false);
    assert.equal(lanHost.readLanEnabled(root), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('LAN host lists unique private IPv4 addresses and creates encoded pairing URLs', () => {
  const interfaces = {
    Ethernet: [
      { family: 'IPv4', internal: false, address: '192.168.1.20' },
      { family: 'IPv4', internal: false, address: '8.8.8.8' }
    ],
    WiFi: [
      { family: 'IPv4', internal: false, address: '100.64.213.144' },
      { family: 'IPv4', internal: false, address: '192.168.1.20' },
      { family: 'IPv6', internal: false, address: 'fe80::1' }
    ]
  };

  const addresses = lanHost.localIPv4Addresses(interfaces);
  assert.deepEqual(addresses, ['100.64.213.144', '192.168.1.20']);
  assert.deepEqual(
    lanHost.buildPairingUrls(addresses, 3000, 'a'.repeat(64)),
    [
      'http://100.64.213.144:3000/?pair=' + 'a'.repeat(64),
      'http://192.168.1.20:3000/?pair=' + 'a'.repeat(64)
    ]
  );
});
