import {dragSelectionToLayer} from './layerHelpers';
import {test,expect} from '@playwright/test';
const DEV='http://127.0.0.1:5174';
async function seed(page:any){await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[40,40,30,25],strokeColor:'#383838',strokeWidth:1.5}),'Rectangle');});}
async function open(page:any){await page.getByRole('button',{name:'Layers',exact:true}).click();}

test('Layer types match the reference and selected geometry moves between engraving, construction and artwork',async({page})=>{
  await page.goto(DEV);await seed(page);await open(page);const panel=page.locator('#primary-layers-panel');await expect(panel.locator('[data-layer-count]')).toHaveText('4');await expect(panel.getByText('Raster Engrave')).toHaveCount(0);await expect(panel.locator('.layer-name').filter({hasText:/^Construction Path$/})).toHaveCount(1);
  const before=await page.evaluate(()=>(window as any).__vectora.selected.exportJSON());
  for(const [name,role,color] of [['Engrave Path','engrave','#0000ff'],['Construction Path','construction','#ff00ff'],['Artwork','artwork','#383838']]){
    // Keep empty expanded rows from pushing the target outside this fixed-height panel.
    const emptyLayers=panel.locator('.layer-entry').filter({has:page.locator('.layer-meta').filter({hasText:/^0 objects$/})}).locator('[data-layer-action="expand"][aria-expanded="true"]');
    while(await emptyLayers.count())await emptyLayers.first().click();
    await dragSelectionToLayer(page,name);
    expect(await page.evaluate(()=>{const s=(window as any).__vectora.selected;return {role:s.data.role,layer:s.layer.name,color:s.strokeColor.toCSS(true),fill:s.fillColor,bounds:[s.bounds.x,s.bounds.y,s.bounds.width,s.bounds.height]};})).toEqual({role,layer:name,color,fill:null,bounds:[40,40,30,25]});
    await expect(panel).toBeVisible();await expect(page.locator('#properties-panel')).toBeHidden();
    const exported=await page.evaluate(async()=>{const {exportDXF}=await import('/src/exportDXF.ts'),e=(window as any).__vectora;try{return exportDXF(e.objects,true);}catch{return 'empty';}});
    if(role==='construction')expect(exported).toBe('empty');else if(role==='engrave')expect(exported).toContain('ENGRAVE');else expect(exported).toContain('ARTWORK');
  }
  await page.locator('#cad-canvas').focus();await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.selected.data.role)).toBe('construction');await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.selected.data.role)).toBe('engrave');await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.selected.exportJSON())).toBe(before);
});

