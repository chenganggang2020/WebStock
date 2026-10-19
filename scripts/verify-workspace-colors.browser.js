async (page) => {
  await page.reload();
  const failures=[],checks=[];
  const picker=page.locator('#terminalPageSelect');
  const pages=await picker.locator('option').evaluateAll(nodes=>nodes.map(node=>node.value));
  for(const dark of [true,false]) {
    if(await page.locator('body').evaluate(node=>node.classList.contains('dark'))!==dark) await page.locator('#themeToggle').click();
    for(const id of pages) {
      await picker.selectOption(id); await page.waitForTimeout(200);
      const result=await page.locator('.main-view.active').evaluate((view,dark)=>{
        const errors=[],expected=dark?'rgb(14, 28, 42)':'rgb(255, 255, 255)';
        const muted=dark?'rgb(145, 167, 189)':'rgb(88, 108, 129)';
        view.querySelectorAll('.flow-replay-panel,.settings-card,.industry-research-panel,.creator-task-control-card').forEach(node=>{
          if(node.checkVisibility()&&getComputedStyle(node).backgroundColor!==expected)errors.push(node.className+': '+getComputedStyle(node).backgroundColor);
        });
        view.querySelectorAll('.muted').forEach(node=>{
          if(node.checkVisibility()&&getComputedStyle(node).color!==muted)errors.push('.muted: '+getComputedStyle(node).color);
        });
        if(dark) view.querySelectorAll('*').forEach(node=>{
          if(!node.checkVisibility())return;
          const r=node.getBoundingClientRect(),s=getComputedStyle(node),rgb=s.backgroundColor.match(/[\d.]+/g)||[];
          if(r.width>100&&r.height>20&&rgb.length>=3&&rgb.slice(0,3).every(n=>+n>170)&&(rgb.length<4||+rgb[3]>.85))errors.push('light surface: '+(node.id||node.className));
        });
        return [...new Set(errors)];
      },dark);
      checks.push({page:id,theme:dark?'dark':'light'});
      if(result.length)failures.push({id,dark,errors:result});
    }
  }
  return {checks:checks.length,failures};
}
