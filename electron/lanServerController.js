const {
  ensurePairingToken,
  writeLanEnabled,
  localIPv4Addresses,
  buildPairingUrls
} = require('../services/lanHostService');

function createLanServerController(options) {
  const expressApp = options.expressApp;
  const configuredPort = options.port;
  const userDataDir = options.userDataDir;
  const networkInterfaces = options.networkInterfaces;
  const log = options.log || function() {};
  let server = null;
  let host = null;
  let token = '';

  function listen(nextHost) {
    return new Promise((resolve, reject) => {
      let candidate;
      const onError = error => {
        if (candidate) candidate.removeListener('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        candidate.removeListener('error', onError);
        server = candidate;
        host = nextHost;
        log('WebStock server listening on ' + nextHost + ':' + server.address().port);
        resolve();
      };
      candidate = expressApp.listen(configuredPort, nextHost);
      candidate.once('error', onError);
      candidate.once('listening', onListening);
    });
  }

  function close() {
    if (!server) return Promise.resolve();
    const current = server;
    server = null;
    return new Promise((resolve, reject) => {
      current.close(error => error ? reject(error) : resolve());
      if (typeof current.closeAllConnections === 'function') current.closeAllConnections();
    });
  }

  async function replaceHost(nextHost) {
    const previousHost = host;
    await close();
    try {
      await listen(nextHost);
    } catch (error) {
      if (previousHost) {
        try {
          await listen(previousHost);
        } catch (restoreError) {
          error.message += '; restoring ' + previousHost + ' also failed: ' + restoreError.message;
        }
      }
      throw error;
    }
  }

  function status() {
    const enabled = host === '0.0.0.0';
    const address = server && server.address();
    const port = address && typeof address === 'object' ? address.port : configuredPort;
    const addresses = enabled
      ? localIPv4Addresses(networkInterfaces ? networkInterfaces() : undefined)
      : [];
    return {
      supported: true,
      enabled,
      host: host || '',
      port,
      addresses,
      pairingUrls: enabled ? buildPairingUrls(addresses, port, token) : []
    };
  }

  async function start(enabled) {
    if (enabled) {
      token = ensurePairingToken(userDataDir);
      process.env.WEBSTOCK_LAN_TOKEN = token;
    }
    await listen(enabled ? '0.0.0.0' : '127.0.0.1');
    return status();
  }

  async function setEnabled(enabled) {
    const desired = enabled === true;
    if (desired === (host === '0.0.0.0')) return status();

    const previousEnvironmentToken = process.env.WEBSTOCK_LAN_TOKEN;
    if (desired) {
      token = ensurePairingToken(userDataDir);
      process.env.WEBSTOCK_LAN_TOKEN = token;
    }

    try {
      await replaceHost(desired ? '0.0.0.0' : '127.0.0.1');
      writeLanEnabled(userDataDir, desired);
      if (!desired && token && process.env.WEBSTOCK_LAN_TOKEN === token) {
        delete process.env.WEBSTOCK_LAN_TOKEN;
      }
      return status();
    } catch (error) {
      if (previousEnvironmentToken === undefined) delete process.env.WEBSTOCK_LAN_TOKEN;
      else process.env.WEBSTOCK_LAN_TOKEN = previousEnvironmentToken;
      throw error;
    }
  }

  async function stop() {
    await close();
    host = null;
    if (token && process.env.WEBSTOCK_LAN_TOKEN === token) delete process.env.WEBSTOCK_LAN_TOKEN;
  }

  return { start, setEnabled, status, stop };
}

module.exports = { createLanServerController };
