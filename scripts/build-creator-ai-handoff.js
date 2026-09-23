const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {reviewGate,documentHash,SPEC_VERSION}=require('../services/creatorIndustryService');

function buildPacket(input,author) {
  if(!Array.isArray(input?.documents) || !String(author || '').trim()) throw new Error('需要作者名称与作品清单');
  const ready=[],blocked=[];
  for(const item of input.documents) {
    const row={id:Number(item.id),mediaType:item.mediaType,transcript:String(item.transcript || ''),
      content:String(item.content || ''),mediaMetadata:{asr:{status:item.status,quality:item.quality || {}},
        note:item.note || {}},sourceUrl:String(item.sourceUrl || ''),title:String(item.title || ''),publishedAt:item.publishedAt || null};
    if(!Number.isSafeInteger(row.id) || row.id < 1) throw new Error('作品编号无效');
    const reason=item.promptSuspect===true?'suspected_prompt_echo':
      row.mediaType==='video' && item.status==='no_speech'?'no_speech':
      row.mediaType==='video' && item.status==='error'?'transcription_error':reviewGate(row);
    if(reason==='ready' && row.mediaType==='video' && row.transcript.length <= 200000) {
      ready.push({schema:'webstock.creator-industry-ai-input/v1',specVersion:SPEC_VERSION,
        author:String(author).trim(),observationId:row.id,mediaType:row.mediaType,title:row.title,
        sourceUrl:row.sourceUrl,publishedAt:row.publishedAt,bodyHash:documentHash(row),
        text:row.transcript,model:String(item.model || ''),segments:Array.isArray(item.segments)?item.segments:[],
        automaticTrading:false,claimStatus:'unverified_source_text'});
    } else blocked.push({observationId:row.id,mediaType:row.mediaType,title:row.title,
      sourceUrl:row.sourceUrl,publishedAt:row.publishedAt,reason:reason==='ready'?'too_long':reason,
      textLength:row.transcript.length || row.content.length});
  }
  return {ready,blocked,total:input.documents.length};
}

function writePacket(inputPath,outputDir,author) {
  if(!inputPath || !outputDir) throw new Error('需要 --input 与 --out');
  if(fs.existsSync(outputDir) && fs.readdirSync(outputDir).length) throw new Error('输出目录已有文件，请选择新的目录');
  const raw=fs.readFileSync(inputPath);
  const packet=buildPacket(JSON.parse(raw.toString('utf8')),author);
  fs.mkdirSync(outputDir,{recursive:true});
  const jsonl=items=>items.map(item=>JSON.stringify(item)).join('\n')+(items.length?'\n':'');
  fs.writeFileSync(path.join(outputDir,'ai-ready.jsonl'),jsonl(packet.ready),{flag:'wx'});
  fs.writeFileSync(path.join(outputDir,'needs-review.jsonl'),jsonl(packet.blocked),{flag:'wx'});
  const manifest={schema:'webstock.creator-industry-ai-handoff/v1',author:String(author).trim(),
    exportedAt:new Date().toISOString(),inputSha256:crypto.createHash('sha256').update(raw).digest('hex'),
    total:packet.total,ready:packet.ready.length,blocked:packet.blocked.length,
    note:'离线评审快照，不代表运行程序最新资料；只读筛选，没有调用 AI、核验公司事实或写入数据库。'};
  fs.writeFileSync(path.join(outputDir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  return manifest;
}

if(require.main===module) {
  const args=Object.fromEntries(process.argv.slice(2).filter(item=>item.startsWith('--') && item.includes('='))
    .map(item=>{const at=item.indexOf('=');return [item.slice(2,at),item.slice(at+1)];}));
  console.log(JSON.stringify(writePacket(args.input,args.out,args.author),null,2));
}
module.exports={buildPacket,writePacket};
