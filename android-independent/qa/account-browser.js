async page=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.confirm=()=>true;
  const trades=[
   {id:'b1',accountId:'local',code:'000001',name:'平安银行',date:'2026-09-01',side:'buy',quantity:100,price:10,fee:5,netAmount:1005,realizedPnl:null},
   {id:'s1',accountId:'local',code:'000001',name:'平安银行',date:'2026-09-02',side:'sell',quantity:40,price:12,fee:2,netAmount:478,realizedPnl:76},
   {id:'b2',accountId:'local',code:'600000',name:'浦发银行',date:'2026-09-01',side:'buy',quantity:200,price:20,fee:6,netAmount:4006,realizedPnl:null},
   {id:'s2',accountId:'local',code:'600000',name:'浦发银行',date:'2026-09-02',side:'sell',quantity:200,price:19,fee:6,netAmount:3794,realizedPnl:-212},
  ];
  const state={accounts:[{id:'local',name:'个人账户'},{id:'second',name:'备用账户'}],trades,watch:[],docs:[],reports:[],recent:[],quotes:{}};
  window.qaRequests=[];window.qaETFOffline=false;window.qaSlowLocal=false;
  window.WebStockNative={request(id,text){const r=JSON.parse(text),u=new URL(r.path,'https://fixture.invalid');qaRequests.push(r);let data,error='',delay=10;
   if(u.pathname==='/state')data=state;
   else if(u.pathname==='/settings')data={};
   else if(u.pathname==='/quotes')data={quotes:{},missing:['sz000001'],stale:true};
   else if(u.pathname==='/portfolio'){const local=u.searchParams.get('account')==='local';data={positions:local?[{code:'000001',name:'平安银行',quantity:60,averageCost:10.05,marketValue:null,unrealizedPnl:null,quote:null}]:[],cost:local?603:0,marketValue:null,unrealizedPnl:null,realizedPnl:local?-136:0,missingQuotes:local,analytics:{trades:local?trades:[]}};if(local&&qaSlowLocal)delay=250;}
   else if(u.pathname==='/record'&&r.method==='DELETE'){const index=trades.findIndex(t=>t.id===r.body.id);if(index>=0)trades.splice(index,1);data={};}
   else if(u.pathname==='/rank'){if(qaETFOffline)error='fixture offline';else data={source:'sina-public-etf',fallback:true,checkedAt:'2026-10-05T01:00:00Z',rows:[{code:'510300',name:'沪深300ETF',price:4.123,changePercent:1.23,amount:123000000,dataTimestamp:null,providerTime:'15:00:00',quoteTradeDate:'2026-09-30',quoteTradeTime:'15:00:00'}]};}
   else error='fixture route unavailable';setTimeout(()=>WebStockNativeDone(id,JSON.stringify(error?{success:false,error}:{success:true,data})),delay);
  }};
 });
 await page.setViewportSize({width:390,height:844});await page.goto('http://127.0.0.1:18803');await page.waitForFunction(()=>StandaloneApp.getState().accounts.length===2);
 const checks=[],check=async(name,fn)=>{try{checks.push({name,pass:!!await fn()});}catch(e){checks.push({name,pass:false,error:e.message});}};
 await page.evaluate(()=>StandaloneApp.navigate('stats'));await page.waitForSelector('#statsRealized');
 await check('full-ledger-realized-pnl',()=>page.locator('#statsRealized').innerText().then(t=>t==='-136.00'));
 await check('explicit-realized-curve-not-net-value',()=>page.locator('#content').innerText().then(t=>t.includes('不是账户净值或收益率')));
 await check('native-ledger-chart-rendered',()=>page.evaluate(()=>echarts.getInstanceByDom(document.querySelector('#statsChart')).getOption().series[0].data.at(-1)===-136));
 await page.locator('#accountCode').selectOption('000001');await check('symbol-filter',()=>page.locator('#statsRealized').innerText().then(t=>t==='76.00'));
 await page.locator('#accountFrom').fill('2026-09-02');await page.locator('#accountFrom').dispatchEvent('change');
 await check('date-filter-preserves-pre-period-buy-cost',()=>page.locator('#statsRealized').innerText().then(t=>t==='76.00'));
 await page.locator('#accountTo').fill('2026-08-01');await page.locator('#accountTo').dispatchEvent('change');
 await check('invalid-date-range-clear',()=>page.locator('#content').innerText().then(t=>t.includes('日期范围无效')&&!t.includes('76.00')));
 await page.locator('[data-action=reset-account-filter]').click();await page.locator('#account').selectOption('second');await page.waitForTimeout(80);
 await check('empty-account-no-other-account-fallback',()=>page.locator('#content').innerText().then(t=>t.includes('筛选期内暂无交易')));
 await page.evaluate(()=>{qaSlowLocal=true;});await page.locator('#account').selectOption('local');await page.locator('#account').selectOption('second');await page.waitForTimeout(350);
 await check('slow-other-account-response-cannot-leak',()=>page.locator('#statsRealized').innerText().then(t=>t==='0.00'));
 await page.evaluate(()=>{qaSlowLocal=false;});await page.locator('#account').selectOption('local');await page.waitForTimeout(80);
 await page.locator('[data-ledger-code="000001"]').click();await page.waitForSelector('[data-trade-id="s1"]');
 await check('stats-to-filtered-ledger',()=>page.locator('[data-trade-id]').count().then(n=>n===2));
 await page.locator('#accountSide').selectOption('sell');await check('sell-only-ledger-pnl',()=>page.locator('[data-trade-id]').count().then(n=>n===1));
 await page.locator('[data-trade-edit="s1"]').click();await check('existing-trade-editor-preserves-fields',()=>page.locator('[name=quantity]').inputValue().then(v=>v==='40'));await page.locator('[data-close]').click();
 await page.evaluate(()=>StandaloneApp.navigate('portfolio'));await page.waitForSelector('[data-position-trade="000001"]');
 await check('missing-quotes-remain-unavailable',()=>page.locator('#content').innerText().then(t=>t.includes('合计估值与未实现盈亏暂不可用')));
 await page.locator('[data-position-trade="000001"]').click();await check('holding-sell-prefills-symbol-and-side',()=>page.evaluate(()=>document.querySelector('[name=code]').value==='000001'&&document.querySelector('[name=side]').value==='sell'));await page.locator('[data-close]').click();
 await page.locator('[data-ledger-code="000001"]').click();await check('holding-to-ledger-clears-side',()=>page.locator('#accountSide').inputValue().then(v=>v===''));
 await page.evaluate(()=>StandaloneApp.navigate('etf'));await page.waitForSelector('[data-stock="510300"]');
 await check('ETF-supplemental-date-and-provider-visible',()=>page.locator('#content').innerText().then(t=>t.includes('日期未提供')&&t.includes('补充报价日期 2026-09-30')&&t.includes('新浪备用榜单')));
 await check('ETF-price-retains-three-decimal-tick',()=>page.locator('.quote-price').innerText().then(t=>t==='4.123'));
 await check('ETF-status-settles-after-navigation',()=>page.locator('#runtimeStatus').innerText().then(t=>t.includes('已获取 1 条公开榜单')&&!t.includes('正在刷新')));
 await check('ETF-source-visible-before-list',()=>page.evaluate(()=>document.querySelector('#content p.source').getBoundingClientRect().top<document.querySelector('.quote-row').getBoundingClientRect().top));
 for(const sort of ['decline','amount']){await page.locator('[data-etf-sort='+sort+']').click();await page.waitForTimeout(60);await check('ETF-sort-'+sort,()=>page.evaluate(s=>qaRequests.some(r=>r.path==='/rank?board=etf&sort='+s),sort));}
 await check('ETF-amount-unit',()=>page.locator('.quote-price').innerText().then(t=>t==='1.23 亿'));
 await page.evaluate(()=>{qaETFOffline=true;});await page.locator('#refresh').click();await page.waitForTimeout(60);
 await check('ETF-failure-retains-original-data-and-date',()=>page.locator('#content').innerText().then(t=>t.includes('缓存')&&t.includes('2026-09-30')&&t.includes('fixture offline')));
 await page.evaluate(()=>StandaloneApp.navigate('stats'));await page.waitForSelector('#statsRealized');
 for(const [width,height]of [[360,800],[430,900],[844,390]]){await page.setViewportSize({width,height});await page.waitForTimeout(80);await check('account-layout-'+width,()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.querySelector('#statsChart').clientWidth>200));}
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{document.body.classList.remove('dark');});await page.locator('[data-action=reset-account-filter]').click();await page.screenshot({path:'output/android-independent-20261005/qa/account-light.png',fullPage:true});
 await page.locator('#theme').click();await page.screenshot({path:'output/android-independent-20261005/qa/account-dark.png',fullPage:true});
 await page.evaluate(()=>StandaloneApp.navigate('trades'));await page.waitForSelector('#accountCode');await page.locator('#accountCode').selectOption('600000');
 page.on('dialog',dialog=>dialog.accept());
 for(const id of ['s2','b2']){await page.locator('[data-delete-kind=trades][data-id='+id+']').click();await page.waitForTimeout(60);}
 await check('deleting-last-symbol-record-resets-stale-filter',()=>page.evaluate(()=>document.querySelector('#accountCode').value===''&&document.querySelectorAll('[data-trade-id]').length===2));
 await check('no-page-errors',()=>errors.length===0);return{fixture:true,pass:checks.filter(c=>c.pass).length,total:checks.length,checks,errors};
}
