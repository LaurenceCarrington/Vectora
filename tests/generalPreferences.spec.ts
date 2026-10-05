import {test,expect,type Page} from '@playwright/test';
const DEV='http://127.0.0.1:5174';
async function start(page:Page){await page.goto(DEV);await page.locator('[data-setup-create]').click();await expect(page.locator('#workspace')).not.toHaveAttribute('inert');}
async function general(page:Page){await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('tab',{name:'General',exact:true}).click();}
async function reload(page:Page){page.once('dialog',(d)=>d.accept());await page.reload();}
test('General preferences persist and default canvas only preselects new documents',async({page})=>{
 await start(page);await general(page);
 await page.getByLabel('Default canvas').selectOption('sheet-small');await page.getByLabel('Measurement units').selectOption('cm');await page.getByLabel('Decimal places').selectOption('3');await page.getByLabel('Backup interval').selectOption('1000');
 await expect(page.locator('[data-recovery-usage]')).toContainText('KB');await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'File',exact:true}).click();await page.getByRole('menuitem',{name:'New document',exact:true}).click();
 await expect(page.locator('[data-canvas-preset="sheet-small"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('[name="width"]')).toHaveValue('600');
 await page.locator('[data-setup-create]').click();expect(await page.evaluate(()=>(window as any).__vectora.canvasSize)).toMatchObject({kind:'fixed',width:600,height:400});
 await reload(page);await expect(page.locator('#workspace')).not.toHaveAttribute('inert');await general(page);
 await expect(page.getByLabel('Default canvas')).toHaveValue('sheet-small');await expect(page.getByLabel('Measurement units')).toHaveValue('cm');await expect(page.getByLabel('Decimal places')).toHaveValue('3');await expect(page.getByLabel('Backup interval')).toHaveValue('1000');
});
test('Display units preserve exact geometry and support precise creation and editing',async({page})=>{
 await start(page);await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({rectangle:[10.1234567,20,25.1234567,30],insert:false}),'Rectangle');});
 const before=await page.evaluate(()=>JSON.stringify((window as any).__vectora.snapshot()));await general(page);await page.getByLabel('Measurement units').selectOption('cm');await page.getByLabel('Decimal places').selectOption('2');await page.keyboard.press('Escape');
 expect(await page.evaluate(()=>JSON.stringify((window as any).__vectora.snapshot()))).toBe(before);
 await page.getByRole('button',{name:'Properties',exact:true}).click();const width=page.locator('#field-width');await expect(width).toHaveValue('2.51');await width.focus();expect(Number(await width.inputValue())).toBeCloseTo(2.51234567,12);await width.press('Tab');
 expect(await page.evaluate(()=>(window as any).__vectora.selected.bounds.width)).toBeCloseTo(25.1234567,7);
 await width.fill('3.125');await width.press('Tab');expect(await page.evaluate(()=>(window as any).__vectora.selected.bounds.width)).toBeCloseTo(31.25,7);
 await page.evaluate(()=>{const e=(window as any).__vectora;e.select(null);e.setTool('circle');});
 const radius=page.locator('.object-creation').getByRole('spinbutton',{name:'Radius (centimetres)',exact:true});await radius.fill('1.23456789');await page.getByRole('button',{name:'Add to canvas',exact:true}).click();expect(await page.evaluate(()=>(window as any).__vectora.selected.bounds.width)).toBeCloseTo(24.6913578,7);
 await expect(page.locator('.ruler-unit')).toHaveText('cm');
});
test('Startup New document retains recovered tabs and delayed backups flush on refresh',async({page})=>{
 await start(page);await general(page);await page.getByLabel('On startup').selectOption('new');await page.getByLabel('Backup interval').selectOption('30000');await page.keyboard.press('Escape');
 await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Circle({center:[10,10],radius:7,insert:false}),'Circle');});await reload(page);
 await expect(page.locator('#new-document-dialog')).toBeVisible();await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.locator('#workspace')).not.toHaveAttribute('inert');expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(1);
 await general(page);await expect(page.getByLabel('On startup')).toHaveValue('new');await expect(page.getByLabel('Backup interval')).toHaveValue('30000');
});

