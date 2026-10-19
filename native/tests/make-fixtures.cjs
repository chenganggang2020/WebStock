// Deterministic review data and regression contracts. No network or production database access.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),dest=path.join(root,'contracts');
fs.mkdirSync(dest,{recursive:true});
const seq=require('../../js/modules/sequentialSignalModel.js');
const candles=closes=>closes.map((c,i)=>({date:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),open:c,high:c+.4,low:c-.4,close:c,volume:100,incomplete:false}));
const setup=()=>candles([100,101,102,103,104,99,98,97,96,95,94,93,92,91]);
const cycle=()=>candles([100,101,102,103,104,...Array.from({length:21},(_,i)=>99-i)]);
const cases={buy:cycle(),sell:cycle().map(b=>({...b,open:220-b.open,high:220-b.low,low:220-b.high,close:220-b.close})),noFlip:candles(Array.from({length:30},(_,i)=>100-i))};
cases.equal=setup();Object.assign(cases.equal[8],{open:104,close:104,high:105,low:103});
cases.latePerfect=setup();cases.latePerfect[10].low=80;cases.latePerfect[11].low=81;cases.latePerfect.push({...candles([90])[0],date:'2025-01-15',low:79});
cases.defer=candles([100,101,102,103,104,...Array.from({length:16},(_,i)=>99-i),100,83,95,82,94,90,93,81]);
cases.opposite=candles([100,101,102,103,104,...Array.from({length:9},(_,i)=>99-i),...Array.from({length:14},(_,i)=>95+i)]).map(b=>({...b,high:150,low:40}));
cases.breach=setup();cases.breach.push(...candles([110,111]).map((b,i)=>({...b,date:'2025-01-'+(15+i)})));
cases.recycle22=candles([100,101,102,103,104,...Array.from({length:22},(_,i)=>99-i)]).map(b=>({...b,low:40}));
cases.rangeRecycle=candles([100,101,102,103,104,...Array.from({length:9},(_,i)=>99-i),97,98,99,100,...Array.from({length:14},(_,i)=>96-i)]).map((b,i)=>({...b,high:110,low:i<18?80:70}));
for(const kind of ['gap','invalid','duplicate','forming']){cases[kind]=cycle();if(kind==='gap')cases[kind][8].gap=true;if(kind==='invalid')cases[kind][8].high=2;if(kind==='duplicate')cases[kind][8].date=cases[kind][7].date;if(kind==='forming')cases[kind][13].incomplete=true;}
const rows=['case,time,open,high,low,close,volume,valid,closed,setup,countdown,direction,cdDirection,perfected,deferred,support,resistance,setupTriggered,cdTriggered'];
for(const [name,bars]of Object.entries(cases)){let result=seq.calculateSeries(bars);bars.forEach((b,i)=>{let s=result[i],dir=x=>x==='buy'?-1:x==='sell'?1:0;rows.push([name,Date.parse(b.date),b.open,b.high,b.low,b.close,b.volume,b.gap?0:1,b.incomplete?0:1,s.setup.count,s.countdown.count,dir(s.setup.direction),dir(s.countdown.direction),+s.setup.perfected,+s.countdown.deferred,s.levels.support?.price??'null',s.levels.resistance?.price??'null',+s.setup.triggered,+s.countdown.triggered].join(','));});}
fs.writeFileSync(path.join(dest,'sequential.csv'),rows.join('\n')+'\n');
const names=[['SZ:stock:000001','平安银行','深市 · 股票',11.8,'银行'],['SH:stock:600519','贵州茅台','沪市 · 股票',1420,'消费'],['SZ:stock:300750','宁德时代','深市 · 股票',252,'新能源'],['SH:index:000001','上证指数','沪市 · 指数',3250,'指数'],['SH:etf:510300','沪深300ETF','沪市 · ETF',3.86,'指数'],['SZ:stock:002594','比亚迪','深市 · 股票',286,'新能源'],['SH:stock:600036','招商银行','沪市 · 股票',35.5,'银行'],['SZ:stock:000333','美的集团','深市 · 股票',70.8,'消费']];
const instruments=names.map(([id,name,market,base,group],k)=>{
  const raw=Array.from({length:90},(_,i)=>100+5*Math.sin(i*.24+k)+i*.04).concat([100,101,102,103,104,...Array.from({length:21},(_,i)=>99-i)]);
  const values=raw.map(v=>k%2?220-v:v);
  const day=values.map((v,i)=>{const close=v*base/100,open=(i?values[i-1]:v)*base/100*(1+Math.sin(i*2)*.002),t=Date.UTC(2026,3,1+i);return {time:t,label:new Date(t).toISOString().slice(5,10),open,close,high:Math.max(open,close)+base*.004,low:Math.min(open,close)-base*.004,volume:Math.round((1+Math.abs(Math.sin(i*1.7)))*1000000*(i===115?2.5:1)),valid:true,closed:i!==115};});
  const previousClose=day.at(-2).close,lastClose=day.at(-1).close;
  const minute=Array.from({length:240},(_,i)=>{const mins=i<120?570+i:780+i-120,label=String(Math.floor(mins/60)).padStart(2,'0')+':'+String(mins%60).padStart(2,'0');const close=previousClose+(lastClose-previousClose)*i/239+base*.003*Math.sin(i*.11)*Math.sin(Math.PI*i/239);return{time:day.at(-1).time+(mins-480)*60000,label,open:close,high:close+base*.0005,low:close-base*.0005,close,volume:5000+Math.round(Math.abs(Math.sin(i*.4))*20000),valid:i!==170,closed:i!==239};});
  const week=[];for(let i=0;i<day.length;i+=5){const chunk=day.slice(i,i+5),last=chunk.at(-1);week.push({...chunk[0],label:chunk[0].label,close:last.close,high:Math.max(...chunk.map(x=>x.high)),low:Math.min(...chunk.map(x=>x.low)),volume:chunk.reduce((a,b)=>a+b.volume,0),closed:chunk.length===5&&last.closed});}
  return{id,name,market,group,previousClose,day,week,minute};
});
fs.writeFileSync(path.join(dest,'review-data.json'),JSON.stringify({schema:1,source:'设计模拟 · 非实时',calendar:'模拟测试日历，不是交易所日历',timezone:'Asia/Shanghai',volumeUnit:'股（模拟）',instruments},null,2));
console.log(`Generated ${rows.length-1} sequential golden bars in ${Object.keys(cases).length} scenarios; ${instruments.length} simulated instruments.`);
