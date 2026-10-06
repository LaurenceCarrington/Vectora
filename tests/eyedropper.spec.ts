import {test,expect,type Page} from './fixtures';
const DEV='http://127.0.0.1:5174';
async function setup(page:Page,url=DEV){
 await page.goto(url);
 const points=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper,c=p.view.center;
  const source=new p.Path.Rectangle({insert:false,rectangle:[c.x-80,c.y-15,30,30],fillColor:'#2389B7'});source.data={rasterTrace:{mode:'colour'},regionFill:true,regionFillColor:'#2389B7',customColour:'#2389B7'};e.addTracedShapes([source],'Source');
  const target=new p.Path.Rectangle({insert:false,rectangle:[c.x-25,c.y-15,20,30],strokeColor:e.drawingColor,strokeWidth:1});e.addShape(target,'Target');e.setTool('fill');
  const point=(x:number,y:number)=>{const v=p.view.projectToView(c.add([x,y])),r=e.canvas.getBoundingClientRect();return {x:r.left+v.x,y:r.top+v.y};};return {source:point(-65,0),blank:point(-65,50)};
 });
 await expect(page.getByRole('button',{name:'Pick colour from canvas',exact:true})).toHaveCount(1,{timeout:1500});return points;
}
const button=(page:Page)=>page.getByRole('button',{name:'Pick colour from canvas',exact:true});
const state=(page:Page)=>page.evaluate(()=>{const e=(window as any).__vectora;return {count:e.objects.length,uid:e.selected?.data.uid,stroke:e.selected?.strokeColor?.toCSS(true),source:e.objects[0].fillColor.toCSS(true),fill:e.fillColor,tool:e.tool};});
test('Hover previews exact colour; click paints selected Artwork once without selecting or filling the source',async({page})=>{
 const points=await setup(page),before=await state(page);await button(page).click();await page.mouse.move(points.source.x,points.source.y);await expect(page.locator('.colour-sample-hud')).toContainText('#2389B7');await page.screenshot({path:'test-results/eyedropper-hover.png'});expect(await state(page)).toEqual(before);
 await page.mouse.click(points.source.x,points.source.y);await expect(button(page)).toHaveAttribute('aria-pressed','false');await expect(page.locator('#colour-hex')).toHaveValue('#2389B7');expect(await state(page)).toEqual({...before,stroke:'#2389b7',fill:'#2389B7'});
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await state(page)).stroke).toBe(before.stroke);expect((await state(page)).count).toBe(2);
});
test('Blank grid never samples; Escape preserves selection and paint and restores picker focus',async({page})=>{
 const points=await setup(page),before=await state(page);await button(page).focus();await page.keyboard.press('Enter');await page.mouse.click(points.blank.x,points.blank.y);await expect(button(page)).toHaveAttribute('aria-pressed','true');expect(await state(page)).toEqual(before);
 await page.mouse.move(points.source.x,points.source.y);await page.keyboard.press('Escape');await expect(button(page)).toBeFocused();await expect(page.locator('#colour-panel')).toBeVisible();await expect(page.locator('.colour-sample-hud')).toHaveCount(0);expect(await state(page)).toEqual(before);
});
test('Sampling ignores hidden objects, grid and selection overlays but includes locked artwork',async({page})=>{
 const points=await setup(page);await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper,s=e.objects[0];s.locked=true;const h=s.clone();h.locked=false;h.fillColor='#FF0000';h.visible=false;e.artwork.addChild(h);const overlay=new p.Path.Rectangle({rectangle:s.bounds,fillColor:'#00FF00'});e.overlays.addChild(overlay);p.view.update();});
 await button(page).click();await page.mouse.click(points.source.x,points.source.y);await expect(page.locator('#colour-hex')).toHaveValue('#2389B7');expect(await page.evaluate(()=>{const e=(window as any).__vectora;return {locked:e.objects[0].locked,hidden:e.objects[2].visible,grid:e.grid.layer.visible,overlay:e.overlays.visible};})).toEqual({locked:true,hidden:false,grid:true,overlay:true});
});
test('Outside actions, panel/tab changes, resize and blur cancel without a stale sample',async({page})=>{
 const points=await setup(page),before=await state(page);await button(page).click();await page.getByRole('tab',{name:'Gradient',exact:true}).click();await expect(page.locator('#colour-panel [aria-label="Pick colour from canvas"]')).toHaveAttribute('aria-pressed','false');await expect(page.locator('.colour-sample-hud')).toHaveCount(0);
 await page.getByRole('tab',{name:'Colour',exact:true}).click();await button(page).click();await page.setViewportSize({width:1200,height:850});await expect(button(page)).toHaveAttribute('aria-pressed','false');
 await button(page).click();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await expect(button(page)).toHaveAttribute('aria-pressed','false');expect((await state(page)).uid).toBe(before.uid);expect((await state(page)).count).toBe(before.count);
 await button(page).click();await page.getByRole('button',{name:'Layers',exact:true}).click();await expect(page.locator('.colour-sample-hud')).toHaveCount(0);
});
test('Picker samples rendered gradient colour and handles keyboard confirmation',async({page})=>{
 const points=await setup(page);await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper,s=e.objects[0];s.fillColor=new p.Color({gradient:{stops:['#FF0000','#0000FF']},origin:s.bounds.leftCenter,destination:s.bounds.rightCenter});p.view.update();});
 await button(page).click();await page.mouse.move(points.source.x,points.source.y);await expect(page.locator('.colour-sample-hud')).toContainText('#');await page.keyboard.press('Enter');const hex=await page.locator('#colour-hex').inputValue();expect(parseInt(hex.slice(1,3),16)).toBeGreaterThan(115);expect(parseInt(hex.slice(5),16)).toBeGreaterThan(115);expect(hex.slice(3,5)).toBe('00');
});

