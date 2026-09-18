(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && api.createDarkRankView) {
    root.EastmoneyDarkRank = api.createDarkRankView({document:root.document,fetch:root.fetch.bind(root)});
    root.EastmoneyDarkRank.bind();
  }
})(typeof window !== 'undefined' ? window : null, function() {
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const scopes = {stock:'个股',industry:'行业'};
  const signed = value => value == null ? 'neutral' : BigInt(value)>0n ? 'up' : BigInt(value)<0n ? 'down' : 'neutral';
  function formatMoney(value) {
    if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return '--';
    const n=BigInt(value),abs=n<0n ? -n : n;
    const [unit,label]=abs>=10000000000n ? [10000000000n,'亿元'] : abs>=1000000n ? [1000000n,'万元'] : [100n,'元'];
    const rounded=(abs*100n+unit/2n)/unit;
    return (n>0n ? '+' : n<0n ? '-' : '')+String(rounded/100n)+'.'+String(rounded%100n).padStart(2,'0')+' '+label;
  }
  const percent = (n,showSign=false) => typeof n==='number' && Number.isFinite(n) ? (showSign && n>0 ? '+' : '')+(n*100).toFixed(2)+'%' : '--';
  const money = n => '<strong class="dark-rank-'+signed(n)+'">'+formatMoney(n)+'</strong>';
  const time = value => new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
  function relation(row) {
    if (row.darkNetCents==null || row.visibleNetCents==null) return '数据不足';
    const a=BigInt(row.darkNetCents),b=BigInt(row.visibleNetCents);
    return a===0n || b===0n ? '一侧为零' : (a>0n)===(b>0n) ? '明暗同向' : '明暗反向';
  }
  function renderRows(rows) {
    return rows.map((r,i)=>'<tr><td><button type="button" data-dark-focus="'+i+'">'+escape(r.name)+'</button><small>'+escape(r.code)+'</small></td>'+
      '<td>'+money(r.darkNetCents)+'</td><td>'+money(r.visibleNetCents)+'</td><td>'+money(r.combinedNetCents)+'</td>'+
      '<td>'+percent(r.darkActivityRatio)+'</td><td class="dark-rank-'+(r.changeRatio>0?'up':r.changeRatio<0?'down':'neutral')+'">'+percent(r.changeRatio,true)+'</td>'+
      '<td>'+relation(r)+(r.reconciled===false ? '<small>合计待核验</small>' : '')+'</td></tr>').join('');
  }
  function createDarkRankView(options) {
    const el=id=>options.document.getElementById(id), fetcher=options.fetch;
    let bound=false,data=null,dataKey='',generation=0,page=1,busy=false,focusedKey=null,followDate=true;
    function controls(busy) {
      el('darkRankRefresh').disabled=busy;
      el('darkRankPrevious').disabled=busy || !data || page<=1;
      el('darkRankNext').disabled=busy || !data || page*data.coverage.pageSize>=data.coverage.totalReported;
    }
    function clear() {
      data=null;dataKey='';focusedKey=null;el('darkRankOutput').hidden=true;
      el('darkRankRows').innerHTML='';el('darkRankMetrics').innerHTML='';
    }
    function focus(index) {
      const row=data && data.rows[index];
      if(row) focusedKey=row.providerMarket+':'+row.code;
      el('darkRankFocus').textContent=row ? '重点查看：'+row.name+' '+row.code+' · '+relation(row)+'（仅符号比较）' : '该页没有记录';
      el('darkRankMetrics').innerHTML=row ? [
        ['暗盘净额',row.darkNetCents,'暗盘活跃度 '+percent(row.darkActivityRatio)],
        ['明盘净额',row.visibleNetCents,'供应商分类口径'],
        ['合计净额',row.combinedNetCents,row.reconciled===true?'明盘＋暗盘已核对':row.reconciled===false?'合计不符，待核验':'核心金额缺失']
      ].map(([label,n,note])=>'<article><span>'+label+'</span>'+money(n)+'<small>'+note+'</small></article>').join('') : '';
    }
    function invalidate() {
      generation++;busy=false;page=1;clear();controls(false);
      el('darkRankStatus').textContent='条件已切换，点击“查询 / 刷新”读取；只有今日榜单参与盘中自动刷新。';
    }
    async function run(requestedPage=page,automatic=false) {
      if(automatic && busy) return;
      const ticket=++generation;
      busy=true;
      const input={date:el('darkRankDate').value,scope:el('darkRankScope').value,page:requestedPage};
      const key=JSON.stringify(input),label=input.date+' · '+(scopes[input.scope] || '未知类型')+' · 第 '+requestedPage+' 页';
      if (dataKey!==key) clear();
      controls(true);
      if(!automatic || !data) el('darkRankStatus').textContent='正在读取 '+label+(data?'；下方暂保留上次结果。':'…');
      try {
        const r=await fetcher('/api/capital-flow/dark-rank?'+new URLSearchParams(input));
        const payload=await r.json();
        if (ticket!==generation) return;
        if (!r.ok || !payload.success) throw Error(payload.error && payload.error.message || '数据暂不可用。');
        const next=payload.data;
        if (!next || next.tradingDay!==input.date || next.scope!==input.scope || next.coverage.page!==input.page || !Array.isArray(next.rows)) throw Error('返回结果与查询条件不一致，未显示。');
        data=next;dataKey=key;page=requestedPage;
        el('darkRankRows').innerHTML=renderRows(data.rows);
        el('darkRankOutput').hidden=false;
        focus(focusedKey===null?0:data.rows.findIndex(row=>row.providerMarket+':'+row.code===focusedKey));
        el('darkRankPage').textContent='第 '+page+' / '+Math.max(1,Math.ceil(data.coverage.totalReported/data.coverage.pageSize))+' 页';
        el('darkRankStatus').textContent='已读取 '+label+' · 本页 '+data.rows.length+' 条 / 接口报告 '+data.coverage.totalReported+' 条'+
          (data.coverage.complete?' · 已覆盖该榜单':' · 部分覆盖，不代表全市场')+(data.cache && data.cache.hit?' · 使用 60 秒缓存':'')+
          ' · 采集时间 '+time(data.receivedAt)+' 北京时间（不是行情事件时间）'+
          (data.quality.reconciliationFailures?' · '+data.quality.reconciliationFailures+' 条合计待核验':'');
      } catch (error) {
        if (ticket!==generation) return;
        const message=error instanceof TypeError || error.message==='network' ? '网络连接失败，请稍后重试。' : error.message;
        el('darkRankStatus').textContent=label+' 查询失败：'+message+(data && dataKey===key ? ' 下方为旧数据，采集于 '+time(data.receivedAt)+' 北京时间，尚未更新。' : ' 无可显示数据，未用零或其他来源替代。');
      } finally {if(ticket===generation) {busy=false;controls(false);}}
    }
    async function autoTick(session,enter=false) {
      const enabled=el('darkRankAuto').checked;
      const defaultDate=session.dataDate || session.today;
      if(followDate && el('darkRankDate').value!==defaultDate) {
        el('darkRankDate').value=defaultDate;invalidate();
      }
      const today=el('darkRankDate').value===session.today;
      el('darkRankAutoStatus').textContent=!enabled?'自动刷新已暂停':!today?'历史日期：仅手动刷新':session.pollAllowed?'盘中每 60 秒刷新当前页 · 非逐秒行情':session.reason;
      if(enabled && (today && session.pollAllowed || enter && !data)) await run(page,true);
    }
    function bind() {
      if(bound || !el('darkRankDate')) return;
      bound=true;
      el('darkRankAuto').checked=true;
      el('darkRankDate').value=(options.now ? options.now() : new Date()).toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
      el('darkRankScope').value='stock';el('darkRankOutput').hidden=true;controls(false);
      el('darkRankRefresh').addEventListener('click',()=>run());
      el('darkRankAuto').addEventListener('change',()=>{
        el('darkRankAutoStatus').textContent=el('darkRankAuto').checked?'已开启：今日榜单盘中每 60 秒检查':'自动刷新已暂停';
      });
      el('darkRankDate').addEventListener('change',()=>{followDate=false;invalidate();});
      el('darkRankScope').addEventListener('change',invalidate);
      el('darkRankPrevious').addEventListener('click',()=>run(page-1));
      el('darkRankNext').addEventListener('click',()=>run(page+1));
      el('darkRankRows').addEventListener('click',event=>{
        const button=event.target.closest('[data-dark-focus]');
        if(button) focus(Number(button.dataset.darkFocus));
      });
    }
    return {bind,run,invalidate,autoTick,formatMoney};
  }
  return {formatMoney,renderRows,createDarkRankView};
});
