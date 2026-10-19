const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'webstock-metadata-batch-'));
process.env.WEBSTOCK_DB_PATH=path.join(folder,'test.db');
const db=require('../db'),channels=require('../services/expertChannelService');
test.after(()=>{db.close();fs.rmSync(folder,{recursive:true,force:true});});
test('metadata batches yield and preserve every observation identity',async()=>{
  const ch=channels.createChannel({channelKey:'metadata-batch',displayName:'test',platform:'douyin'});
  const original=Array.from({length:21},(_,i)=>channels.recordObservation(ch.id,{externalKey:'entry-'+i,title:'entry '+i}));
  let ticked=false;setImmediate(()=>{ticked=true;});
  const saved=await channels.recordObservationsAsync(ch.id,original.map(r=>({externalKey:r.externalKey,mediaMetadata:{discoveryFingerprint:'test'}})));
  assert.equal(ticked,true);
  assert.deepEqual(saved.map(r=>r.id),original.map(r=>r.id));
  assert.ok(saved.every(r=>r.mediaMetadata.discoveryFingerprint==='test'));
});

test('discovery patches retain a transcription completed during the batch yield',async()=>{
  const ch=channels.createChannel({channelKey:'metadata-race',displayName:'test',platform:'douyin'});
  const original=channels.recordObservation(ch.id,{externalKey:'entry',title:'entry',mediaMetadata:{asr:{status:'pending'}}});
  setImmediate(()=>channels.recordObservation(ch.id,{externalKey:original.externalKey,
    mediaMetadata:{asr:{status:'complete'},archive:{status:'complete'}}}));
  const [saved]=await channels.recordObservationsAsync(ch.id,[{externalKey:original.externalKey,
    mediaMetadataPatch:{discoveryFingerprint:'new'}}]);
  assert.equal(saved.mediaMetadata.discoveryFingerprint,'new');
  assert.equal(saved.mediaMetadata.asr.status,'complete');
  assert.equal(saved.mediaMetadata.archive.status,'complete');
});
