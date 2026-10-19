const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function tradingDay(timestamp) {
  const time = Date.parse(timestamp);
  return Number.isFinite(time) ? new Date(time + 8 * 3600000).toISOString().slice(0, 10) : null;
}
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function createHistoryStore(directory) {
  const writes = new Map();
  function folder(input) {
    const key = JSON.stringify([input.source, input.scope, input.code]);
    return path.join(directory, crypto.createHash('sha256').update(key).digest('hex'));
  }
  async function dates(input) {
    try { return (await fs.readdir(folder(input))).filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).map(name => name.slice(0, 10)).sort().reverse(); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async function read(input, date) {
    if (!validDate(date)) return null;
    try {
      const filename = path.join(folder(input), date + '.json');
      if ((await fs.stat(filename)).size > 8 * 1024 * 1024) throw new Error('资金历史文件过大');
      const data = JSON.parse(await fs.readFile(filename, 'utf8'));
      if (data.scope !== input.scope || data.code !== input.code || data.source?.sourceClass !== input.source ||
          data.availability !== 'available' || !Array.isArray(data.points) || !data.points.length ||
          data.points.some(point => tradingDay(point.timestamp) !== date)) throw new Error('资金历史身份或日期不一致');
      return data;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function write(input, data) {
    const groups = new Map();
    for (const point of data.points) {
      const date = tradingDay(point.timestamp);
      if (!date) continue;
      if (!groups.has(date)) groups.set(date, []);
      groups.get(date).push(point);
    }
    await fs.mkdir(folder(input), { recursive: true });
    for (const [date, incoming] of groups) {
      const previous = await read(input, date);
      const byTime = new Map((previous?.points || []).map(point => [point.timestamp, point]));
      incoming.forEach(point => byTime.set(point.timestamp, point));
      const points = require('./index').deriveKinematics(Array.from(byTime.values()).sort((a, b) => a.timestamp.localeCompare(b.timestamp)));
      const last = points[points.length - 1];
      const stored = { ...data, points, latest: last, observation: { ...data.observation, observedAt: last.timestamp } };
      const text = JSON.stringify(stored);
      if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw new Error('资金历史单日超过保存上限');
      const filename = path.join(folder(input), date + '.json');
      const temporary = filename + '.' + crypto.randomUUID() + '.tmp';
      try { await fs.writeFile(temporary, text, { flag: 'wx' }); await fs.rename(temporary, filename); }
      finally { await fs.unlink(temporary).catch(() => {}); }
    }
  }
  function save(input, data) {
    const key = folder(input);
    const task = (writes.get(key) || Promise.resolve()).catch(() => {}).then(() => write(input, data));
    writes.set(key, task);
    task.finally(() => { if (writes.get(key) === task) writes.delete(key); }).catch(() => {});
    return task;
  }
  return { dates, read, save };
}
module.exports = { createHistoryStore, tradingDay, validDate };
