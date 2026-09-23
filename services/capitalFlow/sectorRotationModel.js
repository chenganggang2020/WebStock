const calendar = require('../marketTradingCalendar');
const FIELDS = {combined:'combinedNetCents', dark:'darkNetCents', visible:'visibleNetCents'};
const MAX_GAP = 150000, ENDPOINT_TOLERANCE = 75000;
function validateQuery(input = {}) {
  const scope = input.scope || 'industry', metric = input.metric || 'combined';
  const minutes = input.minutes === undefined ? 5 : Number(input.minutes);
  if (!['industry','concept'].includes(scope) || !Object.hasOwn(FIELDS, metric) ||
      ![5,15,30].includes(minutes) || input.code !== undefined && !/^BK\d{4}$/.test(input.code)) throw Error('Invalid rotation query');
  if (input.date !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
      !Number.isFinite(Date.parse(input.date)) || new Date(input.date).toISOString().slice(0,10)!==input.date)) throw Error('Invalid date');
  if (input.at !== undefined && (!input.date || !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(input.at))) throw Error('Invalid replay time');
  return {scope, metric, minutes, code:input.code, ...(input.date?{date:input.date}:{}), ...(input.at?{at:input.at}:{})};
}
function session(value) {
  if (!Number.isFinite(Date.parse(value))) return null;
  const c = calendar.clock(value);
  if (!calendar.tradingDay(c.date).open) return null;
  return c.time >= '09:30:00' && c.time <= '11:30:00' ? c.date + ':am' :
    c.time >= '13:00:00' && c.time < '14:57:00' ? c.date + ':pm' : null;
}
function validMoney(value) { return typeof value === 'string' && /^-?\d{1,22}$/.test(value); }
function windowDelta(points, endIndex, minutes, field) {
  if (endIndex < 0) return null;
  const end = points[endIndex], target = end.time - minutes * 60000;
  let startIndex = -1, distance = Infinity;
  for (let i=0; i<endIndex; i++) {
    const d = Math.abs(points[i].time - target);
    if (d < distance && d <= ENDPOINT_TOLERANCE) { distance=d; startIndex=i; }
  }
  if (startIndex < 0) return null;
  const start = points[startIndex], phase = end.phase;
  for (let i=startIndex; i<=endIndex; i++) {
    const p = points[i];
    if (!phase || p.phase !== phase || p.sourceKey !== end.sourceKey || !p.row ||
        p.date !== p.clockDate || p.total !== end.total ||
        p.row.reconciled !== true || !validMoney(p.row[field]) ||
        i>startIndex && p.time - points[i-1].time > MAX_GAP) return null;
  }
  const elapsed = (end.time - start.time) / 60000;
  if (elapsed <= 0) return null;
  const delta = BigInt(end.row[field]) - BigInt(start.row[field]);
  return {deltaCents:delta.toString(), speedYuanPerMinute:Number(delta)/100/elapsed,
    startIndex, startAt:start.at, endAt:end.at, elapsedMinutes:elapsed};
}
function rotationResult(snapshots, input = {}) {
  const q = validateQuery(input), now = input.now === undefined ? Date.now() : Number(input.now);
  // Duplicate timestamps are one sample, never extra minutes of coverage.
  const unique = new Map();
  for (const s of snapshots) if (s.scope === q.scope && Number.isFinite(Date.parse(s.receivedAt))) unique.set(s.receivedAt,s);
  const cutoff=q.at ? Date.parse(q.date+'T'+q.at+'+08:00') : Infinity;
  const all = [...unique.values()].filter(s=>(!q.date || s.date===q.date) && Date.parse(s.receivedAt)<=cutoff)
    .sort((a,b)=>Date.parse(a.receivedAt)-Date.parse(b.receivedAt));
  const last = all.at(-1), date = q.date || (last ? last.date : null);
  const day = all.filter(s=>s.date === date);
  const future = last && Date.parse(last.receivedAt)>now+5000;
  const historical=!!q.at || date!==calendar.clock(now).date || !session(new Date(now).toISOString());
  const indexed = day.map(s=>({snapshot:s,rows:new Map(s.rows.map(r=>[r.code,r])),
    at:s.receivedAt,time:Date.parse(s.receivedAt),phase:session(s.receivedAt),clockDate:calendar.clock(s.receivedAt).date,
    sourceKey:s.sourceKey,date:s.date,total:s.coverage.totalReported,row:{reconciled:true,sample:'0'}}));
  // Select one common historical endpoint, never compare boards at different times.
  let anchor=indexed.length-1;
  if(historical && !future) {
    while(anchor>=0) {
      const window=windowDelta(indexed,anchor,q.minutes,'sample');
      if(window && [...indexed[anchor].rows.keys()].some(code=>indexed.slice(window.startIndex,anchor+1).every(p=>{
        const row=p.rows.get(code);return row?.reconciled===true && validMoney(row[FIELDS[q.metric]]);
      })))break;
      anchor--;
    }
  }
  const windowEndAt=anchor>=0 ? indexed[anchor].at : null;
  const stale = historical || !last || future || now-Date.parse(last.receivedAt)>MAX_GAP;
  const rows = (last ? last.rows : []).map(row=>{
    const points = indexed.map(p=>{
      const item=p.rows.get(row.code), at=item && item.receivedAt || p.at;
      return {row:item, at, time:Date.parse(at), phase:p.phase, clockDate:p.clockDate,sourceKey:p.sourceKey,date:p.date,total:p.total};
    });
    const current=future?null:windowDelta(points,anchor,q.minutes,FIELDS[q.metric]);
    const prior=current?windowDelta(points,current.startIndex,q.minutes,FIELDS[q.metric]):null;
    const dark=current?windowDelta(points,anchor,q.minutes,FIELDS.dark):null;
    const visible=current?windowDelta(points,anchor,q.minutes,FIELDS.visible):null;
    const delta=current ? Number(current.deltaCents) : null;
    const previous=prior ? Number(prior.deltaCents) : null;
    return {code:row.code,name:row.name, cumulativeCents:row[FIELDS[q.metric]],
      deltaCents:current ? current.deltaCents:null, speedYuanPerMinute:current ? current.speedYuanPerMinute:null,
      speedChange:current && prior ? current.speedYuanPerMinute-prior.speedYuanPerMinute:null,
      startAt:current ? current.startAt:null,endAt:current ? current.endAt:null, elapsedMinutes:current ? current.elapsedMinutes:null,
      darkDeltaCents:dark ? dark.deltaCents:null, visibleDeltaCents:visible ? visible.deltaCents:null,
      divergence:dark && visible ? BigInt(dark.deltaCents)*BigInt(visible.deltaCents)<0n : null,
      state:delta===null?'数据不足':previous===null?'前窗不足':delta>0 && previous<0?'区间净额变化由负转正':delta<0 && previous>0?'区间净额变化由正转负':delta>0?'净额增加':delta<0?'净额减少':'净额未变',
      changeRatio:row.changeRatio, darkActivityRatio:row.darkActivityRatio,
      reason:current?null:'需同日同半日连续样本；缺失、断流或合计不符不计算',
      ...(q.code===row.code ? {series:points.filter(p=>p.phase).map(p=>({at:p.at,phase:p.phase,
        cumulativeCents:p.row && p.row.reconciled===true && validMoney(p.row[FIELDS[q.metric]])?p.row[FIELDS[q.metric]]:null,
        changeRatio:p.row ? p.row.changeRatio:null}))} : {})};
  });
  const valid=rows.filter(r=>r.deltaCents!==null);
  const order=(key,sign)=>[...valid].filter(r=>r[key]!==null && r[key]*sign>0).sort((a,b)=>sign*(b[key]-a[key]) || a.code.localeCompare(b.code));
  return {version:'webstock.sector-rotation/v1',automaticTrading:false,...q,date,source:last?last.source:null,
    displayMode:valid.length?(historical?'historical-window':'live'):'no-intraday-window',windowEndAt:valid.length?windowEndAt:null,
    receivedAt:last?last.receivedAt:null,stale:!!stale,sampleCount:day.length,eligible:valid.length,total:rows.length,
    coverage:last?last.coverage:null,rows,inflow:order('speedYuanPerMinute',1),outflow:order('speedYuanPerMinute',-1),
    accelerating:order('speedChange',1),decelerating:order('speedChange',-1),
    detail:q.code ? rows.find(r=>r.code===q.code) || null:null,
    note:'采样间模型净额变化，不是逐笔资金迁移；分页非同时点。板块可重叠，不汇总为全市场。源行情时钟未知。'};
}
module.exports = {validateQuery,rotationResult,session};
