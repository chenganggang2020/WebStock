const axios=require('axios');
const fs=require('node:fs');
const path=require('node:path');
const DEFINITIONS=[
  {key:'nikkei225',symbol:'^N225',name:'日经225',zone:'Asia/Tokyo',kind:'index'},
  {key:'kospi',symbol:'^KS11',name:'韩国KOSPI',zone:'Asia/Seoul',kind:'index'},
  {key:'hang-seng',symbol:'^HSI',name:'恒生指数',zone:'Asia/Hong_Kong',kind:'index'},
  {key:'china-a50-future',symbol:'CHA50CFD',name:'富时中国A50期货 CFD',kind:'futures'},
  {key:'nasdaq100-future',symbol:'NQ',name:'纳指100期货 CFD',kind:'futures'},
  {key:'sp500-future',symbol:'ES',name:'标普500期货 CFD',kind:'futures'},
  {key:'dow-future',symbol:'YM',name:'道指期货 CFD',kind:'futures'},
  {key:'gold-future',symbol:'GC',name:'纽约黄金 CFD',kind:'futures'},
  {key:'wti-future',symbol:'CL',name:'纽约原油 CFD',kind:'futures'},
  {key:'brent-future',symbol:'OIL',name:'布伦特原油 CFD',kind:'futures'},
  {key:'usd-cnh',symbol:'fx_susdcnh',name:'美元/离岸人民币',kind:'fx'}
];
function positive(value) {
  return value!=null && String(value).trim()!=='' && Number.isFinite(Number(value)) && Number(value)>0 ? Number(value) : null;
}
function candle(row) {
  const result={date:row.date,open:positive(row.open),high:positive(row.high),low:positive(row.low),close:positive(row.close),volume:positive(row.volume)};
  if([result.open,result.high,result.low,result.close].every(value=>value!==null) &&
    (result.high<Math.max(result.open,result.close) || result.low>Math.min(result.open,result.close) || result.low>result.high)) {
    result.open=result.high=result.low=result.close=null;
  }
  return result;
}
function dailyResult(rows,definition,source,sourceUrl) {
  const byDate=new Map(rows.filter(row=>/^\d{4}-\d{2}-\d{2}$/.test(row.date)).map(row=>[row.date,candle(row)]));
  const candles=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-260);
  const trend=candles.map(row=>({date:row.date,close:row.close}));
  const index=trend.findLastIndex(row=>row.close!==null),latest=trend[index],previous=trend[index-1];
  if(!latest)throw Error('Historical price unavailable');
  return {key:definition.key,name:definition.name,status:'available',value:latest.close,
    changePct:previous?.close>0?(latest.close/previous.close-1)*100:null,
    observedAt:latest.date+' 日线（来源交易日）',source,sourceUrl,trend,candles,symbol:definition.symbol,
    validCandleCount:candles.filter(row=>[row.open,row.high,row.low,row.close].every(value=>value!==null)).length,
    volumeStatus:candles.some(row=>row.volume!==null)?'available':'unavailable',
    dateConvention:definition.kind==='futures'?'来源交易日（夜盘可能跨自然日）；最后一根日 K 可能仍在形成':'来源当地交易日；最后一根日 K 可能仍在形成'};
}
function parseIndexChart(payload,definition) {
  const result=payload?.chart?.result?.[0];
  if(result?.meta?.symbol!==definition.symbol || !Array.isArray(result.timestamp))throw Error('Index identity unavailable');
  const quote=result.indicators?.quote?.[0] || {};
  const rows=result.timestamp.map((timestamp,index)=>{
    return {date:new Date(timestamp*1000).toLocaleDateString('en-CA',{timeZone:definition.zone}),
      open:quote.open?.[index],high:quote.high?.[index],low:quote.low?.[index],close:quote.close?.[index],volume:quote.volume?.[index]};
  });
  return dailyResult(rows,definition,'Yahoo Finance · 日线','https://finance.yahoo.com/quote/'+encodeURIComponent(definition.symbol)+'/history/');
}
function parseSinaDaily(payload,definition) {
  // The JSONP prefix is untrusted data, never evaluated as JavaScript.
  const match=String(payload).replace(/^\s*\/\*[\s\S]*?\*\/\s*/,'').match(/^\s*var\s+_globalK\s*=\s*\(([\s\S]*)\)\s*;?\s*$/);
  if(!match)throw Error('Unexpected daily history wrapper');
  const data=JSON.parse(match[1]);
  const rows=definition.kind==='fx' && typeof data==='string' ? data.split('|').map(line=>{
    const fields=line.split(',');
    return {date:fields[0],open:fields[1],low:fields[2],high:fields[3],close:fields[4],volume:fields[5]};
  }) : data;
  if(!Array.isArray(rows))throw Error('Unexpected daily history shape');
  return dailyResult(rows,definition,'新浪公开行情 · 日 K',definition.kind==='fx'
    ? 'https://finance.sina.com.cn/money/forex/hq/USDCNH.shtml'
    : 'https://finance.sina.com.cn/futures/quotes/'+definition.symbol+'.shtml');
}
function historyUrl(definition) {
  if(definition.kind==='index')return 'https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(definition.symbol)+'?interval=1d&range=1y';
  return (definition.kind==='fx'
    ? 'https://vip.stock.finance.sina.com.cn/forex/api/jsonp.php/var%20_globalK=/NewForexService.getDayKLine?symbol='
    : 'https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_globalK=/GlobalFuturesService.getGlobalFuturesDailyKLine?symbol=')+encodeURIComponent(definition.symbol);
}
function createGlobalIndexTrendService(options={}) {
  let cached=null,pending=null;const now=options.now || Date.now,http=options.http || axios;
  if(options.cacheFile) {
    try {
      const saved=JSON.parse(fs.readFileSync(options.cacheFile,'utf8'));
      if(saved.schema==='webstock.global-kline/v1' && Array.isArray(saved.items)) {
        const items=saved.items.filter(item=>DEFINITIONS.some(definition=>definition.key===item.key && definition.symbol===item.symbol) && Array.isArray(item.candles));
        cached={at:0,data:{items:items.map(item=>({...item,historyStatus:'cached'})),fetchedAt:saved.fetchedAt,coverage:items.length+'/'+DEFINITIONS.length}};
      }
    }catch(_) { /* Missing or damaged cache does not prevent a fresh read. */ }
  }
  async function fetch(request={}) {
    if(cached && !request.force && now()-cached.at<300000)return cached.data;
    if(pending)return pending;
    pending=(async()=>{
      const previous=new Map((cached?.data.items || []).map(item=>[item.key,item]));
      const attemptedAt=new Date(now()).toISOString();
      const items=(await Promise.all(DEFINITIONS.map(async definition=>{
        try {
          const response=await http.get(historyUrl(definition),
            {timeout:7000,headers:{'User-Agent':'Mozilla/5.0','Referer':'https://finance.sina.com.cn/'},maxContentLength:2000000});
          const parsed=definition.kind==='index'?parseIndexChart(response.data,definition):parseSinaDaily(response.data,definition);
          return {...parsed,fetchedAt:attemptedAt,lastAttemptAt:attemptedAt,historyStatus:'available'};
        }catch(error){
          const old=previous.get(definition.key);
          return old?.candles?.length ? {...old,historyStatus:'cached',lastAttemptAt:attemptedAt,refreshError:String(error.message).slice(0,180)}
            : {key:definition.key,symbol:definition.symbol,status:'unavailable',historyStatus:'unavailable',lastAttemptAt:attemptedAt,reason:'历史来源暂不可用：'+String(error.message).slice(0,180)};
        }
      }))).filter(Boolean);
      const successful=items.filter(item=>item.historyStatus==='available').length;
      const data={items,fetchedAt:successful?attemptedAt:cached?.data.fetchedAt || null,lastAttemptAt:attemptedAt,
        coverage:items.filter(item=>item.candles?.length).length+'/'+DEFINITIONS.length};
      cached={at:now(),data};return data;
    })().then(async data=>{
      if(options.cacheFile && data.items.some(item=>item.candles?.length)) {
        try {
          await fs.promises.mkdir(path.dirname(options.cacheFile),{recursive:true});
          await fs.promises.writeFile(options.cacheFile+'.tmp',JSON.stringify({schema:'webstock.global-kline/v1',...data}));
          await fs.promises.rename(options.cacheFile+'.tmp',options.cacheFile);
        }catch(error){ data.cacheWriteError=String(error.message).slice(0,180); }
      }
      return data;
    }).finally(()=>{pending=null;});
    return pending;
  }
  return {fetch};
}
module.exports={DEFINITIONS,historyUrl,parseIndexChart,parseSinaDaily,createGlobalIndexTrendService,
  fetch:createGlobalIndexTrendService({cacheFile:process.env.WEBSTOCK_DB_PATH ? path.join(path.dirname(process.env.WEBSTOCK_DB_PATH),'global-market-kline-cache.json') : undefined}).fetch};
