async page => {
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    const state={watch:[{id:'a',code:'000002',name:'万科A',group:'测试组'},{id:'b',code:'000001',name:'平安银行',group:'测试组'}],accounts:[{id:'local',name:'测试账户'}],trades:[],docs:[],reports:[],recent:[],quotes:{}};
    window.qaRequests=[];window.qaChartDelays=[];window.qaChartValues=[];window.qaFailChart=false;
    window.WebStockNative={request(id,text){const r=JSON.parse(text),u=new URL(r.path,'https://fixture.invalid');qaRequests.push(r);let data,delay=15,error='';
      if(u.pathname==='/state')data=state;
      else if(u.pathname==='/settings')data={keySet:false};
      else if(u.pathname==='/record'){data={};delay=1500;}
      else if(u.pathname==='/chart-cache')data={available:false};
      else if(u.pathname==='/quotes'){const quotes={};for(const symbol of u.searchParams.get('symbols').split(','))quotes[symbol]={symbol,price:12,changePercent:2.3,open:11,high:13,low:10,previousClose:11,tradeDate:'2026-09-30',tradeTime:'15:00:00',checkedAt:'2026-10-02T08:00:00Z'};data={quotes,missing:[],stale:false};}
      else if(u.pathname==='/kline'||u.pathname==='/kline-history'){
        const base=Number(u.searchParams.get('code'))===1?10:20,extra=u.pathname==='/kline-history'?60:0;
        data={symbol:'sz'+u.searchParams.get('code'),period:u.searchParams.get('period'),source:'tencent-public-kline',adjustment:'qfq',checkedAt:'2026-10-02T08:00:00Z',rows:Array.from({length:120+extra},(_,n)=>{const i=n-extra;return{date:new Date(Date.UTC(2026,4,i+1)).toISOString().slice(0,10),open:base+i/25,close:base+i/25+.2,high:base+i/25+.8,low:base+i/25-.8,volume:1000+n};})};
        if(u.pathname==='/kline'){delay=qaChartDelays.shift()??15;const value=qaChartValues.shift();if(value!=null)data.rows[0].close=value;if(qaFailChart)error='fixture source offline';}
      }else if(u.pathname==='/minute')data={date:'20260930',previousClose:10,rows:[{time:'0930',price:10,volume:20,averagePrice:10},{time:'0931',price:10.1,volume:10,averagePrice:10.03}],checkedAt:'2026-10-02T08:00:00Z'};
      else if(u.pathname==='/portfolio')data={positions:[],cost:0,marketValue:0,unrealizedPnl:0,realizedPnl:0};
      else error='fixture route unavailable';
      setTimeout(()=>WebStockNativeDone(id,JSON.stringify(error?{success:false,error}:{success:true,data})),delay);
    }};
  });
  await page.setViewportSize({width:390,height:844});await page.goto('http://127.0.0.1:18803');await page.waitForFunction(()=>StandaloneApp.getState().accounts.length===1);
  const checks=[],check=async(name,fn)=>{try{checks.push({name,pass:!!await fn()});}catch(e){checks.push({name,pass:false,error:e.message});}};
  await page.locator('#bottomNav [data-page=watch]').click();await page.locator('#content [data-stock="000002"]').click();
  await check('instant-open-before-record-response',()=>page.locator('body').getAttribute('data-page').then(v=>v==='stock'));
  await page.waitForFunction(()=>!!echarts.getInstanceByDom(document.querySelector('#chart')));
  await page.locator('[data-chart-period=week]').click();await page.waitForTimeout(100);await page.locator('[data-action=stock-next]').click();await page.waitForTimeout(100);
  await check('stock-list-order-and-period',()=>page.evaluate(()=>document.querySelector('#period').value==='week'&&document.querySelector('.stock-switcher span').textContent.includes('2 / 2')&&qaRequests.some(r=>r.path==='/kline?code=000001&period=week')));
  await page.evaluate(()=>{window.qaChart=echarts.getInstanceByDom(document.querySelector('#chart'));window.qaDom=document.querySelector('#chart');qaChart.dispatchAction({type:'dataZoom',start:20,end:60});});
  await page.locator('[data-action=chart-previous]').click();const readout=await page.locator('#chartReadout').innerText();const zoom=await page.evaluate(()=>qaChart.getOption().dataZoom[0].start);
  await page.locator('#refresh').click();await page.waitForTimeout(100);
  await check('refresh-preserves-dom-instance-zoom-and-readout',()=>page.evaluate(({text,zoom})=>{const c=echarts.getInstanceByDom(document.querySelector('#chart'));return c===qaChart&&document.querySelector('#chart')===qaDom&&c.getOption().dataZoom[0].start===zoom&&document.querySelector('#chartReadout').innerText===text;},{text:readout,zoom}));
  await page.locator('#indicator').selectOption('rsi');await check('indicator-preserves-instance',()=>page.evaluate(()=>qaChart===echarts.getInstanceByDom(document.querySelector('#chart'))));
  await page.evaluate(()=>{qaFailChart=true;});await page.locator('#refresh').click();await page.waitForTimeout(80);
  await check('offline-chart-retains-rows-and-date',()=>page.evaluate(()=>echarts.getInstanceByDom(document.querySelector('#chart')).getOption().series[0].data.length===120&&document.querySelector('#chartSource').textContent.includes('缓存')&&document.querySelector('#chartSource').textContent.includes('fixture source offline')));
  await page.evaluate(()=>{qaFailChart=false;});await page.locator('#refresh').click();await page.waitForTimeout(80);
  await page.locator('.chart-options summary').click();await page.locator('[data-action=chart-older]').click();await page.waitForTimeout(80);
  await check('load-earlier-adds-verified-history',()=>page.evaluate(()=>echarts.getInstanceByDom(document.querySelector('#chart')).getOption().series[0].data.length===180));
  await page.locator('#refresh').click();await page.waitForTimeout(80);await check('refresh-retains-earlier-history',()=>page.evaluate(()=>echarts.getInstanceByDom(document.querySelector('#chart')).getOption().series[0].data.length===180));
  await page.locator('#search').fill('PFYH');await check('pinyin-search',()=>page.locator('#searchResults [data-stock="600000"]').count().then(n=>n===1));
  await page.locator('#search').fill('920999');await check('unlisted-exact-code-still-queryable',()=>page.locator('#searchResults [data-stock="920999"]').count().then(n=>n===1));await page.locator('#search').fill('');
  await page.locator('[data-action=chart-nine]').click();
  await page.locator('.signal-explain').click();
  await check('signal-dialog-shows-public-rule-version',()=>page.locator('#chartSignalDialog').innerText().then(t=>t.includes('13')&&t.includes('已加载历史')));
  await page.evaluate(()=>WebStockPhoneBack());await check('system-back-closes-signal-dialog-not-page',()=>page.evaluate(()=>!document.querySelector('#chartSignalDialog').open&&document.body.dataset.page==='stock'));
  await page.locator('[data-action=expand-chart]').click();
  for(const [width,height]of [[360,800],[430,900],[844,390]]){await page.setViewportSize({width,height});await page.waitForTimeout(100);await check('fullscreen-'+width,()=>page.evaluate(()=>{const box=document.querySelector('#chart').getBoundingClientRect();return document.documentElement.scrollWidth<=innerWidth&&box.height>=150&&box.right<=innerWidth&&box.bottom<=innerHeight;}));}
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'output/playwright/android-flow-portrait.png'});
  await check('no-page-errors',()=>errors.length===0);
  return{fixture:true,checks,pass:checks.filter(c=>c.pass).length,total:checks.length,errors};
}
