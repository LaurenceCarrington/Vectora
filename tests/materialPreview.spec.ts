import {test,expect,type Page} from './fixtures';
const DEV='http://127.0.0.1:5174';
async function seed(page:Page){await page.goto(DEV);await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;e.setActiveLayer('cutline');e.addShape(new p.Path.Rectangle({insert:false,rectangle:[0,0,100,60]}),'Panel');e.addShape(new p.Path.Circle({insert:false,center:[25,30],radius:10}),'Hole');e.setActiveLayer('engrave');const engraving=new p.Path.Rectangle({insert:false,rectangle:[45,15,30,25],fillColor:'blue'});engraving.data.regionFill=true;e.addShape(engraving,'Engraved area');e.setActiveLayer('artwork');e.addShape(new p.Path.Circle({insert:false,center:[60,30],radius:6}),'Ink');e.setPaint('#FF0000',1,true);});}
for(const theme of [
 {value:'light',name:'Light',background:'fafbfc',backgroundCSS:'rgb(250, 251, 252)',foregroundCSS:'rgb(40, 43, 49)',grid:['e6eaf0','c8d1dd']},
 {value:'high-contrast',name:'High contrast',background:'ffffff',backgroundCSS:'rgb(255, 255, 255)',foregroundCSS:'rgb(0, 0, 0)',grid:['909090','555555']},
]) test(`preview canvas, grid and camera controls follow ${theme.name} mode without rebuilding the model or moving the camera`,async({page})=>{
 await seed(page);
 await page.getByRole('button',{name:'Settings',exact:true}).click();
 await page.getByRole('tab',{name:'Appearance',exact:true}).click();
 await page.locator(`[name="appearance-theme"][value="${theme.value}"]`).check();
 await page.keyboard.press('Escape');
 await page.evaluate(async()=>{
  const {MaterialPreview}=await import('/src/materialPreview.ts'),{materialPreviewInput}=await import('/src/materialPreviewInput.ts');
  const preview:any=new MaterialPreview(document.querySelector('[data-material-preview]')!,()=>materialPreviewInput((window as any).__vectora.objects));
  (window as any).__previewUnderTest=preview;await preview.open();
 });
 const dialog=page.getByRole('dialog',{name:'Material & process preview'});
 await expect(dialog.locator('[data-preview-status]')).toContainText('1 piece');
 await expect(dialog.locator('.material-preview-viewport')).toHaveCSS('background-color',theme.backgroundCSS);
 await expect(dialog.getByRole('button',{name:'Top view',exact:true})).toHaveCSS('color',theme.foregroundCSS);
 const colours=()=>page.evaluate(async()=>{
  const {Color}=await import('/node_modules/three/build/three.module.js');const p=(window as any).__previewUnderTest,attribute=p.grid.geometry.getAttribute('color');
  return {background:p.scene.background.getHexString(),grid:[new Color().fromBufferAttribute(attribute,0).getHexString(),new Color().fromBufferAttribute(attribute,80).getHexString()]};
 });
 expect(await colours()).toEqual({background:theme.background,grid:theme.grid});
 await dialog.screenshot({path:`test-results/material-preview-theme-${theme.value}.png`});
 const before=await page.evaluate(()=>{const p=(window as any).__previewUnderTest;return {root:p.root.uuid,grid:p.grid.uuid,camera:p.camera.position.toArray(),document:JSON.stringify((window as any).__vectora.snapshot())};});
 await page.evaluate(()=>{document.documentElement.dataset.theme='dark';});
 await expect.poll(colours).toEqual({background:'202226',grid:['30363f','434a54']});
 await expect(dialog.getByRole('button',{name:'Top view',exact:true})).toHaveCSS('color','rgb(255, 255, 255)');
 const after=await page.evaluate(()=>{const p=(window as any).__previewUnderTest;return {root:p.root.uuid,grid:p.grid.uuid,camera:p.camera.position.toArray(),document:JSON.stringify((window as any).__vectora.snapshot())};});
 expect({root:after.root,grid:after.grid,document:after.document}).toEqual({root:before.root,grid:before.grid,document:before.document});
 after.camera.forEach((value:number,i:number)=>expect(value).toBeCloseTo(before.camera[i],9));
 await dialog.getByRole('button',{name:'Close preview',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).__previewUnderTest.renderer)).toBeNull();
 await page.evaluate(async value=>{document.documentElement.dataset.theme=value;await (window as any).__previewUnderTest.open();},theme.value);
 await expect(dialog.locator('[data-preview-message]')).toBeHidden();
 expect(await colours()).toEqual({background:theme.background,grid:theme.grid});
 await dialog.getByRole('button',{name:'Close preview',exact:true}).click();
});