test('Production and narrow-screen reference show the picker without clipping or script errors',async({page,context})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:4173');await page.getByRole('button',{name:'Fill & appearance',exact:true}).click();await button(page).click();await page.keyboard.press('Escape');await expect(button(page)).toBeFocused();
 await page.setViewportSize({width:375,height:700});const bounds=await page.locator('#colour-panel .colour-hex-row').evaluate(row=>{const r=row.getBoundingClientRect();return [...row.children].filter(c=>!c.classList.contains('sr-only')&&c.getBoundingClientRect().width).every(c=>{const b=c.getBoundingClientRect();return b.left>=r.left&&b.right<=r.right+1;});});expect(bounds).toBe(true);
 const ref=await context.newPage();ref.on('pageerror',e=>errors.push(e.message));await ref.goto(DEV+'/reference/design-system.html');await ref.getByRole('button',{name:'Fill & appearance',exact:true}).click();await button(ref).click();const sample=ref.getByLabel('Eyedropper sample artwork'),r=(await sample.boundingBox())!;await ref.mouse.click(r.x+40,r.y+40);await expect(ref.locator('#colour-hex')).toHaveValue('#2389B7');await expect(sample).toBeHidden();expect(errors).toEqual([]);
});

test('Rendered overlaps and transparent ink sample correctly after zooming',async({page})=>{
 await setup(page);const point=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper,s=e.objects[0];s.fillColor='#00FF00';s.data.regionFillColor='#00FF00';s.opacity=.5;p.view.zoom*=.75;p.view.update();const v=p.view.projectToView(s.bounds.center),r=e.canvas.getBoundingClientRect();return {x:r.left+v.x,y:r.top+v.y};});
 await button(page).click();await page.mouse.click(point.x,point.y);await expect(page.locator('#colour-hex')).toHaveValue('#00FF00');expect(await page.evaluate(()=>(window as any).__vectora.fillOpacity)).toBeCloseTo(.5,2);
 await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper,s=e.objects[0];s.fillColor='#FF0000';s.data.regionFillColor='#FF0000';s.opacity=1;const top=s.clone();top.fillColor='#0000FF';top.data.regionFillColor='#0000FF';top.opacity=.5;e.artwork.addChild(top);p.view.update();});
 await button(page).click();await page.mouse.click(point.x,point.y);const hex=await page.locator('#colour-hex').inputValue();expect(parseInt(hex.slice(1,3),16)).toBeGreaterThanOrEqual(127);expect(parseInt(hex.slice(1,3),16)).toBeLessThanOrEqual(128);expect(hex.slice(3,5)).toBe('00');expect(parseInt(hex.slice(5),16)).toBeGreaterThanOrEqual(127);expect(parseInt(hex.slice(5),16)).toBeLessThanOrEqual(128);
});
test('Leaving canvas cannot resurrect a stale hover or pick behind a floating panel',async({page})=>{
 const points=await setup(page),before=await state(page);await button(page).click();
 await page.evaluate(point=>{const canvas=document.querySelector('#cad-canvas')!;canvas.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:point.x,clientY:point.y}));document.querySelector('#colour-panel')!.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:1100,clientY:500}));},points.source);
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));await expect(page.locator('.colour-sample-hud')).toBeHidden();await page.keyboard.press('Enter');expect(await state(page)).toEqual(before);await expect(button(page)).toHaveAttribute('aria-pressed','true');
 await page.mouse.move(points.source.x,points.source.y);await page.mouse.down();const row=(await page.locator('#colour-panel .colour-hex-row').boundingBox())!;await page.mouse.move(row.x+10,row.y+10);await page.mouse.up();expect(await state(page)).toEqual(before);await expect(button(page)).toHaveAttribute('aria-pressed','false');
});
test('Picker activation never discards an unfinished path',async({page})=>{
 await setup(page);await page.evaluate(()=>(window as any).__vectora.setTool('polyline'));await page.mouse.click(450,550);await page.mouse.click(520,560);
 const before=await page.evaluate(()=>{const e=(window as any).__vectora;return {pending:e.hasPendingGesture,tool:e.tool,geometry:e.objects.map((i:any)=>i.pathData),selected:e.selectedItems.map((i:any)=>i.data.uid)};});expect(before.pending).toBe(true);
 await button(page).click();await expect(button(page)).toHaveAttribute('aria-pressed','false');await expect(page.locator('.colour-sample-hud')).toHaveCount(0);
 expect(await page.evaluate(()=>{const e=(window as any).__vectora;return {pending:e.hasPendingGesture,tool:e.tool,geometry:e.objects.map((i:any)=>i.pathData),selected:e.selectedItems.map((i:any)=>i.data.uid)};})).toEqual(before);
});
test('A document update during sampling invalidates the cached artwork',async({page})=>{
 const points=await setup(page);await button(page).click();await page.mouse.move(points.source.x,points.source.y);await expect(page.locator('.colour-sample-hud')).toContainText('#2389B7');
 await page.evaluate(()=>{const e=(window as any).__vectora;e.setProperty('x',e.selectionBounds.x+5);});await expect(button(page)).toHaveAttribute('aria-pressed','false');await expect(page.locator('.colour-sample-hud')).toHaveCount(0);
});
test('Clicking the active pipette again turns sampling off',async({page})=>{
 await setup(page);const before=await state(page);await button(page).click();await expect(button(page)).toHaveAttribute('aria-pressed','true');await button(page).click();await expect(button(page)).toHaveAttribute('aria-pressed','false');await expect(page.locator('.colour-sample-hud')).toHaveCount(0);expect(await state(page)).toEqual(before);
});