test('Inches convert circles and line weights exactly, while changing units preserves creation drafts',async({page})=>{
 await start(page);await page.evaluate(()=>(window as any).__vectora.setTool('rectangle'));const draft=page.locator('.object-creation');await draft.getByRole('spinbutton',{name:'Width (millimetres)',exact:true}).fill('31.23456789');await general(page);await page.getByLabel('Measurement units').selectOption('in');await page.getByLabel('Decimal places').selectOption('0');await page.keyboard.press('Escape');await draft.getByRole('button',{name:'Add to canvas'}).click();expect(await page.evaluate(()=>(window as any).__vectora.selected.bounds.width)).toBeCloseTo(31.23456789,8);
 await page.evaluate(()=>{const e=(window as any).__vectora;e.select(null);e.setTool('circle');});await draft.getByRole('spinbutton',{name:'Radius (inches)',exact:true}).fill('0.5');await draft.getByRole('spinbutton',{name:'Line weight (inches)',exact:true}).fill('0.01');await draft.getByRole('button',{name:'Add to canvas'}).click();expect(await page.evaluate(()=>(window as any).__vectora.selected.bounds.width)).toBeCloseTo(25.4,8);expect(await page.evaluate(()=>(window as any).__vectora.selected.strokeWidth)).toBeCloseTo(.254,8);await page.locator('#shape-radius').fill('1');await page.locator('#shape-radius').press('Tab');expect(await page.evaluate(()=>(window as any).__vectora.selected.bounds.width)).toBeCloseTo(50.8,8);
 await page.evaluate(async()=>{const {dimensionLayout}=await import('/src/dimensions.ts' as string);const layout=dimensionLayout({kind:'dimension-linear',points:[[0,0],[25.4,0],[0,10]],axis:'x',transform:[1,0,0,1,0,0]});if(layout.label!=='1 in')throw new Error('Dimension label did not use inches.');});
});
test('Longer backup interval delays database writes and still marks the tab dirty immediately',async({page})=>{
 await start(page);await general(page);await page.getByLabel('Backup interval').selectOption('5000');await page.keyboard.press('Escape');
 const stored=()=>page.evaluate(async()=>new Promise<number>(resolve=>{const r=indexedDB.open('vectora-recovery');r.onsuccess=()=>{const db=r.result,q=db.transaction('documents').objectStore('documents').get('current');q.onsuccess=()=>{resolve(q.result?.time??0);db.close();};};}));await expect.poll(stored).toBeGreaterThan(0);const before=await stored();await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Circle({center:[0,0],radius:5,insert:false}),'Circle');});await expect(page.locator('[data-document-id][aria-selected="true"]')).toHaveAttribute('aria-label',/unsaved/i);expect(await stored()).toBe(before);await expect.poll(stored,{timeout:8000}).toBeGreaterThan(before);
});
test('Invalid stored settings fall back safely and blocked persistence still applies session choices',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('vectora.general',JSON.stringify({canvasPreset:'<img src=x>',units:'bad',decimals:-100,startup:'bad',backupInterval:0}));});await start(page);await general(page);await expect(page.getByLabel('Measurement units')).toHaveValue('mm');await expect(page.getByLabel('Default canvas')).toHaveValue('infinite');await expect(page.getByLabel('Backup interval')).toHaveValue('250');
 await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new DOMException('Unavailable','QuotaExceededError');};});await page.getByLabel('Measurement units').selectOption('cm');await expect(page.locator('#preferences-status')).toContainText('Applied for this session');await page.keyboard.press('Escape');await expect(page.locator('.ruler-unit')).toHaveText('cm');
});
test('General uses the shared reference and fits on a narrow screen',async({page})=>{
 await start(page);await general(page);await page.setViewportSize({width:390,height:700});const panel=page.locator('#pref-page-general');expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await page.getByLabel('Backup interval').scrollIntoViewIfNeeded();await page.screenshot({path:'test-results/general-preferences-narrow.png'});await page.keyboard.press('Escape');await page.setViewportSize({width:1280,height:900});await general(page);await page.screenshot({path:'test-results/general-preferences-desktop.png'});await page.goto(DEV+'/reference/design-system.html');await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('tab',{name:'General',exact:true}).click();await expect(page.getByLabel('Default canvas')).toHaveValue('infinite');await expect(page.locator('#pref-page-general [data-general]')).toHaveCount(5);
});
test('Radius and diameter switches preserve untouched rounded creation dimensions',async({page})=>{
 await start(page);await general(page);await page.getByLabel('Measurement units').selectOption('in');await page.getByLabel('Decimal places').selectOption('0');await page.keyboard.press('Escape');await page.evaluate(()=>(window as any).__vectora.setTool('circle'));
 const form=page.locator('.object-creation');await expect(form.getByRole('spinbutton',{name:'Radius (inches)',exact:true})).toHaveValue('1');await form.getByLabel('Circle measurement').selectOption('diameter');await form.getByRole('button',{name:'Add to canvas'}).click();expect(await page.evaluate(()=>(window as any).__vectora.selected.bounds.width)).toBeCloseTo(30,8);
});
test('Completed edits recover even when an unfinished gesture is active at refresh',async({page})=>{
 await start(page);await general(page);await page.getByLabel('Backup interval').selectOption('30000');await page.keyboard.press('Escape');await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Circle({center:[10,10],radius:7,insert:false}),'Circle');e.setTool('polyline');});await page.mouse.click(600,350);await page.mouse.move(680,390);expect(await page.evaluate(()=>(window as any).__vectora.hasPendingGesture)).toBe(true);await reload(page);await expect(page.locator('#workspace')).not.toHaveAttribute('inert');expect(await page.evaluate(()=>(window as any).__vectora.objects.map((s:any)=>s.data.name))).toEqual(['Circle']);
});

