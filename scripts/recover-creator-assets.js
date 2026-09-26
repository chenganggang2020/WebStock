// Deliberately read-only for the database. Staging copies are not production recovery.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const SCHEMA = 'webstock.creator-assets-recovery/v1';
const AUTHORS = [1, 4, 5];
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function within(root, filename) {
  const relative = path.relative(root, filename);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
function absolute(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('必须提供明确的绝对路径');
  return path.resolve(value);
}
function canonical(filename) {
  if (fs.existsSync(filename)) return fs.realpathSync(filename);
  const parent = path.dirname(filename);
  if (parent === filename) throw new Error('路径根不可达');
  return path.join(canonical(parent), path.basename(filename));
}
async function fingerprint(filename) {
  const before = await fs.promises.stat(filename);
  if (!before.isFile()) throw new Error('not_regular_file');
  const checksum = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) checksum.update(chunk);
  const after = await fs.promises.stat(filename);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) throw new Error('source_changed');
  return { sha256: checksum.digest('hex'), bytes: after.size };
}
async function inspectSource(filename, roots, expectedName) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename)) {
    return { path: null, status: 'invalid_local_reference', reason: '不是绝对本地文件路径；未输出原始值' };
  }
  try {
    filename = absolute(filename);
    if (!roots.some(root => within(root, filename))) return { path: filename, status: 'outside_allowed_roots' };
    if (path.basename(filename) !== expectedName) return { path: filename, status: 'identity_mismatch' };
    const real = await fs.promises.realpath(filename);
    if (!roots.some(root => within(root, real))) return { path: filename, status: 'outside_allowed_roots' };
    return { path: filename, realPath: real, status: 'readable', ...await fingerprint(real) };
  } catch (error) {
    return { path: filename, status: error.code === 'ENOENT' ? 'missing' : 'unreadable', reason: error.code || error.message };
  }
}
function readRows(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return db.transaction(() => db.prepare(`SELECT o.id, o.channel_id, c.display_name,
      o.external_content_id, o.media_type, o.local_asset_path, o.media_metadata_json, o.updated_at
      FROM expert_observations o JOIN expert_channels c ON c.id=o.channel_id
      WHERE o.channel_id IN (1,4,5) AND c.platform='douyin' AND o.media_type IN ('video','note')
      ORDER BY o.channel_id, o.id`).all())();
  } finally { db.close(); }
}
function assetSpecs(row, metadata) {
  if (row.media_type === 'video') return [{
    relativePath: row.external_content_id + '.mp4', pageIndex: null,
    references: [row.local_asset_path, metadata.archive?.localAssetPath, metadata.asr?.localAssetPath].filter(Boolean),
    expectedHashes: [metadata.archive?.mediaSha256, metadata.asr?.mediaSha256].filter(Boolean)
  }];
  const note = metadata.note || {};
  const pages = Array.isArray(note.pages) ? note.pages : [];
  if (pages.some(page => !page || typeof page !== 'object' || !Number.isInteger(page.index) || page.index < 1 || page.index > 99) ||
      new Set(pages.map(page => page.index)).size !== pages.length) throw new Error('invalid_note_pages');
  const indices = [...new Set([...pages.map(page => page.index),
    ...Array.from({ length: Math.min(99, Math.max(0, Number(note.imageCount) || 0)) }, (_, index) => index + 1)])];
  return (indices.length ? indices : [1]).sort((a, b) => a - b).map(index => {
    const page = pages.find(item => item.index === index) || {};
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[page.mimeType];
    const valid = Number.isInteger(index) && index >= 1 && index <= 99 && extension && /^[a-f0-9]{64}$/.test(page.sha256 || '');
    return { pageIndex: index, relativePath: valid ? path.join('notes', String(row.channel_id),
      row.external_content_id, String(index).padStart(3, '0') + '-' + page.sha256 + '.' + extension) : null,
    references: page.localAssetPath ? [page.localAssetPath] : [], expectedHashes: page.sha256 ? [page.sha256] : [] };
  });
}

