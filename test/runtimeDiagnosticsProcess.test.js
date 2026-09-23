const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const os=require('node:os');const path=require('node:path');const {fork}=require('node:child_process');
test('observer writes stall evidence while the observed JavaScript thread is blocked',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'webstock-watchdog-'));
  const child=fork(path.join(__dirname,'fixtures/runtime-block.js'),[directory],{stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});
  let done=false,errors='';child.stderr.on('data',x=>errors+=x);child.on('message',m=>{if(m==='done')done=true;});
  const read=()=>{try{return fs.readFileSync(path.join(directory,'runtime.jsonl'),'utf8').trim().split('\n').map(JSON.parse);}catch{return [];}};
  try {
    const deadline=Date.now()+15000;let captured=false;
    while(Date.now()<deadline && !done){if(read().some(x=>x.kind==='main-stall')){captured=true;break;}await new Promise(r=>setTimeout(r,50));}
    assert.equal(captured,true,'No independent evidence during block: '+errors);
    const stall=read().find(x=>x.kind==='main-stall');assert.equal(stall.active[0].label,'test.sync-wait');
    await new Promise((resolve,reject)=>{if(child.exitCode!==null)return resolve();const timer=setTimeout(()=>reject(Error('fixture did not exit')),10000);child.once('exit',()=>{clearTimeout(timer);resolve();});});
    assert.ok(read().some(x=>x.kind==='recovered'));
    assert.ok(read().some(x=>x.kind==='observer-stopped'));
  }finally{if(child.exitCode===null)child.kill();fs.rmSync(directory,{recursive:true,force:true});}
});
