// Explicit, bounded live verification. Never opens the production database or login session.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const express=require('express');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'douyin-note-live-'));
process.env.WEBSTOCK_DB_PATH=path.join(output,'verification.db');
process.env.WEBSTOCK_QUANT_WORKSPACE=path.join(output,'quant-workspace');
const channels=require('../services/expertChannelService');
const sources=require('../services/douyinSourceService');
const knowledge=require('../services/knowledgeService');
const media=require('../services/creatorMediaService');
const {createDouyinNoteService}=require('../services/douyinNoteService');

async function main(){
  const capture=JSON.parse(process.argv[2]);
  const work=capture.items[0];
  assert.equal(work.contentId,'7681478827298291658');
  assert.equal(capture.profile.profileUrl,'https://www.douyin.com/user/MS4wLjABAAAA4G42ChMAtJHVndm6ZUf3ij3lav3iSyPPAqxUF7EKneXPmbyqz-eoiazfBwvccGwh');
  const channel=channels.createChannel({channelKey:'live-note-verification',displayName:capture.profile.displayName,
    platform:'douyin',profileUrl:capture.profile.profileUrl});
  // This isolated fixture records publicly observed fields. It does not claim a logged-in collection run.
  const saved=channels.recordObservation(channel.id,{externalContentId:work.contentId,sourceUrl:work.sourceUrl,
    title:work.title,description:work.description,content:work.description,publishedAt:work.publishedAt,
    mediaType:'note',evidenceLevel:'primary',mediaMetadata:{captureSchemaVersion:'douyin-visible-v2'}});
  const result=await createDouyinNoteService().process({channelId:channel.id,...work});
  assert.equal(result.status,'needs_review',JSON.stringify(result));
  const observation=sources.applyNoteResult(channel.id,work.contentId,result);
  assert.ok(knowledge.getSource(observation.knowledgeSourceId).content.includes('电容器'));
  assert.ok(knowledge.search({query:'电容器',limit:10}).items.some(item=>item.sourceId===observation.knowledgeSourceId));
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({capture:{pageUrl:capture.pageUrl,profile:capture.profile,
    loggedIn:capture.loggedIn},observation,result},null,2));
  const app=express();
  app.get('/api/expert/channels/:channel/observations/:observation/images/:page',(req,res)=>{
    try {
      assert.equal(Number(req.params.channel),channel.id);assert.equal(Number(req.params.observation),saved.id);
      const image=media.resolveNoteImage(observation,req.params.page);
      res.type(image.type).sendFile(image.filename);
    }catch(_){res.sendStatus(404);}
  });
  app.use('/css',express.static(path.join(__dirname,'../css')));
  app.use('/js',express.static(path.join(__dirname,'../js')));
  app.get('/',(_req,res)=>res.type('html').send('<!doctype html><meta charset="utf-8"><title>图文采集修复核验</title>'+
    ['styles','eastmoney-etf-daily','capital-flow-replay','eastmoney-dark-rank','sector-rotation','market-observation','compact-terminal','fixed-workspace','market-reading','industry-workspace','workspaces-refinement'].map(name=>'<link rel="stylesheet" href="/css/'+name+'.css">').join('')+
    '<style>body.compact-terminal.fixed-terminal{display:block;padding:16px;overflow:auto;height:auto;color:var(--text)}#expertCreatorVideoDetail{padding:12px;border:1px solid var(--border)}.creator-reading-body{overflow:auto;max-height:75vh}</style>'+
    '<body class="compact-terminal fixed-terminal dark"><p>隔离验收 · 真实图文样本 · 未连接生产数据库</p><h3>'+capture.profile.displayName+'</h3><main id="expertCreatorVideoDetail"></main>'+
    '<script src="/js/modules/expertTracker.js"></script><script>const sample='+JSON.stringify(observation).replace(/</g,'\\u003c')+';expertRenderCreatorDetail(sample);'+
    'document.addEventListener("click",e=>{const tab=e.target.closest("[data-reader-tab]");if(tab){expertCreatorDetailTab=tab.dataset.readerTab;expertRenderCreatorDetail(sample);}});</script>'));
  const server=app.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({preview:'http://127.0.0.1:'+server.address().port,
    output,characters:result.pages[0].text.length,images:result.imageCount,sha256:result.pages[0].sha256,
    status:result.status,knowledgeSearch:'passed',productionWrites:false})));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
