'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {createReadStream}=require('node:fs'),{createInterface}=require('node:readline');
const {stockKeys}=require('./darkStockService'),{buildQuery}=require('./eastmoneyDarkRank');
function validMoney(row){return row.reconciled===true && ['darkNetCents','visibleNetCents','combinedNetCents'].every(k=>typeof row[k]==='string' && /^-?\d{1,22}$/.test(row[k])) && BigInt(row.darkNetCents)+BigInt(row.visibleNetCents)===BigInt(row.combinedNetCents);}
function createDarkObservationStore(options={}) {
 const directory=options.directory || process.env.WEBSTOCK_DARK_HISTORY_DIR || path.join(path.dirname(process.env.WEBSTOCK_DB_PATH || path.join(__dirname,'../../data/webstock.db')),'dark-stock-observations');
 let pending=Promise.resolve();const recent=new Set();
 async function dates(){try{return (await fs.readdir(directory)).filter(f=>/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).map(f=>f.slice(0,10)).sort().reverse();}catch(e){if(e.code==='ENOENT')return [];throw e;}}
 function append(data){
  const task=pending.then(async()=>{
   buildQuery({date:data.tradingDay});
   if(data.source?.id!=='eastmoney-darktrade-rank' || !Array.isArray(data.rows) || data.rows.length>200 || !Number.isFinite(Date.parse(data.receivedAt)))throw Error('Invalid observation batch');
   const rows=data.rows.map(row=>{
    if(stockKeys(row.key).length!==1 || row.key.slice(2)!==row.code || !validMoney(row) || !Number.isFinite(Date.parse(row.receivedAt)))throw Error('Invalid stock observation');
    return {key:row.key,code:row.code,name:String(row.name||'').slice(0,120),receivedAt:row.receivedAt,sourceObservedAt:null,
     darkNetCents:row.darkNetCents,visibleNetCents:row.visibleNetCents,combinedNetCents:row.combinedNetCents};
   });
   if(!rows.length || data.stale)return false;
   const record={schema:'webstock.dark-stock-observations/v1',tradingDay:data.tradingDay,source:data.source,receivedAt:data.receivedAt,rows};
   const line=JSON.stringify(record),hash=crypto.createHash('sha256').update(line).digest('hex');
   if(recent.has(hash))return true;
   await fs.mkdir(directory,{recursive:true});const file=path.join(directory,data.tradingDay+'.jsonl');
   try{
    const size=(await fs.stat(file)).size;
    if(size+Buffer.byteLength(line)+1>32*1024*1024)throw Error('Daily archive limit reached; existing history preserved');
    if(size){
     const handle=await fs.open(file,'r');
     try{const tail=Buffer.alloc(1);await handle.read(tail,0,1,size-1);if(tail[0]!==10)throw Error('Archive has incomplete tail; new writes paused and original preserved');}
     finally{await handle.close();}
    }
   }catch(e){if(e.code!=='ENOENT')throw e;}
   await fs.appendFile(file,line+'\n');recent.add(hash);if(recent.size>512)recent.delete(recent.values().next().value);return true;
  });
  pending=task.catch(()=>{});return task;
 }
 async function read(input){
  if(stockKeys(input.code).length!==1)throw Error('Select one stock');
  const availableDates=await dates(),date=input.date || availableDates[0] || null;
  if(date)buildQuery({date});
  const output={schema:'webstock.dark-stock-history/v1',code:input.code,tradingDay:date,availableDates,points:[],automaticTrading:false,
   note:'本机实际观察记录；横轴是采集时刻，不是逐笔或行情事件时间。没有采到的历史不补造。'};
  if(!date || !availableDates.includes(date))return output;
  const file=path.join(directory,date+'.jsonl');if((await fs.stat(file)).size>34*1024*1024)throw Error('Archive requires inspection');
  const stream=createReadStream(file,{encoding:'utf8'}),lines=createInterface({input:stream,crlfDelay:Infinity});const points=new Map();let count=0;
  try{for await(const line of lines){
   if(!line.trim())continue;
   let record;try{record=JSON.parse(line);}catch(_){output.warning='发现不完整记录，停止读取并保留此前有效历史';break;}
   if(record.schema!=='webstock.dark-stock-observations/v1' || record.source?.id!=='eastmoney-darktrade-rank' || record.tradingDay!==date || !Array.isArray(record.rows) || record.rows.length>200)throw Error('Invalid archived identity');
   for(const row of record.rows)if(row.key===input.code){
    if(!validMoney({...row,reconciled:true}) || !Number.isFinite(Date.parse(row.receivedAt)))throw Error('Invalid archived point');
    points.set(row.receivedAt,{...row,sourceKey:JSON.stringify(record.source)});if(points.size>1000)points.delete(points.keys().next().value);
   }
   if(++count%25===0)await new Promise(resolve=>setImmediate(resolve));
  }}finally{lines.close();stream.destroy();}
  output.points=[...points.values()].sort((a,b)=>a.receivedAt.localeCompare(b.receivedAt));return output;
 }
 return {append,read};
}
module.exports={createDarkObservationStore};
