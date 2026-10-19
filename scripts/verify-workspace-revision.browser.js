async (page) => {
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.reload();await page.setViewportSize({width:1600,height:980});
  await page.getByRole('combobox',{name:'全部页面',exact:true}).selectOption('creatorTasks');
  await page.locator('#creatorTaskChannelSelect option').nth(1).waitFor({state:'attached'});
  const authors=await page.locator('#creatorTaskChannelSelect option').evaluateAll(nodes=>nodes.filter(n=>n.value).map(n=>({id:n.value,label:n.textContent})));
  if(await page.locator('#creatorTaskDateMode').inputValue()!=='all')throw Error('Default range not all history');
  const results=[];
  for(const author of authors.slice(0,2)) {
    await page.locator('#creatorTaskChannelSelect').selectOption(author.id);
    await page.waitForFunction(id=>String(expertSelectedChannelId())===id && !expertCreatorTaskRunsLoading && document.querySelector('#expertCreatorVideoList .creator-video-row'),author.id);
    const identity=await page.locator('#creatorActiveName').textContent();
    const videos=await page.locator('#expertCreatorVideoCount').textContent();
    if(!author.label.startsWith(identity))throw Error('Author identity mismatch');
    results.push({author:identity,videos});
  }
  await page.screenshot({path:'output/playwright/creator-current-dark.png'});
  await page.getByRole('button',{name:'批量采集 · 多作者',exact:true}).click();
  if(!await page.locator('#creatorBatchMode').isVisible())throw Error('Batch config inaccessible');
  await page.getByRole('button',{name:'全局设置 / 转写环境',exact:true}).click();
  if(!await page.locator('#creatorLoginStartup').isVisible())throw Error('Global config inaccessible');
  await page.getByRole('button',{name:'视频与逐字稿',exact:true}).click();
  const layouts=[];
  for(const [width,height] of [[1600,980],[1366,768],[1024,768]]) {
    await page.setViewportSize({width,height});
    const layout=await page.evaluate(()=>{
      const controls=document.querySelector('.creator-task-control-card').getBoundingClientRect(),main=document.querySelector('.fixed-creator-main').getBoundingClientRect();
      return {width:innerWidth,height:innerHeight,documentOverflow:document.documentElement.scrollHeight-innerHeight,horizontal:document.documentElement.scrollWidth-innerWidth,controlWidth:controls.width,mainTop:main.top,controlBottom:controls.bottom};
    });
    if(layout.documentOverflow>1 || layout.horizontal>1 || layout.controlBottom>layout.mainTop)throw Error('Creator layout '+JSON.stringify(layout));layouts.push(layout);
  }
  await page.setViewportSize({width:1600,height:980});
  await page.getByRole('combobox',{name:'全部页面',exact:true}).selectOption('darkFlow');
  await page.locator('[data-dark-board-stock]').first().waitFor({timeout:70000});
  const coverage=await page.locator('#darkBoardInCount').textContent();
  await page.locator('#darkBoardLimit').selectOption('300');
  if(await page.locator('#darkBoardIn .dark-flow-row').count()<=50)throw Error('Ranking truncated');
  await page.screenshot({path:'output/playwright/flow-comparison-live-dark.png'});
  const selected=page.locator('[data-dark-board-stock]').first();const stockName=await selected.textContent();
  await selected.click();
  await page.waitForFunction(()=>State.currentView==='kline' && State.currentRawData?.length>0);
  if(!(await page.locator('#chartTitle').textContent()).includes(stockName.replace(/^\d+\.\s*/,'')))throw Error('Stock chart identity');
  await page.locator('#maSettingsBtn').click();
  await page.locator('#maPresets [data-ma-periods="5,20,60,120,250"]').click();
  await page.locator('#maModalOk').click();
  await page.screenshot({path:'output/playwright/kline-custom-ma-live-dark.png'});
  await page.locator('#darkBoardBack').click();
  await page.getByRole('button',{name:'行业资金汇总',exact:true}).click();
  await page.locator('#darkBoardSectors tbody tr').first().waitFor({timeout:45000});
  await page.screenshot({path:'output/playwright/sector-flow-live-dark.png'});
  if(errors.length)throw Error(JSON.stringify(errors));
  return {authors:results,layouts,coverage,stockName,errors,note:'Real live data via write-blocked preview; no collection task submitted.'};
}
