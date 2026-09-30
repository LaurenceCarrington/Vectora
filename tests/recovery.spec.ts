import {test,expect,type Page} from '@playwright/test';
const DEV='http://127.0.0.1:5174';
async function ready(page:Page){await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');await expect(page.locator('#workspace')).not.toHaveAttribute('inert','');}
async function count(page:Page){return page.evaluate(()=>(window as any).__vectora.objects.length);}
async function shape(page:Page){await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({rectangle:[30,30,25,20],insert:false,strokeColor:'white'}),'Rectangle');});}
async function reload(page:Page){page.once('dialog',dialog=>dialog.accept());await page.reload();await ready(page);}

test('Native refresh confirmation can cancel; accepting restores the complete working document and name',async({page})=>{
 await page.goto(DEV);await ready(page);await shape(page);
 const title=page.getByRole('textbox',{name:'Project name'});await title.click();await page.keyboard.type('Recovered design');await page.keyboard.press('Enter');
 await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.moveSelectionToLayer('engrave');e.setLayerState('cutline','visible',false);e.setActiveLayer('construction');p.view.zoom=5;p.view.center=new p.Point(60,80);});
 const expected=await page.evaluate(async()=>JSON.parse((await import('/src/documentFormat.ts' as string)).encodeDocument((window as any).__vectora)));
 page.once('dialog',async dialog=>{expect(dialog.type()).toBe('beforeunload');await dialog.dismiss();});
 await page.evaluate(()=>location.reload());await page.waitForTimeout(150);expect(await count(page)).toBe(1);await expect(title).toHaveText('Recovered design.vectora');
 await reload(page);await expect(title).toHaveText('Recovered design.vectora');
 const actual=await page.evaluate(async()=>JSON.parse((await import('/src/documentFormat.ts' as string)).encodeDocument((window as any).__vectora)));expect(actual).toEqual(expected);
 await expect(page.locator('.toast-copy')).toContainText('Restored your last document');
 // Recovery must not claim the file was saved: closing still protects the unsaved drawing.
 await page.getByRole('button',{name:'Close Recovered design.vectora',exact:true}).click();await expect(page.getByRole('dialog',{name:'Close document?',exact:true})).toBeVisible();
});

test('Text drafts recover as editable text and a cancelled drawing gesture never replaces the last committed state',async({page})=>{
 await page.goto(DEV);await ready(page);await page.getByRole('button',{name:'Text',exact:true}).click();await page.mouse.click(500,400);await page.keyboard.type('Hello');
 await reload(page);expect(await page.evaluate(()=>(window as any).__vectora.objects.map((s:any)=>s.data.text?.content))).toEqual(['Hello']);
 await page.evaluate(()=>{const e=(window as any).__vectora;e.select(e.objects[0]);e.onTextRequest(null,e.selected);});await page.locator('#inline-text').fill('Changed');await reload(page);
 expect(await page.evaluate(()=>{const s=(window as any).__vectora.objects[0];return [s.data.text.content,s.visible];})).toEqual(['Changed',true]);
 await page.evaluate(()=>{const e=(window as any).__vectora;e.select(null);e.setTool('rectangle');});await page.mouse.move(600,500);await page.mouse.down();await page.mouse.move(750,630,{steps:4});await reload(page);await page.mouse.up();expect(await count(page)).toBe(1);
});

test('New document and Open retain other recovery tabs; undo is cached and saved documents stay clean',async({page})=>{
 await page.addInitScript(()=>{(window as any).showSaveFilePicker=async()=>({name:'Saved.vectora',createWritable:async()=>({write:async()=>{},close:async()=>{},abort:async()=>{}})});});
 await page.goto(DEV);await ready(page);await shape(page);await page.locator('#cad-canvas').focus();await page.keyboard.press('Control+s');await expect(page.locator('[data-document-name]')).toHaveText('Saved.vectora');await expect(page).toHaveTitle('Vectora');await reload(page);expect(await count(page)).toBe(1);
 await page.getByRole('button',{name:'File',exact:true}).click();await page.getByRole('menuitem',{name:'New document',exact:true}).click();await expect(page.locator('#document-dialog')).toBeHidden();await expect.poll(()=>count(page)).toBe(0);await reload(page);expect(await count(page)).toBe(0);
 await shape(page);const contents=await page.evaluate(async()=>(await import('/src/documentFormat.ts' as string)).encodeDocument((window as any).__vectora));
 await page.locator('#open-document-file').setInputFiles({name:'Opened.vectora',mimeType:'application/json',buffer:Buffer.from(contents)});await expect(page.locator('[data-document-name]')).toHaveText('Opened.vectora');await expect(page).toHaveTitle('Vectora');await shape(page);await page.locator('#cad-canvas').focus();await page.keyboard.press('Control+z');await reload(page);expect(await count(page)).toBe(1);await expect(page.getByRole('textbox',{name:'Project name'})).toHaveText('Opened.vectora');
});

test('Recovery survives a new tab and clearing browser site storage removes it',async({page,context})=>{
 await page.goto(DEV);await ready(page);await shape(page);
 await expect.poll(()=>page.evaluate(async()=>new Promise(resolve=>{const r=indexedDB.open('vectora-recovery');r.onsuccess=()=>{const db=r.result,q=db.transaction('documents').objectStore('documents').get('current');q.onsuccess=()=>{resolve(!!q.result);db.close();};};}))).toBe(true);
 await page.close();const next=await context.newPage();await next.goto(DEV);await ready(next);expect(await count(next)).toBe(1);
 const session=await context.newCDPSession(next);await session.send('Storage.clearDataForOrigin',{origin:DEV,storageTypes:'indexeddb,local_storage'});await next.close();
 const fresh=await context.newPage();await fresh.goto(DEV);await ready(fresh);expect(await count(fresh)).toBe(0);
});

test('Storage failures keep the live drawing usable and explain how to retain it',async({page})=>{
 await page.addInitScript(()=>{Object.defineProperty(window,'indexedDB',{get:()=>{throw new Error('Storage disabled');}});Storage.prototype.setItem=function(){throw new DOMException('Quota exceeded','QuotaExceededError');};});
 await page.goto(DEV);await ready(page);await shape(page);await expect(page.locator('.toast-warning')).toContainText('Browser recovery could not be saved');expect(await count(page)).toBe(1);
});

test('Recovery retries an unchanged document after both storage writes fail',async({page})=>{
 await page.addInitScript(()=>{
  const setItem=Storage.prototype.setItem,put=IDBObjectStore.prototype.put;
  Storage.prototype.setItem=function(key,value){if(key==='vectora.recovery.pending')throw new DOMException('Quota exceeded','QuotaExceededError');return setItem.call(this,key,value);};
  (window as any).recoveryAttempts=0;
  IDBObjectStore.prototype.put=function(value,key){
   if(this.name==='documents'&&key==='current'&&++(window as any).recoveryAttempts===1)throw new DOMException('Temporary failure','UnknownError');
   return put.call(this,value,key!);
  };
 });
 await page.goto(DEV);await ready(page);await shape(page);
 await expect(page.locator('.toast-warning')).toContainText('Browser recovery could not be saved');
 expect(await page.evaluate(()=>(window as any).recoveryAttempts)).toBe(1);
 await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
 await expect.poll(()=>page.evaluate(()=>(window as any).recoveryAttempts)).toBe(2);
 await reload(page);expect(await count(page)).toBe(1);
});
