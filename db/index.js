const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const defaultDataDir = path.join(__dirname, '..', 'data');
const dbPath = process.env.WEBSTOCK_DB_PATH || path.join(defaultDataDir, 'webstock.db');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

let db;
try {
  db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  const initSql = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf8');
  db.exec(initSql);
  const ensureColumn = (table, column, definition) => {
    const columns = db.prepare('PRAGMA table_info(' + table + ')').all();
    if (!columns.some(item => item.name === column)) {
      db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' ' + definition);
    }
  };
  ensureColumn('expert_observations', 'published_time_precision', "TEXT NOT NULL DEFAULT 'unknown'");
  ensureColumn('expert_backtests', 'run_id', "TEXT DEFAULT ''");
  ensureColumn('expert_backtests', 'dataset_id', "TEXT DEFAULT ''");
  ensureColumn('expert_backtests', 'result_path', "TEXT DEFAULT ''");
  ensureColumn('expert_backtests', 'result_sha256', "TEXT DEFAULT ''");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_expert_backtests_run_id ON expert_backtests(run_id) WHERE run_id <> ''");
} catch (error) {
  console.error('[DB] SQLite 初始化失败：' + error.message);
  throw error;
}

function getDb() {
  return db;
}

module.exports = db;
module.exports.getDb = getDb;
module.exports.dbPath = dbPath;
