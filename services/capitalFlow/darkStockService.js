const {fetchDarkRank, buildQuery} = require('./eastmoneyDarkRank');
const calendar = require('../marketTradingCalendar');

function darkSession(value = new Date()) {
  const current=calendar.clock(value), day=calendar.tradingDay(current.date);
  const pollAllowed=day.open && (calendar.isContinuousSession(value) || current.time>='15:00:00' && current.time<='15:05:00');
  return {today:current.date,dataDate:day.known ? (day.open && current.time>='09:30:00' ? current.date : calendar.previousTradingDay(current.date)) : null,
    pollAllowed,calendarKnown:day.known,rankIntervalSeconds:60,stockIntervalSeconds:300,
    reason:pollAllowed?'盘中定时刷新（收盘后补查至 15:05）':day.reason || '非刷新时段，保留最近一次结果；可手动查询'};
}

function stockKeys(value) {
  if(typeof value!=='string') throw Error('Invalid stocks');
  const keys=value.split(',');
  // Do not confuse sh000001 (an index) with sz000001 (a share).
  if(!keys.length || keys.length>200 || keys.some(key=>! /^(sh6\d{5}|sz[03]\d{5}|bj[489]\d{5})$/.test(key))) throw Error('Invalid stocks');
  return [...new Set(keys)];
}

// A single shared scan, never one full scan per stock. No disk writes or perpetual collector.
function createDarkStockService(options = {}) {
  const load=options.load || fetchDarkRank, now=options.now || Date.now;
  const pause=options.pause || (ms=>new Promise(resolve=>setTimeout(resolve,ms)));
  let snapshot=null, pending=null, pendingDate=null, lastAttempt=-Infinity, lastFailed=false;
  async function scan(date) {
    const started=now(), byKey=new Map();
    let total=null, duplicateRows=0, source=null, pages=0, receivedAt=null;
    for(let page=1;page<=60;page++) {
      if(now()-started>45000) throw Error('Dark scan deadline');
      const part=await load({date,scope:'stock',page,pageSize:100});
      if(part.tradingDay!==date || part.scope!=='stock' || part.coverage.page!==page || part.coverage.pageSize!==100) throw Error('Dark scan identity mismatch');
      if(total===null) total=part.coverage.totalReported;
      if(total<1 || total>6000 || total!==part.coverage.totalReported || part.rows.length!==Math.min(100,total-(page-1)*100)) throw Error('Dark scan coverage changed');
      source=part.source;receivedAt=part.receivedAt;pages=page;
      for(const row of part.rows) {
        const key=row.venue ? row.venue.toLowerCase()+row.code : 'unknown:'+row.providerMarket+':'+row.code;
        if(byKey.has(key)) duplicateRows++;
        byKey.set(key,{...row,receivedAt:part.receivedAt});
      }
      if(page*100>=total) break;
      await pause(250);
    }
    return {tradingDay:date,source,receivedAt,scanStartedAt:new Date(started).toISOString(),savedAt:now(),byKey,
      coverage:{receivedRows:byKey.size,totalReported:total,pages,duplicateRows,complete:byKey.size===total,paginationSnapshotConsistent:false}};
  }
  async function get(input) {
    const {date}=input;buildQuery({date});
    const codes=stockKeys(input.codes.join(','));
    const cached=snapshot && snapshot.tradingDay===date,force=input.force===true;
    if(force && pending && pendingDate!==date) throw Error('Dark stock refresh busy');
    const fresh=cached && now()-snapshot.savedAt<300000;
    const changedDate=snapshot && snapshot.tradingDay!==date && !lastFailed;
    if((force || !fresh) && !pending && (force || changedDate || now()-lastAttempt>=(lastFailed?60000:300000))) {
      lastAttempt=now();pendingDate=date;
      pending=scan(date).then(value=>{snapshot=value;lastFailed=false;}).catch(()=>{lastFailed=true;})
        .finally(()=>{pending=null;pendingDate=null;});
    }
    // Ordinary reads render the same-date cache while the one shared scan runs.
    // Cold starts and an explicit manual refresh still wait for their result.
    if((!cached || force) && pending && pendingDate===date) await pending;
    if(!snapshot || snapshot.tradingDay!==date) throw Error('Dark stock snapshot unavailable');
    const stale=lastFailed || now()-snapshot.savedAt>=300000;
    const refreshing=Boolean(pending && pendingDate===date);
    return {version:'webstock.eastmoney-dark-stocks/v1',automaticTrading:false,tradingDay:date,
      source:snapshot.source,receivedAt:snapshot.receivedAt,scanStartedAt:snapshot.scanStartedAt,
      refreshIntervalSeconds:300,stale,refreshing,cache:{hit:Boolean(cached && !force),ttlSeconds:300},coverage:snapshot.coverage,
      rows:(input.all ? Array.from(snapshot.byKey.keys()) : codes.filter(key=>snapshot.byKey.has(key))).map(key=>({...snapshot.byKey.get(key),key})),
      missing:codes.filter(key=>!snapshot.byKey.has(key)),
      note:refreshing?'后台正在更新，暂显示已标注日期的快照；采集时刻不是行情时刻。':stale?'更新未完成，下方是旧快照；采集时刻不是行情时刻。':'逐页采集，不是同一时刻的全市场快照；未匹配不代表资金为零。'};
  }
  return {get};
}
module.exports={createDarkStockService,darkSession,stockKeys};
