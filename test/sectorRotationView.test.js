const test=require('node:test'),assert=require('node:assert/strict');
const {renderRows,chartOption,createRotationView}=require('../js/modules/sectorRotation');
const row={code:'BK0001',name:'<img src=x>',deltaCents:'100000000',speedYuanPerMinute:200000,speedChange:null,state:'前窗不足',divergence:true};
function doc() {const map=new Map();return {getElementById(id){if(!map.has(id))map.set(id,{value:'',textContent:'',innerHTML:'',hidden:false,events:{},addEventListener(k,f){this.events[k]=f;}});return map.get(id);}};}
const data={scope:'industry',minutes:5,metric:'combined',date:'2026-09-17',receivedAt:'2026-09-17T02:05:00Z',total:1,eligible:1,sampleCount:6,rows:[row],inflow:[row],outflow:[],accelerating:[],decelerating:[],collector:{enabled:true,sessionOpen:true,errors:{}}};
const ok=data=>({ok:true,json:async()=>({success:true,data})});
test('readable signed amounts, missing values and untrusted text escape',()=>{
  const html=renderRows([row]);assert.doesNotMatch(html,/<img/);assert.match(html,/100\.00 万元/);assert.match(html,/明暗反向/);assert.match(html,/--/);
});
test('curve does not connect lunch, missing samples or long gaps',()=>{
  const option=chartOption([{at:'2026-09-17T03:30:00Z',phase:'am',cumulativeCents:'100',changeRatio:null},
    {at:'2026-09-17T05:00:00Z',phase:'pm',cumulativeCents:'200',changeRatio:0.01}]);
  assert.equal(option.series[0].connectNulls,false);assert.equal(option.series[0].data.length,3);
  assert.equal(option.series[0].data[1][1],null);
});
test('binding never collects, selection change suppresses older responses',async()=>{
  const d=doc();let release;
  const v=createRotationView({document:d,fetch:()=>new Promise(r=>{release=r;})});v.bind();
  const p=v.run();d.getElementById('rotationScope').value='concept';v.invalidate();release(ok(data));await p;
  assert.equal(d.getElementById('rotationIn').innerHTML,'');
});
test('same-selection failure preserves clearly old data and a mismatched response is rejected',async()=>{
  const d=doc();let failure=false;
  const v=createRotationView({document:d,fetch:async()=>{if(failure)throw Error('offline');return ok(data);}});v.bind();await v.run();
  failure=true;await v.run();assert.match(d.getElementById('rotationStatus').textContent,/旧/);assert.match(d.getElementById('rotationIn').innerHTML,/100\.00/);
  v.invalidate();failure=false;d.getElementById('rotationMinutes').value='15';await v.run();
  assert.match(d.getElementById('rotationStatus').textContent,/不一致/);
});
test('malformed collector payload cannot overwrite a valid ranking',async()=>{
  const d=doc();let bad=false;
  const v=createRotationView({document:d,fetch:async()=>ok(bad?{...data,collector:null,inflow:[]}:data)});
  v.bind();await v.run();bad=true;await v.run();
  assert.match(d.getElementById('rotationIn').innerHTML,/100\.00/);
  assert.doesNotMatch(d.getElementById('rotationStatus').textContent,/Cannot read/);
});

test('night with no intraday history explains unavailability without a warmup countdown',async()=>{
  const d=doc(),v=createRotationView({document:d,fetch:async()=>ok({...data,eligible:0,displayMode:'no-intraday-window',inflow:[],
    collector:{enabled:true,running:true,sessionOpen:false,errors:{}}})});
  v.bind();await v.run();
  assert.doesNotMatch(d.getElementById('rotationStatus').textContent,/需积累约/);
  assert.match(d.getElementById('rotationStatus').textContent,/非连续交易|未形成有效盘中窗口/);
});

test('a stalled JSON body times out and a subsequent refresh can succeed',async()=>{
  const d=doc();let stalled=true;
  const v=createRotationView({document:d,timeoutMs:10,fetch:async()=>stalled?{ok:true,json:()=>new Promise(()=>{})}:ok(data)});
  v.bind();await Promise.race([v.run(),new Promise((_,reject)=>setTimeout(()=>reject(Error('UI still blocked')),200))]);
  assert.match(d.getElementById('rotationStatus').textContent,/超时/);
  stalled=false;await v.run();assert.match(d.getElementById('rotationIn').innerHTML,/100\.00/);
});

test('replay refresh stays read-only and does not attach current constituents to a past date',async()=>{
  const d=doc(),urls=[];
  const v=createRotationView({document:d,fetch:async(url,init)=>{urls.push([url,init.method]);return ok({...data,date:'2026-09-16'});}});
  v.bind();d.getElementById('rotationDate').value='2026-09-16';d.getElementById('rotationTime').value='10:05';
  await v.run(true);assert.match(urls[0][0],/date=2026-09-16/);assert.match(urls[0][0],/at=10%3A05%3A00/);
  assert.notEqual(urls[0][1],'POST');await v.focus('BK0001');
  assert.equal(urls.some(([url])=>url.includes('constituents')),false);
});

test('an empty historical replay never asks the user to wait for current sampling',async()=>{
  const d=doc(),v=createRotationView({document:d,fetch:async()=>ok({...data,date:'2026-09-16',eligible:0,inflow:[],outflow:[]})});
  v.bind();d.getElementById('rotationDate').value='2026-09-16';await v.run();
  assert.doesNotMatch(d.getElementById('rotationIn').innerHTML,/正在积累/);
  assert.match(d.getElementById('rotationIn').innerHTML,/历史|日榜/);
});
