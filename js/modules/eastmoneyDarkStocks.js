(function(root,factory) {
  const api=factory(root ? root.EastmoneyDarkRank : require('./eastmoneyDarkRank'));
  if(typeof module==='object' && module.exports) module.exports=api;
  if(root) {
    const view=api.createDarkStockView({document:root.document,fetch:root.fetch.bind(root),echarts:root.echarts,chartTheme:root.ChartTheme});
    root.EastmoneyDarkStocks=view;
    let timer=null,busy=false,queued=false,queuedForce=false,lastView='';
    async function sync(force=false) {
      if(busy) {queued=true;queuedForce=queuedForce || force;return;}
      clearTimeout(timer);
      const active=root.State && root.State.currentMainView;
      const homeDetail=active==='dashboard' && root.document.getElementById('homeStockMore')?.open;
      if(root.document.hidden || (!homeDetail && !['capitalFlow','market','watchlist','portfolio'].includes(active))) return;
      busy=true;
      try {
        const response=await root.fetch('/api/capital-flow/dark-session');
        const payload=await response.json();
        if(!response.ok || !payload.success) throw Error('交易时段状态暂不可用');
        if(root.document.hidden || active!==root.State.currentMainView) return;
        if(active==='capitalFlow') await root.EastmoneyDarkRank.autoTick(payload.data,active!==lastView);
        else await view.load(payload.data,homeDetail?'market':active,force);
        lastView=active;
      } catch (_) {view.status('明暗盘更新失败，请手动重试；未显示为零。');}
      finally {
        busy=false;
        const nextForce=queuedForce;
        timer=setTimeout(()=>sync(nextForce),queued?0:active==='capitalFlow'?60000:view.refreshDelay());queued=false;queuedForce=false;
      }
    }
    root.EastmoneyDarkStocks.sync=sync;
    root.document.addEventListener('visibilitychange',()=>sync());
    ['detailDarkStockRefresh','watchlistDarkStockRefresh','portfolioDarkStockRefresh'].forEach(id=>{
      const button=root.document.getElementById(id);if(button) button.addEventListener('click',()=>sync(true));
    });
    const historyButton=root.document.getElementById('detailDarkHistoryRefresh');
    if(historyButton)historyButton.addEventListener('click',()=>view.history());
    const historyDate=root.document.getElementById('detailDarkHistoryDate');
    if(historyDate)historyDate.addEventListener('change',()=>view.history());
  }
})(typeof window!=='undefined'?window:null,function(shared) {
  const escape=value=>String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const time=value=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
  function stockKey(stock) {
    if(!stock || stock.isIndex || [stock.type,stock.kind,stock.instrumentType].includes('index')) return null;
    let code=String(stock.code || '').toLowerCase();
    const prefix=/^(sh|sz|bj)/.exec(code);
    if(prefix) code=code.slice(2);
    if(!/^[034689]\d{5}$/.test(code)) return null;
    const inferred=code[0]==='6'?'sh':/^[03]/.test(code)?'sz':'bj';
    const market=prefix ? prefix[1] : stock.market==null ? inferred : ({0:'sz',1:'sh',SH:'sh',SZ:'sz',BJ:'bj'}[stock.market] || String(stock.market).toLowerCase());
    return market===inferred ? market+code : null;
  }
  function stockCell(stock,content='等待榜单匹配…') {
    const key=stockKey(stock);
    return key?'<div class="dark-stock-cell" data-dark-stock="'+key+'">'+content+'</div>':'<span class="muted">暂无对应 A 股榜单</span>';
  }
  function renderStock(row,data,detail=false) {
    if(!row) return '<span class="muted">榜单未匹配（不是零）</span>';
    function amount(label,value) {
      const sign=value==null?'neutral':BigInt(value)>0n?'up':BigInt(value)<0n?'down':'neutral';
      return '<div><span>'+label+'</span><strong class="dark-rank-'+sign+'">'+shared.formatMoney(value)+'</strong></div>';
    }
    const activity=typeof row.darkActivityRatio==='number'?(row.darkActivityRatio*100).toFixed(2)+'%':'--';
    let relation='数据不足';
    if(row.darkNetCents!==null && row.visibleNetCents!==null) {
      const a=BigInt(row.darkNetCents),b=BigInt(row.visibleNetCents);
      relation=a===0n || b===0n?'一侧为零':(a>0n)===(b>0n)?'明暗同向':'明暗反向';
    }
    const comparison=data.comparisons && data.comparisons[row.key];
    let comparisonHtml='<small>暂无两次可比采集，暂不判断净额变化。</small>';
    if(comparison && ['darkNetChangeCents','visibleNetChangeCents'].every(field=>/^-?\d+$/.test(comparison[field]||''))) {
      const minutes=Math.round((Date.parse(comparison.toAt)-Date.parse(comparison.fromAt))/60000);
      if(Number.isFinite(minutes) && minutes>0) {
        function change(label,value) {
          const amount=BigInt(value),direction=amount>0n?'增加':amount<0n?'减少':'不变';
          const tone=amount>0n?'up':amount<0n?'down':'neutral';
          return '<div><span>'+label+'较前次</span><strong class="dark-rank-'+tone+'">'+direction+' '+shared.formatMoney(value)+'</strong></div>';
        }
        comparisonHtml='<div class="dark-stock-amounts dark-stock-changes">'+change('暗盘',comparison.darkNetChangeCents)+change('明盘',comparison.visibleNetChangeCents)+'</div>'+
          '<small>两次实际采集相隔 '+minutes+' 分钟；净额差不是该时段成交资金。</small>';
      }
    }
    return (detail?'<h4>'+escape(row.name)+' · '+escape(row.code)+'</h4>':'')+
      '<div class="dark-stock-amounts">'+amount('暗盘净额',row.darkNetCents)+amount('明盘净额',row.visibleNetCents)+(detail?amount('合计净额',row.combinedNetCents):'')+'</div>'+
      comparisonHtml+
      '<small>活跃度 '+activity+' · '+relation+(row.reconciled===false?' · 合计待核验':'')+'</small>'+
      '<small>'+escape(data.tradingDay)+(data.stale?' · 旧快照':'')+(data.refreshing?' · 后台更新中':'')+'</small>'+
      (detail?'<small>东方财富模型估算 · 采集 '+escape(time(row.receivedAt))+' 北京时间；不是行情事件时间。</small>':'');
  }
  function createDarkStockView(options) {
    const doc=options.document,now=options.now || Date.now,el=id=>doc.getElementById(id);
    let selected=null,generation=0,data=null,loadedAt=0,pendingKey='',viewName='market',historySequence=0,historyChart=null,refreshFollowupUntil=0;
    const refreshDelay=()=>data?.refreshing && now()<refreshFollowupUntil?5000:60000;
    const statusId=()=>viewName==='watchlist'?'watchlistDarkStockStatus':viewName==='portfolio'?'portfolioDarkStockStatus':'detailDarkStockStatus';
    function status(message) {const node=el(statusId());if(node) node.textContent=message;}
    function rootBox(view) {return el(view==='watchlist'?'watchlistTbody':'positionsTbody');}
    function cells(view) {const box=rootBox(view);return box?Array.from(box.querySelectorAll('[data-dark-stock]')):[];}
    function draw(view) {
      if(view==='market') {
        const box=el('detailDarkStockData');
        if(box) box.innerHTML=selected ? data?renderStock(data.rows.find(r=>r.key===selected),data,true):'正在读取对应股票的明暗盘数据…' : '仅支持 A 股个股，不把指数或 ETF 当作股票匹配。';
      } else cells(view).forEach(cell=>{
        const key=cell.getAttribute('data-dark-stock');
        cell.innerHTML=data?(data.rows.some(r=>r.key===key) || data.missing.includes(key) ? renderStock(data.rows.find(r=>r.key===key),data) : '尚未查询，请缩小分组后刷新'):'等待榜单匹配…';
        cell.title=data?'东方财富模型估算；采集 '+time(data.receivedAt)+' 北京时间，不是行情时间。':'';
      });
    }
    function select(stock) {
      const key=stockKey(stock);
      if(key!==selected) {
        selected=key;generation++;pendingKey='';historySequence++;
        if(historyChart) {historyChart.dispose();historyChart=null;}
        const hint=el('detailDarkHistoryStatus');if(hint)hint.textContent='已切换股票，点击读取本机历史。';
        const date=el('detailDarkHistoryDate');if(date)date.innerHTML='<option value="">最近记录</option>';
      }
      draw('market');
    }
    async function history() {
      const hint=el('detailDarkHistoryStatus'),date=el('detailDarkHistoryDate'),box=el('detailDarkHistoryChart');
      if(!selected || !hint || !box)return;
      const key=selected,ticket=++historySequence,controller=new AbortController();
      const deadline=setTimeout(()=>controller.abort(),10000);
      hint.textContent='正在读取本机历史…';
      try {
        const response=await options.fetch('/api/capital-flow/dark-stock-history?code='+encodeURIComponent(key)+(date?.value?'&date='+encodeURIComponent(date.value):''),{signal:controller.signal});
        const payload=await response.json();if(ticket!==historySequence || selected!==key)return;
        if(!response.ok || !payload.success || payload.data?.code!==key)throw Error('历史读取失败');
        const historyData=payload.data,points=historyData.points || [];
        if(date)date.innerHTML='<option value="">最近记录</option>'+historyData.availableDates.map(day=>'<option value="'+escape(day)+'"'+(day===historyData.tradingDay?' selected':'')+'>'+escape(day)+'</option>').join('');
        if(historyChart){historyChart.dispose();historyChart=null;}
        hint.textContent=(historyData.tradingDay || '')+' · '+points.length+' 个实际观察点 · '+(historyData.warning || historyData.note);
        box.textContent=points.length?'':'该股该日尚无本机历史记录；不是资金为零。';
        if(points.length && options.echarts){
          const rows=[];
          points.forEach((point,index)=>{
            const previous=points[index-1];
            if(previous && (Date.parse(point.receivedAt)-Date.parse(previous.receivedAt)>600000 || point.sourceKey!==previous.sourceKey))rows.push(null);
            rows.push(point);
          });
          historyChart=options.echarts.init(box);
          const option={animation:false,legend:{data:['暗盘净额','明盘净额']},grid:{left:58,right:18,top:38,bottom:55},tooltip:{trigger:'axis'},
            xAxis:{type:'category',name:'采集时刻',data:rows.map(row=>row?time(row.receivedAt):'断采')},yAxis:{type:'value',name:'万元'},
            series:[['暗盘净额','darkNetCents','#9b7aff'],['明盘净额','visibleNetCents','#27a6c8']].map(([name,field,color])=>({name,type:'line',connectNulls:false,showSymbol:points.length<20,lineStyle:{color},itemStyle:{color},data:rows.map(row=>row?Number(row[field])/1000000:null)}))};
          if(options.chartTheme)options.chartTheme.applyToOption(option,{dark:doc.body.classList.contains('dark')});
          historyChart.setOption(option);
        }
      }catch(_){if(ticket===historySequence)hint.textContent='历史读取未成功；请稍后重试，已保存记录未删除。';}
      finally{clearTimeout(deadline);}
    }
    function cell(stock) {
      const key=stockKey(stock),row=data && data.rows.find(r=>r.key===key);
      return stockCell(stock,data && (row || data.missing.includes(key)) ? renderStock(row,data) : undefined);
    }
    async function load(session,view,force=false) {
      if(doc.hidden || !['market','watchlist','portfolio'].includes(view)) return;
      viewName=view;
      if(!session.dataDate) {data=null;draw(view);status(session.reason);return;}
      if(data && data.tradingDay!==session.dataDate) {data=null;generation++;}
      const allKeys=view==='market'?(selected?[selected]:[]):[...new Set(cells(view).map(c=>c.getAttribute('data-dark-stock')))];
      const keys=allKeys.slice(0,200);
      if(!keys.length) {draw(view);return;}
      draw(view);
      const covered=data && keys.every(key=>data.rows.some(r=>r.key===key) || data.missing.includes(key));
      const followup=data?.refreshing && now()<refreshFollowupUntil;
      // A hidden tab can outlive the fast window. Finish reading the already
      // started refresh at the normal cadence, including after the close.
      const cacheTtl=data?.refreshing?(followup?5000:60000):300000;
      if(!force && covered && (now()-loadedAt<cacheTtl || !session.pollAllowed && !data.refreshing)) {
        status((data.refreshing?'后台更新中，保留已标注日期的快照 · ':data.stale?'旧快照，更新未成功 · ':'')+data.tradingDay+' · '+(session.pollAllowed?'个股快照每 5 分钟更新':session.reason)+' · 采集 '+time(data.receivedAt)+' 北京时间');return;
      }
      const requestKey=JSON.stringify([session.dataDate,view,keys]);
      if(pendingKey===requestKey) return;
      pendingKey=requestKey;
      const ticket=++generation;
      status(data?'正在更新，暂保留已标注日期的快照…':'首次正在逐页匹配东方财富榜单，通常需 20–45 秒；各股票共用缓存。');
      try {
        const response=await options.fetch('/api/capital-flow/dark-stocks?codes='+encodeURIComponent(keys.join(','))+(force?'&force=1':''));
        const payload=await response.json();
        if(ticket!==generation) return;
        if(!response.ok || !payload.success) throw Error('明暗盘读取失败');
        const next=payload.data;
        if(!next || next.tradingDay!==session.dataDate || !Array.isArray(next.rows) || !Array.isArray(next.missing) || next.rows.some(r=>!keys.includes(r.key))) throw Error('明暗盘日期或股票不匹配');
        if(next.refreshing && !data?.refreshing) refreshFollowupUntil=now()+60000;
        if(!next.refreshing) refreshFollowupUntil=0;
        data=next;loadedAt=now();draw(view);
        status((data.refreshing?'后台更新中，暂显示旧快照 · ':data.stale?'旧快照 · ':'')+data.tradingDay+' · 采集 '+time(data.receivedAt)+' 北京时间 · 每 5 分钟检查（非逐秒行情）'+(data.coverage.complete?'':' · 分页覆盖不完整')+(allKeys.length>200?' · 本组仅显示前 200 只，请缩小分组':'')+' · 休市/页面隐藏暂停'+(data.historyWarning?' · '+data.historyWarning:''));
      } catch (_) {
        if(ticket!==generation) return;
        if(data) {data={...data,stale:true};draw(view);}
        else {if(view==='market') el('detailDarkStockData').textContent='数据暂不可用（不是零）';else cells(view).forEach(cell=>{cell.textContent='暂不可用（不是零）';});}
        status('明暗盘更新失败。'+(data?'保留旧快照：'+data.tradingDay+'，采集 '+time(data.receivedAt)+' 北京时间。':'未使用普通资金替代，请稍后重试。'));
      } finally {if(ticket===generation) pendingKey='';}
    }
    return {select,load,status,cell,history,refreshDelay};
  }
  return {stockKey,stockCell,renderStock,createDarkStockView};
});
