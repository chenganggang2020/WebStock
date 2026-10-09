async page => {
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    localStorage.removeItem('webstock-chart-preferences');localStorage.setItem('webstock-independent-theme','light');
    const state={mode:'independent',version:'2.0.0',watch:[],accounts:[{id:'local',name:'我的账户'}],trades:[],docs:[],reports:[],recent:[],quotes:{}};
    let sequence=0;
    window.qaRequests=[];window.qaExports=[];window.qaDelays={};
    window.WebStockExport={save:(mime,data)=>qaExports.push({mime,data})};
    window.WebStockNative={request(id,text){const request=JSON.parse(text);qaRequests.push(request);const url=new URL(request.path,'https://local.invalid');let data;
      try {
        if(url.pathname==='/state')data=state;
        else if(url.pathname==='/settings')data={endpoint:'',model:'',keySet:false};
        else if(url.pathname==='/record'){
          const {kind,item,id:recordId}=request.body;
          if(request.method==='DELETE')state[kind]=state[kind].filter(r=>r.id!==recordId);
          else {const row={...item,id:item.id||'qa-'+(++sequence)};const index=state[kind].findIndex(r=>r.id===row.id);if(index<0)state[kind].push(row);else state[kind][index]=row;}
          data=state;
        }else if(url.pathname==='/quotes'){
          const quotes={};for(const symbol of url.searchParams.get('symbols').split(',')){const q={symbol,name:symbol,price:10.5,changePercent:1.23,tradeDate:'2026-09-30',tradeTime:'15:00:00',checkedAt:'2026-10-01T08:00:00Z',source:'QA fixture'};quotes[symbol]=q;state.quotes[symbol]=q;}
          data={quotes,missing:[],stale:false,error:''};
        }else if(url.pathname==='/kline'){const base=url.searchParams.get('code')==='000001'?10:20;data={source:'QA fixture',adjustment:'qfq',symbol:'sz'+url.searchParams.get('code'),period:url.searchParams.get('period'),checkedAt:'2026-10-01T08:00:00Z',rows:Array.from({length:120},(_,i)=>({date:new Date(Date.UTC(2026,4,i+1)).toISOString().slice(0,10),open:base+i/25,close:base+i/25+Math.sin(i/3)*.5,high:base+i/25+.8,low:base+i/25-.8,volume:10000+Math.abs(Math.sin(i))*20000}))};}
        else if(url.pathname==='/minute')data={source:'QA fixture',date:'20260930',previousClose:9.9,rows:[{time:'0930',price:10,volume:100,averagePrice:10},{time:'0931',price:11,volume:50,averagePrice:10.33}]};
        else if(url.pathname==='/portfolio')data={positions:[],cost:0,realizedPnl:0,marketValue:0,unrealizedPnl:0,missingQuotes:false};
        else if(url.pathname==='/rank'||url.pathname==='/news')throw Error('QA: 数据源暂不可用');
        else if(url.pathname==='/backup')data={format:'webstock-android-independent-v1',watch:state.watch,accounts:state.accounts,trades:state.trades,docs:state.docs,reports:state.reports};
        else throw Error('QA: 无支持的功能');
        setTimeout(()=>WebStockNativeDone(id,JSON.stringify({success:true,data})),qaDelays[request.path]||15);
      }catch(error){setTimeout(()=>WebStockNativeDone(id,JSON.stringify({success:false,error:error.message})),15);}
    }};
  });
  await page.setViewportSize({width:390,height:844});await page.goto('http://127.0.0.1:18803');await page.waitForFunction(()=>window.StandaloneApp?.getState().accounts.length===1);
  const checks=[],check=async(id,fn)=>{try{checks.push({id,pass:!!await fn()});}catch(error){checks.push({id,pass:false,error:error.message});}};
  await page.locator('#bottomNav [data-page=watch]').click();await page.locator('[data-action=add-watch]').click();
  await page.locator('#f-code').fill('000001');await page.locator('#f-group').fill('银行');await page.locator('#f-note').fill('测试备注');await page.locator('#editForm [type=submit]').click();await page.waitForTimeout(250);
  await check('watch-form-saves-and-closes',async()=>!await page.locator('#editor').evaluate(e=>e.open)&&await page.locator('.quote-row[data-code="000001"]').count()===1);
  if(await page.locator('#editor').evaluate(e=>e.open))await page.locator('[data-close]').click();
  await page.locator('#search').fill('000001');await page.locator('#searchResults [data-stock="000001"]').click();await page.waitForTimeout(300);
  await check('first-stock-has-kline',()=>page.evaluate(()=>qaRequests.some(r=>r.path.includes('/kline?code=000001'))));
  await page.locator('#search').fill('000002');await page.locator('#searchResults [data-stock="000002"]').click();await page.waitForTimeout(300);
  await check('switch-stock-loads-new-kline',()=>page.evaluate(()=>qaRequests.some(r=>r.path.includes('/kline?code=000002'))));
  await page.evaluate(()=>{qaDelays['/kline?code=000001&period=day']=450;});
  await page.locator('#search').fill('000001');await page.locator('#searchResults [data-stock="000001"]').click();await page.waitForTimeout(90);
  await page.locator('#search').fill('000002');await page.locator('#searchResults [data-stock="000002"]').click();await page.waitForTimeout(600);await page.locator('#theme').click();
  await check('old-stock-response-cannot-replace-current-chart',()=>page.evaluate(()=>echarts.getInstanceByDom(document.querySelector('#chart')).getOption().series[0].data[0][0]===20));await page.locator('#theme').click();
  for(const indicator of ['macd','kdj','rsi','cci','obv','atr','ma']){await page.locator('#indicator').selectOption(indicator);await check('indicator-'+indicator,()=>page.evaluate(id=>{const o=echarts.getInstanceByDom(document.querySelector('#chart')).getOption();return o.grid.length===(id==='ma'?2:3)&&o.series.some(s=>s.name==='成交量(手)')&&o.series[0].data.length===120;},indicator));}
  await page.locator('#indicator').selectOption('macd');
  await page.evaluate(()=>echarts.getInstanceByDom(document.querySelector('#chart')).dispatchAction({type:'dataZoom',start:25,end:75}));await page.locator('#theme').click();
  await check('zoom-survives-theme-render',()=>page.evaluate(()=>echarts.getInstanceByDom(document.querySelector('#chart')).getOption().dataZoom[0].start===25));await page.locator('#theme').click();
  const oldReadout=await page.locator('#chartReadout b').innerText();await page.locator('[data-action=chart-previous]').click();await check('touch-step-updates-ohlc',()=>page.locator('#chartReadout b').innerText().then(t=>t!==oldReadout));
  await page.locator('.chart-options summary').click();await page.locator('[data-action=chart-ma]').click();await page.locator('#f-ma').fill('5,10,30,60');await page.locator('#editForm [type=submit]').click();await page.waitForTimeout(500);
  await check('custom-ma-visible',()=>page.locator('#chartLegend').innerText().then(t=>t.includes('MA60')));
  await page.locator('.chart-options summary').click();await page.locator('[data-action=chart-nine]').click();
  await check('nine-turn-marks-render',()=>page.evaluate(()=>echarts.getInstanceByDom(document.querySelector('#chart')).getOption().series[0].markPoint.data.length>0));
  await page.locator('[data-action=expand-chart]').click();
  await page.evaluate(()=>{document.querySelector('#chartSource').textContent='缓存数据来源和最近更新日期说明。'.repeat(16)});await page.waitForTimeout(200);
  await check('canvas-resizes-after-source-wraps',()=>page.evaluate(()=>{const el=document.querySelector('#chart'),c=echarts.getInstanceByDom(el);return Math.abs(c.getHeight()-el.clientHeight)<=1;}));
  await page.evaluate(()=>{document.querySelector('#chartSource').textContent='腾讯公开K线 · 浏览器夹具'});await page.waitForTimeout(200);
  for(const [width,height]of [[360,800],[390,844],[430,900],[844,390]]){await page.setViewportSize({width,height});await page.waitForTimeout(180);await check('chart-fullscreen-fits-'+width,()=>page.evaluate(()=>{const el=document.querySelector('.stock-chart'),r=el.getBoundingClientRect(),c=document.querySelector('#chart').getBoundingClientRect();return document.documentElement.scrollWidth<=innerWidth&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&c.height>=150&&c.right<=innerWidth;}));await page.screenshot({path:'output/android-independent-20261002/qa/chart-'+width+'.png'});}
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>WebStockPhoneBack());await check('android-back-exits-chart-fullscreen',()=>page.locator('body').evaluate(e=>!e.classList.contains('chart-expanded')));
  await page.locator('#chartType').selectOption('minute');await page.waitForTimeout(300);
  await check('minute-price-average-volume-and-gaps',()=>page.evaluate(()=>{const o=echarts.getInstanceByDom(document.querySelector('#chart')).getOption();return o.xAxis[0].data.length===242&&o.series[1].name==='均价'&&o.series[1].data[1]===10.33&&o.series[2].data[1].value===50&&o.series[0].data[2]===null;}));
  await page.locator('#chartType').selectOption('kline');await page.waitForTimeout(300);
  for(const period of ['week','month','day']){await page.locator('#period').selectOption(period);await page.waitForTimeout(300);await check('period-'+period,()=>page.evaluate(p=>qaRequests.some(r=>r.path.includes('period='+p)),period));}
  for(const id of ['dashboard','sectors','etf','watch','portfolio','trades','stats','recent','capital','docs','evidence','news','ai','reports','more','settings','health','migration']){
    await page.evaluate(id=>StandaloneApp.navigate(id),id);await page.waitForTimeout(80);
    await check('page-'+id,()=>page.locator('#content').innerText().then(text=>text.trim().length>0));
  }
  await page.evaluate(()=>StandaloneApp.navigate('docs'));await page.locator('[data-action=add-doc]').click();await page.locator('#f-title').fill('研究证据');await page.locator('textarea[name=text]').fill('原文事实。<img src=x onerror=alert(1)>');await page.locator('#editForm [type=submit]').click();await page.waitForTimeout(200);
  await check('document-form-saves',()=>page.evaluate(()=>StandaloneApp.getState().docs.length===1));
  if(await page.locator('#editor').evaluate(e=>e.open))await page.locator('[data-close]').click();
  if(await page.locator('[data-doc]').count()){await page.locator('[data-doc]').first().click();await check('reader-escapes-imported-html',()=>page.locator('#content img').count().then(n=>n===0));}
  await page.evaluate(()=>StandaloneApp.navigate('settings'));await page.locator('[data-action=export-backup]').click();await page.waitForTimeout(150);await check('backup-uses-android-export-bridge',()=>page.evaluate(()=>qaExports.length===1&&qaExports[0].mime==='application/json'));
  for(const width of [360,390,430,844]){await page.setViewportSize({width,height:width===844?390:844});await page.evaluate(()=>StandaloneApp.navigate('watch'));await page.waitForTimeout(70);await check('no-horizontal-overflow-'+width,()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await page.setViewportSize({width:390,height:844});await page.locator('#theme').click();await check('dark-mode-toggle',()=>page.locator('body').evaluate(e=>e.classList.contains('dark')));await page.screenshot({path:'output/android-independent-20261002/qa/watch-dark.png'});await page.locator('#theme').click();await page.screenshot({path:'output/android-independent-20261002/qa/watch.png'});
  await page.evaluate(()=>StandaloneApp.navigate('dashboard'));await page.screenshot({path:'output/android-independent-20261002/qa/dashboard.png'});
  await check('no-unhandled-page-errors',()=>errors.length===0);
  return {fixture:true,checks,total:checks.length,pass:checks.filter(c=>c.pass).length,errors};
}
