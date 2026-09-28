import {test,expect} from '@playwright/test';
const DEV='http://127.0.0.1:5174';
async function design(page:any){await page.evaluate(()=>{
 const e=(window as any).__vectora,p=(window as any).__paper;
 e.addShape(new p.Path.Rectangle({insert:false,rectangle:[10,20,100,65]}),'Panel');e.moveSelectionToLayer('cutline');
 e.addShape(new p.Path.Circle({insert:false,center:[42,52],radius:13}),'Hole');e.moveSelectionToLayer('cutline');
 e.addShape(new p.Path({insert:false,segments:[[67,40],[93,40],[80,65]],closed:true}),'Engraving');e.moveSelectionToLayer('engrave');
});}

test('Preview geometry preserves nesting, layers, transforms and document state',async({page})=>{
 await page.goto(DEV);await design(page);
 const result=await page.evaluate(async()=>{
  const e=(window as any).__vectora,p=(window as any).__paper,{buildPreviewModel}=await import('/src/previewModel.ts');
  e.addShape(new p.Path.Circle({insert:false,center:[42,52],radius:4}),'Island');e.moveSelectionToLayer('cutline');
  e.addShape(new p.Path.Rectangle({insert:false,rectangle:[150,20,25,25]}),'Other piece');e.moveSelectionToLayer('cutline');
  e.addShape(new p.Path({insert:false,segments:[[10,90],[50,90]]}),'Open cut');e.moveSelectionToLayer('cutline');
  e.setLayerState('cutline','locked',true);e.setActiveLayer('artwork');
  e.addShape(new p.Path.Rectangle({insert:false,rectangle:[-1000,-1000,2000,2000]}),'Ignored artwork');
  const before=JSON.stringify(e.snapshot()),model=await buildPreviewModel(e.objects);
  const unchanged=before===JSON.stringify(e.snapshot());e.setLayerState('cutline','visible',false);const engravingOnly=await buildPreviewModel(e.objects);
  return {model,unchanged,engravingOnly};
 });
 expect(result.model).toMatchObject({parts:3,holes:1,openCuts:1,stock:false,bounds:{x:10,y:20,width:165,height:65}});expect(result.model?.marks).toHaveLength(1);expect(result.unchanged).toBe(true);expect(result.engravingOnly).toMatchObject({stock:true,parts:1,holes:0});expect(result.engravingOnly!.bounds.width).toBeLessThan(50);
});

test('3D preview renders materials and holes, supports controls, and leaves the drawing unchanged',async({page})=>{
 await page.goto(DEV);await design(page);const before=await page.evaluate(()=>({snapshot:(window as any).__vectora.snapshot(),zoom:(window as any).__paper.view.zoom,undo:(window as any).__vectora.canUndo}));
 const trigger=page.getByRole('button',{name:'Preview',exact:true});await trigger.click();const dialog=page.getByRole('dialog',{name:'Preview',exact:true});await expect(dialog).toBeVisible();await expect(dialog.locator('[data-preview-summary]')).toContainText('1 piece · 1 hole');await expect(dialog.locator('canvas')).toBeVisible();
 await dialog.screenshot({path:'test-results/preview3d-plywood.png'});
 await expect(dialog.locator('.preview-section[open]')).toHaveCount(0);await dialog.locator('.preview-section > summary').filter({hasText:/^Material$/}).click();
 await dialog.getByLabel('Material',{exact:true}).selectOption('aluminium');await dialog.getByLabel('Material thickness').fill('6');await expect(dialog.locator('[data-preview-summary]')).toContainText('× 6 mm');await dialog.getByLabel('Show engraving').uncheck();await dialog.getByRole('button',{name:'Top view',exact:true}).click();
 await dialog.screenshot({path:'test-results/preview3d-aluminium.png'});expect(await dialog.evaluate(el=>el.scrollTop)).toBe(0);
 await dialog.getByLabel('Material thickness').fill('0');await expect(dialog.locator('[data-preview-validation]')).toBeVisible();await expect(dialog.locator('[data-preview-summary]')).toContainText('× 6 mm');await dialog.getByLabel('Material thickness').fill('3');
 await dialog.locator('canvas').focus();await page.keyboard.press('ArrowLeft');await page.keyboard.press('+');await page.keyboard.press('Delete');await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(trigger).toBeFocused();expect(await page.evaluate(()=>({snapshot:(window as any).__vectora.snapshot(),zoom:(window as any).__paper.view.zoom,undo:(window as any).__vectora.canUndo}))).toEqual(before);expect(await dialog.locator('canvas').count()).toBe(0);
 await trigger.click();await expect(dialog.locator('canvas')).toBeVisible();await expect(dialog.locator('.preview-section[open]')).toHaveCount(0);await expect(dialog.locator('[data-preview-summary]')).toContainText('1 piece · 1 hole');await dialog.getByRole('button',{name:'Close preview',exact:true}).click();
});

