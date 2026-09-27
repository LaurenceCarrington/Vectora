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
  e.addShape(createCircularArc({cx:10,cy:20,radius:8,start:30,sweep:220}),'Arc');e.moveSelectionToLayer('construction');e.setLayerState('construction','visible',false);
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
 await fileAction(page,'Save');const dialog=page.getByRole('dialog',{name:'Save document',exact:true});await expect(dialog).toBeVisible();await dialog.getByRole('textbox',{name:'Document file name'}).fill('Design one');await dialog.screenshot({path:'test-results/save-dialog.png'});
 let pending=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download',exact:true}).click();let download=await pending;expect(download.suggestedFilename()).toBe('Design one.vectora');const contents=await readFile((await download.path())!,'utf8');
 await shape(page);pending=page.waitForEvent('download');await fileAction(page,'Save');download=await pending;expect(download.suggestedFilename()).toBe('Design one.vectora');
 await fileAction(page,'Save as…');await dialog.getByRole('textbox',{name:'Document file name'}).fill('Design two.vectora');pending=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download',exact:true}).click();expect((await pending).suggestedFilename()).toBe('Design two.vectora');
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
  w.showSaveFilePicker=async()=>{w.picks++;if(w.cancelSave)throw new DOMException('Cancelled','AbortError');const name=`Document ${w.picks}.vectora`;return {name,createWritable:async()=>({write:async(text:string)=>{if(w.failWrite)throw new Error('Disk full');w.writes.push({name,text});},close:async()=>{},abort:async()=>{}})};};
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
