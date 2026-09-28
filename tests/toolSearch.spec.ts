import {test,expect,type Page} from '@playwright/test';
const DEV='http://127.0.0.1:5174';
async function open(page:Page,query=''){
 await page.getByRole('button',{name:'Search tools',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Search tools',exact:true});await expect(dialog).toBeVisible();
 const input=dialog.getByRole('combobox',{name:'Search tools'});await expect(input).toBeFocused();await input.fill(query);return {dialog,input};
}
async function ready(page:Page){await page.goto(DEV);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');}

test('Search discovers every drawing tool and aliases, and keyboard activation changes the active tool',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await ready(page);
 const {dialog,input}=await open(page);
 const labels=await dialog.getByRole('option').allTextContents();
 for(const name of ['Rectangle','Circle','Ellipse','Polygon','Line','Polyline','Freehand','Centre arc','Three-point arc','Start–end arc','Aligned dimension','Linear dimension','Radial dimension','Diameter dimension','Leader callout','Node editing','Text','Colour fill','Raster to vector','Copy','Paste','Duplicate','Close path','Join','Explode','Convert to path','Sticker outline','Export SVG','Export DXF','Save','Layers','Properties']){
  expect(labels.some(label=>label.startsWith(name)),`Search includes ${name}`).toBe(true);
 }
 expect(labels.some(label=>label.startsWith('Nest'))).toBe(false);
 await input.fill('  CIRCLE  ');await expect(dialog.getByRole('option').first()).toContainText('Circle');await input.press('Enter');await expect(dialog).toBeHidden();
 expect(await page.evaluate(()=>(window as any).__vectora.tool)).toBe('circle');await expect(page.locator('#cad-canvas')).toBeFocused();
 const second=await open(page,'bezier');await expect(second.dialog.getByRole('option')).toHaveCount(1);await second.input.press('Enter');expect(await page.evaluate(()=>(window as any).__vectora.tool)).toBe('nodes');
 const third=await open(page,'line');await third.input.press('ArrowDown');const chosen=await third.input.getAttribute('aria-activedescendant');await third.input.press('Enter');await expect(third.dialog).toBeHidden();expect(chosen).toContain('dimension-linear');expect(await page.evaluate(()=>(window as any).__vectora.tool)).toBe('dimension-linear');
 expect(errors).toEqual([]);
});

test('Context actions explain requirements, preserve the selection, and reuse undoable commands',async({page})=>{
 await ready(page);let ui=await open(page,'mirror');
 await expect(ui.dialog.getByRole('option')).toHaveCount(2);await expect(ui.dialog.getByRole('option').first()).toHaveAttribute('aria-disabled','true');await ui.input.press('Enter');await expect(ui.dialog).toBeVisible();await expect(ui.dialog.getByRole('status')).toHaveText('Select an object');await ui.input.press('Escape');
 await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path({segments:[[35,30],[55,35],[42,60]],insert:false,strokeColor:'white'}),'Triangle');});
 const before=await page.evaluate(()=>(window as any).__vectora.selected.segments.map((s:any)=>[s.point.x,s.point.y]));
 ui=await open(page,'mirror');await expect(ui.dialog.getByRole('option').first()).toHaveAttribute('aria-disabled','false');await ui.input.press('Enter');
 const after=await page.evaluate(()=>(window as any).__vectora.selected.segments.map((s:any)=>[s.point.x,s.point.y]));expect(after).not.toEqual(before);
 ui=await open(page,'undo');await ui.input.press('Enter');expect(await page.evaluate(()=>(window as any).__vectora.selected.segments.map((s:any)=>[s.point.x,s.point.y]))).toEqual(before);
 ui=await open(page,'copy');await ui.input.press('Enter');ui=await open(page,'paste');await ui.input.press('Enter');expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(2);
});

test('Search opens existing settings, raster, properties and file workflows without losing dialog focus',async({page})=>{
 await ready(page);
 let ui=await open(page,'polar');await ui.input.press('Enter');const preferences=page.locator('#preferences-dialog');await expect(preferences).toBeVisible();await expect(preferences.getByRole('tab',{name:'Grid',exact:true})).toBeFocused();await page.keyboard.press('Escape');
 ui=await open(page,'trace');await ui.dialog.getByRole('option',{name:/Raster to vector/}).click();await expect(page.locator('#raster-dialog')).toBeVisible();await expect(page.locator('#raster-dialog')).toContainText('Start with an image');await page.keyboard.press('Escape');
 ui=await open(page,'properties');await ui.input.press('Enter');await expect(page.locator('#properties-panel')).toBeVisible();
 await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({rectangle:[30,30,20,20],insert:false,strokeColor:'white'}),'Rectangle');});
 ui=await open(page,'export svg');const download=page.waitForEvent('download');await ui.input.press('Enter');expect((await download).suggestedFilename()).toMatch(/\.svg$/);
});

test('Search stays within small screens, supports both themes, and does not leak keys into the canvas',async({page})=>{
 await ready(page);await page.setViewportSize({width:390,height:650});const {dialog,input}=await open(page,'not a real tool');
 await expect(dialog.getByRole('option')).toHaveCount(0);await expect(dialog.getByRole('status')).toContainText('No tools found');await input.press('Enter');await expect(dialog).toBeVisible();
 expect(await page.evaluate(()=>(window as any).__vectora.tool)).toBe('select');
 await input.fill('');await input.press('ArrowUp');await expect(input).toHaveAttribute('aria-activedescendant',(await dialog.getByRole('option').last().getAttribute('id'))!);
 await input.press('Tab');await expect(dialog.getByRole('button',{name:'Close tool search'})).toBeFocused();await page.keyboard.press('Tab');await expect(input).toBeFocused();
 const r=(await dialog.boundingBox())!;expect(r.x).toBeGreaterThanOrEqual(0);expect(r.x+r.width).toBeLessThanOrEqual(390);expect(r.y+r.height).toBeLessThanOrEqual(650);
 await input.fill('arc');await page.screenshot({path:'test-results/tool-search-dark.png'});await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Search tools',exact:true})).toBeFocused();
 await page.evaluate(()=>{localStorage.setItem('vectora.theme','light');});await page.reload();await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');
 const light=await open(page,'dimension');await expect(light.dialog).toHaveCSS('background-color','rgb(245, 246, 248)');await page.screenshot({path:'test-results/tool-search-light.png'});
 await page.mouse.click(380,630);await expect(light.dialog).toBeHidden();
});

test('Production build includes functioning tool search',async({page})=>{
 await page.goto('http://127.0.0.1:4173');await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');
 const {dialog,input}=await open(page,'ellipse');await input.press('Enter');await expect(dialog).toBeHidden();await expect(page.locator('#tool-status')).toContainText('Ellipse');
});
