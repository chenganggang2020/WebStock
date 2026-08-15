const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  HTTPS_PORT,
  buildIosPairingUrl,
  extractLoginUrl,
  extractServeApprovalUrl,
  createTailscaleAccessService
} = require('../services/tailscaleAccessService');

test('iPhone pairing URL uses private Tailscale HTTPS and the mobile shell', () => {
  const url = buildIosPairingUrl('webstock.tail-test.ts.net.', 'a'.repeat(64));
  assert.equal(url, 'https://webstock.tail-test.ts.net:' + HTTPS_PORT + '/mobile.html?pair=' + 'a'.repeat(64));
});

test('Tailscale access enables an isolated persistent HTTPS proxy', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-tailscale-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls = [];
  const execute = async function(_file, args) {
    calls.push(args);
    if (args[0] === 'status') {
      return { stdout: JSON.stringify({ BackendState: 'Running', Self: { Online: true, DNSName: 'webstock.tail-test.ts.net.' } }), stderr: '' };
    }
    if (args[0] === 'serve' && args[1] === 'status') {
      return { stdout: calls.some(item => item.includes('--bg')) ? 'https://webstock.tail-test.ts.net:' + HTTPS_PORT : '', stderr: '' };
    }
    return { stdout: 'Serve started', stderr: '' };
  };
  const service = createTailscaleAccessService({
    userDataDir: root,
    appPort: 3000,
    executablePath: 'tailscale.exe',
    execute,
    tokenProvider: () => 'b'.repeat(64)
  });

  const enabled = await service.enable();

  assert.equal(enabled.installed, true);
  assert.equal(enabled.connected, true);
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.pairingUrl, 'https://webstock.tail-test.ts.net:' + HTTPS_PORT + '/mobile.html?pair=' + 'b'.repeat(64));
  assert.deepEqual(calls.find(args => args.includes('--bg')), [
    'serve', '--https=' + HTTPS_PORT, '--bg', '--yes', '3000'
  ]);
});

test('Tailscale access reports a direct install action when the client is absent', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-tailscale-missing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const service = createTailscaleAccessService({ userDataDir: root, executablePath: '' });

  const status = await service.status();

  assert.equal(status.installed, false);
  assert.equal(status.connected, false);
  assert.equal(status.enabled, false);
  assert.match(status.downloadUrl, /^https:\/\/tailscale\.com\//);
});

test('Tailscale login action returns only an official one-time login URL', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-tailscale-login-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const execute = async function(_file, args) {
    if (args[0] === 'login') {
      const error = new Error('login timeout');
      error.stderr = 'To authenticate, visit:\nhttps://login.tailscale.com/a/test-token_123\n';
      throw error;
    }
    return { stdout: '{}', stderr: '' };
  };
  const service = createTailscaleAccessService({
    userDataDir: root,
    executablePath: 'tailscale.exe',
    execute
  });

  const result = await service.beginLogin();

  assert.equal(result.loginUrl, 'https://login.tailscale.com/a/test-token_123');
  assert.equal(extractLoginUrl('https://evil.example/a/test-token_123'), '');
});

test('Tailscale Serve approval is surfaced only for the official authorization page', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-tailscale-approval-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const execute = async function(_file, args) {
    if (args[0] === 'status') {
      return { stdout: JSON.stringify({ BackendState: 'Running', Self: { Online: true, DNSName: 'webstock.tail-test.ts.net.' } }), stderr: '' };
    }
    const error = new Error('serve timeout');
    error.stdout = 'To enable, visit:\nhttps://login.tailscale.com/f/serve?node=test-node_123';
    throw error;
  };
  const service = createTailscaleAccessService({
    userDataDir: root,
    executablePath: 'tailscale.exe',
    execute
  });

  await assert.rejects(service.enable(), error => {
    assert.equal(error.approvalUrl, 'https://login.tailscale.com/f/serve?node=test-node_123');
    return true;
  });
  assert.equal(extractServeApprovalUrl('https://evil.example/f/serve?node=test'), '');
});
