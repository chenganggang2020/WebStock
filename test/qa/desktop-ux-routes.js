async (page) => {
  const stocks = [
    {code:'600183',name:'生益科技',pinyin:'sykj',py:'shengyikeji',price:99,change:1.23},
    {code:'600584',name:'长电科技',pinyin:'cdkj',py:'changdiankeji',price:88,change:-2.1},
    {code:'002156',name:'通富微电',pinyin:'tfwd',py:'tongfuweidian',price:77,change:.4},
    {code:'600519',name:'贵州茅台',pinyin:'gzmt',py:'guizhoumaotai',price:100,change:1.1}
  ];
  const watchlist = stocks.slice(0,3).map(stock=>({...stock,groupName:'隔离测试组'}));
  const closes = [100,101,102,103,104,...Array.from({length:21},(_,i)=>99-i)];
  const bars = period => closes.map((close,index)=>({date: new Date(Date.UTC(period==='month'?2023:2025,period==='month'?index:0,period==='week'?3+index*7:index+1)).toISOString().slice(0,10),open:close,close,high:close+.4,low:close-.4,volume:100000,incomplete:false}));
  const minute = Array.from({length:100},(_,i)=>({time:'2026-10-02 '+String(9+Math.floor((30+i)/60)).padStart(2,'0')+':'+String((30+i)%60).padStart(2,'0'),price:100+Math.sin(i/7),volume:100,amount:10000,avgPrice:100}));
  const requests = [], errors = [], blocked = [];
  page.on('pageerror', error=>errors.push(error.message));
  await page.route('**/*', async route => {
    const request=route.request(), url=new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:3073') { blocked.push(request.url()); return route.abort(); }
    if (!url.pathname.startsWith('/api/') && url.pathname !== '/ai-status') return route.continue();
    requests.push({path:url.pathname,search:url.search,method:request.method()});
    const ok=(data,meta={})=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({success:true,data,meta})});
    if (url.pathname==='/api/stocklist') return ok(stocks);
    if (url.pathname==='/api/watchlist') return ok(watchlist);
    if (url.pathname==='/api/stock-search') {const q=(url.searchParams.get('q')||'').toLowerCase(); return ok({stocks:stocks.filter(s=>(s.code+s.name+s.pinyin+s.py).includes(q)),themes:[]});}
    if (url.pathname==='/api/kline') {const period=url.searchParams.get('period');return ok(bars(period),{dataSource:'合成夹具 · 非市场行情',tradingDate:bars(period).at(-1).date,coverage:'26 synthetic completed bars'});}
    if (url.pathname==='/api/minute') return ok(minute,{dataSource:'合成夹具 · 非市场行情',tradingDate:'2026-10-02',intervalSeconds:60});
    if (url.pathname==='/api/quote' || url.pathname==='/api/quotes') return ok(String(url.searchParams.get('codes')||url.searchParams.get('code')||'600183').split(',').map(code=>({...stocks.find(s=>s.code===code),code,prevClose:100,volume:10000})));
    return ok([]);
  });
  await page.setViewportSize({width:1600,height:1000});
  await page.goto('http://127.0.0.1:3073/');
  await page.waitForFunction(()=>window.desktopFixtureReady === true);
  await page.evaluate(()=>{window.desktopQaResults=[];});
  page.on('close',()=>{});
  console.log(JSON.stringify({title:await page.title(),requests,errors,blocked}));
}
