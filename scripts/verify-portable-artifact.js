const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { createHash } = require('node:crypto');

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

async function verifyFrontendAssets(port) {
  const files = ['index.html','css/fixed-workspace.css','css/compact-terminal.css','css/market-reading.css','js/modules/chartTheme.js','js/modules/fixedWorkspace.js','js/modules/homeTerminal.js','js/modules/compactTerminal.js','js/modules/news.js','js/modules/evidenceLibrary.js','js/modules/aiResearch.js','js/modules/capitalFlow.js','js/modules/realtimeChart.js','js/modules/darkRankBoardView.js','js/modules/hotMarket.js','js/modules/marketComparison.js','js/modules/pageRefresh.js','js/app.js','sw.js'];
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  files.push('css/industry-workspace.css', 'js/modules/industryWorkspace.js', 'js/modules/industryChain.js',
    'css/workspaces-refinement.css', 'js/modules/expertTracker.js', 'js/modules/klineChart.js', 'js/modules/stockList.js', 'js/modules/runtimeDiagnostics.js');
  files.push('js/modules/marketInstitutionalFlow.js', 'js/modules/eastmoneyEtfDaily.js', 'js/modules/dashboard.js');
  files.push('js/modules/portfolio.js');
  files.push('css/styles.css', 'js/modules/volumePace.js', 'js/modules/marketSignalModel.js');
  files.push('js/modules/search.js', 'js/modules/chartPriceLabels.js');
  for (const file of files) {
    const response = await fetch('http://127.0.0.1:' + port + '/' + file, {signal:AbortSignal.timeout(5000)});
    if (!response.ok) throw new Error('Packaged asset unavailable: ' + file);
    const actual = hash(Buffer.from(await response.arrayBuffer()));
    const expected = hash(fs.readFileSync(path.join(__dirname,'..',file)));
    if (actual !== expected) throw new Error('Packaged asset does not match source: ' + file);
  }
  console.log('Packaged frontend matches current source: ' + files.length + ' assets (SHA256)');
  const article = await fetch('http://127.0.0.1:' + port + '/api/news/article?url=invalid', {signal:AbortSignal.timeout(5000)});
  const result = await article.json();
  if (!article.ok || !result.success || result.data?.status !== 'unavailable') throw new Error('Packaged news body route is missing');
  const authors = await fetch('http://127.0.0.1:' + port + '/api/knowledge/authors', {signal:AbortSignal.timeout(5000)});
  const authorList = await authors.json();
  if (!authors.ok || !authorList.success || !Array.isArray(authorList.data)) throw new Error('Packaged evidence author route is missing');
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
  // An existing empty SQLite file prevents portable migration from even opening
  // the user's registered database. SQLite initializes this isolated file.
  const smokeData = path.join(smokeDir, 'WebStockData');
  fs.mkdirSync(smokeData);
  fs.closeSync(fs.openSync(path.join(smokeData, 'webstock.db'), 'wx'));
  const port = await reservePort();
  const child = spawn(smokeExe, [], {
    cwd: smokeDir,
    env: Object.assign({}, process.env, {
      PORT: String(port),
      WEBSTOCK_DB_PATH: path.join(smokeData, 'webstock.db'),
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
        const observerLog = path.join(smokeDir, 'WebStockData', 'diagnostics', 'runtime.jsonl');
        const observerDeadline = Date.now() + 10000;
        while (!fs.existsSync(observerLog) && Date.now() < observerDeadline) await new Promise(resolve => setTimeout(resolve, 100));
        if (!fs.existsSync(observerLog) || !fs.readFileSync(observerLog, 'utf8').includes('"kind":"observer-started"')) {
          throw new Error('Portable automatic diagnostics did not start');
        }
        console.log('Packaged independent diagnostics observer started and wrote its local log');
        const backendLog = path.join(smokeData, 'diagnostics', 'backend', 'runtime.jsonl');
        while (!fs.existsSync(backendLog) && Date.now() < observerDeadline) await new Promise(resolve => setTimeout(resolve, 100));
        const startedObserver = file => fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse)
          .find(event => event.kind === 'observer-started');
        const desktopObserver = startedObserver(observerLog);
        const backendObserver = startedObserver(backendLog);
        if (!desktopObserver?.pid || !backendObserver?.pid || desktopObserver.pid === backendObserver.pid) {
          throw new Error('Packaged data service is not independently observed in a separate process');
        }
        console.log('Packaged window/data processes independently observed: ' + desktopObserver.pid + ' / ' + backendObserver.pid);
        if (process.env.WEBSTOCK_VERIFY_UI_ASSETS === '1') await verifyFrontendAssets(port);
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
