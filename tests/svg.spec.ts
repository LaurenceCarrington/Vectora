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
 await page.goto(DEV);await page.getByRole('button',{name:'File',exact:true}).click();await page.getByRole('menuitem',{name:'Export…',exact:true}).click();await expect(page.locator('#export-dialog .export-error')).toContainText('No objects');await page.locator('#export-dialog [data-export-cancel]').click();
 await page.evaluate(()=>{const p=(window as any).__paper,e=(window as any).__vectora;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[10,20,50,30],strokeColor:'#383838',strokeWidth:1.5,strokeScaling:false}),'Rectangle');});
 for(const method of ['menu','keyboard']){
  const downloadPromise=page.waitForEvent('download');
  if(method==='menu'){await page.getByRole('button',{name:'File',exact:true}).click();await page.getByRole('menuitem',{name:'Export…',exact:true}).click();}else{await page.locator('#cad-canvas').focus();await page.keyboard.press('Control+e');}
  await page.locator('#export-dialog [data-export-submit]').click();const download=await downloadPromise;expect(download.suggestedFilename()).toBe('Untitled.svg');const text=await readFile((await download.path())!,'utf8');expect(text).toContain('viewBox=');expect(text).toContain('mm"');expect(text).not.toContain('Editor overlays');
 }
 await expect(page.locator('#properties-panel')).toBeHidden();await expect(page.locator('#export-dialog')).not.toBeVisible();
});

test('Default Artwork exports black in either theme without changing canvas colours or explicit fills',async({page})=>{
 await page.goto(DEV);
 const result=await page.evaluate(async()=>{
  const p=(window as any).__paper,e=(window as any).__vectora;
  const {exportSVG}=await import('/src/exportSVG.ts'),{exportDXF}=await import('/src/exportDXF.ts'),{loadTextFont,createTextShape}=await import('/src/text.ts'),{createDimension}=await import('/src/dimensions.ts');
  e.addShape(new p.Path.Rectangle({insert:false,rectangle:[0,0,30,20],strokeColor:'#FFFFFF',strokeWidth:1.5,strokeScaling:false}),'Default outline');
  const outline=e.selected;
  const joined=new p.CompoundPath({insert:false,children:[new p.Path.Circle({insert:false,center:[50,20],radius:10}),new p.Path.Circle({insert:false,center:[50,20],radius:5})],strokeColor:'#FFFFFF',strokeWidth:1.5,strokeScaling:false});e.addShape(joined,'Joined outlines');
  await loadTextFont('lato');e.addShape(createTextShape({content:'O',fontId:'lato',sizeMM:10,transform:[1,0,0,1,0,40]}),'Text');
  e.addShape(createDimension({kind:'leader',points:[[0,0],[20,20],[40,20]],text:'Label',transform:[1,0,0,1,0,0]}),'Leader');
  for(const color of ['#FFFFFF','#FF00FF']){
   e.addShape(new p.Path.Circle({insert:false,center:[80,20],radius:5,fillColor:color,data:{regionFill:true,regionFillColor:color}}),'Explicit fill');e.selected.fillColor=new p.Color(color);
  }
  e.addShape(new p.Path.Line({insert:false,from:[0,60],to:[30,60],strokeColor:'#FFFFFF'}),'Cut');e.moveSelectionToLayer('cutline');
  e.setActiveLayer('artwork');e.addShape(new p.Path.Line({insert:false,from:[0,65],to:[30,65],strokeColor:'#FFFFFF'}),'Engrave');e.moveSelectionToLayer('engrave');
  const outputs=[];
  for(const theme of ['dark','light']){
   document.documentElement.dataset.theme=theme;e.refreshTheme();
   const before=e.objects.map((item:any)=>item.exportJSON()),snapshot=JSON.stringify(e.snapshot()),selection=e.selectedItems.map((item:any)=>item.id),undo=e.canUndo,redo=e.canRedo;
   const svg=exportSVG(e.objects),dxf=exportDXF(e.objects,true),doc=new DOMParser().parseFromString(svg,'image/svg+xml'),art=doc.querySelector('[data-layer-role="artwork"]')!;
   outputs.push({svg,dxf,strokes:[...art.querySelectorAll('[stroke]')].map(n=>n.getAttribute('stroke')).filter(c=>c!=='none'),fills:[...art.querySelectorAll('path[fill]')].map(n=>n.getAttribute('fill')),label:art.querySelector('text')?.getAttribute('fill'),cut:doc.querySelector('[data-layer-role="cutline"] path')?.getAttribute('stroke'),engrave:doc.querySelector('[data-layer-role="engrave"] path')?.getAttribute('stroke'),canvas:outline.strokeColor.toCSS(true),unchanged:JSON.stringify(before)===JSON.stringify(e.objects.map((item:any)=>item.exportJSON()))&&snapshot===JSON.stringify(e.snapshot())&&JSON.stringify(selection)===JSON.stringify(e.selectedItems.map((item:any)=>item.id))&&undo===e.canUndo&&redo===e.canRedo});
  }
  return outputs;
 });
 for(const output of result){expect(output.strokes.length).toBeGreaterThanOrEqual(3);expect(output.strokes.every(c=>c==='#000000')).toBe(true);expect(output.fills).toContain('#000000');expect(output.fills).toContain('#ffffff');expect(output.fills).toContain('#ff00ff');expect(output.label).toBe('#000000');expect(output.cut).toBe('#ff0000');expect(output.engrave).toBe('#0000ff');expect(output.unchanged).toBe(true);}
 expect(result[0].canvas).toBe('#ffffff');expect(result[1].canvas).toBe('#383838');expect(result[0].svg).toBe(result[1].svg);expect(result[0].dxf).toBe(result[1].dxf);
});
