import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const DEV='http://127.0.0.1:5174';
async function open(page:Page){
 await page.goto(DEV);await expect(page.locator('#wasm-status')).toHaveText('Outline engine ready');
 await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.addShape(new p.Path.Rectangle({insert:false,rectangle:[0,0,100,60]}),'Panel');e.moveSelectionToLayer('cutline');e.addShape(new p.Path.Circle({insert:false,center:[30,30],radius:10}),'Hole');e.moveSelectionToLayer('cutline');e.setActiveLayer('artwork');e.addShape(new p.Path.Circle({insert:false,center:[75,30],radius:10,fillColor:'#ff0000'}),'Printed circle');});
 const before=await page.evaluate(()=>(window as any).__vectora.snapshot());
 await page.getByRole('button',{name:'Preview',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Preview',exact:true});await expect(dialog.locator('canvas')).toBeVisible();return {dialog,before};
}
async function section(page:Page,name:string){const summary=page.locator('.preview-section > summary').filter({hasText:name});const open=await summary.evaluate(el=>(el.parentElement as HTMLDetailsElement).open);if(!open)await summary.click();}
async function range(page:Page,id:string,value:string){await page.locator('#preview-'+id).fill(value);await page.locator('#preview-'+id).dispatchEvent('input');}

test('Material-specific controls and cheap thickness/explode transforms keep the document intact',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const {dialog,before}=await open(page);
 await expect(page.getByLabel('Burnt edges')).toBeVisible();await expect(page.getByLabel('Transparency',{exact:true})).toBeHidden();
 const initial=await page.evaluate(()=>(window as any).__preview3D.rebuildCount);
 await range(page,'depth','18');await expect(dialog.locator('[data-preview-summary]')).toContainText('× 18 mm');
 expect(await page.evaluate(()=>(window as any).__preview3D.rebuildCount)).toBe(initial);
 for(const material of ['acrylic','glass','steel','aluminium','sticker','mdf','leather','plywood']){
  await page.getByLabel('Material',{exact:true}).selectOption(material);await page.waitForTimeout(150);
  await expect(page.getByLabel('Transparency',{exact:true}))[['acrylic','glass'].includes(material)?'toBeVisible':'toBeHidden']();
 }
 await page.getByLabel('Material',{exact:true}).selectOption('sticker');await page.getByLabel('Sticker finish').selectOption('holographic');await page.getByLabel('Die-cut border').selectOption('white');await page.waitForTimeout(200);
 expect(await page.evaluate(()=>{const p=(window as any).__preview3D;return p.parts[0].face.material.iridescence;})).toBe(1);
 await section(page,'Assembly');const rebuilt=await page.evaluate(()=>(window as any).__preview3D.rebuildCount);await range(page,'explode','60');expect(await page.evaluate(()=>(window as any).__preview3D.rebuildCount)).toBe(rebuilt);
 await dialog.getByRole('button',{name:'Back view',exact:true}).click();expect(await page.evaluate(()=>(window as any).__preview3D.camera.position.y)).toBeLessThan(0);
 await dialog.getByRole('button',{name:'Isometric',exact:true}).click();await dialog.screenshot({path:'test-results/preview-workbench-sticker.png'});
 await dialog.getByRole('button',{name:'Close preview',exact:true}).click();expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before);expect(errors).toEqual([]);
});

