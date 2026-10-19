const {startRuntimeDiagnostics}=require('../../electron/runtimeDiagnostics');
const diagnostics=require('../../services/runtimeDiagnostics');
(async()=>{
  const observer=startRuntimeDiagnostics({directory:process.argv[2],port:0,stallMs:300,graceMs:0,pulseMs:50,tickMs:50,nativeCapture:false});
  await observer.ready;
  await new Promise(r=>setTimeout(r,100));
  diagnostics.trace('test.sync-wait',()=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,2500));
  process.send('done');
  await new Promise(r=>setTimeout(r,200));
  observer.stop();setTimeout(()=>process.disconnect(),200);
})().catch(error=>{console.error(error);process.exit(1);});
