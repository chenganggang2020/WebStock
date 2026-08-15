const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isLocalNetworkAddress } = require('./lanAccessService');

const TOKEN_FILE = 'lan-pairing-token';
const SETTINGS_FILE = 'lan-access.json';
const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

function ensurePairingToken(userDataDir) {
  fs.mkdirSync(userDataDir, { recursive: true });
  const tokenPath = path.join(userDataDir, TOKEN_FILE);
  try {
    const existing = fs.readFileSync(tokenPath, 'utf8').trim();
    if (TOKEN_PATTERN.test(existing)) return existing;
  } catch (_) {}

  const token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(tokenPath, token, { encoding: 'utf8', mode: 0o600 });
  return token;
}

function readLanEnabled(userDataDir) {
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(userDataDir, SETTINGS_FILE), 'utf8'));
    return saved.enabled === true;
  } catch (_) {
    return false;
  }
}

function writeLanEnabled(userDataDir, enabled) {
  fs.mkdirSync(userDataDir, { recursive: true });
  const settingsPath = path.join(userDataDir, SETTINGS_FILE);
  const temporaryPath = settingsPath + '.tmp';
  fs.writeFileSync(temporaryPath, JSON.stringify({ enabled: enabled === true }, null, 2), 'utf8');
  fs.renameSync(temporaryPath, settingsPath);
}

function localIPv4Addresses(interfaces = os.networkInterfaces()) {
  return Array.from(new Set(Object.values(interfaces)
    .flat()
    .filter(item => item && item.family === 'IPv4' && !item.internal && isLocalNetworkAddress(item.address))
    .map(item => item.address)))
    .sort();
}

function buildPairingUrls(addresses, port, token) {
  return addresses.map(address => (
    'http://' + address + ':' + port + '/?pair=' + encodeURIComponent(token)
  ));
}

function connectionKind(address) {
  const parts = String(address || '').split('.').map(Number);
  return parts.length === 4 && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127
    ? 'tailscale' : 'lan';
}

function buildPairingOptions(addresses, port, token) {
  return addresses.map(function(address) {
    const kind = connectionKind(address);
    return {
      address,
      kind,
      label: kind === 'tailscale' ? 'Tailscale 远程' : '局域网',
      url: 'http://' + address + ':' + port + '/?pair=' + encodeURIComponent(token)
    };
  }).sort(function(left, right) {
    if (left.kind === right.kind) return left.address.localeCompare(right.address);
    return left.kind === 'tailscale' ? -1 : 1;
  });
}

module.exports = {
  TOKEN_FILE,
  SETTINGS_FILE,
  ensurePairingToken,
  readLanEnabled,
  writeLanEnabled,
  localIPv4Addresses,
  buildPairingUrls,
  connectionKind,
  buildPairingOptions
};
