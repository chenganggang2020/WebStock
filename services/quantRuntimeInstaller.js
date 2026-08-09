const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

const HASH_RE = /^[a-f0-9]{64}$/;
const DOWNLOAD_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com'
]);
const INDEXES = {
  official: 'https://pypi.org/simple',
  china: 'https://pypi.tuna.tsinghua.edu.cn/simple'
};

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function inside(root, target, allowRoot) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (!relative) return !!allowRoot;
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function childPath(root, relative, label) {
  const value = String(relative || '').trim();
  if (!value || path.isAbsolute(value)) throw new Error(label + '路径无效。');
  const target = path.resolve(root, value);
  if (!inside(root, target, false)) throw new Error(label + '路径超出允许目录。');
  return target;
}

function runtimePythonPath(workspace, runtimeName = 'runtime') {
  return path.join(path.resolve(workspace), runtimeName, 'venv', 'Scripts', 'python.exe');
}

function loadRuntimeManifest(quantRoot, options = {}) {
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  if (platform !== 'win32' || arch !== 'x64') throw new Error('量化环境自动安装目前仅支持 Windows x64。');
  const manifestPath = path.join(path.resolve(quantRoot), 'runtime-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schema !== 'webstock.quant-runtime/v1') throw new Error('量化环境清单版本无效。');
  if (manifest.platform !== platform || manifest.arch !== arch) throw new Error('量化环境清单与当前系统不匹配。');
  if (!/^3\.12\.\d+$/.test(String(manifest.python || ''))) throw new Error('量化环境 Python 版本未固定为 3.12 补丁版本。');
  if (!manifest.uv || !HASH_RE.test(String(manifest.uv.sha256 || '').toLowerCase())) throw new Error('uv 下载哈希无效。');
  const url = new URL(String(manifest.uv.url || ''));
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.startsWith('/astral-sh/uv/releases/download/')) {
    throw new Error('uv 下载地址不是允许的官方 GitHub 发布地址。');
  }
  if (manifest.uv.bundledFile) {
    const bundledPath = childPath(quantRoot, manifest.uv.bundledFile, 'uv 内置资源');
    if (!fs.existsSync(bundledPath)) throw new Error('uv 内置资源缺失。');
    if (sha256File(bundledPath) !== manifest.uv.sha256.toLowerCase()) throw new Error('uv 内置资源 SHA-256 校验失败。');
  }
  childPath(quantRoot, manifest.uv.executable, 'uv 可执行文件');
  if (!manifest.requirements || !HASH_RE.test(String(manifest.requirements.sha256 || '').toLowerCase())) {
    throw new Error('依赖锁文件哈希无效。');
  }
  const requirementsPath = childPath(quantRoot, manifest.requirements.file, '依赖锁文件');
  if (!fs.existsSync(requirementsPath)) throw new Error('依赖锁文件缺失。');
  if (sha256File(requirementsPath) !== manifest.requirements.sha256.toLowerCase()) {
    throw new Error('依赖锁文件与固定哈希不一致。');
  }
  if (!Number.isFinite(Number(manifest.estimatedBytes)) || Number(manifest.estimatedBytes) <= 0) {
    throw new Error('量化环境预计磁盘空间无效。');
  }
  return manifest;
}

function validateDownloadUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !DOWNLOAD_HOSTS.has(url.hostname)) {
    throw new Error('下载跳转超出允许的 GitHub 主机。');
  }
  return url;
}

function defaultDownloadFile(urlValue, target, options = {}, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error('量化环境下载重定向次数过多。'));
  const url = validateDownloadUrl(urlValue);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  return new Promise((resolve, reject) => {
    const request = https.get(url, { signal: options.signal, headers: { 'User-Agent': 'WebStock-Quant-Runtime/1.0' } }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        const next = new URL(response.headers.location, url).toString();
        return resolve(defaultDownloadFile(next, target, options, redirects + 1));
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error('量化环境下载失败，HTTP ' + response.statusCode + '。'));
      }
      const total = Number(response.headers['content-length'] || 0);
      let current = 0;
      const output = fs.createWriteStream(target, { flags: 'w' });
      response.on('data', chunk => {
        current += chunk.length;
        if (options.onProgress) options.onProgress(current, total);
      });
      response.pipe(output);
      output.on('finish', () => output.close(resolve));
      output.on('error', reject);
      response.on('error', reject);
    });
    request.setTimeout(45000, () => request.destroy(new Error('量化环境下载超时。')));
    request.on('error', error => {
      try { fs.rmSync(target, { force: true }); } catch (_) {}
      reject(error);
    });
  });
}

