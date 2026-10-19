const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');

const testDir=fs.mkdtempSync(path.join(os.tmpdir(),'webstock-capture-async-'));
process.env.WEBSTOCK_DB_PATH=path.join(testDir,'isolated.db');
const db=require('../db');const channels=require('../services/expertChannelService');
const source=require('../services/douyinSourceService');

test.after(()=>{
  db.close();
  assert.equal(path.dirname(testDir),os.tmpdir());
  assert.ok(path.basename(testDir).startsWith('webstock-capture-async-'));
  fs.rmSync(testDir,{recursive:true,force:true});
});

let fixtureSequence=0;
function fixture(key,count=35) {
  fixtureSequence++;
  const profileUrl='https://www.douyin.com/user/async-capture-'+key;
  const channel=channels.createChannel({channelKey:'async-capture-'+key,
    displayName:'异步采集测试作者 '+key,platform:'douyin',profileUrl});
  const items=Array.from({length:count},(_,index)=>{
    const contentId=String(7940000000000000000n+BigInt(fixtureSequence*1000+index+1));
    return {contentId,sourceUrl:'https://www.douyin.com/video/'+contentId,
      title:'作品 '+String(index+1).padStart(2,'0'),
      description:'测试组 '+key+' 的第 '+(index+1)+' 篇独立可见原文，测试真实正文与观察记录在同一个批次中完整保存。',
      engagement:{likes:index+1},publishedAt:'2026-09-21T01:00:00.000Z'};
  });
  return {channel,capture:{pageType:'profile',pageUrl:profileUrl,loggedIn:true,
    capturedAt:'2026-09-21T03:00:00.000Z',
    profile:{displayName:channel.displayName,profileUrl,workCount:count},items}};
}

test('async captured-page import yields to the event loop before finishing 35 real records',async()=>{
  const {channel,capture}=fixture('yield-and-order');
  let eventLoopRan=false;
  const pendingHeartbeat=new Promise(resolve=>setImmediate(()=>{eventLoopRan=true;resolve();}));
  try {
    const result=await source.importCapturedPageAsync(channel.id,capture);
    assert.equal(eventLoopRan,true,'A main-process heartbeat must run before the full import resolves');
    assert.equal(result.capturedCount,35);assert.equal(result.addedCount,35);
    assert.equal(result.updatedCount,0);assert.equal(result.unchangedCount,0);
    assert.equal(result.identityMatched,true);assert.equal(result.identityMatchType,'profile_url');
    assert.deepEqual(result.items.map(item=>item.externalContentId),capture.items.map(item=>item.contentId));
    assert.equal(new Set(result.items.map(item=>item.id)).size,35);
    assert.equal(channels.getChannel(channel.id).observationCount,35);
    assert.ok(result.items.every(item=>item.knowledgeSourceId>0));
    const repeated=source.importCapturedPage(channel.id,capture);
    assert.equal(repeated.addedCount,0);assert.equal(repeated.updatedCount,0);
    assert.equal(repeated.unchangedCount,35);
    assert.deepEqual(repeated.items,result.items);
  } finally {await pendingHeartbeat;}
});

test('async replay classifies added, updated and unchanged records like synchronous inspection',async()=>{
  const {channel,capture}=fixture('change-classification');
  source.importCapturedPage(channel.id,capture);
  capture.items[2]={...capture.items[2],title:'第三篇作品标题实质更新'};
  capture.items.push({...capture.items[0],contentId:'7940000000000000099',
    sourceUrl:'https://www.douyin.com/video/7940000000000000099',title:'新增第三十六篇'});
  const expected=source.inspectCapturedPage(channel.id,capture);
  const result=await source.importCapturedPageAsync(channel.id,capture);
  assert.deepEqual({added:result.addedCount,updated:result.updatedCount,unchanged:result.unchangedCount},
    {added:expected.addedCount,updated:expected.updatedCount,unchanged:expected.unchangedCount});
  assert.equal(result.addedCount,1);assert.equal(result.updatedCount,1);assert.equal(result.unchangedCount,34);
  assert.deepEqual(result.items.map(item=>item.externalContentId),capture.items.map(item=>item.contentId));
  const repeated=source.importCapturedPage(channel.id,capture);
  assert.equal(repeated.unchangedCount,36);assert.equal(repeated.addedCount,0);assert.equal(repeated.updatedCount,0);
  assert.deepEqual(repeated.items,result.items);
});

test('a failed ten-item capture batch rolls back its observations, metrics and knowledge without undoing earlier batches',async()=>{
  const {channel,capture}=fixture('failed-batch');
  const failingContentId=capture.items[14].contentId;
  db.exec(`CREATE TRIGGER abort_async_capture_batch BEFORE INSERT ON expert_observations
    WHEN NEW.channel_id=${channel.id} AND NEW.external_content_id='${failingContentId}'
    BEGIN SELECT RAISE(ABORT,'intentional_async_batch_failure'); END;`);
  try {
    await assert.rejects(async()=>source.importCapturedPageAsync(channel.id,capture),/intentional_async_batch_failure/);
    const observations=db.prepare('SELECT external_content_id FROM expert_observations WHERE channel_id=? ORDER BY id').all(channel.id);
    assert.deepEqual(observations.map(row=>row.external_content_id),capture.items.slice(0,10).map(item=>item.contentId));
    const sources=db.prepare('SELECT id,source_url FROM knowledge_sources WHERE author=? ORDER BY id').all(channel.displayName);
    assert.deepEqual(sources.map(row=>row.source_url),capture.items.slice(0,10).map(item=>item.sourceUrl));
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM knowledge_sources source
      LEFT JOIN expert_observations observation ON observation.knowledge_source_id=source.id
      WHERE source.author=? AND observation.id IS NULL`).get(channel.displayName).count,0);
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM expert_observation_metrics metric
      JOIN expert_observations observation ON observation.id=metric.observation_id
      WHERE observation.channel_id=?`).get(channel.id).count,10);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  } finally {db.exec('DROP TRIGGER abort_async_capture_batch');}
});

test('a valid creator with no captured material retains the normal empty import shape',async()=>{
  const {channel,capture}=fixture('empty',0);
  const result=await source.importCapturedPageAsync(channel.id,capture);
  assert.deepEqual(result,source.importCapturedPage(channel.id,capture));
  assert.equal(result.capturedCount,0);assert.equal(result.addedCount,0);
  assert.equal(result.updatedCount,0);assert.equal(result.unchangedCount,0);
  assert.deepEqual(result.items,[]);assert.equal(result.identityMatched,true);
  assert.equal(channels.getChannel(channel.id).observationCount,0);
});
