const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const isWindows = process.platform === 'win32';

function nodeScript() {
  return [process.execPath, Array.from(arguments)];
}

function run(label, command, args, options) {
  console.log('\n> ' + label);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: options && options.shell
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(label + ' failed with exit code ' + result.status);
  }
}

function npmCommand() {
  return isWindows ? 'npm.cmd' : 'npm';
}

const firstArg = process.argv[2];
const target = firstArg && !firstArg.startsWith('-') ? firstArg : 'nsis';
const extraArgs = firstArg && firstArg.startsWith('-') ? process.argv.slice(2) : process.argv.slice(3);
const electronVersion = String(pkg.devDependencies.electron || '').replace(/^[^\d]*/, '');

let buildError = null;

try {
  const electronRebuild = nodeScript(path.join(root, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js'));
  run('Rebuild native modules for Electron ' + electronVersion, electronRebuild[0], electronRebuild[1].concat([
    '--force',
    '--only',
    'better-sqlite3',
    '--version',
    electronVersion
  ]));

  const electronBuilder = nodeScript(path.join(root, 'node_modules', 'electron-builder', 'cli.js'));
  run('Build Windows ' + target + ' package', electronBuilder[0], electronBuilder[1].concat(['--win', target], extraArgs));
} catch (error) {
  buildError = error;
} finally {
  try {
    run('Restore native modules for local Node.js', npmCommand(), ['rebuild', 'better-sqlite3'], { shell: isWindows });
  } catch (restoreError) {
    if (!buildError) buildError = restoreError;
  }
}

if (buildError) {
  console.error(buildError.message || buildError);
  process.exit(1);
}
