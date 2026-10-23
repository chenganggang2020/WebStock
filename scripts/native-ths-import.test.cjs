const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveSecurity, parseNames, merge } = require('./native-ths-import.cjs');
const catalog = { stocks: new Map([['000001','平安银行'],['600183','生益科技'],['600460','士兰微']]), funds: new Map([['515120','创新药ETF']]) };
const bank = { id:'SZ:stock:000001', symbol:'sz000001', name:'本地名称', group:'原组', quote:{price:7}, order:2 };
const root = {schema:'native-watchlist/v1', instruments:[bank]};
const config = {schema:'watchlist-workspace-config/v1',revision:'old',mainIds:[bank.id],groups:[{groupId:'local:holding',name:'当前持仓',color:'#123456',readOnly:false,memberIds:[bank.id]}]};
const source = {key:'fixture',groups:[{id:'main',name:'全部自选',items:[bank,{id:'SH:stock:600183',symbol:'sh600183',name:'生益科技'}]}],skipped:[]};
test('exact market/type identities; ambiguous and unknown inputs are not guessed',()=>{
  assert.equal(resolveSecurity({C:'000001',M:'33'},catalog,[]).id,'SZ:stock:000001');
  assert.equal(resolveSecurity({C:'515120',M:'20'},catalog,[]).id,'SH:etf:515120');
  for(const r of [{C:'000001',M:'17'},{C:'881156',M:'48'},{C:'830000',M:'URSI'},{C:'515120',M:'17'}]) assert.equal(resolveSecurity(r,catalog,[]).id,undefined);
});
test('INI parser reads only block names, not later numeric metadata',()=>{
  assert.deepEqual([...parseNames('[BLOCK_NAME_MAP_TABLE]\n151=每日荐股\n[TYPE]\n151=536871424')],[['151','每日荐股']]);
});
test('append-only merge preserves original records, groups, holdings and ordering',()=>{
  const result=merge(root,config,source);
  assert.deepEqual(result.root.instruments[0],bank);
  assert.deepEqual(result.config.groups[0],config.groups[0]);
  assert.equal(result.root.instruments.length,2);
  assert.equal(result.config.groups[1].name,'同花顺 · 全部自选');
  assert.deepEqual(result.config.groups[1].memberIds,[bank.id,'SH:stock:600183']);
  assert.deepEqual(root.instruments,[bank]);
});
test('repeat import is idempotent and source removals never delete local members',()=>{
  const first=merge(root,config,source);
  const second=merge(first.root,first.config,source);
  assert.equal(second.changed,false);
  assert.deepEqual(second.root,first.root);
  assert.deepEqual(second.config,first.config);
  const removed=merge(first.root,first.config,{...source,groups:[{...source.groups[0],items:[]}]});
  assert.equal(removed.changed,false);
});
test('name collision creates separate source group, never adopts a local group by name',()=>{
  const original=structuredClone(config);original.groups[0].name='同花顺 · 全部自选';
  const result=merge(root,original,source);
  assert.deepEqual(result.config.groups[0],original.groups[0]);
  assert.notEqual(result.config.groups[1].name,original.groups[0].name);
});
test('unreconciled original membership refuses import',()=>{
  assert.throws(()=>merge(root,{...config,mainIds:[]},source),/主自选/);
});

