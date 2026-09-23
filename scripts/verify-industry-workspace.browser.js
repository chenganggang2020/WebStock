async (page) => {
  const errors=[],writes=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(request.url().includes('/api/industry-chain') && request.method()!=='GET')writes.push(request.url());});
  await page.reload();
  await page.setViewportSize({width:1600,height:980});
  await page.getByRole('combobox',{name:'全部页面',exact:true}).selectOption('industryChain');
  await page.locator('.iw-node').first().waitFor();
  const counts=await page.locator('#iwCount').textContent();
  await page.evaluate(()=>{window.__industryFirstNode=document.querySelector('.iw-node');});
  const target=page.locator('.iw-node').nth(1);
  const name=await target.locator('strong').textContent();
  await target.click();
  if(await page.locator('#iwEvidence h3').textContent()!==name)throw Error('Evidence reader not linked');
  if(!await page.evaluate(()=>window.__industryFirstNode===document.querySelector('.iw-node')))throw Error('Graph rebuilt on selection');
  await page.evaluate(()=>window.IndustryChain.load());
  if(!await page.evaluate(()=>window.__industryFirstNode===document.querySelector('.iw-node')))throw Error('Repeated initial navigation rebuilt the accepted graph');
  await page.getByRole('combobox',{name:'筛选产业链环节'}).selectOption('components');
  const filtered=await page.locator('.iw-node[aria-pressed="true"] strong').textContent();
  if(await page.locator('#iwEvidence h3').textContent()!==filtered)throw Error('Stage filter left evidence from a different selection');
  await page.getByRole('combobox',{name:'筛选产业链环节'}).selectOption('');
  await page.locator('.iw-node').nth(1).click();
  if(!(await page.locator('body').evaluate(node=>node.classList.contains('dark'))))await page.locator('#themeToggle').click();
  await page.screenshot({path:'output/playwright/industry-live-graph-dark.png'});
  await page.getByRole('button',{name:'公司清单',exact:true}).click();
  if(await page.locator('#iwEvidence h3').textContent()!==name)throw Error('Selection lost between graph and table');
  await page.locator('#themeToggle').click();
  await page.screenshot({path:'output/playwright/industry-live-table-light.png'});
  await page.getByRole('button',{name:'金刚石散热 原文研究 · 手动更新',exact:true}).click();
  await page.getByRole('heading',{name:'还没有可绘制的研究关系'}).waitFor();
  if(await page.locator('.iw-node').count())throw Error('Fictitious nodes in empty topic');
  await page.getByRole('button',{name:'登记来源',exact:true}).click();
  await page.locator('#industryResearchSourceUrls').fill('https://example.com/unsaved-preview-only');
  await page.getByRole('button',{name:'波纹管 原文研究 · 手动更新',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('industryResearchStatus').textContent.includes('已加载研究主题：波纹管'));
  if(await page.locator('#industryResearchSourceUrls').inputValue())throw Error('Source draft leaked to another topic');
  await page.getByRole('button',{name:'金刚石散热 原文研究 · 手动更新',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('industryResearchStatus').textContent.includes('已加载研究主题：金刚石散热'));
  if(await page.locator('#industryResearchSourceUrls').inputValue()!=='https://example.com/unsaved-preview-only')throw Error('Unsaved source draft lost');
  await page.locator('#industryResearchSourceUrls').fill('');
  await page.screenshot({path:'output/playwright/industry-live-empty-source.png'});
  await page.getByRole('button',{name:'半导体 行业线索',exact:true}).click();
  await page.getByRole('button',{name:'关系图',exact:true}).click();
  await page.getByRole('button',{name:'返回证据',exact:true}).click();
  await page.locator('.iw-node').first().waitFor();
  const layouts=[];
  for(const [width,height] of [[1600,980],[1366,768],[1024,768],[768,900]]) {
    await page.setViewportSize({width,height});
    const layout=await page.evaluate(()=>{
      const host=document.getElementById('industryChainView'),rect=host.getBoundingClientRect();
      return {width:innerWidth,height:innerHeight,documentOverflow:document.documentElement.scrollHeight-innerHeight,
        hostOverflow:host.scrollHeight-host.clientHeight,horizontal:host.scrollWidth-host.clientWidth,
        readerWidth:document.querySelector('.iw-reader').getBoundingClientRect().width,bottom:rect.bottom};
    });
    if(layout.documentOverflow>1 || layout.hostOverflow>1 || layout.horizontal>1)throw Error('Workspace overflow: '+JSON.stringify(layout));
    layouts.push(layout);
  }
  await page.setViewportSize({width:1600,height:980});
  await page.locator('#themeToggle').click();
  if(errors.length || writes.length)throw Error(JSON.stringify({errors,writes}));
  return {counts,layouts,errors,writes,selectionContinuity:true,topicDraftIsolation:true,emptyState:true,note:'Real local API data via read-only preview, not a replacement of the running desktop'};
}