function runSpawn(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(executable, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      windowsHide: true,
      signal: options.signal
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout = (stdout + chunk).slice(-30000);
      if (options.onOutput) options.onOutput(chunk);
    });
    child.stderr.on('data', chunk => {
      stderr = (stderr + chunk).slice(-30000);
      if (options.onOutput) options.onOutput(chunk);
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) return resolve({ stdout, stderr });
      const detail = stderr.trim().split(/\r?\n/).filter(Boolean).slice(-8).join('\n') ||
        stdout.trim().split(/\r?\n/).filter(Boolean).slice(-8).join('\n');
      reject(new Error(detail || '命令执行失败，退出代码：' + code));
    });
  });
}

function defaultExtractArchive(archive, target, options = {}) {
  fs.mkdirSync(target, { recursive: true });
  return runSpawn('tar.exe', ['-xf', archive, '-C', target], options);
}

function parseHealth(stdout) {
  const line = String(stdout || '').split(/\r?\n/).find(item => item.startsWith('WEBSTOCK_RESULT='));
  if (!line) throw new Error('量化运行环境没有返回健康检查结果。');
  const result = JSON.parse(line.slice('WEBSTOCK_RESULT='.length));
  if (!result.verified || result.status !== 'available') throw new Error('量化运行环境健康检查未通过。');
  return result;
}

function findManagedPythonHome(pythonInstall) {
  const matches = [];
  if (fs.existsSync(pythonInstall)) {
    fs.readdirSync(pythonInstall, { withFileTypes: true }).filter(entry => entry.isDirectory()).forEach(entry => {
      const home = path.join(pythonInstall, entry.name);
      if (fs.existsSync(path.join(home, 'python.exe'))) matches.push(home);
    });
  }
  if (matches.length !== 1) throw new Error('无法唯一确定量化环境的托管 Python 目录。');
  return matches[0];
}

function rewriteVenvHome(venv, pythonInstall) {
  const configPath = path.join(venv, 'pyvenv.cfg');
  if (!fs.existsSync(configPath)) throw new Error('量化虚拟环境缺少 pyvenv.cfg。');
  const home = findManagedPythonHome(pythonInstall);
  const python = path.join(home, 'python.exe');
  const lines = fs.readFileSync(configPath, 'utf8').split(/\r?\n/);
  let foundHome = false;
  const updated = lines.map(line => {
    const key = String(line.split('=', 1)[0] || '').trim().toLowerCase();
    if (key === 'home') {
      foundHome = true;
      return 'home = ' + home;
    }
    if (key === 'executable') return 'executable = ' + python;
    return line;
  });
  if (!foundHome) updated.unshift('home = ' + home);
  fs.writeFileSync(configPath, updated.join('\r\n'), 'utf8');
  return home;
}

function availableBytes(target) {
  const stats = fs.statfsSync(target);
  return Number(stats.bavail) * Number(stats.bsize);
}

