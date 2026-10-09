(function(root){
  'use strict';
  const saved=new Map(),selections=new Map(),model=root.PhoneChartModel;
  const finite=v=>v!==null&&v!==undefined&&Number.isFinite(Number(v));
  const fmt=v=>finite(v)?Number(v).toLocaleString('zh-CN',{maximumFractionDigits:3}):'—';
  const compact=v=>!finite(v)?'—':Math.abs(v)>=1e8?+(v/1e8).toFixed(1)+'亿':Math.abs(v)>=1e4?+(v/1e4).toFixed(1)+'万':fmt(v);
  let selected=-1,activeRows=[],activeChart=null,activeRead=null,sizeObserver=null;
  function detach(){sizeObserver?.disconnect();sizeObserver=null;if(activeChart&&!activeChart.isDisposed()){activeChart.off('datazoom');activeChart.off('updateAxisPointer');activeChart.off('click');}activeChart=null;activeRead=null;}
  function draw(data,settings){
    detach();
    const {type,period,indicator,maPeriods,nine}=settings;
    const minute=type==='minute',key=data.symbol+':'+type+':'+period;
    const palette=getComputedStyle(document.body),ink=palette.getPropertyValue('--muted').trim(),lineColor=palette.getPropertyValue('--line').trim(),up=palette.getPropertyValue('--up').trim(),down=palette.getPropertyValue('--down').trim();
    const colors=['#c18b0d','#a66adb','#3099c5','#ed805a','#46aa85','#ce81ba','#7c8cff','#919820'];
    const intraday=minute?model.minuteSeries(data.rows):null,rows=minute?intraday.rows:data.rows.map(row=>({...row})),times=minute?intraday.times:rows.map(row=>row.date);
    const aux=!minute&&indicator!=='ma',axes=aux?[0,1,2]:[0,1],volAxis=aux?2:1;
    if(!minute){model.indicators.calcMAFromData(rows,maPeriods);const calc={macd:'calcMACD',kdj:'calcKDJ',rsi:'calcRSI',cci:'calcCCI',obv:'calcOBV',atr:'calcATR'}[indicator];if(calc)model.indicators[calc](rows);}
    const chart=echarts.getInstanceByDom(document.querySelector('#chart'))||echarts.init(document.querySelector('#chart')),series=[],legend=[];
    const signals=nine?model.chartSignals(data,settings):{series:[]},nineSeries=signals.series;
    const addLine=(name,values,color,axis=0)=>{legend.push(name);series.push({name,type:'line',data:values,xAxisIndex:axis,yAxisIndex:axis,symbol:'none',connectNulls:false,lineStyle:{width:1.25,color},itemStyle:{color},emphasis:{disabled:true}});};
    if(minute){
      addLine('价格',rows.map(r=>r?.price??null),'#4285ef');addLine('均价',rows.map(r=>r?.averagePrice??null),colors[0]);
      if(finite(data.previousClose)&&data.previousClose>0)series[0].markLine={silent:true,symbol:'none',label:{show:false},lineStyle:{color:ink,width:1,type:'dashed'},data:[{yAxis:data.previousClose}]};
    }else{
      series.push({name:'K线',type:'candlestick',data:rows.map(r=>[r.open,r.close,r.low,r.high]),itemStyle:{color:up,color0:down,borderColor:up,borderColor0:down},xAxisIndex:0,yAxisIndex:0});
      maPeriods.forEach((p,i)=>addLine('MA'+p,rows.map(r=>r['ma'+p]),colors[i%colors.length]));
      const lines={macd:[['DIF','macd_dif'],['DEA','macd_dea']],kdj:[['K','kdj_k'],['D','kdj_d'],['J','kdj_j']],rsi:[['RSI(14)','rsi']],cci:[['CCI(14)','cci']],obv:[['OBV','obv']],atr:[['ATR(14)','atr']]}[indicator]||[];
      lines.forEach(([label,field],i)=>addLine(label,rows.map(r=>r[field]),colors[i],1));
      if(indicator==='macd')series.push({name:'MACD柱',type:'bar',xAxisIndex:1,yAxisIndex:1,data:rows.map(r=>({value:r.macd_bar,itemStyle:{color:r.macd_bar>=0?up:down}}))});
    }
    if(nine){
      series[0].markPoint={silent:false,data:nineSeries.flatMap(item=>item?.marks||[]).map(mark=>{
        const upper=mark.direction==='sell',countdown=mark.type==='countdown',color=upper?up:down;
        const lane=mark.type==='setup'?0:countdown||mark.type==='countdown-deferred'?1:mark.type==='perfection'?2:3;
        const complete=mark.confirmed&&(mark.type==='setup'&&mark.label==='9'||countdown&&mark.label==='13');
        return {coord:[times[mark.index],mark.price],value:countdown?'C'+mark.label:mark.label,signalIndex:mark.index,explanation:mark.explanation,
          symbol:countdown?'roundRect':'circle',symbolSize:countdown?[28,16]:16,
          symbolOffset:[0,(upper?-1:1)*(10+lane*14)],itemStyle:{color:complete?color:'transparent',opacity:mark.provisional?.5:1},label:{color:complete?'#fff':color,fontSize:10,show:true}};
      })};
    }
    series.push({name:'成交量(手)',type:'bar',xAxisIndex:volAxis,yAxisIndex:volAxis,data:rows.map((r,i)=>({value:r?.volume??null,itemStyle:{color:!r?ink:(minute?r.price>=(rows[i-1]?.price??data.previousClose??r.price):r.close>=r.open)?up:down,opacity:.75}}))});
    const previousZoom=saved.get(key),zoom=previousZoom?{start:previousZoom.start,end:previousZoom.end}:{start:minute?0:Math.max(0,100-65/rows.length*100),end:100};
    // Prepending history must not move the user's viewport to other calendar dates.
    if(previousZoom&&previousZoom.first!==times[0]){
      const startIndex=times.indexOf(previousZoom.from),endIndex=times.indexOf(previousZoom.to);
      if(startIndex>=0&&endIndex>=0){zoom.start=startIndex/Math.max(1,rows.length-1)*100;zoom.end=endIndex/Math.max(1,rows.length-1)*100;}
    }
    const grids=aux?[{top:25,height:'43%'},{top:'54%',height:'17%'},{top:'78%',height:'12%'}]:[{top:25,height:'60%'},{top:'74%',height:'16%'}];
    const option={animation:false,backgroundColor:'transparent',legend:{show:false},tooltip:{trigger:'axis',showContent:false,triggerOn:'mousemove|click',axisPointer:{type:'cross'}},axisPointer:{link:[{xAxisIndex:'all'}],label:{show:false}},
      grid:grids.map(g=>({...g,left:49,right:16})),
      xAxis:axes.map((id)=>({type:'category',data:times,gridIndex:id,boundaryGap:!minute,axisLine:{lineStyle:{color:lineColor}},axisTick:{show:false},axisLabel:{show:id===volAxis,color:ink,fontSize:10,hideOverlap:true,...(minute?{interval:index=>[0,60,120,181,241].includes(index),showMinLabel:true,showMaxLabel:true}:{}),formatter:minute?value=>value==='11:30'?'11:30 / 13:00':value:value=>value.slice(2)},axisPointer:{label:{show:false}}})),
      yAxis:axes.map(id=>({type:'value',gridIndex:id,scale:true,splitNumber:id===0?4:2,axisLabel:{color:ink,fontSize:10,formatter:id===0?fmt:compact},axisLine:{show:false},axisTick:{show:false},splitLine:{lineStyle:{color:lineColor,type:'dashed'}},axisPointer:{label:{show:false}}})),
      dataZoom:[{type:'inside',xAxisIndex:axes,filterMode:'filter',zoomOnMouseWheel:true,moveOnMouseMove:true,...zoom},{type:'slider',xAxisIndex:axes,filterMode:'filter',height:16,bottom:2,showDetail:false,borderColor:lineColor,fillerColor:'rgba(80,130,220,.15)',...zoom}],series};
    const offsets=(series[0].markPoint?.data||[]).map(mark=>mark.symbolOffset[1]);
    const bottomSpace=offsets.some(v=>v>0)?Math.max(...offsets)+10:0,topSpace=offsets.some(v=>v<0)?Math.max(...offsets.map(v=>-v))+10:0;
    const minutePrices=minute?rows.flatMap(r=>r?[r.price,r.averagePrice].filter(finite):[]):[];
    const minuteDelta=minute&&finite(data.previousClose)&&data.previousClose>0?Math.max(data.previousClose*.005,...minutePrices.map(p=>Math.abs(p-data.previousClose))):null;
    const priceAxisPadding=()=>{
      const height=document.querySelector('#chart').clientHeight*parseFloat(grids[0].height)/100;
      const available=Math.max(1,height-bottomSpace-topSpace),gap=[bottomSpace/available,topSpace/available];
      return minuteDelta!==null?{min:data.previousClose-minuteDelta*(1+2*gap[0]),max:data.previousClose+minuteDelta*(1+2*gap[1])}:{boundaryGap:gap};
    };
    Object.assign(option.yAxis[0],priceAxisPadding());
    chart.setOption(option,{notMerge:true,lazyUpdate:false});
    // Source/readout wrapping and Android insets may resize the flex item after initial paint.
    // Observe the actual chart box so the canvas cannot retain its former height over the buttons.
    const chartNode=document.querySelector('#chart');
    sizeObserver=new ResizeObserver(()=>{if(!chart.isDisposed()&&chartNode.clientWidth>0&&chartNode.clientHeight>0&&(chart.getWidth()!==chartNode.clientWidth||chart.getHeight()!==chartNode.clientHeight)){chart.setOption({yAxis:[priceAxisPadding()]});chart.resize();}});
    sizeObserver.observe(chartNode);
    chart.on('datazoom',()=>{const z=chart.getOption().dataZoom[0];saved.set(key,{start:z.start,end:z.end,first:times[0],from:times[Math.round(z.start/100*(times.length-1))],to:times[Math.round(z.end/100*(times.length-1))]});});
    const header=document.querySelector('#chartLegend');header.replaceChildren();
    for(const name of legend){const item=series.find(s=>s.name===name),label=document.createElement('span');label.style.color=item.lineStyle.color;label.textContent=name+'  ';header.append(label);}
    const volumeLabel=document.createElement('span');volumeLabel.textContent=' | 成交量（手）'+(nine&&!minute?' | 1–9准备 · C1–C13计数':'');header.append(volumeLabel);
    const read=index=>{
      if(index<0||index>=rows.length)return;selected=index;selections.set(key,times[index]);const r=rows[index],node=document.querySelector('#chartReadout');
      if(!r){node.textContent=times[index]+' · 该时段暂无数据（未补造价格或成交量）';return;}
      const previous=minute?data.previousClose:rows[index-1]?.close,close=minute?r.price:r.close;
      const change=finite(previous)&&previous>0?(close/previous-1)*100:null;
      const fields=minute?[['价格',fmt(r.price)],['涨跌',finite(change)?(change>0?'+':'')+fmt(change)+'%':'—'],['均价',fmt(r.averagePrice)],['成交量',compact(r.volume)+'手']]:[['开',fmt(r.open)],['高',fmt(r.high)],['低',fmt(r.low)],['收',fmt(r.close)],['涨跌',finite(change)?(change>0?'+':'')+fmt(change)+'%':'—'],['量',compact(r.volume)+'手']];
      node.replaceChildren();const date=document.createElement('b');date.textContent=times[index]+(minute?'':' · '+({qfq:'前复权',none:'未复权'}[data.adjustment]||'复权待核验'));node.append(date);
      for(const [label,value]of fields){const span=document.createElement('span');span.textContent=label+' '+value;node.append(span);}
      const detail=document.createElement('small');
      if(!minute){const fields={macd:['macd_dif','macd_dea','macd_bar'],kdj:['kdj_k','kdj_d','kdj_j'],rsi:['rsi'],cci:['cci'],obv:['obv'],atr:['atr']}[indicator];detail.textContent=fields?fields.map(f=>f.replace('macd_','').replace('kdj_','').toUpperCase()+' '+fmt(r[f])).join(' · '):maPeriods.map(p=>'MA'+p+' '+fmt(r['ma'+p])).join(' · ');if(nineSeries[index])detail.textContent+=' · '+nineSeries[index].label;}
      node.append(detail);
      if(minute&&nineSeries[index]?.label){detail.textContent=nineSeries[index].label;}
      if(nine){const explain=document.createElement('button');explain.className='signal-explain';explain.textContent='信号解释 / 历史核对';explain.addEventListener('click',()=>showSignals(data,settings,signals,index));node.append(explain);}
    };
    chart.on('updateAxisPointer',event=>{const info=event.axesInfo?.find(i=>i.axisIndex===0);if(info){const index=typeof info.value==='number'?info.value:times.indexOf(info.value);read(index);}});
    chart.on('click',event=>{if(event.componentType==='markPoint'){const index=event.data?.signalIndex;if(Number.isInteger(index)){read(index);showSignals(data,settings,signals,index);}}});
    activeRows=rows;activeChart=chart;activeRead=read;
    let last=times.indexOf(selections.get(key));if(last<0)last=rows.length-1;while(last>=0&&!rows[last])last--;read(last);
    return chart;
  }
  function showSignals(data,settings,signals,index){
    let dialog=document.querySelector('#chartSignalDialog');
    if(!dialog){dialog=document.createElement('dialog');dialog.id='chartSignalDialog';document.body.append(dialog);}
    dialog.replaceChildren();const heading=document.createElement('h3');heading.textContent='九转 / 序列 · 规则与核对';dialog.append(heading);
    const append=text=>{const line=document.createElement('p');line.textContent=text;dialog.append(line);};
    append(signals.rule||'当前周期暂无可计算规则');
    const item=signals.series[index];append('所选位置：'+(item?.date||item?.time||'暂无')+' · '+(item?.label||'样本不足'));
    for(const mark of item?.marks||[])append(mark.type+' '+mark.label+'：'+mark.explanation);
    for(const limitation of signals.limitations||[])append(limitation);
    if(settings.type!=='minute'){
      const result=model.reviewHistory(data,settings);append('仅已加载历史 '+result.from+' — '+result.to+' · '+result.barCount+' 根；已确认9/13事件 '+result.events.length+' 次。');
      for(const horizon of [1,5,20]){const values=result.events.map(e=>e.outcomes[horizon]).filter(o=>o.status==='available').map(o=>o.returnPct);append(horizon+' 根后：可核对 '+values.length+' 个，平均价格变化 '+(values.length?fmt(values.reduce((a,b)=>a+b,0)/values.length)+'%':'暂无')+'（高位、低位事件合并，仅价格统计，不是策略收益）');}
      append(result.limitation);
    }
    const close=document.createElement('button');close.textContent='关闭';close.addEventListener('click',()=>dialog.close());dialog.append(close);dialog.showModal();
  }
  function step(direction){let index=selected+direction;while(index>=0&&index<activeRows.length&&!activeRows[index])index+=direction;if(index<0||index>=activeRows.length)return;activeRead(index);const z=activeChart.getOption().dataZoom[0],percent=index/Math.max(1,activeRows.length-1)*100;if(percent<z.start||percent>z.end){const width=z.end-z.start,start=Math.max(0,Math.min(100-width,percent-width/2));activeChart.dispatchAction({type:'dataZoom',start,end:start+width});}activeChart.dispatchAction({type:'showTip',seriesIndex:0,dataIndex:index});}
  function range(count){if(!activeChart)return;activeChart.dispatchAction({type:'dataZoom',start:count?Math.max(0,100-count/activeRows.length*100):0,end:100});}
  root.PhoneCharts={draw,step,range,detach};
})(window);
