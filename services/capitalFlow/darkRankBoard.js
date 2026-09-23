const axios = require('axios');
const iconv = require('iconv-lite');

function parseMarketCaps(text) {
  const result = new Map();
  for (const match of String(text).matchAll(/v_((?:sh|sz|bj)\d{6})="([^"]*)"/g)) {
    const fields = match[2].split('~'), stamp = fields[30] || '', cap = Number(fields[45]);
    if (!/^\d{14}$/.test(stamp) || !Number.isFinite(cap) || cap <= 0 || fields[2] !== match[1].slice(2)) continue;
    result.set(match[1], { date:stamp.slice(0,4)+'-'+stamp.slice(4,6)+'-'+stamp.slice(6,8),
      observedAt:stamp, totalMarketValue:cap*1e8,
      amount:fields[37] && Number.isFinite(Number(fields[37])) ? Number(fields[37])*1e4 : null });
  }
  return result;
}

function rankDarkRows(rows, caps, date, metric) {
  const enriched = rows.map(row => {
    const key = row.key || (row.venue || '').toLowerCase()+row.code, cap = caps.get(key);
    const matched = cap && cap.date === date && Number.isFinite(cap.totalMarketValue) && cap.totalMarketValue > 0;
    const net = row.darkNetCents == null ? null : Number(row.darkNetCents)/100;
    return {...row, key, totalMarketValue:matched ? cap.totalMarketValue : null,
      turnoverAmount:matched ? cap.amount : null, capObservedAt:matched ? cap.observedAt : null,
      darkMarketCapRatio:matched && Number.isFinite(net) ? net/cap.totalMarketValue : null};
  });
  const field = metric === 'visible' ? 'visibleNetCents' : metric === 'combined' ? 'combinedNetCents' : 'darkNetCents';
  const value = row => metric === 'ratio' ? row.darkMarketCapRatio : row[field] == null ? null : Number(row[field]);
  return { rows:enriched, ratioMissing:enriched.filter(row=>row.darkMarketCapRatio==null).length,
    inflow:enriched.filter(row=>value(row)>0).sort((a,b)=>value(b)-value(a)),
    outflow:enriched.filter(row=>value(row)<0).sort((a,b)=>value(a)-value(b)) };
}

function createDarkRankBoard(options) {
  let capCache = null, capPending = null, customPending = null;
  const now = options.now || Date.now;
  async function loadCaps(rows) {
    if (capCache && now()-capCache.at<300000) return capCache.items;
    if (capPending) return capPending;
    capPending = (async () => {
      const items = new Map(), keys = rows.map(row=>row.key).filter(key=>/^(sh|sz|bj)\d{6}$/.test(key)), batches=[];
      for(let i=0;i<keys.length;i+=100) batches.push(keys.slice(i,i+100));
      let next=0;const started=Date.now();
      await Promise.all(Array.from({length:3}, async()=>{
        while(next<batches.length && Date.now()-started<20000) {
          const batch=batches[next++];
          try {
            const response=await axios.get('https://qt.gtimg.cn/q='+batch.join(','),{responseType:'arraybuffer',timeout:5000});
            parseMarketCaps(iconv.decode(response.data,'gb18030')).forEach((value,key)=>items.set(key,value));
          } catch (_) { /* Partial denominators remain missing, never zero. */ }
        }
      }));
      capCache={at:now(),items}; return items;
    })().finally(()=>{capPending=null;});
    return capPending;
  }
  async function get({date,metric='amount'}) {
    if (!['amount','ratio','visible','combined'].includes(metric)) throw Error('Invalid ranking metric');
    const snapshot = await options.darkStocks.get({date,codes:['sh600000'],all:true});
    let lookup;
    if (options.loadCaps) {
      if (!customPending && (!capCache || now()-capCache.at>=300000)) {
        customPending=Promise.resolve().then(()=>options.loadCaps(snapshot.rows))
          .then(items=>{capCache={at:now(),items};return items;}).finally(()=>{customPending=null;});
      }
      lookup=customPending || Promise.resolve(capCache.items);
    } else lookup=loadCaps(snapshot.rows);
    // Amounts can render immediately. Missing denominators stay null while the
    // single shared lookup completes; ratio ranking explicitly waits for them.
    lookup=lookup.catch(()=>capCache?.items || new Map());
    const caps = metric==='ratio' ? await lookup : capCache?.items || new Map();
    const rank=rankDarkRows(snapshot.rows,caps,date,metric);
    return {...snapshot, ...rank, metric, capLoading:Boolean(capPending || customPending),
      capSource:'腾讯公开报价 · 总市值 / 当日成交额', capDateRequired:date};
  }
  return {get};
}
module.exports={parseMarketCaps,rankDarkRows,createDarkRankBoard};
