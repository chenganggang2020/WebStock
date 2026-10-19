async (page) => {
  const errors = [], dialogs = [];
  page.on('pageerror', error=>errors.push(error.message));
  page.on('dialog', async dialog=>{dialogs.push(dialog.message());await dialog.dismiss();});
  await page.reload();
  await page.setViewportSize({width:1440,height:900});
  const picker=page.getByRole('combobox',{name:'全部页面',exact:true});
  const pages=await picker.locator('option').evaluateAll(nodes=>nodes.map(node=>({id:node.value,label:node.textContent})));
  const captures=[];
  for(const theme of ['light','dark']) {
    const dark=await page.locator('body').evaluate(node=>node.classList.contains('dark'));
    if(dark !== (theme==='dark')) await page.locator('#themeToggle').click();
    for(const entry of pages) {
      await picker.selectOption(entry.id);
      await page.waitForTimeout(650);
      const filename='output/playwright/compact-review/'+entry.id+'-'+theme+'.png';
      await page.screenshot({path:filename});
      captures.push({page:entry.id,theme,file:filename,hash:page.url().split('#')[1]});
    }
  }
  const duplicates=await page.evaluate(()=>{
    const count={};document.querySelectorAll('[id]').forEach(node=>count[node.id]=(count[node.id]||0)+1);
    return Object.entries(count).filter(([id,n])=>n>1);
  });
  await picker.selectOption('rotation');
  await picker.selectOption('darkFlow');
  await page.goBack();
  const back=await picker.inputValue();
  await page.goForward();
  const forward=await picker.inputValue();
  await picker.selectOption('dashboard');
  const group=await page.locator('#homeGroups').inputValue();
  const options=await page.locator('#homeGroups option').evaluateAll(nodes=>nodes.map(node=>node.value));
  const alternate=options.find(value=>value!==group);
  if(alternate) {await page.locator('#homeGroups').selectOption(alternate);await page.locator('#homeGroups').selectOption(group);}
  const comments=[];
  await picker.selectOption('commentStrategy');
  for(const id of ['Evidence','Creator','Rules','Map']) {
    await page.locator('#commentStrategyTab'+id).click();
    comments.push({id,visible:await page.locator('#commentStrategyPanel'+id).isVisible()});
  }
  const deepLinks=[];
  for(const id of ['auction','etf','darkFlow','rotation','replay','evidence','authors','health']) {
    await picker.selectOption(id);await page.reload();
    await picker.waitFor();await page.waitForTimeout(250);
    deepLinks.push({id,selected:await picker.inputValue(),title:await page.title()});
  }
  await picker.selectOption('dashboard');
  return {captures:captures.length,duplicates,errors,dialogs,history:{back,forward},groups:options.length,comments,deepLinks};
}
