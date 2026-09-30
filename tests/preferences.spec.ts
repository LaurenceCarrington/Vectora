import { test, expect } from './fixtures';
const DEV='http://127.0.0.1:5174';

test('Preferences matches the reference, navigates accessibly and keeps placeholders inert',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const style=()=>page.locator('#preferences-shell').evaluate(element=>{const s=getComputedStyle(element);return {background:s.backgroundColor,color:s.color,width:s.width,height:s.height,borderRadius:s.borderRadius};});
  await page.goto(DEV+'/reference/design-system.html');
  await page.getByRole('button',{name:'Settings',exact:true}).click();const reference=await style();
  await page.goto(DEV);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');
  await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({rectangle:[30,30,20,20],insert:false}),'Rectangle');});
  const before=await page.evaluate(()=>{const e=(window as any).__vectora;return {snapshot:e.snapshot(),tool:e.tool,grid:e.snapToGridEnabled,snapping:e.snappingEnabled};});
  const gear=page.getByRole('button',{name:'Settings',exact:true});await gear.click();
  const dialog=page.getByRole('dialog',{name:'Preferences',exact:true});await expect(dialog).toBeVisible();
  expect(await style()).toEqual(reference);
  await expect(dialog.getByRole('tab',{name:'Snapping',exact:true})).toBeFocused();
  await dialog.getByRole('tab',{name:'Grid',exact:true}).click();
  await expect(dialog.getByRole('tabpanel',{name:'Grid',exact:true})).toBeVisible();
  await expect(dialog.getByRole('spinbutton',{name:'Grid size'})).toHaveValue('10');
  await expect(dialog.getByRole('status')).toHaveText('Changes apply immediately.');
  await dialog.getByRole('tab',{name:'Snapping',exact:true}).click();
  await expect(dialog.locator('input')).toHaveCount(10);
  expect(await dialog.locator('[role="tabpanel"]').evaluateAll(panels=>panels.length===5&&panels.filter(panel=>!['pref-page-snapping','pref-page-grid','pref-page-appearance'].includes(panel.id)).every(panel=>panel.childElementCount===0&&panel.textContent===''))).toBe(true);
  await expect(dialog.getByRole('button',{name:'Reset preferences',exact:true})).toHaveCount(0);
  await expect(dialog.getByRole('status')).toHaveText('Changes apply immediately.');
  await page.keyboard.press('ArrowDown');await expect(dialog.getByRole('tab',{name:'Appearance',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(dialog.getByRole('tabpanel',{name:'Appearance',exact:true})).toBeVisible();
  await page.keyboard.press('Home');await expect(dialog.getByRole('tab',{name:'General',exact:true})).toBeFocused();
  for(const key of ['r','s','Delete','Control+z','Space'])await page.keyboard.press(key);
  expect(await page.evaluate(()=>{const e=(window as any).__vectora;return {snapshot:e.snapshot(),tool:e.tool,grid:e.snapToGridEnabled,snapping:e.snappingEnabled};})).toEqual(before);
  for(let i=0;i<8;i++){await page.keyboard.press('Tab');expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);}
  await dialog.getByRole('tab',{name:'Snapping',exact:true}).click();
  await page.screenshot({path:'test-results/preferences-desktop.png'});
  await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(gear).toBeFocused();
  expect(await page.evaluate(()=>(window as any).__vectora.selectedItems.length)).toBe(1);
  await gear.click();await dialog.getByRole('button',{name:'Close preferences',exact:true}).click();await expect(dialog).toBeHidden();await expect(gear).toBeFocused();
  await page.setViewportSize({width:390,height:750});await gear.click();
  const bounds=(await dialog.boundingBox())!;expect(bounds.x).toBeGreaterThanOrEqual(16);expect(bounds.x+bounds.width).toBeLessThanOrEqual(374);expect(bounds.y).toBeGreaterThanOrEqual(16);expect(bounds.y+bounds.height).toBeLessThanOrEqual(734);
  await expect(dialog.getByRole('button',{name:'Close preferences',exact:true})).toBeInViewport();
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.screenshot({path:'test-results/preferences-mobile.png'});
  expect(errors).toEqual([]);
});

test('production Settings opens the placeholder Preferences dialog',async({page})=>{
  await page.goto('http://127.0.0.1:4173');await page.getByRole('button',{name:'Settings',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Preferences',exact:true});await expect(dialog).toBeVisible();
  await dialog.getByRole('tab',{name:'Editing',exact:true}).click();await expect(dialog.getByRole('tabpanel',{name:'Editing',exact:true})).toBeEmpty();
  await page.keyboard.press('Escape');await expect(dialog).toBeHidden();
});

test('Grid size stays fixed through zoom, controls snapping and persists without editing artwork',async({page})=>{
  await page.goto(DEV);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');
  const before=await page.evaluate(()=>{const {grid,...drawing}=(window as any).__vectora.snapshot();return JSON.stringify(drawing);});
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('tab',{name:'Grid',exact:true}).click();
  const input=page.getByRole('spinbutton',{name:'Grid size'});
  await input.fill('2.5');await input.press('Tab');
  await expect(page.locator('#grid-status')).toHaveText('Grid 2.5 mm');
  await input.fill('0');await input.press('Tab');
  await expect(input).toHaveAttribute('aria-invalid','true');
  expect(await page.evaluate(()=>(window as any).__vectora.grid.spacingMM)).toBe(2.5);
  await input.fill('2.5');await input.press('Tab');
  await page.screenshot({path:'test-results/grid-preferences.png'});
  await page.keyboard.press('Escape');
  expect(await page.evaluate(()=>{
    const e=(window as any).__vectora,p=(window as any).__paper;
    for(const zoom of [.1,1,96/25.4,100]){p.view.zoom=zoom;e.setTool('select');if(e.grid.spacingMM!==2.5)throw new Error('Grid interval changed');}
    e.setGridSpacing(.1);p.view.zoom=.1;e.setTool('select');
    if(e.grid.layer.children.length>1500)throw new Error('Grid density unbounded');
    e.setGridSpacing(2.5);const {grid,...drawing}=e.snapshot();return JSON.stringify(drawing);
  })).toBe(before);
  await page.reload();await expect(page.locator('#grid-status')).toHaveText('Grid 2.5 mm');
  await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;p.view.center=new p.Point(50,50);e.setTool('rectangle');});
  const coords=await page.evaluate(()=>{const p=(window as any).__paper;return [[11,11],[31,26]].map(pt=>{const q=p.view.projectToView(new p.Point(pt));const r=document.querySelector('#cad-canvas')!.getBoundingClientRect();return {x:q.x+r.x,y:q.y+r.y};});});
  await page.mouse.move(coords[0].x,coords[0].y);await page.mouse.down();await page.mouse.move(coords[1].x,coords[1].y);await page.mouse.up();
  expect(await page.evaluate(()=>{const b=(window as any).__vectora.selected.bounds;return [b.x,b.y,b.width,b.height];})).toEqual([10,10,20,15]);
});
