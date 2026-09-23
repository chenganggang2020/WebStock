async (page) => {
  const picker=page.getByRole('combobox',{name:'全部页面',exact:true});
  await picker.selectOption('creatorTasks');
  await page.locator('#creatorTaskDateMode').selectOption('all');
  await page.waitForTimeout(1500);
  const count=await page.locator('.creator-video-list').innerText();
  for(const theme of ['dark','light']) {
    const dark=await page.locator('body').evaluate(node=>node.classList.contains('dark'));
    if(dark!==(theme==='dark')) await page.locator('#themeToggle').click();
    await page.screenshot({path:'output/playwright/compact-review/creatorTasks-'+theme+'.png'});
  }
  await picker.selectOption('industryChain');
  const topic=page.locator('[data-research-topic-id="bellows"]');
  await topic.click();await page.waitForTimeout(500);
  for(const theme of ['light','dark']) {
    const dark=await page.locator('body').evaluate(node=>node.classList.contains('dark'));
    if(dark!==(theme==='dark')) await page.locator('#themeToggle').click();
    await page.screenshot({path:'output/playwright/compact-review/industryChain-'+theme+'.png'});
  }
  await picker.selectOption('dashboard');
  await page.locator('[data-period="minute"]').click();
  await page.waitForTimeout(1200);
  for(const theme of ['dark','light']) {
    const dark=await page.locator('body').evaluate(node=>node.classList.contains('dark'));
    if(dark!==(theme==='dark')) await page.locator('#themeToggle').click();
    await page.screenshot({path:'output/playwright/compact-review/dashboard-'+theme+'.png'});
  }
  return {creatorHistoryDisplayed:count.includes('当前') || count.length>50,historyTextLength:count.length};
}
