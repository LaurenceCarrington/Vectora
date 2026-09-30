import {test,expect,Page} from './fixtures';
import {readFile} from 'node:fs/promises';
import {inflateSync} from 'node:zlib';
const DEV='http://127.0.0.1:5174';
async function fixture(page:Page){await page.evaluate(()=>{const p=(window as any).__paper,e=(window as any).__vectora;const ring=new p.CompoundPath({insert:false,children:[new p.Path.Rectangle({insert:false,rectangle:[-30,-20,50.8,25.4]}),new p.Path.Circle({insert:false,center:[-4.6,-7.3],radius:5})],fillColor:'#00ffff',fillRule:'evenodd',data:{regionFill:true,regionFillColor:'#00ffff'}});e.addShape(ring,'Ring');e.selected.fillColor=new p.Color('#00ffff');e.selected.strokeColor=null;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[1000,1000,10,10],strokeColor:'red'}),'Construction');e.moveSelectionToLayer('construction');e.setActiveLayer('artwork');e.addShape(new p.Path.Rectangle({insert:false,rectangle:[2000,2000,10,10],strokeColor:'red'}),'Hidden');e.selected.visible=false;});}
async function open(page:Page,format:string){await page.getByRole('button',{name:'File',exact:true}).click();await page.getByRole('menuitem',{name:'Export…',exact:true}).click();await page.getByRole('tab',{name:format,exact:true}).click();}
async function download(page:Page,format:string){await open(page,format);const pending=page.waitForEvent('download');await page.locator('#export-dialog [data-export-submit]').click();return await pending;}

test('PNG downloads at 300 DPI with transparent holes and physical dimensions',async({page})=>{
 await page.goto(DEV);await fixture(page);const file=await download(page,'PNG');expect(file.suggestedFilename()).toBe('Untitled.png');const data=await readFile((await file.path())!);expect(data.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));expect(data.readUInt32BE(16)).toBe(600);expect(data.readUInt32BE(20)).toBe(300);let density=0;for(let i=8;i<data.length;i+=12+data.readUInt32BE(i)){if(data.toString('ascii',i+4,i+8)==='pHYs'){density=data.readUInt32BE(i+8);expect(data.readUInt32BE(i+12)).toBe(density);expect(data[i+16]).toBe(1);}}expect(density).toBe(11811);
 const pixels=await page.evaluate(async b64=>{const img=new Image();img.src='data:image/png;base64,'+b64;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d')!;ctx.drawImage(img,0,0);return {solid:[...ctx.getImageData(30,30,1,1).data],hole:[...ctx.getImageData(300,150,1,1).data]};},data.toString('base64'));expect(pixels.solid).toEqual([0,255,255,255]);expect(pixels.hole[3]).toBe(0);
 await file.saveAs('test-results/export-fixture.png');
});

test('PDF keeps vector paths and a single page at actual millimetre size',async({page})=>{
 await page.goto(DEV);await fixture(page);const before=await page.evaluate(()=>JSON.stringify((window as any).__vectora.snapshot()));const file=await download(page,'PDF');expect(file.suggestedFilename()).toBe('Untitled.pdf');const data=await readFile((await file.path())!,'latin1');expect(data).toMatch(/^%PDF-/);const box=data.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);expect(box).not.toBeNull();expect(Number(box![1])).toBeCloseTo(144,3);expect(Number(box![2])).toBeCloseTo(72,3);expect(data).not.toContain('/Subtype /Image');expect((data.match(/\/Type \/Page\b/g)??[]).length).toBe(1);expect(await page.evaluate(()=>JSON.stringify((window as any).__vectora.snapshot()))).toBe(before);await file.saveAs('test-results/export-fixture.pdf');
});

test('Both exports report empty drawings; PNG rejects oversized output instead of freezing',async({page})=>{
 await page.goto(DEV);for(const format of ['PDF','PNG']){await open(page,format);await expect(page.locator('#export-dialog .export-error')).toContainText('No objects');await page.locator('#export-dialog [data-export-cancel]').click();}
 await page.evaluate(()=>{const p=(window as any).__paper,e=(window as any).__vectora;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[0,0,10000,10000],strokeColor:'black'}),'Huge');});await open(page,'PNG');await expect(page.locator('#export-dialog .export-error')).toContainText('exceeds');
});

