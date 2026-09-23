(function(root,factory) {
  const api=factory();
  if(typeof module==='object' && module.exports)module.exports=api;
  if(root)root.AuctionRules=api;
})(typeof window==='undefined'?null:window,function() {
  const finite=v=>typeof v==='number' && Number.isFinite(v)?v:null;
  const stamp=v=>typeof v==='string'?Date.parse(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(v)?v.replace(' ','T')+'+08:00':v):NaN;
  const validDate=v=>typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v;
  const local=ms=>new Date(ms+8*3600000).toISOString();
  const percentile=(values,p)=>{const a=values.slice().sort((x,y)=>x-y);return a.length?a[Math.floor((a.length-1)*p)]:null;};
  const descriptions=[
    ['sustained-buy','持续偏买','参考价上移、匹配金额偏大，买方偏向持续；不是必涨信号。'],
    ['sustained-sell','持续偏卖','参考价下移、匹配金额偏大，卖方偏向持续；不是必跌信号。'],
    ['early-retreat','早段高报回落','早段高参考价没有维持；无逐笔撤单证据不称诱多。'],
    ['reversal','后段方向反转','参考价跨过基准，未匹配方向同步反转并持续。'],
    ['thin-gap','大缺口、低匹配','价格跳动较大但匹配金额偏小，注意流动性风险。'],
    ['closing-pressure','收盘供需集中','相对连续交易末价偏移，金额与买卖偏向支持，需随后验证。'],
    ['late-change','尾段突变','最后一分钟发生显著价量与未匹配方向变化，不推断账户动机。'],
    ['balanced','大额平衡撮合','匹配金额较大但参考价与未匹配方向接近平衡，不强行判涨跌。']
  ].map(([id,label,explanation])=>({id,label,explanation}));
  function analyze(input={}) {
    const meta=input.meta||{},phase=input.phase==='closing'?'closing':'opening';
    const result={ruleVersion:'auction-observation/v1-research',automaticTrading:false,dataLevel:'D0',
      patternStatus:'insufficient-data',reason:'没有已核验的竞价过程字段，不能判断形态。',phase,points:[],patterns:[],historyCount:0,latest:null};
    if(meta.auctionFieldContractVerified!==true || meta.auctionTimestampMeaning!=='source-event' ||
      meta.volumeUnit!=='shares' || meta.priceUnit!=='CNY' || !meta.sourceId || !meta.code)return result;
    const asOf=stamp(input.asOf),baseline=finite(input.baseline),start=phase==='opening'?'09:15:00':'14:57:00',end=phase==='opening'?'09:25:00':'15:00:00';
    if(!Number.isFinite(asOf) || !validDate(input.date) || !['opening','closing'].includes(input.phase))return result;
    const unique=new Map();
    for(const row of (Array.isArray(input.rows)?input.rows:[]).slice(-2000)) {
      if(!row)continue;
      const at=stamp(row.time),available=stamp(row.availableAt);
      if(!Number.isFinite(at) || !Number.isFinite(available) || available<at || at>asOf || available>asOf)continue;
      const clock=local(at).slice(11,19);
      if(local(at).slice(0,10)!==input.date || clock<start || clock>end || row.formalMatch===true)continue;
      const price=finite(row.auctionReferencePrice),q=finite(row.auctionMatchedVolume),buy=finite(row.auctionUnmatchedBuyVolume),sell=finite(row.auctionUnmatchedSellVolume);
      const valid=price>0 && [q,buy,sell].every(v=>Number.isSafeInteger(v) && v>=0) && Number.isFinite(price*q);
      const denominator=valid?2*q+buy+sell:0;
      unique.set(at,{at,time:row.time,availableAt:row.availableAt,clock,valid,price:valid?price:null,
        matchedAmount:valid?price*q:null,unmatchedBuy:valid?buy:null,unmatchedSell:valid?sell:null,
        imbalance:denominator>0?(buy-sell)/denominator:null,
        changePercent:valid && baseline>0?(price/baseline-1)*100:null});
    }
    const points=[...unique.values()].sort((a,b)=>a.at-b.at),last=points.at(-1);
    result.points=points;result.latest=last||null;
    if(!last)return result;
    result.dataLevel='D2';
    const recent=points.filter(p=>p.at>=last.at-60000),first=recent[0];
    const interval=finite(meta.auctionExpectedIntervalMs);
    // Cadence is a provider contract, not inferred from the surviving samples.
    const cadenceValid=Number.isSafeInteger(interval) && interval>=1000 && interval<=15000;
    const expected=cadenceValid?Math.floor(60000/interval)+1:Infinity;
    const buckets=new Set(recent.filter(p=>p.valid).map(p=>Math.round((last.at-p.at)/interval)));
    result.coverageRatio=cadenceValid?Math.min(1,buckets.size/expected):null;
    const eligible=cadenceValid && result.coverageRatio>=.9 && recent.length>=2 && first.at<=last.at-55000 && recent.every((p,i)=>p.valid && (i===0 || p.at-recent[i-1].at<=15000));
    const baselineAt=stamp(input.baselineAvailableAt);
    const baselineEvent=stamp(input.baselineEventTime),closingStart=stamp(input.date+' 14:57:00');
    const closingBaselineValid=phase!=='closing' || (Number.isFinite(baselineEvent) && baselineEvent>=closingStart-60000 && baselineEvent<closingStart && baselineAt>=baselineEvent);
    if(!eligible || !(baseline>0) || !Number.isFinite(baselineAt) || baselineAt>asOf || !closingBaselineValid || asOf-last.at>15000) {result.reason='近一分钟过程覆盖不足、时间延迟或缺少当时可用的可比基准，不能判定形态。';return result;}
    const historyByDay=new Map();
    for(const h of Array.isArray(input.history)?input.history:[]) {
      if(h && validDate(h.date) && h.date<input.date && Number.isFinite(stamp(h.availableAt)) && stamp(h.availableAt)<=asOf && h.phase===phase && h.clock===last.clock && h.code===meta.code && h.sourceId===meta.sourceId && h.qualityPassed===true &&
        ['matchedAmount','moveAbsPercent60s','gapAbsPercent','imbalanceAbs'].every(k=>finite(h[k])!==null && h[k]>=0)) {
        // Multiple entries for one day do not manufacture a larger historical sample.
        if(!historyByDay.has(h.date))historyByDay.set(h.date,h);
      }
    }
    const history=[...historyByDay.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-60);
    result.historyCount=history.length;
    if(history.length<20) {result.patternStatus='insufficient-history';result.reason='已核验过程，但同股票同阶段同一时刻的有效历史不足20日；仅展示原始指标。';return result;}
    const p=(key,q)=>percentile(history.map(h=>h[key]),q);
    const tick=finite(input.tickSize)>0?input.tickSize:.01;
    const move=(last.price/first.price-1)*100,threshold=Math.max(p('moveAbsPercent60s',.8),tick/baseline*100);
    const big=last.matchedAmount>=p('matchedAmount',.8),thin=last.matchedAmount<=p('matchedAmount',.2);
    const sign=Math.sign(last.imbalance||0);let same=0;
    for(let i=1;i<recent.length;i++)if(Math.sign(recent[i-1].imbalance||0)===sign && sign!==0)same+=recent[i].at-recent[i-1].at;
    const persistent=same/(last.at-first.at)>=.8 && Math.abs(last.imbalance||0)>=p('imbalanceAbs',.8);
    const signalAvailableAt=[...points,...history,{availableAt:input.baselineAvailableAt}].reduce((latest,p)=>stamp(p.availableAt)>stamp(latest)?p.availableAt:latest,last.availableAt);
    const add=id=>{const d=descriptions.find(r=>r.id===id);result.patterns.push({...d,at:last.time,availableAt:signalAvailableAt,
      evidence:{changePercent:last.changePercent,matchedAmount:last.matchedAmount,imbalance:last.imbalance,movePercent60s:move,historyCount:history.length}});};
    const decisive=phase==='closing' || first.clock>='09:20:00';
    const closingDisplaced=phase!=='closing' || (Math.abs(last.changePercent)>=Math.max(p('gapAbsPercent',.8),tick/baseline*100) && Math.sign(last.changePercent)===sign);
    if(decisive && big && persistent && closingDisplaced && Math.abs(move)>=threshold && Math.sign(move)===sign)add(phase==='closing'?'closing-pressure':sign>0?'sustained-buy':'sustained-sell');
    if(decisive && persistent && Math.sign(first.changePercent)!==Math.sign(last.changePercent) && Math.sign(first.imbalance)!==sign && last.matchedAmount>first.matchedAmount)add('reversal');
    if(Math.abs(last.changePercent)>=Math.max(p('gapAbsPercent',.8),tick/baseline*100) && thin)add('thin-gap');
    if(big && Math.abs(last.changePercent)<Math.max(p('gapAbsPercent',.2),tick/baseline*100) && Math.abs(last.imbalance||0)<=.1)add('balanced');
    const early=points.filter(p=>p.valid && p.clock<'09:20:00');
    if(phase==='opening' && last.clock>='09:20:00' && early.length && (Math.max(...early.map(p=>p.price))/last.price-1)*100>=threshold)add('early-retreat');
    if(last.clock>=(phase==='opening'?'09:24:00':'14:59:00') && Math.abs(move)>=threshold && last.matchedAmount>first.matchedAmount && Math.sign(first.imbalance)!==sign)add('late-change');
    result.patternStatus='research-observation';result.reason='研究规则观察，阈值未完成收益回测；没有形态触发也不代表安全或中性。';
    result.thresholds={priceMovePercent60s:threshold,largeAmount:p('matchedAmount',.8),smallAmount:p('matchedAmount',.2)};
    return result;
  }
  function chartOption(result,date) {
    const opening=result.phase!=='closing',min=stamp(date+' '+(opening?'09:15:00':'14:57:00')),max=stamp(date+' '+(opening?'09:25:00':'15:00:00'));
    const points=[];
    result.points.forEach((p,i)=>{if(i && p.at-result.points[i-1].at>15000)points.push({at:result.points[i-1].at+1});points.push(p);});
    const data=(key,factor=1)=>points.map(p=>[p.at,finite(p[key])===null?null:p[key]*factor]);
    return {animation:false,tooltip:{trigger:'axis',renderMode:'richText'},
      grid:[{left:65,right:16,top:30,height:70},{left:65,right:16,top:140,height:60},{left:65,right:16,top:245,height:60}],
      title:[{text:'参考价相对基准（%）',top:2},{text:'虚拟匹配金额（万元）',top:112},{text:'未匹配 买正 / 卖负（股）',top:217}].map(t=>({...t,textStyle:{fontSize:12,color:'#8799b3'}})),
      xAxis:[0,1,2].map(i=>({type:'time',min,max,gridIndex:i,axisLabel:{show:i===2,formatter:v=>local(v).slice(11,16),color:'#8799b3'}})),
      yAxis:[0,1,2].map(i=>({type:'value',gridIndex:i,scale:true,axisLabel:{color:'#8799b3'},splitLine:{lineStyle:{color:'#8799b322'}}})),
      series:[{name:'参考价相对基准（%）',type:'line',data:data('changePercent'),connectNulls:false,showSymbol:false,
        markPoint:{symbol:'pin',symbolSize:38,label:{show:true,formatter:'观察',fontSize:10},
          data:result.patterns.map(p=>({name:p.label,coord:[stamp(p.availableAt),p.evidence.changePercent],value:p.label})),
          tooltip:{formatter:p=>p.name+'\n研究规则观察；位置为数据实际可用时间，非买卖指令。'}},
        markLine:{silent:true,symbol:'none',data:[{yAxis:0},...(opening?[{xAxis:stamp(date+' 09:20:00'),label:{formatter:'09:20 不可撤'}}]:[])]}},
        {name:'虚拟匹配金额（万元，非累计成交）',type:'line',xAxisIndex:1,yAxisIndex:1,data:data('matchedAmount',.0001),connectNulls:false,showSymbol:false},
        {name:'未匹配买量',type:'bar',xAxisIndex:2,yAxisIndex:2,data:data('unmatchedBuy'),itemStyle:{color:'#ef4444'}},
        {name:'未匹配卖量',type:'bar',xAxisIndex:2,yAxisIndex:2,data:data('unmatchedSell',-1),itemStyle:{color:'#10b981'}}]};
  }
  return {analyze,descriptions,chartOption};
});
