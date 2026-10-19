const http=require('node:http');const path=require('node:path');const {execFile}=require('node:child_process');
const {createWatchdogState}=require('./runtimeWatchdogState');const {createDiagnosticLog}=require('./runtimeDiagnosticLog');
let state,write,timer,config,capturing=false,nativeCount=0,lastNative=0,lastWriteError='';
function record(event) {
  try {write(event);}
  catch(error){const code=error.code || 'LOG_WRITE_FAILED';if(code!==lastWriteError && process.connected){lastWriteError=code;process.send({type:'observer-error',code});}}
}
function probe(endpoint) {
  return new Promise(resolve=>{
    if(!config.port)return resolve({path:endpoint,skipped:true});
    const start=Date.now();let settled=false;
    const finish=value=>{if(settled)return;settled=true;clearTimeout(deadline);resolve({path:endpoint,ms:Date.now()-start,...value});};
    const req=http.get({host:'127.0.0.1',port:config.port,path:endpoint},response=>{response.resume();finish({status:response.statusCode});});
    const deadline=setTimeout(()=>{finish({timeout:true});req.destroy();},1500);
    req.on('error',error=>finish({error:error.code || 'HTTP_ERROR'}));
  });
}
async function evidence(event) {
  if(capturing)return;capturing=true;
  try {
    record({kind:'http-evidence',incidentAt:event.at,probes:await Promise.all(['/api/health','/manifest.webmanifest'].map(probe))});
    if(process.platform==='win32' && config.nativeCapture!==false && nativeCount<6 && Date.now()-lastNative>60000) {
      nativeCount++;lastNative=Date.now();
      const source=require('node:fs').readFileSync(path.join(__dirname,'runtimeSnapshot.ps1'),'utf8');
      const script='& {\n'+source+'\n} -ProcessId '+Number(config.pid)+" -ExpectedPath '"+config.executable.replace(/'/g,"''")+"'";
      execFile('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:8000,maxBuffer:128*1024},(error,stdout)=>{
        if(error)record({kind:'native-evidence-unavailable',incidentAt:event.at,code:error.code || 'CAPTURE_FAILED'});
        else {try{record({kind:'native-evidence',incidentAt:event.at,data:JSON.parse(stdout)});}catch(_){record({kind:'native-evidence-unavailable',incidentAt:event.at,code:'INVALID_OUTPUT'});}}
      });
    }
  }finally{capturing=false;}
}
function stop(reason) {
  clearInterval(timer);if(write)record({kind:'observer-stopped',reason});
  process.exit(0);
}
process.on('message',message=>{
  if(!config && message?.type==='init') {
    config=message;
    try {write=createDiagnosticLog(config.directory);write({kind:'observer-started',pid:config.pid,observerPid:process.pid,executable:config.executable,version:config.version});}
    catch(error){process.send({type:'observer-error',code:error.code || 'LOG_INIT_FAILED'});return process.disconnect();}
    state=createWatchdogState({stallMs:config.stallMs,graceMs:config.graceMs});
    timer=setInterval(()=>{
      const event=state.tick();if(!event)return;
      record(event);
      if(event.kind.endsWith('-stall'))evidence(event).catch(()=>record({kind:'evidence-error'}));
    },config.tickMs || 1000);
    process.send({type:'observer-ready',pid:process.pid});return;
  }
  if(message?.type==='stop')return stop('application-exit');
  if(message?.type==='dropped'){record({kind:'diagnostic-events-dropped',count:Number(message.count)||0});state?.accept(message);return;}
  if(['renderer-unresponsive','renderer-responsive','renderer-exit'].includes(message?.type)) {
    record({kind:message.type,at:Date.now(),reason:String(message.label || '').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80)});
  }
  if(state){const event=state.accept(message);if(event)record(event);}
});
process.on('disconnect',()=>stop('parent-disconnected'));
