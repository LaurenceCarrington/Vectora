import {test,expect,type Page} from './fixtures';
const DEV='http://127.0.0.1:5174';
const panel=(page:Page)=>page.locator('#primary-layers-panel');
async function ready(page:Page,url=DEV){await page.goto(url);await page.locator('[aria-label="Layers"][aria-controls="primary-layers-panel"]').click();}
async function add(page:Page,type='Artwork'){await panel(page).getByRole('button',{name:'Add layer',exact:true}).click();await panel(page).getByRole('menuitem',{name:type,exact:true}).click();}
async function rename(page:Page,name:string){await panel(page).locator('.layer-select[aria-pressed="true"] .layer-name').dblclick();const input=panel(page).getByRole('textbox',{name:'Layer name',exact:true});await input.fill(name);await input.press('Enter');}
async function colour(page:Page,name:string,value:string){await panel(page).getByRole('button',{name:`Change ${name} colour`,exact:true}).click();const picker=page.getByRole('dialog',{name:'Layer colour',exact:true});const hex=picker.getByRole('textbox',{name:'Hex colour',exact:true});await hex.fill(value);await hex.press('Enter');await picker.getByRole('button',{name:'Close colour picker',exact:true}).click();}
const snapshot=(page:Page)=>page.evaluate(()=>JSON.stringify((window as any).__vectora.snapshot()));

test('Double-clicking an inactive custom layer name edits it without a rename button',async({page})=>{
 for(const url of [DEV,DEV+'/reference/design-system.html']){
  await ready(page,url);await expect(panel(page).getByRole('button',{name:'Rename layer',exact:true})).toHaveCount(0);await add(page);await add(page,'Cut');
  await panel(page).getByText('Artwork 2',{exact:true}).dblclick();const input=panel(page).getByRole('textbox',{name:'Layer name',exact:true});await expect(input).toBeFocused();await input.fill('Renamed artwork');await input.press('Enter');await expect(panel(page).getByText('Renamed artwork',{exact:true})).toBeVisible();
  await panel(page).getByText('Cut Path 2',{exact:true}).dblclick();await expect(input).toBeFocused();await input.fill('Cancelled');await input.press('Escape');await expect(panel(page).getByText('Cut Path 2',{exact:true})).toBeVisible();
  await panel(page).locator('.layer-list').getByText('Artwork',{exact:true}).dblclick();await expect(input).toHaveCount(0);
  await panel(page).getByRole('button',{name:'Lock Renamed artwork',exact:true}).click();await panel(page).getByText('Renamed artwork',{exact:true}).dblclick();await expect(input).toHaveCount(0);
 }
});

test('Custom layer rows align with defaults and remain below them after history and reopening',async({page})=>{
 for(const url of [DEV,DEV+'/reference/design-system.html']){
  await ready(page,url);await add(page);await add(page,'Cut');
  const order=['Cut Path','Engrave Path','Construction Path','Raster Engrave','Artwork','Artwork 2','Cut Path 2'];
  await expect(panel(page).locator('.layer-name')).toHaveText(order);
  const geometry=await panel(page).evaluate(panel=>['Artwork','Artwork 2','Cut Path 2'].map(name=>{
   const row=[...panel.querySelectorAll('.layer-row')].find(row=>row.querySelector('.layer-name')!.textContent===name)!;
   const bounds=(selector:string)=>{const box=row.querySelector(selector)!.getBoundingClientRect();return selector==='.layer-name'||selector==='.layer-meta'?[box.x,box.height]:[box.x,box.width,box.height];};
   return {marker:bounds('.layer-dot'),name:bounds('.layer-name'),meta:bounds('.layer-meta'),visibility:bounds('[data-layer-action="visibility"]'),lock:bounds('[data-layer-action="lock"]')};
  }));
  expect(geometry[1]).toEqual(geometry[0]);expect(geometry[2]).toEqual(geometry[0]);
  await panel(page).getByRole('button',{name:'Change Artwork 2 colour',exact:true}).click();await expect(page.getByRole('dialog',{name:'Layer colour',exact:true})).toBeVisible();await page.getByRole('button',{name:'Close colour picker',exact:true}).click();
  if(url===DEV){
   await page.locator('#cad-canvas').focus();await page.keyboard.press('Control+z');await expect(panel(page).locator('.layer-name')).toHaveText(order.slice(0,-1));await page.keyboard.press('Control+Shift+z');
   await page.evaluate(async()=>{const e=(window as any).__vectora,{encodeDocument,decodeDocument}=await import('/src/documentFormat.ts' as string);const data=await decodeDocument(encodeDocument(e));e.loadDocument(data.snapshot,data.view);});await expect(panel(page).locator('.layer-name')).toHaveText(order);
  }
  await page.screenshot({path:`test-results/layer-row-alignment-${url===DEV?'app':'reference'}.png`});
 }
});

