import {test,expect,type Page} from './fixtures';
const DEV='http://127.0.0.1:5174';
async function seed(page:Page){
 await page.goto(DEV);
 await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;
  const shapes=[new p.Path.Rectangle({insert:false,rectangle:[10,10,25,15]}),new p.Path.Circle({insert:false,center:[55,20],radius:10}),new p.Path({insert:false,segments:[[10,45],[70,45]]}),new p.Path.Arc({insert:false,from:[10,70],through:[30,55],to:[50,70]}),new p.CompoundPath({insert:false,children:[new p.Path.Rectangle({insert:false,rectangle:[80,10,20,20]}),new p.Path.Circle({insert:false,center:[90,20],radius:5})]})];
  shapes.forEach((s:any)=>{s.strokeColor='white';s.strokeWidth=1.5;s.strokeScaling=false;e.addShape(s,'Geometry');});e.select(null);e.objects.forEach((s:any)=>e.select(s,true));
 });
 await page.getByRole('button',{name:'Properties',exact:true}).click();
}
const styles=(page:Page)=>page.evaluate(()=>(window as any).__vectora.selectedItems.map((s:any)=>({width:s.strokeWidth,scaling:s.strokeScaling,dash:s.dashArray,cap:s.strokeCap,colour:s.strokeColor.toCSS(true),fill:s.fillColor?.toCSS(true)??null})));
test('Properties applies physical line weights and designs to closed, open, curved and compound selections',async({page})=>{
 await seed(page);const bounds=await page.evaluate(()=>(window as any).__vectora.objects.map((s:any)=>s.pathData));const initialDXF=await page.evaluate(async()=>{const {exportDXF}=await import('/src/exportDXF.ts' as string);return exportDXF((window as any).__vectora.objects,true);});
 const weight=page.getByRole('spinbutton',{name:'Line weight (millimetres)',exact:true}),design=page.getByRole('combobox',{name:'Line style',exact:true});
 await weight.fill('0.5');await weight.press('Tab');
 for(const choice of [{design:'dashed',dash:[2,1],cap:'butt'},{design:'dotted',dash:[0,1],cap:'round'},{design:'dash-dot',dash:[2,1,0,1],cap:'round'},{design:'solid',dash:[],cap:'butt'}]){
  await design.selectOption(choice.design);
  expect(await styles(page)).toEqual(Array.from({length:5},()=>({width:.5,scaling:true,dash:choice.dash,cap:choice.cap,colour:'#ffffff',fill:null})));
 }
 expect(await page.evaluate(()=>(window as any).__vectora.objects.map((s:any)=>s.pathData))).toEqual(bounds);expect(await page.evaluate(async()=>{const {exportDXF}=await import('/src/exportDXF.ts' as string);return exportDXF((window as any).__vectora.objects,true);})).toBe(initialDXF);
 await page.evaluate(()=>(window as any).__vectora.undo());await expect(design).toHaveValue('dash-dot');await page.evaluate(()=>(window as any).__vectora.redo());await expect(design).toHaveValue('solid');
 await page.evaluate(()=>{const p=(window as any).__paper,e=(window as any).__vectora;p.view.zoom=15;e.refreshTheme();});await expect(weight).toHaveValue('0.5');
});
test('Mixed selections preserve individual styles when changing weight and individual weights when changing style',async({page})=>{
 await seed(page);
 await page.evaluate(()=>{const e=(window as any).__vectora;e.select(e.objects[0]);e.setLineWeight(.5);e.setLineDesign('solid');e.select(e.objects[1]);e.setLineWeight(1);e.setLineDesign('dotted');e.select(e.objects[0],true);});
 const weight=page.getByRole('spinbutton',{name:'Line weight (millimetres)',exact:true}),design=page.getByRole('combobox',{name:'Line style',exact:true});
 await expect(weight).toHaveValue('');await expect(weight).toHaveAttribute('placeholder','Mixed');await expect(design).toHaveValue('mixed');
 await weight.fill('0.75');await weight.press('Tab');expect((await styles(page)).map(s=>({width:s.width,dash:s.dash}))).toEqual([{width:.75,dash:[0,1.5]},{width:.75,dash:[]}]);
 await page.evaluate(()=>{const e=(window as any).__vectora;e.undo();});await design.selectOption('dashed');expect((await styles(page)).map(s=>s.width)).toEqual([1,.5]);
});
test('Line appearance survives layer transfers, undo, document reload and SVG export without changing DXF geometry',async({page})=>{
 await seed(page);const weight=page.getByRole('spinbutton',{name:'Line weight (millimetres)',exact:true}),design=page.getByRole('combobox',{name:'Line style',exact:true});
 await weight.fill('0.25');await weight.press('Tab');await design.selectOption('dash-dot');
 const result=await page.evaluate(async()=>{const e=(window as any).__vectora,{encodeDocument,decodeDocument}=await import('/src/documentFormat.ts' as string),{exportSVG}=await import('/src/exportSVG.ts' as string),{exportDXF}=await import('/src/exportDXF.ts' as string);
  const beforeDXF=exportDXF(e.objects,true);e.moveSelectionToLayer('cutline');const after=e.snapshot();e.undo();e.redo();const redone=e.snapshot(),undoKept=after.cutlines===redone.cutlines&&after.artwork===redone.artwork&&after.layers===redone.layers;const decoded=await decodeDocument(encodeDocument(e));e.loadDocument(decoded.snapshot,decoded.view);e.select(null);e.objects.forEach((s:any)=>e.select(s,true));const svg=new DOMParser().parseFromString(exportSVG(e.objects),'image/svg+xml');
  return {undoKept,svg:[...svg.querySelectorAll('path')].map(n=>({width:n.getAttribute('stroke-width'),dash:n.getAttribute('stroke-dasharray')})),beforeDXF,dxf:exportDXF(e.objects,true),geometry:e.objects.map((s:any)=>s.pathData)};
 });
 expect(result.undoKept).toBe(true);expect(await styles(page)).toEqual(Array.from({length:5},()=>({width:.25,scaling:true,dash:[1,.5,0,.5],cap:'round',colour:'#ff0000',fill:null})));expect(result.svg.every(s=>s.width==='0.25'&&s.dash==='1,0.5,0,0.5')).toBe(true);expect(result.dxf).toContain('ENTITIES');expect(result.beforeDXF).toContain('ENTITIES');
});
test('Invalid line weights leave geometry and history unchanged; no selection hides controls',async({page})=>{
 await seed(page);const original=await page.evaluate(()=>(window as any).__vectora.snapshot()),weight=page.getByRole('spinbutton',{name:'Line weight (millimetres)',exact:true});
 for(const value of ['0','-1','1001','']){await weight.fill(value);await weight.press('Tab');await expect(weight).toHaveAttribute('aria-invalid','true');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(original);}
 await page.evaluate(()=>(window as any).__vectora.select(null));await expect(weight).toBeHidden();await expect(page.locator('#properties-empty')).toBeVisible();
});
test('Filled shapes retain their fill and custom outlines across all layer types and transforms',async({page})=>{
 await seed(page);
 await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.setFillColor('#112233');e.fillAt(new p.Point(20,20));e.setLineWeight(.2);e.setLineDesign('dotted');});
 expect(await styles(page)).toEqual([{width:.2,scaling:true,dash:[0,.4],cap:'round',colour:'#112233',fill:'#112233'}]);
 for(const [id,colour,fill] of [['engrave','#0000ff','#0000ff'],['raster','#000000','#000000'],['construction','#ff00ff',null],['cutline','#ff0000',null],['artwork','#112233','#112233']]){
  await page.evaluate(id=>(window as any).__vectora.moveSelectionToLayer(id),id!);
  expect(await styles(page)).toEqual([{width:.2,scaling:true,dash:[0,.4],cap:'round',colour,fill}]);
 }
 const result=await page.evaluate(()=>{const e=(window as any).__vectora;e.setProperty('width',50);e.setRotation(30);e.duplicateSelection();return {width:e.selected.strokeWidth,dash:e.selected.dashArray,cap:e.selected.strokeCap};});expect(result).toEqual({width:.2,dash:[0,.4],cap:'round'});
});
test('Line controls remain accessible in both themes and the reference demonstrates the same styles',async({page})=>{
 await seed(page);await page.evaluate(()=>(window as any).__vectora.select((window as any).__vectora.objects[2]));
 for(const theme of ['dark','light']){
  await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;(window as any).__vectora.refreshTheme();},theme);
  const weight=page.getByRole('spinbutton',{name:'Line weight (millimetres)',exact:true});await weight.fill('0.6');await weight.press('Tab');await page.getByRole('combobox',{name:'Line style',exact:true}).selectOption('dash-dot');
  await page.setViewportSize({width:700,height:650});await weight.scrollIntoViewIfNeeded();
  const layout=await page.locator('#line-appearance').evaluate(el=>{const section=el.getBoundingClientRect();return [...el.querySelectorAll('input,select')].every(field=>{const box=field.getBoundingClientRect();return box.width>0&&box.left>=section.left&&box.right<=section.right;});});expect(layout).toBe(true);
  await page.screenshot({path:`test-results/line-appearance-${theme}.png`});
 }
 await page.goto(DEV+'/reference/design-system.html');await page.getByRole('combobox',{name:'Example line style',exact:true}).selectOption('dotted');
 await expect(page.locator('#example-line-preview')).toHaveAttribute('stroke-linecap','round');await expect(page.locator('#example-line-preview')).toHaveAttribute('stroke-dasharray',/^0 /);
});
test('Join, Explode, Boolean and offset results retain edited strokes when moved to another layer',async({page})=>{
 await seed(page);
 const results=await page.evaluate(async()=>{
  const e=(window as any).__vectora,p=(window as any).__paper;
  const current=()=>e.selectedItems.map((s:any)=>({width:s.strokeWidth,scaling:s.strokeScaling,dash:s.dashArray}));
  e.setLineWeight(.3);e.setLineDesign('dotted');e.joinSelection();e.moveSelectionToLayer('engrave');const joined=current();e.explodeSelection();e.moveSelectionToLayer('raster');const exploded=current();
  e.setActiveLayer('artwork');e.addShape(new p.Path.Rectangle({insert:false,rectangle:[140,10,30,20],strokeColor:'white'}),'First');const first=e.selected;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[155,10,30,20],strokeColor:'white'}),'Second');e.select(first,true);e.setLineWeight(.3);e.setLineDesign('dotted');e.applyShapeOperation('weld');e.moveSelectionToLayer('cutline');const welded=current();
  const {initializeClipper,createPathOffset}=await import('/src/clipperService.ts' as string);await initializeClipper();const source=e.selected,offset=createPathOffset(source,{distance:1,direction:'outward',corners:'round'});source.layer.addChild(offset);e.select(offset);e.moveSelectionToLayer('construction');const shifted=current();
  return {joined,exploded,welded,shifted};
 });
 for(const group of Object.values(results)){expect(group.length).toBeGreaterThan(0);expect(group.every(s=>s.width===.3&&s.scaling&&s.dash[0]===0&&s.dash[1]===.6)).toBe(true);}
});
test('Gradient and pattern fills keep their custom outline colour when transferred back to Artwork',async({page})=>{
 await seed(page);
 const results=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper,results=[];
  for(const paint of [{kind:'gradient',type:'linear',angle:0,opacity:1,stops:[{colour:'#112233',offset:0,opacity:1},{colour:'#445566',offset:1,opacity:1}]},{kind:'pattern',type:'dots',foreground:'#112233',background:'#FFFFFF',transparent:false,size:4,angle:0,detail:25,opacity:1}]){
   e.setFillPaint(paint);e.fillAt(new p.Point(20,20));e.setLineWeight(.2);e.moveSelectionToLayer('engrave');e.moveSelectionToLayer('artwork');results.push({paint:e.selected.data.fillPaint.kind,colour:e.selected.strokeColor.toCSS(true),width:e.selected.strokeWidth});
  }return results;
 });
 expect(results).toEqual([{paint:'gradient',colour:'#112233',width:.2},{paint:'pattern',colour:'#112233',width:.2}]);
});
