const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createRuntimeInstaller,
  loadRuntimeManifest,
  runtimePythonPath
} = require('../services/quantRuntimeInstaller');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-runtime-installer-'));
  const quantRoot = path.join(root, 'quant');
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(quantRoot, { recursive: true });
  const lock = Buffer.from('demo-package==1.0.0 --hash=sha256:' + 'a'.repeat(64) + '\n');
  const archive = Buffer.from('verified uv archive');
  fs.writeFileSync(path.join(quantRoot, 'requirements.lock'), lock);
  fs.writeFileSync(path.join(quantRoot, 'runner.py'), 'print("health")\n');
  fs.writeFileSync(path.join(quantRoot, 'runtime-manifest.json'), JSON.stringify({
    schema: 'webstock.quant-runtime/v1',
    platform: 'win32',
    arch: 'x64',
    python: '3.12.13',
    uv: {
      version: '0.10.12',
      url: 'https://github.com/astral-sh/uv/releases/download/0.10.12/uv-x86_64-pc-windows-msvc.zip',
      sha256: sha256(archive),
      executable: 'uv.exe'
    },
    requirements: { file: 'requirements.lock', sha256: sha256(lock) },
    estimatedBytes: 1024
  }, null, 2));
  return { root, quantRoot, workspace, archive };
}

test('runtime manifest pins official HTTPS assets and the requirements lock hash', t => {
  const files = fixture();
  t.after(() => fs.rmSync(files.root, { recursive: true, force: true }));
  const manifest = loadRuntimeManifest(files.quantRoot, { platform: 'win32', arch: 'x64' });
  assert.equal(manifest.python, '3.12.13');
  assert.equal(manifest.uv.version, '0.10.12');

  const lockPath = path.join(files.quantRoot, 'requirements.lock');
  fs.appendFileSync(lockPath, '# changed\n');
  assert.throws(
    () => loadRuntimeManifest(files.quantRoot, { platform: 'win32', arch: 'x64' }),
    /锁文件.*哈希/
  );
});

test('runtime manifest rejects unsupported platforms and non-GitHub downloads', t => {
  const files = fixture();
  t.after(() => fs.rmSync(files.root, { recursive: true, force: true }));
  assert.throws(
    () => loadRuntimeManifest(files.quantRoot, { platform: 'linux', arch: 'x64' }),
    /仅支持 Windows x64/
  );
  const manifestPath = path.join(files.quantRoot, 'runtime-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.uv.url = 'https://example.com/uv.zip';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(
    () => loadRuntimeManifest(files.quantRoot, { platform: 'win32', arch: 'x64' }),
    /下载地址/
  );
});

