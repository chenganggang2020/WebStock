const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  prepareOutputDir,
  keepOnlyRunnableExe,
  promoteRunnableExe
} = require('./windowsBuildOutput');

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

function prepareWindowsBuildEnvironment() {
  if (!isWindows) return;
  process.env.ELECTRON_MIRROR = process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/';
  process.env.ELECTRON_BUILDER_BINARIES_MIRROR = process.env.ELECTRON_BUILDER_BINARIES_MIRROR || 'https://npmmirror.com/mirrors/electron-builder-binaries/';
}

const firstArg = process.argv[2];
const target = firstArg && !firstArg.startsWith('-') ? firstArg : 'nsis';
const extraArgs = firstArg && firstArg.startsWith('-') ? process.argv.slice(2) : process.argv.slice(3);
const electronVersion = String(pkg.devDependencies.electron || '').replace(/^[^\d]*/, '');

function outputDirFromArgs() {
  const configArg = extraArgs.find(arg => arg.startsWith('--config.directories.output='));
  const configured = configArg
    ? configArg.slice('--config.directories.output='.length)
    : (pkg.build && pkg.build.directories && pkg.build.directories.output) || 'dist';
  return path.resolve(root, configured);
}

let buildError = null;
let stagingDir = null;

try {
  const outputDir = outputDirFromArgs();
  const stagedBuild = target === 'nsis' || target === 'portable';
  stagingDir = stagedBuild
    ? path.join(path.dirname(outputDir), '.' + path.basename(outputDir) + '-building')
    : outputDir;
  prepareOutputDir(root, stagingDir);
  prepareWindowsBuildEnvironment();

  const electronRebuild = nodeScript(path.join(root, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js'));
  run('Rebuild native modules for Electron ' + electronVersion, electronRebuild[0], electronRebuild[1].concat([
    '--force',
    '--only',
    'better-sqlite3',
    '--version',
    electronVersion
  ]));

  const electronBuilder = nodeScript(path.join(root, 'node_modules', 'electron-builder', 'cli.js'));
  const builderArgs = extraArgs
    .filter(arg => !arg.startsWith('--config.directories.output='))
    .concat(['--config.directories.output=' + stagingDir]);
  run('Build Windows ' + target + ' package', electronBuilder[0], electronBuilder[1].concat(['--win', target], builderArgs));
  if (stagedBuild) {
    keepOnlyRunnableExe(root, stagingDir);
    if (target === 'portable') {
      run('Verify Windows portable package', process.execPath, [
        path.join(root, 'scripts', 'verify-portable-artifact.js'),
        stagingDir
      ]);
    }
    const artifact = promoteRunnableExe(root, stagingDir, outputDir);
    console.log('Promoted completed package: ' + artifact);
    fs.rmSync(stagingDir, { recursive: true, force: true });
    stagingDir = null;
  }
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
