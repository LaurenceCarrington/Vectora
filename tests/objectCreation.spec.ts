import {test,expect,type Page} from './fixtures';
const DEV='http://127.0.0.1:5174';
const panel=(page:Page)=>page.locator('#properties-panel');
const form=(page:Page)=>panel(page).locator('.object-creation');
async function ready(page:Page){await page.goto(DEV);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');}
async function tool(page:Page,name:string){await page.evaluate(name=>(window as any).__vectora.setTool(name),name);await expect(form(page)).toBeVisible();}
async function field(page:Page,name:string,value:string){await form(page).getByRole('spinbutton',{name,exact:true}).fill(value);}
async function add(page:Page){await form(page).getByRole('button',{name:'Add to canvas',exact:true}).click();}
const snapshot=(page:Page)=>page.evaluate(()=>JSON.stringify((window as any).__vectora.snapshot()));

test('Toolbar selection opens creation Properties; exact insertion preserves existing objects and is one undo step',async({page})=>{
 await ready(page);await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({rectangle:[-40,-30,10,10],insert:false}),'Existing');e.setActiveLayer('cutline');});const before=await snapshot(page);
 await page.getByRole('button',{name:'Shapes',exact:true}).click();await page.getByRole('menuitemradio',{name:'Rectangle',exact:true}).click();await expect(panel(page)).toBeVisible();await expect(form(page)).toBeVisible();
 await field(page,'X position (millimetres)','10.125');await field(page,'Y position (millimetres)','-5.25');await field(page,'Width (millimetres)','23.45');await field(page,'Height (millimetres)','17.25');await field(page,'Line weight (millimetres)','0.35');await form(page).getByRole('combobox',{name:'Line style',exact:true}).selectOption('dashed');expect(await snapshot(page)).toBe(before);
 await add(page);await expect(form(page)).toBeHidden();await expect(panel(page)).toBeVisible();const shape=await page.evaluate(()=>{const s=(window as any).__vectora.selected;return {bounds:[s.bounds.x,s.bounds.y,s.bounds.width,s.bounds.height],role:s.data.role,colour:s.strokeColor.toCSS(true),fill:s.fillColor,weight:s.strokeWidth,dash:s.dashArray};});for(const [i,n]of [10.125,-5.25,23.45,17.25].entries())expect(shape.bounds[i]).toBeCloseTo(n,9);expect(shape).toMatchObject({role:'cutline',colour:'#ff0000',fill:null,weight:.35});expect(shape.dash).toEqual([1.4,.7]);await expect(page.locator('#selection-name')).toContainText('Rectangle');
 await page.locator('#cad-canvas').focus();await page.keyboard.press('Control+z');expect(await snapshot(page)).toBe(before);await page.keyboard.press('Control+Shift+z');expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(2);
 await page.evaluate(async()=>{const {encodeDocument,decodeDocument}=await import('/src/documentFormat.ts' as string);await decodeDocument(encodeDocument((window as any).__vectora));});
});

test('Circle measurement, shape dimensions and line length/angle create exact geometry',async({page})=>{
 await ready(page);await tool(page,'circle');await field(page,'X position (millimetres)','0');await field(page,'Y position (millimetres)','0');await field(page,'Radius (millimetres)','12.375');await form(page).getByRole('combobox',{name:'Circle measurement'}).selectOption('diameter');await expect(form(page).getByRole('spinbutton',{name:'Diameter (millimetres)'})).toHaveValue('24.75');await field(page,'Diameter (millimetres)','50.5');await add(page);expect(await page.evaluate(()=>(window as any).__vectora.selected.bounds.width)).toBeCloseTo(50.5,9);
 for(const [kind,w,h] of [['ellipse',40.125,20.75],['heart',30.25,40.5]] as const){await tool(page,kind);await field(page,'Width (millimetres)',String(w));await field(page,'Height (millimetres)',String(h));await add(page);const b=await page.evaluate(()=>{const s=(window as any).__vectora.selected;return [s.bounds.width,s.bounds.height,s.closed,s.fillColor];});expect(b[0]).toBeCloseTo(w,8);expect(b[1]).toBeCloseTo(h,8);expect(b.slice(2)).toEqual([true,null]);}
 await tool(page,'line');await field(page,'X position (millimetres)','10');await field(page,'Y position (millimetres)','20');await field(page,'Length (millimetres)','37.7');await field(page,'Angle (degrees)','30');await add(page);const line=await page.evaluate(()=>{const s=(window as any).__vectora.selected;return {start:[s.firstSegment.point.x,s.firstSegment.point.y],end:[s.lastSegment.point.x,s.lastSegment.point.y],length:s.length,closed:s.closed};});expect(line.start).toEqual([10,20]);expect(line.end[0]).toBeCloseTo(42.649157723,8);expect(line.end[1]).toBeCloseTo(38.85,9);expect(line.length).toBeCloseTo(37.7,8);expect(line.closed).toBe(false);
});

