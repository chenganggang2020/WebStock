const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  readRuntimeLink,
  saveRuntimeLink
} = require('../services/quantRuntimeLink');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-runtime-link-'));
  const workspace = path.join(root, 'workspace');
  const python = path.join(root, 'existing-runtime', 'Scripts', 'python.exe');
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.writeFileSync(python, 'python');
  return { root, workspace, python };
}

test('existing quant runtime link persists a verified absolute Python path', t => {
  const files = fixture();
  t.after(() => fs.rmSync(files.root, { recursive: true, force: true }));

  const saved = saveRuntimeLink(files.workspace, {
    pythonPath: files.python,
    linkedAt: '2026-08-10T08:30:00.000Z',
    versions: { python: '3.12.13', qlib: '0.9.7', lightgbm: '4.7.0', torch: '2.13.0' }
  });
  const restored = readRuntimeLink(files.workspace);

  assert.equal(saved.pythonPath, fs.realpathSync(files.python));
  assert.equal(restored.pythonPath, fs.realpathSync(files.python));
  assert.equal(restored.versions.qlib, '0.9.7');
  assert.equal(restored.schema, 'webstock.quant-runtime-link/v1');
});

test('existing quant runtime link rejects missing and non-Python executables', t => {
  const files = fixture();
  t.after(() => fs.rmSync(files.root, { recursive: true, force: true }));

  assert.throws(() => saveRuntimeLink(files.workspace, {
    pythonPath: path.join(files.root, 'missing', 'python.exe')
  }), /不存在/);

  const other = path.join(files.root, 'existing-runtime', 'Scripts', 'other.exe');
  fs.writeFileSync(other, 'other');
  assert.throws(() => saveRuntimeLink(files.workspace, { pythonPath: other }), /python\.exe/);
});

test('stale runtime links are reported instead of treated as available', t => {
  const files = fixture();
  t.after(() => fs.rmSync(files.root, { recursive: true, force: true }));
  saveRuntimeLink(files.workspace, { pythonPath: files.python });
  fs.rmSync(files.python, { force: true });

  assert.throws(() => readRuntimeLink(files.workspace), /不存在/);
});
