const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readManagedDataDirectory, resolveRuntimeConfig } = require('../electron/runtimeConfig');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webstock-upgrade-location-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executableDir = path.join(root, 'installed');
  const stableConfigFile = path.join(root, 'ProgramData', 'WebStock', 'runtime-location.json');
  fs.mkdirSync(executableDir);
  fs.mkdirSync(path.dirname(stableConfigFile), { recursive: true });
  const dataDir = path.join(root, 'existing-data');
  fs.mkdirSync(dataDir);
  fs.writeFileSync(path.join(dataDir, 'webstock.db'), 'existing database fixture');
  return { root, executableDir, stableConfigFile, dataDir };
}

function writeLocation(file, dataDir) {
  fs.writeFileSync(file, JSON.stringify({ schema: 'webstock.runtime-location/v1', dataDir }));
}

test('upgrade recovers the same database and profile when the installation sidecar is removed', t => {
  const { root, executableDir, stableConfigFile, dataDir } = fixture(t);
  writeLocation(stableConfigFile, dataDir);
  const before = fs.readFileSync(path.join(dataDir, 'webstock.db'));

  const managedDataDir = readManagedDataDirectory(executableDir, { stableConfigFile });
  const config = resolveRuntimeConfig({ defaultUserDataDir: path.join(root, 'new-profile'), managedDataDir });

  assert.equal(config.dataDir, dataDir);
  assert.equal(config.userDataDir, dataDir);
  assert.equal(config.dbPath, path.join(dataDir, 'webstock.db'));
  assert.deepEqual(fs.readFileSync(config.dbPath), before);
  assert.equal(fs.existsSync(path.join(root, 'new-profile')), false);
  assert.equal(fs.existsSync(path.join(executableDir, 'runtime-location.json')), false);
});

test('matching installation and stable locations are accepted without rewriting either file', t => {
  const { executableDir, stableConfigFile, dataDir } = fixture(t);
  const sidecar = path.join(executableDir, 'runtime-location.json');
  writeLocation(sidecar, dataDir);
  writeLocation(stableConfigFile, dataDir);
  const beforeSidecar = fs.readFileSync(sidecar);
  const beforeStable = fs.readFileSync(stableConfigFile);

  assert.equal(readManagedDataDirectory(executableDir, { stableConfigFile }), dataDir);
  assert.deepEqual(fs.readFileSync(sidecar), beforeSidecar);
  assert.deepEqual(fs.readFileSync(stableConfigFile), beforeStable);
});

test('equivalent normalized locations do not create a false upgrade conflict', t => {
  const { executableDir, stableConfigFile, dataDir } = fixture(t);
  writeLocation(path.join(executableDir, 'runtime-location.json'), dataDir + path.sep + '.');
  writeLocation(stableConfigFile, dataDir);

  assert.equal(readManagedDataDirectory(executableDir, { stableConfigFile }), dataDir);
});

test('different valid installation and stable locations block startup instead of selecting another database', t => {
  const { root, executableDir, stableConfigFile, dataDir } = fixture(t);
  const otherDataDir = path.join(root, 'other-existing-data');
  fs.mkdirSync(otherDataDir);
  fs.writeFileSync(path.join(otherDataDir, 'webstock.db'), 'another database fixture');
  writeLocation(path.join(executableDir, 'runtime-location.json'), dataDir);
  writeLocation(stableConfigFile, otherDataDir);

  assert.throws(() => readManagedDataDirectory(executableDir, { stableConfigFile }), /conflict|different/i);
});

for (const sidecarPresent of [false, true]) {
  for (const invalid of [
    { name: 'malformed JSON', contents: '{bad json', error: /JSON|position|property|parse/i },
    { name: 'unsupported schema', contents: '{}', error: /schema/i },
    { name: 'relative path', contents: JSON.stringify({ schema: 'webstock.runtime-location/v1', dataDir: '../data' }), error: /absolute/i }
  ]) {
    test(`invalid stable location (${invalid.name}, sidecar ${sidecarPresent ? 'present' : 'absent'}) cannot fall back to a fresh profile`, t => {
      const { executableDir, stableConfigFile, dataDir } = fixture(t);
      if (sidecarPresent) writeLocation(path.join(executableDir, 'runtime-location.json'), dataDir);
      fs.writeFileSync(stableConfigFile, invalid.contents);

      assert.throws(() => readManagedDataDirectory(executableDir, { stableConfigFile }), invalid.error);
    });
  }
}

test('stable location with a missing database blocks startup without creating the configured directory', t => {
  const { root, executableDir, stableConfigFile } = fixture(t);
  const missingDir = path.join(root, 'missing-data');
  writeLocation(stableConfigFile, missingDir);

  assert.throws(() => readManagedDataDirectory(executableDir, { stableConfigFile }), /database.*missing/i);
  assert.equal(fs.existsSync(missingDir), false);
});

test('stable database path must identify a file, not a directory', t => {
  const { root, executableDir, stableConfigFile } = fixture(t);
  const invalidDir = path.join(root, 'directory-instead-of-db');
  fs.mkdirSync(path.join(invalidDir, 'webstock.db'), { recursive: true });
  writeLocation(stableConfigFile, invalidDir);

  assert.throws(() => readManagedDataDirectory(executableDir, { stableConfigFile }), /database.*missing/i);
});

test('a corrupt installation sidecar cannot be silently replaced by the stable location', t => {
  const { executableDir, stableConfigFile, dataDir } = fixture(t);
  writeLocation(stableConfigFile, dataDir);
  fs.writeFileSync(path.join(executableDir, 'runtime-location.json'), '{}');

  assert.throws(() => readManagedDataDirectory(executableDir, { stableConfigFile }), /schema/i);
});

test('existing installations with only a valid sidecar keep their current managed directory', t => {
  const { executableDir, stableConfigFile, dataDir } = fixture(t);
  writeLocation(path.join(executableDir, 'runtime-location.json'), dataDir);

  assert.equal(readManagedDataDirectory(executableDir, { stableConfigFile }), dataDir);
  assert.equal(fs.existsSync(stableConfigFile), false);
});

test('first installation with neither configuration retains the normal default profile contract', t => {
  const { root, executableDir, stableConfigFile } = fixture(t);
  const defaultUserDataDir = path.join(root, 'default-profile');
  const managedDataDir = readManagedDataDirectory(executableDir, { stableConfigFile });
  const config = resolveRuntimeConfig({ defaultUserDataDir, managedDataDir });

  assert.equal(managedDataDir, '');
  assert.equal(config.managed, false);
  assert.equal(config.dataDir, defaultUserDataDir);
  assert.equal(fs.existsSync(defaultUserDataDir), false);
});

test('portable calls without a stable option remain isolated from the installed managed location', t => {
  const { root, executableDir, stableConfigFile, dataDir } = fixture(t);
  writeLocation(stableConfigFile, dataDir);
  const managedDataDir = readManagedDataDirectory(executableDir);
  const config = resolveRuntimeConfig({
    portableExecutableDir: executableDir,
    defaultUserDataDir: path.join(root, 'default-profile'),
    managedDataDir
  });

  assert.equal(managedDataDir, '');
  assert.equal(config.portable, true);
  assert.equal(config.managed, false);
  assert.equal(config.dataDir, path.join(executableDir, 'WebStockData'));
});
