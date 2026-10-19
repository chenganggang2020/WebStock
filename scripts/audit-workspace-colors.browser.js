async (page) => {
  await page.reload();
  await page.setViewportSize({width:1440,height:900});
  if (!(await page.locator('body').evaluate(node=>node.classList.contains('dark')))) await page.locator('#themeToggle').click();
  const picker=page.locator('#terminalPageSelect');
  const pages=await picker.locator('option').evaluateAll(nodes=>nodes.map(node=>node.value));
  const report=[];
  for (const id of pages) {
    await picker.selectOption(id); await page.waitForTimeout(250);
    const items=await page.locator('.main-view.active').evaluate(view=>{
      const seen=new Set();
      return [...view.querySelectorAll('*')].flatMap(node=>{
        const r=node.getBoundingClientRect(),s=getComputedStyle(node);
        if(r.width<100||r.height<20||r.top>=innerHeight||r.bottom<=0||!node.checkVisibility()) return [];
        const rgb=s.backgroundColor.match(/[\d.]+/g)||[];
        const bright=rgb.length>=3&&rgb.slice(0,3).every(n=>Number(n)>170)&&(rgb.length<4||Number(rgb[3])>.85);
        if(!bright && s.backgroundImage==='none') return [];
        const selector=node.id?'#'+node.id:'.'+[...node.classList].join('.');
        if(seen.has(selector))return [];seen.add(selector);
        return [{selector,bg:s.backgroundColor,image:s.backgroundImage.slice(0,170),text:s.color,area:Math.round(r.width*r.height)}];
      }).sort((a,b)=>b.area-a.area).slice(0,12);
    });
    report.push({id,items});
  }
  return report;
}
