import {test,expect,type Page} from '@playwright/test';
const DEV='http://127.0.0.1:5174';
const setup=(page:Page)=>page.getByRole('dialog',{name:'New document',exact:true});
async function create(page:Page,preset='Infinite canvas') {const dialog=setup(page);await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:preset,exact:true}).click();await dialog.getByRole('button',{name:'Create document',exact:true}).click();await expect(dialog).toBeHidden();await expect(page.locator('#workspace')).not.toHaveAttribute('inert','');}
test('Startup offers finite and infinite canvases; New can be cancelled or sized independently',async({page})=>{
 await page.goto(DEV);await create(page,'A4');
 expect(await page.evaluate(()=>(window as any).__vectora.canvasSize)).toEqual({kind:'fixed',width:210,height:297,unit:'mm'});
 expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(0);
 await page.getByRole('button',{name:'New document tab',exact:true}).click();await setup(page).getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.locator('.document-tab')).toHaveCount(1);
 await page.getByRole('button',{name:'New document tab',exact:true}).click();await create(page);await expect(page.locator('.document-tab')).toHaveCount(2);
 expect(await page.evaluate(()=>(window as any).__vectora.canvasSize.kind)).toBe('infinite');
 await page.getByRole('tab',{name:'Untitled.vectora',exact:true}).click();expect(await page.evaluate(()=>(window as any).__vectora.canvasSize.width)).toBe(210);
 await page.screenshot({path:'test-results/canvas-a4-dark.png'});
});
test('Custom dimensions, units, orientation and later canvas changes validate and undo',async({page})=>{
 await page.goto(DEV);const dialog=setup(page);await dialog.getByRole('button',{name:'Custom size',exact:true}).click();await dialog.getByRole('combobox',{name:'Units',exact:true}).selectOption('in');await dialog.getByRole('spinbutton',{name:'Width',exact:true}).fill('12');await dialog.getByRole('spinbutton',{name:'Height',exact:true}).fill('8');await dialog.getByRole('button',{name:'Portrait',exact:true}).click();await dialog.getByRole('button',{name:'Create document',exact:true}).click();await expect(page.locator('#workspace')).not.toHaveAttribute('inert','');
 expect(await page.evaluate(()=>(window as any).__vectora.canvasSize)).toEqual({kind:'fixed',width:203.2,height:304.8,unit:'in'});
 await page.getByRole('button',{name:'File',exact:true}).click();await page.getByRole('menuitem',{name:'Canvas size',exact:true}).click();const edit=page.getByRole('dialog',{name:'Canvas size',exact:true});await edit.getByRole('spinbutton',{name:'Width',exact:true}).fill('0');await edit.getByRole('button',{name:'Apply',exact:true}).click();await expect(edit).toBeVisible();
 await edit.getByRole('button',{name:'Infinite canvas',exact:true}).click();await edit.getByRole('button',{name:'Apply',exact:true}).click();expect(await page.evaluate(()=>(window as any).__vectora.canvasSize.kind)).toBe('infinite');await page.getByRole('button',{name:'Undo',exact:true}).click();expect(await page.evaluate(()=>(window as any).__vectora.canvasSize.width)).toBe(203.2);
});
test('Canvas and view survive saving, opening, recovery and old files; exports ignore the guide',async({page})=>{
 await page.goto(DEV);await create(page,'600 × 400 mm');
 const result=await page.evaluate(async()=>{const e=(window as any).__vectora,p=(window as any).__paper,{encodeDocument,decodeDocument}=await import('/src/documentFormat.ts' as string),{exportSVG}=await import('/src/exportSVG.ts' as string);e.addShape(new p.Path.Rectangle({insert:false,rectangle:[-40,-20,700,450],strokeColor:'white'}),'Outside');const contents=encodeDocument(e),decoded=await decodeDocument(contents),svg=exportSVG(e.objects);const legacy=JSON.parse(contents);delete legacy.canvasSize;const old=await decodeDocument(JSON.stringify(legacy));let rejected=false;try{await decodeDocument(JSON.stringify({...legacy,canvasSize:{kind:'fixed',width:-1,height:50,unit:'mm'}}));}catch{rejected=true;}return {contents,canvas:decoded.snapshot.canvasSize,old:old.snapshot.canvasSize,rejected,svg};});
 expect(result.canvas).toEqual({kind:'fixed',width:600,height:400,unit:'mm'});expect(result.old).toEqual({kind:'infinite'});expect(result.rejected).toBe(true);expect(result.svg).toMatch(/width="70\d[^\"]*mm"/);
 await page.locator('#open-document-file').setInputFiles({name:'Sized.vectora',mimeType:'application/json',buffer:Buffer.from(result.contents)});await expect(page.locator('[data-document-name]')).toHaveText('Sized.vectora');expect(await page.evaluate(()=>(window as any).__vectora.canvasSize.width)).toBe(600);
 page.once('dialog',d=>d.accept());await page.reload();await expect(page.locator('#workspace')).not.toHaveAttribute('inert','');await expect(setup(page)).toBeHidden();expect(await page.evaluate(()=>(window as any).__vectora.canvasSize.width)).toBe(600);await expect(page.locator('.document-tab')).toHaveCount(2);
});
test('New-document setup fits both themes and narrow windows',async({page})=>{
 await page.goto(DEV);for(const width of [1280,375]){await page.setViewportSize({width,height:650});for(const theme of ['dark','light']){await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);const dialog=setup(page);await expect(dialog).toBeVisible();const box=(await dialog.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);expect(box.y+box.height).toBeLessThanOrEqual(650);await expect(dialog.getByRole('button',{name:'Create document',exact:true})).toBeInViewport();await page.screenshot({path:`test-results/canvas-setup-${theme}-${width}.png`});}}
});

test('A damaged recovered text draft preserves valid sized document tabs',async({page})=>{
 await page.goto(DEV);await create(page,'A4');
 const contents=await page.evaluate(async()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[10,20,40,30]}),'Keep me');return (await import('/src/documentFormat.ts' as string)).encodeDocument(e);});
 await page.addInitScript(contents=>localStorage.setItem('vectora.recovery.pending',JSON.stringify({version:1,time:Date.now()+100000,id:'draft-fixture',data:{contents,filename:'Keep me.vectora',dirty:true,draft:{content:'Lost draft',sourceId:'missing-object',point:null}}})),contents);
 page.once('dialog',d=>d.accept());await page.reload();await expect(page.locator('#workspace')).not.toHaveAttribute('inert','');await expect(setup(page)).toBeHidden();await expect(page.locator('[data-document-name]')).toHaveText('Keep me.vectora');expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(1);expect(await page.evaluate(()=>(window as any).__vectora.canvasSize.width)).toBe(210);await expect(page.locator('.toast-warning')).toContainText('recovered text object is missing');
});
