const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');

function harness(){
  function node(){return {children:[],style:{},textContent:'',clientWidth:390,clientHeight:460,append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},addEventListener(){},setAttribute(){},after(){}};}
  const nodes=Object.fromEntries(['#chart','#chartLegend','#chartReadout','#chartCoverage','#chartSignalDetail'].map(id=>[id,node()]));
  const charts=[],instances=new Map(),observers=[];let computations=0;
  const model={minuteSeries:require('../web/chart-model').minuteSeries,indicators:{calcMAFromData(){},calcMACD(){}},chartSignals(data){computations++;return {series:data.rows.map((r,index)=>({index,date:r.date,available:true,count:index+1,direction:'up',label:'上行'+(index+1),marks:[]}))};}};
  const box={window:{PhoneChartModel:model},document:{body:node(),querySelector:id=>nodes[id]||null,createElement:node},getComputedStyle:()=>({getPropertyValue:key=>({'--up':'#d8394e','--down':'#008560'}[key]||'#888')}),ResizeObserver:class{constructor(fn){observers.push(fn);}observe(){}disconnect(){}},echarts:{getInstanceByDom:el=>instances.get(el),init(el){const handlers={};const chart={handlers,option:null,setOption(o){this.option={...this.option,...o};},getOption(){return this.option;},on(e,fn){(handlers[e]??=[]).push(fn);},off(e){handlers[e]=[];},isDisposed:()=>false,getWidth:()=>390,getHeight:()=>460,resize(){},dispatchAction(action){if(action.type==='dataZoom'){this.option.dataZoom[0]={...this.option.dataZoom[0],...action};for(const h of handlers.datazoom||[])h({});}},emit(e,p){for(const h of handlers[e]||[])h(p);}};charts.push(chart);instances.set(el,chart);return chart;}}};
  vm.runInNewContext(fs.readFileSync(__dirname+'/../web/phone-charts.js','utf8'),box);
  const rows=Array.from({length:20},(_,i)=>({date:'2026-01-'+String(i+1).padStart(2,'0'),open:10+i,high:12+i,low:9+i,close:11+i,volume:100}));
  return {api:box.window.PhoneCharts,charts,nodes,model,observers,computations:()=>computations,data:{symbol:'sh600000',period:'day',rows},settings:{type:'kline',period:'day',indicator:'ma',maPeriods:[],nine:true}};
}

test('rotation relayout keeps all panels inside the canvas even when the app resized it first',()=>{
  const h=harness(),chart=h.api.draw(h.data,{...h.settings,indicator:'macd'});
  h.nodes['#chart'].clientHeight=322;chart.getHeight=()=>322;
  h.observers.at(-1)();const bottom=chart.option.grid.at(-1);
  assert.ok(bottom.top+bottom.height<=322-30);
});
test('refresh reuses the chart and preserves the selected candle and zoom without duplicate handlers',()=>{
  const h=harness(),first=h.api.draw(h.data,h.settings);
  first.dispatchAction({type:'dataZoom',start:20,end:80});
  first.emit('updateAxisPointer',{axesInfo:[{axisIndex:0,value:5}]});
  const next=h.api.draw({...h.data,rows:h.data.rows.map(r=>({...r}))},h.settings);
  assert.equal(next,first);assert.equal(h.charts.length,1);
  assert.equal(next.option.dataZoom[0].start,20);
  assert.equal(h.nodes['#chartReadout'].children[0].textContent.startsWith('2026-01-06'),true);
  assert.equal(next.handlers.updateAxisPointer.length,1);
});
test('crosshair movement uses precomputed signals instead of rerunning the entire series',()=>{
  const h=harness(),chart=h.api.draw(h.data,h.settings),initial=h.computations();
  for(let i=0;i<15;i++)chart.emit('updateAxisPointer',{axesInfo:[{axisIndex:0,value:i}]});
  assert.equal(h.computations(),initial);
});

