import {test,expect} from '@playwright/test';
const DEV='http://127.0.0.1:5174';
async function open(page:any,family='gear') {await page.locator('[data-generator-trigger]').click();await page.locator(`[data-generator="${family}"]`).click();const dialog=page.locator('#generator-dialog');await expect(dialog).toBeVisible();return dialog;}

test('Every mechanical profile produces finite closed outlines, valid bores and useful physical dimensions',async({page})=>{
 await page.goto(DEV);
 const results=await page.evaluate(async()=>{
  const {CATALOG,defaults}=await import('/src/generators/catalog.ts'),{generate}=await import('/src/generators/geometry.ts'),{generatedShapes}=await import('/src/generators/paperShapes.ts'),p=(window as any).__paper;
  return Object.entries(CATALOG).flatMap(([family,catalog]:any)=>catalog.profiles.map((profile:any)=>{
   const result=generate(family as any,profile.id,defaults(profile)),shapes=generatedShapes(result,new p.Point(0,0));
   return {id:profile.id,metrics:result.metrics,bounds:result.bounds,parts:result.parts.length,closed:shapes.every(({shape}:any)=>(shape.children??[shape]).every((path:any)=>path.closed)),curves:shapes.flatMap(({shape}:any)=>(shape.children??[shape]).map((path:any)=>path.curves.length)),finite:result.parts.every((part:any)=>part.contours.every((c:any)=>c.points?c.points.every((point:number[])=>point.every(Number.isFinite)):Number.isFinite(c.radius))),intersections:shapes.flatMap(({shape}:any)=>(shape.children??[shape]).map((path:any)=>path.getCrossings(path).length))};
  }));
 });
 expect(results).toHaveLength(14);
 for(const result of results){expect(result.finite,result.id).toBe(true);expect(result.closed,result.id).toBe(true);expect(result.bounds.width,result.id).toBeGreaterThan(0);expect(result.intersections,result.id).toEqual(result.intersections.map(()=>0));}
 const spur=results.find(r=>r.id==='spur')!;expect(spur.metrics['Pitch diameter']).toBe('48 mm');expect(spur.metrics['Outside diameter']).toBe('52 mm');expect(spur.metrics['Root diameter']).toBe('43 mm');expect(spur.curves).toContain(4);
 expect(results.find(r=>r.id==='rack')!.parts).toBe(2);
 expect(parseFloat(results.find(r=>r.id==='helical')!.metrics['Pitch diameter'])).toBeCloseTo(48/Math.cos(20*Math.PI/180),2);
 expect(results.find(r=>r.id==='nut')!.bounds.height).toBeCloseTo(13,6);
});

test('Engineering relations and invalid combinations are enforced without mutating a drawing',async({page})=>{
 await page.goto(DEV);
 const data=await page.evaluate(async()=>{
  const {CATALOG,defaults}=await import('/src/generators/catalog.ts'),{generate}=await import('/src/generators/geometry.ts');
  const run=(family:any,id:string,changes:any={})=>generate(family,id,{...defaults(CATALOG[family as keyof typeof CATALOG].profiles.find(p=>p.id===id)!),...changes});
  const invalid=[['gear','spur',{teeth:24.5}],['gear','spur',{bore:500}],['gear','spur',{module:NaN}],['drive','sprocket',{roller:30}],['drive','round',{width:30}],['drive','trapezoid',{depth:10}],['fastener','thread',{depth:4}],['fastener','washer',{bore:30}],['fastener','bolt',{across:2}],['cam','cycloidal',{rise:200,return:200}],['cam','cycloidal',{roller:50,base:1,rise:20,return:20}]].map(([f,id,c])=>{try{run(f,id as string,c);return false;}catch{return true;}});
  const drive=run('drive','sprocket'),cam=run('cam','cycloidal'),roller=run('cam','polynomial',{roller:3});
  const camPoints=(cam.parts[0].contours[0] as any).points as number[][];
  const radii=camPoints.map(p=>Math.hypot(...p));
  const start=performance.now();run('gear','spur',{teeth:160,module:20});run('fastener','thread',{length:400,pitch:1,depth:.5});const elapsed=performance.now()-start;
  return {invalid,drive:drive.metrics,camMin:Math.min(...radii),camMax:Math.max(...radii),roller:roller.metrics,elapsed};
 });
 expect(data.invalid).toEqual(data.invalid.map(()=>true));expect(parseFloat(data.drive['Pitch diameter'])).toBeCloseTo(12.7/Math.sin(Math.PI/20),2);expect(data.camMin).toBeCloseTo(20,6);expect(data.camMax).toBeCloseTo(30,6);expect(data.roller.Follower).toBe('Roller');expect(data.elapsed).toBeLessThan(500);
});

