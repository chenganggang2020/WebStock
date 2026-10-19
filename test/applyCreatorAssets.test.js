const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { previewCreatorAssets } = require('../scripts/recover-creator-assets');
const { applyCreatorAssets, assertOffline, parseArgs } = require('../scripts/apply-creator-assets');

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const id = '7000000000000000001';
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'creator-assets-apply-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const current = path.join(root, 'current'), old = path.join(root, 'old');
  fs.mkdirSync(current); fs.mkdirSync(old);
  const dbPath = path.join(current, 'webstock.db'), targetRoot = path.join(current, 'media-library', 'douyin');
  const source = path.join(old, id + '.mp4'); fs.writeFileSync(source, 'video');
  const pageHash = digest('image'), pageRelative = path.join('notes', '5', id, '001-' + pageHash + '.png');
  const image = path.join(old, pageRelative); fs.mkdirSync(path.dirname(image), { recursive: true }); fs.writeFileSync(image, 'image');
  const metadata = { archive: { localAssetPath: source, mediaSha256: digest('video'), mediaBytes: 5 },
    asr: { localAssetPath: source, model: 'small', status: 'needs_review' }, privateExtra: { keep: true } };
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE expert_channels (id INTEGER PRIMARY KEY, display_name TEXT, platform TEXT);
    CREATE TABLE expert_observations (id INTEGER PRIMARY KEY, channel_id INTEGER, external_content_id TEXT,
      media_type TEXT, local_asset_path TEXT, media_metadata_json TEXT, updated_at TEXT,
      transcript_text TEXT, content_text TEXT, published_at TEXT);
    INSERT INTO expert_channels VALUES (4,'Fioona','douyin'),(5,'Tank','douyin');`);
  db.prepare('INSERT INTO expert_observations VALUES (1,4,?,?,?,?,?,?,?,?)').run(id, 'video', source,
    JSON.stringify(metadata), '2026-09-20', '原始文稿', '原文', '2026-08-01');
  db.prepare('INSERT INTO expert_observations VALUES (2,5,?,?,?,?,?,?,?,?)').run(id, 'note', '',
    JSON.stringify({ note: { status: 'needs_review', imageCount: 2, pages: [
      { index: 1, localAssetPath: image, sha256: pageHash, mimeType: 'image/png', text: '第一页' },
      { index: 2, text: '保留的第二页', status: 'error' }
    ] }, keep: 'other-metadata' }), '2026-09-21', '', '图文正文', '2026-08-02');
  db.close();
  const manifest = await previewCreatorAssets({ dbPath, targetRoot, allowedRoots: [old] });
  const manifestPath = path.join(root, 'preview.json'); fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  function readRows(filename = dbPath) {
    const connection = new Database(filename, { readonly: true });
    try { return connection.prepare('SELECT * FROM expert_observations ORDER BY id').all(); }
    finally { connection.close(); }
  }
  const options = { manifestPath, dbPath, backupPath: path.join(root, 'before.db'), offline: true,
    auditPath: path.join(root, 'apply.json') };
  const dependencies = { assertOffline: async () => {} };
  return { root, current, old, source, image, pageRelative, dbPath, targetRoot, manifest, manifestPath,
    options, dependencies, readRows };
}

test('offline apply creates verified SQLite backup and changes only verified media references', async t => {
  const f = await fixture(t), before = f.readRows();
  const result = await applyCreatorAssets(f.options, f.dependencies);
  assert.equal(result.databaseUpdated, true); assert.equal(result.updatedRows, 2);
  assert.deepEqual(f.readRows(f.options.backupPath), before);
  const rows = f.readRows(), video = path.join(f.targetRoot, id + '.mp4');
  assert.equal(rows[0].local_asset_path, video);
  const metadata = JSON.parse(rows[0].media_metadata_json);
  assert.equal(metadata.archive.localAssetPath, video); assert.equal(metadata.asr.localAssetPath, video);
  assert.equal(metadata.asr.status, 'needs_review'); assert.deepEqual(metadata.privateExtra, { keep: true });
  const note = JSON.parse(rows[1].media_metadata_json).note;
  assert.equal(note.pages[0].localAssetPath, path.join(f.targetRoot, f.pageRelative));
  assert.deepEqual(note.pages[1], JSON.parse(before[1].media_metadata_json).note.pages[1]);
  for (let index = 0; index < rows.length; index++) {
    for (const field of ['transcript_text', 'content_text', 'published_at', 'updated_at']) assert.equal(rows[index][field], before[index][field]);
  }
  assert.equal(fs.readFileSync(f.source, 'utf8'), 'video'); assert.equal(fs.readFileSync(f.image, 'utf8'), 'image');
  assert.equal(fs.readFileSync(video, 'utf8'), 'video');
  assert.equal(result.backupVerifiedRecords, 2);
  assert.equal(JSON.parse(fs.readFileSync(f.options.auditPath, 'utf8')).phase, 'committed');
});

test('explicit offline flag and writer guard are required before backup or file mutation', async t => {
  const f = await fixture(t);
  await assert.rejects(applyCreatorAssets({ ...f.options, offline: false }, f.dependencies), /offline|离线/);
  await assert.rejects(applyCreatorAssets(f.options, { assertOffline: async () => { throw new Error('writer active'); } }), /writer active/);
  assert.equal(fs.existsSync(f.options.backupPath), false); assert.equal(fs.existsSync(f.targetRoot), false);
});

test('manifest identity, root and media fields cannot redirect writes', async t => {
  const f = await fixture(t);
  const variants = [
    { ...f.manifest, targetRoot: f.old },
    { ...f.manifest, dbPath: path.join(f.root, 'other.db') },
    { ...f.manifest, allowedRoots: ['relative-old'] },
    { ...f.manifest, items: f.manifest.items.map((item, index) => index ? item : { ...item, targetPath: path.join(f.root, 'escape.mp4') }) }
  ];
  for (const value of variants) {
    fs.writeFileSync(f.manifestPath, JSON.stringify(value));
    await assert.rejects(applyCreatorAssets(f.options, f.dependencies), /identity|身份|根|路径|清单/);
  }
  assert.equal(fs.existsSync(f.targetRoot), false); assert.equal(fs.existsSync(f.options.backupPath), false);
});

test('changed records are skipped while unchanged records apply; changed media still fails verification', async t => {
  const f = await fixture(t);
  const connection = new Database(f.dbPath);
  connection.prepare('UPDATE expert_observations SET updated_at=? WHERE id=1').run('2026-09-27'); connection.close();
  const result = await applyCreatorAssets(f.options, f.dependencies);
  assert.equal(result.updatedRows, 1); assert.equal(result.skippedRows, 1);
  assert.equal(f.readRows()[0].local_asset_path, f.source);
  const other = await fixture(t); fs.writeFileSync(other.source, 'new-video');
  await assert.rejects(applyCreatorAssets(other.options, other.dependencies), /changed|变化|不匹配/);
});

test('existing backup or target collision is never overwritten', async t => {
  const f = await fixture(t);
  fs.writeFileSync(f.options.backupPath, 'do not overwrite');
  await assert.rejects(applyCreatorAssets(f.options, f.dependencies), /存在|exist/);
  assert.equal(fs.readFileSync(f.options.backupPath, 'utf8'), 'do not overwrite');
  fs.mkdirSync(f.targetRoot, { recursive: true }); fs.writeFileSync(path.join(f.targetRoot, id + '.mp4'), 'collision');
  await assert.rejects(applyCreatorAssets({ ...f.options, backupPath: path.join(f.root, 'new-backup.db') }, f.dependencies), /冲突|changed|不匹配|变化/);
  assert.equal(fs.readFileSync(path.join(f.targetRoot, id + '.mp4'), 'utf8'), 'collision');
});

test('CAS revalidation skips a changed work without overwriting it or blocking unchanged work', async t => {
  const f = await fixture(t), before = f.readRows(); let checks = 0;
  const dependencies = { assertOffline: async () => {
    checks++;
    if (checks === 2) {
      const connection = new Database(f.dbPath);
      connection.prepare('UPDATE expert_observations SET updated_at=? WHERE id=2').run('changed-during-copy'); connection.close();
    }
  } };
  const result = await applyCreatorAssets(f.options, dependencies);
  assert.equal(result.updatedRows, 1); assert.equal(result.skippedRows, 1);
  const rows = f.readRows();
  assert.equal(rows[0].local_asset_path, path.join(f.targetRoot, id + '.mp4'));
  assert.equal(rows[1].media_metadata_json, before[1].media_metadata_json);
  assert.equal(rows[1].updated_at, 'changed-during-copy');
  assert.equal(fs.existsSync(path.join(f.targetRoot, id + '.mp4')), true);
  assert.equal(JSON.parse(fs.readFileSync(f.options.auditPath, 'utf8')).skippedRows, 1);
});

test('target directory junction is refused and applying an old committed preview is not a silent replay', async t => {
  const f = await fixture(t);
  fs.mkdirSync(path.dirname(f.targetRoot), { recursive: true }); fs.symlinkSync(f.old, f.targetRoot, 'junction');
  await assert.rejects(applyCreatorAssets(f.options, f.dependencies), /junction|符号链接|根|路径/);
  fs.unlinkSync(f.targetRoot);
  await applyCreatorAssets(f.options, f.dependencies);
  const repeated = await applyCreatorAssets({ ...f.options, backupPath: path.join(f.root, 'again.db'), auditPath: path.join(f.root, 'again.json') }, f.dependencies);
  assert.equal(repeated.updatedRows, 0); assert.equal(repeated.skippedRows, 2);
});

test('an explicitly supplied SQLite backup is reused only when structure and selected original records match', async t => {
  const f = await fixture(t), connection = new Database(f.dbPath, { readonly: true });
  await connection.backup(f.options.backupPath); connection.close();
  const before = fs.readFileSync(f.options.backupPath);
  const result = await applyCreatorAssets({ ...f.options, backupExisting: true }, f.dependencies);
  assert.equal(result.backupMode, 'existing-sqlite-backup');
  assert.deepEqual(fs.readFileSync(f.options.backupPath), before);
  const other = await fixture(t), invalid = new Database(other.options.backupPath);
  invalid.exec('CREATE TABLE unrelated(id INTEGER)'); invalid.close();
  await assert.rejects(applyCreatorAssets({ ...other.options, backupExisting: true }, other.dependencies), /backup|备份/);
  assert.equal(fs.existsSync(other.targetRoot), false);
});

test('offline guard rejects a live local port and matching writer process without killing anything', async () => {
  await assert.rejects(assertOffline('D:/example/webstock.db', {
    portActive: async () => true, listWriters: async () => []
  }), /3000/);
  await assert.rejects(assertOffline('D:/example/webstock.db', {
    portActive: async () => false, listWriters: async () => [{ pid: 123, name: 'WebStock.exe' }]
  }), /writer|进程/);
  await assertOffline('D:/example/webstock.db', { portActive: async () => false, listWriters: async () => [] });
});

test('transaction failure rolls back every record and never reports rolled-back updates in the audit', async t => {
  const f = await fixture(t), before = f.readRows(), connection = new Database(f.dbPath);
  connection.exec(`CREATE TRIGGER reject_second BEFORE UPDATE ON expert_observations WHEN OLD.id=2
    BEGIN SELECT RAISE(ABORT,'fixture rejects second update'); END;`); connection.close();
  await assert.rejects(applyCreatorAssets(f.options, f.dependencies), /fixture rejects/);
  assert.deepEqual(f.readRows(), before);
  const audit = JSON.parse(fs.readFileSync(f.options.auditPath, 'utf8'));
  assert.equal(audit.phase, 'failed'); assert.equal(audit.databaseUpdated, false); assert.equal(audit.updatedRows, 0);
  assert.equal(audit.records.some(record => record.status === 'updated'), false);
  assert.equal(fs.readFileSync(f.source, 'utf8'), 'video');
});

test('copied target corruption before the write transaction aborts without changing records', async t => {
  const f = await fixture(t), before = f.readRows(); let checks = 0;
  await assert.rejects(applyCreatorAssets(f.options, { assertOffline: async () => {
    if (++checks === 2) fs.writeFileSync(path.join(f.targetRoot, id + '.mp4'), 'corrupted');
  } }), /目标|哈希|变化/);
  assert.deepEqual(f.readRows(), before);
  assert.equal(JSON.parse(fs.readFileSync(f.options.auditPath, 'utf8')).databaseUpdated, false);
});

test('CLI requires explicit paths and rejects ambiguous or unexpected options', () => {
  assert.deepEqual(parseArgs(['--manifest=a.json', '--db=b.db', '--backup=c.db', '--audit=d.json', '--offline', '--existing-backup']),
    { manifestPath: 'a.json', dbPath: 'b.db', backupPath: 'c.db', auditPath: 'd.json', offline: true, backupExisting: true });
  assert.throws(() => parseArgs(['--db=x', '--db=y']), /重复/);
  assert.throws(() => parseArgs(['--force']), /未知/);
  assert.throws(() => parseArgs(['--offline']), /必需/);
});
