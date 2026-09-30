import {test,expect,type Page} from './fixtures';
const DEV='http://127.0.0.1:5174';
async function ready(page:Page){await expect(page.locator('#workspace')).not.toHaveAttribute('inert','');await expect(page.getByRole('tab',{name:/Untitled.vectora/})).toBeVisible();}
async function shape(page:Page,name='Rectangle'){await page.evaluate(name=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[10,20,30,40]}),name);},name);}
async function state(page:Page){return page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;return {snapshot:e.snapshot(),undo:e.canUndo,redo:e.canRedo,zoom:p.view.zoom,center:[p.view.center.x,p.view.center.y].map(n=>Number(n.toFixed(9)))};});}
async function rename(page:Page,name:string){const title=page.getByRole('textbox',{name:'Project name'});await title.fill(name);await title.press('Enter');}

test('New tabs preserve independent drawings, selection, view, active layer and undo/redo',async({page})=>{
 await page.goto(DEV);await ready(page);await shape(page,'First');await rename(page,'First');
 await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.setActiveLayer('engrave');e.moveSelectionToLayer('engrave');p.view.zoom=6;p.view.center=new p.Point(30,40);});const first=await state(page);
 await page.getByRole('button',{name:'New document tab',exact:true}).click();await expect(page.locator('#document-dialog')).toBeHidden();
 expect((await state(page)).undo).toBe(false);await shape(page,'Second');await rename(page,'Second');const second=await state(page);
 await page.getByRole('tab',{name:/First.vectora/}).click();expect(await state(page)).toEqual(first);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await page.evaluate(()=>(window as any).__vectora.selected.layer.name)).toBe('Artwork');
 await page.getByRole('tab',{name:/Second.vectora/}).click();expect(await state(page)).toEqual(second);
 await page.getByRole('tab',{name:/First.vectora/}).click();expect((await state(page)).redo).toBe(true);
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect(await state(page)).toEqual(first);
});

