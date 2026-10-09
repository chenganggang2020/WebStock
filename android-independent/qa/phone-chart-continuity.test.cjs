const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');

function harness(){
  function node(){return {children:[],style:{},textContent:'',clientWidth:390,clientHeight:460,append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},addEventListener(){},setAttribute(){},after(){}};}
  const nodes=Object.fromEntries(['#chart','#chartLegend','#chartReadout','#chartCoverage','#chartSignalDetail'].map(id=>[id,node()]));
  const charts=[],instances=new Map();let computations=0;
  const model={indicators:{calcMAFromData(){}},chartSignals(data){computations++;return {series:data.rows.map((r,index)=>({index,date:r.date,available:true,count:index+1,direction:'up',label:'上行'+(index+1),marks:[]}))};}};
  const box={window:{PhoneChartModel:model},document:{body:node(),querySelector:id=>nodes[id]||null,createElement:node},getComputedStyle:()=>({getPropertyValue:()=> '#888'}),ResizeObserver:class{observe(){}disconnect(){}},echarts:{getInstanceByDom:el=>instances.get(el),init(el){const handlers={};const chart={handlers,option:null,setOption(o){this.option=o;},getOption(){return this.option;},on(e,fn){(handlers[e]??=[]).push(fn);},off(e){handlers[e]=[];},isDisposed:()=>false,getWidth:()=>390,getHeight:()=>460,resize(){},dispatchAction(action){if(action.type==='dataZoom'){this.option.dataZoom[0]={...this.option.dataZoom[0],...action};for(const h of handlers.datazoom||[])h({});}},emit(e,p){for(const h of handlers[e]||[])h(p);}};charts.push(chart);instances.set(el,chart);return chart;}}};
  vm.runInNewContext(fs.readFileSync(__dirname+'/../web/phone-charts.js','utf8'),box);
  const rows=Array.from({length:20},(_,i)=>({date:'2026-01-'+String(i+1).padStart(2,'0'),open:10+i,high:12+i,low:9+i,close:11+i,volume:100}));
  return {api:box.window.PhoneCharts,charts,nodes,model,computations:()=>computations,data:{symbol:'sh600000',period:'day',rows},settings:{type:'kline',period:'day',indicator:'ma',maPeriods:[],nine:true}};
}
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
  const chart=h.api.draw(h.data,h.settings),marks=chart.option.series[0].markPoint.data;
  assert.deepEqual(Array.from(marks,m=>m.value),['9','C1','✓','R']);
  assert.equal(new Set(marks.map(m=>m.symbolOffset[1])).size,4);
  assert.equal(marks[1].itemStyle.color,'transparent');
});
test('price-axis padding keeps offset signal labels out of adjacent panels',()=>{
  const h=harness();
  h.model.chartSignals=()=>({series:[{marks:['buy','sell'].flatMap(direction=>['setup','countdown','perfection','recycle'].map(type=>({type,index:3,price:15,direction,confirmed:true,label:'1'})))}]});
  const chart=h.api.draw(h.data,h.settings),marks=chart.option.series[0].markPoint.data;
  const padding=chart.option.yAxis[0].boundaryGap;
  assert.ok(Array.isArray(padding),'price axis must reserve room for signal labels');
  const height=h.nodes['#chart'].clientHeight*parseFloat(chart.option.grid[0].height)/100;
  const unit=height/(1+padding[0]+padding[1]);
  for(const side of [0,1]){
    const offset=Math.max(...marks.map(m=>m.symbolOffset[1]*(side===0?1:-1)));
    assert.ok(padding[side]*unit>=offset+8,'labels, including their height, must remain in the price panel');
  }
});
