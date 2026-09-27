import {test,expect,type Page} from '@playwright/test';
const DEV='http://127.0.0.1:5174';
async function ready(page:Page){await page.goto(DEV);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');await expect(page.locator('#workspace')).not.toHaveAttribute('inert','');}
async function openShape(page:Page){
 const point=await page.evaluate(()=>{const p=(window as any).__paper,v=p.view.projectToView(new p.Point(50,40));return {x:v.x,y:v.y};});
 await page.mouse.click(point.x,point.y,{button:'right'});
 return page.getByRole('menu',{name:'Selection actions',exact:true});
}

test('Context Layer lists document layers, protects blocked targets and moves the selection with undo',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await ready(page);
 await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({rectangle:[40,30,30,25],insert:false,strokeColor:'white'}),'First');const first=e.selected;e.addShape(new p.Path.Circle({center:[100,40],radius:10,insert:false,strokeColor:'white'}),'Second');e.select(first,true);e.setLayerState('engrave','locked',true);e.setLayerState('construction','visible',false);const custom=e.addDocumentLayer('artwork');custom.name='Custom <safe> layer';e.select(first);e.select(e.objects.find((s:any)=>s.data.name==='Second'),true);});
 const before=await page.evaluate(()=>(window as any).__vectora.snapshot());const menu=await openShape(page);await menu.getByRole('menuitem',{name:'Layer',exact:true}).click();
 const layers=menu.getByRole('menu',{name:'Move to layer'});await expect(layers.getByRole('menuitemradio')).toHaveCount(5);
 await expect(layers.getByRole('menuitemradio',{name:'Artwork',exact:true})).toHaveAttribute('aria-checked','true');
 await expect(layers.getByRole('menuitemradio',{name:'Artwork',exact:true})).toBeDisabled();await expect(layers.getByRole('menuitemradio',{name:'Engrave Path',exact:true})).toBeDisabled();await expect(layers.getByRole('menuitemradio',{name:'Construction Path',exact:true})).toBeDisabled();await expect(layers.getByRole('menuitemradio',{name:'Custom <safe> layer',exact:true})).toBeEnabled();expect(await layers.locator('safe').count()).toBe(0);
 await layers.getByRole('menuitemradio',{name:'Cut Path',exact:true}).click();await expect(menu).toBeHidden();
 const state=await page.evaluate(()=>{const e=(window as any).__vectora;return {selection:e.selectedItems.length,objects:e.objects.map((s:any)=>({role:s.data.role,color:s.strokeColor.toCSS(true),name:s.data.name,bounds:[s.bounds.x,s.bounds.y,s.bounds.width,s.bounds.height]}))};});
 expect(state.selection).toBe(2);expect(state.objects).toEqual([{role:'cutline',color:'#ff0000',name:'First',bounds:[40,30,30,25]},{role:'cutline',color:'#ff0000',name:'Second',bounds:[90,30,20,20]}]);
 await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before);expect(errors).toEqual([]);
});

test('Layer dropdown stays on canvas, scrolls long lists and supports keyboard access in Light mode',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('vectora.theme','light'));await ready(page);await page.setViewportSize({width:420,height:650});
 await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({rectangle:[40,30,30,25],insert:false,strokeColor:'#383838'}),'Rectangle');const selected=e.selected;for(let i=0;i<18;i++)e.addDocumentLayer('engrave');e.select(selected);});
 await page.mouse.click(350,500,{button:'right'});const menu=page.getByRole('menu',{name:'Selection actions',exact:true}),trigger=menu.getByRole('menuitem',{name:'Layer',exact:true});await trigger.focus();await page.keyboard.press('ArrowRight');
 const layers=menu.getByRole('menu',{name:'Move to layer'});await expect(layers).toBeVisible();await expect(layers.getByRole('menuitemradio',{name:'Cut Path',exact:true})).toBeFocused();
 let r=(await menu.boundingBox())!;expect(r.x).toBeGreaterThanOrEqual(64);expect(r.x+r.width).toBeLessThanOrEqual(376);expect(r.y).toBeGreaterThanOrEqual(88);expect(r.y+r.height).toBeLessThanOrEqual(602);
 await page.keyboard.press('End');await expect(layers.getByRole('menuitemradio',{name:'Engrave Path 19',exact:true})).toBeFocused();
 await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.wheel(0,-100);await expect(menu).toBeVisible();await page.keyboard.press('ArrowLeft');await expect(layers).toBeHidden();await expect(trigger).toBeFocused();
 await page.keyboard.press('Enter');await page.keyboard.press('Home');await page.screenshot({path:'test-results/context-layers-light.png'});await page.keyboard.press('Escape');await expect(layers).toBeHidden();await expect(menu).toBeVisible();await page.keyboard.press('Escape');await expect(menu).toBeHidden();
 await page.evaluate(()=>(window as any).__vectora.select(null));await page.mouse.click(350,500,{button:'right'});await expect(trigger).toBeDisabled();
});