test('Polygon, Star and all circular arc tools retain their editable geometry metadata',async({page})=>{
 await ready(page);await tool(page,'polygon');await field(page,'X position (millimetres)','0');await field(page,'Y position (millimetres)','0');await field(page,'Radius (millimetres)','10');await field(page,'Sides','6');await field(page,'Angle (degrees)','0');await add(page);const polygon=await page.evaluate(()=>{const s=(window as any).__vectora.selected;return {sides:s.data.sides,count:s.segments.length,first:[s.firstSegment.point.x,s.firstSegment.point.y],closed:s.closed};});expect(polygon).toEqual({sides:6,count:6,first:[10,0],closed:true});
 await tool(page,'star');await field(page,'X position (millimetres)','0');await field(page,'Y position (millimetres)','0');await field(page,'Radius (millimetres)','20');await field(page,'Points','7');await add(page);const radii=await page.evaluate(()=>(window as any).__vectora.selected.segments.map((s:any)=>s.point.length));expect(radii).toHaveLength(14);for(let i=0;i<14;i++)expect(radii[i]).toBeCloseTo(i%2?8:20,9);
 for(const kind of ['arc','arc-three-point','arc-endpoints']){await tool(page,kind);await field(page,'X position (millimetres)','10.25');await field(page,'Y position (millimetres)','-4.5');await field(page,'Radius (millimetres)','12.375');await field(page,'Start angle (degrees)','25');await field(page,'Sweep (degrees)','-135');await add(page);const arc=await page.evaluate(()=>{const s=(window as any).__vectora.selected;return {arc:s.data.arc,closed:s.closed,fill:s.fillColor};});expect(arc).toEqual({arc:{cx:10.25,cy:-4.5,radius:12.375,start:25,sweep:-135},closed:false,fill:null});}
});

test('Creation blocks invalid or out-of-range geometry and hidden or locked destinations without document changes',async({page})=>{
 await ready(page);const before=await snapshot(page);await tool(page,'rectangle');await field(page,'Width (millimetres)','0');await add(page);await expect(form(page).getByRole('spinbutton',{name:'Width (millimetres)'})).toHaveAttribute('aria-invalid','true');expect(await snapshot(page)).toBe(before);await field(page,'Width (millimetres)','20');await field(page,'X position (millimetres)','999999');await add(page);await expect(form(page).getByRole('status')).toContainText('coordinate');expect(await snapshot(page)).toBe(before);
 await tool(page,'polygon');await field(page,'Sides','3.5');await add(page);await expect(form(page).getByRole('spinbutton',{name:'Sides',exact:true})).toHaveAttribute('aria-invalid','true');expect(await snapshot(page)).toBe(before);
 await tool(page,'arc');await field(page,'Sweep (degrees)','0');await add(page);await expect(form(page).getByRole('spinbutton',{name:'Sweep (degrees)'})).toHaveAttribute('aria-invalid','true');expect(await snapshot(page)).toBe(before);
 await page.evaluate(()=>{const e=(window as any).__vectora;e.setLayerState('artwork','locked',true);});await expect(form(page).getByRole('button',{name:'Add to canvas'})).toBeDisabled();await expect(form(page).getByRole('status')).toContainText('unlock');await page.evaluate(()=>{const e=(window as any).__vectora;e.setLayerState('artwork','locked',false);e.setLayerState('artwork','visible',false);});await expect(form(page).getByRole('button',{name:'Add to canvas'})).toBeDisabled();expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(0);
});

test('Normal drawing stays available and switches creation Properties to the completed object',async({page})=>{
 await ready(page);await page.locator('#cad-canvas').focus();await page.keyboard.press('r');await expect(form(page)).toBeVisible();await page.mouse.move(280,270);await page.mouse.down();await page.mouse.move(580,440,{steps:5});await page.mouse.up();await expect(form(page)).toBeHidden();await expect(panel(page)).toBeVisible();await expect(page.locator('#selection-name')).toContainText('Rectangle');expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(1);
 await tool(page,'rectangle');await field(page,'Width (millimetres)','123');await page.getByRole('button',{name:'Select',exact:true}).click();await expect(form(page)).toBeHidden();expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(1);await expect(page.locator('#selection-name')).toContainText('Rectangle');
 await tool(page,'circle');await page.locator('#close-properties').click();await expect(panel(page)).toBeHidden();expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(1);
});