test('Timed backup uses committed geometry while a move remains unfinished',async({page})=>{
 await start(page);await general(page);await page.getByLabel('Backup interval').selectOption('1000');await page.keyboard.press('Escape');await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({rectangle:[150,80,30,20],insert:false}),'Rectangle');e.setTool('select');});
 const coords=await page.evaluate(()=>{const p=(window as any).__paper,r=document.querySelector('#cad-canvas')!.getBoundingClientRect();return [[160,90],[180,110]].map(pt=>{const q=p.view.projectToView(new p.Point(pt));return {x:q.x+r.x,y:q.y+r.y};});});await page.mouse.move(coords[0].x,coords[0].y);await page.mouse.down();await page.mouse.move(coords[1].x,coords[1].y);expect(await page.evaluate(()=>(window as any).__vectora.hasPendingGesture)).toBe(true);
 await expect.poll(()=>page.evaluate(async()=>{const r=new Promise<any>(resolve=>{const request=indexedDB.open('vectora-recovery');request.onsuccess=()=>{const db=request.result,q=db.transaction('documents').objectStore('documents').get('current');q.onsuccess=()=>{resolve(q.result?.data);db.close();};};});const data=await r;if(!data)return 0;const tab=data.tabs?.find((t:any)=>t.id===data.activeTabId);const document=JSON.parse(tab?.contents??data.contents);return document.layers.flatMap((l:any)=>l.objects).length;}),{timeout:5000}).toBe(1);
 await reload(page);await page.mouse.up();await expect(page.locator('#workspace')).not.toHaveAttribute('inert');expect(await page.evaluate(()=>{const b=(window as any).__vectora.objects[0].bounds;return [b.x,b.y,b.width,b.height];})).toEqual([150,80,30,20]);
});

test('Recovered inline text remains in committed recovery during the next unfinished gesture',async({page})=>{
 await start(page);await general(page);await page.getByLabel('Backup interval').selectOption('30000');await page.keyboard.press('Escape');await page.getByRole('button',{name:'Text',exact:true}).click();await page.mouse.click(500,400);await page.keyboard.type('Retained draft');await reload(page);await expect(page.locator('#workspace')).not.toHaveAttribute('inert');expect(await page.evaluate(()=>(window as any).__vectora.objects.map((s:any)=>s.data.text?.content))).toEqual(['Retained draft']);
 await page.evaluate(()=>(window as any).__vectora.setTool('polyline'));await page.mouse.click(650,350);await page.mouse.move(680,390);expect(await page.evaluate(()=>(window as any).__vectora.hasPendingGesture)).toBe(true);await reload(page);await expect(page.locator('#workspace')).not.toHaveAttribute('inert');expect(await page.evaluate(()=>(window as any).__vectora.objects.map((s:any)=>s.data.text?.content))).toEqual(['Retained draft']);
});
