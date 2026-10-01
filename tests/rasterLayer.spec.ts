import {test,expect} from './fixtures';
const DEV='http://127.0.0.1:5174';
test('Raster Engrave sits above Artwork and draws black in both themes',async({page})=>{
 await page.goto(DEV);await page.getByRole('button',{name:'Layers',exact:true}).click();const panel=page.locator('#primary-layers-panel');
 await expect(panel.locator('.layer-name')).toHaveText(['Cut Path','Engrave Path','Construction Path','Raster Engrave','Artwork']);await expect(panel.locator('[data-layer-count]')).toHaveText('5');
 const row=panel.locator('[data-layer-type="raster"]');await expect(row.locator('.layer-dot')).toHaveCSS('background-color','rgb(0, 0, 0)');await row.locator('[data-layer-action="select"]').click();
 for(const theme of ['dark','light']){
  await page.evaluate(theme=>{const e=(window as any).__vectora,p=(window as any).__paper;document.documentElement.dataset.theme=theme;e.refreshTheme();e.addShape(new p.Path.Rectangle({insert:false,rectangle:[20,20,30,20]}),'Raster rectangle');},theme);
  expect(await page.evaluate(()=>{const e=(window as any).__vectora,s=e.selected;return {role:s.data.role,layer:s.layer.name,colour:s.strokeColor.toCSS(true),fill:s.fillColor};})).toEqual({role:'raster',layer:'Raster Engrave',colour:'#000000',fill:null});
  await expect(row.locator('.layer-dot')).toHaveCSS('background-color','rgb(0, 0, 0)');
 }
 await page.screenshot({path:'test-results/raster-layer-light.png'});
 await page.goto(DEV+'/reference/design-system.html');
 await expect(panel.locator('.layer-name')).toHaveText(['Cut Path','Engrave Path','Construction Path','Raster Engrave','Artwork']);
 await expect(panel.locator('[data-layer-type="raster"] .layer-dot')).toHaveCSS('background-color','rgb(0, 0, 0)');
 await expect(panel.locator('[data-layer-type="artwork"] [data-layer-action="select"]')).toHaveAttribute('aria-pressed','true');
});
test('Raster layer transfers filled artwork with undo and retains black through save and exports',async({page})=>{
 await page.goto(DEV);
 const state=await page.evaluate(async()=>{
  const e=(window as any).__vectora,p=(window as any).__paper,{encodeDocument,decodeDocument}=await import('/src/documentFormat.ts' as string),{exportSVG}=await import('/src/exportSVG.ts' as string),{exportDXF}=await import('/src/exportDXF.ts' as string);
  e.addShape(new p.Path.Rectangle({insert:false,rectangle:[10,20,40,30],fillColor:'red',data:{regionFill:true,regionFillColor:'#FF0000'}}),'Filled area');const before=e.snapshot();e.moveSelectionToLayer('raster');
  const moved={role:e.selected.data.role,fill:e.selected.fillColor.toCSS(true),stroke:e.selected.strokeColor,bounds:[e.selected.bounds.x,e.selected.bounds.y,e.selected.bounds.width,e.selected.bounds.height]},contents=encodeDocument(e),decoded=await decodeDocument(contents),svg=exportSVG(e.objects);
  let dxfEmpty=false;try{exportDXF(e.objects,true);}catch{dxfEmpty=true;}e.undo();const restored=e.snapshot();e.redo();return {before,restored,moved,contents,decodedLayer:JSON.parse(decoded.snapshot.layers).find((l:any)=>l.role==='raster'),svg,dxfEmpty};
 });
 expect(state.moved).toEqual({role:'raster',fill:'#000000',stroke:null,bounds:[10,20,40,30]});expect(state.restored).toEqual(state.before);expect(state.decodedLayer.name).toBe('Raster Engrave');expect(state.svg).toContain('fill="#000000"');expect(state.dxfEmpty).toBe(true);
 await page.locator('#open-document-file').setInputFiles({name:'Raster.vectora',mimeType:'application/json',buffer:Buffer.from(state.contents)});await expect(page.locator('[data-document-name]')).toHaveText('Raster.vectora');expect(await page.evaluate(()=>{const e=(window as any).__vectora;return e.documentLayer('raster').children[0].fillColor.toCSS(true);})).toBe('#000000');
 await page.getByRole('button',{name:'File',exact:true}).click();await page.getByRole('menuitem',{name:'Export…',exact:true}).click();const dialog=page.locator('#export-dialog');await dialog.locator('summary').click();await expect(dialog.getByLabel('Raster Engrave',{exact:true})).toBeVisible();await dialog.getByRole('tab',{name:'DXF',exact:true}).click();await expect(dialog.getByLabel('Raster Engrave',{exact:true})).toHaveCount(0);
});
test('Older documents gain an empty Raster Engrave layer without losing artwork or colliding with IDs',async({page})=>{
 await page.goto(DEV);
 const state=await page.evaluate(async()=>{
  const e=(window as any).__vectora,p=(window as any).__paper,{encodeDocument,decodeDocument}=await import('/src/documentFormat.ts' as string);e.addShape(new p.Path.Rectangle({insert:false,rectangle:[20,30,40,50],strokeColor:'white'}),'Keep me');const old=JSON.parse(encodeDocument(e));delete old.rasterLayerInitialized;old.layers=old.layers.filter((l:any)=>l.role!=='raster');const original=old.layers.find((l:any)=>l.id==='artwork').objects;const migrated=await decodeDocument(JSON.stringify(old));e.loadDocument(migrated.snapshot,migrated.view);const layer=e.documentLayers.find((l:any)=>l.data.objectRole==='raster'),saved=JSON.parse(encodeDocument(e));const collision=structuredClone(old);collision.layers.push({id:'raster',name:'Existing layer',role:'artwork',visible:true,locked:false,objects:[]});const recovered=await decodeDocument(JSON.stringify(collision));return {contents:JSON.stringify(old),order:e.documentLayers.map((l:any)=>l.name),count:layer.children.length,original,preserved:saved.layers.find((l:any)=>l.id==='artwork').objects,ids:JSON.parse(recovered.snapshot.layers).map((l:any)=>l.id)};
 });
 expect(state.order).toEqual(['Cut Path','Engrave Path','Construction Path','Raster Engrave','Artwork']);expect(state.count).toBe(0);expect(state.preserved).toEqual(state.original);expect(new Set(state.ids).size).toBe(state.ids.length);expect(state.ids).toContain('raster-2');
 await page.locator('#open-document-file').setInputFiles({name:'Legacy.vectora',mimeType:'application/json',buffer:Buffer.from(state.contents)});await expect(page.locator('[data-document-name]')).toHaveText('Legacy.vectora');page.once('dialog',d=>d.accept());await page.reload();await expect(page.locator('#workspace')).not.toHaveAttribute('inert','');await page.getByRole('button',{name:'Layers',exact:true}).click();await expect(page.locator('#primary-layers-panel .layer-name')).toHaveText(state.order);
});
test('Removing Raster Engrave survives document save and reload',async({page})=>{
 await page.goto(DEV);
 const state=await page.evaluate(async()=>{
  const e=(window as any).__vectora,p=(window as any).__paper,{encodeDocument,decodeDocument}=await import('/src/documentFormat.ts' as string);
  e.addShape(new p.Path.Rectangle({insert:false,rectangle:[10,20,30,40]}),'Keep artwork');e.deleteDocumentLayer('raster');
  const contents=encodeDocument(e),decoded=await decodeDocument(contents);e.loadDocument(decoded.snapshot,decoded.view);
  return {raster:e.documentLayers.some((l:any)=>l.data.objectRole==='raster'),objects:e.objects.length};
 });
 expect(state).toEqual({raster:false,objects:1});
});
