const axios = require('axios');
const iconv = require('iconv-lite');
const db = require('../db');
const { toSinaSymbol } = require('../utils/market');

const VALID_ROLES = new Set(['总龙头', '趋势龙头', '容量龙头', '补涨龙头', '观察股']);
const DEFAULT_ROLE = Array.from(VALID_ROLES).pop();

function assertCode(code) {
  if (!/^\d{6}$/.test(String(code || ''))) throw new Error('股票代码必须是 6 位数字');
}

function normalizeRole(role) {
  return VALID_ROLES.has(role) ? role : DEFAULT_ROLE;
}

function rowToSector(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    sortOrder: row.sort_order || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToLeader(row) {
  return {
    id: row.id,
    sectorId: row.sector_id,
    code: row.code,
    name: row.name,
    role: row.role,
    reason: row.reason || '',
    weight: row.weight,
    note: row.note || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function recordLeaderSnapshot(leader, sector, quote = {}) {
  if (!leader) return;
  db.prepare(`
    INSERT INTO sector_leader_snapshots (leader_id, sector_id, sector_name, code, name, price, change, amount)
    VALUES (@leaderId, @sectorId, @sectorName, @code, @name, @price, @change, @amount)
  `).run({
    leaderId: leader.id || null,
    sectorId: leader.sectorId || (sector && sector.id) || null,
    sectorName: (sector && sector.name) || leader.sectorName || '',
    code: leader.code,
    name: leader.name || leader.code,
    price: Number.isFinite(Number(quote.price)) ? Number(quote.price) : null,
    change: Number.isFinite(Number(quote.change)) ? Number(quote.change) : null,
    amount: Number.isFinite(Number(quote.amount)) ? Number(quote.amount) : null
  });
}

function rowToSnapshot(row) {
  return {
    id: row.id,
    leaderId: row.leader_id,
    sectorId: row.sector_id,
    sectorName: row.sector_name || '',
    code: row.code,
    name: row.name,
    price: row.price,
    change: row.change,
    amount: row.amount,
    capturedAt: row.captured_at
  };
}

function seedDefaults() {
  const count = db.prepare('SELECT COUNT(*) AS count FROM sectors').get().count;
  if (count > 0) return;

  const insertSector = db.prepare('INSERT INTO sectors (name, description, sort_order) VALUES (?, ?, ?)');
  const insertLeader = db.prepare(`
    INSERT INTO sector_leaders (sector_id, code, name, role, reason, weight, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(function() {
    const ai = insertSector.run('人工智能', 'AI 应用、算力和软件方向示例板块', 10).lastInsertRowid;
    insertLeader.run(ai, '000977', '浪潮信息', '容量龙头', '算力服务器关注度高', 1.2, '示例，可编辑');
    insertLeader.run(ai, '002230', '科大讯飞', '趋势龙头', 'AI 应用代表', 1, '示例，可编辑');

    const broker = insertSector.run('券商金融', '市场成交活跃度和风险偏好观察板块', 20).lastInsertRowid;
    insertLeader.run(broker, '600030', '中信证券', '容量龙头', '券商权重代表', 1.2, '示例，可编辑');
    insertLeader.run(broker, '300059', '东方财富', '趋势龙头', '互联网券商代表', 1, '示例，可编辑');

    const ev = insertSector.run('新能源车', '产业链景气度和趋势观察板块', 30).lastInsertRowid;
    insertLeader.run(ev, '300750', '宁德时代', '总龙头', '动力电池代表', 1.4, '示例，可编辑');
    insertLeader.run(ev, '002594', '比亚迪', '容量龙头', '整车和电池双主线', 1.2, '示例，可编辑');
  });
  tx();
}

function listSectors() {
  seedDefaults();
  return db.prepare('SELECT * FROM sectors ORDER BY sort_order ASC, id ASC').all().map(rowToSector);
}

function createSector(input) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('板块名称不能为空');
  const info = db.prepare('INSERT INTO sectors (name, description, sort_order) VALUES (?, ?, ?)')
    .run(name, String(input.description || ''), Number(input.sortOrder) || 0);
  return rowToSector(db.prepare('SELECT * FROM sectors WHERE id = ?').get(info.lastInsertRowid));
}

function updateSector(id, input) {
  const existing = db.prepare('SELECT * FROM sectors WHERE id = ?').get(id);
  if (!existing) throw new Error('板块不存在');
  db.prepare(`
    UPDATE sectors
    SET name = ?, description = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    input.name !== undefined ? String(input.name).trim() : existing.name,
    input.description !== undefined ? String(input.description || '') : existing.description,
    input.sortOrder !== undefined ? Number(input.sortOrder) || 0 : existing.sort_order,
    id
  );
  return rowToSector(db.prepare('SELECT * FROM sectors WHERE id = ?').get(id));
}

function deleteSector(id) {
  return db.prepare('DELETE FROM sectors WHERE id = ?').run(id).changes > 0;
}

function listLeaders(sectorId) {
  return db.prepare('SELECT * FROM sector_leaders WHERE sector_id = ? ORDER BY weight DESC, id ASC')
    .all(sectorId)
    .map(rowToLeader);
}

function createLeader(sectorId, input) {
  const sector = db.prepare('SELECT * FROM sectors WHERE id = ?').get(sectorId);
  if (!sector) throw new Error('板块不存在');
  assertCode(input.code);
  const name = String(input.name || input.code).trim();
  const role = normalizeRole(input.role);
  const info = db.prepare(`
    INSERT INTO sector_leaders (sector_id, code, name, role, reason, weight, note)
    VALUES (@sectorId, @code, @name, @role, @reason, @weight, @note)
  `).run({
    sectorId,
    code: String(input.code),
    name,
    role,
    reason: String(input.reason || ''),
    weight: Number(input.weight) || 1,
    note: String(input.note || '')
  });
  const leader = rowToLeader(db.prepare('SELECT * FROM sector_leaders WHERE id = ?').get(info.lastInsertRowid));
  recordLeaderSnapshot(leader, rowToSector(sector));
  return leader;
}

function updateLeader(id, input) {
  const existing = db.prepare('SELECT * FROM sector_leaders WHERE id = ?').get(id);
  if (!existing) throw new Error('龙头股不存在');
  const code = input.code !== undefined ? String(input.code) : existing.code;
  assertCode(code);
  const role = input.role !== undefined ? normalizeRole(input.role) : existing.role;
  db.prepare(`
    UPDATE sector_leaders
    SET code = @code, name = @name, role = @role, reason = @reason, weight = @weight, note = @note, updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({
    id,
    code,
    name: input.name !== undefined ? String(input.name || code).trim() : existing.name,
    role,
    reason: input.reason !== undefined ? String(input.reason || '') : existing.reason,
    weight: input.weight !== undefined ? Number(input.weight) || 1 : existing.weight,
    note: input.note !== undefined ? String(input.note || '') : existing.note
  });
  const leader = rowToLeader(db.prepare('SELECT * FROM sector_leaders WHERE id = ?').get(id));
  const sector = db.prepare('SELECT * FROM sectors WHERE id = ?').get(leader.sectorId);
  recordLeaderSnapshot(leader, sector ? rowToSector(sector) : null);
  return leader;
}

function deleteLeader(id) {
  return db.prepare('DELETE FROM sector_leaders WHERE id = ?').run(id).changes > 0;
}

function listLeaderSnapshots(input = {}) {
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 200);
  const code = String(input.code || '').trim();
  if (code) {
    assertCode(code);
    return db.prepare('SELECT * FROM sector_leader_snapshots WHERE code = ? ORDER BY datetime(captured_at) DESC, id DESC LIMIT ?')
      .all(code, limit)
      .map(rowToSnapshot);
  }
  return db.prepare('SELECT * FROM sector_leader_snapshots ORDER BY datetime(captured_at) DESC, id DESC LIMIT ?')
    .all(limit)
    .map(rowToSnapshot);
}

function getLeaderTrends(input = {}) {
  const limit = Math.min(Math.max(Number(input.limit) || 300, 20), 1000);
  const rows = db.prepare('SELECT * FROM sector_leader_snapshots ORDER BY datetime(captured_at) DESC, id DESC LIMIT ?')
    .all(limit)
    .map(rowToSnapshot);
  const groups = new Map();
  rows.forEach(item => {
    if (!groups.has(item.code)) groups.set(item.code, []);
    groups.get(item.code).push(item);
  });
  return Array.from(groups.values()).map(items => {
    const latest = items[0];
    const previous = items.slice(1).find(item => Number.isFinite(Number(item.change)));
    const latestChange = Number(latest.change);
    const previousChange = previous ? Number(previous.change) : null;
    const changeDelta = Number.isFinite(latestChange) && Number.isFinite(previousChange)
      ? Number((latestChange - previousChange).toFixed(2))
      : null;
    return {
      code: latest.code,
      name: latest.name,
      sectorName: latest.sectorName,
      latestChange: Number.isFinite(latestChange) ? latestChange : null,
      previousChange: Number.isFinite(previousChange) ? previousChange : null,
      changeDelta,
      latestPrice: latest.price,
      latestAmount: latest.amount,
      samples: items.length,
      latestAt: latest.capturedAt
    };
  }).sort((a, b) => Math.abs(Number(b.changeDelta) || 0) - Math.abs(Number(a.changeDelta) || 0));
}

function pruneLeaderSnapshots(input = {}) {
  const code = String(input.code || '').trim();
  if (code) assertCode(code);
  const keepLatest = Math.max(Number(input.keepLatest) || 0, 0);
  if (!keepLatest) throw new Error('keepLatest is required');
  const rows = code
    ? db.prepare('SELECT id FROM sector_leader_snapshots WHERE code = ? ORDER BY datetime(captured_at) DESC, id DESC LIMIT -1 OFFSET ?').all(code, keepLatest)
    : db.prepare('SELECT id FROM sector_leader_snapshots ORDER BY datetime(captured_at) DESC, id DESC LIMIT -1 OFFSET ?').all(keepLatest);
  if (!rows.length) return { deleted: 0 };
  const placeholders = rows.map(() => '?').join(',');
  const changes = db.prepare('DELETE FROM sector_leader_snapshots WHERE id IN (' + placeholders + ')')
    .run(...rows.map(item => item.id))
    .changes;
  return { deleted: changes };
}

function exportSectorConfig() {
  const sectors = listSectors().map(sector => ({
    name: sector.name,
    description: sector.description,
    sortOrder: sector.sortOrder,
    leaders: listLeaders(sector.id).map(leader => ({
      code: leader.code,
      name: leader.name,
      role: leader.role,
      reason: leader.reason,
      weight: leader.weight,
      note: leader.note
    }))
  }));
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    sectors
  };
}

function importSectorConfig(input = {}, options = {}) {
  const config = input.config && Array.isArray(input.config.sectors) ? input.config : input;
  const sectors = Array.isArray(config.sectors) ? config.sectors : null;
  if (!sectors) throw new Error('sectors array is required');
  const mode = options.mode || input.mode || 'merge';

  const tx = db.transaction(function() {
    if (mode === 'replace') {
      db.prepare('DELETE FROM sector_leader_snapshots').run();
      db.prepare('DELETE FROM sector_leaders').run();
      db.prepare('DELETE FROM sectors').run();
    }

    let sectorCount = 0;
    let leaderCount = 0;
    sectors.forEach(item => {
      const name = String(item.name || '').trim();
      if (!name) throw new Error('sector name is required');
      const description = String(item.description || '');
      const sortOrder = Number(item.sortOrder) || 0;
      let sector = db.prepare('SELECT * FROM sectors WHERE name = ?').get(name);
      if (sector) {
        sector = updateSector(sector.id, { name, description, sortOrder });
      } else {
        sector = createSector({ name, description, sortOrder });
      }
      sectorCount++;

      (Array.isArray(item.leaders) ? item.leaders : []).forEach(leader => {
        assertCode(leader.code);
        const role = normalizeRole(leader.role);
        const existing = db.prepare('SELECT * FROM sector_leaders WHERE sector_id = ? AND code = ? AND role = ?')
          .get(sector.id, String(leader.code), role);
        const payload = Object.assign({}, leader, { role });
        if (existing) updateLeader(existing.id, payload);
        else createLeader(sector.id, payload);
        leaderCount++;
      });
    });

    return { mode, sectors: sectorCount, leaders: leaderCount };
  });

  return tx();
}

async function fetchQuotesSafe(codes) {
  if (!codes.length) return {};
  try {
    const sinaCodes = codes.map(toSinaSymbol).join(',');
    const resp = await axios.get('https://hq.sinajs.cn/list=' + sinaCodes, {
      headers: { Referer: 'https://finance.sina.com.cn' },
      responseType: 'arraybuffer',
      timeout: 6000
    });
    const rawData = iconv.decode(Buffer.from(resp.data), 'gbk');
    const map = {};
    rawData.split('\n').filter(Boolean).forEach(line => {
      const match = line.match(/hq_str_(s[hz]\d+)="(.+)"/);
      if (!match) return;
      const code = match[1].replace(/^sh|^sz/, '');
      const fields = match[2].split(',');
      const price = parseFloat(fields[3]) || 0;
      const prevClose = parseFloat(fields[2]) || price;
      map[code] = {
        price,
        change: prevClose ? Number(((price - prevClose) / prevClose * 100).toFixed(2)) : 0,
        amount: parseFloat(fields[9]) || 0
      };
    });
    return map;
  } catch (error) {
    console.error('[Sector] 行情获取失败：' + error.message);
    return {};
  }
}

async function getDashboard() {
  const sectors = listSectors();
  const leaders = db.prepare('SELECT * FROM sector_leaders ORDER BY weight DESC, id ASC').all().map(rowToLeader);
  const quoteMap = await fetchQuotesSafe(leaders.map(item => item.code));
  const sectorsWithLeaders = sectors.map(sector => {
    const sectorLeaders = leaders
      .filter(item => item.sectorId === sector.id)
      .map(item => {
        const quote = quoteMap[item.code] || {};
        const change = Number(quote.change);
        return Object.assign({}, item, {
          price: quote.price || null,
          change: Number.isFinite(change) ? change : null,
          amount: quote.amount || null,
          strength: Number.isFinite(change) ? (change >= 3 ? '强' : change <= -3 ? '弱' : '平') : '未知'
        });
      });
    const validChanges = sectorLeaders.map(item => item.change).filter(value => Number.isFinite(Number(value)));
    const avgChange = validChanges.length ? validChanges.reduce((sum, value) => sum + Number(value), 0) / validChanges.length : null;
    return Object.assign({}, sector, {
      status: avgChange === null ? '待刷新' : avgChange >= 1 ? '偏强' : avgChange <= -1 ? '偏弱' : '震荡',
      avgChange: avgChange === null ? null : Number(avgChange.toFixed(2)),
      updatedAt: new Date().toISOString(),
      leaders: sectorLeaders
    });
  });
  const allLeaders = sectorsWithLeaders.flatMap(sector => sector.leaders.map(leader => Object.assign({}, leader, { sectorName: sector.name })));
  allLeaders.forEach(leader => recordLeaderSnapshot(leader, { id: leader.sectorId, name: leader.sectorName }, {
    price: leader.price,
    change: leader.change,
    amount: leader.amount
  }));
  const overview = allLeaders.slice().sort((a, b) => (Number(b.change) || -999) - (Number(a.change) || -999));
  const risks = allLeaders.filter(item => Number(item.change) <= -3 || item.strength === '弱')
    .sort((a, b) => (Number(a.change) || 999) - (Number(b.change) || 999));
  return { sectors: sectorsWithLeaders, overview, risks };
}

module.exports = {
  VALID_ROLES,
  listSectors,
  createSector,
  updateSector,
  deleteSector,
  listLeaders,
  createLeader,
  updateLeader,
  deleteLeader,
  listLeaderSnapshots,
  getLeaderTrends,
  pruneLeaderSnapshots,
  exportSectorConfig,
  importSectorConfig,
  getDashboard,
  seedDefaults
};
