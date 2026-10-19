'use strict';
const calendar=require('./marketTradingCalendar');

function nextTradingDay(date){
 const time=new Date(date+'T00:00:00Z');
 for(let i=0;i<40;i++){
  time.setUTCDate(time.getUTCDate()+1);const day=time.toISOString().slice(0,10),state=calendar.tradingDay(day);
  if(!state.known)return null;if(state.open)return day;
 }
 return null;
}

// Descriptive pairing only: no fit, signal, correlation, or historical availability claim.
function compareHistory(batches,indexSeries){
 const days=new Map(),result=[];
 for(const batch of batches){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(batch.tradingDate) || !calendar.tradingDay(batch.tradingDate).open)throw Error('Invalid trading date');
  if(!days.has(batch.tradingDate))days.set(batch.tradingDate,new Map());
  for(const row of batch.rows || []){
   if(row.tradingDay!==batch.tradingDate)throw Error('Source day mismatch');
   if(!/^中信期货[（(]代客[）)]$/.test(row.member) || !['long','short'].includes(row.positionType) || !(row.rank>=1&&row.rank<=20))continue;
   if(!['IF','IH','IC','IM'].includes(row.product) || !new RegExp('^'+row.product+'\\d{4}$').test(row.contract) || !Number.isSafeInteger(row.volume)||row.volume<0)throw Error('Invalid position row');
   const key=row.product+':'+row.contract,map=days.get(batch.tradingDate);
   if(!map.has(key))map.set(key,{product:row.product,contract:row.contract});
   if(map.get(key)[row.positionType]!==undefined)throw Error('Duplicate member side');
   map.get(key)[row.positionType]=row.volume;
  }
 }
 const indexMaps=Object.fromEntries(Object.entries(indexSeries).map(([code,rows])=>[code,new Map(rows.map(row=>[row.day.slice(0,10),row]))]));
 for(const [date,contracts] of [...days].sort(([a],[b])=>a.localeCompare(b))){
  const previous=days.get(calendar.previousTradingDay(date)),next=nextTradingDay(date);
  for(const product of ['IF','IH','IC','IM']){
   const all=[...contracts.values()].filter(row=>row.product===product);if(!all.length)continue;
   const complete=all.filter(row=>row.long!==undefined&&row.short!==undefined);
   const comparable=complete.filter(row=>{const old=previous?.get(product+':'+row.contract);return old?.long!==undefined&&old?.short!==undefined;});
   const returns=Object.fromEntries(Object.entries(indexMaps).map(([code,map])=>{
    const today=map.get(date),tomorrow=next&&map.get(next),close=Number(today?.close),open=Number(tomorrow?.open),end=Number(tomorrow?.close);
    return [code,close>0&&open>0&&end>0&&[close,open,end].every(Number.isFinite)?{closeToClosePercent:(end/close-1)*100,openToClosePercent:(end/open-1)*100}:null];
   }));
   result.push({date,product,member:'中信期货(代客)',contracts:complete.map(row=>row.contract),missingSideContracts:all.length-complete.length,
    netLong:complete.length?complete.reduce((sum,row)=>sum+row.long-row.short,0):null,
    comparableContracts:comparable.map(row=>row.contract),comparableChange:comparable.length?comparable.reduce((sum,row)=>{const old=previous.get(product+':'+row.contract);return sum+(row.long-row.short)-(old.long-old.short);},0):null,
    nextTradingDay:next,returns,automaticTrading:false});
  }
 }
 return result;
}
module.exports={compareHistory};
