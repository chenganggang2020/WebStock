async (page) => {
  await page.reload();
  await page.getByRole('combobox',{name:'全部页面',exact:true}).selectOption('industryChain');
  let fail=true;
  const handler=route=>route.fulfill({status:fail?503:200,contentType:'application/json',body:JSON.stringify(fail?
    {success:false,error:{message:'隔离测试：主题暂不可用'}}:
    {success:true,data:{topic:{id:'diamond-thermal',name:'金刚石散热',sourceUrls:[],enabled:false},currentVersion:null,versions:[]}})});
  await page.route('**/api/industry-chain/research/topics/diamond-thermal',handler);
  try {
    await page.getByRole('button',{name:'金刚石散热 原文研究 · 手动更新',exact:true}).click();
    await page.getByRole('heading',{name:'读取失败，请重试',exact:true}).waitFor();
    if((await page.locator('#iwFooter').textContent()).includes('0 个'))throw Error('Failure is being presented as zero sources');
    await page.getByRole('button',{name:'资料管理',exact:true}).click();
    if(!await page.locator('#industryResearchSourceUrls').isDisabled())throw Error('Failed topic editable');
    if(await page.locator('#industryResearchPanel').getAttribute('aria-busy')==='true')throw Error('Failure stuck in loading');
    fail=false;
    await page.getByRole('button',{name:'重新读取主题',exact:true}).click();
    await page.getByRole('heading',{name:'还没有可绘制的研究关系',exact:true}).waitFor();
    if(await page.locator('#industryResearchSourceUrls').isDisabled())throw Error('Retry did not restore editing');
    return {honestFailure:true,retry:true,failedTopicProtected:true,note:'Intercepted responses only, no production write'};
  } finally {
    await page.unroute('**/api/industry-chain/research/topics/diamond-thermal',handler);
    await page.reload();
  }
}