test('empty preview in Light mode uses a light placeholder with readable controls',async({page})=>{
 await page.goto(DEV);await page.evaluate(()=>{document.documentElement.dataset.theme='light';});
 await page.getByRole('button',{name:'Preview',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Material & process preview'});
 await expect(dialog.locator('[data-preview-status]')).toHaveText('No material to preview');
 await expect(dialog.locator('[data-preview-message]')).toHaveCSS('background-color','rgb(250, 251, 252)');
 await expect(dialog.locator('[data-preview-message]')).toHaveCSS('color','rgb(40, 43, 49)');
 await expect(dialog.locator('[data-preview-view]')).toHaveCSS('color','rgb(88, 95, 107)');
});
test('Preview opens finished pieces with material, thickness, engraving depth and Artwork overlay controls',async({page})=>{
 await seed(page);const button=page.getByRole('button',{name:'Preview',exact:true});await expect(button).toBeVisible();const before=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;return {document:e.snapshot(),zoom:p.view.zoom,center:p.view.center.toString(),undo:e.canUndo};});await button.click();
 const dialog=page.getByRole('dialog',{name:'Material & process preview'});await expect(dialog).toBeVisible();await expect(dialog.locator('canvas')).toBeVisible();await expect(dialog.locator('[data-preview-status]')).toContainText('1 piece');
 await dialog.getByRole('combobox',{name:'Material',exact:true}).selectOption('acrylic');await dialog.getByRole('spinbutton',{name:'Thickness (mm)',exact:true}).fill('6');await dialog.getByRole('spinbutton',{name:'Thickness (mm)',exact:true}).press('Tab');await dialog.getByRole('spinbutton',{name:'Vector engraving depth (mm)',exact:true}).fill('0.5');await dialog.getByRole('spinbutton',{name:'Vector engraving depth (mm)',exact:true}).press('Tab');await dialog.getByRole('checkbox',{name:'Artwork colours',exact:true}).check();await expect(dialog.locator('[data-preview-status]')).toContainText('6 mm');
 await dialog.getByRole('button',{name:'Close preview',exact:true}).click();await expect(button).toBeFocused();expect(await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;return {document:e.snapshot(),zoom:p.view.zoom,center:p.view.center.toString(),undo:e.canUndo};})).toEqual(before);
});

