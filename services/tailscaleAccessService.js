const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { ensurePairingToken } = require('./lanHostService');

const execFileAsync = promisify(execFile);
const HTTPS_PORT = 8443;
const SETTINGS_FILE = 'tailscale-ios-access.json';
const DOWNLOAD_URL = 'https://tailscale.com/download/windows';

function settingsPath(userDataDir) {
  return path.join(String(userDataDir || ''), SETTINGS_FILE);
}

function readTailscaleEnabled(userDataDir) {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(userDataDir), 'utf8')).enabled === true;
  } catch (_) {
    return false;
  }
}

function writeTailscaleEnabled(userDataDir, enabled) {
  fs.mkdirSync(userDataDir, { recursive: true });
  const target = settingsPath(userDataDir);
  const temporary = target + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify({ enabled: enabled === true }, null, 2), 'utf8');
  fs.renameSync(temporary, target);
}

function discoverExecutable() {
  const roots = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA
  ].filter(Boolean);
  const candidates = roots.map(root => path.join(root, 'Tailscale', 'tailscale.exe'));
  return candidates.find(candidate => fs.existsSync(candidate)) || '';
}

function normalizeDnsName(value) {
  return String(value || '').trim().replace(/\.$/, '').toLowerCase();
}

function buildIosPairingUrl(dnsName, token, httpsPort = HTTPS_PORT) {
  const host = normalizeDnsName(dnsName);
  if (!host.endsWith('.ts.net')) return '';
  if (!/^[a-f0-9]{64}$/i.test(String(token || ''))) return '';
  return 'https://' + host + ':' + httpsPort + '/mobile.html?pair=' + encodeURIComponent(token);
}

function extractLoginUrl(value) {
  const matches = String(value || '').match(/https:\/\/login\.tailscale\.com\/a\/[A-Za-z0-9_-]+/g) || [];
  return matches[0] || '';
}

function extractServeApprovalUrl(value) {
  const matches = String(value || '').match(/https:\/\/login\.tailscale\.com\/f\/serve\?node=[A-Za-z0-9_-]+/g) || [];
  return matches[0] || '';
}

async function defaultExecute(file, args) {
  return execFileAsync(file, args, {
    windowsHide: true,
    timeout: 20000,
    maxBuffer: 1024 * 1024,
    encoding: 'utf8'
  });
}

function createTailscaleAccessService(options = {}) {
  const userDataDir = String(options.userDataDir || '');
  const appPort = Number(options.appPort) || 3000;
  const httpsPort = Number(options.httpsPort) || HTTPS_PORT;
  const execute = options.execute || defaultExecute;
  const executable = Object.prototype.hasOwnProperty.call(options, 'executablePath')
    ? String(options.executablePath || '') : discoverExecutable();
  const tokenProvider = options.tokenProvider || function() { return ensurePairingToken(userDataDir); };

  async function nodeStatus() {
    if (!executable) {
      return { installed: false, connected: false, enabled: false, downloadUrl: DOWNLOAD_URL, pairingUrl: '' };
    }
    try {
      const result = await execute(executable, ['status', '--json']);
      const parsed = JSON.parse(String(result.stdout || '{}'));
      const dnsName = normalizeDnsName(parsed.Self && parsed.Self.DNSName);
      const connected = parsed.BackendState === 'Running' && parsed.Self && parsed.Self.Online !== false && dnsName.endsWith('.ts.net');
      return {
        installed: true,
        connected,
        dnsName,
        backendState: String(parsed.BackendState || ''),
        loginUrl: extractLoginUrl(parsed.AuthURL),
        downloadUrl: DOWNLOAD_URL
      };
    } catch (error) {
      return {
        installed: true,
        connected: false,
        enabled: false,
        backendState: 'Unavailable',
        error: String(error.stderr || error.message || error),
        downloadUrl: DOWNLOAD_URL,
        pairingUrl: ''
      };
    }
  }

  async function status() {
    const base = await nodeStatus();
    if (!base.connected) return { ...base, enabled: false, pairingUrl: '' };
    let serveOutput = '';
    try {
      const result = await execute(executable, ['serve', 'status']);
      serveOutput = String(result.stdout || '');
    } catch (_) {}
    const configured = readTailscaleEnabled(userDataDir);
    const active = configured && (serveOutput.includes(':' + httpsPort) || serveOutput.includes('https://' + base.dnsName));
    const token = active ? tokenProvider() : '';
    return {
      ...base,
      enabled: active,
      httpsPort,
      appPort,
      appUrl: active ? 'https://' + base.dnsName + ':' + httpsPort + '/mobile.html' : '',
      pairingUrl: active ? buildIosPairingUrl(base.dnsName, token, httpsPort) : ''
    };
  }

  async function enable() {
    const base = await nodeStatus();
    if (!base.installed) throw new Error('请先安装 Tailscale，再启用 iPhone HTTPS。');
    if (!base.connected) throw new Error('请先登录 Tailscale，并确认电脑处于在线状态。');
    try {
      await execute(executable, ['serve', '--https=' + httpsPort, '--bg', '--yes', String(appPort)]);
    } catch (error) {
      const output = [error.stdout, error.stderr, error.message].filter(Boolean).join('\n');
      const approvalUrl = extractServeApprovalUrl(output);
      if (approvalUrl) {
        const approvalError = new Error('需要先在 Tailscale 官方页面允许此私网启用 HTTPS。');
        approvalError.approvalUrl = approvalUrl;
        throw approvalError;
      }
      throw error;
    }
    writeTailscaleEnabled(userDataDir, true);
    const token = tokenProvider();
    return {
      ...base,
      enabled: true,
      httpsPort,
      appPort,
      appUrl: 'https://' + base.dnsName + ':' + httpsPort + '/mobile.html',
      pairingUrl: buildIosPairingUrl(base.dnsName, token, httpsPort)
    };
  }

  async function beginLogin() {
    if (!executable) throw new Error('请先安装 Tailscale。');
    let output = '';
    try {
      const result = await execute(executable, ['login', '--timeout=2s', '--unattended=true']);
      output = String(result.stdout || '') + '\n' + String(result.stderr || '');
    } catch (error) {
      output = [error.stdout, error.stderr, error.message].filter(Boolean).join('\n');
    }
    let loginUrl = extractLoginUrl(output);
    if (!loginUrl) {
      const base = await nodeStatus();
      if (base.connected) return { ...base, loginUrl: '' };
      loginUrl = base.loginUrl || '';
      if (loginUrl) return { ...base, loginUrl };
      throw new Error('未能生成 Tailscale 登录地址，请稍后重试。');
    }
    return { installed: true, connected: false, enabled: false, loginUrl };
  }

  async function disable() {
    if (executable) {
      try { await execute(executable, ['serve', '--https=' + httpsPort, 'off']); } catch (_) {}
    }
    writeTailscaleEnabled(userDataDir, false);
    const base = await nodeStatus();
    return { ...base, enabled: false, httpsPort, appPort, appUrl: '', pairingUrl: '' };
  }

  return { status, enable, disable, beginLogin };
}

module.exports = {
  HTTPS_PORT,
  SETTINGS_FILE,
  DOWNLOAD_URL,
  readTailscaleEnabled,
  writeTailscaleEnabled,
  normalizeDnsName,
  buildIosPairingUrl,
  extractLoginUrl,
  extractServeApprovalUrl,
  createTailscaleAccessService
};
