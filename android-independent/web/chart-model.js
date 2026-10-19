(function(root,factory){
  if(typeof module==='object'&&module.exports){
    const vm=require('node:vm'),fs=require('node:fs'),box={window:{}};
    vm.runInNewContext(fs.readFileSync(__dirname+'/shared/indicators.js','utf8'),box);
    module.exports=factory(box.window.Indicators,require('./shared/marketSignalModel'),require('./shared/sequentialSignalModel'));
  }else root.PhoneChartModel=factory(root.Indicators,root.MarketSignalModel,root.SequentialSignalModel);
})(typeof window!=='undefined'?window:null,function(indicators,signals,sequential){
  'use strict';
  function parseMA(text){
    const parts=String(text).trim().split(/[,，\s]+/),values=[...new Set(parts.map(Number))];
    if(parts.some(v=>!/^\d+$/.test(v))||values.length>8||values.some(v=>v<1||v>1000))throw Error('均线周期须为 1–1000 的整数，最多 8 条，用逗号分隔');
    return values;
  }
  function minuteSeries(input){
    const times=[];
    for(const [from,to] of [[570,690],[780,900]])for(let minute=from;minute<=to;minute++)times.push(String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0'));
    const byTime=new Map();
    for(const row of input||[]){const raw=String(row.time),time=/^\d{4}$/.test(raw)?raw.slice(0,2)+':'+raw.slice(2):raw; if(times.includes(time)&&Number.isFinite(row.price)&&row.price>0)byTime.set(time,row);}
    return {times,rows:times.map(time=>byTime.get(time)||null)};
  }
  function nineTurn(rows,asOf){return signals.calculateNineTurnSeries(rows,{asOf:asOf||new Date().toISOString()});}
  function mergeHistory(current,older,options){
    for(const field of ['symbol','period','source','adjustment'])if(!current[field]||current[field]!==older[field])throw Error('历史口径不一致，未拼接：'+field);
    const recent=new Map((current.rows||[]).map(row=>[row.date,row]));
    const asOf=options?.asOf||new Date().toISOString(),confirmed=new Set(sequential.calculateSeries(current.rows,{timeframe:current.period,asOf:current.checkedAt||asOf}).filter(item=>item.confirmed).map(item=>item.date));
    const oldConfirmed=new Set(sequential.calculateSeries(older.rows,{timeframe:older.period,asOf:older.checkedAt||asOf}).filter(item=>item.confirmed).map(item=>item.date));
    const overlap=(older.rows||[]).filter(row=>recent.has(row.date)&&confirmed.has(row.date)&&oldConfirmed.has(row.date));
    if(!overlap.length)throw Error('历史分页没有可核对的重叠K线，未拼接');
    if(overlap.some(row=>['open','high','low','close'].some(field=>row[field]==null||recent.get(row.date)[field]==null||!Number.isFinite(Number(row[field]))||!Number.isFinite(Number(recent.get(row.date)[field]))||Math.abs(Number(row[field])-Number(recent.get(row.date)[field]))>0.000001)))throw Error('重叠K线价格或复权基准有变化，保留原记录，未混接');
    const merged=new Map((older.rows||[]).map(row=>[row.date,row]));
    for(const row of current.rows||[])merged.set(row.date,row);
    return {...current,rows:[...merged.values()].sort((a,b)=>a.date.localeCompare(b.date)),historyLoaded:true,historyCheckedAt:older.checkedAt};
  }
  function snapshotContext(data,asOf){
    const checked=Date.parse(data.checkedAt),requested=Date.parse(asOf),now=Number.isFinite(requested)?requested:Date.now();
    const known=Number.isFinite(checked)||Number.isFinite(requested);
    const clock=new Date(Number.isFinite(checked)?Math.min(checked,now):now).toISOString();
    const rows=(data.rows||[]).map((row,index,all)=>!known&&index===all.length-1&&row.closed!==true&&row.incomplete!==false?{...row,incomplete:true}:row);
    return {clock,rows};
  }
  function chartSignals(data,settings,asOf){
    const snapshot=snapshotContext(data,asOf),clock=snapshot.clock;
    if(settings.type==='minute'){
      const rawDate=String(data.date||data.tradingDate||''),date=rawDate.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
      const rows=(data.rows||[]).map(row=>({...row,time:String(row.time).replace(/^(\d{2})(\d{2})$/,'$1:$2')}));
      const result=signals.calculateIntradayNineTurn(rows,{tradingDate:date,sampling:{intervalSeconds:60}},{asOf:clock});
      const byTime=new Map((result.series||[]).map(item=>[item.time,item]));
      return {rule:result.rule||result.reason,limitations:['仅1分钟价格序列1–9；没有真实分钟OHLC时不计算扩展13阶段。'],series:minuteSeries(data.rows).times.map((time,index)=>{const item=byTime.get(time);return {...item,marks:item&&item.available&&item.count>0&&item.count<=9?[{type:'setup',direction:item.direction==='up'?'sell':'buy',label:String(item.count),price:item.price,index,provisional:item.provisional,explanation:item.rule}]:[]};})};
    }
    return {rule:sequential.rule,limitations:sequential.limitations,series:sequential.calculateSeries(snapshot.rows,{asOf:clock,timeframe:settings.period})};
  }
  function reviewHistory(data,settings,asOf){const snapshot=snapshotContext(data,asOf);return sequential.evaluateHistory(snapshot.rows,{asOf:snapshot.clock,timeframe:settings.period});}
  return {indicators,parseMA,minuteSeries,nineTurn,mergeHistory,chartSignals,reviewHistory};
});
