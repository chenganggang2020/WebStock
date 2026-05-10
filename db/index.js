const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.WEBSTOCK_DB_PATH || path.join(dataDir, 'webstock.db');

let db;
try {
  db = new Database(dbPath);
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