test('runtime manifest rejects a corrupted bundled uv archive', t => {
  const files = fixture();
  t.after(() => fs.rmSync(files.root, { recursive: true, force: true }));
  const manifestPath = path.join(files.quantRoot, 'runtime-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.uv.bundledFile = 'runtime-assets/uv.zip';
  fs.mkdirSync(path.join(files.quantRoot, 'runtime-assets'), { recursive: true });
  fs.writeFileSync(path.join(files.quantRoot, manifest.uv.bundledFile), 'corrupted');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(
    () => loadRuntimeManifest(files.quantRoot, { platform: 'win32', arch: 'x64' }),
    /内置资源.*SHA-256/
  );
});

test('failed repair keeps the previous verified runtime untouched', async t => {
  const files = fixture();
  t.after(() => fs.rmSync(files.root, { recursive: true, force: true }));
  const existing = path.join(files.workspace, 'runtime');
  fs.mkdirSync(existing, { recursive: true });
  fs.writeFileSync(path.join(existing, 'keep.txt'), 'old-runtime');
  const installer = createRuntimeInstaller({
    workspace: files.workspace,
    quantRoot: files.quantRoot,
    platform: 'win32',
    arch: 'x64',
    downloadFile: async (_url, target) => fs.writeFileSync(target, files.archive),
    extractArchive: async (_archive, target) => {
      fs.mkdirSync(target, { recursive: true });
      const uv = path.join(target, 'uv.exe');
      fs.writeFileSync(uv, 'uv');
    },
    runCommand: async () => { throw new Error('planned install failure'); }
  });

  await assert.rejects(() => installer.install({ force: true }), /planned install failure/);
  assert.equal(fs.readFileSync(path.join(existing, 'keep.txt'), 'utf8'), 'old-runtime');
  assert.equal(fs.existsSync(path.join(files.workspace, '.runtime-staging')), false);
});

test('successful install verifies the staged Python before replacing the runtime', async t => {
  const files = fixture();
  t.after(() => fs.rmSync(files.root, { recursive: true, force: true }));
  const progress = [];
  const installer = createRuntimeInstaller({
    workspace: files.workspace,
    quantRoot: files.quantRoot,
    platform: 'win32',
    arch: 'x64',
    now: () => '2026-08-09T12:00:00.000Z',
    downloadFile: async (_url, target) => fs.writeFileSync(target, files.archive),
    extractArchive: async (_archive, target) => {
      fs.mkdirSync(target, { recursive: true });
      const uv = path.join(target, 'uv.exe');
      fs.writeFileSync(uv, 'uv');
    },
    runCommand: async (executable, args) => {
      if (String(executable).endsWith('uv.exe') && args[0] === 'python' && args[1] === 'install') {
        const installDir = args[args.indexOf('--install-dir') + 1];
        const home = path.join(installDir, 'cpython-3.12.13-windows-x86_64-none');
        fs.mkdirSync(home, { recursive: true });
        fs.writeFileSync(path.join(home, 'python.exe'), 'managed-python');
      }
      if (String(executable).endsWith('uv.exe') && args[0] === 'venv') {
        const venv = args[args.length - 1];
        const python = path.join(venv, 'Scripts', 'python.exe');
        fs.mkdirSync(path.dirname(python), { recursive: true });
        fs.writeFileSync(python, 'python');
        fs.writeFileSync(path.join(venv, 'pyvenv.cfg'), 'home = ' + path.join(path.dirname(venv), 'python', 'cpython-3.12.13-windows-x86_64-none') + '\n');
      }
      if (String(executable).endsWith('python.exe')) {
        return { stdout: 'WEBSTOCK_RESULT={"status":"available","verified":true}\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    }
  });

  const result = await installer.install({ onProgress: event => progress.push(event.stage) });
  assert.equal(result.verified, true);
  assert.equal(fs.existsSync(runtimePythonPath(files.workspace)), true);
  const receipt = JSON.parse(fs.readFileSync(path.join(files.workspace, 'runtime', 'install-receipt.json'), 'utf8'));
  assert.equal(receipt.schema, 'webstock.quant-runtime-receipt/v1');
  assert.equal(receipt.requirementsSha256, sha256(fs.readFileSync(path.join(files.quantRoot, 'requirements.lock'))));
  assert.equal(fs.existsSync(path.join(files.workspace, 'runtime', 'cache')), false);
  assert.equal(fs.existsSync(path.join(files.workspace, 'runtime', 'tools')), false);
  assert.equal(fs.existsSync(path.join(files.workspace, 'runtime', 'uv.zip')), false);
  const venvConfig = fs.readFileSync(path.join(files.workspace, 'runtime', 'venv', 'pyvenv.cfg'), 'utf8');
  assert.doesNotMatch(venvConfig, /\.runtime-staging/);
  assert.match(venvConfig, /[\\/]runtime[\\/]python[\\/]/);
  assert.deepEqual(progress, ['prepare', 'download', 'extract', 'python', 'environment', 'packages', 'verify', 'activate', 'completed']);
});

test('cancelled install removes staging and preserves the previous runtime', async t => {
  const files = fixture();
  t.after(() => fs.rmSync(files.root, { recursive: true, force: true }));
  const existing = path.join(files.workspace, 'runtime');
  fs.mkdirSync(existing, { recursive: true });
  fs.writeFileSync(path.join(existing, 'keep.txt'), 'old-runtime');
  const installer = createRuntimeInstaller({
    workspace: files.workspace,
    quantRoot: files.quantRoot,
    platform: 'win32',
    arch: 'x64',
    downloadFile: (_url, _target, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    })
  });
  const controller = new AbortController();
  const pending = installer.install({ force: true, signal: controller.signal });
  controller.abort();
  await assert.rejects(() => pending, /cancelled/);
  assert.equal(fs.readFileSync(path.join(existing, 'keep.txt'), 'utf8'), 'old-runtime');
  assert.equal(fs.existsSync(path.join(files.workspace, '.runtime-staging')), false);
});

test('runtime install rejects insufficient disk space before downloading', async t => {
  const files = fixture();
  t.after(() => fs.rmSync(files.root, { recursive: true, force: true }));
  let downloaded = false;
  const installer = createRuntimeInstaller({
    workspace: files.workspace,
    quantRoot: files.quantRoot,
    platform: 'win32',
    arch: 'x64',
    availableBytes: () => 512,
    downloadFile: async () => { downloaded = true; }
  });
  await assert.rejects(() => installer.install(), /可用空间/);
  assert.equal(downloaded, false);
  assert.equal(fs.existsSync(path.join(files.workspace, '.runtime-staging')), false);
});
