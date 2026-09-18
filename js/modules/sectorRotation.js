(function(root,factory) {
  const api=factory(root ? root.EastmoneyDarkRank : require('./eastmoneyDarkRank'));
  if(typeof module==='object' && module.exports) module.exports=api;
  if(root) {
    root.SectorRotation=api.createRotationView({document:root.document,fetch:root.fetch.bind(root),echarts:root.echarts});
    root.SectorRotation.bind();
    root.setInterval(()=>{
      if(!root.document.hidden && root.State && root.State.currentMainView==='capitalFlow') root.SectorRotation.run();
    },60000);
    root.addEventListener('resize',()=>root.SectorRotation.resize());
  }
})(typeof window==='undefined'?null:window,function(moneyHelper) {
  const escape=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>moneyHelper.formatMoney(v);
  const color=v=>v==null?'neutral':Number(v)>0?'up':Number(v)<0?'down':'neutral';
  const yuan=v=>typeof v==='number' && Number.isFinite(v)?money(String(Math.round(v*100))):'--';
  const pct=v=>typeof v==='number' && Number.isFinite(v)?(v>0?'+':'')+(v*100).toFixed(2)+'%':'--';
  const time=v=>v?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'--';
  function renderRows(rows) {
    return rows.slice(0,50).map((r,i)=>'<tr><td><button type="button" data-rotation-code="'+escape(r.code)+'">'+(i+1)+'. '+escape(r.name)+'</button><small>'+escape(r.state)+(r.divergence?' · 明暗反向':'')+'</small></td>'+
      '<td class="rotation-'+color(r.deltaCents)+'"><strong>'+money(r.deltaCents)+'</strong></td>'+
      '<td class="rotation-'+color(r.speedYuanPerMinute)+'">'+yuan(r.speedYuanPerMinute)+'<small>/ 分钟</small></td>'+
      '<td class="rotation-'+color(r.speedChange)+'">'+yuan(r.speedChange)+'<small>/ 分钟</small></td></tr>').join('');
  }
  function chartOption(points) {
    const moneyData=[],priceData=[];
    points.forEach((p,i)=>{
      const t=Date.parse(p.at),prev=points[i-1];
      if(prev && (p.phase!==prev.phase || t-Date.parse(prev.at)>150000)) {
        moneyData.push([Date.parse(prev.at)+1,null]);priceData.push([Date.parse(prev.at)+1,null]);
      }
      moneyData.push([t,p.cumulativeCents==null?null:Number(p.cumulativeCents)/10000000000]);
      priceData.push([t,p.changeRatio==null?null:p.changeRatio*100]);
    });
    return {animation:false,legend:{data:['累计模型净额（亿元）','板块涨跌幅（%）'],textStyle:{color:'#8799b3'}},
      tooltip:{trigger:'axis',renderMode:'richText'},grid:{left:65,right:65,top:45,bottom:45},
      xAxis:{type:'time',axisLabel:{color:'#8799b3',formatter:v=>new Date(v).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false,hour:'2-digit',minute:'2-digit'})}},
      yAxis:[{type:'value',scale:true,axisLabel:{color:'#8799b3'},splitLine:{lineStyle:{color:'#8799b322'}}},
        {type:'value',scale:true,axisLabel:{formatter:'{value}%',color:'#8799b3'},splitLine:{show:false}}],
      series:[{name:'累计模型净额（亿元）',type:'line',data:moneyData,connectNulls:false,showSymbol:points.length<2,lineStyle:{color:'#4f8eff',width:2.5}},
        {name:'板块涨跌幅（%）',type:'line',yAxisIndex:1,data:priceData,connectNulls:false,showSymbol:points.length<2,lineStyle:{color:'#d8a84e',width:2}}]};
  }
  function createRotationView(options) {
    const el=id=>options.document.getElementById(id);
    let bound=false,generation=0,memberGeneration=0,dailyGeneration=0,busy=false,data=null,selected='',chart=null;
    const requests=new Set();
    async function request(url,init) {
      const controller=new AbortController();let timer,cancel;
      const deadline=new Promise((_,reject)=>{
        cancel=()=>{controller.abort();reject(Error('请求已取消'));};
        timer=setTimeout(()=>{controller.abort();reject(Error('请求超时，请稍后重试；后台采样可能仍在继续。'));},options.timeoutMs||20000);
      });
      requests.add(cancel);
      try {
        return await Promise.race([(async()=>{const response=await options.fetch(url,{...init,signal:controller.signal});
          const payload=await response.json();if(!response.ok)throw Error('服务暂不可用，请稍后重试');return payload;})(),deadline]);
      } finally {clearTimeout(timer);requests.delete(cancel);}
    }
    function cancelRequests() {for(const cancel of requests)cancel();}
    const input=()=>({scope:el('rotationScope').value,minutes:Number(el('rotationMinutes').value),metric:el('rotationMetric').value,...(selected?{code:selected}:{}),
      ...(el('rotationDate')?.value?{date:el('rotationDate').value,...(el('rotationTime')?.value?{at:el('rotationTime').value.slice(0,5)+':00'}:{})}:{})});
    function invalidate() {
      generation++;memberGeneration++;dailyGeneration++;busy=false;data=null;selected='';
      cancelRequests();el('rotationRefresh').disabled=false;
      if(el('rotationDailyLoad'))el('rotationDailyLoad').disabled=false;
      if(el('rotationDailyRows'))el('rotationDailyRows').innerHTML='';
      if(el('rotationDailyStatus'))el('rotationDailyStatus').textContent='条件已切换，请查询所选日期与分类的日榜。';
      el('rotationIn').innerHTML='';el('rotationOut').innerHTML='';el('rotationBoard').innerHTML='<option value="">选择板块查看曲线</option>';
      el('rotationDetail').hidden=true;if(chart) chart.clear();
      el('rotationStatus').textContent='正在读取新条件；不足的时段不会补零。';
    }
    function draw() {
      const acceleration=el('rotationSort').value==='acceleration';
      el('rotationInTitle').textContent=acceleration?'净额速度提升最快':'区间净额增加最多';
      el('rotationOutTitle').textContent=acceleration?'净额速度下降最快':'区间净额减少最多';
      const incoming=acceleration?data.accelerating:data.inflow,outgoing=acceleration?data.decelerating:data.outflow;
      const empty='<tr><td colspan="4" class="rotation-empty">'+(data.eligible?(acceleration?'暂无符合方向的速度变化；前窗不足不参与排序。':'暂无符合方向的板块；净额不变不参与排序。'):el('rotationDate')?.value?'所选历史没有有效盘中窗口；可展开历史日榜，但不能代替分钟回放。':data.collector.sessionOpen?'正在积累连续样本，或存在断流；不是资金为零。':'未形成有效盘中窗口；盘后等待或重复刷新不会补出盘中历史。可展开历史日榜。')+'</td></tr>';
      el('rotationIn').innerHTML=renderRows(incoming)||empty;el('rotationOut').innerHTML=renderRows(outgoing)||empty;
      el('rotationBoard').innerHTML='<option value="">全部 '+data.total+' 个板块 · 选择查看</option>'+data.rows.map(r=>'<option value="'+escape(r.code)+'">'+escape(r.name)+' · 累计 '+money(r.cumulativeCents)+'</option>').join('');
      el('rotationBoard').value=selected;
      const detail=data.detail;
      el('rotationDetail').hidden=!detail;
      if(detail) {
        el('rotationDetailTitle').textContent=detail.name+' · '+detail.code;
        el('rotationDetailMetrics').innerHTML=[['区间净额变化',money(detail.deltaCents)],['平均变化速度',yuan(detail.speedYuanPerMinute)+' / 分钟'],
          ['暗盘活跃度（供应商原指标）',pct(detail.darkActivityRatio)],['板块涨跌幅',pct(detail.changeRatio)]]
          .map(([label,value])=>'<article><span>'+label+'</span><strong>'+value+'</strong></article>').join('');
        el('rotationDetailTime').textContent=(detail.startAt?'区间：'+time(detail.startAt)+' → '+time(detail.endAt)+'；实际 '+detail.elapsedMinutes.toFixed(1)+' 分钟。':'窗口样本不足。')+' 曲线横轴为本机采样时间，不是源行情事件时间。';
        if(options.echarts) {
          if(!chart) chart=options.echarts.init(el('rotationChart'));
          chart.setOption(chartOption(detail.series||[]),true);chart.resize();
        }
      }
    }
    async function run(refresh=false) {
      if(busy) return;
      busy=true;el('rotationRefresh').disabled=true;const ticket=++generation,q=input();
      if(q.date)refresh=false;
      try {
        const payload=await request('/api/capital-flow/rotation'+(refresh?'/refresh':'')+'?'+new URLSearchParams(q),refresh?{method:'POST'}:undefined);
        if(ticket!==generation) return;
        if(!payload.success) throw Error(payload.error && payload.error.message || '读取失败');
        const r=payload.data;
        if(!r || r.scope!==q.scope || r.minutes!==q.minutes || r.metric!==q.metric || q.date && r.date!==q.date || !r.collector ||
          !['rows','inflow','outflow','accelerating','decelerating'].every(key=>Array.isArray(r[key])) ||
          r.detail && r.detail.code!==q.code) throw Error('返回结果与条件不一致');
        data=r;draw();
        if(el('rotationDate') && Array.isArray(r.availableDates)) {
          el('rotationDate').innerHTML='<option value="">最新记录</option>'+r.availableDates.map(d=>'<option value="'+escape(d)+'">'+escape(d)+'</option>').join('');
          el('rotationDate').value=q.date||'';
        }
        if(el('rotationTime'))el('rotationTime').disabled=!q.date;
        el('rotationRefresh').textContent=q.date?'读取本机回放':'立即采样 / 刷新';
        const errors=Object.values(r.collector.errors||{}).join('；');
        el('rotationStatus').textContent=(r.displayMode==='historical-window'?'历史盘中窗口 · 截至 '+time(r.windowEndAt)+' · ':r.stale?'旧样本 / 尚未更新 · ':'')+(r.date||'尚无采样')+' · 有效窗口 '+r.eligible+' / '+r.total+' 板块 · 已存 '+r.sampleCount+' 次采样 · 最新日榜采集 '+time(r.receivedAt)+' 北京时间'+
          (errors?' · '+errors:'')+(r.historyWarning?' · '+r.historyWarning:'')+(r.eligible?'':q.date?' · 所选历史未形成有效盘中窗口；没有用日榜补齐。':r.collector.sessionOpen?' · 连续采样需约 '+q.minutes+' 分钟；速度变化需约 '+(q.minutes*2)+' 分钟。':' · 当前非连续交易时段，未形成有效盘中窗口；不会用盘后样本补齐。');
        el('rotationCollector').textContent=!r.collector.enabled?'后台自动采样已关闭，可手动采样':r.collector.running===false?'后台采样尚未启动，可手动采样；请使用新版程序启动后台。':r.collector.sessionOpen?'后台每 60 秒采样，切换页面不影响；源更新时钟未知。':'当前非连续交易时段，后台暂停采样，保留记录。完全退出程序或电脑休眠后不采集。';
      } catch(e) {if(ticket===generation) el('rotationStatus').textContent=(data?'更新失败，以下为旧数据。':'暂无可用结果。')+(e instanceof TypeError?'网络或返回数据异常，请稍后重试。':e.message);}
      finally {if(ticket===generation){busy=false;el('rotationRefresh').disabled=false;}}
    }
    async function focus(code) {
      if(!/^BK\d{4}$/.test(code)) return;
      generation++;cancelRequests();busy=false;selected=code;const ticket=++memberGeneration,scope=input().scope;
      el('rotationDetail').hidden=true;if(chart)chart.clear();
      el('rotationMembers').textContent='正在读取成分股（普通主力资金口径，不是明暗盘贡献分解）…';
      await run();
      if(ticket!==memberGeneration) return;
      if(!data?.detail || data.detail.code!==code) {el('rotationDetail').hidden=true;return;}
      if(input().date || data.date!==new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'})) {el('rotationMembers').textContent='历史成分与对应明暗盘贡献尚未取得，不展示当前成分股冒充历史。';return;}
      try {
        const [members,watch]=await Promise.all([
          request('/api/market/boards/constituents?'+new URLSearchParams({code,taxonomy:scope})),
          request('/api/portfolio/watchlist').catch(()=>null)]);
        if(ticket!==memberGeneration) return;
        if(!members.success || !members.data || members.data.stale || !Array.isArray(members.data.items)) throw Error('unavailable');
        const watched=new Set(watch && watch.success && Array.isArray(watch.data)?watch.data.map(r=>r.code):[]);
        const items=members.data.items.filter(r=>r.status!=='unavailable').sort((a,b)=>Math.abs(b.netFlow||0)-Math.abs(a.netFlow||0));
        el('rotationMembers').innerHTML='<p>成分股普通主力净额（当日累计，非本窗口明暗盘贡献） · '+escape(members.data.provider)+' · 采集 '+escape(time(members.data.fetchedAt))+
          (members.data.coverageComplete?'':' · 部分覆盖')+(watch && watch.success?'':' · 自选关联暂不可用')+'</p><div class="rotation-member-grid">'+items.slice(0,30).map(r=>
          '<article><strong>'+escape(r.name)+(watched.has(r.code)?' ★ 自选':'')+'</strong><span>'+escape(r.code)+' · '+pct(r.changePct==null?null:r.changePct/100)+'</span><b class="rotation-'+color(r.netFlow)+'">'+yuan(r.netFlow)+'</b></article>').join('')+'</div>'+
          (items.length?'':'成分股行情暂不可用；未补零。');
      } catch(_) {if(ticket===memberGeneration)el('rotationMembers').textContent='成分股数据暂不可用；板块采样曲线保留。未用其他口径补齐。';}
    }
    async function daily() {
      const ticket=++dailyGeneration,q={date:el('rotationDailyDate').value,scope:input().scope};
      el('rotationDailyLoad').disabled=true;el('rotationDailyStatus').textContent='正在核对全分页历史日榜；不会写入盘中采样…';
      try {
        const payload=await request('/api/capital-flow/rotation/daily/refresh?'+new URLSearchParams(q),{method:'POST'});
        if(ticket!==dailyGeneration)return;
        if(!payload.success || payload.data?.date!==q.date || payload.data?.scope!==q.scope)throw Error('历史日榜返回条件不一致');
        const result=payload.data,s=result.snapshot;
        el('rotationDailyRows').innerHTML=s?s.rows.map(r=>'<tr><td>'+escape(r.name)+'<small>'+escape(r.code)+'</small></td>'+['darkNetCents','visibleNetCents','combinedNetCents'].map(key=>
          '<td class="rotation-'+color(r[key])+'"><strong>'+money(r[key])+'</strong></td>').join('')+'</tr>').join(''):'';
        el('rotationDailyStatus').textContent=(result.refreshFailed?'更新失败，保留缓存 · ':'')+(s?q.date+' · '+s.rows.length+' 个板块 · 抓取 '+time(s.retrievedAt)+(s.provisional?' · 盘中未定稿':''):'该日期暂无缓存，可稍后重试')+'。日榜不是分钟历史，模型可能修订，抓取时间不是行情时间。';
      } catch(e) {if(ticket===dailyGeneration)el('rotationDailyStatus').textContent='日榜读取失败：'+e.message;}
      finally {if(ticket===dailyGeneration)el('rotationDailyLoad').disabled=false;}
    }
    function bind() {
      if(bound || !el('rotationScope')) return;bound=true;
      el('rotationScope').value='industry';el('rotationMinutes').value='5';el('rotationMetric').value='combined';el('rotationSort').value='speed';
      ['rotationScope','rotationMinutes','rotationMetric'].forEach(id=>el(id).addEventListener('change',()=>{invalidate();run();}));
      ['rotationDate','rotationTime'].forEach(id=>{if(el(id))el(id).addEventListener('change',()=>{invalidate();run();});});
      if(el('rotationDailyDate')) {el('rotationDailyDate').value=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
        el('rotationDailyDate').addEventListener('change',()=>{dailyGeneration++;el('rotationDailyRows').innerHTML='';el('rotationDailyLoad').disabled=false;el('rotationDailyStatus').textContent='日期已改变，请查询所选日榜。';});}
      if(el('rotationDailyLoad'))el('rotationDailyLoad').addEventListener('click',daily);
      el('rotationSort').addEventListener('change',()=>{if(data)draw();});
      el('rotationRefresh').addEventListener('click',()=>run(true));
      el('rotationBoard').addEventListener('change',()=>focus(el('rotationBoard').value));
      ['rotationIn','rotationOut'].forEach(id=>el(id).addEventListener('click',event=>{
        const button=event.target.closest('[data-rotation-code]');if(button)focus(button.dataset.rotationCode);
      }));
    }
    return {bind,run,focus,invalidate,resize:()=>{if(chart)chart.resize();}};
  }
  return {renderRows,chartOption,createRotationView};
});
