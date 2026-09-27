import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const DEV='http://127.0.0.1:5174';
async function shape(page:any){await page.evaluate(()=>{const p=(window as any).__paper,e=(window as any).__vectora;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[10,20,30,40],strokeColor:'#383838',strokeWidth:1.5,strokeScaling:false}),'Rectangle');});}
async function fileAction(page:any,name:string){await page.getByRole('button',{name:'File',exact:true}).click();await page.getByRole('menuitem',{name,exact:true}).click();}
async function openFile(page:any,file:any){const pending=page.waitForEvent('filechooser');await fileAction(page,'Open file…');await(await pending).setFiles(file);}
async function fallback(page:any){await page.addInitScript(()=>{Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true});Object.defineProperty(window,'showOpenFilePicker',{value:undefined,configurable:true});});}

test('Vectora round trip retains curves, text editing, dimensions, fills, hidden layers and the view',async({page})=>{
 await page.goto(DEV);const result=await page.evaluate(async()=>{
  const p=(window as any).__paper,e=(window as any).__vectora,{encodeDocument,decodeDocument}=await import('/src/documentFormat.ts'),{loadTextFont,createTextShape}=await import('/src/text.ts'),{createCircularArc}=await import('/src/arc.ts'),{createDimension}=await import('/src/dimensions.ts');
  await loadTextFont('lato');e.addShape(createTextShape({content:'OB',fontId:'lato',sizeMM:12,transform:[1,0,0,1,20,30]}),'Text');const textId=e.selected.data.uid;
  e.addShape(createCircularArc({cx:10,cy:20,radius:8,start:30,sweep:220}),'Arc');e.moveSelectionToLayer('construction');e.setLayerState('construction','visible',false);e.setActiveLayer('artwork');
  e.addShape(new p.Path.Circle({insert:false,center:[-20,-20],radius:10,strokeColor:'#383838'}),'Circle');e.fillAt(new p.Point(-20,-20));e.setFillColor('#FF00FF');e.fillAt(new p.Point(-20,-20));
  e.addShape(createDimension({kind:'leader',points:[[0,0],[10,10],[20,10]],text:'Label & <test>',transform:[1,0,0,1,0,0]}),'Callout');
  const layer=e.addDocumentLayer('engrave');layer.name='Engrave <safe> & "quoted"';e.moveSelectionToLayer(layer.data.documentId);e.setLayerState(layer.data.documentId,'locked',true);
  p.view.zoom=7;p.view.center=new p.Point(-25,90);
  const encoded=encodeDocument(e),before=e.snapshot(),count=e.objects.length,loaded=await decodeDocument(encoded);
  const decodeUnchanged=JSON.stringify(e.snapshot())===JSON.stringify(before);e.loadDocument(loaded.snapshot,loaded.view);
  const roundtrip=JSON.parse(encodeDocument(e)),original=JSON.parse(encoded);
  e.select(e.objects.find((x:any)=>x.data.uid===textId));const font=e.selected.data.text.fontId;e.saveText('BO',12,null,textId,font);e.convertTextToPaths();
  return {decodeUnchanged,count,loadedCount:original.layers.reduce((n:any,l:any)=>n+l.objects.length,0),roundtrip,original,font,converted:e.selectedItems.length,noText:e.selectedItems.every((x:any)=>!x.data.text),history:e.canUndo};
 });
 expect(result.decodeUnchanged).toBe(true);expect(result.count).toBe(result.loadedCount);const rounded=(value:unknown)=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='number'?Number(v.toFixed(9)):v));expect(rounded(result.roundtrip)).toEqual(rounded(result.original));expect(result.font).toBe('lato');expect(result.converted).toBe(5);expect(result.noText).toBe(true);expect(result.history).toBe(true);
 await page.getByRole('button',{name:'Layers',exact:true}).click();await expect(page.locator('.layer-name').filter({hasText:'Engrave <safe> & "quoted"'})).toBeVisible();expect(await page.locator('.layer-name safe').count()).toBe(0);
});

