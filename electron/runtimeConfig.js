const path = require('path');

const DEFAULT_DESKTOP_PORT = 3000;

function normalizePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : DEFAULT_DESKTOP_PORT;
}

function resolveRuntimeConfig(options = {}) {
  const portableExecutableDir = String(options.portableExecutableDir || '').trim();
  const defaultUserDataDir = String(options.defaultUserDataDir || '').trim();
  if (!defaultUserDataDir) throw new Error('Electron user data directory is required');

  const portable = Boolean(portableExecutableDir);
  const userDataDir = portable
    ? path.join(portableExecutableDir, 'WebStockData')
    : defaultUserDataDir;
  return {
    portable,
    userDataDir,
    dbPath: path.join(userDataDir, 'webstock.db'),
    legacyDbPath: portable ? path.join(defaultUserDataDir, 'webstock.db') : null,
    level2ConfigPath: path.join(userDataDir, 'level2-config.json'),
    port: normalizePort(options.port)
  };
}

module.exports = {
  DEFAULT_DESKTOP_PORT,
  normalizePort,
  resolveRuntimeConfig
};