function createRuntimeInstaller(options = {}) {
  const workspace = path.resolve(options.workspace);
  const quantRoot = path.resolve(options.quantRoot);
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const downloadFile = options.downloadFile || defaultDownloadFile;
  const extractArchive = options.extractArchive || defaultExtractArchive;
  const runCommand = options.runCommand || runSpawn;
  const now = options.now || (() => new Date().toISOString());
  const getAvailableBytes = options.availableBytes || availableBytes;

  function paths() {
    const staging = path.join(workspace, '.runtime-staging');
    return {
      workspace,
      runtime: path.join(workspace, 'runtime'),
      backup: path.join(workspace, '.runtime-backup'),
      staging,
      archive: path.join(staging, 'uv.zip'),
      tools: path.join(staging, 'tools'),
      pythonInstall: path.join(staging, 'python'),
      cache: path.join(staging, 'cache'),
      venv: path.join(staging, 'venv'),
      stagedPython: runtimePythonPath(workspace, '.runtime-staging'),
      finalPython: runtimePythonPath(workspace),
      receipt: path.join(staging, 'install-receipt.json')
    };
  }

  async function install(input = {}) {
    const manifest = loadRuntimeManifest(quantRoot, { platform, arch });
    const target = paths();
    const signal = input.signal;
    const emit = (stage, message, extra) => {
      if (input.onProgress) input.onProgress(Object.assign({ stage, message }, extra || {}));
    };
    fs.mkdirSync(workspace, { recursive: true });
    const freeBytes = Number(getAvailableBytes(workspace));
    if (!Number.isFinite(freeBytes) || freeBytes < Number(manifest.estimatedBytes)) {
      const requiredGb = (Number(manifest.estimatedBytes) / 1024 / 1024 / 1024).toFixed(1);
      const freeGb = Number.isFinite(freeBytes) ? (freeBytes / 1024 / 1024 / 1024).toFixed(1) : '--';
      throw new Error('量化环境需要约 ' + requiredGb + ' GB 可用空间，当前仅 ' + freeGb + ' GB。');
    }
    if (!inside(workspace, target.staging) || !inside(workspace, target.runtime) || !inside(workspace, target.backup)) {
      throw new Error('量化环境目录超出工作区。');
    }
    if (!fs.existsSync(target.runtime) && fs.existsSync(target.backup)) fs.renameSync(target.backup, target.runtime);
    if (fs.existsSync(target.runtime) && fs.existsSync(target.finalPython) && !input.force) {
      throw new Error('量化运行环境已经安装；如需重装请选择修复环境。');
    }
    fs.rmSync(target.staging, { recursive: true, force: true });
    fs.mkdirSync(target.staging, { recursive: true });
    let activated = false;
    let previousMoved = false;
    try {
      emit('prepare', '正在核对安装清单和磁盘目录。');
      const bundledArchive = manifest.uv.bundledFile
        ? childPath(quantRoot, manifest.uv.bundledFile, 'uv 内置资源')
        : null;
      if (bundledArchive) {
        emit('download', '正在读取随 WebStock 提供的已校验 uv 安装工具。');
        fs.copyFileSync(bundledArchive, target.archive);
      } else {
        emit('download', '正在从 uv 官方 GitHub 发布页下载安装工具。', { current: 0, total: 0 });
        await downloadFile(manifest.uv.url, target.archive, {
          signal,
          onProgress(current, total) {
            emit('download', '正在下载经过固定版本的 uv 安装工具。', { current, total });
          }
        });
      }
      if (sha256File(target.archive) !== manifest.uv.sha256.toLowerCase()) throw new Error('uv 下载文件 SHA-256 校验失败。');

      emit('extract', '下载校验通过，正在解压安装工具。');
      await extractArchive(target.archive, target.tools, { signal });
      const uvExecutable = childPath(target.tools, manifest.uv.executable, 'uv 可执行文件');
      if (!fs.existsSync(uvExecutable)) throw new Error('uv 压缩包内缺少预期的可执行文件。');
      const env = Object.assign({}, process.env, {
        UV_CACHE_DIR: target.cache,
        UV_PYTHON_INSTALL_DIR: target.pythonInstall,
        UV_PYTHON_BIN_DIR: path.join(target.staging, 'bin'),
        UV_NO_MODIFY_PATH: '1',
        UV_NO_CONFIG: '1',
        UV_NATIVE_TLS: 'true',
        PYTHONUTF8: '1'
      });
      const commandOptions = { cwd: target.staging, env, signal };

      emit('python', '正在安装固定版本 Python ' + manifest.python + '。');
      await runCommand(uvExecutable, [
        'python', 'install', manifest.python,
        '--install-dir', target.pythonInstall,
        '--no-bin', '--no-registry', '--compile-bytecode',
        '--cache-dir', target.cache, '--no-progress', '--no-config', '--native-tls'
      ], commandOptions);

      emit('environment', '正在创建 WebStock 独立量化环境。');
      await runCommand(uvExecutable, [
        'venv', '--python', manifest.python, '--managed-python', '--no-python-downloads',
        '--relocatable', '--cache-dir', target.cache, '--no-config', target.venv
      ], commandOptions);
      if (!fs.existsSync(target.stagedPython)) throw new Error('独立 Python 环境创建后未找到 python.exe。');

      const indexMode = input.indexMode === 'china' ? 'china' : 'official';
      const requirementsPath = childPath(quantRoot, manifest.requirements.file, '依赖锁文件');
      emit('packages', '正在安装并校验 Qlib、LightGBM 与数据依赖。');
      await runCommand(uvExecutable, [
        'pip', 'install', '--python', target.stagedPython, '--require-hashes',
        '--default-index', INDEXES[indexMode], '--cache-dir', target.cache,
        '--no-config', '--native-tls', '-r', requirementsPath
      ], commandOptions);

      emit('verify', '正在导入 Qlib 和 LightGBM 进行健康检查。');
      const healthEnv = Object.assign({}, env, { PYTHONPATH: quantRoot, MLFLOW_ALLOW_FILE_STORE: 'true' });
      const stagedHealth = await runCommand(target.stagedPython, [path.join(quantRoot, 'runner.py'), 'health', '--verify'], {
        cwd: target.staging,
        env: healthEnv,
        signal
      });
      const health = parseHealth(stagedHealth.stdout);
      fs.rmSync(target.archive, { force: true });
      fs.rmSync(target.tools, { recursive: true, force: true });
      fs.rmSync(target.cache, { recursive: true, force: true });
      fs.writeFileSync(target.receipt, JSON.stringify({
        schema: 'webstock.quant-runtime-receipt/v1',
        installedAt: now(),
        platform,
        arch,
        python: manifest.python,
        uvVersion: manifest.uv.version,
        uvArchiveSha256: manifest.uv.sha256.toLowerCase(),
        requirementsSha256: manifest.requirements.sha256.toLowerCase(),
        packages: health.packages || {},
        verified: true
      }, null, 2), 'utf8');

      emit('activate', '健康检查通过，正在启用新环境。');
      fs.rmSync(target.backup, { recursive: true, force: true });
      if (fs.existsSync(target.runtime)) {
        fs.renameSync(target.runtime, target.backup);
        previousMoved = true;
      }
      fs.renameSync(target.staging, target.runtime);
      activated = true;
      rewriteVenvHome(path.join(target.runtime, 'venv'), path.join(target.runtime, 'python'));
      const finalHealth = await runCommand(target.finalPython, [path.join(quantRoot, 'runner.py'), 'health', '--verify'], {
        cwd: target.runtime,
        env: Object.assign({}, healthEnv, {
          UV_CACHE_DIR: path.join(target.runtime, 'cache'),
          UV_PYTHON_INSTALL_DIR: path.join(target.runtime, 'python')
        }),
        signal
      });
      parseHealth(finalHealth.stdout);
      fs.rmSync(target.backup, { recursive: true, force: true });
      emit('completed', '量化运行环境安装并验证完成。');
      return {
        installed: true,
        verified: true,
        installedAt: now(),
        python: target.finalPython,
        versions: health.packages || {}
      };
    } catch (error) {
      if (activated) fs.rmSync(target.runtime, { recursive: true, force: true });
      if (previousMoved && fs.existsSync(target.backup) && !fs.existsSync(target.runtime)) {
        fs.renameSync(target.backup, target.runtime);
      }
      fs.rmSync(target.staging, { recursive: true, force: true });
      throw error;
    }
  }

  return { install, paths };
}

module.exports = {
  createRuntimeInstaller,
  loadRuntimeManifest,
  runtimePythonPath,
  defaultDownloadFile,
  defaultExtractArchive,
  runSpawn,
  rewriteVenvHome,
  availableBytes
};
