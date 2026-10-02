import {test,expect,Page} from './fixtures';
const DEV='http://127.0.0.1:5174';
async function open(page:Page){await page.getByRole('button',{name:'Help',exact:true}).click();return page.getByRole('dialog',{name:'Help & learning'});}

test('Help opens a complete read-only guide and isolates canvas commands',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(DEV);
 const before=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[10,20,40,30],strokeColor:'#FFFFFF'}),'Rectangle');return {snapshot:JSON.stringify(e.snapshot()),selection:e.selectedItems.map((o:any)=>o.id),tool:e.tool,undo:e.canUndo,redo:e.canRedo};});
 const dialog=await open(page);await expect(dialog).toBeVisible();await expect(dialog.getByRole('tab')).toHaveCount(14);await expect(dialog.getByRole('searchbox',{name:'Search help'})).toBeFocused();
 await dialog.getByRole('tab',{name:'Selection & path editing',exact:true}).click();await dialog.getByRole('tabpanel').focus();
 for(const key of ['n','Delete','Control+z','Control+s','Control+c','Control+v'])await page.keyboard.press(key);
 const after=await page.evaluate(()=>{const e=(window as any).__vectora;return {snapshot:JSON.stringify(e.snapshot()),selection:e.selectedItems.map((o:any)=>o.id),tool:e.tool,undo:e.canUndo,redo:e.canRedo};});expect(after).toEqual(before);
 await expect(dialog.getByRole('heading',{name:'Edit individual nodes',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(page.getByRole('button',{name:'Help',exact:true})).toBeFocused();expect(errors).toEqual([]);
});

test('Help search, topic arrows, links and empty results remain keyboard accessible',async({page})=>{
 await page.goto(DEV);await page.keyboard.press('F1');const dialog=page.locator('#help-dialog'),input=dialog.getByRole('searchbox');await expect(dialog).toBeVisible();
 await dialog.getByRole('tab',{name:'Start here',exact:true}).focus();await page.keyboard.press('ArrowDown');await expect(dialog.getByRole('tab',{name:'Keyboard shortcuts',exact:true})).toHaveAttribute('aria-selected','true');
 await page.keyboard.press('End');await expect(dialog.getByRole('tab',{name:'Troubleshooting',exact:true})).toBeFocused();await page.keyboard.press('Home');await expect(dialog.getByRole('tab',{name:'Start here',exact:true})).toBeFocused();
 await dialog.getByRole('button',{name:'Try a worked example'}).click();await expect(dialog.getByRole('tab',{name:'How-to examples',exact:true})).toHaveAttribute('aria-selected','true');await expect(dialog.getByRole('tabpanel')).toBeFocused();await expect(dialog.getByRole('img')).toHaveCount(4);
 await input.fill('single-line');await expect(dialog.getByRole('tab')).toHaveCount(1);await expect(dialog.getByRole('tabpanel')).toContainText('Hershey');await expect(input).toBeFocused();
 await input.fill('<img src=x onerror=alert(1)>');await expect(dialog.getByRole('heading',{name:'No matching guides'})).toBeVisible();await expect(dialog.locator('img')).toHaveCount(0);await expect(dialog.getByRole('status')).toHaveText('0 matching guides');
 await dialog.getByRole('button',{name:'Clear search'}).click();await expect(dialog.getByRole('tab')).toHaveCount(14);await expect(input).toBeFocused();
 await page.keyboard.press('Shift+Tab');expect(await page.evaluate(()=>document.activeElement?.closest('#help-dialog')!==null)).toBe(true);
 await dialog.getByRole('button',{name:'Close help'}).click();await expect(dialog).toBeHidden();
});

test('Help can be found through tool search and commits active text before opening',async({page})=>{
 await page.goto(DEV);await page.getByRole('button',{name:'Search tools',exact:true}).click();await page.getByRole('combobox',{name:'Search tools'}).fill('Help');await page.keyboard.press('Enter');await expect(page.locator('#help-dialog')).toBeVisible();await expect(page.getByRole('searchbox',{name:'Search help'})).toBeFocused();await page.keyboard.press('Escape');
 await page.evaluate(async()=>{const {loadTextFont}=await import('/src/text.ts');await Promise.all([loadTextFont('lato'),document.fonts.load('16px "Vectora Lato"')]);});
 await page.getByRole('button',{name:'Text',exact:true}).click();await page.mouse.click(350,300);await expect(page.locator('#inline-text')).toBeEditable();await page.locator('#inline-text').fill('Keep this text');await page.keyboard.press('F1');
 await expect(page.locator('#help-dialog')).toBeVisible();await expect(page.locator('#inline-text')).toBeHidden();expect(await page.evaluate(()=>(window as any).__vectora.objects[0].data.text.content)).toBe('Keep this text');
});

test('Help fits both themes, narrow viewports and short windows with independent scrolling',async({page})=>{
 await page.goto(DEV);const dialog=await open(page);
 await page.screenshot({path:'test-results/help-dark.png',scale:'css'});
 for(const theme of ['dark','light']){
  await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
  for(const viewport of [{width:1280,height:900},{width:390,height:750},{width:900,height:450}]){
   await page.setViewportSize(viewport);await dialog.getByRole('tab',{name:'Keyboard shortcuts',exact:true}).click();
   const metrics=await dialog.evaluate(el=>{const r=el.getBoundingClientRect(),content=el.querySelector('.help-content')!;return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,wide:el.scrollWidth>el.clientWidth,contentWide:content.scrollWidth>content.clientWidth,scrolls:content.scrollHeight>content.clientHeight};});
   expect(metrics.x).toBeGreaterThanOrEqual(0);expect(metrics.y).toBeGreaterThanOrEqual(0);expect(metrics.right).toBeLessThanOrEqual(viewport.width);expect(metrics.bottom).toBeLessThanOrEqual(viewport.height);expect(metrics.wide).toBe(false);expect(metrics.contentWide).toBe(false);expect(metrics.scrolls).toBe(true);
   await dialog.locator('.help-content').evaluate(el=>el.scrollTop=el.scrollHeight);await expect(dialog.getByRole('button',{name:'Close help'})).toBeInViewport();await expect(dialog.getByRole('searchbox')).toBeInViewport();
  }
 }
 await page.setViewportSize({width:1280,height:900});await dialog.getByRole('tab',{name:'How-to examples',exact:true}).click();await page.screenshot({path:'test-results/help-examples-light.png',scale:'css'});
});

test('Production and reference share the working Help guide and all icon and topic targets resolve',async({page})=>{
 for(const url of ['http://127.0.0.1:4173',DEV+'/reference/design-system.html']){
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);const dialog=await open(page);await expect(dialog.getByRole('tab')).toHaveCount(14);
  const broken=await dialog.evaluate(el=>[...el.querySelectorAll('use')].map(use=>use.getAttribute('href')!).filter(id=>!document.querySelector(id)));expect(broken).toEqual([]);
  await dialog.getByRole('searchbox').fill('SVG');await dialog.getByRole('tab',{name:'Save & export',exact:true}).click();await expect(dialog.getByRole('tabpanel')).toContainText('Default Artwork exports black');await page.keyboard.press('Escape');await expect(dialog).toBeHidden();expect(errors).toEqual([]);
 }
});