test('PDF includes editable lettering and Unicode annotation labels without theme or view changes',async({page})=>{
 await page.goto(DEV);await page.evaluate(async()=>{const p=(window as any).__paper,e=(window as any).__vectora,{createDimension}=await import('/src/dimensions.ts'),{loadTextFont,createTextShape}=await import('/src/text.ts');await loadTextFont('lato');e.addShape(createTextShape({content:'Vectora O',fontId:'lato',sizeMM:8,transform:[1,0,0,1,-30,-10]}),'Text');e.addShape(createDimension({kind:'leader',points:[[-20,0],[-10,10],[0,10]],text:'Ø 12 ± 0.2 mm',transform:[1,0,0,1,0,0]}),'Label');e.addShape(new p.Path.Circle({insert:false,center:[40,0],radius:10,strokeColor:'white',strokeWidth:1.5,strokeScaling:false}),'Cut');e.moveSelectionToLayer('cutline');e.setActiveLayer('artwork');document.documentElement.dataset.theme='dark';e.refreshTheme();});
 const before=await page.evaluate(()=>JSON.stringify((window as any).__vectora.snapshot()));const file=await download(page,'PDF');await file.saveAs('test-results/export-labels.pdf');const state=await page.evaluate(()=>{const e=(window as any).__vectora;return {snapshot:JSON.stringify(e.snapshot()),text:e.objects.some((o:any)=>o.data.text),selected:e.selectedItems.length};});expect(state.snapshot).toBe(before);expect(state.text).toBe(true);expect(state.selected).toBe(1);
 const png=await download(page,'PNG');await png.saveAs('test-results/export-labels.png');await page.evaluate(()=>{const p=(window as any).__paper,e=(window as any).__vectora;p.view.zoom=20;p.view.center=[1500,600];e.select(null);document.documentElement.dataset.theme='light';e.refreshTheme();});const again=await download(page,'PNG');expect(await readFile((await again.path())!)).toEqual(await readFile((await png.path())!));
});

test('New exports are searchable and the File menu stays reachable on short screens',async({page})=>{
 await page.goto(DEV);await fixture(page);await page.locator('[data-tool-search]').click();await page.locator('#tool-search-dialog input').fill('Export PNG');await page.locator('.tool-search-result').first().click();await expect(page.getByRole('tab',{name:'PNG',exact:true})).toHaveAttribute('aria-selected','true');const pending=page.waitForEvent('download');await page.locator('#export-dialog [data-export-submit]').click();expect((await pending).suggestedFilename()).toBe('Untitled.png');
 await page.setViewportSize({width:390,height:550});await open(page,'PDF');await expect(page.locator('#export-dialog [data-export-submit]')).toBeInViewport();await page.screenshot({path:'test-results/export-menu-mobile.png',scale:'css'});
});

test('PDF rejects unsupported callout glyphs instead of silently truncating the label',async({page})=>{
 await page.goto(DEV);await page.evaluate(async()=>{const e=(window as any).__vectora,{createDimension}=await import('/src/dimensions.ts');e.addShape(createDimension({kind:'leader',points:[[0,0],[10,10],[20,10]],text:'Warning ⚠ drill here',transform:[1,0,0,1,0,0]}),'Label');});await open(page,'PDF');await page.locator('#export-dialog [data-export-submit]').click();await expect(page.locator('#export-dialog .export-error')).toContainText('unsupported');await expect(page.locator('#export-dialog [data-export-submit]')).toBeEnabled();
});

test('PDF exports long edge labels and centred dimension text',async({page})=>{
 await page.goto(DEV);await page.evaluate(async()=>{const e=(window as any).__vectora,{createDimension}=await import('/src/dimensions.ts');e.addShape(createDimension({kind:'leader',points:[[0,0],[10,10],[20,10]],text:'WWWWWWWWWWWWWWWWWWWW',transform:[1,0,0,1,0,0]}),'Wide label');e.addShape(createDimension({kind:'dimension-linear',axis:'x',points:[[0,20],[100,20],[50,30]],transform:[1,0,0,1,0,0]}),'Dimension');});const file=await download(page,'PDF');await file.saveAs('test-results/export-dimensions.pdf');const raw=await readFile((await file.path())!,'latin1');const stream=raw.match(/stream\r?\n([\s\S]*?)\r?\nendstream/)![1];const commands=inflateSync(Buffer.from(stream,'latin1')).toString();const firstFill=commands.split(/\nf\n/)[0];expect((firstFill.match(/ m\n/g)??[]).length).toBe(22); // Two leader runs + all twenty W contours.
});

test('Production downloads both formats without loading PDF conversion on startup',async({page})=>{
 const assets:string[]=[];page.on('request',r=>assets.push(r.url()));await page.goto('http://127.0.0.1:4173');expect(assets.some(s=>s.includes('/exportPDF-'))).toBe(false);await page.locator('#cad-canvas').focus();await page.keyboard.press('r');await page.mouse.move(250,230);await page.mouse.down();await page.mouse.move(450,360);await page.mouse.up();for(const format of ['PNG','PDF']){const file=await download(page,format);expect((await readFile((await file.path())!)).length).toBeGreaterThan(100);}expect(assets.some(s=>s.includes('/exportPDF-'))).toBe(true);
});