test('Empty and engraving-only previews explain the material, including a narrow viewport',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto(DEV);const trigger=page.getByRole('button',{name:'Preview',exact:true});const box=await trigger.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);await trigger.click();const dialog=page.getByRole('dialog',{name:'Preview',exact:true});await expect(dialog).toContainText('Nothing to preview yet');await dialog.getByRole('button',{name:'Close preview',exact:true}).click();
 await design(page);await page.evaluate(()=>(window as any).__vectora.setLayerState('cutline','visible',false));await trigger.click();await expect(dialog.locator('[data-preview-note]')).toContainText('fitted rectangular blank');await expect(dialog.locator('canvas')).toBeVisible();await dialog.screenshot({path:'test-results/preview3d-mobile.png'});expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
});


test('Unavailable WebGL reports a recoverable error without changing the document',async({page})=>{
 await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type:string,...args:any[]){if(type==='webgl'||type==='webgl2'||type==='experimental-webgl')return null;return original.call(this,type,...args);} as any;});
 await page.goto(DEV);await design(page);const before=await page.evaluate(()=>(window as any).__vectora.snapshot());await page.getByRole('button',{name:'Preview',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Preview',exact:true});await expect(dialog).toContainText('Unable to show preview');await dialog.getByRole('button',{name:'Close preview',exact:true}).click();expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before);
});

test('Production build opens the preview without source-only modules',async({page})=>{
 await page.goto('http://127.0.0.1:4173');await page.getByRole('button',{name:'Preview',exact:true}).click();await expect(page.getByRole('dialog',{name:'Preview',exact:true})).toContainText('Nothing to preview yet');
});

async function previewCameraState(page:any){return page.evaluate(()=>{
 const p=(window as any).__preview3D,c=p.camera,b=p.model.bounds,e=c.matrixWorldInverse.elements,depths=[];
 for(const x of [-b.width/2,b.width/2])for(const y of [0,p.thickness])for(const z of [-b.height/2,b.height/2])depths.push(-(e[2]*x+e[6]*y+e[10]*z+e[14]));
 return {y:c.position.y,center:p.thickness/2,near:c.near,far:c.far,minDepth:Math.min(...depths),maxDepth:Math.max(...depths),position:c.position.toArray(),up:c.up.toArray()};
});}