test('combined engraving preserves holes and uses maximum depth, with true through cuts',async({page})=>{
 await page.goto(DEV);
 const result=await page.evaluate(async()=>{
  const {buildMaterialPreview}=await import('/src/materialPreviewGeometry.ts');
  const rect=(x:number,y:number,w:number,h:number)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
  const mark=(x:number,y:number,w:number,h:number,role:'vector'|'raster')=>({contours:[{points:rect(x,y,w,h),closed:true}],filled:true,evenOdd:true,width:.2,role,path:''});
  const cuts=[rect(0,0,100,60),rect(10,10,10,10)],settings={thickness:3,vectorDepth:.2,rasterDepth:.6,openCutDepth:1};
  const input={cuts,marks:[mark(30,10,30,30,'vector'),mark(45,20,30,30,'raster'),{contours:[{points:[{x:80,y:0},{x:80,y:60}],closed:false}],filled:false,evenOdd:true,width:.15,role:'cut' as const,path:''}],artworkSVG:null};
  const model=(await buildMaterialPreview(input,settings))!;
  // Independently sample occupancy and highest surface; don't rely on the engine's area or nesting routines.
  const contains=(points:any[],x:number,y:number)=>{let n=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)n=!n;}return n;};
  const height=(m:any,x:number,y:number)=>Math.max(0,...m.volumes.filter((v:any)=>v.regions.some((r:any)=>contains(r.outer,x,y)&&!r.holes.some((h:any)=>contains(h,x,y)))).map((v:any)=>v.top));
  const through=await buildMaterialPreview({cuts:[rect(0,0,100,60)],marks:[mark(20,20,20,20,'vector')],artworkSVG:null},{...settings,vectorDepth:3});
  const duplicates=await buildMaterialPreview({cuts:[...cuts,[{x:0,y:60},{x:100,y:60},{x:100,y:0},{x:50,y:0},{x:0,y:0}]],marks:[],artworkSVG:null},settings);
  const islands=await buildMaterialPreview({cuts:[rect(0,0,100,60),rect(10,10,40,40),rect(20,20,10,10)],marks:[],artworkSVG:null},settings);
  const stock=await buildMaterialPreview({cuts:[],marks:[mark(0,0,20,20,'vector')],artworkSVG:null},settings);
  return {pieces:model.pieces,holes:model.holes,heights:[[5,5],[15,15],[35,15],[65,40],[50,25],[80,30],[110,30]].map(([x,y])=>height(model,x,y)),through:[height(through,25,25),height(through,5,5)],duplicates:duplicates?.pieces,islands:[islands?.pieces,islands?.holes],stock:stock?.stock};
 });
 expect(result).toEqual({pieces:1,holes:1,heights:[3,0,2.8,2.4,2.4,2,0],through:[0,3],duplicates:1,islands:[2,1],stock:true});
});

test('stroke engraving remains a groove; empty and fully removed models report useful states',async({page})=>{
 await page.goto(DEV);
 const result=await page.evaluate(async()=>{
  const {buildMaterialPreview}=await import('/src/materialPreviewGeometry.ts');const rect=[{x:0,y:0},{x:40,y:0},{x:40,y:40},{x:0,y:40}],circle=Array.from({length:120},(_,i)=>({x:20+10*Math.cos(i*Math.PI/60),y:20+10*Math.sin(i*Math.PI/60)})),settings={thickness:3,vectorDepth:.2,rasterDepth:.2,openCutDepth:.2};
  const model=await buildMaterialPreview({cuts:[rect],marks:[{contours:[{points:circle,closed:true}],filled:false,evenOdd:true,width:1,role:'vector',path:''}],artworkSVG:null},settings);
  const top=model!.volumes.find(v=>v.top===3)!;
  const empty=await buildMaterialPreview({cuts:[],marks:[],artworkSVG:null},settings);
  let removed='';try{await buildMaterialPreview({cuts:[rect],marks:[{contours:[{points:rect,closed:true}],filled:true,evenOdd:true,width:1,role:'vector',path:''}],artworkSVG:null},{...settings,vectorDepth:3});}catch(error){removed=(error as Error).message;}
  let invalid='';try{await buildMaterialPreview({cuts:[rect],marks:[],artworkSVG:null},{...settings,vectorDepth:4});}catch(error){invalid=(error as Error).message;}
  return {topPieces:top.regions.length,empty,removed,invalid};
 });
 expect(result.topPieces).toBe(2);expect(result.empty).toBeNull();expect(result.removed).toContain('No material remains');expect(result.invalid).toContain('process depths');
});

