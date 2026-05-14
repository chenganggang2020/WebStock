const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const root = path.resolve(__dirname, '..');
const distRoot = path.join(root, 'dist');
const outDir = path.join(distRoot, 'WebStock-Portable');
const appDir = path.join(outDir, 'app');
const runtimeDir = path.join(outDir, 'runtime');

const appEntries = [
  'css',
  'db',
  'icons',
  'js',
  'prompt-templates',
  'routes',
  'services',
  'utils',
  'vendor',
  'ai-config.json',
  'funds.json',
  'index.html',
  'manifest.webmanifest',
  'package.json',
  'package-lock.json',
  'portable-launcher.js',
  'prompt.md',
  'prompt_adv.md',
  'server.js',
  'stocks.json',
  'sw.js',
  'WebStock.png'
];

function assertInside(parent, target) {
  const rel = path.relative(parent, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Refusing to touch path outside ' + parent + ': ' + target);
  }
}

function copyEntry(name) {
  const from = path.join(root, name);
  const to = path.join(appDir, name);
  if (!fs.existsSync(from)) return;
  fs.cpSync(from, to, { recursive: true });
}

function writeText(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content.replace(/\n/g, '\r\n'), 'utf8');
}

assertInside(distRoot, outDir);
fs.rmSync(outDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
fs.mkdirSync(appDir, { recursive: true });
fs.mkdirSync(runtimeDir, { recursive: true });
fs.mkdirSync(path.join(outDir, 'data'), { recursive: true });

appEntries.forEach(copyEntry);
fs.copyFileSync(process.execPath, path.join(runtimeDir, 'node.exe'));

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
childProcess.execSync(npmCommand + ' ci --omit=dev --no-audit --no-fund', {
  cwd: appDir,
  stdio: 'inherit',
  shell: true
});

if (fs.existsSync(path.join(root, 'data'))) {
  fs.cpSync(path.join(root, 'data'), path.join(outDir, 'data'), { recursive: true });
}

writeText(path.join(outDir, 'WebStock.cmd'), `@echo off
setlocal
cd /d "%~dp0app"
"%~dp0runtime\\node.exe" portable-launcher.js
pause
`);

writeText(path.join(outDir, 'README-PORTABLE.txt'), `WebStock Portable

1. Double-click WebStock.cmd to start.
2. Your browser will open automatically.
3. Keep the command window open while using WebStock.
4. Data is stored in the data folder next to this launcher.
5. Copy the whole WebStock-Portable folder to another Windows computer.
`);

console.log('Portable package created: ' + outDir);
