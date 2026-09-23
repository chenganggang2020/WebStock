async (page) => {
  // Isolated UI fixtures: every research request is intercepted, including writes.
  const submissions=[];
  const topic={id:'bellows',name:'波纹管',enabled:false,sourceUrls:['https://example.com/fixture-only'],intervalMinutes:1440};
  let verified=false;
  const version=id=>({id,sequence:id==='v1'?2:1,createdAt:'2026-09-18T01:00:00Z',
    relations:[{id:'r1',product:id==='v1'?'测试器件（界面样本）':'旧版器件（界面样本）',stage:'components',status:verified?'verified':'candidate',
      company:null,claim:'这是隔离测试数据',evidenceRefs:[{evidenceId:'e1',quote:'<img src=x onerror=alert(1)> 应作为文字显示'}]}],
    evidence:[{id:'e1',title:'隔离测试原文',finalUrl:'https://example.com/fixture-only',publishedAt:null,fetchedAt:'2026-09-18T01:00:00Z',contentSha256:'fixture-hash'}]});
  const handler=async route=>{
    const request=route.request(),path='/api/'+request.url().split('/api/')[1].split('?')[0];
    let data;
    if(request.method()!=='GET') {
      submissions.push({path,body:request.postDataJSON()});
      if(path.endsWith('/review'))verified=true;
      data=topic;
    } else if(/\/versions\/v[01]$/.test(path))data=version(path.split('/').pop());
    else if(path.endsWith('/topics/bellows'))data={topic,currentVersion:version('v1'),versions:[version('v1'),version('v0')]};
    else data=[];
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({success:true,data})});
  };
  await page.route('**/api/industry-chain/research/**',handler);
  try {
    await page.getByRole('button',{name:'波纹管 原文研究 · 手动更新',exact:true}).click();
    await page.getByRole('button',{name:'关系图',exact:true}).click();
    await page.locator('.iw-node').first().waitFor();
    if(await page.locator('#iwEvidence img').count())throw Error('Untrusted source HTML executed');
    await page.getByRole('button',{name:'通过核验',exact:true}).click();
    if(submissions.length)throw Error('Review accepted without read acknowledgement');
    await page.getByText('版本与资料记录',{exact:true}).click();
    await page.locator('#industryResearchVersionSelect').selectOption('v0');
    await page.waitForFunction(()=>document.querySelector('#iwEvidence h3')?.textContent==='旧版器件（界面样本）');
    await page.getByText('版本与资料记录',{exact:true}).click();
    await page.locator('#industryResearchVersionSelect').selectOption('v1');
    await page.waitForFunction(()=>document.querySelector('#iwEvidence h3')?.textContent==='测试器件（界面样本）');
    await page.getByRole('checkbox',{name:'我已阅读原文'}).check();
    await page.getByRole('textbox',{name:'核验说明'}).fill('隔离测试，不提交真实研究库');
    await page.getByRole('button',{name:'通过核验',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#iwEvidence .iw-state')?.textContent==='人工核验');
    if(submissions.length!==1 || submissions[0].body.baseVersionId!=='v1' || submissions[0].body.relationIds[0]!=='r1')throw Error('Wrong review identity');
    await page.getByRole('button',{name:'待核验',exact:true}).click();
    await page.getByRole('heading',{name:'当前没有待核验项',exact:true}).waitFor();
    return {versionSwitch:true,reviewGuard:true,reviewIdentity:submissions[0].body.baseVersionId,safeText:true,writes:'one intercepted fixture request; none forwarded to production'};
  } catch(error) {
    const debug=await page.evaluate(()=>({history:document.querySelector('.iw-history')?.open,readerHidden:document.getElementById('iwEvidence').hidden,bodyHidden:document.getElementById('industryResearchDetail').hidden,heading:document.querySelector('#iwEvidence h3')?.textContent,status:document.getElementById('industryResearchStatus').textContent}));
    throw Error(error.message+' '+JSON.stringify(debug));
  } finally {
    await page.unroute('**/api/industry-chain/research/**',handler);
    await page.reload();
  }
}
