async (page) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => { errors.push('BLOCKING DIALOG: '+dialog.message()); await dialog.dismiss(); });
  const picker = page.getByRole('combobox', {name:'全部页面', exact:true});
  const pages = await picker.locator('option').evaluateAll(nodes => nodes.map(node=>({id:node.value,title:node.textContent})));
  const results = [];
  for (const viewport of [{width:1440,height:900},{width:1280,height:800},{width:1920,height:1080}]) {
    await page.setViewportSize(viewport);
    for (const entry of pages) {
      await picker.selectOption(entry.id);
      await page.waitForTimeout(140);
      results.push(await page.evaluate(({entry,viewport})=>{
        const view=document.querySelector('.main > .main-view.active');
        const box=view?.getBoundingClientRect();
        const panel=view?.querySelector('.fixed-page-panel:not([hidden])');
        return {page:entry.id,viewport,rootOverflow:document.documentElement.scrollHeight>innerHeight+2 || document.documentElement.scrollWidth>innerWidth+2,
          bounds:box?{x:box.x,y:box.y,width:box.width,height:box.height}:null,
          valid:!!box && box.height>200 && box.bottom<=innerHeight+2 && box.width>800,
          panel:panel?.id || null, panelHeight:panel?.clientHeight || null};
      }, {entry,viewport}));
    }
  }
  await page.setViewportSize({width:1440,height:900});
  for (const id of ['dashboard','capitalFlow','industryChain','creatorTasks','aiResearch','settings','watchlist','commentStrategy','compoundLab']) {
    await picker.selectOption(id);
    await page.waitForTimeout(300);
    await page.screenshot({path:'output/playwright/compact-full-'+id+'.png'});
  }
  return {count:results.length,failures:results.filter(row=>!row.valid || row.rootOverflow),errors};
}
