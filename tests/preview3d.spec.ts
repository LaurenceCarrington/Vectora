import {test,expect} from '@playwright/test';
const DEV='http://127.0.0.1:5174';
async function design(page:any){await page.evaluate(()=>{
 const e=(window as any).__vectora,p=(window as any).__paper;
 e.addShape(new p.Path.Rectangle({insert:false,rectangle:[10,20,100,65]}),'Panel');e.moveSelectionToLayer('cutline');
 e.addShape(new p.Path.Circle({insert:false,center:[42,52],radius:13}),'Hole');e.moveSelectionToLayer('cutline');
 e.addShape(new p.Path({insert:false,segments:[[67,40],[93,40],[80,65]],closed:true}),'Engraving');e.moveSelectionToLayer('engrave');
});}

test('Preview geometry preserves nesting, layers, transforms and document state',async({page})=>{
 await page.goto(DEV);await design(page);
 const result=await page.evaluate(async()=>{
  const e=(window as any).__vectora,p=(window as any).__paper,{buildPreviewModel}=await import('/src/previewModel.ts');
  e.addShape(new p.Path.Circle({insert:false,center:[42,52],radius:4}),'Island');e.moveSelectionToLayer('cutline');
  e.addShape(new p.Path.Rectangle({insert:false,rectangle:[150,20,25,25]}),'Other piece');e.moveSelectionToLayer('cutline');
  e.addShape(new p.Path({insert:false,segments:[[10,90],[50,90]]}),'Open cut');e.moveSelectionToLayer('cutline');
  e.setLayerState('cutline','locked',true);
  e.addShape(new p.Path.Rectangle({insert:false,rectangle:[-1000,-1000,2000,2000]}),'Ignored artwork');
  const before=JSON.stringify(e.snapshot()),model=await buildPreviewModel(e.objects);
  const unchanged=before===JSON.stringify(e.snapshot());e.setLayerState('cutline','visible',false);const engravingOnly=await buildPreviewModel(e.objects);
  return {model,unchanged,engravingOnly};
 });
 expect(result.model).toMatchObject({parts:3,holes:1,openCuts:1,stock:false,bounds:{x:10,y:20,width:165,height:65}});expect(result.model?.marks).toHaveLength(1);expect(result.unchanged).toBe(true);expect(result.engravingOnly).toMatchObject({stock:true,parts:1,holes:0});expect(result.engravingOnly!.bounds.width).toBeLessThan(50);
});

test('3D preview renders materials and holes, supports controls, and leaves the drawing unchanged',async({page})=>{
 await page.goto(DEV);await design(page);const before=await page.evaluate(()=>({snapshot:(window as any).__vectora.snapshot(),zoom:(window as any).__paper.view.zoom,undo:(window as any).__vectora.canUndo}));
 const trigger=page.getByRole('button',{name:'3D preview',exact:true});await trigger.click();const dialog=page.getByRole('dialog',{name:'3D preview',exact:true});await expect(dialog).toBeVisible();await expect(dialog.locator('[data-preview-summary]')).toContainText('1 piece · 1 hole');await expect(dialog.locator('canvas')).toBeVisible();
 await dialog.screenshot({path:'test-results/preview3d-plywood.png'});
 await dialog.getByLabel('Material',{exact:true}).selectOption('aluminium');await dialog.getByLabel('Material thickness').fill('6');await expect(dialog.locator('[data-preview-summary]')).toContainText('× 6 mm');await dialog.getByLabel('Show engraving').uncheck();await dialog.getByRole('button',{name:'Top view',exact:true}).click();
 await dialog.screenshot({path:'test-results/preview3d-aluminium.png'});expect(await dialog.evaluate(el=>el.scrollTop)).toBe(0);
 await dialog.getByLabel('Material thickness').fill('0');await expect(dialog.locator('[data-preview-validation]')).toBeVisible();await expect(dialog.locator('[data-preview-summary]')).toContainText('× 6 mm');await dialog.getByLabel('Material thickness').fill('3');
 await dialog.locator('canvas').focus();await page.keyboard.press('ArrowLeft');await page.keyboard.press('+');await page.keyboard.press('Delete');await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(trigger).toBeFocused();expect(await page.evaluate(()=>({snapshot:(window as any).__vectora.snapshot(),zoom:(window as any).__paper.view.zoom,undo:(window as any).__vectora.canUndo}))).toEqual(before);expect(await dialog.locator('canvas').count()).toBe(0);
 await trigger.click();await expect(dialog.locator('canvas')).toBeVisible();await expect(dialog.locator('[data-preview-summary]')).toContainText('1 piece · 1 hole');await dialog.getByRole('button',{name:'Close 3D preview',exact:true}).click();
});

test('Empty and engraving-only previews explain the material, including a narrow viewport',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto(DEV);const trigger=page.getByRole('button',{name:'3D preview',exact:true});const box=await trigger.boundingBox();expect(box!.x).toBeGreaterThan(24);await trigger.click();const dialog=page.getByRole('dialog',{name:'3D preview',exact:true});await expect(dialog).toContainText('Nothing to preview yet');await dialog.getByRole('button',{name:'Close 3D preview',exact:true}).click();
 await design(page);await page.evaluate(()=>(window as any).__vectora.setLayerState('cutline','visible',false));await trigger.click();await expect(dialog.locator('[data-preview-note]')).toContainText('fitted rectangular blank');await expect(dialog.locator('canvas')).toBeVisible();await dialog.screenshot({path:'test-results/preview3d-mobile.png'});expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
});


test('Unavailable WebGL reports a recoverable error without changing the document',async({page})=>{
 await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type:string,...args:any[]){if(type==='webgl'||type==='webgl2'||type==='experimental-webgl')return null;return original.call(this,type,...args);} as any;});
 await page.goto(DEV);await design(page);const before=await page.evaluate(()=>(window as any).__vectora.snapshot());await page.getByRole('button',{name:'3D preview',exact:true}).click();const dialog=page.getByRole('dialog',{name:'3D preview',exact:true});await expect(dialog).toContainText('Unable to show 3D preview');await dialog.getByRole('button',{name:'Close 3D preview',exact:true}).click();expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before);
});

test('Production build opens the preview without source-only modules',async({page})=>{
 await page.goto('http://127.0.0.1:4173');await page.getByRole('button',{name:'3D preview',exact:true}).click();await expect(page.getByRole('dialog',{name:'3D preview',exact:true})).toContainText('Nothing to preview yet');
});