test('Preview-only sheets preserve exact shapes and support Z offsets, removal and machining guides',async({page})=>{
 const {dialog,before}=await open(page);await section(page,'Assembly');await page.getByText('Build a sheet from shapes',{exact:true}).click();
 await expect(page.locator('[data-preview-shapes] input:checked')).toHaveCount(1);
 await page.getByLabel('Sheet name',{exact:true}).fill('Face');await page.getByRole('button',{name:'Add sheet',exact:true}).click();await expect(page.getByLabel('Face Z offset in mm')).toBeVisible();
 await page.getByLabel('Face Z offset in mm').fill('12');await expect(dialog.locator('[data-preview-summary]')).toContainText('20 × 20 × 3 mm');
 await page.getByLabel('Sheet name',{exact:true}).fill('Backing');await page.getByRole('button',{name:'Add sheet',exact:true}).click();await expect(page.getByLabel('Backing Z offset in mm')).toBeVisible();
 await page.getByLabel('Backing Z offset in mm').fill('0');
 expect(await page.evaluate(()=>(window as any).__preview3D.parts.map((p:any)=>p.group.position.z))).toEqual([12,0]);
 await section(page,'Manufacturing checks');await page.getByLabel('Show kerf band').check();await page.getByLabel('Show machine bed').check();await page.getByLabel('Show dimensions').check();
 await page.getByLabel('Bed width',{exact:true}).fill('10');await expect(page.locator('[data-preview-checks]')).toContainText('Exceeds');await page.getByLabel('Bed width',{exact:true}).fill('600');await expect(page.locator('[data-preview-checks]')).toContainText('Fits');
 await section(page,'Scene & performance');await page.getByLabel('Display units').selectOption('in');await expect(page.locator('[data-preview-dimensions]')).toContainText(' in');await page.getByLabel('Curve detail').selectOption('high');await page.waitForTimeout(200);
 await page.getByLabel('Environment',{exact:true}).selectOption('desktop');await page.getByLabel('Shadows',{exact:true}).selectOption('soft');await page.getByRole('button',{name:'Isometric',exact:true}).click();
 await dialog.screenshot({path:'test-results/preview-workbench-assembly.png'});
 await page.getByRole('button',{name:'Remove Face',exact:true}).click();await expect(page.getByLabel('Face Z offset in mm')).toHaveCount(0);
 await dialog.getByRole('button',{name:'Close preview',exact:true}).click();expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before);
});

test('PNG and GIF exports are valid, bounded and restore the view; closing cancels export',async({page})=>{
 test.setTimeout(60000);const {dialog,before}=await open(page);await section(page,'Export image');await page.getByLabel('Transparent PNG').check();await page.getByLabel('PNG resolution').selectOption('2');
 const view=await page.evaluate(()=>{const p=(window as any).__preview3D;return {camera:p.camera.position.toArray(),ratio:p.renderer.getPixelRatio(),size:p.renderer.getSize(p.controls.target.clone()).toArray()};});
 const pngEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Save PNG',exact:true}).click();const png=await pngEvent;await png.saveAs('test-results/preview-export.png');const bytes=await readFile((await png.path())!);expect(bytes.subarray(1,4).toString()).toBe('PNG');expect(bytes.readUInt32BE(16)).toBeLessThanOrEqual(4096);
 const alpha=await page.evaluate(async(base64)=>{const img=new Image();img.src='data:image/png;base64,'+base64;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d')!;ctx.drawImage(img,0,0);const pixels=ctx.getImageData(0,0,c.width,c.height).data;let opaque=false;for(let i=3;i<pixels.length;i+=4)if(pixels[i]===255){opaque=true;break;}return {corner:pixels[3],opaque};},bytes.toString('base64'));expect(alpha).toEqual({corner:0,opaque:true});
 await expect(page.locator('[data-preview-export-status]')).toContainText('PNG ready');
 const gifEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Turntable GIF',exact:true}).click();const gif=await gifEvent;await gif.saveAs('test-results/preview-export.gif');const gifBytes=await readFile((await gif.path())!);expect(gifBytes.subarray(0,6).toString()).toBe('GIF89a');expect(gifBytes.readUInt16LE(6)).toBeLessThanOrEqual(480);
 const animation=await page.evaluate(async(base64)=>{const data=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),Decoder=(window as any).ImageDecoder,decoder=new Decoder({data,type:'image/gif'});await decoder.tracks.ready;const hashes=[];for(const frameIndex of [0,9,18]){const frame=await decoder.decode({frameIndex}),c=document.createElement('canvas');c.width=frame.image.displayWidth;c.height=frame.image.displayHeight;const ctx=c.getContext('2d')!;ctx.drawImage(frame.image,0,0);const bytes=ctx.getImageData(0,0,c.width,c.height).data;let hash=0;for(let i=0;i<bytes.length;i++)hash=(Math.imul(hash,31)+bytes[i])|0;hashes.push(hash);frame.image.close();}const frames=decoder.tracks.selectedTrack.frameCount;decoder.close();return {frames,distinct:new Set(hashes).size};},gifBytes.toString('base64'));expect(animation.frames).toBe(36);expect(animation.distinct).toBeGreaterThan(1);
 await expect(page.locator('[data-preview-export-status]')).toContainText('GIF ready');
 const after=await page.evaluate(()=>{const p=(window as any).__preview3D;return {camera:p.camera.position.toArray(),ratio:p.renderer.getPixelRatio(),size:p.renderer.getSize(p.controls.target.clone()).toArray()};});after.camera.forEach((v:number,i:number)=>expect(v).toBeCloseTo(view.camera[i],7));expect(after.ratio).toBe(view.ratio);expect(after.size).toEqual(view.size);
 await page.getByRole('button',{name:'Turntable GIF',exact:true}).click();await dialog.getByRole('button',{name:'Close preview',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).__preview3D.worker)).toBeNull();expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before);
});

