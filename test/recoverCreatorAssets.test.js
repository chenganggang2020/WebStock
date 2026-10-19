const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const { previewCreatorAssets, copyToIsolated } = require('../scripts/recover-creator-assets');

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const videoId = '7000000000000000001';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'creator-assets-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const current = path.join(root, 'current');
  const old = path.join(root, 'old-douyin');
  fs.mkdirSync(current); fs.mkdirSync(old);
  const dbPath = path.join(current, 'webstock.db');
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE expert_channels (id INTEGER PRIMARY KEY, display_name TEXT, platform TEXT);
    CREATE TABLE expert_observations (id INTEGER PRIMARY KEY, channel_id INTEGER,
      external_content_id TEXT, media_type TEXT, local_asset_path TEXT, media_metadata_json TEXT, updated_at TEXT);
    INSERT INTO expert_channels VALUES (1,'模型先生','douyin'),(4,'Fioona','douyin'),
      (5,'坦克','douyin'),(6,'Other','douyin');`);
  db.close();
  function add({ id = 1, channel = 4, external = videoId, type = 'video', source, metadata = {} } = {}) {
    const connection = new Database(dbPath);
    connection.prepare('INSERT INTO expert_observations VALUES (?,?,?,?,?,?,?)')
      .run(id, channel, external, type, source || '', JSON.stringify(metadata), '2026-09-26T08:00:00Z');
    connection.close();
  }
  function video(bytes = 'video-fixture', name = videoId + '.mp4') {
    const filename = path.join(old, name); fs.writeFileSync(filename, bytes); return filename;
  }
  const targetRoot = path.join(current, 'media-library', 'douyin');
  return { root, current, old, dbPath, targetRoot, add, video,
    options: { dbPath, targetRoot, allowedRoots: [old] } };
}

test('preview reads only authors 1/4/5 and records hashes without writing DB or directories', async t => {
  const f = fixture(t), source = f.video();
  f.add({ source, metadata: { archive: { localAssetPath: source, mediaSha256: digest('video-fixture') } } });
  f.add({ id: 2, channel: 6, source });
  const before = fs.readFileSync(f.dbPath);
  const manifest = await previewCreatorAssets(f.options);
  assert.equal(manifest.schema, 'webstock.creator-assets-recovery/v1');
  assert.equal(manifest.observationCount, 1);
  assert.equal(manifest.items.length, 1);
  assert.equal(manifest.items[0].status, 'ready');
  assert.equal(manifest.items[0].sha256, digest('video-fixture'));
  assert.equal(manifest.items[0].sourcePath, source);
  assert.equal(manifest.items[0].targetPath, path.join(f.targetRoot, videoId + '.mp4'));
  assert.match(manifest.items[0].recordFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(fs.readFileSync(f.dbPath), before);
  assert.equal(fs.existsSync(f.targetRoot), false);
});

test('note images preserve author/content/page/hash identity and report absent pages', async t => {
  const f = fixture(t), bytes = Buffer.from('image-fixture'), sha256 = digest(bytes);
  const relative = path.join('notes', '5', videoId, '001-' + sha256 + '.png');
  const source = path.join(f.old, relative);
  fs.mkdirSync(path.dirname(source), { recursive: true }); fs.writeFileSync(source, bytes);
  f.add({ channel: 5, type: 'note', metadata: { note: { imageCount: 2, pages: [
    { index: 1, localAssetPath: source, sha256, mimeType: 'image/png' }
  ] } } });
  const manifest = await previewCreatorAssets(f.options);
  assert.equal(manifest.items[0].status, 'ready');
  assert.equal(manifest.items[0].relativePath, relative);
  assert.equal(manifest.items[1].status, 'no_local_reference');
  assert.equal(manifest.items[1].pageIndex, 2);
});

test('preview rejects source traversal, wrong media identity, and unrecorded directory guesses', async t => {
  const f = fixture(t);
  const outside = path.join(f.root, videoId + '.mp4'); fs.writeFileSync(outside, 'private');
  f.add({ source: path.join(f.old, '..', videoId + '.mp4') });
  f.add({ id: 2, source: f.video('wrong', '7000000000000000002.mp4') });
  f.add({ id: 3 });
  f.video();
  const manifest = await previewCreatorAssets(f.options);
  assert.deepEqual(manifest.items.map(item => item.status), ['outside_allowed_roots', 'identity_mismatch', 'no_local_reference']);
});

test('a directory junction cannot escape a declared old archive root', async t => {
  const f = fixture(t), outside = path.join(f.root, 'outside'); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, videoId + '.mp4'), 'outside');
  fs.symlinkSync(outside, path.join(f.old, 'link'), 'junction');
  f.add({ source: path.join(f.old, 'link', videoId + '.mp4') });
  const manifest = await previewCreatorAssets(f.options);
  assert.equal(manifest.items[0].status, 'outside_allowed_roots');
});

test('stored hash mismatch and conflicting recorded sources are not copy candidates', async t => {
  const f = fixture(t), source = f.video();
  f.add({ source, metadata: { archive: { mediaSha256: digest('different') } } });
  const secondRoot = path.join(f.root, 'second-old'); fs.mkdirSync(secondRoot);
  const second = path.join(secondRoot, videoId + '.mp4'); fs.writeFileSync(second, 'other-version');
  f.add({ id: 2, source, metadata: { asr: { localAssetPath: second } } });
  const manifest = await previewCreatorAssets({ ...f.options, allowedRoots: [f.old, secondRoot] });
  assert.deepEqual(manifest.items.map(item => item.status), ['source_hash_mismatch', 'conflicting_sources']);
});

test('isolation copy verifies media, is repeatable, and never changes source or database', async t => {
  const f = fixture(t), source = f.video(); f.add({ source });
  const before = fs.readFileSync(f.dbPath), copyTo = path.join(f.root, 'staging');
  const manifest = await previewCreatorAssets(f.options);
  const first = await copyToIsolated(manifest, copyTo);
  const second = await copyToIsolated(manifest, copyTo);
  const staged = path.join(copyTo, 'media-library', 'douyin', videoId + '.mp4');
  assert.equal(first.items[0].copyStatus, 'copied');
  assert.equal(second.items[0].copyStatus, 'reused');
  assert.equal(fs.readFileSync(staged, 'utf8'), 'video-fixture');
  assert.equal(fs.readFileSync(source, 'utf8'), 'video-fixture');
  assert.deepEqual(fs.readFileSync(f.dbPath), before);
  assert.equal(fs.existsSync(f.targetRoot), false);
  assert.equal(JSON.parse(fs.readFileSync(first.manifestPath, 'utf8')).databaseUpdated, false);
});

test('isolation copy refuses changed sources and different existing targets', async t => {
  const f = fixture(t), source = f.video(); f.add({ source });
  const manifest = await previewCreatorAssets(f.options);
  fs.writeFileSync(source, 'changed');
  await assert.rejects(copyToIsolated(manifest, path.join(f.root, 'changed-stage')), /changed|变化/);
  fs.writeFileSync(source, 'video-fixture');
  const copyTo = path.join(f.root, 'staging'); await copyToIsolated(manifest, copyTo);
  const staged = path.join(copyTo, 'media-library', 'douyin', videoId + '.mp4');
  fs.writeFileSync(staged, 'must-not-overwrite');
  await assert.rejects(copyToIsolated(manifest, copyTo), /conflict|冲突/);
  assert.equal(fs.readFileSync(staged, 'utf8'), 'must-not-overwrite');
});

test('copy target cannot overlap current data, old roots or unrelated occupied directories', async t => {
  const f = fixture(t); f.add({ source: f.video() });
  const manifest = await previewCreatorAssets(f.options);
  for (const directory of [f.current, f.targetRoot, f.old, path.join(f.old, 'stage'), f.root]) {
    await assert.rejects(copyToIsolated(manifest, directory), /isolat|隔离|overlap|重叠/);
  }
  const occupied = path.join(f.root, 'occupied'); fs.mkdirSync(occupied);
  fs.writeFileSync(path.join(occupied, 'user.txt'), 'keep');
  await assert.rejects(copyToIsolated(manifest, occupied), /empty|空|belong|归属/);
});

test('preview reports current destination conflicts without overwriting or treating them as recovered', async t => {
  const f = fixture(t); f.add({ source: f.video() });
  fs.mkdirSync(f.targetRoot, { recursive: true });
  fs.writeFileSync(path.join(f.targetRoot, videoId + '.mp4'), 'different-current-file');
  const manifest = await previewCreatorAssets(f.options);
  assert.equal(manifest.items[0].status, 'target_conflict');
  assert.equal(manifest.items[0].targetSha256, digest('different-current-file'));
});

test('all records sharing a conflicting target are blocked, including a third duplicate of the first', async t => {
  const f = fixture(t), source = f.video();
  const otherRoot = path.join(f.root, 'other-archive'); fs.mkdirSync(otherRoot);
  const other = path.join(otherRoot, videoId + '.mp4'); fs.writeFileSync(other, 'different-video');
  f.add({ source }); f.add({ id: 2, source: other }); f.add({ id: 3, source });
  const manifest = await previewCreatorAssets({ ...f.options, allowedRoots: [f.old, otherRoot] });
  assert.deepEqual(manifest.items.map(item => item.status), ['target_conflict', 'target_conflict', 'target_conflict']);
});

test('malformed note pages are reported without aborting other records or exposing remote signed URLs', async t => {
  const f = fixture(t);
  f.add({ type: 'note', metadata: { note: { pages: [null] } } });
  f.add({ id: 2, source: 'https://example.test/media?secret=signed-token' });
  f.add({ id: 3, source: f.video() });
  const manifest = await previewCreatorAssets(f.options);
  assert.equal(manifest.items[0].status, 'invalid_record');
  assert.equal(manifest.items[1].status, 'invalid_local_reference');
  assert.equal(manifest.items[2].status, 'ready');
  assert.doesNotMatch(JSON.stringify(manifest), /signed-token/);
});

test('repeated staging refuses a directory junction inserted under its owned archive', async t => {
  const f = fixture(t); f.add({ source: f.video() });
  const manifest = await previewCreatorAssets(f.options), directory = path.join(f.root, 'staging');
  await copyToIsolated(manifest, directory);
  const archive = path.join(directory, 'media-library', 'douyin');
  fs.renameSync(archive, path.join(directory, 'saved-archive'));
  fs.symlinkSync(f.old, archive, 'junction');
  await assert.rejects(copyToIsolated(manifest, directory), /符号链接|越界/);
});

test('an interrupted copy retains its audit and resumes without recopying completed assets', async t => {
  const f = fixture(t); f.add({ source: f.video() });
  const secondId = '7000000000000000002';
  f.add({ id: 2, external: secondId, source: f.video('second-video', secondId + '.mp4') });
  const manifest = await previewCreatorAssets(f.options), directory = path.join(f.root, 'staging');
  const originalCopy = fs.promises.copyFile;
  const mocked = t.mock.method(fs.promises, 'copyFile', async (source, target, flags) => {
    if (target.includes(secondId)) throw Object.assign(new Error('fixture interrupted'), { code: 'EIO' });
    return originalCopy(source, target, flags);
  });
  await assert.rejects(copyToIsolated(manifest, directory), /fixture interrupted/);
  mocked.mock.restore();
  const saved = fs.readdirSync(directory).find(name => name.startsWith('manifest-'));
  const failed = JSON.parse(fs.readFileSync(path.join(directory, saved), 'utf8'));
  assert.equal(failed.completed, false);
  assert.deepEqual(failed.items.map(item => item.copyStatus), ['copied', 'failed']);
  const resumed = await copyToIsolated(manifest, directory);
  assert.deepEqual(resumed.items.map(item => item.copyStatus), ['reused', 'copied']);
});

test('insufficient staging space stops before creating any destination', async t => {
  const f = fixture(t); f.add({ source: f.video() });
  const manifest = await previewCreatorAssets(f.options), directory = path.join(f.root, 'staging');
  t.mock.method(fs, 'statfsSync', () => ({ bavail: 0, bsize: 4096 }));
  await assert.rejects(copyToIsolated(manifest, directory), /空间不足/);
  assert.equal(fs.existsSync(directory), false);
});

test('CLI defaults to read-only preview and rejects apply, unknown options and missing DB', t => {
  const f = fixture(t); f.add({ source: f.video() });
  const script = path.join(__dirname, '..', 'scripts', 'recover-creator-assets.js');
  const args = [`--db=${f.dbPath}`, `--target-root=${f.targetRoot}`, `--allow-root=${f.old}`];
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).mode, 'preview');
  assert.equal(fs.existsSync(f.targetRoot), false);
  for (const invalid of ['--apply', '--unknown']) {
    const rejected = spawnSync(process.execPath, [script, ...args, invalid], { encoding: 'utf8' });
    assert.notEqual(rejected.status, 0);
  }
  const missing = path.join(f.root, 'missing.db');
  const absent = spawnSync(process.execPath, [script, `--db=${missing}`, ...args.slice(1)], { encoding: 'utf8' });
  assert.notEqual(absent.status, 0); assert.equal(fs.existsSync(missing), false);
});

test('an explicitly requested manifest is created once, never overwritten or written under source data', t => {
  const f = fixture(t); f.add({ source: f.video() });
  const script = path.join(__dirname, '..', 'scripts', 'recover-creator-assets.js');
  const args = [`--db=${f.dbPath}`, `--target-root=${f.targetRoot}`, `--allow-root=${f.old}`];
  const out = path.join(f.root, 'preview.json');
  const result = spawnSync(process.execPath, [script, ...args, `--out=${out}`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const original = fs.readFileSync(out);
  assert.equal(JSON.parse(original).mode, 'preview');
  assert.notEqual(spawnSync(process.execPath, [script, ...args, `--out=${out}`]).status, 0);
  assert.deepEqual(fs.readFileSync(out), original);
  const forbidden = path.join(f.current, 'preview.json');
  assert.notEqual(spawnSync(process.execPath, [script, ...args, `--out=${forbidden}`]).status, 0);
  assert.equal(fs.existsSync(forbidden), false);
});

test('observation selection hashes only selected works within the fixed author scope and records unmatched IDs', async t => {
  const f = fixture(t), first = f.video(); f.add({ source: first });
  const secondId = '7000000000000000002';
  f.add({ id: 2, external: secondId, source: f.video('selected-video', secondId + '.mp4') });
  f.add({ id: 3, channel: 6, source: first });
  const originalStream = fs.createReadStream; let unselectedReads = 0;
  t.mock.method(fs, 'createReadStream', (filename, ...args) => {
    if (filename === first) unselectedReads++;
    return originalStream(filename, ...args);
  });
  const manifest = await previewCreatorAssets({ ...f.options, observationIds: [2, 2, 3, 999] });
  assert.deepEqual(manifest.observationIds, [2, 3, 999]);
  assert.deepEqual(manifest.unmatchedObservationIds, [3, 999]);
  assert.equal(manifest.observationCount, 1);
  assert.deepEqual(manifest.items.map(item => item.observationId), [2]);
  assert.equal(manifest.items[0].status, 'ready');
  const absent = await previewCreatorAssets({ ...f.options, observationIds: [999] });
  assert.equal(absent.items.length, 0); assert.equal(absent.observationCount, 0);
  assert.equal(unselectedReads, 0, 'unselected media must not be hashed');
});

test('observation selection requires nonempty positive safe integers and at most 100 distinct IDs', async t => {
  const f = fixture(t); f.add({ source: f.video() });
  for (const observationIds of [null, '1', [], [0], [-1], [1.5], ['1'], [NaN], [Infinity],
    [Number.MAX_SAFE_INTEGER + 1], Array.from({ length: 101 }, (_, index) => index + 1)]) {
    await assert.rejects(previewCreatorAssets({ ...f.options, observationIds }), /编号|整数|100/);
  }
  const valid = await previewCreatorAssets({ ...f.options, observationIds: Array.from({ length: 100 }, (_, index) => index + 2) });
  assert.equal(valid.observationIds.length, 100); assert.equal(valid.observationCount, 0);
});

test('CLI observation IDs preserve a bounded selected scope and reject malformed comma lists', t => {
  const f = fixture(t); f.add({ source: f.video() }); f.add({ id: 2 });
  const script = path.join(__dirname, '..', 'scripts', 'recover-creator-assets.js');
  const args = [`--db=${f.dbPath}`, `--target-root=${f.targetRoot}`, `--allow-root=${f.old}`];
  const result = spawnSync(process.execPath, [script, ...args, '--observation-ids=2,2'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).observationIds, [2]);
  assert.deepEqual(JSON.parse(result.stdout).items.map(item => item.observationId), [2]);
  for (const value of ['0', '-1', '1.5', '1e2', '01', '1,', '1, 2', '9007199254740992']) {
    const rejected = spawnSync(process.execPath, [script, ...args, '--observation-ids=' + value], { encoding: 'utf8' });
    assert.notEqual(rejected.status, 0, value); assert.equal(rejected.stdout, '');
  }
});