test('Fallback Save, Save As, Open and invalid files preserve the drawing appropriately',async({page})=>{
 await fallback(page);await page.goto(DEV);await shape(page);
 let pending=page.waitForEvent('download');await fileAction(page,'Save');let download=await pending;expect(download.suggestedFilename()).toBe('Untitled.vectora');await expect(page.locator('#document-dialog')).not.toBeVisible();const contents=await readFile((await download.path())!,'utf8');
 await shape(page);pending=page.waitForEvent('download');await fileAction(page,'Save');download=await pending;expect(download.suggestedFilename()).toBe('Untitled.vectora');
 pending=page.waitForEvent('download');await fileAction(page,'Save as…');expect((await pending).suggestedFilename()).toBe('Untitled.vectora');await expect(page.locator('#document-dialog')).not.toBeVisible();await expect(page.locator('.toast-success')).toHaveCount(0);
 await fileAction(page,'New document');await page.getByRole('dialog',{name:'New document?',exact:true}).getByRole('button',{name:'Cancel',exact:true}).click();
 await shape(page);const before=await page.evaluate(()=>(window as any).__vectora.snapshot());
 await openFile(page,{name:'Design one.vectora',mimeType:'application/json',buffer:Buffer.from(contents)});
 await page.getByRole('dialog',{name:'Open document?',exact:true}).getByRole('button',{name:'Cancel',exact:true}).click();expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before);
 await openFile(page,{name:'Design one.vectora',mimeType:'application/json',buffer:Buffer.from(contents)});
 await page.getByRole('dialog',{name:'Open document?',exact:true}).getByRole('button',{name:'Open document',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(1);expect(await page.evaluate(()=>(window as any).__vectora.canUndo)).toBe(false);
 await openFile(page,{name:'broken.vectora',mimeType:'application/json',buffer:Buffer.from('{broken')});await expect(page.locator('.toast-error')).toContainText('valid .vectora');expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(1);
});

test('Native Save reuses the selected file, Save As changes target only on success and cancelled saves do nothing',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.picks=0;w.writes=[];w.cancelSave=false;w.failWrite=false;
  w.showSaveFilePicker=async()=>{if(document.querySelector('dialog[open]'))throw new Error('Unexpected in-app save dialog');w.picks++;if(w.cancelSave)throw new DOMException('Cancelled','AbortError');const name=`Document ${w.picks}.vectora`;return {name,createWritable:async()=>({write:async(text:string)=>{if(w.failWrite)throw new Error('Disk full');w.writes.push({name,text});},close:async()=>{},abort:async()=>{}})};};
 });
 await page.goto(DEV);await shape(page);await fileAction(page,'Save');await expect.poll(()=>page.evaluate(()=>(window as any).writes.length)).toBe(1);
 await page.locator('#cad-canvas').focus();await page.keyboard.press('Control+s');await expect.poll(()=>page.evaluate(()=>(window as any).writes.length)).toBe(2);expect(await page.evaluate(()=>(window as any).picks)).toBe(1);
 await page.keyboard.press('Control+Shift+s');await expect.poll(()=>page.evaluate(()=>(window as any).writes.length)).toBe(3);expect(await page.evaluate(()=>(window as any).writes.at(-1).name)).toBe('Document 2.vectora');
 await page.evaluate(()=>{(window as any).failWrite=true;});await fileAction(page,'Save as…');await expect(page.locator('.toast-error')).toContainText('Disk full');await page.evaluate(()=>{(window as any).failWrite=false;});await fileAction(page,'Save');await expect.poll(()=>page.evaluate(()=>(window as any).writes.length)).toBe(4);expect(await page.evaluate(()=>(window as any).writes.at(-1).name)).toBe('Document 2.vectora');
 await page.evaluate(()=>{(window as any).cancelSave=true;});await fileAction(page,'Save as…');expect(await page.evaluate(()=>(window as any).writes.length)).toBe(4);expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(1);
});

