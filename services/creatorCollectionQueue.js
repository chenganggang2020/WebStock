const MODELS = new Set(['small', 'large-v3-turbo', 'large-v3']);

function createCreatorCollectionQueue({db, channels}) {
  db.exec(`CREATE TABLE IF NOT EXISTS creator_collection_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id INTEGER NOT NULL,
    mode TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
    cancel_requested INTEGER NOT NULL DEFAULT 0, rounds INTEGER NOT NULL DEFAULT 0,
    result_json TEXT NOT NULL DEFAULT '{}', message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);
  let busy = false;
  let timer = null;
  let stopping = false;
  let activeRun = null;
  function row(item) {
    if (!item) return null;
    let channel;
    try { channel = channels.getChannel(item.channel_id); } catch (_) {}
    return {id:item.id, channelId:item.channel_id, displayName:channel && channel.displayName || '作者已移除',
      mode:item.mode, model:item.model, status:item.status, cancelRequested:Boolean(item.cancel_requested),
      rounds:item.rounds, result:JSON.parse(item.result_json), message:item.message,
      createdAt:item.created_at, updatedAt:item.updated_at};
  }
  function get(id) {
    const result = row(db.prepare('SELECT * FROM creator_collection_queue WHERE id=?').get(Number(id)));
    if (!result) throw new Error('采集任务不存在');
    return result;
  }
  function validChannel(id) {
    const channel = channels.getChannel(id);
    if (!channel || channel.platform !== 'douyin' || channel.enabled === false || !channel.profileUrl) {
      throw new Error('作者不存在、已停用或缺少抖音主页');
    }
    return channel;
  }
  function enqueue(ids, options = {}) {
    if (stopping) throw new Error('Background collection is stopping');
    if (!Array.isArray(ids) || !ids.length || ids.length > 50 || ids.some(id => !Number.isSafeInteger(Number(id)) || Number(id) < 1)) {
      throw new Error('请选择 1–50 位有效作者');
    }
    const mode = options.mode || 'archive', model = options.model || 'large-v3-turbo';
    if (!['archive', 'incremental'].includes(mode) || !MODELS.has(model)) throw new Error('采集范围或转写模型无效');
    const unique = [...new Set(ids.map(Number))];
    unique.forEach(validChannel);
    return db.transaction(() => unique.map(id => {
      const existing = db.prepare("SELECT id FROM creator_collection_queue WHERE channel_id=? AND status IN ('queued','running') ORDER BY id DESC LIMIT 1").get(id);
      if (existing) return get(existing.id);
      const now = new Date().toISOString();
      const result = db.prepare('INSERT INTO creator_collection_queue(channel_id,mode,model,created_at,updated_at) VALUES(?,?,?,?,?)').run(id,mode,model,now,now);
      return get(result.lastInsertRowid);
    }))();
  }
  function list() { return db.prepare('SELECT * FROM creator_collection_queue ORDER BY id DESC LIMIT 100').all().map(row); }
  function hasActiveChannel(id) { return Boolean(db.prepare("SELECT id FROM creator_collection_queue WHERE channel_id=? AND status IN ('queued','running') LIMIT 1").get(Number(id))); }
  function cancel(id) {
    const item = get(id);
    if (['complete','cancelled'].includes(item.status)) return item;
    db.prepare('UPDATE creator_collection_queue SET status=?,cancel_requested=1,message=?,updated_at=? WHERE id=?')
      .run(item.status === 'running' ? 'running' : 'cancelled',
        item.status === 'running' ? '已请求停止，当前小批次结束后停止；已有资料保留' : '已停止；已有资料保留', new Date().toISOString(),id);
    return get(id);
  }
  function retry(id) {
    if (stopping) throw new Error('Background collection is stopping');
    const item = get(id); validChannel(item.channelId);
    if (['queued','running'].includes(item.status)) return item;
    const active = db.prepare("SELECT id FROM creator_collection_queue WHERE channel_id=? AND status IN ('queued','running')").get(item.channelId);
    if (active) throw new Error('该作者已有任务，不重复续跑');
    db.prepare("UPDATE creator_collection_queue SET status='queued',cancel_requested=0,message='',updated_at=? WHERE id=?").run(new Date().toISOString(),id);
    return get(id);
  }
  function recoverInterrupted() {
    db.prepare("UPDATE creator_collection_queue SET status=CASE WHEN cancel_requested=1 THEN 'cancelled' ELSE 'queued' END, message='上次程序退出，保留已完成资料并继续未完成项',updated_at=? WHERE status='running'").run(new Date().toISOString());
  }
  function runNext(executor) {
    if (stopping || busy) return Promise.resolve(null);
    const task = runNextItem(executor);
    activeRun = task;
    const clear = () => { if (activeRun === task) activeRun = null; };
    task.then(clear, clear);
    return task;
  }
  async function runNextItem(executor) {
    if (busy) return null;
    const item = row(db.prepare("SELECT * FROM creator_collection_queue WHERE status='queued' ORDER BY updated_at,id LIMIT 1").get());
    if (!item) return null;
    busy = true;
    db.prepare("UPDATE creator_collection_queue SET status='running',message='后台处理中',rounds=rounds+1,updated_at=? WHERE id=?").run(new Date().toISOString(),item.id);
    try {
      validChannel(item.channelId);
      const result = await executor(item.channelId, {mode:item.mode,model:item.model,detailLimit:5});
      const hasErrors = ['detailErrors','transcriptErrors','archiveErrors'].some(key => result[key] && result[key].length);
      const after = result.archiveQueue && result.archiveQueue.after;
      const archive = result.archive || {};
      const reportedCount = Number(archive.reportedWorkCount || result.workCount || 0);
      const catalogConfirmed = archive.complete === true && reportedCount > 0 && Number(archive.discoveredCount) >= reportedCount;
      const complete = !result.interrupted && !hasErrors && (item.mode === 'incremental' ||
        Boolean(catalogConfirmed && after && after.pendingCount === 0 && !after.unavailableCount));
      const previous = item.result.archiveQueue && item.result.archiveQueue.after;
      const progress = Number(result.transcribedCount) > 0 || Number(result.archivedCount) > 0 ||
        (after && Number(after.completedCount) > Number(previous && previous.completedCount || 0)) ||
        Number(result.archive && result.archive.discoveredCount || 0) > Number(item.result.archive && item.result.archive.discoveredCount || 0);
      const cancelled = get(item.id).cancelRequested;
      const status = cancelled ? 'cancelled' : result.interrupted ? 'queued' : complete ? 'complete' : !hasErrors && progress ? 'queued' : 'partial';
      const message = cancelled ? '任务已停止，已采集资料保留' : complete ? (item.mode === 'archive' ? '已覆盖本次主页报告的公开作品及视频处理队列' : '本轮增量处理结束，不代表全量覆盖')
        : status === 'queued' ? '本批已保存，等待下一轮补采' : '部分完成或无新进展，请检查失败明细后续跑';
      db.prepare('UPDATE creator_collection_queue SET status=?,result_json=?,message=?,updated_at=? WHERE id=?')
        .run(status,JSON.stringify(result),message,new Date().toISOString(),item.id);
    } catch (error) {
      const status = get(item.id).cancelRequested ? 'cancelled' : 'blocked';
      const message = String(error.message || error).replace(/https?:\/\/[^\s]+/g, '[来源链接]').slice(0,500);
      db.prepare('UPDATE creator_collection_queue SET status=?,message=?,updated_at=? WHERE id=?').run(status,message,new Date().toISOString(),item.id);
    } finally { busy = false; }
    return get(item.id);
  }
  function start(executor, options = {}) {
    if (timer) return;
    stopping = false;
    recoverInterrupted();
    timer = setInterval(() => {
      if (!options.canRun || options.canRun()) runNext(executor).catch(() => {});
    }, 5000);
    if (timer.unref) timer.unref();
  }
  function stop() {
    stopping = true;
    if (timer) clearInterval(timer);
    timer = null;
    return activeRun || Promise.resolve();
  }
  return {enqueue,list,get,retry,cancel,recoverInterrupted,runNext,start,stop,hasActiveChannel,isWorkerRunning:() => Boolean(timer)};
}
let singleton;
function getCreatorCollectionQueue() {
  if (!singleton) singleton = createCreatorCollectionQueue({db:require('../db'),channels:require('./expertChannelService')});
  return singleton;
}
module.exports = {createCreatorCollectionQueue,getCreatorCollectionQueue};
