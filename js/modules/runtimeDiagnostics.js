(function() {
  const desktop=window.webstockDesktop;
  if(!desktop?.reportDiagnostic)return;
  function pulse(){desktop.reportDiagnostic({type:'renderer',visible:!document.hidden,page:document.body.dataset.terminalPage || ''});}
  document.addEventListener('visibilitychange',pulse);
  let lastInteraction=0;
  document.addEventListener('click',event=>{
    if(Date.now()-lastInteraction<200)return;lastInteraction=Date.now();
    const target=event.target.closest('button,select,summary');
    if(target)desktop.reportDiagnostic({type:'interaction',label:target.id || target.dataset.terminalPage || target.tagName.toLowerCase()});
  },true);
  const timer=setInterval(pulse,1000);pulse();
  window.addEventListener('pagehide',()=>{clearInterval(timer);desktop.reportDiagnostic({type:'renderer',visible:false});},{once:true});
  const button=document.getElementById('runtimeDiagnosticsStatus');
  if(button){
    button.hidden=false;
    button.addEventListener('click',()=>desktop.openRuntimeDiagnostics().catch(()=>{button.textContent='日志目录暂不可用';}));
    const status=()=>desktop.getRuntimeDiagnosticsStatus().then(result=>{
      button.textContent=result.status==='active'?'卡顿自动记录：开':result.status==='starting'?'卡顿记录：启动中':'卡顿记录：异常';
      button.title=result.status==='active'?'发生卡顿自动记录；点击打开本机日志文件夹':result.status==='starting'?'正在启动独立诊断进程':'诊断进程未正常运行，点击查看已有日志';
    }).catch(()=>{button.textContent='卡顿记录：状态未知';});
    status();setInterval(status,30000);
  }
})();
