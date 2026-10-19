(function(root,factory){
  const api=factory(); if(typeof module!=='undefined')module.exports=api;
  if(root){root.PageRefresh=api;root.document.addEventListener('DOMContentLoaded',()=>api.bind(root));}
})(typeof window!=='undefined'?window:null,function(){
  async function refreshPage(root,pageId) {
    const state=root.State || {}, doc=root.document;
    const page=pageId || doc.getElementById('terminalPageSelect')?.value || state.currentMainView;
    if(['market','auction'].includes(page)) {
      if(state.currentView==='kline')return root.KlineChart.loadKlineData(state.currentStock?.code,state.currentPeriod);
      return root.RealtimeChart.loadRealtimeData(state.currentStock?.code);
    }
    if(page==='darkFlow')return root.DarkRankBoard.refresh();
    if(page==='news')return root.News.load({cacheBust:true});
    if(['creatorTasks','authors'].includes(page))return root.ExpertTracker.refresh();
    if(page==='replay')return {skipped:true,reason:'本地文件回放：如需更新，请重新选择文件。'};
    if(page==='dashboard')return root.Dashboard.load({force:true});
    if(page==='etf')return root.MarketInstitutionalFlow.load(true,'intraday');
    if(['capitalIntraday','capitalDaily'].includes(page))return Promise.all([
      root.MarketInstitutionalFlow.load(true,'daily'), root.EastmoneyEtfDaily?.load(true)
    ]).then(results=>({ok:results.every(result=>result?.ok!==false)}));
    if(page==='paperPortfolio')return root.AIResearch.loadPaperPortfolios();
    if(page==='sectors')return root.HotMarket.load({refresh:true,silent:true});
    if(page==='capitalFlow')return root.CapitalFlow.load(root.CapitalFlow.readControls());
    if(page==='evidence')return root.AIResearch.loadEvidence();
    if(page==='aiResearch')return {skipped:true,reason:'当前为研究编辑区；保留输入，不重新生成研究。请刷新证据库以更新资料。'};
    if(['watchlist','portfolio','recent'].includes(page) && root.LiveRefresh?.refreshNow)return root.LiveRefresh.refreshNow();
    // Only existing explicitly read-only refresh controls are allowed here.
    if(['settings','health'].includes(page))return root.Settings.load();
    if(page==='screener')return root.StockScreener.loadHistory();
    if(page==='trades')return root.Trades.loadTrades();
    if(page==='aiHistory')return root.AIHistory.render();
    if(page==='rotation' && root.SectorRotation?.run)return root.SectorRotation.run(false);
    const ids={industryChain:'refreshIndustryChainBtn',aiHistory:'refreshAiHistoryBtn',
      stats:'refreshStatsBtn',compoundLab:'refreshCompoundLabBtn'};
    const button=ids[page] && doc.getElementById(ids[page]);
    if(button && !button.disabled){button.click();return {requested:true};}
    return {skipped:true,reason:'当前为本地编辑或记录页面，保留当前内容；没有可刷新行情。'};
  }
  function bind(root) {
    const doc=root.document; let pending=null, menu=null, toast=null;
    function notify(text){if(!toast){toast=doc.createElement('div');toast.className='reading-refresh-status';toast.setAttribute('role','status');doc.body.appendChild(toast);}toast.textContent=text;toast.hidden=false;root.setTimeout(()=>{toast.hidden=true;},4500);}
    async function run(){
      if(pending)return pending;
      if(menu)menu.hidden=true;
      notify('正在刷新当前页面…');
      pending=Promise.resolve().then(()=>refreshPage(root)).then(result=>notify(result?.skipped?result.reason:result?.ok===false?'刷新未完成，保留上次数据':result?.requested?'已请求刷新，请查看页面数据状态':'当前页面数据已刷新')).catch(error=>notify('刷新未完成：'+error.message)).finally(()=>{pending=null;});
      return pending;
    }
    function button(){const b=doc.createElement('button');b.type='button';b.textContent='刷新当前页面数据';b.addEventListener('click',event=>{event.stopPropagation();run();});return b;}
    doc.addEventListener('contextmenu',event=>{
      if(event.target.closest('input,textarea,select,[contenteditable=true]'))return;
      // Retain security-specific actions in an existing stock context menu.
      const existing=doc.getElementById('stockContextMenu');
      if(event.defaultPrevented && existing && existing.style.display==='block'){
        if(!existing.querySelector('[data-page-refresh]')){const b=button();b.dataset.pageRefresh='1';existing.appendChild(b);}return;
      }
      if(event.defaultPrevented)return;
      event.preventDefault();
      if(!menu){menu=doc.createElement('div');menu.className='reading-context-menu';menu.appendChild(button());doc.body.appendChild(menu);}
      menu.hidden=false;menu.style.left=Math.min(event.clientX,root.innerWidth-210)+'px';menu.style.top=Math.min(event.clientY,root.innerHeight-55)+'px';
    });
    doc.addEventListener('click',()=>{if(menu)menu.hidden=true;});
    doc.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu)menu.hidden=true;});
    const clock=doc.getElementById('terminalClock');
    const update=()=>{if(clock)clock.textContent='北京时间 '+new Date().toLocaleString('sv-SE',{timeZone:'Asia/Shanghai',hour12:false});};
    update();root.setInterval(update,1000);
  }
  return {refreshPage,bind};
});
