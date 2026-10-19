async (page) => {
  const errors=[], responses=[], authors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',async d=>{errors.push(d.message());await d.dismiss();});
  page.on('response',async r=>{if(r.url().includes('/api/knowledge/sources?')&&r.status()===200) responses.push((await r.json()).data);});
  await page.reload();
  await page.setViewportSize({width:1600,height:960});
  await page.getByRole('combobox',{name:'全部页面',exact:true}).selectOption('evidence');
  await page.locator('#knowledgeAuthorFilter option').filter({hasText:'模型先生'}).waitFor({state:'attached'});
  for(const author of ['模型先生','Fioona','模型先生']) {
    await page.locator('#knowledgeAuthorFilter').selectOption(author);
    await page.waitForFunction(author=>document.querySelector('.evidence-document-head p')?.textContent.startsWith(author+' ·'),author);
    await page.locator('.evidence-source-item').first().click();
    await page.locator('.evidence-document-body').waitFor();
    const state=await page.locator('#knowledgeSourceList').evaluate(list=>({count:list.querySelectorAll('.evidence-source-item').length,titles:[...list.querySelectorAll('strong')].map(n=>n.textContent),dates:[...list.querySelectorAll('time')].map(n=>n.textContent)}));
    if(state.titles.some(t=>/于\d{8}发布的作品/.test(t))) throw new Error('Placeholder remains');
    const latest=responses.at(-1)||[];
    if(!latest.length||latest.some(s=>(s.author||'')!==author))throw new Error('Cross-author response');
    authors.push({author,count:state.count,firstTitle:state.titles[0],firstDate:state.dates[0]});
  }
  if(!(await page.locator('body').evaluate(n=>n.classList.contains('dark')))) await page.locator('#themeToggle').click();
  await page.screenshot({path:'output/playwright/black-authors-evidence-dark.png'});
  const colors=await page.locator('body').evaluate(n=>Object.fromEntries(['--bg','--card-bg','--muted-bg','--text','--text-secondary'].map(k=>[k,getComputedStyle(n).getPropertyValue(k).trim()])));
  await page.locator('#themeToggle').click();
  await page.screenshot({path:'output/playwright/black-authors-evidence-light.png'});
  await page.locator('#themeToggle').click();
  await page.getByRole('combobox',{name:'全部页面',exact:true}).selectOption('dashboard');
  await page.waitForTimeout(1200);
  await page.screenshot({path:'output/playwright/black-authors-home.png'});
  await page.getByRole('combobox',{name:'全部页面',exact:true}).selectOption('industryChain');
  await page.waitForTimeout(800);
  await page.screenshot({path:'output/playwright/black-authors-industry.png'});
  if(errors.length) throw new Error(JSON.stringify(errors));
  return {authors,colors,errors,note:'Real data snapshot, mutations blocked; not installed desktop acceptance'};
}