test('Creation uses custom layer colour and exports only committed geometry',async({page})=>{
 await ready(page);await page.evaluate(()=>{const e=(window as any).__vectora;const layer=e.addDocumentLayer('engrave',true);e.setDocumentLayerColour(layer.data.documentId,'#129B7A');});await tool(page,'rectangle');await field(page,'X position (millimetres)','0');await field(page,'Y position (millimetres)','0');await field(page,'Width (millimetres)','10.125');await field(page,'Height (millimetres)','8.75');await add(page);const s=await page.evaluate(()=>{const e=(window as any).__vectora;return {role:e.selected.data.role,layer:e.selected.layer.name,colour:e.selected.strokeColor.toCSS(true),fill:e.selected.fillColor};});expect(s).toMatchObject({role:'engrave',colour:'#129b7a',fill:null});expect(s.layer).toContain('Engrave');
 await page.evaluate(async()=>{const e=(window as any).__vectora,{encodeDocument,decodeDocument}=await import('/src/documentFormat.ts' as string),{exportDXF}=await import('/src/exportDXF.ts' as string);await decodeDocument(encodeDocument(e));if(!exportDXF(e.objects).includes('10.125'))throw new Error('Exact geometry missing from export');});
});

test('Creation fields fit every theme and the shared reference offers the same creation controls',async({page})=>{
 await ready(page);await page.setViewportSize({width:390,height:650});for(const theme of ['dark','light','high-contrast']){await page.evaluate(t=>{document.documentElement.dataset.theme=t;(window as any).__vectora.refreshTheme();},theme);await tool(page,'star');await expect(page.locator('#selection-menu')).toBeHidden();await field(page,'Radius (millimetres)','17.25');await form(page).getByRole('button',{name:'Add to canvas'}).scrollIntoViewIfNeeded();const box=(await panel(page).boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);await page.screenshot({path:`test-results/create-properties-${theme}.png`});await add(page);await expect(form(page)).toBeHidden();}
 await page.goto(DEV+'/reference/design-system.html');const demo=page.locator('#object-creation-demo');await expect(demo.getByRole('spinbutton',{name:'Width (millimetres)',exact:true})).toBeVisible();await demo.getByRole('spinbutton',{name:'Width (millimetres)',exact:true}).fill('23.45');await demo.getByRole('button',{name:'Add to canvas'}).click();await expect(demo.locator('[data-creation-result]')).toContainText('23.45');
});

test('Escape on canvas and closing the dock discard creation drafts without document changes',async({page})=>{
 await ready(page);const before=await page.evaluate(()=>(window as any).__vectora.snapshot());
 await tool(page,'rectangle');await field(page,'Width (millimetres)','123');await page.locator('#cad-canvas').focus();await page.keyboard.press('Escape');await expect(form(page)).toBeHidden();
 for(const name of ['Properties','Layers','Fill & appearance']){
  await tool(page,'rectangle');await field(page,'Width (millimetres)','123');await page.getByRole('button',{name,exact:true}).click();await expect(form(page)).toBeHidden();
  await page.getByRole('button',{name:'Properties',exact:true}).click();await expect(page.locator('#properties-empty')).toBeVisible();
 }
 expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before);
 await tool(page,'line');await form(page).getByRole('spinbutton',{name:'Length (millimetres)',exact:true}).press('Escape');await expect(form(page)).toBeHidden();await expect(page.locator('#cad-canvas')).toBeFocused();
});

test('Numeric circular arcs accept small valid radii and sweeps',async({page})=>{
 await ready(page);for(const [radius,sweep] of [[20,1],[.001,-1],[.001,359]]){
  await tool(page,'arc');await field(page,'Radius (millimetres)',String(radius));await field(page,'Sweep (degrees)',String(sweep));await add(page);await expect(form(page)).toBeHidden();
  const arc=await page.evaluate(()=>{const e=(window as any).__vectora;return {arc:e.selectedArc,finite:e.selected.segments.every((s:any)=>[s.point.x,s.point.y,s.handleIn.x,s.handleIn.y,s.handleOut.x,s.handleOut.y].every(Number.isFinite))};});expect(arc.arc).toMatchObject({radius,sweep});expect(arc.finite).toBe(true);
 }
});


test('Escape restores the existing selection when cancelling a canvas draft',async({page})=>{
 await ready(page);await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({rectangle:[0,0,10,10],insert:false}),'Existing');});const before=await snapshot(page);
 await tool(page,'rectangle');await page.locator('#cad-canvas').focus();await page.mouse.move(250,500);await page.mouse.down();await page.mouse.move(400,600);await page.keyboard.press('Escape');await page.mouse.up();await expect(form(page)).toBeHidden();expect(await snapshot(page)).toBe(before);await expect(page.locator('#selection-name')).toContainText('Existing');await expect(page.locator('#selection-menu')).toBeVisible();
});

