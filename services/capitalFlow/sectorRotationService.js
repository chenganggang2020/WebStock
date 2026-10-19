const fs = require('node:fs/promises');
const path = require('node:path');
const {createReadStream} = require('node:fs');
const {createInterface} = require('node:readline');
const {fetchDarkRank} = require('./eastmoneyDarkRank');
const {rotationResult,session,validateQuery} = require('./sectorRotationModel');
const calendar = require('../marketTradingCalendar');
const SCOPES = ['industry','concept'];
function validBoard(row) {
  return row && /^BK\d{4}$/.test(row.code) && row.reconciled===true &&
    ['darkNetCents','visibleNetCents','combinedNetCents'].every(k=>typeof row[k]==='string' && /^-?\d{1,22}$/.test(row[k])) &&
    BigInt(row.darkNetCents)+BigInt(row.visibleNetCents)===BigInt(row.combinedNetCents);
}

function createSectorRotationService(options = {}) {
  const directory = options.directory || path.join(path.dirname(process.env.WEBSTOCK_DB_PATH || path.join(__dirname,'../../data/webstock.db')), 'sector-rotation');
  const now = options.now || (()=>new Date()), load = options.load || fetchDarkRank;
  const pause = options.pause || (ms=>new Promise(resolve=>setTimeout(resolve,ms)));
  const appendFile = options.appendFile || fs.appendFile;
  const autoEnabled = options.enabled === undefined ? process.env.WEBSTOCK_SECTOR_ROTATION_AUTO !== '0' : options.enabled;
  const setTimer = options.setInterval || setInterval, clearTimer = options.clearInterval || clearInterval;
  let history=[],initialized=null,pending=null,timer=null,stopped=false,lastAttempt=0;
  let dailyPending=null;
  const dailyAttempts=new Map();
  const errors={};
  async function availableDates() {
    try {return (await fs.readdir(directory)).filter(f=>/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .map(f=>f.slice(0,10)).filter(d=>d<=calendar.clock(now()).date).sort().reverse();}
    catch(e) {if(e.code==='ENOENT') return [];throw e;}
  }
  async function readHistory(date) {
    const target=path.join(directory,date+'.jsonl'), snapshots=[];let warning=null;
    try {if((await fs.stat(target)).size>128*1024*1024) throw Error('Rotation history exceeds limit');}
    catch(e) {if(e.code==='ENOENT')return {snapshots,warning};throw e;}
    const stream=createReadStream(target,{encoding:'utf8'}),lines=createInterface({input:stream,crlfDelay:Infinity});
    let count=0;
    try {
      for await(const line of lines) {
        if(!line.trim())continue;
        if(warning)throw Error('Rotation history requires inspection');
        try {
          if(line.length>2*1024*1024)throw Error('Oversized record');
          const s=JSON.parse(line);
          if(s.schema!=='webstock.rotation-snapshot/v1' || s.date!==date || !SCOPES.includes(s.scope) || !Array.isArray(s.rows) ||
            s.rows.length>1000 || !s.coverage?.complete || s.rows.length!==s.coverage.totalReported || !Number.isFinite(Date.parse(s.receivedAt))) throw Error('Invalid stored snapshot');
          snapshots.push(s);if(snapshots.length>600)snapshots.shift();
        } catch(_) {warning='上次记录未完整写入，保留此前有效记录；暂停新写入，请检查数据目录';}
        if(++count%25===0)await new Promise(resolve=>setImmediate(resolve));
      }
    } finally {lines.close();stream.destroy();}
    return {snapshots,warning};
  }
  async function initialize() {
    if (!initialized) initialized=(async()=>{
      const date=(await availableDates())[0];if(!date)return;
      const loaded=await readHistory(date);history=loaded.snapshots;
      if(loaded.warning)errors.storage=loaded.warning;
      lastAttempt=history.length ? Math.max(...history.map(s=>Date.parse(s.receivedAt))) : 0;
    })();
    return initialized;
  }
  async function scan(scope,date,checkBoundary=true) {
    const started=now(), rows=[],seen=new Set();
    let total=null,source=null,receivedAt=null,pages=0;
    for(let page=1;page<=10;page++) {
      if(now()-started>40000) throw Error('Scan deadline');
      const r=await load({scope,date,page,pageSize:100});
      if(r.scope!==scope || r.tradingDay!==date || r.coverage.page!==page || r.coverage.pageSize!==100) throw Error('Source identity mismatch');
      if(total===null) {total=r.coverage.totalReported;source=r.source;}
      if(!Number.isInteger(total) || total<1 || total>1000 || total!==r.coverage.totalReported ||
        JSON.stringify(r.source)!==JSON.stringify(source) || r.rows.length!==Math.min(100,total-(page-1)*100)) throw Error('Incomplete board coverage');
      const received=Date.parse(r.receivedAt);
      if(!Number.isFinite(received) || received<started.getTime()-1000 || received>now().getTime()+5000) throw Error('Invalid collection clock');
      for(const row of r.rows) {
        if(!validBoard(row) || seen.has(row.code)) throw Error('Invalid or duplicate board');
        seen.add(row.code);rows.push({...row,receivedAt:r.receivedAt});
      }
      receivedAt=r.receivedAt;pages=page;
      if(rows.length===total) break;
      await pause(250);
    }
    if(rows.length!==total || checkBoundary && session(started.toISOString())!==session(receivedAt)) throw Error('Incomplete or boundary-crossing scan');
    return {schema:'webstock.rotation-snapshot/v1',scope,date,source,sourceKey:source.id+':'+source.fieldMapping,
      startedAt:started.toISOString(),receivedAt,rows,
      coverage:{complete:true,totalReported:total,receivedRows:rows.length,pages,paginationSnapshotConsistent:false}};
  }
  function collect() {
    if(pending) return pending;
    pending=(async()=>{
      await initialize();
      if(errors.storage) return;
      if(now().getTime()-lastAttempt<60000) return;
      lastAttempt=now().getTime();
      const c=calendar.clock(now()),day=calendar.tradingDay(c.date);
      const date=day.known ? day.open && c.time>='09:30:00' ? c.date : calendar.previousTradingDay(c.date) : null;
      if(!date) {errors.calendar='交易日历未覆盖，暂停采集';return;}
      for(const scope of SCOPES) {
        try {
          const s=await scan(scope,date);
          if(stopped) return;
          try {
            await fs.mkdir(directory,{recursive:true});
            await appendFile(path.join(directory,date+'.jsonl'),JSON.stringify(s)+'\n','utf8');
          } catch(_) {errors.storage='采样记录写入失败，已暂停新写入；请检查数据目录与剩余空间';return;}
          history=history.filter(x=>x.date===date).concat(s).slice(-600);
          delete errors[scope];
        } catch(_) {errors[scope]='更新失败或覆盖校验未通过，保留旧样本；未补零';}
      }
    })().catch(()=>{errors.storage='采样历史读写失败，请检查数据目录；未写入替代数据';}).finally(()=>{pending=null;});
    return pending;
  }
  async function get(input = {}) {
    const query=validateQuery(input);
    if(query.date && query.date>calendar.clock(now()).date)throw Error('Future date');
    await initialize();
    const saved=query.date ? await readHistory(query.date) : {snapshots:history,warning:null};
    const result=rotationResult(saved.snapshots,{...query,now:now().getTime()});
    return {...result,stale:result.stale || !!errors[result.scope] || !!errors.storage,
      availableDates:await availableDates(),historyWarning:saved.warning,
      collector:{enabled:autoEnabled,running:timer!==null,pending:!!pending,intervalSeconds:60,
        sessionOpen:!!session(now().toISOString()),errors:{...errors},lastAttemptAt:lastAttempt?new Date(lastAttempt).toISOString():null}};
  }
  function dailyQuery(input) {
    const q=validateQuery(input);
    if(!q.date || q.date>calendar.clock(now()).date)throw Error('Invalid daily date');
    return q;
  }
  async function getDaily(input) {
    const q=dailyQuery(input),file=path.join(directory,'daily',q.date+'-'+q.scope+'.json');
    let snapshot=null;
    try {
      if((await fs.stat(file)).size>4*1024*1024)throw Error('Oversized daily ranking');
      snapshot=JSON.parse(await fs.readFile(file,'utf8'));
      if(snapshot.schema!=='webstock.rotation-daily/v1' || snapshot.date!==q.date || snapshot.scope!==q.scope ||
        !snapshot.coverage?.complete || !Array.isArray(snapshot.rows) || snapshot.rows.length>1000 || snapshot.rows.length!==snapshot.coverage.totalReported ||
        !snapshot.rows.every(validBoard) || new Set(snapshot.rows.map(r=>r.code)).size!==snapshot.rows.length)throw Error('Invalid daily cache');
    } catch(e) {if(e.code!=='ENOENT')throw e;}
    return {date:q.date,scope:q.scope,snapshot,automaticTrading:false,refreshFailed:false};
  }
  async function refreshDaily(input) {
    const q=dailyQuery(input),key=q.date+':'+q.scope;
    if(dailyPending) {if(dailyPending.key===key)return dailyPending.task;throw Error('Daily query busy');}
    const task=(async()=>{
      const old=await getDaily(q),attempt=dailyAttempts.get(key);
      if(attempt && now().getTime()-attempt.at<60000)return {...old,refreshFailed:attempt.failed};
      dailyAttempts.set(key,{at:now().getTime(),failed:false});
      while(dailyAttempts.size>32)dailyAttempts.delete(dailyAttempts.keys().next().value);
      try {
        const raw=await scan(q.scope,q.date,false);
        const snapshot={...raw,schema:'webstock.rotation-daily/v1',kind:'historical-daily-ranking',retrievedAt:raw.receivedAt,
          provisional:q.date===calendar.clock(now()).date && calendar.clock(now()).time<'15:00:00',automaticTrading:false};
        const folder=path.join(directory,'daily'),file=path.join(folder,q.date+'-'+q.scope+'.json');
        await fs.mkdir(folder,{recursive:true});
        await fs.writeFile(file+'.tmp',JSON.stringify(snapshot),'utf8');await fs.rename(file+'.tmp',file);
        return {...old,snapshot};
      } catch(_) {
        dailyAttempts.get(key).failed=true;
        return {...old,refreshFailed:true,message:'日榜更新失败或覆盖校验未通过，保留原缓存；没有回填盘中记录。'};
      }
    })().finally(()=>{dailyPending=null;});
    dailyPending={key,task};return task;
  }
  async function tick() {
    if(!autoEnabled || stopped || !session(now().toISOString())) return false;
    await collect();return true;
  }
  function start() {
    if(!autoEnabled || timer!==null) return;
    stopped=false;timer=setTimer(()=>{tick().catch(()=>{});},10000);
    if(timer && timer.unref) timer.unref();
    tick().catch(()=>{});
  }
  function stop() {stopped=true;if(timer!==null) clearTimer(timer);timer=null;}
  return {get,collect,tick,start,stop,getDaily,refreshDaily};
}
let shared;
function getSectorRotationService() {if(!shared) shared=createSectorRotationService();return shared;}
module.exports = {createSectorRotationService,getSectorRotationService};
