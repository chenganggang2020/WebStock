const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {resolveNoteImage}=require('../services/creatorMediaService');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'creator-note-media-'));
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
test('serves only a page belonging to the exact author, work and content hash',()=>{
  const id='7681478827298291658', hash='a'.repeat(64);
  const filename=path.join(root,'notes','5',id,'001-'+hash+'.png');
  fs.mkdirSync(path.dirname(filename),{recursive:true});
  fs.writeFileSync(filename,Buffer.from('89504e470d0a1a0a','hex'));
  const obs={channelId:5,externalContentId:id,mediaType:'note',mediaMetadata:{note:{pages:[
    {index:1,sha256:hash,mimeType:'image/png',localAssetPath:filename}]}}};
  assert.equal(resolveNoteImage(obs,1,root).filename,fs.realpathSync(filename));
  assert.throws(()=>resolveNoteImage({...obs,channelId:6},1,root));
  assert.throws(()=>resolveNoteImage(obs,'../1',root));
  assert.throws(()=>resolveNoteImage(obs,2,root));
});
