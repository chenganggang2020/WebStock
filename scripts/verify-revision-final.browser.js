async (page) => {
  await page.getByRole('combobox',{name:'全部页面',exact:true}).selectOption('darkFlow');
  await page.getByRole('button',{name:'个股双向榜',exact:true}).click();
  await page.locator('[data-dark-board-stock]').first().waitFor();
  const layouts=[];
  for(const [width,height] of [[1600,980],[1366,768],[1024,768]]){
    await page.setViewportSize({width,height});
    const size=await page.locator('#darkRankBoard').evaluate(el=>({width:innerWidth,documentOverflow:document.documentElement.scrollHeight-innerHeight,hostOverflow:el.scrollHeight-el.clientHeight,horizontal:el.scrollWidth-el.clientWidth}));
    if(size.documentOverflow>1||size.hostOverflow>1||size.horizontal>1)throw Error(JSON.stringify(size));layouts.push(size);
  }
  await page.setViewportSize({width:1600,height:980});
  const start=Date.now();await page.locator('#darkBoardLimit').selectOption('10000');
  const count=await page.locator('#darkBoardIn .dark-flow-row').count();
  const renderMs=Date.now()-start;
  await page.locator('#darkBoardIn').evaluate(el=>{el.scrollTop=el.scrollHeight;});
  await page.locator('#darkBoardIn [data-dark-board-stock]').last().click();
  await page.waitForFunction(()=>State.currentView==='kline'&&State.currentRawData?.length>0);
  await page.locator('#maSettingsBtn').click();await page.locator('#maPeriodsInput').fill('20x,60');await page.locator('#maModalOk').click();
  if(!await page.locator('#maSettingsError').textContent())throw Error('Invalid MA accepted');
  await page.locator('#maPeriodsInput').fill('20,60,250');await page.locator('#maModalOk').click();
  await page.evaluate(()=>{if(State.klineChart.getOption().legend[0].selected.MA60!==false)State.klineChart.dispatchAction({type:'legendToggleSelect',name:'MA60'});});
  await page.reload();
  await page.getByRole('combobox',{name:'全部页面',exact:true}).selectOption('market');
  await page.getByRole('button',{name:'日线',exact:true}).click();
  await page.waitForFunction(()=>State.klineChart&&State.currentRawData?.length>0);
  const prefs=await page.evaluate(()=>({periods:State.maPeriods,ma60:State.klineChart.getOption().legend[0].selected.MA60}));
  if(JSON.stringify(prefs.periods)!=='[20,60,250]'||prefs.ma60!==false)throw Error('MA persistence failed '+JSON.stringify(prefs));
  await page.getByRole('combobox',{name:'全部页面',exact:true}).selectOption('darkFlow');
  await page.locator('[data-dark-board-stock]').first().waitFor();
  await page.locator('#darkBoardMetric').selectOption('ratio');
  await page.waitForFunction(()=>document.getElementById('darkBoardStatus').textContent.startsWith('数据 '));
  const ratio=await page.locator('#darkBoardInCount').textContent();
  if(await page.locator('body').evaluate(el=>el.classList.contains('dark')))await page.locator('#themeToggle').click();
  await page.screenshot({path:'output/playwright/flow-ratio-live-light.png'});
  return {layouts,allRows:count,renderMs,prefs,ratio};
}