test('Live preview switches variants, blocks stale/invalid insertions, resets and cancels without edits',async({page})=>{
 await page.goto(DEV);const dialog=await open(page);
 await expect(dialog.locator('[data-insert]')).toBeEnabled();await dialog.getByLabel('Teeth',{exact:true}).fill('32');await expect(dialog.locator('.generator-metrics')).toContainText('64 mm');
 await dialog.getByLabel('Bore diameter',{exact:true}).fill('500');await expect(dialog.locator('[data-insert]')).toBeDisabled();await expect(dialog.locator('.generator-feedback')).toContainText('bore must fit');await expect(dialog.locator('.generator-svg path')).toHaveCount(0);
 await dialog.getByRole('button',{name:'Reset parameters'}).click();await expect(dialog.getByLabel('Teeth',{exact:true})).toHaveValue('24');await expect(dialog.locator('[data-insert]')).toBeEnabled();
 for(const id of ['helical','bevel','rack']){await dialog.getByLabel('Profile',{exact:true}).selectOption(id);await expect(dialog.locator('[data-insert]')).toBeEnabled();}
 await dialog.getByLabel('Guides',{exact:true}).uncheck();await expect(dialog.locator('.generator-guides')).toHaveClass(/is-hidden/);
 await page.keyboard.press('Control+z');expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(0);
 await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(page.locator('[data-generator-trigger]')).toBeFocused();expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(0);
});

test('Insertion uses the active layer, centred exact geometry and one undo for rack and pinion, with save/export support',async({page})=>{
 await page.goto(DEV);await page.getByRole('button',{name:'Layers',exact:true}).click();await page.locator('[data-layer-id="cutline"] [data-layer-action="select"]').click();
 const dialog=await open(page);await dialog.getByLabel('Profile',{exact:true}).selectOption('rack');await dialog.getByRole('button',{name:'Insert paths'}).click();await expect(dialog).toBeHidden();
 const data=await page.evaluate(async()=>{
  const e=(window as any).__vectora,p=(window as any).__paper,{exportSVG}=await import('/src/exportSVG.ts'),{exportDXF}=await import('/src/exportDXF.ts');
  const entries=e.selection.map((s:any)=>({role:s.data.role,colour:s.strokeColor.toCSS(true),fill:s.fillColor,name:s.data.name}));const bounds=e.selection.reduce((b:any,s:any)=>b?b.unite(s.bounds):s.bounds,null);const center=bounds.center.getDistance(p.view.center);
  const {encodeDocument,decodeDocument}=await import('/src/documentFormat.ts');const saved=encodeDocument(e);const svg=exportSVG(e.objects);const dxf=exportDXF(e.objects,false);e.undo();const undone=e.objects.length;e.redo();const restored=e.objects.length;const decoded=await decodeDocument(saved);e.loadDocument(decoded.snapshot,decoded.view);const loaded=e.objects.length;
  return {entries,center,svg,dxf,undone,restored,loaded,props:!document.querySelector('#properties-panel')?.hasAttribute('hidden')};
 });
 expect(data.entries).toHaveLength(2);for(const item of data.entries)expect(item).toMatchObject({role:'cutline',colour:'#ff0000',fill:null});expect(data.center).toBeLessThan(.001);expect(data.undone).toBe(0);expect(data.restored).toBe(2);expect(data.loaded).toBe(2);expect(data.svg).toContain('<path');expect(data.dxf).toContain('LWPOLYLINE');expect(data.props).toBe(false);
});

test('Hidden or locked active layers disable insertion; all families fit narrow screens in both themes',async({page})=>{
 await page.goto(DEV);await page.evaluate(()=>{const e=(window as any).__vectora;e.activeLayer.locked=true;});let dialog=await open(page);await expect(dialog.locator('[data-insert]')).toBeDisabled();await expect(dialog.locator('.generator-feedback')).toContainText('unlock');await page.keyboard.press('Escape');
 await page.evaluate(()=>{(window as any).__vectora.activeLayer.locked=false;});
 for(const family of ['drive','fastener','cam']){
  dialog=await open(page,family);await expect(dialog.locator('[data-insert]')).toBeEnabled();
  const ids=await dialog.locator('[data-profile] option').evaluateAll(options=>options.map(o=>(o as HTMLOptionElement).value));
  for(const id of ids){await dialog.getByLabel('Profile',{exact:true}).selectOption(id);await expect(dialog.locator('[data-insert]')).toBeEnabled();}
  await page.screenshot({path:`test-results/generator-${family}.png`,scale:'css'});await page.keyboard.press('Escape');
 }
 dialog=await open(page);for(const theme of ['dark','light'])for(const size of [{width:1280,height:700},{width:390,height:740}]){
  await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.setViewportSize(size);
  const bounds=await dialog.evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,wide:el.scrollWidth>el.clientWidth};});expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.right).toBeLessThanOrEqual(size.width);expect(bounds.bottom).toBeLessThanOrEqual(size.height);expect(bounds.wide).toBe(false);await expect(dialog.locator('[data-insert]')).toBeInViewport();
 }
 await page.screenshot({path:'test-results/generator-mobile-light.png',scale:'css'});
});

test('Production and design reference share the workbench and generators appear in tool search',async({page})=>{
 for(const url of ['http://127.0.0.1:4173',DEV+'/reference/design-system.html']){
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);const dialog=await open(page);await expect(dialog.locator('.generator-metrics')).toContainText('48 mm');expect(errors).toEqual([]);await page.keyboard.press('Escape');
 }
 await page.goto(DEV);await page.locator('[data-tool-search]').click();await page.locator('#tool-search-dialog input').fill('sprocket');await page.locator('.tool-search-result').first().click();await expect(page.locator('#generator-dialog')).toBeVisible();await expect(page.locator('#generator-title')).toHaveText('Sprocket & timing pulley');
});
