const childProcess = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
process.env.WEBSTOCK_DB_PATH = process.env.WEBSTOCK_DB_PATH || path.join(dataDir, 'webstock.db');
process.env.WEBSTOCK_SKIP_FUND_REFRESH = process.env.WEBSTOCK_SKIP_FUND_REFRESH || '1';

const app = require('./server');

function canListen(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        tester.close(() => resolve(true));
      })
      .listen(port, '127.0.0.1');
  });
}

async function findPort(start) {
  for (let port = start; port < start + 30; port++) {
    if (await canListen(port)) return port;
  }
  throw new Error('No available local port from ' + start);
}

function openBrowser(url) {
  const command = process.platform === 'win32'
    ? 'start "" "' + url + '"'
    : process.platform === 'darwin'
      ? 'open "' + url + '"'
      : 'xdg-open "' + url + '"';
  childProcess.exec(command, function(error) {
    if (error) console.log('Open browser failed, please visit: ' + url);
  });
}

(async function main() {
  const preferredPort = Number(process.env.PORT) || 3000;
  const port = await findPort(preferredPort);
  app.listen(port, '127.0.0.1', function() {
    const url = 'http://127.0.0.1:' + port + '/';
    console.log('WebStock started: ' + url);
    console.log('Data file: ' + process.env.WEBSTOCK_DB_PATH);
    console.log('Close this window to stop WebStock.');
    openBrowser(url);
  });
})().catch(function(error) {
  console.error(error.message || error);
  process.exit(1);
});
