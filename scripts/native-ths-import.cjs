// Local/offline maintenance import. Never calls portfolioService or a cloud API.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
function need(ok,message) { if(!ok) throw Error(message); }
function read(file) { need(fs.statSync(file).size<=32*1024*1024,'文件超过32MiB');return fs.readFileSync(file); }
function json(file) { return JSON.parse(read(file).toString('utf8').replace(/^\uFEFF/,'')); }
function parseNames(text) {
  const out=new Map();let inNames=false;
  for(const line of text.split(/\r?\n/)) {
    const s=line.trim();if(/^\[.*\]$/.test(s)){inNames=s==='[BLOCK_NAME_MAP_TABLE]';continue;}
    const m=s.match(/^([0-9A-F]+)=(.+)$/i);if(inNames&&m)out.set(m[1].toUpperCase(),m[2].trim());
  }return out;
}
function resolveSecurity(row,catalog,existing) {
  const code=String(row.C??'').trim(),market=String(row.M??'').trim();
  const types={'17':['SH','stock',/^6\d{5}$/],'33':['SZ','stock',/^[03]\d{5}$/],
    '151':['BJ','stock',/^(?:[48]\d{5}|92\d{4})$/],
    '20':['SH','etf',/^(?:50|51|52|56|58)\d{4}$/],'36':['SZ','etf',/^15\d{4}$/]};
  const type=types[market];
  if(!type||!type[2].test(code))return {code,market,reason:'不支持或市场/代码不匹配，未猜测'};
  const [exchange,kind]=type,id=`${exchange}:${kind}:${code}`;
  const known=existing.find(r=>r.id===id);
  const name=known?.name||(kind==='stock'?catalog.stocks:catalog.funds).get(code);
  if(!name||name===code)return {code,market,reason:'本地证券目录无名称，身份待核验'};
  return {id,symbol:exchange.toLowerCase()+code,name};
}
function validate(root,config) {
  need(root.schema==='native-watchlist/v1'&&Array.isArray(root.instruments),'主自选格式不支持');
  const ids=root.instruments.map(r=>r.id);
  need(ids.length>0&&ids.length<=3000&&new Set(ids).size===ids.length,'主自选为空、重复或超限');
  for(const r of root.instruments){need(/^(SH|SZ|BJ):(stock|index|etf):\d{6}$/.test(r.id)&&r.symbol===r.id.split(':')[0].toLowerCase()+r.id.split(':')[2]&&typeof r.name==='string'&&r.name.trim()&&r.name.length<=128&&!r.transient,'主自选身份或名称无效');}
  need(config.schema==='watchlist-workspace-config/v1'&&typeof config.revision==='string'&&config.revision&&same(config.mainIds,ids),'主自选与分组配置未协调，请先处理');
  need(Array.isArray(config.groups)&&config.groups.length<=500,'分组数量无效');
  const groupIds=new Set();
  for(const g of config.groups){need(typeof g.groupId==='string'&&!groupIds.has(g.groupId)&&g.groupId&&g.groupId.length<=256,'分组身份重复或无效');groupIds.add(g.groupId);
    need(typeof g.name==='string'&&g.name.trim()===g.name&&g.name.length>0&&g.name.length<=60&&!/[\x00-\x1f\x7f]/.test(g.name)&&typeof g.readOnly==='boolean'&&typeof g.color==='string'&&(!g.color||/^#[0-9a-f]{6}$/i.test(g.color)),'分组属性无效');
    need(Array.isArray(g.memberIds)&&new Set(g.memberIds).size===g.memberIds.length&&g.memberIds.every(id=>ids.includes(id)),'分组成员缺失或重复');}
}
function scan(sourceDir,catalogDir,existing) {
  const sourceFiles={};
  function sourceRead(file){const absolute=path.resolve(sourceDir,file);const bytes=read(absolute);sourceFiles[absolute]=sha(bytes);return bytes;}
  const catalog={stocks:new Map(),funds:new Map()};
  for(const kind of ['stocks','funds']){const file=path.resolve(catalogDir,kind+'.json'),bytes=read(file);sourceFiles[file]=sha(bytes);for(const row of JSON.parse(bytes)){catalog[kind].set(String(row.code),row.name);}}
  const main=JSON.parse(sourceRead('SelfStockInfo.json'));need(Array.isArray(main)&&main.length<=10000,'同花顺自选格式不支持');
  const ini=sourceRead('stockblock.ini');let iniText;
  try{iniText=new TextDecoder('utf-8',{fatal:true}).decode(ini);}catch{iniText=new TextDecoder('gbk',{fatal:true}).decode(ini);}
  const names=parseNames(iniText);need(names.size<=500,'来源分组超过500');
  const order=String(JSON.parse(sourceRead('custom_block/0')).sortstr??'').split(',').filter(Boolean).map(x=>x.trim().toUpperCase());
  need(order.every(id=>/^[0-9A-F]{1,8}$/.test(id)&&names.has(id))&&new Set(order).size===order.length,'来源分组排序身份无效');
  // An INI group omitted from the UI sort list is still data; do not silently drop it.
  for(const id of names.keys())if(!order.includes(id))order.push(id);
  const skipped=[],duplicates=[],groups=[];
  function addGroup(id,name,rows){const items=[],seen=new Set();for(const row of rows){const r=resolveSecurity(row,catalog,existing);if(!r.id){skipped.push({group:id,...r});continue;}if(seen.has(r.id)){duplicates.push({group:id,id:r.id});continue;}seen.add(r.id);items.push(r);}groups.push({id,name,items,rawCount:rows.length});}
  addGroup('main','全部自选',main);
  for(const id of order){need(/^[0-9A-F]{1,8}$/.test(id),'来源组ID无效');const block=JSON.parse(sourceRead('custom_block/'+parseInt(id,16)));const parts=String(block.context??'').split(',');need(parts.length===2,'来源组成员格式无效');const codes=parts[0].split('|'),markets=parts[1].split('|');need(codes.length===markets.length,'来源组代码与市场数量不一致');addGroup(id,names.get(id),codes.flatMap((C,i)=>C.trim()?[{C,M:markets[i]}]:[]));}
  for(const [file,hash] of Object.entries(sourceFiles))need(sha(read(file))===hash,'扫描期间源文件变化，请重读');
  return {key:sha(fs.realpathSync(sourceDir).replace(/\\/g,'/').toLowerCase()).slice(0,24),groups,skipped,duplicates,sourceFiles,rawCount:main.length};
}
function merge(root,config,source) {
  validate(root,config);const nextRoot=structuredClone(root),nextConfig=structuredClone(config);
  const existing=new Set(root.instruments.map(r=>r.id)),sourceIds=new Set(),added=[],groupChanges=[];
  for(const g of source.groups)for(const row of g.items){sourceIds.add(row.id);if(existing.has(row.id))continue;existing.add(row.id);const r={...row,group:'同花顺导入',order:nextRoot.instruments.length};nextRoot.instruments.push(r);added.push(r);}
  nextConfig.mainIds=nextRoot.instruments.map(r=>r.id);
  for(const g of source.groups){const groupId=`local:ths:${source.key}:${g.id}`;
    let target=nextConfig.groups.find(x=>x.groupId===groupId),isNew=!target;
    if(isNew){let name='同花顺 · '+g.name;if(nextConfig.groups.some(x=>x.name===name))name+=` [${g.id}]`;target={groupId,name,color:'',readOnly:false,memberIds:[]};nextConfig.groups.push(target);}
    need(!target.readOnly,'来源目标组只读，不能追加');
    const additions=g.items.filter(r=>!target.memberIds.includes(r.id)).map(r=>r.id);target.memberIds.push(...additions);
    if(isNew||additions.length)groupChanges.push({sourceId:g.id,name:target.name,groupId,isNew,additions,accepted:g.items.length,rawCount:g.rawCount});
  }
  const changed=added.length>0||groupChanges.length>0;
  if(changed)nextConfig.revision='groups:ths:'+sha(JSON.stringify([nextConfig.mainIds,nextConfig.groups])).slice(0,32);
  validate(nextRoot,nextConfig);
  return {root:nextRoot,config:nextConfig,changed,added,groupChanges,localOnly:root.instruments.filter(r=>!sourceIds.has(r.id)).map(r=>({id:r.id,name:r.name}))};
}
function current(dataDir) {
  const rosterPath=path.join(dataDir,'live/watchlist.json'),dbPath=path.join(dataDir,'watchlist-workspace-v35.sqlite');
  const rosterBytes=read(rosterPath),root=JSON.parse(rosterBytes);
  need(fs.existsSync(dbPath),'分组库不存在，禁止自动新建');
  const db=new DatabaseSync(dbPath,{readOnly:true});let record;
  try {need(db.prepare('PRAGMA application_id').get().application_id===1465340725,'非原生分组库');record=db.prepare("SELECT body,sha256 FROM watchlist_workspace WHERE k='active'").get();need(record&&sha(record.body)===record.sha256,'分组配置校验失败');}finally{db.close();}
  const config=JSON.parse(record.body);validate(root,config);return {root,config,rosterBytes,record,rosterPath,dbPath};
}
function preview(sourceDir,dataDir,catalogDir) {
  const before=current(dataDir),source=scan(sourceDir,catalogDir,before.root.instruments),result=merge(before.root,before.config,source);
  const basis={sourceFiles:source.sourceFiles,rosterHash:sha(before.rosterBytes),configHash:before.record.sha256};
  return {schema:'native-ths-incremental-preview/v1',token:sha(JSON.stringify(basis)),sourceDir:path.resolve(sourceDir),dataDir:path.resolve(dataDir),catalogDir:path.resolve(catalogDir),basis,counts:{before:before.root.instruments.length,rawMain:source.rawCount,acceptedMain:source.groups[0].items.length,newInMain:source.groups[0].items.filter(r=>!before.root.instruments.some(x=>x.id===r.id)).length,after:result.root.instruments.length,originalGroups:before.config.groups.length,newGroups:result.groupChanges.filter(g=>g.isNew).length,afterGroups:result.config.groups.length},added:result.added,groupChanges:result.groupChanges,localOnly:result.localOnly,skipped:source.skipped,duplicates:source.duplicates,changed:result.changed};
}
function assertOffline() {
  need(process.platform==='win32','实际写入仅支持已核验的 Windows 环境');
  const {execFileSync}=require('node:child_process');
  const count=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"@(Get-Process MarketNativeReview -ErrorAction SilentlyContinue).Count"],{encoding:'utf8',windowsHide:true}).trim();
  need(count==='0','原生 Stock 正在运行，请正常退出并保存草稿后再导入');
}
function durableWrite(file,bytes) {
  const fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
async function applyPreview(request,backupDir,hooks={}) {
  const offline=hooks.assertOffline||assertOffline;offline();
  const uiFile=path.join(request.dataDir,'watchlist-host-ui-v36.json');
  let uiBytes=null;
  if(fs.existsSync(uiFile)){
    uiBytes=read(uiFile);const state=JSON.parse(uiBytes).state;need(state&&typeof state==='object','分组界面草稿无效，保留原文件');
    const w=state.workspace,r=state.reconciliation,selected=w?.base?.groups?.find(g=>g.groupId===w.selectedGroupId);
    need(!w||(!w.uncertain&&same(w.base?.groups,w.draftGroups)&&!w.newNameInput&&(!selected||(w.nameInput===selected.name&&w.colorInput===selected.color))),'存在未提交分组草稿，先在程序中处理；未写入');
    need(!r||(!r.uncertain&&Object.keys(r.packet||{}).length===0),'存在未完成分组协调草稿，未写入');
  }
  need(request.schema==='native-ths-incremental-preview/v1','预览格式错误');
  const fresh=preview(request.sourceDir,request.dataDir,request.catalogDir);
  need(same(fresh,request),'预览后来源或本机数据变化，请重新预览');
  if(!fresh.changed)return {state:'noChange',token:fresh.token};
  backupDir=path.resolve(backupDir);const dataDir=fs.realpathSync(fresh.dataDir);
  need(!backupDir.toLowerCase().startsWith(dataDir.toLowerCase()+path.sep)&&backupDir.toLowerCase()!==dataDir.toLowerCase(),'备份必须在数据目录之外');
  need(!backupDir.toLowerCase().startsWith(path.resolve(fresh.sourceDir).toLowerCase()+path.sep),'不能写入同花顺源目录');
  need(!fs.existsSync(backupDir),'备份目录已存在，禁止覆盖旧备份');
  const before=current(dataDir),source=scan(fresh.sourceDir,fresh.catalogDir,before.root.instruments);
  const result=merge(before.root,before.config,source);
  fs.mkdirSync(backupDir,{recursive:true});
  durableWrite(path.join(backupDir,'watchlist.json'),before.rosterBytes);
  durableWrite(path.join(backupDir,'groups-before.json'),before.record.body);
  durableWrite(path.join(backupDir,'preview.json'),JSON.stringify(fresh,null,2));
  if(uiBytes)durableWrite(path.join(backupDir,'watchlist-host-ui-v36.json'),uiBytes);
  const readDb=new DatabaseSync(before.dbPath,{readOnly:true});
  try{await require('node:sqlite').backup(readDb,path.join(backupDir,'watchlist-workspace-v35.sqlite'));}finally{readDb.close();}
  const checkDb=new DatabaseSync(path.join(backupDir,'watchlist-workspace-v35.sqlite'),{readOnly:true});
  try{need(checkDb.prepare('PRAGMA integrity_check').get().integrity_check==='ok'&&checkDb.prepare("SELECT sha256 FROM watchlist_workspace WHERE k='active'").get().sha256===before.record.sha256,'SQLite备份未通过回读');}finally{checkDb.close();}
  const afterBytes=Buffer.from(JSON.stringify(result.root,null,2)),afterBody=JSON.stringify(result.config);
  durableWrite(path.join(backupDir,'watchlist-after.json'),afterBytes);
  durableWrite(path.join(backupDir,'groups-after.json'),afterBody);
  const journal={schema:'native-ths-import-journal/v1',token:fresh.token,rosterPath:before.rosterPath,dbPath:before.dbPath,beforeRoster:sha(before.rosterBytes),afterRoster:sha(afterBytes),beforeConfig:before.record.sha256,afterConfig:sha(afterBody)};
  durableWrite(path.join(backupDir,'journal.json'),JSON.stringify(journal,null,2));
  const staged=before.rosterPath+'.ths-'+crypto.randomUUID()+'.tmp';
  durableWrite(staged,afterBytes);
  const db=new DatabaseSync(before.dbPath);let renamed=false,committed=false;
  try {
    offline();db.exec('BEGIN IMMEDIATE');
    const row=db.prepare("SELECT body,sha256 FROM watchlist_workspace WHERE k='active'").get();
    need(row.body===before.record.body&&row.sha256===before.record.sha256&&sha(read(before.rosterPath))===sha(before.rosterBytes),'提交前本机自选或分组已变化');
    need(uiBytes?read(uiFile).equals(uiBytes):!fs.existsSync(uiFile),'提交前界面草稿变化，未写入');
    for(const [file,hash] of Object.entries(fresh.basis.sourceFiles))need(sha(read(file))===hash,'提交前同花顺来源变化');
    db.prepare("UPDATE watchlist_workspace SET body=?,sha256=? WHERE k='active'").run(afterBody,sha(afterBody));
    fs.renameSync(staged,before.rosterPath);renamed=true;
    if(hooks.afterRosterWrite)hooks.afterRosterWrite();
    need(sha(read(before.rosterPath))===sha(afterBytes),'主自选写后校验失败');
    db.exec('COMMIT');committed=true;
  }catch(e){
    if(!committed){try{db.exec('ROLLBACK');}catch{}}
    if(renamed&&!committed){need(sha(read(before.rosterPath))===sha(afterBytes),'失败后主自选被其他程序改变，保留备份，禁止自动覆盖');const restore=before.rosterPath+'.restore-'+crypto.randomUUID();durableWrite(restore,before.rosterBytes);fs.renameSync(restore,before.rosterPath);}
    throw e;
  }finally{db.close();}
  const after=current(dataDir);need(same(after.root,result.root)&&same(after.config,result.config),'合并回读不一致，请保留备份检查，勿继续写入');
  const receipt={schema:'native-ths-import-receipt/v1',state:'committed',at:new Date().toISOString(),token:fresh.token,backupDir,counts:fresh.counts,originalRowsPreserved:same(after.root.instruments.slice(0,before.root.instruments.length),before.root.instruments),originalGroupsPreserved:same(after.config.groups.slice(0,before.config.groups.length),before.config.groups),hashes:journal};
  durableWrite(path.join(backupDir,'receipt.json'),JSON.stringify(receipt,null,2));return receipt;
}
// Two storage formats cannot share a filesystem transaction. Never conceal that
// boundary: an interrupted apply leaves a durable journal and fails closed.
function recover(backupDir,dataDir,hooks={}) {
  (hooks.assertOffline||assertOffline)();const journal=json(path.join(backupDir,'journal.json'));
  const rosterPath=path.resolve(dataDir,'live/watchlist.json'),dbPath=path.resolve(dataDir,'watchlist-workspace-v35.sqlite');
  need(journal.schema==='native-ths-import-journal/v1'&&path.resolve(journal.rosterPath)===rosterPath&&path.resolve(journal.dbPath)===dbPath,'恢复目标与原记录不匹配');
  const beforeBytes=read(path.join(backupDir,'watchlist.json'));
  need(sha(beforeBytes)===journal.beforeRoster&&sha(read(path.join(backupDir,'groups-before.json')))===journal.beforeConfig,'恢复原件校验失败');
  const db=new DatabaseSync(dbPath,{readOnly:true});let record;
  try{need(db.prepare('PRAGMA application_id').get().application_id===1465340725,'恢复库身份无效');record=db.prepare("SELECT body,sha256 FROM watchlist_workspace WHERE k='active'").get();need(record.sha256===sha(record.body),'当前分组校验失败');}finally{db.close();}
  const rosterHash=sha(read(rosterPath));let state;
  if(record.sha256===journal.beforeConfig&&rosterHash===journal.afterRoster){const stage=rosterPath+'.recover-'+crypto.randomUUID();durableWrite(stage,beforeBytes);fs.renameSync(stage,rosterPath);state='restoredBeforeCommit';}
  else if(record.sha256===journal.beforeConfig&&rosterHash===journal.beforeRoster)state='alreadyBefore';
  else if(record.sha256===journal.afterConfig&&rosterHash===journal.afterRoster)state='alreadyCommitted';
  else throw Error('恢复后数据已发生额外变化；不覆盖，保留原件人工审阅');
  current(dataDir);return {state,token:journal.token};
}
module.exports={resolveSecurity,parseNames,scan,merge,current,preview,applyPreview,recover};
if(require.main===module){(async()=>{const [mode,...args]=process.argv.slice(2);
  if(mode==='preview'){need(args.length===3,'preview SOURCE_DIR DATA_DIR CATALOG_DIR');return preview(...args);}
  if(mode==='apply'){need(args.length===3,'apply PREVIEW_JSON EXPECTED_TOKEN NEW_BACKUP_DIR');const request=json(args[0]);need(args[1]===request.token,'必须明确提供已审核的预览摘要');return applyPreview(request,args[2]);}
  if(mode==='recover'){need(args.length===2,'recover BACKUP_DIR DATA_DIR');return recover(...args);}
  throw Error('Usage: node scripts/native-ths-import.cjs preview SOURCE_DIR DATA_DIR CATALOG_DIR | apply PREVIEW_JSON EXPECTED_TOKEN NEW_BACKUP_DIR');
})().then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});}
