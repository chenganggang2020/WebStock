const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { createLanServerController } = require('../electron/lanServerController');

test('desktop LAN controller switches between loopback and paired LAN modes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-lan-controller-'));
  const previousToken = process.env.WEBSTOCK_LAN_TOKEN;
  const handler = (req, res) => {
    res.statusCode = 200;
    res.end('ok');
  };
  const listenable = {
    listen(port, host, callback) {
      return http.createServer(handler).listen(port, host, callback);
    }
  };
  const controller = createLanServerController({
    expressApp: listenable,
    port: 0,
    userDataDir: root,
    networkInterfaces: () => ({
      Ethernet: [{ family: 'IPv4', internal: false, address: '192.168.1.20' }]
    })
  });

  try {
    await controller.start(false);
    let status = controller.status();
    assert.equal(status.enabled, false);
    assert.equal(status.host, '127.0.0.1');
    assert.deepEqual(status.pairingUrls, []);

    status = await controller.setEnabled(true);
    assert.equal(status.enabled, true);
    assert.equal(status.host, '0.0.0.0');
    assert.match(status.pairingUrls[0], /^http:\/\/192\.168\.1\.20:\d+\/\?pair=[a-f0-9]{64}$/);
    assert.equal(process.env.WEBSTOCK_LAN_TOKEN.length, 64);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'lan-access.json'), 'utf8')).enabled, true);

    status = await controller.setEnabled(false);
    assert.equal(status.enabled, false);
    assert.equal(status.host, '127.0.0.1');
    assert.deepEqual(status.pairingUrls, []);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'lan-access.json'), 'utf8')).enabled, false);
  } finally {
    await controller.stop();
    fs.rmSync(root, { recursive: true, force: true });
    if (previousToken === undefined) delete process.env.WEBSTOCK_LAN_TOKEN;
    else process.env.WEBSTOCK_LAN_TOKEN = previousToken;
  }
});