function safeTarget(root, relative) {
  const filename = path.resolve(root, relative);
  if (!within(root, filename) || filename === root) throw new Error('目标路径越界');
  let current = root;
  for (const part of path.relative(root, filename).split(path.sep)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('目标含符号链接');
  }
  return filename;
}
function freeBytes(directory) {
  while (!fs.existsSync(directory)) directory = path.dirname(directory);
  const disk = fs.statfsSync(directory);
  return disk.bavail * disk.bsize;
}
function selectedObservations(value) {
  if (value === undefined) return null;
  if (!Array.isArray(value) || !value.length || value.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error('作品编号必须为非空正整数数组');
  }
  const ids = [...new Set(value)];
  if (ids.length > 100) throw new Error('作品编号去重后最多 100 个');
  return ids;
}
async function previewCreatorAssets({ dbPath, targetRoot, allowedRoots, observationIds }) {
  const selectedIds = selectedObservations(observationIds);
  dbPath = fs.realpathSync(absolute(dbPath));
  targetRoot = canonical(absolute(targetRoot));
  if (!Array.isArray(allowedRoots) || !allowedRoots.length) throw new Error('必须指定允许的旧媒体根');
  const roots = [...new Set(allowedRoots.map(root => fs.realpathSync(absolute(root))))];
  for (const root of roots) {
    if (root === path.parse(root).root || !fs.statSync(root).isDirectory()) throw new Error('不允许宽泛磁盘根或非目录');
  }
  const rows = readRows(dbPath).filter(row => selectedIds === null || selectedIds.includes(row.id)), items = [];
  for (const row of rows) {
    let metadata;
    try { metadata = JSON.parse(row.media_metadata_json || '{}'); }
    catch (_) { metadata = null; }
    const base = { observationId: row.id, channelId: row.channel_id, author: row.display_name,
      externalContentId: row.external_content_id, mediaType: row.media_type, updatedAt: row.updated_at,
      recordFingerprint: hash(JSON.stringify(row)) };
    if (!metadata || typeof metadata !== 'object' || !/^\d{12,24}$/.test(row.external_content_id)) {
      items.push({ ...base, status: 'invalid_record', references: [] }); continue;
    }
    let specs;
    try { specs = assetSpecs(row, metadata); }
    catch (error) { items.push({ ...base, status: 'invalid_record', reason: error.message, references: [] }); continue; }
    for (const spec of specs) {
      const item = { ...base, pageIndex: spec.pageIndex, relativePath: spec.relativePath,
        targetPath: spec.relativePath ? path.join(targetRoot, spec.relativePath) : null, references: [] };
      items.push(item);
      if (!spec.references.length) { item.status = 'no_local_reference'; continue; }
      if (!spec.relativePath) { item.status = 'identity_mismatch'; continue; }
      for (const filename of [...new Set(spec.references)]) {
        item.references.push(await inspectSource(filename, roots, path.basename(spec.relativePath)));
      }
      const readable = item.references.filter(reference => reference.status === 'readable');
      if (!readable.length) { item.status = item.references[0].status; continue; }
      if (new Set(readable.map(reference => reference.sha256)).size > 1) { item.status = 'conflicting_sources'; continue; }
      const source = readable[0];
      Object.assign(item, { sourcePath: source.realPath, sha256: source.sha256, bytes: source.bytes });
      if (spec.expectedHashes.some(expected => expected !== source.sha256)) { item.status = 'source_hash_mismatch'; continue; }
      item.status = 'ready';
      try {
        const target = safeTarget(targetRoot, spec.relativePath);
        if (fs.existsSync(target)) {
          const existing = await fingerprint(target);
          item.targetSha256 = existing.sha256;
          item.status = existing.sha256 === item.sha256 ? 'already_present' : 'target_conflict';
        }
      } catch (error) { item.status = 'target_conflict'; item.reason = error.code || error.message; }
    }
  }
  const byTarget = new Map();
  for (const item of items.filter(item => ['ready', 'already_present'].includes(item.status))) {
    const group = byTarget.get(item.targetPath) || [];
    group.push(item); byTarget.set(item.targetPath, group);
  }
  for (const group of byTarget.values()) {
    if (new Set(group.map(item => item.sha256)).size > 1) group.forEach(item => { item.status = 'target_conflict'; });
  }
  const unique = new Map(items.filter(item => item.status === 'ready').map(item => [item.targetPath, item.bytes]));
  return { schema: SCHEMA, mode: 'preview', createdAt: new Date().toISOString(), databaseUpdated: false,
    dbPath, authorIds: AUTHORS, targetRoot, allowedRoots: roots, observationCount: rows.length,
    observationIds: selectedIds,
    unmatchedObservationIds: selectedIds ? selectedIds.filter(id => !rows.some(row => row.id === id)) : [],
    copyBytes: [...unique.values()].reduce((total, bytes) => total + bytes, 0),
    targetFreeBytes: freeBytes(targetRoot), counts: items.reduce((counts, item) => {
      counts[item.status] = (counts[item.status] || 0) + 1; return counts;
    }, {}), items, caveat: '只核验已存路径与文件哈希；不猜旧文件、不下载、不改库。隔离复制不等于程序媒体接口已恢复。' };
}

