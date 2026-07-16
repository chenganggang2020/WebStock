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

module.exports = {
  keepOnlyRunnableExe,
  prepareOutputDir
};
