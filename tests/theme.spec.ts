import { test, expect } from '@playwright/test';
const DEV='http://127.0.0.1:5174';
async function appearance(page:any){await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('tab',{name:'Appearance',exact:true}).click();}

test('Light mode themes the workspace and neutral artwork without changing document history',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(DEV);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  const before=await page.evaluate(async()=>{
    const e=(window as any).__vectora,p=(window as any).__paper;
    e.addShape(new p.Path.Rectangle({rectangle:[50,40,60,30],strokeColor:'#FFFFFF',insert:false}),'Rectangle');
    e.addShape(new p.Path.Circle({center:[140,60],radius:15,fillColor:'#FFFFFF',data:{regionFill:true,rasterTrace:{mode:"fill"}},insert:false}),'Custom white fill');
    const {loadTextFont}=await import('/src/text.ts');await loadTextFont('lato');e.saveText('Text',10,new p.Point(100,110),null,'lato');
    return {snapshot:JSON.stringify(e.snapshot()),undo:e.canUndo,redo:e.canRedo};
  });
  await appearance(page);await page.locator('[name="appearance-theme"][value="light"]').check();
  await expect(page.locator('#preferences-shell')).toHaveCSS('background-color','rgb(245, 246, 248)');
  await expect(page.locator('#preferences-shell')).toHaveCSS('color','rgb(40, 43, 49)');
  await expect(page.locator('.ruler-bottom')).toHaveCSS('background-color','rgb(245, 246, 248)');
  await page.screenshot({path:'test-results/light-appearance.png'});
  const after=await page.evaluate(()=>{
    const e=(window as any).__vectora;return {snapshot:JSON.stringify(e.snapshot()),undo:e.canUndo,redo:e.canRedo,stroke:e.objects[0].strokeColor.toCSS(true),fill:e.objects[1].fillColor.toCSS(true),grid:e.grid.layer.children[0].strokeColor.toCSS(true),text:e.objects[2].fillColor.toCSS(true)};
  });
  expect(after.snapshot).toBe(before.snapshot);expect(after.undo).toBe(before.undo);expect(after.redo).toBe(before.redo);
  expect(after.stroke).toBe('#383838');expect(after.text).toBe('#383838');expect(after.fill).toBe('#ffffff');expect(['#e6eaf0','#c8d1dd']).toContain(after.grid);
  await page.keyboard.press('Escape');await expect(page.locator('[aria-label="Select"]')).toHaveCSS('background-color','rgb(220, 234, 243)');await page.screenshot({path:'test-results/light-workspace.png'});
  await page.evaluate(()=>{const e=(window as any).__vectora;e.undo();e.redo();});
  expect(await page.evaluate(()=>(window as any).__vectora.objects[0].strokeColor.toCSS(true))).toBe('#383838');
  await appearance(page);await page.locator('[name="appearance-theme"][value="dark"]').check();
  expect(await page.evaluate(()=>(window as any).__vectora.objects[0].strokeColor.toCSS(true))).toBe('#ffffff');
  await expect(page.locator('#workspace')).toHaveCSS('background-color','rgb(32, 34, 38)');
  await page.locator('[name="appearance-theme"][value="light"]').check();await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await appearance(page);await expect(page.locator('[name="appearance-theme"][value="light"]')).toBeChecked();
  expect(errors).toEqual([]);
});

test('Light mode works in the reference, narrow layouts and production preview',async({page})=>{
  for(const url of [DEV+'/reference/design-system.html','http://127.0.0.1:4173']){
    await page.goto(url);await appearance(page);await page.locator('[name="appearance-theme"][value="light"]').check();
    await expect(page.locator('#preferences-shell')).toHaveCSS('background-color','rgb(245, 246, 248)');
    await page.setViewportSize({width:390,height:750});
    expect(await page.locator('#preferences-shell').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    await page.keyboard.press('Escape');await page.setViewportSize({width:1280,height:900});
  }
  await page.getByRole('button',{name:'Preview',exact:true}).click();
  await expect(page.locator('.preview3d-view')).toHaveCSS('background-color','rgb(238, 241, 245)');
});
