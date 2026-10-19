// Runs in the independent observer, using observer receipt time rather than a
// timestamp supplied by a potentially stalled renderer.
function createWatchdogState(options = {}) {
  const now=options.now || Date.now, stallMs=options.stallMs || 5000;
  const pending=new Map(),recent=[];
  let lastMain=now(),lastRenderer=now(),lastTick=now(),graceUntil=now()+(options.graceMs ?? 15000);
  let visible=false,page='',incident=null;
  const label=value=>String(value || '').replace(/[^a-zA-Z0-9_./: -]/g,'').slice(0,120);
  function accept(message) {
    if(!message || typeof message!=='object')return;
    const at=now();
    if(message.type==='dropped'){
      // A paired transport drops only unadmitted spans; known active spans remain
      // valid. Older/unpaired senders can have lost ends, so discard their spans.
      if(message.paired!==true){pending.clear();recent.length=0;}
      recent.push({at,type:'diagnostic-events-dropped',count:message.count});
      while(recent.length>60)recent.shift();return;
    }
    if(message.type==='pulse'){lastMain=at;return;}
    if(message.type==='renderer') {
      if(!visible && message.visible===true)lastRenderer=at;
      visible=message.visible===true;lastRenderer=at;page=label(message.page);return;
    }
    if(!['begin','end','interaction','renderer-unresponsive','renderer-responsive','renderer-exit'].includes(message.type))return;
    const entry={at,type:message.type,label:label(message.label)};
    if(message.type==='begin' && Number.isSafeInteger(message.id)) {
      pending.set(message.id,{...entry,id:message.id,stack:String(message.stack || '').slice(0,1200)});
      while(pending.size>80)pending.delete(pending.keys().next().value);
    }
    if(message.type==='end') {
      const start=pending.get(message.id);pending.delete(message.id);
      if(start){entry.label=start.label;entry.elapsedMs=at-start.at;}
    }
    recent.push(entry);while(recent.length>60)recent.shift();
    if(message.type==='end' && entry.elapsedMs>=3000 && /^(GET|POST|PUT|PATCH|DELETE) /.test(entry.label)) {
      return {kind:'slow-request',at,label:entry.label,elapsedMs:entry.elapsedMs};
    }
  }
  function tick() {
    const at=now(),gap=at-lastTick;lastTick=at;
    if(gap>15000 || gap<0) {
      const previousIncident=incident;incident=null;lastMain=at;lastRenderer=at;graceUntil=at+stallMs;
      return {kind:'observation-gap',at,gapMs:gap,previousIncident};
    }
    if(at<graceUntil)return null;
    const mainAge=at-lastMain;
    // Only classify a renderer-only stall while the main heartbeat is recent.
    // Near the shared threshold wait one tick instead of mislabelling a main stall.
    const kind=mainAge>stallMs?'main-stall':visible && mainAge<=Math.min(1500,stallMs/2) && at-lastRenderer>stallMs?'renderer-stall':null;
    if(kind && kind!==incident?.kind) {
      incident={kind,at};
      return {...incident,page,mainHeartbeatAgeMs:at-lastMain,rendererHeartbeatAgeMs:at-lastRenderer,
        active:[...pending.values()].slice(-20),recent:recent.slice()};
    }
    if(!kind && incident) {
      const result={kind:'recovered',at,previousKind:incident.kind,elapsedMs:at-incident.at,page};incident=null;return result;
    }
    return null;
  }
  return {accept,tick};
}
module.exports={createWatchdogState};
