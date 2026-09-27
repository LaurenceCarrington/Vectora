import {test,expect} from '@playwright/test';
const DEV='http://127.0.0.1:5174';
async function open(page:any){await page.getByRole('button',{name:'Images',exact:true}).click();await page.getByRole('menuitem',{name:'Raster to vector',exact:true}).click();await expect(page.getByRole('dialog',{name:'Raster to vector',exact:true})).toBeVisible();}
async function upload(page:any,kind='ring'){
  const data=await page.evaluate((kind:string)=>{const canvas=document.createElement('canvas');canvas.width=200;canvas.height=160;const c=canvas.getContext('2d')!;
    if(kind==='ring'){c.fillStyle='#000';c.fillRect(20,20,160,120);c.clearRect(60,50,80,60);}
    if(kind==='line'){c.fillStyle='#000';c.fillRect(20,70,160,10);}
    if(kind==='grey'){c.fillStyle='#b4b4b4';c.fillRect(20,20,160,120);}
    return canvas.toDataURL().split(',')[1];},kind);
  const picker=page.waitForEvent('filechooser');await page.locator('#raster-input').click({position:{x:16,y:16}});await (await picker).setFiles({name:`${kind}.png`,mimeType:'image/png',buffer:Buffer.from(data,'base64')});
}
test('Raster dialog previews Outline and Fill, preserving holes, size, editability and one-step history',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(DEV);await open(page);await expect(page.locator('#raster-add')).toBeDisabled();await expect(page.locator('.raster-header .button, #raster-choose')).toHaveCount(0);await upload(page);
  await expect(page.locator('#raster-path-count')).toHaveText('2 paths');await expect(page.locator('#raster-vector path')).toHaveAttribute('fill','none');
  await page.getByRole('radio',{name:/^Fill/}).check();await expect(page.locator('#raster-status')).toContainText('fitted points');await expect(page.locator('#raster-vector path')).toHaveAttribute('fill','#FFFFFF');
  await page.screenshot({path:'test-results/raster-fill-preview.png'});await page.getByRole('button',{name:'Insert vectors',exact:true}).click();await expect(page.locator('#raster-dialog')).toBeHidden();await expect(page.locator('#properties-panel')).toBeHidden();
  const state=await page.evaluate(async()=>{const e=(window as any).__vectora,p=(window as any).__paper,s=e.selected,{exportDXF}=await import('/src/exportDXF.ts');return {count:e.objects.length,paths:s.children.length,fill:s.fillColor?.toCSS(true),rule:s.fillRule,mode:s.data.rasterTrace.mode,width:s.bounds.width,height:s.bounds.height,hole:s.contains(p.view.center),edge:s.contains(p.view.center.add([-15,0])),dxf:exportDXF(e.objects,true)};});
  expect(state).toMatchObject({count:1,paths:2,fill:'#ffffff',rule:'evenodd',mode:'fill',hole:false,edge:true});expect(state.width).toBeCloseTo(40,8);expect(state.height).toBeCloseTo(30,8);expect(state.dxf.match(/LWPOLYLINE/g)).toHaveLength(2);
  await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(0);await page.keyboard.press('Control+Shift+z');expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(1);
  await page.getByRole('button',{name:'Explode',exact:true}).click();expect(await page.evaluate(()=>(window as any).__vectora.objects.every((s:any)=>s.strokeColor.toCSS(true)==='#ffffff'&&!s.fillColor))).toBe(true);
  await page.getByRole('button',{name:'Node editing',exact:true}).click();expect(await page.evaluate(()=>(window as any).__vectora.overlays.children.filter((s:any)=>s.data.control==='node').length)).toBeGreaterThan(0);expect(errors).toEqual([]);
});
test('Center line produces open stroke paths and can move to Cut Path',async({page})=>{
  await page.goto(DEV);await open(page);await upload(page,'line');await expect(page.locator('#raster-add')).toBeEnabled();await page.getByRole('radio',{name:/^Center line/}).check();await expect(page.locator('#raster-path-count')).toHaveText('1 path');await expect(page.locator('[data-curve-control]').first()).toBeHidden();await page.screenshot({path:'test-results/raster-centerline-preview.png'});
  await page.locator('#raster-add').click();const state=await page.evaluate(()=>{const e=(window as any).__vectora,s=e.selected;return {paths:e.objects.length,closed:s.closed,height:s.bounds.height,width:s.bounds.width,fill:s.fillColor};});expect(state.paths).toBe(1);expect(state.closed).toBe(false);expect(state.height).toBe(0);expect(state.width).toBeGreaterThan(32);expect(state.fill).toBe(null);
  await page.evaluate(()=>(window as any).__vectora.moveSelectionToCutPath());expect(await page.evaluate(()=>(window as any).__vectora.selected.strokeColor.toCSS(true))).toBe('#ff0000');
});
test('Live threshold changes and cancellation keep stale previews out of the document',async({page})=>{
  await page.goto(DEV);await open(page);await upload(page,'grey');await expect(page.locator('#raster-status')).toContainText('No traceable paths');await expect(page.locator('#raster-add')).toBeDisabled();
  await page.locator('#raster-threshold').fill('210');await expect(page.locator('#raster-path-count')).toHaveText('1 path');const path=await page.locator('#raster-vector path').getAttribute('d');expect(path).toContain('M');
  await page.locator('#raster-threshold').fill('100');await page.getByRole('radio',{name:/^Fill/}).check();await page.locator('#raster-threshold').fill('220');await expect(page.locator('#raster-status')).toContainText('fitted points');await expect(page.locator('#raster-add')).toBeEnabled();
  await page.locator('#raster-scale').fill('0');await expect(page.locator('#raster-add')).toBeDisabled();await page.locator('#raster-scale').fill('0.5');await expect(page.locator('#raster-add')).toBeEnabled();
  await page.keyboard.press('Escape');await expect(page.locator('#raster-dialog')).toBeHidden();expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(0);
  await open(page);await expect(page.locator('#raster-add')).toBeDisabled();await expect(page.locator('#raster-empty')).toBeVisible();
});
test('Raster import reports bad files and locked Artwork without changing the document',async({page})=>{
  await page.goto(DEV);await page.evaluate(()=>(window as any).__vectora.setLayerState('artwork','locked',true));await open(page);
  await page.locator('#raster-file').setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('not a bitmap')});await expect(page.locator('#raster-error')).toBeVisible();await expect(page.locator('#raster-add')).toBeDisabled();
  await upload(page);await expect(page.locator('#raster-add')).toBeEnabled();await page.locator('#raster-add').click();await expect(page.locator('#raster-error')).toContainText('unlock');expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(0);await expect(page.locator('#raster-dialog')).toBeVisible();
});
test('Raster geometry retains nested holes, edge pixels, diagonal components and skeleton branches',async({page})=>{
  await page.goto(DEV);const report=await page.evaluate(async()=>{const {traceRaster}=await import('/src/rasterTrace.ts');
    const make=(w:number,h:number,pixel:(x:number,y:number)=>boolean)=>{const rgba=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;if(pixel(x,y))rgba[i+3]=255;}return rgba;};
    const nested=traceRaster(make(32,32,(x,y)=>x>=2&&x<30&&y>=2&&y<30&&(!(x>=8&&x<24&&y>=8&&y<24)||(x>=12&&x<20&&y>=12&&y<20))),32,32,128,'outline');
    const {traceBinaryImage}=await import('/src/vectorizer/autoTracer.ts'); const diagonal=traceBinaryImage(new Uint8Array([1,0,0,0,1,0,0,0,1]),3,3,{minimumPathArea:0,simplifyTolerance:0});
    const branch=traceRaster(make(31,31,(x,y)=>((x>=13&&x<=17&&y>=3&&y<=27)||(y>=13&&y<=17&&x>=3&&x<=27))),31,31,128,'centerline');
    const loop=traceRaster(make(31,31,(x,y)=>Math.hypot(x-15,y-15)>8&&Math.hypot(x-15,y-15)<12),31,31,128,'centerline');
    const transparent=traceRaster(new Uint8ClampedArray(16*16*4),16,16,255,'fill');
    return {nested:nested.paths.length,closed:nested.paths.every(p=>p.closed),diagonal:diagonal.loops.length,branch:branch.paths.length,branchOpen:branch.paths.every(p=>!p.closed),loop:loop.paths.map(p=>p.closed),transparent:transparent.paths.length};
  });expect(report).toMatchObject({nested:3,closed:true,diagonal:3,branch:4,branchOpen:true,loop:[false],transparent:0});
});
test('Production raster worker and narrow dialog support file preview and keyboard dismissal',async({page})=>{
  await page.setViewportSize({width:420,height:700});await page.goto('http://127.0.0.1:4173');await open(page);await upload(page);await expect(page.locator('#raster-path-count')).toHaveText('2 paths');
  const box=(await page.locator('#raster-dialog').boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(16);expect(box.x+box.width).toBeLessThanOrEqual(404);expect(box.height).toBeLessThanOrEqual(668);
  await page.locator('#raster-add').scrollIntoViewIfNeeded();await page.screenshot({path:'test-results/raster-mobile.png'});await page.keyboard.press('Escape');await expect(page.locator('#raster-dialog')).toBeHidden();
});

test('Raster controls preserve fitted curves, simplify paths and preview Original versus Binary',async({page})=>{
  await page.goto(DEV);await open(page);
  const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=240;c.height=200;const ctx=c.getContext('2d')!;ctx.fillStyle='#606060';ctx.beginPath();ctx.arc(120,100,75,0,Math.PI*2);ctx.fill();return c.toDataURL().split(',')[1];});
  await page.locator('#raster-file').setInputFiles({name:'circle.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});
  await expect(page.locator('#raster-add')).toBeEnabled();await expect(page.locator('#raster-vector path')).toHaveAttribute('d',/C/);await expect(page.locator('#raster-binary')).toBeVisible();
  await page.getByRole('button',{name:'Original',exact:true}).click();await expect(page.locator('#raster-source')).toBeVisible();await expect(page.locator('#raster-binary')).toBeHidden();
  await page.getByRole('button',{name:'Binary',exact:true}).click();
  const blackPixel=()=>page.locator('#raster-binary').evaluate((c:HTMLCanvasElement)=>c.getContext('2d')!.getImageData(120,100,1,1).data[0]);
  expect(await blackPixel()).toBe(0);
  await page.locator('#raster-brightness').fill('80');await expect(page.locator('#raster-status')).toContainText('No traceable paths');expect(await blackPixel()).toBe(255);
  await page.locator('#raster-brightness').fill('0');await expect(page.locator('#raster-add')).toBeEnabled();
  await page.locator('#raster-curveFitting').fill('0');await expect(page.locator('#raster-vector path')).not.toHaveAttribute('d',/C/);
  await page.locator('#raster-curveFitting').fill('0.65');await expect(page.locator('#raster-vector path')).toHaveAttribute('d',/C/);
  await page.locator('#raster-add').click();
  const curves=await page.evaluate(()=>{const e=(window as any).__vectora,s=e.selected;return {count:e.objects.length,closed:s.closed,handles:s.segments.filter((n:any)=>!n.handleIn.isZero()||!n.handleOut.isZero()).length,fill:s.fillColor,width:s.bounds.width};});
  expect(curves.count).toBe(1);expect(curves.closed).toBe(true);expect(curves.handles).toBeGreaterThan(8);expect(curves.fill).toBeNull();expect(curves.width).toBeCloseTo(37.5,0);
  await page.getByRole('button',{name:'Node editing',exact:true}).click();const node=await page.evaluate(()=>{const p=(window as any).__paper,s=(window as any).__vectora.selected,n=s.segments.find((n:any)=>!n.handleOut.isZero()),q=p.view.projectToView(n.point);return {x:q.x,y:q.y};});await page.mouse.click(node.x,node.y);expect(await page.evaluate(()=>(window as any).__vectora.overlays.children.filter((s:any)=>s.data.control==='handleOut').length)).toBeGreaterThan(0);
});

test('Raster preprocessing honours noise, contrast and inversion; curve controls alter geometry',async({page})=>{
  await page.goto(DEV);const result=await page.evaluate(async()=>{
    const {preprocessImageData}=await import('/src/vectorizer/imagePreprocess.ts');const {traceRaster}=await import('/src/rasterTrace.ts');
    const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d')!;ctx.fillStyle='#000';ctx.fillRect(2,2,1,1);ctx.fillStyle='#646464';ctx.beginPath();ctx.arc(64,64,40,0,Math.PI*2);ctx.fill();
    const source=ctx.getImageData(0,0,128,128),raw=preprocessImageData(source,{despeckleSize:0}),clean=preprocessImageData(source,{despeckleSize:8}),inverse=preprocessImageData(source,{invert:true}),contrast=preprocessImageData(source,{threshold:80,contrast:50}),flat=preprocessImageData(source,{threshold:80,contrast:0});
    const trace=(options:any)=>traceRaster(source.data,128,128,128,'outline',options),rough=trace({simplifyTolerance:0}),simple=trace({simplifyTolerance:3}),curved=trace({cornerSensitivity:0,simplifyTolerance:5}),corners=trace({cornerSensitivity:1,simplifyTolerance:5});
    return {noise:raw.foregroundPixels-clean.foregroundPixels,inverse:inverse.foregroundPixels+raw.foregroundPixels,contrast:contrast.foregroundPixels,flat:flat.foregroundPixels,rough:rough.pointCount,simple:simple.pointCount,curved:curved.paths[0].svg,corners:corners.paths[0].svg};
  });expect(result.noise).toBe(1);expect(result.inverse).toBe(128*128);expect(result.contrast).toBeGreaterThan(result.flat);expect(result.rough).toBeGreaterThan(result.simple);expect(result.curved).not.toBe(result.corners);
});

test('Raster high resolution preview imports separate outlines with atomic undo and rejects stale results',async({page})=>{
  await page.goto(DEV);await open(page);
  const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=2000;c.height=1000;const ctx=c.getContext('2d')!;ctx.fillRect(100,100,400,400);ctx.fillRect(1000,100,400,400);return c.toDataURL().split(',')[1];});
  await page.locator('#raster-file').setInputFiles({name:'large.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});await expect(page.locator('#raster-path-count')).toHaveText('2 paths');await expect(page.locator('#raster-source')).toHaveAttribute('width','1600');await expect(page.locator('#raster-detail')).toContainText('1600 × 800');
  // Check invalidation synchronously, before the debounced worker can finish.
  expect(await page.evaluate(()=>{const input=document.querySelector<HTMLInputElement>('#raster-threshold')!;input.value='0';input.dispatchEvent(new Event('input'));return (document.querySelector('#raster-add') as HTMLButtonElement).disabled;})).toBe(true);
  await expect(page.locator('#raster-status')).toContainText('No traceable paths');await page.locator('#raster-threshold').fill('128');await expect(page.locator('#raster-add')).toBeEnabled();await page.locator('#raster-scale').fill('0.1');await expect(page.locator('#raster-size')).toHaveText('160 × 80 mm');await page.locator('#raster-add').click();
  const shapes=await page.evaluate(()=>(window as any).__vectora.objects.map((s:any)=>({type:s.className,width:s.bounds.width,closed:s.closed})));expect(shapes).toHaveLength(2);for(const shape of shapes){expect(shape).toMatchObject({type:'Path',closed:true});expect(shape.width).toBeCloseTo(32,8);}
  await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(0);await page.keyboard.press('Control+Shift+z');expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(2);
  await open(page);await upload(page);await expect(page.locator('#raster-add')).toBeEnabled();await page.locator('#raster-file').setInputFiles({name:'bad.png',mimeType:'image/png',buffer:Buffer.from('bad')});await expect(page.locator('#raster-error')).toBeVisible();await expect(page.locator('#raster-add')).toBeDisabled();await page.keyboard.press('Escape');expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(2);
});
