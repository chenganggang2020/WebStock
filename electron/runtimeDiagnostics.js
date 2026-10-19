const path=require('node:path');const {fork}=require('node:child_process');const diagnostics=require('../services/runtimeDiagnostics');
function startRuntimeDiagnostics(options) {
  let status='starting',pending=0,dropped=0,lossNotified=false,stopping=false,settle;
  const ready=new Promise(resolve=>{settle=resolve;});
  let lastWarning='';
  const warn=code=>{status='unavailable';if(code!==lastWarning){lastWarning=code;options.onWarning?.(String(code));}settle(false);};
  let child;
  try {child=fork(path.join(__dirname,'runtimeWatchdog.js'),[],{execPath:process.execPath,
    env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});}
  catch(error){warn(error.code || 'SPAWN_FAILED');return {ready,status:()=>status,stop(){}};}
  const admitted=new Set();
  function transmit(event) {
    pending++;
    try {child.send(event,error=>{pending--;if(error && !stopping)warn(error.code || 'IPC_FAILED');});return true;}
    catch(error){pending--;warn(error.code || 'IPC_FAILED');return false;}
  }
  function reportLoss() {
    // Reserve capacity for this notice; do not wait for a timer on a stalled main.
    if(dropped && !lossNotified && pending<256 && transmit({type:'dropped',count:dropped,paired:true})) {
      dropped=0;lossNotified=true;
    }
  }
  function send(event) {
    if(stopping || !child.connected)return;
    if(event.type==='end') {
      // Every admitted begin owns its end slot. Never leave a completed query active.
      if(admitted.delete(event.id))transmit(event);
      return;
    }
    reportLoss();
    // SQL bursts must not consume all capacity for native calls and heartbeats.
    const limit=event.type==='begin' && /^db\./.test(event.label)?192:248;
    if(pending>=limit){dropped++;reportLoss();return;}
    if(event.type==='begin')admitted.add(event.id);
    transmit(event);
  }
  diagnostics.install(send);
  const initTimeout=setTimeout(()=>{if(status==='starting')warn('OBSERVER_START_TIMEOUT');},10000);initTimeout.unref();
  child.on('message',message=>{
    if(message.type==='observer-ready'){status='active';clearTimeout(initTimeout);settle(true);}
    if(message.type==='observer-error')warn(message.code);
  });
  child.on('error',error=>warn(error.code || 'OBSERVER_ERROR'));
  child.on('exit',()=>{clearInterval(pulse);clearTimeout(initTimeout);diagnostics.install(null);if(!stopping)warn('OBSERVER_EXITED');});
  send({type:'init',directory:options.directory,pid:process.pid,executable:process.execPath,port:options.port,
    version:options.version,stallMs:options.stallMs,graceMs:options.graceMs,tickMs:options.tickMs,nativeCapture:options.nativeCapture});
  const pulse=setInterval(()=>{lossNotified=false;reportLoss();send({type:'pulse'});},options.pulseMs || 500);pulse.unref();
  return {ready,status:()=>status,stop(){send({type:'stop'});stopping=true;clearInterval(pulse);diagnostics.install(null);},directory:options.directory};
}
module.exports={startRuntimeDiagnostics};
