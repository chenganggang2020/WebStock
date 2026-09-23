// Isolated fault-injection fixture only; never loaded by the application.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs');const path=require('node:path');const http=require('node:http');
const assert=require('node:assert/strict');
const {startRuntimeDiagnostics}=require('../../electron/runtimeDiagnostics');
const trace=require('../../services/runtimeDiagnostics');
const directory=process.argv[2];
if(!directory || !path.resolve(directory).includes('runtime-electron-verification'))throw Error('Expected isolated verification directory');
app.setPath('userData',path.join(directory,'profile'));
let observer,server;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const records=()=>fs.readFileSync(path.join(directory,'diagnostics/runtime.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
app.whenReady().then(async()=>{
  server=http.createServer((req,res)=>{res.writeHead(200);res.end('ok');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  observer=startRuntimeDiagnostics({directory:path.join(directory,'diagnostics'),port:server.address().port,
    stallMs:500,graceMs:0,pulseMs:100,tickMs:100,version:'isolated-fixture'});
  assert.equal(await observer.ready,true);
  const window=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false,contextIsolation:true,sandbox:true,preload:path.resolve(__dirname,'../../electron/preload.js')}});
  ipcMain.on('webstock:runtime-diagnostic',(event,data)=>{if(event.sender===window.webContents)trace.emit(data);});
  await window.loadURL('data:text/html,<html><body>Isolated diagnostics test</body></html>');
  // Explicit visible signal exercises renderer stalls without showing a test window.
  await window.webContents.executeJavaScript("setInterval(()=>window.webstockDesktop.reportDiagnostic({type:'renderer',visible:true,page:'fixture'}),100)");
  await delay(300);
  trace.traceSync('test.electron-main-block',()=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,7000));
  await delay(1000);
  assert.ok(records().some(x=>x.kind==='main-stall'));
  assert.ok(records().some(x=>x.kind==='native-evidence' && x.data.process===process.pid),'Windows wait-chain capture must succeed');
  assert.ok(records().some(x=>x.kind==='http-evidence' && x.probes.every(p=>p.timeout)));
  await window.webContents.executeJavaScript('(()=>{const end=Date.now()+2500;while(Date.now()<end){};return true;})()');
  await delay(500);
  assert.ok(records().some(x=>x.kind==='renderer-stall'));
  assert.ok(records().filter(x=>x.kind==='recovered').length>=2);
  console.log('PASS: Electron main stall, Windows evidence, HTTP timeouts, renderer-only stall, recovery');
  observer.stop();await delay(300);server.close();app.quit();
}).catch(error=>{console.error(error);observer?.stop();server?.close();app.exit(1);});
