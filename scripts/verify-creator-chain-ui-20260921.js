async (page) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByRole('combobox', { name: '全部页面', exact: true }).selectOption('industryChain');
  const fioona = page.getByRole('button', { name: 'Fioona · 文稿关系 作者文稿 · 按发布日期更新', exact: true });
  await fioona.waitFor({ state: 'visible', timeout: 45000 });
  await fioona.click();
  await page.getByText('100 条 / 已载入 100 条', { exact: true }).waitFor();
  await page.screenshot({ path: 'output/playwright/fioona-100-relations.png' });
  await page.getByRole('button', { name:'关系列表', exact:true }).click();
  await page.getByRole('columnheader', { name:'实体关系', exact:true }).waitFor();
  await page.screenshot({ path:'output/playwright/fioona-relations-table.png' });
  await page.getByRole('combobox', { name:'全部页面', exact:true }).selectOption('capitalFlow');
  await page.getByRole('textbox', { name:'资金历史日期', exact:true }).fill('2026-09-16');
  await page.getByRole('textbox', { name:'资金历史日期', exact:true }).press('Tab');
  await page.screenshot({ path:'output/playwright/capital-history-controls.png' });
  await page.getByRole('combobox', { name:'全部页面', exact:true }).selectOption('creatorTasks');
  await page.getByRole('combobox', { name:'切换当前作者', exact:true }).selectOption('5');
  await page.getByText('110 条抖音作品', { exact:true }).waitFor();
  await page.screenshot({ path:'output/playwright/note-only-110.png' });
  console.log('UI checks: 100 relations; table; historical date controls; author note-only 110 works.');
}