test('Custom layer types, inline names and safe cancellation preserve built-in layers',async({page})=>{
 await ready(page);await expect(panel(page).getByRole('button',{name:'Rename layer',exact:true})).toHaveCount(0);await expect(panel(page).getByRole('button',{name:'Delete layer',exact:true})).toBeDisabled();
 for(const [type,role] of [['Artwork','artwork'],['Cut','cutline'],['Engrave','engrave'],['Construction','construction']]){await add(page,type);expect(await page.evaluate(()=>{const e=(window as any).__vectora;return e.activeLayer.data.objectRole;})).toBe(role);}
 await rename(page,'Panel <one> & "two"');await expect(panel(page).getByText('Panel <one> & "two"',{exact:true})).toBeVisible();
 const before=await snapshot(page);await panel(page).locator('.layer-select[aria-pressed="true"] .layer-name').dblclick();const input=panel(page).getByRole('textbox',{name:'Layer name',exact:true});await input.fill(' ');await input.press('Enter');await expect(input).toHaveAttribute('aria-invalid','true');await input.fill('Cancelled');await input.press('Escape');expect(await snapshot(page)).toBe(before);
 const selected=panel(page).locator('.layer-select[aria-pressed="true"]');await selected.focus();await selected.press('F2');await panel(page).getByRole('textbox',{name:'Layer name',exact:true}).fill('Frame');await panel(page).getByRole('textbox',{name:'Layer name',exact:true}).press('Enter');await page.locator('#cad-canvas').focus();await page.keyboard.press('Control+z');expect(await snapshot(page)).toBe(before);await page.keyboard.press('Control+Shift+z');await expect(panel(page).getByText('Frame',{exact:true})).toBeVisible();
 await expect(panel(page).locator('[data-layer-count]')).toHaveText('9');
});

test('Layer colour changes existing and new geometry without disturbing weights, fills or processing roles',async({page})=>{
 await ready(page);await add(page);await rename(page,'Details');await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[20,20,30,25]}),'Panel');e.setLineWeight(.6);e.setLineDesign('dashed');});
 const before=await snapshot(page);await colour(page,'Details','#8235DC');
 expect(await page.evaluate(()=>{const e=(window as any).__vectora,s=e.selected;return {colour:s.strokeColor.toCSS(true),weight:s.strokeWidth,role:s.data.role,layer:s.layer.name,dash:s.dashArray.length,fill:s.fillColor};})).toMatchObject({colour:'#8235dc',weight:.6,role:'artwork',layer:'Details',dash:2,fill:null});
 await page.locator('#cad-canvas').focus();await page.keyboard.press('Control+z');expect(await snapshot(page)).toBe(before);await page.keyboard.press('Control+Shift+z');
 const result=await page.evaluate(async()=>{const e=(window as any).__vectora,p=(window as any).__paper,{encodeDocument,decodeDocument}=await import('/src/documentFormat.ts' as string);e.addShape(new p.Path.Circle({insert:false,center:[70,40],radius:10,strokeColor:e.drawingColor}),'New circle');const drawing=e.selected.strokeColor.toCSS(true);const data=await decodeDocument(encodeDocument(e));e.loadDocument(data.snapshot,data.view);document.documentElement.dataset.theme='light';e.refreshTheme();return {drawing,colours:e.objects.map((s:any)=>s.strokeColor.toCSS(true)),layer:e.documentLayers.find((l:any)=>l.name==='Details').data.colour};});
 expect(result).toEqual({drawing:'#8235dc',colours:['#8235dc','#8235dc'],layer:'#8235DC'});
 await page.evaluate(()=>{const e=(window as any).__vectora;e.setActiveLayer(e.documentLayers.find((l:any)=>l.name==='Details').data.documentId);});await colour(page,'Details','#FFFFFF');await page.evaluate(()=>{document.documentElement.dataset.theme='dark';(window as any).__vectora.refreshTheme();document.documentElement.dataset.theme='high-contrast';(window as any).__vectora.refreshTheme();});expect(await page.evaluate(()=>(window as any).__vectora.objects.every((s:any)=>s.strokeColor.toCSS(true)==='#ffffff'))).toBe(true);
 const malformed=await page.evaluate(async()=>{const e=(window as any).__vectora,{encodeDocument,decodeDocument}=await import('/src/documentFormat.ts' as string),file=JSON.parse(encodeDocument(e));file.layers.find((l:any)=>l.name==='Details').colour='url(https://example.com)';try{await decodeDocument(JSON.stringify(file));return false;}catch{return true;}});expect(malformed).toBe(true);
});

