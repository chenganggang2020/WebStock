const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const electronVersion = String(pkg.devDependencies.electron || '').replace(/^[^\d]*/, '');
const electronRebuild = path.join(root, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js');
const playwright = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(path.basename(command) + ' failed with exit code ' + result.status);
}

let failed = null;
try {
  run(process.execPath, [electronRebuild, '--force', '--only', 'better-sqlite3', '--version', electronVersion]);
  run(process.execPath, [playwright, 'test', 'test/desktop-lan.spec.js', '--workers=1']);
} catch (error) {
  failed = error;
} finally {
  try {
    if (!process.env.npm_execpath) throw new Error('npm_execpath is required to restore better-sqlite3');
    run(process.execPath, [process.env.npm_execpath, 'rebuild', 'better-sqlite3']);
  } catch (restoreError) {
    if (!failed) failed = restoreError;
  }
}

if (failed) {
  console.error(failed.message || failed);
  process.exit(1);
}
