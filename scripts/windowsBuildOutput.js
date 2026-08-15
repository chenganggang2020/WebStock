const fs = require('fs');
const path = require('path');

const PORTABLE_DATA_DIR = 'WebStockData';

function assertInsideRoot(root, targetPath) {
  const relative = path.relative(root, targetPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Refusing to remove build output outside project: ' + targetPath);
  }
}

function isPortableData(entry) {
  return entry.isDirectory() && entry.name.toLowerCase() === PORTABLE_DATA_DIR.toLowerCase();
}

function prepareOutputDir(root, outputDir) {
  assertInsideRoot(root, outputDir);
  fs.mkdirSync(outputDir, { recursive: true });
  for (const entry of fs.readdirSync(outputDir, { withFileTypes: true })) {
    if (isPortableData(entry)) continue;
    fs.rmSync(path.join(outputDir, entry.name), { recursive: true, force: true });
  }
}

function keepOnlyRunnableExe(root, outputDir) {
  assertInsideRoot(root, outputDir);
  if (!fs.existsSync(outputDir)) return;
  for (const entry of fs.readdirSync(outputDir, { withFileTypes: true })) {
    if (isPortableData(entry)) continue;
    const fullPath = path.join(outputDir, entry.name);
    const isRunnableExe = entry.isFile() && /\.exe$/i.test(entry.name) && !/\.__uninstaller\.exe$/i.test(entry.name);
    if (!isRunnableExe) fs.rmSync(fullPath, { recursive: true, force: true });
  }
}

function runnableExecutables(outputDir) {
  if (!fs.existsSync(outputDir)) return [];
  return fs.readdirSync(outputDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.exe$/i.test(entry.name) && !/\.__uninstaller\.exe$/i.test(entry.name));
}

function promoteRunnableExe(root, stagingDir, outputDir) {
  assertInsideRoot(root, stagingDir);
  assertInsideRoot(root, outputDir);
  const executables = runnableExecutables(stagingDir);
  if (executables.length !== 1) {
    throw new Error('Expected exactly one runnable EXE in completed build output: ' + stagingDir);
  }

  const entry = executables[0];
  const source = path.join(stagingDir, entry.name);
  const sourceSize = fs.statSync(source).size;
  if (sourceSize <= 0) throw new Error('Completed build EXE is empty: ' + source);

  fs.mkdirSync(outputDir, { recursive: true });
  const target = path.join(outputDir, entry.name);
  const ready = path.join(outputDir, '.' + entry.name + '.ready-' + process.pid);
  const backup = path.join(outputDir, '.' + entry.name + '.previous-' + process.pid);
  fs.copyFileSync(source, ready);
  if (fs.statSync(ready).size !== sourceSize) {
    fs.rmSync(ready, { force: true });
    throw new Error('Completed build EXE copy is incomplete: ' + ready);
  }

  let backedUp = false;
  try {
    if (fs.existsSync(target)) {
      fs.renameSync(target, backup);
      backedUp = true;
    }
    fs.renameSync(ready, target);
    for (const oldEntry of fs.readdirSync(outputDir, { withFileTypes: true })) {
      if (isPortableData(oldEntry) || oldEntry.name === entry.name || oldEntry.name === path.basename(backup)) continue;
      fs.rmSync(path.join(outputDir, oldEntry.name), { recursive: true, force: true });
    }
    if (backedUp) fs.rmSync(backup, { force: true });
    return target;
  } catch (error) {
    fs.rmSync(ready, { force: true });
    if (!fs.existsSync(target) && backedUp && fs.existsSync(backup)) fs.renameSync(backup, target);
    throw error;
  }
}

module.exports = {
  keepOnlyRunnableExe,
  prepareOutputDir,
  promoteRunnableExe
};
