const test=require('node:test');const assert=require('node:assert/strict');
const {createDouyinAutoSync}=require('../electron/douyinAutoSync');
const {discoveryFingerprint}=require('../services/douyinSyncPlanningService');

// Exercise the real scheduled orchestration and planning. Storage and browser
// boundaries remain in memory so these checks never touch production data.
function fixture({asyncImport=false}={}) {
  const profileUrl='https://www.douyin.com/user/unchanged-discovery-fixture';
  const channel={id:501,platform:'douyin',displayName:'增量发现测试作者',profileUrl};
  const items=Array.from({length:35},(_,index)=>({
    contentId:String(7950000000000000000n+BigInt(index+1)),
    sourceUrl:'https://www.douyin.com/video/'+String(7950000000000000000n+BigInt(index+1)),
    title:'已完成作品 '+index,description:'已经保存且本轮没有变化的原始公开文字 '+index,mediaType:'video'
  }));
  const observations=items.map((item,index)=>({id:index+1,externalKey:'unchanged-work-'+index,
    externalContentId:item.contentId,sourceUrl:item.sourceUrl,title:item.title,description:item.description,
    transcript:'已保存的完整文稿 '+index,mediaType:'video',evidenceLevel:'primary',
    localAssetPath:'fixture/'+item.contentId+'.mp4',materialRevision:1,
    mediaMetadata:{discoveryFingerprint:discoveryFingerprint(item),incrementalPending:false,
      detailCapturedAt:'2026-09-21T03:00:00.000Z',asr:{status:'complete'}}}));
  const before=structuredClone(observations),writes=[],completed=[],failures=[];
  let syncImports=0,asyncImports=0,importStarted=false,importSettled=false,readsBeforeImportSettles=0;
  const importResult=()=>({addedCount:0,updatedCount:0,unchangedCount:observations.length,
    items:structuredClone(observations)});
  const sources={
    verifyCapturedIdentity(){return {matched:true};},
    importCapturedPage(){syncImports++;return importResult();}
  };
  if(asyncImport)sources.importCapturedPageAsync=async()=>{
    asyncImports++;importStarted=true;
    await new Promise(resolve=>setImmediate(resolve));
    importSettled=true;return importResult();
  };
  function save(input) {
    writes.push(structuredClone(input));
    const observation=observations.find(item=>item.externalKey===input.externalKey);
    assert.ok(observation,'metadata updates must refer to existing captured works');
    observation.mediaMetadata=structuredClone(input.mediaMetadata);
    observation.materialRevision++;
    return structuredClone(observation);
  }
  const sync=createDouyinAutoSync({
    sessionManager:{
      async captureProfileRecent(){return {pageType:'profile',pageUrl:profileUrl,loggedIn:true,
        profile:{displayName:channel.displayName,profileUrl,workCount:items.length},items:structuredClone(items)};},
      async captureUrl(){throw Error('Unchanged completed works must not reopen detail pages');}
    },
    channels:{
      getChannel(){return channel;},
      listCollectionObservations(){
        if(importStarted && !importSettled)readsBeforeImportSettles++;
        return structuredClone(observations);
      },
      recordObservation(_id,input){return save(input);},
      async recordObservationsAsync(_id,inputs){return inputs.map(save);}
    },
    sources,
    syncState:{markRunning(){},markCompleted(_id,result){completed.push(result);},
      markFailed(_id,error){failures.push(error.message);},getPlanningState(){return {};}}
  });
  return {sync,observations,before,writes,completed,failures,
    stats:()=>({syncImports,asyncImports,importSettled,readsBeforeImportSettles})};
}

test('scheduled discovery with identical fingerprints never rewrites saved material or metadata',async()=>{
  const setup=fixture();
  const result=await setup.sync.syncChannel(501,{trigger:'scheduled'});
  assert.equal(result.discoveredCount,35);assert.equal(result.candidateCount,0);
  assert.equal(result.discoveryUnchangedCount,35);
  assert.equal(setup.writes.length,0,'Unchanged discovery must not call recordObservation for every work');
  assert.deepEqual(setup.observations,setup.before);
  assert.equal(setup.completed.length,1);assert.deepEqual(setup.failures,[]);
});

test('scheduled discovery selects and awaits the responsive importer before using saved items',async()=>{
  const setup=fixture({asyncImport:true});
  const result=await setup.sync.syncChannel(501,{trigger:'scheduled'});
  assert.deepEqual(setup.stats(),{syncImports:0,asyncImports:1,importSettled:true,readsBeforeImportSettles:0},
    'No synchronous importer fallback or planning read may bypass the pending async import');
  assert.equal(result.discoveredCount,35);assert.equal(result.discoveryUnchangedCount,35);
  assert.equal(result.candidateCount,0);assert.equal(result.coverage.transcribedCount,35);
  assert.equal(setup.completed.length,1);assert.deepEqual(setup.failures,[]);
});