test('Save targets belong to their tabs and failed opens leave all documents intact',async({page})=>{
 await page.addInitScript(()=>{const w=window as any;w.writes=[];w.picks=0;w.showOpenFilePicker=undefined;w.showSaveFilePicker=async()=>{const name=`Saved ${++w.picks}.vectora`;return {name,createWritable:async()=>({write:async(text:string)=>w.writes.push({name,text}),close:async()=>{},abort:async()=>{}})};};});
 await page.goto(DEV);await ready(page);await shape(page,'First');await page.locator('#cad-canvas').focus();await page.keyboard.press('Control+s');await expect(page.getByRole('tab',{name:'Saved 1.vectora',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'New document tab',exact:true}).click();await shape(page,'Second');await page.locator('#cad-canvas').focus();await page.keyboard.press('Control+s');await expect(page.getByRole('tab',{name:'Saved 2.vectora',exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'Saved 1.vectora',exact:true}).click();await shape(page,'Third');await page.locator('#cad-canvas').focus();await page.keyboard.press('Control+s');
 await expect.poll(()=>page.evaluate(()=>(window as any).writes.map((w:any)=>w.name))).toEqual(['Saved 1.vectora','Saved 2.vectora','Saved 1.vectora']);expect(await page.evaluate(()=>(window as any).picks)).toBe(2);
 const before=await state(page);await page.locator('#open-document-file').setInputFiles({name:'Broken.vectora',mimeType:'application/json',buffer:Buffer.from('{broken')});await expect(page.locator('.toast-error')).toContainText('valid .vectora');expect(await state(page)).toEqual(before);await expect(page.locator('.document-tab')).toHaveCount(2);
 const contents=await page.evaluate(async()=>{const {encodeDocument}=await import('/src/documentFormat.ts' as string);return encodeDocument((window as any).__vectora);});
 await page.locator('#open-document-file').setInputFiles({name:'Opened.vectora',mimeType:'application/json',buffer:Buffer.from(contents)});await expect(page.getByRole('tab',{name:'Opened.vectora',exact:true})).toHaveAttribute('aria-selected','true');await expect(page.locator('.document-tab')).toHaveCount(3);expect((await state(page)).undo).toBe(false);
});

test('Closing unsaved tabs confirms, Cancel preserves them, and closing the last tab leaves a blank document',async({page})=>{
 await page.goto(DEV);await ready(page);await shape(page);await rename(page,'Keep me');const before=await state(page);
 await page.getByRole('button',{name:'Close Keep me.vectora',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Close document?',exact:true});await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect(await state(page)).toEqual(before);
 await page.getByRole('button',{name:'New document tab',exact:true}).click();await page.getByRole('button',{name:'Close Keep me.vectora',exact:true}).click();await dialog.getByRole('button',{name:'Close without saving',exact:true}).click();await expect(page.locator('.document-tab')).toHaveCount(1);
 await page.getByRole('button',{name:/^Close Untitled/}).click();await expect(page.locator('.document-tab')).toHaveCount(1);expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(0);
});

test('Browser recovery restores every document tab and the active document',async({page})=>{
 await page.goto(DEV);await ready(page);await shape(page,'First');await rename(page,'First');await page.getByRole('button',{name:'New document tab',exact:true}).click();await shape(page,'Second');await rename(page,'Second');
 page.once('dialog',dialog=>dialog.accept());await page.reload();await expect(page.locator('#workspace')).not.toHaveAttribute('inert','');await expect(page.locator('.document-tab')).toHaveCount(2);await expect(page.getByRole('tab',{name:/Second.vectora/})).toHaveAttribute('aria-selected','true');expect(await page.evaluate(()=>(window as any).__vectora.objects[0].data.name)).toBe('Second');
 await page.getByRole('tab',{name:/First.vectora/}).click();expect(await page.evaluate(()=>(window as any).__vectora.objects[0].data.name)).toBe('First');
});

test('Inline text commits to its tab and clipboard contents can be pasted into another document',async({page})=>{
 await page.goto(DEV);await ready(page);await page.getByRole('button',{name:'Text',exact:true}).click();await page.mouse.click(500,400);await page.keyboard.type('First document');
 await expect.poll(()=>page.evaluate(()=>(window as any).__vectora.textEditing)).toBe(true);
 await page.getByRole('button',{name:'New document tab',exact:true}).click();await expect(page.locator('.document-tab')).toHaveCount(2);
 await page.getByRole('tab',{name:'Untitled.vectora, unsaved changes',exact:true}).click();expect(await page.evaluate(()=>(window as any).__vectora.objects[0].data.text.content)).toBe('First document');
 await page.locator('#cad-canvas').focus();await page.keyboard.press('Control+c');await page.getByRole('tab',{name:'Untitled 2.vectora',exact:true}).click();await page.keyboard.press('Control+v');expect(await page.evaluate(()=>(window as any).__vectora.objects[0].data.text.content)).toBe('First document');
 await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(0);await page.getByRole('tab',{name:'Untitled.vectora, unsaved changes',exact:true}).click();expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(1);
});

test('A pending native save keeps its document active until the write completes',async({page})=>{
 await page.addInitScript(()=>{const w=window as any;w.showSaveFilePicker=async()=>({name:'Slow save.vectora',createWritable:async()=>({write:async()=>{},close:()=>new Promise<void>(resolve=>{w.finishSave=resolve;}),abort:async()=>{}})});});
 await page.goto(DEV);await ready(page);await shape(page);await page.getByRole('button',{name:'New document tab',exact:true}).click();await shape(page,'Second');await page.locator('#cad-canvas').focus();await page.keyboard.press('Control+s');
 await expect.poll(()=>page.evaluate(()=>typeof (window as any).finishSave)).toBe('function');await expect(page.getByRole('tab',{name:'Untitled.vectora, unsaved changes',exact:true})).toBeDisabled();await page.keyboard.press('Control+n');await expect(page.locator('.document-tab')).toHaveCount(2);
 await page.evaluate(()=>(window as any).finishSave());await expect(page.getByRole('tab',{name:'Slow save.vectora',exact:true})).toHaveAttribute('aria-selected','true');await expect(page.getByRole('tab',{name:'Untitled.vectora, unsaved changes',exact:true})).toBeEnabled();
});

test('Existing single-document recovery migrates to a tab without losing the drawing',async({page})=>{
 await page.goto(DEV);await ready(page);await shape(page,'Legacy');const data=await page.evaluate(async()=>{const {encodeDocument}=await import('/src/documentFormat.ts' as string);return {contents:encodeDocument((window as any).__vectora),filename:'Legacy.vectora',dirty:true};});
 await page.close();const next=await page.context().newPage();await next.addInitScript(data=>{localStorage.setItem('vectora.recovery.pending',JSON.stringify({version:1,time:Date.now()+10000,id:'legacy',data}));},data);await next.goto(DEV);await expect(next.locator('#workspace')).not.toHaveAttribute('inert','');await expect(next.getByRole('tab',{name:'Legacy.vectora, unsaved changes',exact:true})).toBeVisible();expect(await next.evaluate(()=>(window as any).__vectora.objects[0].data.name)).toBe('Legacy');
});

test('Production tabs and the reference use the same controls and styling',async({page,context})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:4173');await ready(page);await page.getByRole('button',{name:'New document tab',exact:true}).click();await rename(page,'Production');await page.getByRole('tab',{name:'Untitled.vectora',exact:true}).click();await expect(page.locator('[data-document-name]')).toHaveText('Untitled.vectora');
 const styles=(p:Page)=>p.locator('.document-tabs').evaluate(element=>{const css=getComputedStyle(element);return {height:css.height,background:css.backgroundColor,border:css.borderBottomColor,color:css.color};});const actual=await styles(page);
 await page.screenshot({path:'test-results/document-tabs-dark.png'});
 const reference=await context.newPage();reference.on('pageerror',error=>errors.push(error.message));await reference.goto(DEV+'/reference/design-system.html');await expect(reference.getByRole('tab',{name:'Laser sign.vectora, unsaved changes',exact:true})).toBeVisible();expect(await styles(reference)).toEqual(actual);await reference.getByRole('button',{name:'New document tab',exact:true}).click();await expect(reference.locator('.document-tab')).toHaveCount(3);expect(errors).toEqual([]);
});

test('Tabs align below the toolbar, adapt to docks and small screens, and support arrow keys',async({page})=>{
 await page.goto(DEV);await ready(page);for(let i=0;i<7;i++)await page.getByRole('button',{name:'New document tab',exact:true}).click();
 await page.getByRole('tab',{name:'Untitled 8.vectora',exact:true}).focus();await page.keyboard.press('ArrowLeft');await expect(page.getByRole('tab',{name:'Untitled 7.vectora',exact:true})).toBeFocused();await page.keyboard.press('Home');await expect(page.getByRole('tab',{name:'Untitled.vectora',exact:true})).toBeFocused();
 for(const width of [1280,600,375]){await page.setViewportSize({width,height:800});await page.getByRole('button',{name:'Properties',exact:true}).click();const bounds=await page.evaluate(()=>{const r=(s:string)=>{const b=document.querySelector(s)!.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom};};return {tabs:r('.document-tabs'),top:r('.top-toolbar'),left:r('.left-toolbar'),right:r('.right-toolbar'),panel:r('#properties-panel')};});expect(bounds.tabs.top).toBe(bounds.top.bottom);expect(bounds.tabs.left).toBe(bounds.left.right);expect(bounds.tabs.right).toBeLessThanOrEqual(bounds.right.left);if(width>700)expect(bounds.tabs.right).toBe(bounds.panel.left);else expect(bounds.panel.top).toBe(bounds.tabs.bottom);await expect(page.getByRole('button',{name:'New document tab',exact:true})).toBeVisible();await page.getByRole('button',{name:'Properties',exact:true}).click();}
 await page.evaluate(()=>{document.documentElement.dataset.theme='light';(window as any).__vectora.refreshTheme();});await page.screenshot({path:'test-results/document-tabs-light.png'});
});