test('Custom deletion confirms contents, protects locked and built-in layers, and restores everything on undo',async({page})=>{
 await ready(page);await add(page,'Cut');await rename(page,'Outer cut');await colour(page,'Outer cut','#119988');await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[20,20,30,25]}),'Part');});const before=await snapshot(page);
 await panel(page).getByRole('button',{name:'Delete layer',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Delete layer?',exact:true});await expect(dialog).toContainText('Outer cut');await expect(dialog).toContainText('1 object');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect(await snapshot(page)).toBe(before);
 await panel(page).getByRole('button',{name:'Lock Outer cut',exact:true}).click();await expect(panel(page).getByRole('button',{name:'Delete layer',exact:true})).toBeDisabled();await panel(page).getByRole('button',{name:'Unlock Outer cut',exact:true}).click();const deletionBefore=await snapshot(page);
 await panel(page).getByRole('button',{name:'Delete layer',exact:true}).click();await dialog.getByRole('button',{name:'Delete layer',exact:true}).click();await expect(panel(page).getByText('Outer cut',{exact:true})).toHaveCount(0);expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(0);expect(await page.evaluate(()=>(window as any).__vectora.activeLayerId)).toBe('artwork');
 await page.locator('#cad-canvas').focus();await page.keyboard.press('Control+z');expect(await snapshot(page)).toBe(deletionBefore);await page.keyboard.press('Control+Shift+z');await expect(panel(page).locator('[data-layer-count]')).toHaveText('5');
});

test('Custom layer controls and picker fit the production app and design reference in every theme',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 for(const url of ['http://127.0.0.1:4173',DEV+'/reference/design-system.html']){
  await ready(page,url);for(const theme of ['dark','light','high-contrast']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.setViewportSize({width:420,height:700});await add(page);await rename(page,`Custom ${theme}`);await panel(page).getByRole('button',{name:`Change Custom ${theme} colour`,exact:true}).click();const picker=page.getByRole('dialog',{name:'Layer colour',exact:true});await expect(picker).toBeInViewport();await expect(picker.getByRole('spinbutton',{name:'Opacity (%)',exact:true})).toBeHidden();const box=(await picker.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(420);await picker.getByRole('button',{name:'Close colour picker',exact:true}).click();await expect(panel(page).getByRole('button',{name:'Add layer',exact:true})).toBeInViewport();await page.screenshot({path:`test-results/custom-layers-${url.includes('reference')?'reference':'app'}-${theme}.png`});}
 }
 expect(errors).toEqual([]);
});

