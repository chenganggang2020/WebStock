const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createDiagnosticLog}=require('../electron/runtimeDiagnosticLog');
test('diagnostic logs rotate only owned files and remain bounded',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'webstock-diag-test-'));
  try {
    fs.writeFileSync(path.join(directory,'keep.txt'),'keep');const write=createDiagnosticLog(directory,{maxBytes:1000});
    for(let i=0;i<50;i++)write({kind:'test',index:i,text:'a'.repeat(180)});
    assert.equal(fs.readFileSync(path.join(directory,'keep.txt'),'utf8'),'keep');
    const logs=fs.readdirSync(directory).filter(n=>n.startsWith('runtime'));assert.ok(logs.length<=4);
    for(const file of logs)assert.ok(fs.statSync(path.join(directory,file)).size<=1000);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
