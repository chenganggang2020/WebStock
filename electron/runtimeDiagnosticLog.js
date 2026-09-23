const fs=require('node:fs');const path=require('node:path');
function createDiagnosticLog(directory,options={}) {
  fs.mkdirSync(directory,{recursive:true});
  const file=path.join(directory,'runtime.jsonl'),limit=options.maxBytes || 2*1024*1024;
  const size=()=>{try{return fs.statSync(file).size;}catch(error){if(error.code==='ENOENT')return 0;throw error;}};
  return event=>{
    const data=JSON.stringify({writtenAt:new Date().toISOString(),...event})+'\n';
    if(Buffer.byteLength(data)>limit)throw Error('Diagnostic record exceeds limit');
    if(size()+Buffer.byteLength(data)>limit) {
      // Only these three observer-owned generations are rotated; no user files.
      for(let i=3;i>=1;i--) {
        const source=i===1?file:file+'.'+(i-1),target=file+'.'+i;
        if(fs.existsSync(target))fs.unlinkSync(target);
        if(fs.existsSync(source))fs.renameSync(source,target);
      }
    }
    fs.appendFileSync(file,data,'utf8');
  };
}
module.exports={createDiagnosticLog};
