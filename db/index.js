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
