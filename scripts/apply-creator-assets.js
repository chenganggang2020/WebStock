// Offline deployment helper only. Never imported by the running application.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const Database = require('better-sqlite3');
const executeFile = promisify(execFile);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const SELECT_ROWS = `SELECT o.id, o.channel_id, c.display_name, o.external_content_id,
  o.media_type, o.local_asset_path, o.media_metadata_json, o.updated_at
  FROM expert_observations o JOIN expert_channels c ON c.id=o.channel_id
  WHERE o.channel_id IN (1,4,5) AND c.platform='douyin' AND o.media_type IN ('video','note')`;

function within(root, file) {
  const relative = path.relative(root, file);
  return !relative || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}
function noLinks(value, mustExist = false) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('必须使用绝对路径');
  const resolved = path.resolve(value), parsed = path.parse(resolved);
  let cursor = parsed.root;
  for (const part of resolved.slice(parsed.root.length).split(path.sep)) {
    cursor = path.join(cursor, part);
    try { if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('路径含符号链接/junction'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (mustExist) {
    let actual;
    try { actual = fs.realpathSync(resolved); }
    catch (_) { throw new Error('路径真实身份不可核验（不存在或不可读）'); }
    if (path.relative(resolved, actual)) throw new Error('路径真实身份不匹配');
  }
  return resolved;
}
async function fileHash(filename) {
  const digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) digest.update(chunk);
  return digest.digest('hex');
}
function fileStamp(filename) {
  const stat = fs.statSync(noLinks(filename, true), { bigint: true });
  if (!stat.isFile()) throw new Error('目标不是普通文件');
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}
function portActive(host) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: 3000 });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(750, () => { socket.destroy(); reject(new Error('无法确认 3000 端口离线')); });
    socket.once('connect', () => finish(true));
    socket.once('error', error => {
      if (['ECONNREFUSED', 'EADDRNOTAVAIL'].includes(error.code)) finish(false);
      else { socket.destroy(); reject(error); }
    });
  });
}
async function listWriters(dbPath) {
  if (process.platform !== 'win32') throw new Error('非 Windows 环境需要调用方提供进程离线检查');
  const command = `$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process | Where-Object {
    $_.ProcessId -ne [int]$env:CREATOR_RECOVERY_PID -and ($_.Name -like 'WebStock*.exe' -or
    (($_.Name -match '^(node|electron|python|pythonw)\\.exe$') -and $_.CommandLine -and
    $_.CommandLine.IndexOf($env:CREATOR_RECOVERY_DATA_ROOT,[StringComparison]::OrdinalIgnoreCase) -ge 0))
  } | Select-Object ProcessId,Name) | ConvertTo-Json -Compress`;
  const result = await executeFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true, timeout: 10000, env: { ...process.env, CREATOR_RECOVERY_PID: String(process.pid),
      CREATOR_RECOVERY_DATA_ROOT: path.dirname(dbPath) }
  });
  const rows = JSON.parse(result.stdout || '[]'); return Array.isArray(rows) ? rows : [rows];
}
async function assertOffline(dbPath, dependencies = {}) {
  const checkPort = dependencies.portActive || portActive;
  if (await checkPort('127.0.0.1') || await checkPort('::1')) throw new Error('3000 端口仍活跃，拒绝离线迁移');
  const writers = await (dependencies.listWriters || listWriters)(dbPath);
  if (writers.length) throw new Error('仍有相关 writer 进程，拒绝离线迁移');
}

