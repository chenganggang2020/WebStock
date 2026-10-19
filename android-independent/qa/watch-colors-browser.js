async page => {
  // Run after app-flow-browser; only its in-memory native fixture is used.
  const errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
  const check=async(name,fn)=>{try{checks.push({name,pass:!!await fn()});}catch(e){checks.push({name,pass:false,error:e.message});}};
  await page.evaluate(()=>{
    if(!window.qaRequests)throw Error('Native QA fixture required');
    const state=StandaloneApp.getState();state.watch=[{id:'a',code:'000001',name:'平安银行',group:'银行'},{id:'b',code:'000002',name:'万科A',group:'观察'}];
    state.watchGroups=[{id:'g1',name:'银行',color:'violet'},{id:'g2',name:'观察',color:'blue'}];state.watchStyles=[];
    const original=WebStockNative.request;WebStockNative.request=(id,text)=>{const r=JSON.parse(text);if(r.path==='/state'){setTimeout(()=>WebStockNativeDone(id,JSON.stringify({success:true,data:state})),10);return;}if(r.path==='/record'&&['watchGroups','watchStyles'].includes(r.body.kind)){const rows=state[r.body.kind],value=r.body.item,index=rows.findIndex(x=>x.id===value.id);if(r.body.kind==='watchGroups'&&index>=0)for(const row of state.watch)if(row.group===rows[index].name)row.group=value.name;if(index>=0)rows[index]=value;else rows.push(value);setTimeout(()=>WebStockNativeDone(id,JSON.stringify({success:true,data:value})),10);return;}original(id,text);};
    StandaloneApp.navigate('docs');StandaloneApp.navigate('watch');
  });
  for(const width of [360,390,430]){await page.setViewportSize({width,height:844});await check('groups-visible-no-overflow-'+width,()=>page.evaluate(()=>!document.querySelector('select#watchGroup')&&document.querySelectorAll('[data-watch-group]').length===3&&document.documentElement.scrollWidth<=innerWidth));}
  await page.locator('[data-watch-group="银行"]').click();
  await check('group-click-filters-immediately',()=>page.locator('#watchRows [data-stock]').count().then(n=>n===1));
  await page.locator('[data-action=edit-group]').click();await page.locator('#f-name').fill('金融观察');await page.locator('[name=color][value=teal]').check();await page.locator('#editForm [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#editor').open);
  await check('group-rename-updates-selection-and-row',()=>page.evaluate(()=>document.querySelector('[data-watch-group="金融观察"]').getAttribute('aria-pressed')==='true'&&document.querySelector('#watchRows .quote-row').dataset.groupColor==='teal'));
  await page.locator('[data-watch-edit=a]').click();await page.locator('[data-watch-color="000001"]').click();await page.locator('[name=color][value=amber]').check();await page.locator('#editForm [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#editor').open);
  await check('stock-override-saved-separately',()=>page.evaluate(()=>StandaloneApp.getState().watchStyles[0].color==='amber'&&document.querySelector('#watchRows .quote-row').dataset.groupColor==='amber'));
  await page.locator('[data-watch-group=""]').click();await page.setViewportSize({width:390,height:844});
  for(const dark of [false,true]){
    await page.evaluate(d=>{if(document.body.classList.contains('dark')!==d)document.querySelector('#theme').click();},dark);
    await check('semantic-and-tag-colors-distinct-'+dark,()=>page.evaluate(()=>{const row=document.querySelector('[data-code="000001"]'),name=getComputedStyle(row.querySelector('.quote-name>button')).color,price=getComputedStyle(row.querySelector('.quote-price')).color,change=getComputedStyle(row.querySelector('.quote-change')).color;return name!==price&&name!==change&&row.querySelector('.quote-change').classList.contains('up');}));
    await page.screenshot({path:'output/playwright/watch-colors-'+(dark?'dark':'light')+'.png'});
  }
  await page.locator('#watchRows [data-stock="000001"]').click();await page.waitForFunction(()=>!!echarts.getInstanceByDom(document.querySelector('#chart')));
  await page.locator('[data-action=expand-chart]').click();
  await page.evaluate(()=>{
    // The earlier monotonic fixture correctly has no price-flip Setup. Use alternating
    // trends here to exercise actual signal calculations, never inject fake marks.
    const rows=Array.from({length:120},(_,i)=>{const close=50+(i<15?-i*.3:i<55?-4.5+(i-15)*.4:i<95?11.5-(i-55)*.35:-2.5+(i-95)*.3);return {date:new Date(Date.UTC(2026,4,i+1)).toISOString().slice(0,10),open:close-.1,close,high:close+.3,low:close-.3,volume:1000+i*20};});
    PhoneCharts.draw({symbol:'sz000001',period:'day',adjustment:'qfq',source:'qa-fixture',checkedAt:'2026-10-02T08:00:00Z',rows},{type:'kline',period:'day',indicator:'macd',maPeriods:[5,10,20],nine:true});PhoneCharts.range(55);
  });
  await check('dense-signals-retained-price-axis-not-flattened',()=>page.evaluate(()=>{const o=echarts.getInstanceByDom(document.querySelector('#chart')).getOption(),s=o.series.find(s=>s.name==='九转标记');return s.data.length>0&&o.yAxis[0].boundaryGap[0]<=.1&&o.grid[0].height>o.grid[1].height*2;}));
  await page.screenshot({path:'output/playwright/chart-dense-signals-dark.png'});
  await page.setViewportSize({width:844,height:390});await page.waitForTimeout(150);await check('rotation-keeps-volume-panel-in-view',()=>page.evaluate(()=>{const n=document.querySelector('#chart'),o=echarts.getInstanceByDom(n).getOption(),g=o.grid.at(-1);return g.top+g.height<=n.clientHeight-30;}));await page.screenshot({path:'output/playwright/chart-dense-signals-landscape.png'});
  await check('no-page-errors',()=>errors.length===0);
  return{fixture:true,checks,pass:checks.filter(c=>c.pass).length,total:checks.length,errors};
}
