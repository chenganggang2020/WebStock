const axios=require('axios');
const DEFINITIONS=[
  {key:'nikkei225',symbol:'^N225',name:'日经225',zone:'Asia/Tokyo'},
  {key:'kospi',symbol:'^KS11',name:'韩国KOSPI',zone:'Asia/Seoul'},
  {key:'hang-seng',symbol:'^HSI',name:'恒生指数',zone:'Asia/Hong_Kong'}
];
function parseIndexChart(payload,definition) {
  const result=payload?.chart?.result?.[0];
  if(result?.meta?.symbol!==definition.symbol || !Array.isArray(result.timestamp))throw Error('Index identity unavailable');
  const closes=result.indicators?.quote?.[0]?.close || [];
  const trend=result.timestamp.slice(-32).map((timestamp,offset)=>{
    const index=Math.max(0,result.timestamp.length-32)+offset, value=closes[index];
    return {date:new Date(timestamp*1000).toLocaleDateString('en-CA',{timeZone:definition.zone}),
      close:value!=null && Number.isFinite(Number(value)) && Number(value)>0 ? Number(value) : null};
  });
  const latest=trend.at(-1),previous=trend.at(-2);
  if(!latest || latest.close==null)throw Error('Latest index observation unavailable');
  return {key:definition.key,name:definition.name,status:'available',value:latest.close,
    changePct:previous?.close>0?(latest.close/previous.close-1)*100:null,
    observedAt:latest.date+' 日线（当地交易日）',source:'Yahoo Finance · 日线',trend,
    sourceUrl:'https://finance.yahoo.com/quote/'+encodeURIComponent(definition.symbol)+'/history/'};
}
function createGlobalIndexTrendService(options={}) {
  let cached=null,pending=null;const now=options.now || Date.now,http=options.http || axios;
  async function fetch() {
    if(cached && now()-cached.at<300000)return cached.data;
    if(pending)return pending;
    pending=(async()=>{
      const items=(await Promise.all(DEFINITIONS.map(async definition=>{
        try {
          const response=await http.get('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(definition.symbol)+'?interval=1d&range=1mo',
            {timeout:6000,headers:{'User-Agent':'Mozilla/5.0'},maxContentLength:1000000});
          return parseIndexChart(response.data,definition);
        }catch(_){return null;}
      }))).filter(Boolean);
      const data={items,fetchedAt:new Date(now()).toISOString(),coverage:items.length+'/'+DEFINITIONS.length};
      cached={at:now(),data};return data;
    })().finally(()=>{pending=null;});
    return pending;
  }
  return {fetch};
}
module.exports={parseIndexChart,createGlobalIndexTrendService,fetch:createGlobalIndexTrendService().fetch};
