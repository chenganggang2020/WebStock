const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isLocalNetworkAddress } = require('../services/lanAccessService');

function pairingToken() {
  if (process.env.WEBSTOCK_LAN_TOKEN) return process.env.WEBSTOCK_LAN_TOKEN;
  const root = path.join(process.env.APPDATA || os.homedir(), 'WebStock');
  const tokenPath = path.join(root, 'lan-pairing-token');
  fs.mkdirSync(root, { recursive: true });
  try {
    const existing = fs.readFileSync(tokenPath, 'utf8').trim();
    if (/^[a-f0-9]{48,128}$/i.test(existing)) return existing;
  } catch (error) {}
  const token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(tokenPath, token, { encoding: 'utf8', mode: 0o600 });
  return token;
}

const token = pairingToken();
process.env.WEBSTOCK_LAN_TOKEN = token;
const app = require('../server');

const port = Number(process.env.PORT) || 3000;
const host = process.env.WEBSTOCK_HOST || '0.0.0.0';

function localIPv4Addresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(item => item && item.family === 'IPv4' && !item.internal && isLocalNetworkAddress(item.address))
    .map(item => item.address);
}

app.listen(port, host, function() {
  console.log('WebStock Android companion LAN mode started.');
  console.log('Windows local: http://127.0.0.1:' + port + '/');
  const addresses = localIPv4Addresses();
  addresses.forEach(function(address) {
    console.log('Android pairing URL: http://' + address + ':' + port + '/?pair=' + token);
  });
  if (!addresses.length) console.log('No private or shared-LAN IPv4 address was detected.');
  console.log('Enter the complete pairing URL in the WebStock Android companion.');
});