test('Add layer supports each type; deletion confirms, protects locks and restores objects with undo',async({page})=>{
  await page.goto(DEV);await seed(page);await open(page);const panel=page.locator('#primary-layers-panel');await panel.getByRole('button',{name:'Add layer',exact:true}).click();await panel.getByRole('menuitem',{name:'Engrave Path',exact:true}).click();await expect(panel.locator('[data-layer-count]')).toHaveText('5');await dragSelectionToLayer(page,'Engrave Path 2');await expect(panel.getByRole('button',{name:'Rectangle',exact:true})).toBeVisible();
  await panel.getByRole('button',{name:'Lock Engrave Path 2',exact:true}).click();await expect(panel.getByRole('button',{name:'Delete selected layer',exact:true})).toBeDisabled();await panel.getByRole('button',{name:'Unlock Engrave Path 2',exact:true}).click();
  const before=await page.evaluate(()=>(window as any).__vectora.snapshot());await panel.getByRole('button',{name:'Delete selected layer',exact:true}).click();await expect(page.getByRole('dialog',{name:'Delete layer?',exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(panel.locator('[data-layer-count]')).toHaveText('5');
  await panel.getByRole('button',{name:'Delete selected layer',exact:true}).click();await page.getByRole('button',{name:'Delete layer',exact:true}).click();await expect(panel.locator('[data-layer-count]')).toHaveText('4');expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(0);
  await page.locator('#cad-canvas').focus();await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before);await expect(panel.locator('[data-layer-count]')).toHaveText('5');await page.keyboard.press('Control+Shift+z');await expect(panel.locator('[data-layer-count]')).toHaveText('4');
  await panel.getByRole('button',{name:'Add layer',exact:true}).focus();await page.keyboard.press('Space');await page.keyboard.press('End');await page.keyboard.press('Space');await expect(panel.locator('.layer-name').filter({hasText:'Construction Path 2'})).toBeVisible();
  await page.screenshot({path:'test-results/layers-live.png'});
});

test('Removing default layers does not leave invisible objects; new layers, history and export stay consistent',async({page})=>{
  await page.goto(DEV);await seed(page);const state=await page.evaluate(()=>{const e=(window as any).__vectora,before=e.snapshot();for(const layer of [...e.documentLayers])e.deleteDocumentLayer(layer.data.documentId);return {before,count:e.documentLayers.length,objects:e.objects.length};});expect(state.count).toBe(0);expect(state.objects).toBe(0);await open(page);await expect(page.getByText('No layers yet. Add a layer to get started.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Add layer',exact:true}).click();await page.getByRole('menuitem',{name:'Artwork',exact:true}).click();await seed(page);expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(1);
  await page.getByRole('button',{name:'Add layer',exact:true}).click();await page.getByRole('menuitem',{name:'Cut Path',exact:true}).click();await dragSelectionToLayer(page);expect(await page.evaluate(async()=>{const {exportDXF}=await import('/src/exportDXF.ts');return exportDXF((window as any).__vectora.objects);})).toContain('CUTLINE');
});

test('Production layers remain within a narrow viewport and custom layer names export separately',async({page})=>{
  await page.goto(DEV);const dxf=await page.evaluate(async()=>{const e=(window as any).__vectora,p=(window as any).__paper,{exportDXF}=await import('/src/exportDXF.ts');for(let i=0;i<2;i++){e.addShape(new p.Path.Line({insert:false,from:[30+i*10,30],to:[35+i*10,45],strokeColor:'#383838'}),'Line');const layer=e.addDocumentLayer('engrave');e.moveSelectionToLayer(layer.data.documentId);}return exportDXF(e.objects);});expect(dxf).toContain('ENGRAVE_PATH_2');expect(dxf).toContain('ENGRAVE_PATH_3');expect(dxf.match(/LWPOLYLINE/g)).toHaveLength(2);
  await page.setViewportSize({width:420,height:700});await page.goto('http://127.0.0.1:4173');await open(page);const panel=page.locator('#primary-layers-panel');await panel.getByRole('button',{name:'Add layer',exact:true}).click();const box=(await panel.locator('[data-layer-add-menu]').boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(420);expect(box.y).toBeGreaterThanOrEqual(0);await panel.getByRole('menuitem',{name:'Engrave Path',exact:true}).click();await expect(panel.locator('[data-layer-count]')).toHaveText('5');await page.screenshot({path:'test-results/layers-mobile.png'});
});

async function dragSetup(page:any){
  await page.goto(DEV);await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;for(let i=0;i<2;i++)e.addShape(new p.Path.Rectangle({insert:false,rectangle:[40+i*40,40,30,25],strokeColor:'#383838',strokeWidth:1.5}),i?'Second':'First');});
  await open(page);await page.getByRole('button',{name:'Expand Artwork',exact:true}).click();
}

test('Dragging an unselected layer object transfers only that object and supports Undo and Redo',async({page})=>{
  await dragSetup(page);const panel=page.locator('#primary-layers-panel');
  const before=await page.evaluate(()=>(window as any).__vectora.snapshot());
  await panel.getByRole('button',{name:'First',exact:true}).dragTo(panel.locator('[data-layer-id="cutline"] .layer-select'));
  const state=await page.evaluate(()=>{const e=(window as any).__vectora;return e.objects.map((item:any)=>({name:item.data.name,role:item.data.role,color:item.strokeColor.toCSS(true),bounds:[item.bounds.x,item.bounds.y,item.bounds.width,item.bounds.height]}));});
  expect(state).toEqual(expect.arrayContaining([{name:'First',role:'cutline',color:'#ff0000',bounds:[40,40,30,25]},{name:'Second',role:'artwork',color:'#383838',bounds:[80,40,30,25]}]));
  await expect(panel.locator('[data-layer-id="cutline"] .layer-object')).toHaveText('First');await expect(panel.locator('.is-drop-target,.is-object-dragging')).toHaveCount(0);
  await page.locator('#cad-canvas').focus();await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before);
  await page.keyboard.press('Control+Shift+z');expect(await page.evaluate(()=>(window as any).__vectora.cutlines.children.length)).toBe(1);
});

