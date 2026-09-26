(function(root) {
  let bound=false, pending=null, generation=0, last=null, sectors=null, attemptedAt=0, followsDate=true, view='stocks', capTimer=null, capRetries=0, refreshFollowupUntil=0;
  const el=id=>root.document.getElementById(id);
  const esc=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=value=>value==null?'—':root.EastmoneyDarkRank.formatMoney(value);
  const pct=value=>value==null?'—':(value*100).toFixed(3)+'%';
  const time=value=>value ? root.WebStockTime.formatDateTime(value) : '未提供';
  const tone=value=>value==null?'':Number(value)>0?'pnl-up':Number(value)<0?'pnl-down':'';
  function summarize(rows) {
    let inflow=0n,outflow=0n,missing=0;
    rows.forEach(row=>{const raw=row.combinedNetCents;if(raw==null || row.reconciled===false){missing++;return;}const n=BigInt(raw);if(n>0n)inflow+=n;else outflow+=n;});
    return {inflow:String(inflow),outflow:String(outflow),net:String(inflow+outflow),missing};
  }
  function bars(row,max) {
    return [['暗','darkNetCents'],['明','visibleNetCents']].map(([label,key])=>{
      const n=Number(row[key]),width=row[key]==null?0:Math.abs(n)/max*49;
      return '<div class="dark-flow-bar '+(key==='visibleNetCents'?'visible':'')+'"><span>'+label+'</span><span class="dark-flow-track"><i style="left:'+(n>=0?50:50-width)+'%;width:'+width+'%;background:var(--'+(n>=0?'up':'down')+')"></i></span><b class="'+tone(row[key])+'">'+money(row[key])+'</b></div>';
    }).join('');
  }
  function renderRows(rows,max) {
    return rows.map((row,i)=>'<article class="dark-flow-row"><div class="dark-flow-name"><button type="button" data-dark-board-stock="'+esc(row.key)+'">'+(i+1)+'. '+esc(row.name)+'</button><small>'+esc(row.code)+' · '+(row.changeRatio==null?'涨跌 —':pct(row.changeRatio))+'</small><small>暗 / 市值 '+pct(row.darkMarketCapRatio)+'</small></div><div class="dark-flow-bars">'+bars(row,max)+'</div><div class="dark-flow-result"><small>明暗合计'+(row.reconciled===false?' · 待核对':'')+'</small><strong class="'+tone(row.combinedNetCents)+'">'+money(row.combinedNetCents)+'</strong><small>活跃度 '+pct(row.darkActivityRatio)+'</small></div></article>').join('') || '<p class="reading-empty">当前范围没有符合条件的记录。</p>';
  }
  function render() {
    el('darkBoardColumns').hidden=view!=='stocks';el('darkBoardSectors').hidden=view!=='sectors';
    root.document.querySelectorAll('[data-dark-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.darkView===view)));
    el('darkBoardLimit').disabled=view!=='stocks';el('darkBoardMetric').disabled=view!=='stocks';
    if(view==='sectors'){renderSectors();return;}
    if(!last)return;
    const limit=Number(el('darkBoardLimit').value),max=Math.max(1,...last.rows.flatMap(row=>[Math.abs(Number(row.darkNetCents)),Math.abs(Number(row.visibleNetCents))]));
    for(const [id,rows] of [['In',last.inflow],['Out',last.outflow]]) {
      const node=el('darkBoard'+id),scroll=node.scrollTop;
      node.innerHTML=renderRows(rows.slice(0,limit),max);node.scrollTop=scroll;
      el('darkBoard'+id+'Count').textContent='显示 '+Math.min(limit,rows.length)+' / '+rows.length+' 只';
    }
    const sum=summarize(last.rows),c=last.coverage;
    el('darkBoardSummary').innerHTML=[['净流入股票合计',sum.inflow],['净流出股票合计',sum.outflow],['明暗综合净额',sum.net]].map(([label,n])=>'<div><small>'+label+'</small><strong class="'+tone(n)+'">'+money(n)+'</strong></div>').join('')+'<div><small>个股覆盖</small><strong>'+last.rows.length+' / '+esc(c.totalReported)+' 只</strong><small>'+sum.missing+' 条合计缺失或待核对</small></div>';
    el('darkBoardStatus').textContent='数据 '+last.tradingDay+' · 采集 '+time(last.receivedAt)+(last.capLoading?' · 市值补充中': ' · 市值比例缺失 '+last.ratioMissing)+(last.refreshing?' · 后台更新中，保留上次结果':last.stale?' · 保留上次结果，更新未完成':'');
  }
  function renderSectors() {
    if(!sectors){el('darkBoardSectors').innerHTML='<p class="reading-empty">正在读取行业明暗资金排行…</p>';el('darkBoardSummary').innerHTML='';return;}
    const rows=sectors.rows.slice().sort((a,b)=>a.combinedNetCents==null?1:b.combinedNetCents==null?-1:Number(b.combinedNetCents)-Number(a.combinedNetCents));
    const top=rows.find(row=>row.combinedNetCents!=null && row.reconciled!==false && Number(row.combinedNetCents)>0);
    el('darkBoardSummary').innerHTML='<div><small>当前已读行业中净流入最多</small><strong>'+esc(top?.name || '暂无净流入')+'</strong></div><div><small>明暗合计净额</small><strong class="'+tone(top?.combinedNetCents)+'">'+money(top?.combinedNetCents)+'</strong></div><div><small>行业覆盖</small><strong>'+rows.length+' / '+sectors.total+' 个</strong></div><div><small>数据日期</small><strong>'+esc(sectors.date)+'</strong></div>';
    el('darkBoardStatus').textContent='行业来源：东方财富明暗盘 · 采集 '+time(sectors.receivedAt)+(rows.length<sectors.total?' · 尚有未读行业':' · 已读全部报告行业');
    el('darkBoardSectors').innerHTML='<table><thead><tr><th>行业</th><th>暗盘净额</th><th>明盘净额</th><th>明暗合计</th><th>净流入股占比</th><th>领涨股</th></tr></thead><tbody>'+rows.map((r,i)=>'<tr><td>'+(i+1)+'. '+esc(r.name)+'</td>'+['darkNetCents','visibleNetCents','combinedNetCents'].map(k=>'<td class="'+tone(r[k])+'">'+money(r[k])+'</td>').join('')+'<td>'+pct(r.darkInflowStockRatio)+'</td><td>'+esc(r.leaderName || '—')+'</td></tr>').join('')+'</tbody></table>';
  }
  async function read(url) {
    const response=await root.fetch(url,{signal:AbortSignal.timeout(65000)}),payload=await response.json();
    if(!response.ok || !payload.success)throw Error(payload.error?.message || '读取失败');return payload.data;
  }
  async function refresh(force=false) {
    bind();const date=el('darkBoardDate').value,metric=el('darkBoardMetric').value,key=[view,date,metric].join('|');
    if(pending?.key===key)return pending.task;
    const ticket=++generation;attemptedAt=Date.now();clearTimeout(capTimer);
    el('darkBoardStatus').textContent=view==='sectors'?'正在逐页读取行业排行…':'正在读取个股明暗盘；首次完整采集可能较慢…';
    const task=(async()=>{try {
      if(view==='sectors') {
        const rows=new Map();let total=0,receivedAt='',page=1;const started=Date.now();
        do {
          const next=await read('/api/capital-flow/dark-rank?'+new URLSearchParams({date,scope:'industry',page}));
          if(ticket!==generation)return;
          if(next.tradingDay!==date || next.scope!=='industry' || next.coverage.page!==page)throw Error('行业返回范围不一致');
          next.rows.forEach(r=>rows.set(r.code,r));total=next.coverage.totalReported;receivedAt=next.receivedAt;
          sectors={date,rows:[...rows.values()],total,receivedAt};render();page++;
          if(!next.rows.length || rows.size>=total)break;
        } while(page<=20 && Date.now()-started<45000);
      } else {
        const next=await read('/api/capital-flow/dark-rank-board?'+new URLSearchParams({date,metric,...(force?{force:'1'}:{})}));
        if(ticket!==generation)return;
        if(next.tradingDay!==date || next.metric!==metric)throw Error('返回日期或排序口径不一致');
        if(next.refreshing && !last?.refreshing)refreshFollowupUntil=Date.now()+60000;
        if(!next.refreshing)refreshFollowupUntil=0;
        last=next;render();
        if(next.refreshing && Date.now()<refreshFollowupUntil || next.capLoading && capRetries++<5) {
          capTimer=setTimeout(()=>{if(ticket===generation && !root.document.hidden && root.State?.currentMainView==='capitalFlow' && view==='stocks')refresh();},5000);
        }
      }
      return {ok:true};
    } catch(error){if(ticket===generation)el('darkBoardStatus').textContent=error.message+' · 未完成更新，已显示数据保留原日期';return {ok:false};}
    finally {if(ticket===generation)pending=null;}})();pending={key,task};return task;
  }
  function openStock(key) {
    const row=last?.rows.find(r=>r.key===key);if(!row)return;
    root.CompactTerminal.open('market');root.State.currentPeriod='day';root.State.currentView='kline';
    root.StockList.selectStock({code:row.code,name:row.name,market:row.venue?.toLowerCase(),price:row.price,change:row.changeRatio==null?null:row.changeRatio*100}).catch(error=>console.warn(error));
    let back=el('darkBoardBack');
    if(!back){back=root.document.createElement('button');back.id='darkBoardBack';back.className='small-btn';back.textContent='返回资金榜';el('chartTitle').parentElement.appendChild(back);back.onclick=()=>root.CompactTerminal.open('darkFlow');}
  }
  function reset() {generation++;pending=null;last=null;sectors=null;attemptedAt=0;capRetries=0;refreshFollowupUntil=0;clearTimeout(capTimer);['In','Out','Sectors','Summary'].forEach(k=>el('darkBoard'+k).innerHTML='');}
  function bind() {
    if(bound || !el('darkRankBoard'))return;bound=true;el('darkBoardDate').value=el('darkRankDate').value;
    ['darkBoardDate','darkBoardMetric'].forEach(id=>el(id).addEventListener('change',()=>{if(id==='darkBoardDate')followsDate=false;reset();refresh();}));
    el('darkBoardLimit').addEventListener('change',render);el('darkBoardRefresh').addEventListener('click',()=>{capRetries=0;refresh(true);});
    el('darkRankBoard').addEventListener('click',event=>{
      const stock=event.target.closest('[data-dark-board-stock]');if(stock)openStock(stock.dataset.darkBoardStock);
      const tab=event.target.closest('[data-dark-view]');if(tab){generation++;pending=null;view=tab.dataset.darkView;clearTimeout(capTimer);render();if(view==='sectors'?!sectors:!last)refresh();}
    });
  }
  root.DarkRankBoard={bind,refresh,summarize,enter:async session=>{
    bind();const date=session.dataDate || session.today;
    if(followsDate && el('darkBoardDate').value!==date){reset();el('darkBoardDate').value=date;}
    const hasData=view==='stocks'?last:sectors;
    if(!root.document.hidden && !pending && (!hasData && Date.now()-attemptedAt>60000 || view==='stocks' && last?.refreshing && Date.now()-attemptedAt>=60000 || session.pollAllowed && el('darkBoardDate').value===session.today && Date.now()-attemptedAt>300000))await refresh();
  }};
})(window);