test('Preview opens at the top, turns without roll, and retains clipping protection',async({page})=>{
 await page.goto(DEV);await design(page);const trigger=page.getByRole('button',{name:'Preview',exact:true});await trigger.click();const dialog=page.getByRole('dialog',{name:'Preview',exact:true}),canvas=dialog.locator('canvas');await expect(canvas).toBeVisible();
 const isTop=async()=>page.evaluate(()=>{const p=(window as any).__preview3D;return p.controls.getPolarAngle()<.0001&&Math.abs(p.controls.getAzimuthalAngle())<.0001;});expect(await isTop()).toBe(true);
 await canvas.focus();for(let i=0;i<24;i++)await page.keyboard.press('ArrowDown');await expect.poll(async()=>{const s=await previewCameraState(page);return s.y<s.center;}).toBe(true);
 for(let i=0;i<54;i++){await page.keyboard.press('ArrowRight');const state=await previewCameraState(page);expect(state.up).toEqual([0,1,0]);expect(state.minDepth).toBeGreaterThan(state.near);expect(state.maxDepth).toBeLessThan(state.far);}
 // Reset during movement must discard inertia and remain at the requested top view.
 await dialog.getByRole('button',{name:'Reset view',exact:true}).click();expect(await isTop()).toBe(true);await page.waitForTimeout(350);expect(await isTop()).toBe(true);
 const box=(await canvas.boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height*.85);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+box.height*.15,{steps:24});await page.mouse.up();await expect.poll(async()=>{const s=await previewCameraState(page);return s.y<s.center;}).toBe(true);
 expect((await previewCameraState(page)).up).toEqual([0,1,0]);await dialog.screenshot({path:'test-results/preview3d-underside.png'});
 await canvas.focus();for(let i=0;i<35;i++)await page.keyboard.press('+');for(let i=0;i<26;i++){await page.keyboard.press('ArrowLeft');const s=await previewCameraState(page);expect(s.minDepth).toBeGreaterThan(s.near);expect(s.maxDepth).toBeLessThan(s.far);}
 await dialog.locator('.preview-section > summary').filter({hasText:/^Material$/}).click();await dialog.getByLabel('Material thickness').fill('100');await canvas.focus();for(let i=0;i<20;i++)await page.keyboard.press('+');const thick=await previewCameraState(page);expect(thick.minDepth).toBeGreaterThan(thick.near);expect(thick.maxDepth).toBeLessThan(thick.far);
 await dialog.getByRole('button',{name:'Close preview',exact:true}).click();await trigger.click();await expect(canvas).toBeVisible();expect(await isTop()).toBe(true);
});

