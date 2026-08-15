const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const sourceDir = path.resolve(process.argv[2] || '');
const timeoutMs = 120000;

function findPortableExe(directory) {
  if (!directory || !fs.existsSync(directory)) return null;
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.exe$/i.test(entry.name) && !/\.__uninstaller\.exe$/i.test(entry.name));
  return entries.length === 1 ? path.join(directory, entries[0].name) : null;
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

function readHealth(port) {
  return new Promise(resolve => {
    const request = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 2000 }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        try {
          const payload = JSON.parse(body);
          resolve(response.statusCode === 200 && payload.success === true && payload.data &&
            payload.data.status === 'ok' && payload.data.database === 'ok');
        } catch (_) {
          resolve(false);
        }
      });
    });
    request.once('timeout', () => request.destroy());
    request.once('error', () => resolve(false));
  });
}

function stopProcessTree(child) {
  if (!child || !child.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    });
  } else {
    try { child.kill('SIGKILL'); } catch (_) {}
  }
}

async function removeSmokeDirectory(directory) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
      if (!fs.existsSync(directory)) return true;
    } catch (error) {
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error.code)) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

async function verify() {
  const sourceExe = findPortableExe(sourceDir);
  if (!sourceExe) throw new Error('Expected exactly one portable EXE in ' + sourceDir);
  if (fs.statSync(sourceExe).size <= 0) throw new Error('Portable EXE is empty: ' + sourceExe);

  const smokeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-portable-smoke-'));
  const smokeExe = path.join(smokeDir, path.basename(sourceExe));
  fs.copyFileSync(sourceExe, smokeExe);
  const port = await reservePort();
  const child = spawn(smokeExe, [], {
    cwd: smokeDir,
    env: Object.assign({}, process.env, {
      PORT: String(port),
      WEBSTOCK_BUILD_SMOKE_TEST: '1',
      WEBSTOCK_SKIP_FUND_REFRESH: '1'
    }),
    windowsHide: true,
    stdio: 'ignore'
  });

  const startedAt = Date.now();
  try {
    while (Date.now() - startedAt < timeoutMs) {
      if (await readHealth(port)) {
        console.log('Portable runtime health check passed on isolated port ' + port);
        return;
      }
      if (child.exitCode !== null) {
        throw new Error('Portable EXE exited before health check (exit ' + child.exitCode + ')');
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('Portable EXE did not become healthy within ' + (timeoutMs / 1000) + ' seconds');
  } finally {
    stopProcessTree(child);
    if (!await removeSmokeDirectory(smokeDir)) {
      console.warn('Portable runtime passed, but Windows still holds the temporary smoke directory: ' + smokeDir);
    }
  }
}

verify().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