async function copyToIsolated(manifest, directory) {
  if (manifest.schema !== SCHEMA || manifest.mode !== 'preview') throw new Error('需要当前工具的只读预演');
  directory = canonical(absolute(directory));
  const protectedRoots = [path.dirname(manifest.dbPath), manifest.targetRoot, ...manifest.allowedRoots];
  if (protectedRoots.some(root => within(root, directory) || within(directory, root))) throw new Error('隔离目录不能与当前数据或旧根重叠');
  if (!fs.existsSync(path.dirname(directory))) throw new Error('隔离目录的父目录必须已存在');
  const marker = path.join(directory, '.creator-assets-recovery.json');
  const identity = { schema: SCHEMA, dbPath: manifest.dbPath, targetRoot: manifest.targetRoot, allowedRoots: manifest.allowedRoots };
  if (fs.existsSync(directory)) {
    if (!fs.statSync(directory).isDirectory()) throw new Error('隔离目标不是目录');
    if (fs.existsSync(marker)) {
      if (fs.lstatSync(marker).isSymbolicLink() || JSON.stringify(JSON.parse(fs.readFileSync(marker, 'utf8'))) !== JSON.stringify(identity)) {
        throw new Error('隔离目录归属冲突');
      }
    } else if (fs.readdirSync(directory).length) throw new Error('隔离目录必须为空或已有匹配的工具归属记录');
  }
  const result = { ...manifest, mode: 'isolated-copy', stagingRoot: directory,
    items: manifest.items.map(item => ({ ...item, copyStatus: 'skipped' })), databaseUpdated: false };
  const stageArchive = path.join(directory, 'media-library', 'douyin');
  const candidates = result.items.filter(item => ['ready', 'already_present'].includes(item.status));
  let requiredBytes = 1024 * 1024;
  const targets = new Set();
  // Finish all source/target checks before creating anything in the isolated directory.
  for (const item of candidates) {
    if (!AUTHORS.includes(item.channelId) || !/^\d{12,24}$/.test(item.externalContentId) || !/^[a-f0-9]{64}$/.test(item.sha256 || '')) {
      throw new Error('清单作品身份无效');
    }
    const source = await inspectSource(item.sourcePath, manifest.allowedRoots, path.basename(item.relativePath));
    if (source.status !== 'readable' || source.sha256 !== item.sha256 || source.bytes !== item.bytes) throw new Error('source changed: 源文件自预演后变化或不可读');
    item.stagedPath = safeTarget(directory, path.join('media-library', 'douyin', item.relativePath));
    if (!within(stageArchive, item.stagedPath)) throw new Error('隔离媒体目标越界');
    if (fs.existsSync(item.stagedPath)) {
      if ((await fingerprint(item.stagedPath)).sha256 !== item.sha256) throw new Error('目标 conflict: 已有不同内容，禁止覆盖');
      item.copyStatus = 'reused';
    } else if (!targets.has(item.stagedPath)) { requiredBytes += item.bytes; targets.add(item.stagedPath); }
  }
  if (freeBytes(path.dirname(directory)) < requiredBytes) throw new Error('隔离复制可用空间不足');
  fs.mkdirSync(directory, { recursive: true });
  if (!fs.existsSync(marker)) fs.writeFileSync(marker, JSON.stringify(identity), { flag: 'wx' });
  result.manifestPath = path.join(directory, 'manifest-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.json');
  let failure;
  try {
    for (const item of candidates) {
      if (item.copyStatus === 'reused') continue;
      // Recheck links immediately before mutation, then install without overwriting an existing name.
      safeTarget(directory, path.relative(directory, item.stagedPath));
      fs.mkdirSync(path.dirname(item.stagedPath), { recursive: true });
      const temp = item.stagedPath + '-' + crypto.randomBytes(6).toString('hex') + '.part';
      try {
        await fs.promises.copyFile(item.sourcePath, temp, fs.constants.COPYFILE_EXCL);
        const copied = await fingerprint(temp);
        if (copied.sha256 !== item.sha256 || copied.bytes !== item.bytes) throw new Error('源文件在复制期间变化，副本校验失败');
        try { await fs.promises.link(temp, item.stagedPath); item.copyStatus = 'copied'; }
        catch (error) {
          if (error.code !== 'EEXIST' || (await fingerprint(safeTarget(directory, path.relative(directory, item.stagedPath)))).sha256 !== item.sha256) throw error;
          item.copyStatus = 'reused';
        }
      } catch (error) { item.copyStatus = 'failed'; item.copyError = error.code || error.message; throw error; }
      finally { if (fs.existsSync(temp)) await fs.promises.unlink(temp); }
    }
  } catch (error) { failure = error; }
  result.completed = !failure;
  fs.writeFileSync(result.manifestPath, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  if (failure) throw new Error(failure.message + '; 隔离清单: ' + result.manifestPath);
  return result;
}

async function main(argv) {
  if (argv.length === 1 && argv[0] === '--help') {
    console.log('Usage: node scripts/recover-creator-assets.js --db=<absolute current.db> --target-root=<current media-library/douyin> --allow-root=<explicit old media-library/douyin> [--allow-root=<another old root>] [--observation-ids=808,809] [--out=<new manifest.json>] [--copy-to=<isolated staging directory>]\nDefault: read-only preview on stdout. Authors: 1,4,5 only. --observation-ids further limits the scope to at most 100 distinct positive IDs; omitted means all eligible works. --out creates a new manifest without overwriting. --copy-to creates verified staging copies, never database updates. --apply is intentionally unsupported.');
    return;
  }
  const args = {}, allowedRoots = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index], equal = argument.indexOf('=');
    const key = equal < 0 ? argument : argument.slice(0, equal);
    if (key === '--apply') throw new Error('--apply 不支持：本工具不做生产迁移，必须另行离线备份、CAS 更新与媒体接口验收');
    if (!['--db', '--target-root', '--allow-root', '--out', '--copy-to', '--observation-ids'].includes(key)) throw new Error('未知参数: ' + key);
    const value = equal < 0 ? argv[++index] : argument.slice(equal + 1);
    if (!value || value.startsWith('--')) throw new Error('参数缺少值: ' + key);
    if (key === '--allow-root') allowedRoots.push(value);
    else {
      if (args[key]) throw new Error('参数重复: ' + key);
      args[key] = value;
    }
  }
  let observationIds;
  if (args['--observation-ids'] !== undefined) {
    const parts = args['--observation-ids'].split(',');
    if (parts.some(part => !/^[1-9]\d*$/.test(part))) throw new Error('作品编号必须是逗号分隔的正整数');
    observationIds = selectedObservations(parts.map(Number));
  }
  const preview = await previewCreatorAssets({ dbPath: args['--db'], targetRoot: args['--target-root'], allowedRoots, observationIds });
  const result = args['--copy-to'] ? await copyToIsolated(preview, args['--copy-to']) : preview;
  if (args['--out']) {
    const filename = absolute(args['--out']);
    if ([path.dirname(preview.dbPath), preview.targetRoot, ...preview.allowedRoots].some(root => within(root, canonical(filename)))) {
      throw new Error('清单输出不能放在当前数据或旧媒体根内');
    }
    fs.writeFileSync(filename, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  }
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) main(process.argv.slice(2)).catch(error => {
  console.error(error.message); process.exitCode = 1;
});
module.exports = { previewCreatorAssets, copyToIsolated };
