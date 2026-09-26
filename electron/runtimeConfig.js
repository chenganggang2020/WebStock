const path = require('path');
const fs = require('fs');

const DEFAULT_DESKTOP_PORT = 3000;

function normalizePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : DEFAULT_DESKTOP_PORT;
}

function readManagedDataDirectory(executableDir) {
  if (!executableDir) return '';
  const file = path.join(executableDir, 'runtime-location.json');
  if (!fs.existsSync(file)) return '';
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (value.schema !== 'webstock.runtime-location/v1') throw new Error('Unsupported runtime location schema');
  if (typeof value.dataDir !== 'string' || !path.isAbsolute(value.dataDir)) throw new Error('Runtime data directory must be absolute');
  if (!fs.statSync(path.join(value.dataDir, 'webstock.db'), { throwIfNoEntry: false })?.isFile()) {
    throw new Error('Configured runtime database is missing; refusing to create an empty replacement');
  }
  return path.resolve(value.dataDir);
}

function resolveRuntimeConfig(options = {}) {
  const portableExecutableDir = String(options.portableExecutableDir || '').trim();
  const defaultUserDataDir = String(options.defaultUserDataDir || '').trim();
  const linkedDataDir = String(options.linkedDataDir || '').trim();
  const managedDataDir = String(options.managedDataDir || '').trim();
  if (!defaultUserDataDir) throw new Error('Electron user data directory is required');

  const portable = Boolean(portableExecutableDir);
  const userDataDir = managedDataDir || (portable
    ? path.join(portableExecutableDir, 'WebStockData')
    : defaultUserDataDir);
  const dataDir = managedDataDir || (portable ? userDataDir : (linkedDataDir || userDataDir));
  return {
    portable,
    managed: Boolean(managedDataDir),
    userDataDir,
    dataDir,
    dbPath: path.join(dataDir, 'webstock.db'),
    legacyDbPath: portable && !managedDataDir ? path.join(linkedDataDir || defaultUserDataDir, 'webstock.db') : null,
    level2ConfigPath: path.join(dataDir, 'level2-config.json'),
    quantWorkspacePath: path.join(dataDir, 'quant-workspace'),
    port: normalizePort(options.port)
  };
}

module.exports = {
  DEFAULT_DESKTOP_PORT,
  normalizePort,
  readManagedDataDirectory,
  resolveRuntimeConfig
};
