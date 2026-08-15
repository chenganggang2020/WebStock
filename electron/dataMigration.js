const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_LOCATION_FILE = 'data-location.json';

function dataLocationPath(userDataDir) {
  return path.join(String(userDataDir || '').trim(), DATA_LOCATION_FILE);
}

function readRegisteredDataDirectory(userDataDir) {
  const file = dataLocationPath(userDataDir);
  try {
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    const dataDir = String(payload && payload.dataDir || '').trim();
    return dataDir && fs.existsSync(path.join(dataDir, 'webstock.db')) ? dataDir : '';
  } catch (_) {
    return '';
  }
}

function registerPortableDataDirectory(options = {}) {
  const userDataDir = String(options.userDataDir || '').trim();
  const dataDir = String(options.dataDir || '').trim();
  if (!userDataDir || !dataDir) return { registered: false, reason: 'path-missing' };
  if (!fs.existsSync(path.join(dataDir, 'webstock.db'))) {
    return { registered: false, reason: 'database-missing' };
  }
  fs.mkdirSync(userDataDir, { recursive: true });
  const file = dataLocationPath(userDataDir);
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify({
    schema: 'webstock.data-location/v1',
    dataDir: path.resolve(dataDir),
    updatedAt: new Date().toISOString()
  }, null, 2), 'utf8');
  fs.renameSync(temporary, file);
  return { registered: true, file, dataDir: path.resolve(dataDir) };
}

async function migrateLegacyDatabase(options = {}) {
  const targetDbPath = String(options.targetDbPath || '').trim();
  const legacyDbPath = String(options.legacyDbPath || '').trim();
  if (!options.portable) return { migrated: false, reason: 'not-portable' };
  if (!targetDbPath || !legacyDbPath) return { migrated: false, reason: 'path-missing' };
  if (path.resolve(targetDbPath) === path.resolve(legacyDbPath)) {
    return { migrated: false, reason: 'same-path' };
  }
  if (fs.existsSync(targetDbPath)) return { migrated: false, reason: 'target-exists' };
  if (!fs.existsSync(legacyDbPath)) return { migrated: false, reason: 'legacy-missing' };

  fs.mkdirSync(path.dirname(targetDbPath), { recursive: true });
  const source = new Database(legacyDbPath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(targetDbPath);
  } catch (error) {
    if (fs.existsSync(targetDbPath)) fs.rmSync(targetDbPath, { force: true });
    throw error;
  } finally {
    source.close();
  }
  return { migrated: true, source: legacyDbPath, target: targetDbPath };
}

module.exports = {
  migrateLegacyDatabase,
  readRegisteredDataDirectory,
  registerPortableDataDirectory
};