test('Dragging a selected layer object moves the selection together and preserves geometry',async({page})=>{
  await dragSetup(page);const panel=page.locator('#primary-layers-panel');await page.evaluate(()=>{const e=(window as any).__vectora;e.select(e.objects[0],true);});
  await panel.getByRole('button',{name:'First',exact:true}).dragTo(panel.locator('[data-layer-id="engrave"] .layer-select'));
  expect(await page.evaluate(()=>{const e=(window as any).__vectora;return {roles:e.objects.map((item:any)=>item.data.role),selection:e.selectedItems.length,bounds:e.objects.map((item:any)=>[item.bounds.x,item.bounds.y,item.bounds.width,item.bounds.height])};})).toEqual({roles:['engrave','engrave'],selection:2,bounds:[[40,40,30,25],[80,40,30,25]]});
  await page.locator('#cad-canvas').focus();await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.artwork.children.length)).toBe(2);
});

test('Layer drag highlights valid targets and cancelled or blocked drops leave objects unchanged',async({page})=>{
  await dragSetup(page);const panel=page.locator('#primary-layers-panel');
  const before=await page.evaluate(()=>(window as any).__vectora.snapshot());
  const source=panel.getByRole('button',{name:'First',exact:true}),target=panel.locator('[data-layer-id="cutline"] .layer-select');
  await source.scrollIntoViewIfNeeded();const from=(await source.boundingBox())!,to=(await target.boundingBox())!;
  await page.mouse.move(from.x+20,from.y+from.height/2);await page.mouse.down();await page.mouse.move(from.x+30,from.y+from.height/2,{steps:5});await page.mouse.move(to.x+30,to.y+to.height/2,{steps:10});await page.mouse.move(to.x+31,to.y+to.height/2);
  await expect(panel.locator('[data-layer-id="cutline"]')).toHaveClass(/is-drop-target/);await expect(panel.locator('[data-layer-id="cutline"] .layer-row')).toHaveCSS('outline-color','rgb(255, 255, 255)');await page.screenshot({path:'test-results/layers-drag-target.png'});
  await page.keyboard.press('Escape');await page.mouse.up();await expect(panel.locator('.is-drop-target,.is-object-dragging')).toHaveCount(0);expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before);
  for(const mode of ['lock','visibility']){
    await page.evaluate(mode=>{const e=(window as any).__vectora;e.setLayerState('cutline',mode==='lock'?'locked':'visible',mode==='lock');},mode);
    const blocked=await page.evaluate(()=>(window as any).__vectora.snapshot());await source.dragTo(target);expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(blocked);await expect(panel.locator('.is-drop-target,.is-object-dragging')).toHaveCount(0);
    await page.evaluate(mode=>{const e=(window as any).__vectora;e.setLayerState('cutline',mode==='lock'?'locked':'visible',mode!=='lock');},mode);
  }
  await source.dragTo(panel.locator('[data-layer-id="artwork"] .layer-select'));expect(await page.evaluate(()=>(window as any).__vectora.cutlines.children.length)).toBe(0);
});