function expectedAsset(row, item) {
  if (item.channelId !== row.channel_id || item.externalContentId !== row.external_content_id || item.mediaType !== row.media_type ||
      !/^\d{12,24}$/.test(row.external_content_id)) throw new Error('清单作品身份不匹配');
  const metadata = JSON.parse(row.media_metadata_json || '{}');
  let relativePath, references, expectedHashes;
  if (row.media_type === 'video') {
    relativePath = row.external_content_id + '.mp4';
    references = [row.local_asset_path, metadata.archive?.localAssetPath, metadata.asr?.localAssetPath].filter(Boolean);
    expectedHashes = [metadata.archive?.mediaSha256, metadata.asr?.mediaSha256].filter(Boolean);
  } else {
    const pages = metadata.note?.pages;
    const matches = Array.isArray(pages) ? pages.filter(page => page && page.index === item.pageIndex) : [];
    if (matches.length !== 1 || !Number.isInteger(item.pageIndex) || item.pageIndex < 1 || item.pageIndex > 99) throw new Error('清单图片页身份不匹配');
    const page = matches[0], extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[page.mimeType];
    if (!extension || !/^[a-f0-9]{64}$/.test(page.sha256 || '')) throw new Error('清单图片哈希不匹配');
    relativePath = path.join('notes', String(row.channel_id), row.external_content_id,
      String(item.pageIndex).padStart(3, '0') + '-' + page.sha256 + '.' + extension);
    references = [page.localAssetPath].filter(Boolean); expectedHashes = [page.sha256];
  }
  return { relativePath, references, expectedHashes };
}
async function validateAssets(row, items, manifest, verifiedFiles) {
  for (const item of items) {
    const expected = expectedAsset(row, item);
    if (item.relativePath !== expected.relativePath || path.relative(item.targetPath, path.join(manifest.targetRoot, expected.relativePath))) {
      throw new Error('清单目标路径不匹配');
    }
    const source = noLinks(item.sourcePath, true), target = noLinks(item.targetPath);
    if (!manifest.allowedRoots.some(root => within(root, source)) || !expected.references.some(reference => {
      try { return path.relative(noLinks(reference, true), source) === ''; } catch (_) { return false; }
    })) throw new Error('清单源路径不属于已记录且允许的媒体根');
    if (!/^[a-f0-9]{64}$/.test(item.sha256 || '') || expected.expectedHashes.some(value => value !== item.sha256)) throw new Error('清单哈希与记录不匹配');
    if (!verifiedFiles.has(source)) {
      const stat = fs.statSync(source);
      if (!stat.isFile()) throw new Error('源不是普通文件');
      verifiedFiles.set(source, { bytes: stat.size, sha256: await fileHash(source) });
    }
    const actual = verifiedFiles.get(source);
    if (actual.bytes !== item.bytes || actual.sha256 !== item.sha256) throw new Error('源文件 changed/变化，重新预演');
    if (fs.existsSync(target) && (!fs.statSync(target).isFile() || await fileHash(target) !== item.sha256)) throw new Error('目标内容冲突，禁止覆盖');
  }
}
function updatedPaths(row, items) {
  const metadata = JSON.parse(row.media_metadata_json || '{}');
  let localPath = row.local_asset_path;
  for (const item of items) {
    if (row.media_type === 'video') {
      localPath = item.targetPath;
      for (const key of ['archive', 'asr']) {
        if (metadata[key] && Object.hasOwn(metadata[key], 'localAssetPath')) metadata[key].localAssetPath = item.targetPath;
      }
    } else metadata.note.pages.find(page => page.index === item.pageIndex).localAssetPath = item.targetPath;
  }
  return { localPath, metadataJson: JSON.stringify(metadata) };
}
function verifyBackup(source, backupPath, plans) {
  const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
  try {
    const schemaSql = "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name";
    if (JSON.stringify(source.prepare(schemaSql).all()) !== JSON.stringify(backup.prepare(schemaSql).all())) throw new Error('备份 schema 不匹配');
    for (const plan of plans) {
      const sql = 'SELECT * FROM expert_observations WHERE id=?';
      if (JSON.stringify(source.prepare(sql).get(plan.row.id)) !== JSON.stringify(backup.prepare(sql).get(plan.row.id))) throw new Error('备份当前作品快照不匹配');
    }
  } finally { backup.close(); }
}
async function installFile(item) {
  const destination = noLinks(item.targetPath);
  if (fs.existsSync(destination)) {
    if (await fileHash(destination) !== item.sha256) throw new Error('目标冲突');
    return 'reused';
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = destination + '-' + crypto.randomBytes(8).toString('hex') + '.part';
  try {
    await fs.promises.copyFile(noLinks(item.sourcePath, true), temporary, fs.constants.COPYFILE_EXCL);
    if (await fileHash(temporary) !== item.sha256 || fs.statSync(temporary).size !== item.bytes) throw new Error('复制后哈希/大小不匹配');
    noLinks(destination);
    try { fs.linkSync(temporary, destination); return 'copied'; }
    catch (error) {
      if (error.code === 'EEXIST' && await fileHash(noLinks(destination, true)) === item.sha256) return 'reused';
      throw error;
    }
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

async function applyCreatorAssets(options, dependencies = {}) {
  if (options.offline !== true) throw new Error('必须显式 --offline 并由部署者确认所有后台已退出');
  const dbPath = noLinks(options.dbPath, true), manifestPath = noLinks(options.manifestPath, true);
  if (fs.statSync(manifestPath).size > 20 * 1024 * 1024) throw new Error('清单过大');
  const input = fs.readFileSync(manifestPath, 'utf8'), manifest = JSON.parse(input);
  const expectedRoot = path.join(path.dirname(dbPath), 'media-library', 'douyin');
  if (manifest.schema !== 'webstock.creator-assets-recovery/v1' || manifest.mode !== 'preview' ||
      noLinks(manifest.dbPath, true) !== dbPath || noLinks(manifest.targetRoot) !== expectedRoot ||
      !Array.isArray(manifest.allowedRoots) || !manifest.allowedRoots.length || !Array.isArray(manifest.items)) throw new Error('清单 schema/DB/目标根身份不匹配');
  for (const root of manifest.allowedRoots) {
    if (noLinks(root, true) !== root || root === path.parse(root).root || !fs.statSync(root).isDirectory()) throw new Error('允许的旧根身份无效');
  }
  const backupPath = noLinks(options.backupPath), auditPath = noLinks(options.auditPath || backupPath + '.apply.json');
  for (const filename of [backupPath, auditPath]) {
    if (filename === dbPath || filename === manifestPath || within(expectedRoot, filename) ||
        manifest.allowedRoots.some(root => within(root, filename)) || !fs.statSync(path.dirname(filename)).isDirectory()) throw new Error('备份/审计路径身份无效');
  }
  if (backupPath === auditPath || fs.existsSync(auditPath)) throw new Error('审计目标已存在');
  if (options.backupExisting ? !fs.existsSync(backupPath) : fs.existsSync(backupPath)) throw new Error('备份存在状态不匹配；复用须显式 --existing-backup');
  const checkOffline = dependencies.assertOffline || assertOffline;
  const progress = dependencies.onProgress || (() => {});
  await checkOffline(dbPath);
  const source = new Database(dbPath, { readonly: true, fileMustExist: true });
  const audit = { schema: 'webstock.creator-assets-apply/v1', sourceDbPath: dbPath, manifestPath,
    manifestSha256: hash(input), backupPath, auditPath, backupMode: options.backupExisting ? 'existing-sqlite-backup' : 'created-sqlite-backup',
    backupVerifiedRecords: 0, startedAt: new Date().toISOString(), phase: 'validating', databaseUpdated: false,
    updatedRows: 0, skippedRows: 0, records: [], files: [],
    caveat: '保留原文件；仅修改验证通过的路径。备份核验范围为结构及本次作品完整行，不是本工具对全库重新完整性检查。' };
  let auditFd;
  const saveAudit = () => {
    const text = JSON.stringify(audit, null, 2) + '\n';
    fs.writeSync(auditFd, text, 0, 'utf8'); fs.ftruncateSync(auditFd, Buffer.byteLength(text)); fs.fsyncSync(auditFd);
  };
  try {
    const rows = new Map(source.prepare(SELECT_ROWS).all().map(row => [row.id, row]));
    const groups = new Map(), keys = new Set();
    for (const item of manifest.items.filter(item => ['ready', 'already_present'].includes(item.status))) {
      const key = item.observationId + ':' + item.pageIndex;
      if (keys.has(key)) throw new Error('清单作品/页重复'); keys.add(key);
      const group = groups.get(item.observationId) || []; group.push(item); groups.set(item.observationId, group);
    }
    const plans = [], verifiedFiles = new Map(), destinations = new Map();
    let inspected = 0;
    for (const [observationId, items] of groups) {
      progress({ phase: 'validating', completed: ++inspected, total: groups.size });
      const row = rows.get(observationId);
      const record = { observationId, expectedFingerprint: items[0].recordFingerprint, status: 'pending' };
      audit.records.push(record);
      if (!row || items.some(item => item.recordFingerprint !== hash(JSON.stringify(row)))) {
        record.status = 'skipped_record_changed'; audit.skippedRows++; continue;
      }
      await validateAssets(row, items, manifest, verifiedFiles);
      for (const item of items) {
        if (destinations.has(item.targetPath) && destinations.get(item.targetPath).sha256 !== item.sha256) throw new Error('清单同目标内容冲突');
        destinations.set(item.targetPath, item);
      }
      const updated = updatedPaths(row, items);
      plans.push({ row, items, updated, record });
      record.afterFingerprint = hash(JSON.stringify({ ...row, local_asset_path: updated.localPath, media_metadata_json: updated.metadataJson }));
      record.paths = items.map(item => ({ pageIndex: item.pageIndex, sourcePath: item.sourcePath, targetPath: item.targetPath, sha256: item.sha256 }));
    }
    let requiredBytes = 1024 * 1024;
    for (const item of destinations.values()) if (!fs.existsSync(item.targetPath)) requiredBytes += item.bytes;
    if (!options.backupExisting && plans.length) requiredBytes += source.pragma('page_count', { simple: true }) * source.pragma('page_size', { simple: true });
    for (const parent of [path.dirname(dbPath), path.dirname(backupPath)]) {
      const disk = fs.statfsSync(parent);
      if (disk.bavail * disk.bsize < requiredBytes) throw new Error('备份及复制空间不足');
    }
    auditFd = fs.openSync(auditPath, 'wx'); saveAudit();
    const installedStamps = new Map();
    if (plans.length) {
      if (!options.backupExisting) {
        const reserved = fs.openSync(backupPath, 'wx'); fs.closeSync(reserved);
        await source.backup(backupPath);
      }
      verifyBackup(source, backupPath, plans); audit.backupVerifiedRecords = plans.length;
      audit.phase = 'backed_up'; saveAudit();
      for (const item of destinations.values()) {
        const status = await installFile(item);
        installedStamps.set(item.targetPath, fileStamp(item.targetPath));
        audit.files.push({ sourcePath: item.sourcePath, targetPath: item.targetPath, sha256: item.sha256, bytes: item.bytes, status });
        progress({ phase: 'copying', completed: audit.files.length, total: destinations.size });
      }
    }
    audit.phase = 'copied'; saveAudit();
    await checkOffline(dbPath);
    // Content was already hashed on install; reject subsequent file replacement/change
    // without rereading multi-GB media again while the application stays offline.
    for (const [filename, stamp] of installedStamps) {
      if (fileStamp(filename) !== stamp) throw new Error('目标文件在复制后变化，拒绝更新路径');
    }
    // Copying and hashing are finished before the short write transaction.
    const writer = new Database(dbPath, { fileMustExist: true, timeout: 0 });
    try {
      const outcomes = writer.transaction(() => {
        const results = [];
        const current = writer.prepare(SELECT_ROWS + ' AND o.id=?');
        const update = writer.prepare(`UPDATE expert_observations SET local_asset_path=?,media_metadata_json=?
          WHERE id=? AND channel_id=? AND external_content_id IS ? AND media_type IS ?
          AND local_asset_path IS ? AND media_metadata_json IS ? AND updated_at IS ?`);
        for (const plan of plans) {
          const row = current.get(plan.row.id);
          if (!row || hash(JSON.stringify(row)) !== plan.record.expectedFingerprint) {
            results.push({ plan, status: 'skipped_cas_changed' }); continue;
          }
          const updated = update.run(plan.updated.localPath, plan.updated.metadataJson, row.id, row.channel_id,
            row.external_content_id, row.media_type, row.local_asset_path, row.media_metadata_json, row.updated_at);
          results.push({ plan, status: updated.changes === 1 ? 'updated' : 'skipped_cas_changed' });
        }
        return results;
      }).immediate();
      for (const { plan, status } of outcomes) {
        plan.record.status = status;
        if (status === 'updated') audit.updatedRows++; else audit.skippedRows++;
      }
    } finally { writer.close(); }
    audit.databaseUpdated = audit.updatedRows > 0; audit.phase = 'committed'; audit.finishedAt = new Date().toISOString();
    saveAudit(); return audit;
  } catch (error) {
    if (auditFd !== undefined) { audit.phase = 'failed'; audit.error = error.code || error.message; saveAudit(); }
    throw error;
  } finally { source.close(); if (auditFd !== undefined) fs.closeSync(auditFd); }
}

function parseArgs(args) {
  const names = { manifest: 'manifestPath', db: 'dbPath', backup: 'backupPath', audit: 'auditPath',
    offline: 'offline', 'existing-backup': 'backupExisting', help: 'help' };
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(args[index]);
    if (!match || !Object.hasOwn(names, match[1])) throw new Error('未知选项: ' + args[index]);
    const key = names[match[1]];
    if (Object.hasOwn(options, key)) throw new Error('重复选项: ' + match[1]);
    if (['offline', 'backupExisting', 'help'].includes(key)) {
      if (match[2] !== undefined) throw new Error('标志不接受额外值: ' + match[1]);
      options[key] = true;
    } else {
      const value = match[2] === undefined ? args[++index] : match[2];
      if (!value || value.startsWith('--')) throw new Error('必需的选项值缺失: ' + match[1]);
      options[key] = value;
    }
  }
  if (!options.help && ['manifestPath', 'dbPath', 'backupPath', 'auditPath'].some(key => !options[key])) {
    throw new Error('必需参数: --manifest --db --backup --audit；应用还必须显式 --offline');
  }
  return options;
}

if (require.main === module) {
  (async () => {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log('离线媒体路径恢复（会复制媒体并修改已核验路径，不删除原件）\n' +
        'node scripts/apply-creator-assets.js --manifest=<绝对路径> --db=<绝对路径> ' +
        '--backup=<绝对路径> --audit=<新审计路径> --offline [--existing-backup]\n' +
        '无 --existing-backup 时使用 SQLite backup 创建新备份；已有备份须明确指定并核验选中作品完整行。\n' +
        '部署者必须先完全退出程序及其他写入者，工具另检查本机 3000 端口和关联进程。');
      return;
    }
    const result = await applyCreatorAssets(options, { onProgress: ({ phase, completed, total }) => {
      if (completed === 1 || completed % 50 === 0 || completed === total) console.log(`${phase}: ${completed}/${total}`);
    } });
    console.log(JSON.stringify({ phase: result.phase, updatedRows: result.updatedRows, skippedRows: result.skippedRows,
      files: result.files.length, backupVerifiedRecords: result.backupVerifiedRecords, auditPath: result.auditPath }));
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { assertOffline, applyCreatorAssets, parseArgs };