test('camera controls start top-down, rotate smoothly, reset and reopen without stale state',async({page})=>{
 await seed(page);await page.getByRole('button',{name:'Preview',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Material & process preview'}),canvas=dialog.locator('canvas');
 await expect(dialog.locator('[data-preview-status]')).toContainText('1 piece');await expect(dialog.locator('[data-preview-view]')).toHaveText('Top');
 await canvas.focus();await canvas.press('ArrowDown');await expect(dialog.locator('[data-preview-view]')).toHaveText('Orbit');await canvas.press('+');await canvas.press('Home');await expect(dialog.locator('[data-preview-view]')).toHaveText('Top');
 await dialog.getByRole('button',{name:'Isometric view',exact:true}).click();await expect(dialog.locator('[data-preview-view]')).toHaveText('Isometric');
 const box=(await canvas.boundingBox())!;await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.7,box.y+box.height*.65,{steps:15});await page.mouse.up();await expect(dialog.locator('[data-preview-view]')).toHaveText('Orbit');
 await dialog.getByRole('spinbutton',{name:'Thickness (mm)',exact:true}).fill('6');await expect(dialog.locator('[data-preview-status]')).toContainText('6 mm');await expect(dialog.locator('[data-preview-view]')).toHaveText('Orbit');
 await dialog.getByRole('button',{name:'Back view',exact:true}).click();await expect(dialog.locator('[data-preview-view]')).toHaveText('Back');
 await dialog.getByRole('button',{name:'Top view',exact:true}).click();await expect(dialog.locator('[data-preview-view]')).toHaveText('Top');
 await dialog.screenshot({path:'test-results/material-preview-dark.png'});
 await canvas.press('Escape');await expect(dialog).not.toBeVisible();await page.getByRole('button',{name:'Preview',exact:true}).click();await expect(dialog.locator('[data-preview-status]')).toContainText('6 mm');await expect(dialog.locator('[data-preview-view]')).toHaveText('Top');expect(await canvas.count()).toBe(1);
});

test('preview respects hidden layers but includes locked geometry; extraction leaves source transforms intact',async({page})=>{
 await seed(page);
 const result=await page.evaluate(async()=>{const e=(window as any).__vectora,p=(window as any).__paper;const {materialPreviewInput}=await import('/src/materialPreviewInput.ts');const hole=e.objects.find((s:any)=>s.data.name==='Hole');hole.locked=true;const before=e.snapshot();const input=await materialPreviewInput(e.objects);const after=e.snapshot();hole.layer.visible=false;const hidden=await materialPreviewInput(e.objects);return {before,after,cuts:input.cuts.length,hiddenCuts:hidden.cuts.length,marks:input.marks.length,temporary:p.project.activeLayer.children.filter((s:any)=>!s.data.uid).length};});
 expect(result.before).toEqual(result.after);expect(result.cuts).toBe(2);expect(result.hiddenCuts).toBe(0);expect(result.marks).toBe(1);
});

test('production bundle opens preview and light-mode controls remain readable on a short window',async({page})=>{
 await page.goto('http://127.0.0.1:4173');await page.getByRole('button',{name:'Preview',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Material & process preview'});await expect(dialog.locator('[data-preview-status]')).toHaveText('No material to preview');await dialog.getByRole('button',{name:'Close preview',exact:true}).click();
 await seed(page);await page.evaluate(()=>{document.documentElement.dataset.theme='light';});await page.setViewportSize({width:1100,height:600});await page.getByRole('button',{name:'Preview',exact:true}).click();await expect(dialog.locator('[data-preview-status]')).toContainText('1 piece');
 const sizes=await dialog.evaluate(el=>{const stage=el.querySelector('[data-preview-stage]')!.getBoundingClientRect(),footer=el.querySelector('footer')!.getBoundingClientRect(),settings=el.querySelector('.material-preview-settings')!;return {stageBottom:stage.bottom,footerTop:footer.top,settingsOverflow:settings.scrollHeight>settings.clientHeight,height:el.getBoundingClientRect().height};});
 expect(sizes.stageBottom).toBeLessThanOrEqual(sizes.footerTop+1);expect(sizes.height).toBeLessThanOrEqual(568);expect(sizes.settingsOverflow).toBe(true);await dialog.screenshot({path:'test-results/material-preview-light.png'});
});

test('large previews batch drawing and expose only external caps',async({page})=>{
 await page.goto(DEV);
 const result=await page.evaluate(async()=>{
  const {buildMaterialPreview}=await import('/src/materialPreviewGeometry.ts'),{previewAssembly,disposePreview}=await import('/src/materialPreviewSurface.ts');
  const rect=(x:number,y:number,w:number,h:number)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
  const settings={thickness:3,vectorDepth:.2,rasterDepth:.6,openCutDepth:.2},input={cuts:[rect(0,0,500,500)],marks:Array.from({length:2500},(_,i)=>({contours:[{points:rect((i%50)*10+1,Math.floor(i/50)*10+1,4,4),closed:true}],filled:true,evenOdd:true,width:.2,role:'vector' as const,path:`M${(i%50)*10+1},${Math.floor(i/50)*10+1}h4v4h-4z`})),artworkSVG:null};
  const start=performance.now(),model=(await buildMaterialPreview(input,settings))!,root=await previewAssembly(input,model,settings,'acrylic',false),elapsed=performance.now()-start;
  let meshes=0,groups=0,internalCaps=0;root.traverse((object:any)=>{if(!object.isMesh)return;meshes++;groups+=object.geometry.groups.length;const g=object.geometry,pos=g.attributes.position,normal=g.attributes.normal;for(let i=0;i<g.index.count;i++){const vertex=g.index.getX(i);if(normal.getZ(vertex)<-.5&&pos.getZ(vertex)>1e-6)internalCaps++;}});disposePreview(root);
  return {elapsed,meshes,groups,internalCaps};
 });
 expect(result.elapsed).toBeLessThan(5000);expect(result.meshes).toBe(1);expect(result.groups).toBeLessThanOrEqual(3);expect(result.internalCaps).toBe(0);
});

test('thin material remains valid and panning cannot put the camera inside a piece',async({page})=>{
 await seed(page);
 const result=await page.evaluate(async()=>{
  const {MaterialPreview}=await import('/src/materialPreview.ts'),{materialPreviewInput}=await import('/src/materialPreviewInput.ts');
  const trigger=document.querySelector<HTMLButtonElement>('[data-material-preview]')!,preview:any=new MaterialPreview(trigger,()=>materialPreviewInput((window as any).__vectora.objects));await preview.open();
  for(let i=0;i<120&&!preview.root.children.length;i++)await new Promise(resolve=>setTimeout(resolve,25));
  preview.controls.target.set(40,1.5,0);preview.camera.position.set(-21,1.5,0);preview.camera.lookAt(preview.controls.target);preview.clipping();
  const distance=preview.camera.position.distanceTo(preview.camera.position.clone().set(0,1.5,0)),radius=Math.hypot(100,60,3)/2;
  preview.view('back');const backGrid=preview.grid.visible;
  preview.controls.target.set(1000,1.5,0);preview.camera.position.set(0,1.5,0);preview.clipping();preview.view('top');const resetRatio=preview.camera.position.distanceTo(preview.controls.target)/preview.fitDistance();
  preview.dialog.close();await new Promise(resolve=>setTimeout(resolve,0));preview.dialog.remove();return {distance,radius,backGrid,resetRatio};
 });
 expect(result.distance).toBeGreaterThan(result.radius);expect(result.backGrid).toBe(false);expect(result.resetRatio).toBeCloseTo(1,4);
 await page.getByRole('button',{name:'Preview',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Material & process preview'});await expect(dialog.locator('[data-preview-status]')).toContainText('1 piece');await dialog.getByRole('spinbutton',{name:'Thickness (mm)',exact:true}).fill('0.1');await expect(dialog.locator('[data-preview-status]')).toContainText('0.1 mm');await expect(dialog.locator('[data-preview-error]')).toBeHidden();
 await dialog.getByRole('spinbutton',{name:'Thickness (mm)',exact:true}).fill('9');await dialog.getByRole('spinbutton',{name:'Vector engraving depth (mm)',exact:true}).fill('6');await dialog.getByRole('spinbutton',{name:'Thickness (mm)',exact:true}).fill('3');await expect(dialog.locator('[data-preview-status]')).toContainText('3 mm');await expect(dialog.locator('[data-preview-error]')).toBeHidden();
});

test('reference preview and narrow layout share controls, with invalid depths blocking stale builds',async({page})=>{
 await page.goto(DEV+'/reference/design-system.html');await page.getByRole('button',{name:'Open material preview example',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Material & process preview'});await expect(dialog.locator('[data-preview-status]')).toContainText('1 piece');
 await page.setViewportSize({width:390,height:740});const canvas=dialog.locator('canvas');await expect(canvas).toBeVisible();expect((await canvas.boundingBox())!.height).toBeGreaterThan(150);await dialog.getByRole('spinbutton',{name:'Vector engraving depth (mm)',exact:true}).fill('4');await expect(dialog.locator('[data-preview-error]')).toBeVisible();await expect(dialog.getByRole('spinbutton',{name:'Vector engraving depth (mm)',exact:true})).toHaveAttribute('aria-invalid','true');
 await dialog.getByRole('spinbutton',{name:'Vector engraving depth (mm)',exact:true}).fill('0.4');await expect(dialog.locator('[data-preview-error]')).toBeHidden();await expect(dialog.locator('[data-preview-status]')).toContainText('3 mm');await dialog.getByRole('button',{name:'Close preview',exact:true}).click();await expect(page.getByRole('button',{name:'Preview',exact:true})).toBeFocused();
});

// These checks catch gesture remapping regressions and Fit accidentally resetting the viewing angle.
test('reference-style navigation pans with the middle button, Ctrl-drags to zoom and fits without changing angle',async({page})=>{
 await seed(page);
 await page.evaluate(async()=>{
  const {MaterialPreview}=await import('/src/materialPreview.ts'),{materialPreviewInput}=await import('/src/materialPreviewInput.ts');
  const preview:any=new MaterialPreview(document.querySelector('[data-material-preview]')!,()=>materialPreviewInput((window as any).__vectora.objects));
  (window as any).__previewUnderTest=preview;await preview.open();
 });
 const dialog=page.getByRole('dialog',{name:'Material & process preview'}),canvas=dialog.locator('canvas');
 await expect(dialog.locator('[data-preview-status]')).toContainText('1 piece');
 const state=()=>page.evaluate(()=>{const p=(window as any).__previewUnderTest,c=p.camera,t=p.controls.target;return {target:t.toArray(),direction:c.position.clone().sub(t).normalize().toArray(),distance:c.position.distanceTo(t),near:c.near,far:c.far};});
 const drag=async(button:'left'|'middle'|'right')=>{const b=(await canvas.boundingBox())!;await page.mouse.move(b.x+b.width*.5,b.y+b.height*.5);await page.mouse.down({button});await page.mouse.move(b.x+b.width*.58,b.y+b.height*.6,{steps:12});await page.mouse.up({button});await expect.poll(()=>page.evaluate(()=>(window as any).__previewUnderTest.frame)).toBe(0);};
 const initial=await state();await drag('middle');const panned=await state();
 expect(Math.hypot(...panned.target.map((v,i)=>v-initial.target[i]))).toBeGreaterThan(1);
 expect(panned.distance/initial.distance).toBeCloseTo(1,2);
 for(let i=0;i<3;i++)expect(panned.direction[i]).toBeCloseTo(initial.direction[i],2);
 await page.keyboard.down('Control');await drag('left');await page.keyboard.up('Control');const zoomed=await state();
 expect(Math.abs(zoomed.distance-panned.distance)).toBeGreaterThan(1);
 expect(Math.hypot(...zoomed.target.map((v,i)=>v-panned.target[i]))).toBeLessThan(.02); // Below a screen pixel after damping settles.
 await dialog.getByRole('button',{name:'Isometric view',exact:true}).click();await page.waitForTimeout(400);await drag('right');const angled=await state();
 await dialog.getByRole('button',{name:'Fit to model',exact:true}).click();await page.waitForTimeout(400);const fitted=await state();
 expect(fitted.target).toEqual([0,1.5,0]);for(let i=0;i<3;i++)expect(fitted.direction[i]).toBeCloseTo(angled.direction[i],3);
 expect(fitted.near).toBeGreaterThan(0);expect(fitted.far).toBeGreaterThan(fitted.distance);
 await dialog.getByRole('button',{name:'Front view',exact:true}).click();await page.waitForTimeout(400);const front=await state();expect(front.direction[2]).toBeGreaterThan(.99);
 await dialog.getByRole('button',{name:'Left view',exact:true}).click();await page.waitForTimeout(400);expect((await state()).direction[0]).toBeLessThan(-.99);
 await dialog.getByRole('button',{name:'Right view',exact:true}).click();await page.waitForTimeout(400);expect((await state()).direction[0]).toBeGreaterThan(.99);
 await dialog.getByRole('button',{name:'Reset view',exact:true}).click();await page.waitForTimeout(400);expect((await state()).direction[1]).toBeGreaterThan(.99);
 await dialog.getByRole('button',{name:'Close preview',exact:true}).click();
});


test('view transitions are interruptible, settle to idle and honour reduced motion',async({page})=>{
 await seed(page);await page.evaluate(async()=>{
  const {MaterialPreview}=await import('/src/materialPreview.ts'),{materialPreviewInput}=await import('/src/materialPreviewInput.ts');
  const preview:any=new MaterialPreview(document.querySelector('[data-material-preview]')!,()=>materialPreviewInput((window as any).__vectora.objects));
  (window as any).__previewUnderTest=preview;await preview.open();
 });
 const dialog=page.getByRole('dialog',{name:'Material & process preview'}),canvas=dialog.locator('canvas');await expect(dialog.locator('[data-preview-status]')).toContainText('1 piece');
 // Invoke the same button listener synchronously to inspect the start of a genuine transition.
 const transitioning=await dialog.getByRole('button',{name:'Back view',exact:true}).evaluate((button:HTMLButtonElement)=>{button.click();const p=(window as any).__previewUnderTest;return {moving:!!p.cameraMotion,y:p.camera.position.clone().sub(p.controls.target).normalize().y};});
 expect(transitioning.moving).toBe(true);expect(transitioning.y).toBeGreaterThan(.99);
 await canvas.focus();await canvas.press('ArrowDown');await expect.poll(()=>page.evaluate(()=>(window as any).__previewUnderTest.cameraMotion)).toBeNull();await expect(dialog.locator('[data-preview-view]')).toHaveText('Orbit');
 await expect.poll(()=>page.evaluate(()=>(window as any).__previewUnderTest.frame)).toBe(0);
 await page.emulateMedia({reducedMotion:'reduce'});await dialog.getByRole('button',{name:'Back view',exact:true}).click();
 const back=await page.evaluate(()=>{const p=(window as any).__previewUnderTest;return {moving:!!p.cameraMotion,y:p.camera.position.clone().sub(p.controls.target).normalize().y};});
 expect(back.moving).toBe(false);expect(back.y).toBeLessThan(-.99);
 await canvas.focus();await canvas.press('Home');expect(await page.evaluate(()=>(window as any).__previewUnderTest.camera.position.y)).toBeGreaterThan(100);
 await dialog.getByRole('button',{name:'Close preview',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>{const p=(window as any).__previewUnderTest;return {frame:p.frame,moving:!!p.cameraMotion,renderer:!!p.renderer};})).toEqual({frame:0,moving:false,renderer:false});
});


test('resizing during a view transition still reaches the requested view',async({page})=>{
 await seed(page);await page.evaluate(async()=>{
  const {MaterialPreview}=await import('/src/materialPreview.ts'),{materialPreviewInput}=await import('/src/materialPreviewInput.ts');
  const preview:any=new MaterialPreview(document.querySelector('[data-material-preview]')!,()=>materialPreviewInput((window as any).__vectora.objects));
  (window as any).__previewUnderTest=preview;await preview.open();
 });
 const dialog=page.getByRole('dialog',{name:'Material & process preview'});await expect(dialog.locator('[data-preview-status]')).toContainText('1 piece');
 await dialog.getByRole('button',{name:'Back view',exact:true}).evaluate((b:HTMLButtonElement)=>{b.click();});
 await page.setViewportSize({width:1000,height:700});
 await expect.poll(()=>page.evaluate(()=>{const p=(window as any).__previewUnderTest;return p.camera.position.clone().sub(p.controls.target).normalize().y;})).toBeLessThan(-.99);
 await expect(dialog.locator('[data-preview-view]')).toHaveText('Back');
 await dialog.getByRole('button',{name:'Close preview',exact:true}).click();
});

test('continuing an existing drag interrupts a keyboard-started fit transition',async({page})=>{
 await seed(page);await page.evaluate(async()=>{
  const {MaterialPreview}=await import('/src/materialPreview.ts'),{materialPreviewInput}=await import('/src/materialPreviewInput.ts');
  const preview:any=new MaterialPreview(document.querySelector('[data-material-preview]')!,()=>materialPreviewInput((window as any).__vectora.objects));
  (window as any).__previewUnderTest=preview;await preview.open();
 });
 const dialog=page.getByRole('dialog',{name:'Material & process preview'}),canvas=dialog.locator('canvas');await expect(dialog.locator('[data-preview-status]')).toContainText('1 piece');
 const b=(await canvas.boundingBox())!;await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();
 // Both inputs happen in the same task, before the animation can finish on its own.
 const moving=await canvas.evaluate(el=>{
  el.dispatchEvent(new KeyboardEvent('keydown',{key:'f',bubbles:true,cancelable:true}));
  el.dispatchEvent(new PointerEvent('pointermove',{pointerId:999,pointerType:'mouse',buttons:1,clientX:100,clientY:100,bubbles:true}));
  return !!(window as any).__previewUnderTest.cameraMotion;
 });
 expect(moving).toBe(false);await page.mouse.up();
 await dialog.getByRole('button',{name:'Close preview',exact:true}).click();
});

// Raycast only the opaque top face: dark grid pixels there indicate depth-buffer bleed, not a hole or edge.
test('the grid stays behind large thin pieces when zoomed in',async({page})=>{
 await page.goto(DEV);
 const result=await page.evaluate(async()=>{
  const {MaterialPreview}=await import('/src/materialPreview.ts'),THREE=await import('/node_modules/three/build/three.module.js');
  const rect=(x:number,y:number,w:number,h:number)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
  const input={cuts:[rect(0,0,2000,1200)],marks:[],artworkSVG:null};
  const preview:any=new MaterialPreview(document.querySelector('[data-material-preview]')!,async()=>input);await preview.open();
  for(let i=0;i<120&&!preview.root.children.length;i++)await new Promise(r=>setTimeout(r,25));
  preview.material='mdf';await preview.rebuildSurface();preview.view('iso');
  const offset=preview.camera.position.clone().sub(preview.controls.target).setLength(Math.hypot(2000,1200,3)/2*1.06);
  preview.camera.position.copy(preview.controls.target).add(offset);preview.controls.update();preview.clipping();
  preview.renderer.render(preview.scene,preview.camera);
  const size=preview.renderer.getDrawingBufferSize(new THREE.Vector2()),gl=preview.renderer.getContext(),pixels=new Uint8Array(size.x*size.y*4);
  gl.readPixels(0,0,size.x,size.y,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  const ray=new THREE.Raycaster();let tops=0,gridPixels=0;
  for(let y=8;y<size.y-8;y+=7)for(let x=8;x<size.x-8;x+=7){
   ray.setFromCamera(new THREE.Vector2((x+.5)/size.x*2-1,(y+.5)/size.y*2-1),preview.camera);
   const hit=ray.intersectObject(preview.root,true)[0];
   if(!hit||hit.face?.materialIndex!==0||Math.abs(hit.point.y-3)>.001||Math.abs(hit.point.x)>990||Math.abs(hit.point.z)>590)continue;
   tops++;const i=(y*size.x+x)*4;if(Math.max(pixels[i],pixels[i+1],pixels[i+2])<130)gridPixels++;
  }
  const near=preview.camera.near,far=preview.camera.far;preview.dialog.close();await new Promise(r=>setTimeout(r,0));preview.dialog.remove();
  return {tops,gridPixels,near,far};
 });
 expect(result.tops).toBeGreaterThan(1000);expect(result.gridPixels).toBe(0);
});
