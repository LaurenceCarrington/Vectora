import {dragSelectionToLayer} from './layerHelpers';
import {test,expect} from './fixtures';
const DEV='http://127.0.0.1:5174';
const state=(page:any)=>page.evaluate(()=>{const e=(window as any).__vectora,s=e.selected;return {active:e.activeLayerId,layer:s?.layer.data.documentId,role:s?.data.role,stroke:s?.strokeColor?.toCSS(true),fill:s?.fillColor?.toCSS(true),count:e.objects.length};});

test('Layer rows direct all pointer drawing tools into the chosen layer with matching colours',async({page})=>{
 await page.goto(DEV);await page.getByRole('button',{name:'Layers',exact:true}).click();
 const choices=[['raster','#000000','rectangle'],['cutline','#ff0000','rectangle'],['engrave','#0000ff','circle'],['construction','#ff00ff','ellipse'],['artwork','#ffffff','polygon'],['cutline','#ff0000','line'],['engrave','#0000ff','freehand'],['construction','#ff00ff','arc'],['cutline','#ff0000','polyline'],['engrave','#0000ff','arc-three-point'],['construction','#ff00ff','arc-endpoints']];
 for(const [id,colour,tool] of choices){
  if(await page.locator('#primary-layers-panel').isHidden())await page.getByRole('button',{name:'Layers',exact:true}).click();
  await page.locator(`[data-layer-id="${id}"] [data-layer-action="select"]`).click();
  await expect(page.locator(`[data-layer-id="${id}"] [data-layer-action="select"]`)).toHaveAttribute('aria-pressed','true');
  await page.evaluate(tool=>{const e=(window as any).__vectora;e.setSnappingEnabled(false);e.setTool(tool);},tool);
  if(tool==='polyline'){await page.mouse.click(310,300);await page.mouse.click(430,320);await page.mouse.click(410,400);await page.keyboard.press('Enter');}
  else if(tool.startsWith('arc-')){await page.mouse.click(300,300);await page.mouse.click(420,300);await page.mouse.click(350,390);}
  else{await page.mouse.move(300,300);await page.mouse.down();await page.mouse.move(470,420,{steps:8});await page.mouse.up();}
  expect(await state(page)).toMatchObject({active:id,layer:id,role:id,stroke:colour});
 }
 await page.screenshot({path:'test-results/active-drawing-layer.png'});
});

test('Additional layers receive drawing and tracing while Fill targets Artwork, with history and saved active layer',async({page})=>{
 await page.goto(DEV);
 const result=await page.evaluate(async()=>{
  const e=(window as any).__vectora,p=(window as any).__paper,{loadTextFont}=await import('/src/text.ts'),{createDimension}=await import('/src/dimensions.ts'),{encodeDocument,decodeDocument}=await import('/src/documentFormat.ts');
  const layer=e.addDocumentLayer('engrave'),id=layer.data.documentId,records:any[]=[];
  const record=()=>records.push({layer:e.selected.layer.data.documentId,role:e.selected.data.role,colour:(e.selected.fillColor??e.selected.strokeColor).toCSS(true)});
  await loadTextFont('lato');e.saveText('A',10,new p.Point(20,20),null,'lato');record();
  e.addShape(new p.Path.Rectangle({insert:false,rectangle:[50,50,40,40]}),'Box');record();
  e.setFillColor('#FF0000');e.fillAt(new p.Point(60,60));record();const filled=!!e.selected.fillColor;
  const trace=new p.Path.Circle({insert:false,center:[110,30],radius:10,fillColor:'white'});trace.data.rasterTrace={mode:'fill'};e.addTracedShapes([trace],'Trace');record();
  e.addShape(createDimension({kind:'dimension-aligned',points:[[10,10],[40,10],[20,30]],transform:[1,0,0,1,0,0]}),'Dimension');record();
  const count=e.objects.length;e.undo();const undone={count:e.objects.length,active:e.activeLayerId};e.redo();const redone={count:e.objects.length,active:e.activeLayerId};
  const decoded=await decodeDocument(encodeDocument(e));e.newDocument();const newActive=e.activeLayerId;e.loadDocument(decoded.snapshot,decoded.view);
  return {id,records,filled,count,undone,redone,newActive,loaded:e.activeLayerId};
 });
 expect(result.records).toHaveLength(5);for(const [index,item] of result.records.entries())expect(item).toEqual(index===2?{layer:'artwork',role:'artwork',colour:'#ff0000'}:{layer:result.id,role:'engrave',colour:'#0000ff'});
 expect(result.filled).toBe(true);expect(result.undone).toEqual({count:result.count-1,active:result.id});expect(result.redone).toEqual({count:result.count,active:result.id});expect(result.newActive).toBe('artwork');expect(result.loaded).toBe(result.id);
});

test('Active locked or hidden layers block creation, and deleting an active layer selects a valid fallback',async({page})=>{
 await page.goto(DEV);
 await page.evaluate(()=>{const e=(window as any).__vectora;e.setActiveLayer('engrave');e.setLayerState('engrave','locked',true);e.setTool('rectangle');});
 await page.mouse.move(300,300);await page.mouse.down();await page.mouse.move(450,400);await page.mouse.up();expect((await state(page)).count).toBe(0);await expect(page.locator('#toast-stack')).toContainText('Show and unlock Engrave Path');
 const result=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.setLayerState('engrave','locked',false);e.setLayerState('engrave','visible',false);let message='';try{e.addShape(new p.Path.Circle({insert:false,center:[20,20],radius:5}),'Circle');}catch(error){message=(error as Error).message;}e.deleteDocumentLayer('engrave');const fallback=e.activeLayerId;e.addShape(new p.Path.Circle({insert:false,center:[20,20],radius:5}),'Circle');return {message,fallback,layer:e.selected.layer.data.documentId,count:e.objects.length};});
 expect(result).toMatchObject({message:'Show and unlock Engrave Path before drawing.',fallback:'artwork',layer:'artwork',count:1});
});

test('Layer transfer redo restores the drawing destination before the next object is created',async({page})=>{
 await page.goto(DEV);
 const before=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[10,10,20,20]}),'Rectangle');return e.snapshot();});
 await page.getByRole('button',{name:'Layers',exact:true}).click();await dragSelectionToLayer(page);
 const after=await page.evaluate(()=>(window as any).__vectora.snapshot());expect(after.activeLayerId).toBe('cutline');
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before);
 await page.getByRole('button',{name:'Redo',exact:true}).click();
 await expect(page.locator('[data-layer-id="cutline"] .layer-select')).toHaveAttribute('aria-pressed','true');
 expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(after);
 await page.locator('#cad-canvas').focus();await page.keyboard.press('r');await page.mouse.move(220,560);await page.mouse.down();await page.mouse.move(380,660);await page.mouse.up();
 expect(await page.evaluate(()=>(window as any).__vectora.objects.map((s:any)=>s.layer.data.documentId))).toEqual(['cutline','cutline']);
 await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(after);
 await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before);
});
