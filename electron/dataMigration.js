const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

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
  migrateLegacyDatabase
};