test('Workbench remains readable in both themes and on narrow screens',async({page})=>{
 const {dialog}=await open(page);
 for(const width of [1280,390]){
  await page.setViewportSize({width,height:800});await dialog.screenshot({path:`test-results/preview-workbench-${width}.png`});
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  expect(await page.locator('.preview-section').first().evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
 }
 await dialog.getByRole('button',{name:'Close preview',exact:true}).click();await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('tab',{name:'Appearance',exact:true}).click();await page.locator('[name="appearance-theme"][value="light"]').check();await page.keyboard.press('Escape');await page.getByRole('button',{name:'Preview',exact:true}).click();await expect(dialog.locator('canvas')).toBeVisible();await dialog.screenshot({path:'test-results/preview-workbench-light.png'});
});

test('Quality, camera motion and surface rendering stay bounded for many pieces',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await open(page);
 await page.getByRole('button',{name:'Close preview',exact:true}).click();
 await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.newDocument();e.setActiveLayer('cutline');for(let i=0;i<80;i++)e.addShape(new p.Path.Circle({insert:false,center:[(i%10)*20,Math.floor(i/10)*20],radius:7}),'Part '+i);});
 await page.getByRole('button',{name:'Preview',exact:true}).click();await expect(page.locator('[data-preview-summary]')).toContainText('80 pieces');
 const profile=await page.evaluate(()=>{const v=(window as any).__preview3D,start=performance.now(),count=v.rebuildCount;for(let i=0;i<20;i++){v.thickness=3+i*.1;v.positionParts();}return {ms:(performance.now()-start)/20,rebuilds:v.rebuildCount-count,parts:v.parts.length};});
 expect(profile.rebuilds).toBe(0);expect(profile.parts).toBe(80);console.log('80-piece thickness update ms:',profile.ms);
 await section(page,'Scene & performance');await page.getByLabel('Render quality').selectOption('draft');expect(await page.evaluate(()=>(window as any).__preview3D.renderer.getPixelRatio())).toBe(1);
 await page.getByLabel('Auto-rotate').check();const initial=await page.evaluate(()=>(window as any).__preview3D.camera.position.toArray());await expect.poll(()=>page.evaluate(()=>(window as any).__preview3D.camera.position.toArray())).not.toEqual(initial);await page.getByLabel('Auto-rotate').uncheck();
 await page.getByLabel('Render quality').selectOption('balanced');await page.getByLabel('Material',{exact:true}).selectOption('glass');await page.waitForTimeout(200);await page.getByRole('button',{name:'Isometric',exact:true}).click();await page.getByRole('dialog',{name:'Preview',exact:true}).screenshot({path:'test-results/preview-workbench-glass.png'});
 await page.getByLabel('Material',{exact:true}).selectOption('steel');await page.waitForTimeout(200);await page.getByRole('dialog',{name:'Preview',exact:true}).screenshot({path:'test-results/preview-workbench-metal.png'});
 expect(errors).toEqual([]);
});