test('Saving discards creation drafts and restores the selected-object panel',async({page})=>{
 await ready(page);await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({rectangle:[0,0,10,10],insert:false}),'Existing');Object.defineProperty(window,'showSaveFilePicker',{configurable:true,value:undefined});});const before=await snapshot(page);
 await tool(page,'circle');await field(page,'Radius (millimetres)','123');await page.locator('#cad-canvas').focus();const download=page.waitForEvent('download');await page.keyboard.press('Control+s');await download;await expect(form(page)).toBeHidden();await expect(page.locator('#selection-properties')).toBeVisible();await expect(page.locator('#selection-menu')).toBeVisible();expect(await snapshot(page)).toBe(before);
});

test('Production toolbar supports exact creation and undo without replacing normal drawing',async({page})=>{
 await page.goto('http://127.0.0.1:4173');await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');await page.getByRole('button',{name:'Shapes',exact:true}).click();await page.getByRole('menuitemradio',{name:'Circle',exact:true}).click();await expect(form(page)).toBeVisible();await field(page,'Radius (millimetres)','15.125');await add(page);await expect(form(page)).toBeHidden();await expect(page.locator('#selection-name')).toContainText('Circle');await expect(page.locator('#field-width')).toHaveValue('30.25');await page.locator('#cad-canvas').focus();await page.keyboard.press('Control+z');await expect(page.locator('#properties-empty')).toBeVisible();await page.keyboard.press('Control+Shift+z');await expect(page.locator('#field-width')).toHaveValue('30.25');
});

test('Clicking off a completed shape restores creation Properties for the still-selected drawing tool',async({page})=>{
 await ready(page);for(const kind of ['rectangle','circle','ellipse','polygon','star','heart','line']){
  await tool(page,kind);await page.mouse.move(280,270);await page.mouse.down();await page.mouse.move(380,330,{steps:3});await page.mouse.up();await expect(form(page)).toBeHidden();await expect(page.locator('#selection-properties')).toBeVisible();expect(await page.evaluate(()=>(window as any).__vectora.tool)).toBe(kind);const before=await page.evaluate(()=>{const e=(window as any).__vectora;return {artwork:e.snapshot().artwork,layers:e.snapshot().layers,undo:e.undoStack.length};});
  await page.mouse.click(650,500);await expect(form(page)).toBeVisible();await expect(form(page)).toHaveAttribute('aria-label',`Create ${kind[0].toUpperCase()+kind.slice(1)}`);await expect(page.locator('#properties-empty')).toBeHidden();expect(await page.evaluate(()=>{const e=(window as any).__vectora;return {artwork:e.snapshot().artwork,layers:e.snapshot().layers,undo:e.undoStack.length};})).toEqual(before);
 }
 await field(page,'Length (millimetres)','25.125');await add(page);expect(await page.evaluate(()=>(window as any).__vectora.selected.length)).toBeCloseTo(25.125,8);
});


test('Production restores creation fields after clicking off a finished shape',async({page})=>{
 await page.goto('http://127.0.0.1:4173');await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');await page.locator('#cad-canvas').focus();await page.keyboard.press('r');await expect(form(page)).toBeVisible();await page.mouse.move(280,270);await page.mouse.down();await page.mouse.move(380,330,{steps:3});await page.mouse.up();await expect(form(page)).toBeHidden();await expect(page.locator('#selection-name')).toContainText('Rectangle');await expect(page.locator('#tool-status')).toContainText('Rectangle');await page.mouse.click(650,500);await expect(form(page)).toBeVisible();await expect(page.locator('#properties-empty')).toBeHidden();await field(page,'Width (millimetres)','20.125');await add(page);await expect(form(page)).toBeHidden();await expect(page.locator('#field-width')).toHaveValue('20.125');
});

test('Starting the next click-based arc restores creation fields without inserting its unfinished draft',async({page})=>{
 await ready(page);for(const kind of ['arc-three-point']){
  await tool(page,kind);for(const [x,y] of [[280,270],[330,240],[380,270]])await page.mouse.click(x,y);await expect(form(page)).toBeHidden();await expect(page.locator('#selection-properties')).toBeVisible();const before=await snapshot(page);await page.mouse.click(650,500);await expect(form(page)).toBeVisible();await expect(form(page).getByRole('button',{name:'Add to canvas'})).toBeDisabled();await page.keyboard.press('Escape');await expect(form(page)).toBeHidden();expect(await snapshot(page)).toBe(before);
 }
});