test('Invalid document content is rejected before changing the current drawing',async({page})=>{
 await page.goto(DEV);await shape(page);const result=await page.evaluate(async()=>{
  const e=(window as any).__vectora,{encodeDocument,decodeDocument}=await import('/src/documentFormat.ts'),file=JSON.parse(encodeDocument(e)),before=e.snapshot();let rejected=0;
  for(const mutate of [(d:any)=>d.version=99,(d:any)=>d.layers.push(d.layers[0]),(d:any)=>d.layers.find((l:any)=>l.objects.length).objects[0].kind='Raster',(d:any)=>d.layers.find((l:any)=>l.objects.length).objects[0].contours[0].segments[0][0]=1e100,(d:any)=>d.layers.find((l:any)=>l.objects.length).objects[0].data.uid='bad" id']){const d=structuredClone(file);mutate(d);try{await decodeDocument(JSON.stringify(d));}catch{rejected++;}}
  return {rejected,unchanged:JSON.stringify(e.snapshot())===JSON.stringify(before)};
 });expect(result).toEqual({rejected:5,unchanged:true});
});

test('New document confirms unsaved changes, resets the drawing and asks for a new save name',async({page})=>{
 await fallback(page);await page.goto(DEV);await shape(page);
 await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addDocumentLayer('artwork');e.deleteDocumentLayer('construction');e.setLayerState('artwork','locked',true);e.setLayerState('engrave','visible',false);e.setTool('circle');e.snappingEnabled=false;p.view.zoom=8;p.view.center=new p.Point(-50,30);});
 const before=await page.evaluate(()=>(window as any).__vectora.snapshot());
 await fileAction(page,'New document');const dialog=page.getByRole('dialog',{name:'New document?',exact:true});await expect(dialog).toBeVisible();await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();await expect(dialog.getByRole('textbox')).toHaveCount(0);
 await dialog.screenshot({path:'test-results/new-document-dialog.png'});await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before);
 await fileAction(page,'New document');await dialog.getByRole('button',{name:'New document',exact:true}).click();await expect(page).toHaveTitle('Untitled — Vectora');await expect(page.locator('[data-document-name]')).toHaveText('Untitled.vectora');
 const state=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;return {count:e.objects.length,layers:e.documentLayers.map((l:any)=>({id:l.data.documentId,visible:l.visible,locked:l.locked})),undo:e.canUndo,redo:e.canRedo,selected:e.selectedItems.length,tool:e.tool,zoom:p.view.zoom,center:[p.view.center.x,p.view.center.y],snapping:e.snappingEnabled};});
 expect(state).toMatchObject({count:0,undo:false,redo:false,selected:0,tool:'select',snapping:false});expect(state.center[0]).toBeCloseTo(100);expect(state.center[1]).toBeCloseTo(70);expect(state.zoom).toBeCloseTo(96/25.4);expect(state.layers.map(l=>l.id).sort()).toEqual(['artwork','construction','cutline','engrave']);expect(state.layers.every(l=>l.visible&&!l.locked)).toBe(true);
 await page.locator('#cad-canvas').focus();await page.keyboard.press('Control+n');await expect(dialog).not.toBeVisible();const pending=page.waitForEvent('download');await fileAction(page,'Save');expect((await pending).suggestedFilename()).toBe('Untitled.vectora');await expect(page.locator('#document-dialog')).not.toBeVisible();
});

test('New document preserves the saved target on cancel and forgets it after confirmation',async({page})=>{
 await page.addInitScript(()=>{const w=window as any;w.picks=0;w.writes=[];w.showSaveFilePicker=async()=>{const name=`Design ${++w.picks}.vectora`;return {name,createWritable:async()=>({write:async(text:string)=>w.writes.push({name,text}),close:async()=>{},abort:async()=>{}})};};});
 await page.goto(DEV);await shape(page);await fileAction(page,'Save');await expect(page).toHaveTitle('Design 1.vectora — Vectora');await shape(page);
 await page.locator('#cad-canvas').focus();await page.keyboard.press('Control+n');const dialog=page.getByRole('dialog',{name:'New document?',exact:true});await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await fileAction(page,'Save');await expect.poll(()=>page.evaluate(()=>(window as any).writes.length)).toBe(2);expect(await page.evaluate(()=>(window as any).picks)).toBe(1);
 await shape(page);await fileAction(page,'New document');await dialog.getByRole('button',{name:'New document',exact:true}).click();await expect(page).toHaveTitle('Untitled — Vectora');await expect(page.locator('[data-document-name]')).toHaveText('Untitled.vectora');await shape(page);await fileAction(page,'Save');await expect(page).toHaveTitle('Design 2.vectora — Vectora');expect(await page.evaluate(()=>(window as any).picks)).toBe(2);
 await fileAction(page,'New document');await expect(page).toHaveTitle('Untitled — Vectora');await expect(page.locator('[data-document-name]')).toHaveText('Untitled.vectora');await expect(dialog).not.toBeVisible();
});