test('Holding a layer object at list edges scrolls both directions, stops away from edges and drops onto revealed layers',async({page})=>{
  await page.goto(DEV);await seed(page);await page.evaluate(()=>{const e=(window as any).__vectora;for(let i=0;i<10;i++)e.addDocumentLayer('engrave');});await open(page);
  const panel=page.locator('#primary-layers-panel'),list=panel.locator('.layer-list');await panel.getByRole('button',{name:'Expand Artwork',exact:true}).click();
  const source=panel.locator('[data-layer-id="artwork"] .layer-object');await source.scrollIntoViewIfNeeded();const bounds=(await list.boundingBox())!,from=(await source.boundingBox())!,x=bounds.x+bounds.width/2;
  const initial=await list.evaluate(el=>el.scrollTop);expect(initial).toBeGreaterThan(400);const header=await panel.locator('.layers-header').boundingBox(),footer=await panel.locator('.layer-footer').boundingBox();
  await page.mouse.move(from.x+30,from.y+from.height/2);await page.mouse.down();await page.mouse.move(from.x+42,from.y+from.height/2,{steps:5});await page.mouse.move(x,bounds.y+10,{steps:8});
  await expect.poll(()=>list.evaluate(el=>el.scrollTop)).toBeLessThan(initial-100);
  await page.mouse.move(x,bounds.y+bounds.height/2);const stopped=await list.evaluate(el=>el.scrollTop);await page.waitForTimeout(250);expect(await list.evaluate(el=>el.scrollTop)).toBeCloseTo(stopped,0);
  await page.mouse.move(x,bounds.y+5);await expect.poll(()=>list.evaluate(el=>el.scrollTop),{timeout:7000}).toBe(0);
  expect(await panel.locator('.layers-header').boundingBox()).toEqual(header);expect(await panel.locator('.layer-footer').boundingBox()).toEqual(footer);
  const cut=(await panel.locator('[data-layer-id="cutline"] .layer-select').boundingBox())!;await page.mouse.move(cut.x+30,cut.y+cut.height/2);await page.mouse.up();
  expect(await page.evaluate(()=>(window as any).__vectora.selected.data.role)).toBe('cutline');
  const moved=panel.locator('[data-layer-id="cutline"] .layer-object'),start=(await moved.boundingBox())!;await page.mouse.move(start.x+30,start.y+start.height/2);await page.mouse.down();await page.mouse.move(start.x+42,start.y+start.height/2,{steps:5});await page.mouse.move(x,bounds.y+bounds.height-5,{steps:8});
  await expect.poll(()=>list.evaluate(el=>el.scrollTop)).toBeGreaterThan(100);
  await expect.poll(()=>list.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop),{timeout:7000}).toBeLessThanOrEqual(1);
  const artwork=(await panel.locator('[data-layer-id="artwork"] .layer-select').boundingBox())!;await page.mouse.move(artwork.x+30,artwork.y+artwork.height/2);await page.mouse.up();
  expect(await page.evaluate(()=>(window as any).__vectora.selected.data.role)).toBe('artwork');await expect(panel.locator('.is-drop-target,.is-object-dragging')).toHaveCount(0);
  const dropped=await list.evaluate(el=>el.scrollTop);await page.waitForTimeout(150);expect(await list.evaluate(el=>el.scrollTop)).toBe(dropped);
});

test('Cancelling an edge-scrolling layer drag stops scrolling without moving objects',async({page})=>{
  await dragSetup(page);await page.evaluate(()=>{const e=(window as any).__vectora;for(let i=0;i<8;i++)e.addDocumentLayer('engrave');});
  const panel=page.locator('#primary-layers-panel'),list=panel.locator('.layer-list'),source=panel.getByRole('button',{name:'First',exact:true});await source.scrollIntoViewIfNeeded();const from=(await source.boundingBox())!,bounds=(await list.boundingBox())!,before=await page.evaluate(()=>(window as any).__vectora.snapshot()),initial=await list.evaluate(el=>el.scrollTop);
  await page.mouse.move(from.x+25,from.y+from.height/2);await page.mouse.down();await page.mouse.move(from.x+40,from.y+from.height/2,{steps:5});await page.mouse.move(bounds.x+100,bounds.y+5,{steps:8});await expect.poll(()=>list.evaluate(el=>el.scrollTop)).toBeLessThan(initial-60);
  await page.keyboard.press('Escape');await page.mouse.up();const stopped=await list.evaluate(el=>el.scrollTop);await page.waitForTimeout(200);expect(await list.evaluate(el=>el.scrollTop)).toBe(stopped);expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before);
});