const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const importer=require('./native-ths-import.cjs');
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ths-import-'));
  const data=path.join(dir,'data'),src=path.join(dir,'source');fs.mkdirSync(path.join(data,'live'),{recursive:true});fs.mkdirSync(path.join(src,'custom_block'),{recursive:true});
  fs.writeFileSync(path.join(data,'live/watchlist.json'),JSON.stringify(root));
  const db=new DatabaseSync(path.join(data,'watchlist-workspace-v35.sqlite'));db.exec('PRAGMA application_id=1465340725;CREATE TABLE watchlist_workspace(k TEXT PRIMARY KEY,body TEXT,sha256 TEXT);');
  const body=JSON.stringify(config);db.prepare('INSERT INTO watchlist_workspace VALUES(?,?,?)').run('active',body,crypto.createHash('sha256').update(body).digest('hex'));db.close();
  fs.writeFileSync(path.join(src,'SelfStockInfo.json'),JSON.stringify([{C:'000001',M:'33'},{C:'600183',M:'17'}]));
  fs.writeFileSync(path.join(src,'stockblock.ini'),'[BLOCK_NAME_MAP_TABLE]\n151=测试组\n[TYPE]\n151=999');
  fs.writeFileSync(path.join(src,'custom_block/0'),JSON.stringify({sortstr:'151,'}));fs.writeFileSync(path.join(src,'custom_block/337'),JSON.stringify({context:'600183|,17|'}));
  fs.writeFileSync(path.join(dir,'stocks.json'),JSON.stringify([...catalog.stocks].map(([code,name])=>({code,name}))));fs.writeFileSync(path.join(dir,'funds.json'),'[]');
  return {dir,data,src,preview:()=>importer.preview(src,data,dir)};
}
test('actual SQLite+JSON merge backs up, verifies and is repeatable',async()=>{
  const f=fixture(),p=f.preview();const receipt=await importer.applyPreview(p,path.join(f.dir,'backup'),{assertOffline(){}});
  assert.equal(receipt.state,'committed');const live=importer.current(f.data);
  assert.deepEqual(live.config.groups[0],config.groups[0]);assert.equal(live.root.instruments.length,2);
  assert.equal(f.preview().changed,false);assert.ok(fs.existsSync(path.join(f.dir,'backup/watchlist-workspace-v35.sqlite')));
});
test('changed source, changed roster and running app reject before data writes',async()=>{
  for(const action of ['source','roster','running']){
    const f=fixture(),p=f.preview();if(action==='source')fs.appendFileSync(path.join(f.src,'SelfStockInfo.json'),' ');
    if(action==='roster')fs.appendFileSync(path.join(f.data,'live/watchlist.json'),' ');
    await assert.rejects(importer.applyPreview(p,path.join(f.dir,'backup'),{assertOffline(){if(action==='running')throw Error('running');}}));
    assert.equal(importer.current(f.data).root.instruments.length,1);
  }
});
test('failure after roster rename rolls back SQLite and restores exact original JSON',async()=>{
  const f=fixture(),p=f.preview(),before=fs.readFileSync(path.join(f.data,'live/watchlist.json'));
  await assert.rejects(importer.applyPreview(p,path.join(f.dir,'backup'),{assertOffline(){},afterRosterWrite(){throw Error('injected IO failure');}}),/injected/);
  assert.deepEqual(fs.readFileSync(path.join(f.data,'live/watchlist.json')),before);
  assert.deepEqual(importer.current(f.data).config,config);
});
test('process interruption between JSON and SQLite commit has explicit recovery',async()=>{
  const f=fixture(),p=f.preview(),backup=path.join(f.dir,'backup');
  const child=require('node:child_process').spawnSync(process.execPath,['-e',
    `require(${JSON.stringify(require.resolve('./native-ths-import.cjs'))}).applyPreview(${JSON.stringify(p)},${JSON.stringify(backup)},{assertOffline(){},afterRosterWrite(){process.exit(77)}})`]);
  assert.equal(child.status,77);
  const receipt=importer.recover(backup,f.data,{assertOffline(){}});
  assert.equal(receipt.state,'restoredBeforeCommit');
  assert.deepEqual(importer.current(f.data).root,root);
  assert.deepEqual(importer.current(f.data).config,config);
});
test('unsubmitted group draft blocks offline import instead of invalidating the draft',async()=>{
  const f=fixture(),p=f.preview();fs.writeFileSync(path.join(f.data,'watchlist-host-ui-v36.json'),JSON.stringify({state:{workspace:{uncertain:true}}}));
  await assert.rejects(importer.applyPreview(p,path.join(f.dir,'backup'),{assertOffline(){}}),/草稿/);
  assert.deepEqual(importer.current(f.data).config,config);
});