test('Equal drags rotate consistently anywhere on the canvas and reduced motion stops inertia',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto(DEV);await design(page);await page.getByRole('button',{name:'Preview',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Preview',exact:true}),canvas=dialog.locator('canvas');await expect(canvas).toBeVisible();const box=(await canvas.boundingBox())!,angles=[];
 for(const x of [.2,.8]){await dialog.getByRole('button',{name:'Top view',exact:true}).click();await page.mouse.move(box.x+box.width*x,box.y+box.height*.65);await page.mouse.down();await page.mouse.move(box.x+box.width*x+30,box.y+box.height*.4,{steps:12});await page.mouse.up();angles.push(await page.evaluate(()=>{const p=(window as any).__preview3D;return [p.controls.getPolarAngle(),p.controls.getAzimuthalAngle()];}));}
 expect(angles[0][0]).toBeCloseTo(angles[1][0],4);expect(angles[0][1]).toBeCloseTo(angles[1][1],4);const before=await previewCameraState(page);await page.waitForTimeout(150);expect((await previewCameraState(page)).position).toEqual(before.position);
});

test('Short preview windows contain the canvas and keep controls reachable after resizing',async({page})=>{
 await page.setViewportSize({width:1024,height:450});await page.goto(DEV);await design(page);await page.getByRole('button',{name:'Preview',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Preview',exact:true});await expect(dialog.locator('canvas')).toBeVisible();
 for(const viewport of [{width:1024,height:450},{width:760,height:390},{width:1200,height:800}]){
  await page.setViewportSize(viewport);await expect.poll(async()=>dialog.evaluate(el=>{const canvas=el.querySelector('canvas')!.getBoundingClientRect(),header=el.querySelector('header')!.getBoundingClientRect(),footer=el.querySelector('footer')!.getBoundingClientRect(),view=el.querySelector('.preview3d-view')!.getBoundingClientRect();return canvas.top>=header.bottom-1&&Math.abs(canvas.bottom-footer.top)<1&&Math.abs(canvas.height-view.height)<1;})).toBe(true);
  await dialog.getByRole('button',{name:'Top view',exact:true}).click();await expect(dialog.getByRole('button',{name:'Close preview',exact:true})).toBeInViewport();expect(await dialog.evaluate(el=>el.scrollTop)).toBe(0);
 }
 await page.setViewportSize({width:1024,height:450});await dialog.screenshot({path:'test-results/preview3d-short.png'});
});

test('Filled engraving covers interiors, preserves holes and survives layer transfers and undo',async({page})=>{
 await page.goto(DEV);
 const result=await page.evaluate(async()=>{
  const e=(window as any).__vectora,p=(window as any).__paper;
  const {buildPreviewModel}=await import('/src/previewModel.ts'),{materialCanvas,PREVIEW_MATERIALS}=await import('/src/previewMaterials.ts');
  e.addShape(new p.Path.Rectangle({insert:false,rectangle:[0,0,100,100]}),'Panel');e.moveSelectionToLayer('cutline');
  const outer=new p.Path.Rectangle({insert:false,rectangle:[20,20,60,60]}),inner=new p.Path.Rectangle({insert:false,rectangle:[40,40,20,20]});
  const region=new p.CompoundPath({insert:false,children:[outer,inner],fillRule:'evenodd'});
  e.setActiveLayer('artwork');e.addShape(region,'Filled region');region.fillColor='#ff00ff';region.data.regionFill=true;region.data.regionFillColor='#FF00FF';
  const original=region.pathData;
  e.moveSelectionToLayer('engrave');
  const moved={fill:e.selected.fillColor.toCSS(true),stroke:e.selected.strokeColor,path:e.selected.pathData,rule:e.selected.fillRule};
  e.undo();const undone={role:e.selected.data.role,fill:e.selected.fillColor.toCSS(true)};
  e.redo();
  const model=(await buildPreviewModel(e.objects))!,material=PREVIEW_MATERIALS[0];
  const marked=materialCanvas(model,material,true),plain=materialCanvas(model,material,false);
  const pixel=(c:HTMLCanvasElement,x:number,y:number)=>Array.from(c.getContext('2d')!.getImageData(Math.floor(x*c.width/100),Math.floor(y*c.height/100),1,1).data);
  const pixels={area:pixel(marked,30,30),areaBefore:pixel(plain,30,30),hole:pixel(marked,50,50),holeBefore:pixel(plain,50,50),outside:pixel(marked,10,10),outsideBefore:pixel(plain,10,10)};
  // Older projects retain region metadata even though layer transfer cleared their fill.
  e.selected.fillColor=null;const legacy=(await buildPreviewModel(e.objects))!.marks[0].fill;
  e.moveSelectionToLayer('artwork');const restored=e.selected.fillColor.toCSS(true);
  // Raster Fill has equivalent area semantics; ordinary closed outlines must stay strokes.
  const trace=new p.Path.Circle({insert:false,center:[30,30],radius:5,fillColor:'#383838'});trace.data.rasterTrace={mode:'fill'};e.addShape(trace,'Trace');e.moveSelectionToLayer('engrave');
  const traceFill=e.selected.fillColor.toCSS(true);e.selected.fillColor=null;
  e.addShape(new p.Path.Rectangle({insert:false,rectangle:[60,60,10,10]}),'Outline');e.moveSelectionToLayer('engrave');
  const kinds=(await buildPreviewModel(e.objects))!.marks.map(mark=>mark.fill);
  return {original,moved,undone,mark:model.marks[0],pixels,legacy,restored,traceFill,kinds};
 });
 expect(result.moved).toEqual({fill:'#0000ff',stroke:null,path:result.original,rule:'evenodd'});
 expect(result.undone).toEqual({role:'artwork',fill:'#ff00ff'});expect(result.restored).toBe('#ff00ff');
 expect(result.mark).toMatchObject({fill:true,fillRule:'evenodd'});
 expect(result.pixels.area).toEqual([80,49,30,255]);expect(result.pixels.area).not.toEqual(result.pixels.areaBefore);
 expect(result.pixels.hole).toEqual(result.pixels.holeBefore);expect(result.pixels.outside).toEqual(result.pixels.outsideBefore);
 expect(result.legacy).toBe(true);expect(result.traceFill).toBe('#0000ff');expect(result.kinds).toEqual([true,false]);
});

test('Viewer gestures pan, zoom and fit consistently without changing the design',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto(DEV);await design(page);
 const before=await page.evaluate(()=>(window as any).__vectora.snapshot());await page.getByRole('button',{name:'Preview',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Preview',exact:true}),canvas=dialog.locator('canvas');await expect(canvas).toBeVisible();
 const state=()=>page.evaluate(()=>{const v=(window as any).__preview3D;return {target:v.controls.target.toArray(),distance:v.camera.position.distanceTo(v.controls.target),phi:v.controls.getPolarAngle(),theta:v.controls.getAzimuthalAngle()};});
 const drag=async(button:'left'|'middle'|'right',dx:number,dy:number,modifier?:'Shift'|'Control')=>{const b=(await canvas.boundingBox())!;if(modifier)await page.keyboard.down(modifier);await page.mouse.move(b.x+b.width*.5,b.y+b.height*.5);await page.mouse.down({button});await page.mouse.move(b.x+b.width*.5+dx,b.y+b.height*.5+dy,{steps:10});await page.mouse.up({button});if(modifier)await page.keyboard.up(modifier);};
 const panTargets=[];
 for(const [button,modifier] of [['middle',undefined],['right',undefined],['left','Shift']] as const){
  await dialog.getByRole('button',{name:'Top view',exact:true}).click();const start=await state();await drag(button,40,25,modifier);const end=await state();expect(end.target).not.toEqual(start.target);expect(end.phi).toBeCloseTo(start.phi,5);expect(end.theta).toBeCloseTo(start.theta,5);panTargets.push(end.target);
 }
 panTargets[0].forEach((v,i)=>{expect(panTargets[1][i]).toBeCloseTo(v,5);expect(panTargets[2][i]).toBeCloseTo(v,5);});
 await dialog.getByRole('button',{name:'Top view',exact:true}).click();const start=await state();await drag('left',0,70,'Control');const zoomed=await state();expect(zoomed.distance).toBeGreaterThan(start.distance);expect(zoomed.target).toEqual(start.target);expect(zoomed.phi).toBeCloseTo(start.phi,5);
 const angles=[];
 for(const viewport of [{width:1280,height:900},{width:1024,height:650}]){await page.setViewportSize(viewport);await expect.poll(()=>canvas.evaluate(el=>el.clientHeight)).toBeGreaterThan(200);await dialog.getByRole('button',{name:'Top view',exact:true}).click();await drag('left',35,-70);angles.push(await state());}
 expect(angles[0].phi).toBeCloseTo(angles[1].phi,5);expect(angles[0].theta).toBeCloseTo(angles[1].theta,5);
 await drag('right',50,25);const panned=await state();await canvas.focus();await page.keyboard.press('f');const fitted=await state();expect(fitted.target).toEqual([0,1.5,0]);expect(fitted.phi).toBeCloseTo(panned.phi,5);expect(fitted.theta).toBeCloseTo(panned.theta,5);
 await dialog.getByRole('button',{name:'Close preview',exact:true}).click();expect(await page.evaluate(()=>(window as any).__vectora.snapshot())).toEqual(before);
});

test('Dark preview uses a world-space grid that stays below the model and disposes on close',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto(DEV);await design(page);
 await page.getByRole('button',{name:'Preview',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Preview',exact:true}),canvas=dialog.locator('canvas');await expect(canvas).toBeVisible();
 const grid=await page.evaluate(()=>{
  const p=(window as any).__preview3D,g=p.scene.getObjectByName('preview-grid');
  (window as any).gridDisposals=0;for(const line of g.children){line.geometry.addEventListener('dispose',()=>{(window as any).gridDisposals++;});line.material.addEventListener('dispose',()=>{(window as any).gridDisposals++;});}
  return {background:p.renderer.getClearColor(g.children[0].material.color.clone()).getHexString(),y:g.position.y,lines:g.children.length,parent:g.parent===p.scene,depthWrite:g.children.map((l:any)=>l.material.depthWrite)};
 });
 expect(grid).toMatchObject({background:'202226',lines:2,parent:true,depthWrite:[false,false]});expect(grid.y).toBeLessThan(0);
 await canvas.focus();for(let i=0;i<8;i++)await page.keyboard.press('ArrowDown');for(let i=0;i<3;i++)await page.keyboard.press('ArrowRight');
 expect(await page.evaluate(()=>(window as any).__preview3D.scene.getObjectByName('preview-grid').position.y)).toBe(grid.y);
 await dialog.screenshot({path:'test-results/preview3d-dark-grid.png'});
 await dialog.getByRole('button',{name:'Close preview',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).gridDisposals)).toBe(4);
});
