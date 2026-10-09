async page => {
  const checks=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  // Reuse the native fixture initialized by app-flow-browser, never a real account.
  await page.evaluate(()=>{if(document.body.classList.contains('chart-expanded'))WebStockPhoneBack();StandaloneApp.navigate('docs');StandaloneApp.navigate('settings');WebStockPhoneBack();});
  checks.push({name:'back-home-no-history',pass:await page.evaluate(()=>document.body.dataset.page==='watch'&&WebStockPhoneBack()===false)});
  checks.push({name:'five-primary-tabs',pass:await page.locator('#bottomNav span').allTextContents().then(x=>x.join('/')==='自选/市场/研究/账户/我的')});
  await page.locator('#bottomNav [data-page=dashboard]').click();
  await page.locator('[data-stock="sh000001"]').click();
  await page.waitForFunction(()=>qaRequests.some(r=>r.path.startsWith('/kline?code=sh000001&')||r.path==='/minute?code=sh000001'),{},{timeout:5000});
  checks.push({name:'index-identity-entry',pass:await page.locator('#content').innerText().then(t=>t.includes('上证指数')&&!t.includes('录入账本'))});
  await page.locator('[data-action=expand-chart]').click();
  await page.evaluate(()=>WebStockPhoneBack());
  checks.push({name:'back-closes-fullscreen-first',pass:await page.evaluate(()=>document.body.dataset.page==='stock'&&!document.body.classList.contains('chart-expanded'))});
  await page.evaluate(()=>WebStockPhoneBack());
  checks.push({name:'back-from-index-home',pass:await page.evaluate(()=>document.body.dataset.page==='watch'&&!WebStockPhoneBack())});
  await page.screenshot({path:'output/playwright/android-home-navigation.png'});
  checks.push({name:'no-page-errors',pass:errors.length===0});
  return {fixture:true,checks,pass:checks.filter(c=>c.pass).length,total:checks.length,errors};
}