test('Save success waits for the native file write to finish',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.writing=false;w.showSaveFilePicker=async()=>({name:'Confirmed.vectora',createWritable:async()=>({write:async()=>{},close:()=>new Promise<void>(resolve=>{w.writing=true;w.finishSave=resolve;}),abort:async()=>{}})});
 });
 await page.goto(DEV);await shape(page);const title=await page.title();await fileAction(page,'Save');await expect.poll(()=>page.evaluate(()=>(window as any).writing)).toBe(true);await expect(page.locator('.toast-success')).toHaveCount(0);await expect(page).toHaveTitle(title);
 await page.evaluate(()=>(window as any).finishSave());await expect(page.locator('.toast-success')).toContainText('Saved Confirmed.vectora.');await expect(page).toHaveTitle('Confirmed.vectora — Vectora');await expect(page.locator('[data-document-name]')).toHaveText('Confirmed.vectora');
});

test('Click-to-rename title is borderless, isolates shortcuts and saves the new name',async({page})=>{
 await fallback(page);await page.goto(DEV);await shape(page);
 const title=page.getByRole('textbox',{name:'Project name',exact:true});
 const before=await page.evaluate(()=>{const e=(window as any).__vectora;return {snapshot:e.snapshot(),tool:e.tool,snapping:e.snappingEnabled};});
 await title.click();await page.keyboard.type('Laser sign');
 await expect(title).toHaveCSS('border-top-width','0px');await expect(title).toHaveCSS('outline-style','none');await expect(title).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
 await page.keyboard.press('Enter');await expect(title).toHaveText('Laser sign.vectora');await expect(page).toHaveTitle('Laser sign.vectora — Vectora');
 expect(await page.evaluate(()=>{const e=(window as any).__vectora;return {snapshot:e.snapshot(),tool:e.tool,snapping:e.snappingEnabled};})).toEqual(before);
 await title.click();await page.keyboard.type('Cancelled');await page.keyboard.press('Escape');await expect(title).toHaveText('Laser sign.vectora');
 await title.fill('');await page.getByRole('button',{name:'File',exact:true}).click();await expect(title).toHaveText('Laser sign.vectora');await page.keyboard.press('Escape');
 await title.click();await page.keyboard.type('Final design');
 const pending=page.waitForEvent('download');await page.keyboard.press('Control+s');expect((await pending).suggestedFilename()).toBe('Final design.vectora');
 await expect(title).toHaveText('Final design.vectora');await page.screenshot({path:'test-results/project-name.png'});
});

test('Renaming a saved project requests a new destination and retains its name after cancellation',async({page})=>{
 await page.addInitScript(()=>{const w=window as any;w.names=[];w.cancelSave=false;w.showSaveFilePicker=async(options:any)=>{w.names.push(options.suggestedName);if(w.cancelSave)throw new DOMException('Cancelled','AbortError');return {name:options.suggestedName,createWritable:async()=>({write:async()=>{},close:async()=>{},abort:async()=>{}})};};});
 await page.goto(DEV);await shape(page);await fileAction(page,'Save');await expect(page).toHaveTitle('Untitled.vectora — Vectora');
 const title=page.getByRole('textbox',{name:'Project name',exact:true});await title.click();await page.keyboard.type('Renamed project');await page.keyboard.press('Enter');
 await page.evaluate(()=>{(window as any).cancelSave=true;});await fileAction(page,'Save');await expect(title).toHaveText('Renamed project.vectora');
 await page.evaluate(()=>{(window as any).cancelSave=false;});await fileAction(page,'Save');await expect.poll(()=>page.evaluate(()=>(window as any).names)).toEqual(['Untitled.vectora','Renamed project.vectora','Renamed project.vectora']);
 await fileAction(page,'Save');expect(await page.evaluate(()=>(window as any).names.length)).toBe(3);
});
