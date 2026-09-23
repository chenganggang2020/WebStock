const fs = require('node:fs');
const path = require('node:path');

const LINK_SCHEMA = 'webstock.quant-runtime-link/v1';
const LINK_FILE = 'runtime-link.json';

function runtimeLinkPath(workspace) {
  return path.join(path.resolve(workspace), LINK_FILE);
}

function normalizePythonPath(value) {
  const candidate = String(value || '').trim();
  if (!candidate || !path.isAbsolute(candidate) || candidate.startsWith('\\\\')) {
    throw new Error('已有环境路径必须是本机绝对路径。');
  }
  if (path.basename(candidate).toLowerCase() !== 'python.exe') {
    throw new Error('请选择已有量化环境中的 python.exe。');
  }
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    throw new Error('已有量化环境的 python.exe 不存在。');
  }
  return fs.realpathSync(candidate);
}

function normalizeVersions(value) {
  const source = value && typeof value === 'object' ? value : {};
  const versions = {};
  ['python', 'qlib', 'lightgbm', 'pandas', 'pyarrow', 'baostock', 'faster_whisper', 'torch'].forEach(name => {
    const version = String(source[name] || '').trim().slice(0, 80);
    if (version) versions[name] = version;
  });
  return versions;
}

function saveRuntimeLink(workspace, input = {}) {
  const target = runtimeLinkPath(workspace);
  const record = {
    schema: LINK_SCHEMA,
    pythonPath: normalizePythonPath(input.pythonPath),
    linkedAt: String(input.linkedAt || new Date().toISOString()),
    versions: normalizeVersions(input.versions)
  };
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = target + '.tmp-' + process.pid;
  fs.writeFileSync(temporary, JSON.stringify(record, null, 2), 'utf8');
  fs.renameSync(temporary, target);
  return record;
}

function readRuntimeLink(workspace) {
  const target = runtimeLinkPath(workspace);
  if (!fs.existsSync(target)) return null;
  let record;
  try {
    record = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (error) {
    throw new Error('已有量化环境关联文件损坏。');
  }
  if (!record || record.schema !== LINK_SCHEMA) throw new Error('已有量化环境关联文件版本无效。');
  return {
    schema: LINK_SCHEMA,
    pythonPath: normalizePythonPath(record.pythonPath),
    linkedAt: String(record.linkedAt || ''),
    versions: normalizeVersions(record.versions)
  };
}

module.exports = {
  LINK_SCHEMA,
  runtimeLinkPath,
  normalizePythonPath,
  saveRuntimeLink,
  readRuntimeLink
};