test('appending a new candle does not move a historical viewport',()=>{
  const h=harness(),chart=h.api.draw(h.data,h.settings);
  chart.dispatchAction({type:'dataZoom',start:20,end:80});
  h.api.draw({...h.data,rows:h.data.rows.concat({...h.data.rows.at(-1),date:'2026-01-21'})},h.settings);
  const zoom=chart.option.dataZoom[0],dates=chart.option.xAxis[0].data;
  assert.equal(dates[Math.round(zoom.start/100*(dates.length-1))],'2026-01-05');
  assert.equal(dates[Math.round(zoom.end/100*(dates.length-1))],'2026-01-16');
});
test('prepending history preserves the visible calendar interval instead of percentages',()=>{
  const h=harness(),chart=h.api.draw(h.data,h.settings);
  chart.dispatchAction({type:'dataZoom',start:20,end:80});
  const prior=h.data.rows.map(row=>({...row,date:row.date.replace('2026-01','2025-12')}));
  h.api.draw({...h.data,rows:prior.concat(h.data.rows)},h.settings);
  const zoom=chart.option.dataZoom[0],dates=chart.option.xAxis[0].data;
  assert.equal(dates[Math.round(zoom.start/100*(dates.length-1))],'2026-01-05');
  assert.equal(dates[Math.round(zoom.end/100*(dates.length-1))],'2026-01-16');
});
test('setup and countdown labels are distinct and simultaneous events use separate lanes',()=>{
  const h=harness();
  h.model.chartSignals=()=>({series:[{marks:['setup','countdown','perfection','recycle'].map((type,i)=>({type,index:3,price:15,direction:'sell',confirmed:true,label:['9','1','✓','R'][i]}))}]});
  const chart=h.api.draw(h.data,h.settings),marks=chart.option.series.find(s=>s.name==='九转标记').data;
  assert.deepEqual(Array.from(marks,m=>m.label.formatter),['9','C1','✓','R']);
  assert.equal(new Set(marks.map(m=>m.label.distance)).size,4);
  assert.equal(marks[1].label.backgroundColor,'transparent');
});
test('dense signal annotations do not expand the price axis and retain every event',()=>{
  const h=harness();
  h.model.chartSignals=()=>({series:[{marks:['buy','sell'].flatMap(direction=>['setup','countdown','perfection','recycle'].map(type=>({type,index:3,price:15,direction,confirmed:true,label:'1'})))}]});
  const chart=h.api.draw(h.data,h.settings),annotations=chart.option.series.find(s=>s.name==='九转标记'),marks=annotations.data;
  const padding=chart.option.yAxis[0].boundaryGap;
  assert.equal(marks.length,8);
  assert.ok(padding.every(value=>value<=.1),'signal density must not flatten the candles');
  const layout=annotations.labelLayout({labelRect:{x:1,y:-100,width:30,height:12}});
  assert.ok(layout.y>=chart.option.grid[0].top);
  assert.equal(layout.hideOverlap,true);
});

test('price plot receives at least sixty percent of drawable height with a subindicator',()=>{
  const h=harness(),chart=h.api.draw(h.data,{...h.settings,indicator:'macd'});
  const heights=chart.option.grid.map(g=>g.height);
  assert.ok(heights[0]/heights.reduce((a,b)=>a+b,0)>=.6);
  assert.equal(chart.option.series[0].barWidth,'68%');
});

test('whole intraday price line follows last valid price versus previous close, average stays distinct',()=>{
  for(const [price,reference,expected]of [[11,10,'#d8394e'],[9,10,'#008560'],[10,10,'#888'],[10,null,'#888'],[10,0,'#888']]){
    const h=harness(),chart=h.api.draw({symbol:'sz000001',previousClose:reference,rows:[{time:'09:31',price,averagePrice:10,volume:1}]},{...h.settings,type:'minute',nine:false});
    assert.equal(chart.option.series[0].lineStyle.color,expected);
    assert.equal(chart.option.series[1].lineStyle.color,'#c18b0d');
    assert.equal(chart.option.series[0].connectNulls,false);
  }
});