test('Colour gestures commit once, cancel safely and preserve explicit Artwork paint',async({page})=>{
 await ready(page);await add(page);await rename(page,'Drawing');await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addGeneratedShapes([{shape:new p.Path.Rectangle({insert:false,rectangle:[20,20,30,20]}),name:'Inherited'}]);});
 const before=await snapshot(page);await panel(page).getByRole('button',{name:'Change Drawing colour',exact:true}).click();const picker=page.getByRole('dialog',{name:'Layer colour',exact:true}),plane=picker.locator('.colour-plane'),box=(await plane.boundingBox())!;
 await page.mouse.move(box.x+box.width*.2,box.y+box.height*.2);await page.mouse.down();await page.mouse.move(box.x+box.width*.7,box.y+box.height*.5,{steps:8});await page.mouse.up();await picker.getByRole('button',{name:'Close colour picker',exact:true}).click();const painted=await snapshot(page);expect(painted).not.toBe(before);
 await page.locator('#cad-canvas').focus();await page.keyboard.press('Control+z');expect(await snapshot(page)).toBe(before);await page.keyboard.press('Control+Shift+z');expect(await snapshot(page)).toBe(painted);
 await panel(page).getByRole('button',{name:'Change Drawing colour',exact:true}).click();const again=(await plane.boundingBox())!;await page.mouse.move(again.x+again.width*.3,again.y+again.height*.3);await page.mouse.down();await page.mouse.move(again.x+again.width*.9,again.y+again.height*.8,{steps:4});await page.keyboard.press('Escape');await page.mouse.up();await expect(picker).toBeHidden();expect(await snapshot(page)).toBe(painted);
 await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.setPaint('#FFCC00',.5,true);e.addGeneratedShapes([{shape:new p.Path.Rectangle({insert:false,rectangle:[60,20,30,20]}),name:'Another'}]);e.setFillPaint({kind:'gradient',type:'linear',angle:30,opacity:.4,stops:[{colour:'#FF0000',offset:0,opacity:1},{colour:'#0000FF',offset:1,opacity:1}]});e.fillAt(new p.Point(70,30));const filled=e.selected,custom=e.documentLayers.find((l:any)=>l.name==='Drawing');e.moveObjectsToLayer(custom.data.documentId,[filled]);});
 const paints=await page.evaluate(()=>{const e=(window as any).__vectora;return e.objects.filter((s:any)=>s.data.customColour||s.data.fillPaint).map((s:any)=>({uid:s.data.uid,colour:s.data.customColour,paint:s.data.fillPaint,opacity:s.opacity,json:s.exportJSON()}));});
 await colour(page,'Drawing','#009988');expect(await page.evaluate(()=>{const e=(window as any).__vectora;return e.objects.filter((s:any)=>s.data.customColour||s.data.fillPaint).map((s:any)=>({uid:s.data.uid,colour:s.data.customColour,paint:s.data.fillPaint,opacity:s.opacity,json:s.exportJSON()}));})).toEqual(paints);
});

test('Same-role clipboard pastes adopt destination layer colours and keep explicit artwork colours',async({page})=>{
 await ready(page);await add(page,'Cut');await colour(page,'Cut Path 2','#112233');await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addGeneratedShapes([{shape:new p.Path.Rectangle({insert:false,rectangle:[20,20,30,20]}),name:'Cut'}]);e.setLineWeight(.7);e.copySelection();});
 await add(page,'Cut');await colour(page,'Cut Path 3','#445566');await page.evaluate(()=>(window as any).__vectora.pasteSelection());expect(await page.evaluate(()=>{const s=(window as any).__vectora.selected;return {colour:s.strokeColor.toCSS(true),weight:s.strokeWidth,role:s.data.role};})).toEqual({colour:'#445566',weight:.7,role:'cutline'});
 await page.evaluate(()=>{const e=(window as any).__vectora;e.copySelection();e.setActiveLayer('cutline');e.pasteSelection();});expect(await page.evaluate(()=>(window as any).__vectora.selected.strokeColor.toCSS(true))).toBe('#ff0000');
 await add(page);await colour(page,'Artwork 2','#112233');await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addGeneratedShapes([{shape:new p.Path.Rectangle({insert:false,rectangle:[70,20,30,20]}),name:'Explicit'}]);e.setPaint('#FFDDEE',1,true);e.copySelection();});await add(page);await colour(page,'Artwork 3','#445566');await page.evaluate(()=>(window as any).__vectora.pasteSelection());expect(await page.evaluate(()=>(window as any).__vectora.selected.strokeColor.toCSS(true))).toBe('#ffddee');
});

test('Recolouring during an unfinished path cancels drawing and edits the live custom layer',async({page})=>{
 await ready(page);await add(page);await rename(page,'Drawing');
 const result=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addGeneratedShapes([{shape:new p.Path.Rectangle({insert:false,rectangle:[20,20,30,20]}),name:'Existing'}]);const id=e.activeLayerId;e.setTool('polyline');e.addPolylinePoint(new p.Point(60,40),false);e.setDocumentLayerColour(id,'#123456',true);return {colour:e.documentLayer(id).data.colour,ink:e.documentLayer(id).children[0].strokeColor.toCSS(true),pending:e.hasPendingGesture};});expect(result).toEqual({colour:'#123456',ink:'#123456',pending:false});
 await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.setTool('polyline');e.addPolylinePoint(new p.Point(60,40),false);});await colour(page,'Drawing','#998877');expect(await page.evaluate(()=>{const e=(window as any).__vectora;return {colour:e.activeLayer.data.colour,pending:e.hasPendingGesture};})).toEqual({colour:'#998877',pending:false});
});
