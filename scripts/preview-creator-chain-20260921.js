// Isolated UI acceptance server. Production database is opened read-only for an online backup.
const path = require('node:path');
const fs = require('node:fs/promises');
const Database = require('better-sqlite3');
async function main() {
  const root = path.resolve(__dirname, '..');
  const directory = path.join(root, 'output/verification/capital-creator-chain-20260921/preview');
  await fs.mkdir(directory, { recursive: true });
  const destination = path.join(directory, 'webstock.db');
  try { await fs.access(destination); }
  catch {
    const original = new Database(path.join(root, 'dist/module-placement-20260920/WebStockData/webstock.db'), { readonly: true, fileMustExist: true });
    try { await original.backup(destination); } finally { original.close(); }
  }
  process.env.WEBSTOCK_DB_PATH = destination;
  process.env.WEBSTOCK_BUILD_SMOKE_TEST = '1';
  process.env.WEBSTOCK_LOCAL_SAMPLING_AUTO = '0';
  const app = require('../server');
  const server = app.listen(43931, '127.0.0.1', () => console.log('Isolated preview http://127.0.0.1:43931; database=' + destination));
  process.on('SIGINT', () => server.close(() => process.exit(0)));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
