const os = require('os');
const path = require('path');
const { ensurePairingToken, localIPv4Addresses, buildPairingUrls } = require('../services/lanHostService');
const { resolveSafeListenHost } = require('../services/lanAccessService');

const root = path.join(process.env.APPDATA || os.homedir(), 'WebStock');
const token = process.env.WEBSTOCK_LAN_TOKEN || ensurePairingToken(root);
process.env.WEBSTOCK_LAN_TOKEN = token;
const app = require('../server');

const port = Number(process.env.PORT) || 3000;
const host = resolveSafeListenHost(process.env.WEBSTOCK_HOST || '0.0.0.0', token);

app.listen(port, host, function() {
  console.log('WebStock Android companion LAN mode started.');
  console.log('Windows local: http://127.0.0.1:' + port + '/');
  const addresses = localIPv4Addresses();
  buildPairingUrls(addresses, port, token).forEach(function(url) {
    console.log('Android pairing URL: ' + url);
  });
  if (!addresses.length) console.log('No private or shared-LAN IPv4 address was detected.');
  console.log('Enter the complete pairing URL in the WebStock Android companion.');
});
