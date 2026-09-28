import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const DEV='http://127.0.0.1:5174';

test('SVG preserves millimetres, curves, holes, colours and stacking independently of view or selection',async({page})=>{
 await page.goto(DEV);
 const result=await page.evaluate(async()=>{
  const p=(window as any).__paper,e=(window as any).__vectora,{exportSVG}=await import('/src/exportSVG.ts');
  const ring=new p.CompoundPath({insert:false,children:[new p.Path.Circle({insert:false,center:[-30,15],radius:20}),new p.Path.Circle({insert:false,center:[-30,15],radius:10})]});
  e.addShape(ring,'Ring');ring.fillColor=new p.Color('#00FFFF');ring.fillRule='evenodd';ring.strokeColor=null;ring.rotate(32);ring.scale(1.4,0.8);
  e.addShape(new p.Path.Line({insert:false,from:[-50,-30],to:[30,40],strokeColor:'#383838',strokeWidth:1.5,strokeScaling:false}),'Line');e.moveSelectionToLayer('cutline');
  const before=e.snapshot(),svg=exportSVG(e.objects),doc=new DOMParser().parseFromString(svg,'image/svg+xml'),root=doc.documentElement;
  p.view.zoom=24;p.view.center=new p.Point(230,-540);e.select(null);const again=exportSVG(e.objects);
  const paths=[...doc.querySelectorAll('path')];
  return {svg,again,width:root.getAttribute('width'),height:root.getAttribute('height'),view:root.getAttribute('viewBox'),error:!!doc.querySelector('parsererror'),groups:[...doc.querySelectorAll('g')].map(n=>n.getAttribute('data-layer-role')),curve:paths.some(n=>/[cC]/.test(n.getAttribute('d')??'')),hole:paths.some(n=>n.getAttribute('fill-rule')==='evenodd'),red:paths.some(n=>n.getAttribute('stroke')==='#ff0000'),cyan:paths.some(n=>n.getAttribute('fill')==='#00ffff'),stroke:paths.find(n=>n.getAttribute('stroke')==='#ff0000')?.getAttribute('stroke-width'),unchanged:e.snapshot().artwork===before.artwork&&e.snapshot().cutlines===before.cutlines};
 });
 expect(result.error).toBe(false);expect(result.svg).toBe(result.again);expect(result.width).toMatch(/mm$/);expect(result.height).toMatch(/mm$/);expect(result.groups).toEqual(['artwork','cutline']);expect(result).toMatchObject({curve:true,hole:true,red:true,cyan:true,unchanged:true});expect(Number(result.stroke)).toBeCloseTo(1.5/(96/25.4),7);
 const view=result.view!.split(' ').map(Number);expect(parseFloat(result.width!)).toBeCloseTo(view[2],7);expect(parseFloat(result.height!)).toBeCloseTo(view[3],7);expect(result.svg).not.toContain('data-paper-data');
});

test('SVG includes outlined text and annotation labels, excludes hidden and construction geometry, and keeps locked objects',async({page})=>{
 await page.goto(DEV);const result=await page.evaluate(async()=>{
  const p=(window as any).__paper,e=(window as any).__vectora,{exportSVG}=await import('/src/exportSVG.ts'),{loadTextFont,createTextShape}=await import('/src/text.ts'),{createDimension}=await import('/src/dimensions.ts');
  await loadTextFont('lato');e.addShape(createTextShape({content:'O & B',fontId:'lato',sizeMM:10,transform:[1,0,0,1,10,10]}),'Text');
  const text=e.selected;text.locked=true;
  const label=createDimension({kind:'leader',points:[[0,0],[20,20],[40,20]],text:'A < B & C',transform:[1,0,0,1,0,0]});e.addShape(label,'Leader');
  e.addShape(new p.Path.Line({insert:false,from:[1000,0],to:[2000,0],strokeColor:'#383838'}),'Construction');e.moveSelectionToLayer('construction');
  e.addShape(new p.Path.Circle({insert:false,center:[4000,4000],radius:20,strokeColor:'#383838'}),'Hidden');e.selected.visible=false;
  const before=e.snapshot(),svg=exportSVG(e.objects),doc=new DOMParser().parseFromString(svg,'image/svg+xml');
  return {paths:doc.querySelectorAll('path').length,labels:[...doc.querySelectorAll('text')].map(n=>n.textContent),width:parseFloat(doc.documentElement.getAttribute('width')!),construction:doc.querySelector('[data-layer-role="construction"]')!==null,unchanged:JSON.stringify(before)===JSON.stringify(e.snapshot()),fonts:svg.includes('Lato')};
 });expect(result.paths).toBeGreaterThanOrEqual(2);expect(result.labels).toEqual(['A < B & C']);expect(result.width).toBeLessThan(100);expect(result.construction).toBe(false);expect(result.unchanged).toBe(true);expect(result.fonts).toBe(false);
});

test('File menu and keyboard export downloadable SVG; empty drawings show the standard error',async({page})=>{
 await page.goto(DEV);await page.getByRole('button',{name:'File',exact:true}).click();await page.getByRole('menuitem',{name:'Export SVG',exact:true}).click();await expect(page.locator('.toast-error')).toContainText('There are no visible objects to export');
 await page.evaluate(()=>{const p=(window as any).__paper,e=(window as any).__vectora;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[10,20,50,30],strokeColor:'#383838',strokeWidth:1.5,strokeScaling:false}),'Rectangle');});
 for(const method of ['menu','keyboard']){
  const downloadPromise=page.waitForEvent('download');
  if(method==='menu'){await page.getByRole('button',{name:'File',exact:true}).click();await page.getByRole('menuitem',{name:'Export SVG',exact:true}).click();}else{await page.locator('#cad-canvas').focus();await page.keyboard.press('Control+e');}
  const download=await downloadPromise;expect(download.suggestedFilename()).toBe('vectora.svg');const text=await readFile((await download.path())!,'utf8');expect(text).toContain('viewBox=');expect(text).toContain('mm"');expect(text).not.toContain('Editor overlays');
 }
 await expect(page.locator('#properties-panel')).toBeHidden();await expect(page.locator('.toast-success').first()).toContainText('SVG downloaded in millimetres.');
});
