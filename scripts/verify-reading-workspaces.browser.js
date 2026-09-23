async (page) => {
  const errors=[], checks=[];
  page.on('pageerror', error=>errors.push(error.message));
  page.on('dialog', async dialog=>{errors.push('blocking: '+dialog.message());await dialog.dismiss();});
  await page.setViewportSize({width:1600,height:960});
  if (await page.locator('body').evaluate(node=>node.classList.contains('dark'))) await page.locator('#themeToggle').click();
  const picker=page.getByRole('combobox',{name:'全部页面',exact:true});
  await picker.selectOption('capitalDaily');
  for (const id of ['capitalFlow','darkFlow','rotation','replay','capitalIntraday','capitalDaily']) {
    await picker.selectOption(id);
    checks.push({id,duplicateNav:await page.locator('[data-deck="capital"] > nav').isVisible(),title:await page.locator('#terminalContextTitle').textContent(),active:await page.locator('[data-deck="capital"]').getAttribute('data-active-panel')});
  }
  await page.reload();
  await page.waitForFunction(()=>document.body.dataset.terminalPage === 'capitalDaily');
  const restored=await picker.inputValue();
  await page.screenshot({path:'output/playwright/reading-capital-light.png'});
  await picker.selectOption('aiResearch');
  const separated=!(await page.locator('#knowledgeSourceList').isVisible()) && await page.locator('.research-decision-band').isVisible();
  await page.screenshot({path:'output/playwright/reading-research-light.png'});
  await picker.selectOption('evidence');
  await page.locator('#knowledgeAuthorFilter option').filter({hasText:'Fioona'}).waitFor({state:'attached'});
  await page.locator('#knowledgeAuthorFilter').selectOption('Fioona');
  await page.waitForFunction(()=>document.querySelector('.evidence-document-head p')?.textContent.startsWith('Fioona ·'));
  await page.locator('.evidence-source-item').first().click();
  await page.locator('.evidence-document-body').waitFor();
  const evidence={count:await page.locator('.evidence-source-item').count(),chars:(await page.locator('.evidence-document-body').textContent()).length,leftAiMenu:await page.locator('[data-deck="research"] nav').isVisible()};
  await page.screenshot({path:'output/playwright/reading-evidence-light.png'});
  await page.getByRole('button',{name:'以此资料分析',exact:true}).click();
  evidence.analysisVisible=await page.locator('#knowledgeAnalysisPanel').isVisible();
  evidence.selectedSource=await page.locator('#knowledgeSourceFilter').inputValue();
  await page.getByRole('button',{name:'原文阅读',exact:true}).click();
  await page.locator('#themeToggle').click();
  await page.screenshot({path:'output/playwright/reading-evidence-dark.png'});
  await page.locator('#themeToggle').click();
  await picker.selectOption('news');
  await page.locator('#newsList [data-news-index]').filter({hasText:'朱民：人民币国际化有两大内在逻辑'}).first().click();
  await page.waitForFunction(()=>document.querySelector('#newsArticleStatus').textContent !== '正在读取公开正文…');
  const news={status:await page.locator('#newsArticleStatus').textContent(),paragraphs:await page.locator('#newsArticleBody p').count(),summaryHidden:!(await page.locator('#newsDetailSummary').isVisible()),inline:await page.locator('#newsInlineReader .news-detail-modal').count()};
  await page.screenshot({path:'output/playwright/reading-news-light.png'});
  await page.locator('#themeToggle').click();
  await page.screenshot({path:'output/playwright/reading-news-dark.png'});
  const duplicateIds=await page.evaluate(()=>{const seen=new Set();return [...document.querySelectorAll('[id]')].filter(n=>seen.has(n.id)||!seen.add(n.id)).map(n=>n.id);});
  const result={checks,restored,separated,evidence,news,duplicateIds,errors};
  if(checks.some(c=>c.duplicateNav)||restored!=='capitalDaily'||!separated||evidence.leftAiMenu||!evidence.analysisVisible||!news.paragraphs||duplicateIds.length||errors.length) throw new Error(JSON.stringify(result));
  return result;
}
