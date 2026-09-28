import {test,expect,Page} from '@playwright/test';
const DEV='http://127.0.0.1:5174';
async function open(page:Page,family:string){await page.locator('[data-generator-trigger]').click();await page.locator(`[data-generator="${family}"]`).click();const dialog=page.locator('#generator-dialog');await expect(dialog).toBeVisible();return dialog;}

test('All structural defaults have finite, non-crossing contours with correct open/closed operation types',async({page})=>{
 await page.goto(DEV);
 const data=await page.evaluate(async()=>{
  const {STRUCTURAL_CATALOG}=await import('/src/generators/structuralCatalog.ts'),{defaults}=await import('/src/generators/catalog.ts'),{generate}=await import('/src/generators/geometry.ts'),{generatedShapes}=await import('/src/generators/paperShapes.ts'),p=(window as any).__paper;
  return Object.entries(STRUCTURAL_CATALOG).flatMap(([family,catalog])=>catalog.profiles.map(profile=>{
   try{const r=generate(family as any,profile.id,defaults(profile)),shapes=generatedShapes(r,new p.Point(0,0)),paths=shapes.flatMap(({shape})=>shape instanceof p.CompoundPath?shape.children:[shape]);
    return {id:profile.id,parts:r.parts.length,closed:paths.filter((path:any)=>path.closed).length,open:paths.filter((path:any)=>!path.closed).length,crossings:paths.map((path:any)=>path.getCrossings(path).length),finite:r.parts.every(part=>part.contours.every(c=>'points'in c?c.points.every(pt=>pt.every(Number.isFinite)):Number.isFinite(c.radius))),metrics:r.metrics,bounds:r.bounds,error:''};
   }catch(error){return {id:profile.id,error:(error as Error).message};}
  }));
 });
 expect(data).toHaveLength(14);
 for(const r of data){expect(r.error,r.id).toBe('');expect(r.finite,r.id).toBe(true);expect(r.crossings,r.id).toEqual(r.crossings!.map(()=>0));}
 expect(data.find(r=>r.id==='finger-box')!.parts).toBe(6);expect(data.find(r=>r.id==='open-box')!.parts).toBe(5);
 expect(data.find(r=>r.id==='hinge-vertical')!.open).toBeGreaterThan(20);expect(data.find(r=>r.id==='hinge-slots')!.open).toBe(0);
 for(const id of ['tuck-carton','shipping-carton','glue-tray'])expect(data.find(r=>r.id===id)!.open).toBeGreaterThan(5);
 expect(data.find(r=>r.id==='frame-grid')!.closed).toBe(13);
});

test('Box panels tile the assembled material shell exactly, including all three-way corners',async({page})=>{
 await page.goto(DEV);
 const results=await page.evaluate(async()=>{
  const {CATALOG,defaults}=await import('/src/generators/catalog.ts'),{generate}=await import('/src/generators/geometry.ts'),p=(window as any).__paper;
  return ['finger-box','open-box'].map(id=>{
   const params={...defaults(CATALOG.box.profiles.find(p=>p.id===id)!),fit:0},r=generate('box',id,params),w=120,d=80,h=60,t=3,g=8,offsets=[[0,0],[w+g,0],[0,h+g],[d+g,h+g],[0,2*(h+g)],[w+g,2*(h+g)]];
   const panels=r.parts.map((part,i)=>new p.Path({insert:false,closed:true,segments:(part.contours[0] as any).points.map(([x,y]:number[])=>[x-offsets[i][0],y-offsets[i][1]])}));
   const values=(list:number[])=>{const sorted=[...new Set(list.map(x=>Number(x.toFixed(7))))].sort((a,b)=>a-b);return sorted.slice(1).map((v,i)=>(v+sorted[i])/2);};
   const xs=values([0,t,w-t,w,...panels[0].segments.map((s:any)=>s.point.x),...panels[4].segments.map((s:any)=>s.point.x)]),ys=values([0,t,d-t,d,...panels[2].segments.map((s:any)=>s.point.x),...panels[4].segments.map((s:any)=>s.point.y)]),zs=values([0,t,h-t,h,...panels[0].segments.map((s:any)=>s.point.y),...panels[2].segments.map((s:any)=>s.point.y)]);
   let overlaps=0,gaps=0,checks=0;for(const x of xs)for(const y of ys)for(const z of zs){const occupied=[y<t&&panels[0].contains([x,h-z]),y>d-t&&panels[1].contains([x,h-z]),x<t&&panels[2].contains([y,h-z]),x>w-t&&panels[3].contains([y,h-z]),z<t&&panels[4].contains([x,y]),id==='finger-box'&&z>h-t&&panels[5].contains([x,y])].filter(Boolean).length;const shell=x<t||x>w-t||y<t||y>d-t||z<t||(id==='finger-box'&&z>h-t);if(occupied>1)overlaps++;if(shell&&!occupied)gaps++;checks++;}
   return {id,overlaps,gaps,checks};
  });
 });
 for(const r of results){expect(r.checks).toBeGreaterThan(500);expect(r.overlaps,r.id).toBe(0);expect(r.gaps,r.id).toBe(0);}
});

test('Dimension changes update slots, hinge bounds and connected framework openings; invalid combinations stay bounded',async({page})=>{
 await page.goto(DEV);
 const result=await page.evaluate(async()=>{
  const {CATALOG,defaults}=await import('/src/generators/catalog.ts'),{generate}=await import('/src/generators/geometry.ts');
  const run=(family:any,id:string,v:any={})=>generate(family,id,{...defaults(CATALOG[family as keyof typeof CATALOG].profiles.find(p=>p.id===id)!),...v});
  const invalid:[string,string,any][]=[['box','finger-box',{thickness:30}],['box','finger-box',{width:2000,finger:1,thickness:.5}],['box','tab-slot',{tab:80,count:8}],['box','t-slot',{count:3}],['box','t-slot',{nut:3,bolt:6}],['box','t-slot',{depth:10,thickness:.5,bolt:12,nut:14,nutHeight:2}],['hinge','hinge-vertical',{kerf:3}],['hinge','hinge-slots',{slotWidth:5}],['hinge','hinge-horizontal',{width:2000,height:2000,spacing:.3,kerf:0,length:1,bridge:.3}],['packaging','shipping-carton',{width:30,depth:60,glue:5}],['packaging','tuck-carton',{tuck:80}],['framework','pratt',{bays:7}],['framework','warren',{member:25}],['framework','frame-grid',{columns:30,member:10}],['framework','frame-grid',{rows:NaN}]];
  const failures=invalid.map(([f,id,v])=>{try{run(f,id,v);return '';}catch(e){return(e as Error).message;}});
  const slot=run('box','tab-slot',{thickness:4,fit:.2}),hinge=run('hinge','hinge-slots',{slotWidth:1.2}),r=hinge.parts[0].contours.slice(1).flatMap(c=>'points'in c?c.points:[]);
  const start=performance.now();const dense=run('hinge','hinge-vertical',{width:250,height:250,spacing:2,length:18});const elapsed=performance.now()-start;
  return {failures,slot:slot.metrics,minX:Math.min(...r.map(p=>p[0])),minY:Math.min(...r.map(p=>p[1])),maxX:Math.max(...r.map(p=>p[0])),maxY:Math.max(...r.map(p=>p[1])),dense:dense.parts[0].contours.length,elapsed};
 });
 for(const failure of result.failures)expect(failure).not.toBe('');expect(result.slot['Receiver slots']).toBe('12.20 × 4.20 mm');expect(result.minX).toBeGreaterThanOrEqual(6);expect(result.minY).toBeGreaterThanOrEqual(6);expect(result.maxX).toBeLessThanOrEqual(114);expect(result.maxY).toBeLessThanOrEqual(54);expect(result.dense).toBeGreaterThan(1000);expect(result.elapsed).toBeLessThan(400);
});

test('Packaging inserts cut and fold operations atomically, with correct colours, export and document round-trip',async({page})=>{
 await page.goto(DEV);await page.evaluate(()=>(window as any).__vectora.setActiveLayer('cutline'));const dialog=await open(page,'packaging');
 await expect(dialog.locator('.generator-legend')).toBeVisible();await dialog.getByLabel('Guides',{exact:true}).uncheck();await expect(dialog.locator('.generator-folds')).toBeVisible();
 await dialog.getByRole('button',{name:'Insert paths'}).click();
 const r=await page.evaluate(async()=>{
  const e=(window as any).__vectora,{exportSVG}=await import('/src/exportSVG.ts'),{exportDXF}=await import('/src/exportDXF.ts'),{encodeDocument,decodeDocument}=await import('/src/documentFormat.ts');
  const shapes=e.selectedItems.map((item:any)=>({name:item.data.name,role:item.data.role,color:item.strokeColor.toCSS(true),closed:(item.children??[item]).map((p:any)=>p.closed)})),svg=exportSVG(e.objects),dxf=exportDXF(e.objects),saved=encodeDocument(e);e.undo();const undo=e.objects.length;e.redo();const redo=e.objects.length;const restored=await decodeDocument(saved);e.loadDocument(restored.snapshot,restored.view);
  return {shapes,svg,dxf,undo,redo,loaded:e.objects.length,props:document.querySelector('#properties-panel')!.hasAttribute('hidden')};
 });
 expect(r.shapes).toHaveLength(2);expect(r.shapes[0]).toMatchObject({role:'cutline',color:'#ff0000',closed:[true]});expect(r.shapes[1].role).toBe('engrave');expect(r.shapes[1].color).toBe('#0000ff');expect(r.shapes[1].closed.every((closed:boolean)=>!closed)).toBe(true);expect(r.svg).toContain('#0000ff');expect(r.dxf).toContain('ENGRAVE');expect(r.dxf).toContain('CUTLINE');expect(r.undo).toBe(0);expect(r.redo).toBe(2);expect(r.loaded).toBe(2);expect(r.props).toBe(true);
});

test('Locked fold destination blocks the whole insert; all variants preview and cancel without changing the drawing',async({page})=>{
 await page.goto(DEV);await page.evaluate(()=>{const e=(window as any).__vectora;e.setActiveLayer('cutline');e.documentLayers.find((l:any)=>l.data.objectRole==='engrave').locked=true;});let dialog=await open(page,'packaging');await expect(dialog.locator('[data-insert]')).toBeDisabled();await expect(dialog.locator('.generator-feedback')).toContainText('unlock Engrave');await page.keyboard.press('Escape');
 const count=await page.evaluate(async()=>{const e=(window as any).__vectora,p=(window as any).__paper;try{e.addGeneratedShapes([{shape:new p.Path.Rectangle({insert:false,rectangle:[0,0,10,10]}),name:'Cut'},{shape:new p.Path({insert:false,segments:[[0,0],[5,5]]}),name:'Fold',operation:'engrave'}]);}catch{}e.documentLayers.find((l:any)=>l.data.objectRole==='engrave').locked=false;return e.objects.length;});expect(count).toBe(0);
 for(const family of ['box','hinge','packaging','framework']){
  dialog=await open(page,family);const ids=await dialog.locator('[data-profile] option').evaluateAll(options=>options.map(o=>(o as HTMLOptionElement).value));
  for(const id of ids){await dialog.getByLabel('Profile',{exact:true}).selectOption(id);await expect(dialog.locator('[data-insert]'),id).toBeEnabled();await page.screenshot({path:`test-results/structural-${id}.png`,scale:'css'});}
  await page.keyboard.press('Escape');
 }
 expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(0);
});

test('Expanded menu and workbench fit short/narrow windows, use shared icons, and work in production and reference',async({page})=>{
 for(const url of ['http://127.0.0.1:4173',DEV+'/reference/design-system.html']){
  await page.goto(url);const dialog=await open(page,'box');await expect(dialog.locator('.generator-metrics')).toContainText('Panels');await page.keyboard.press('Escape');
 }
 await page.goto(DEV);await page.setViewportSize({width:390,height:550});await page.locator('[data-generator-trigger]').click();const menu=page.locator('#primary-generators-menu');await expect(menu.locator('[data-generator]')).toHaveCount(13);
 await menu.locator('[data-generator="gear"]').focus();await page.keyboard.press('End');await expect(menu.locator('[data-generator="waveform"]')).toBeFocused();await expect(menu.locator('[data-generator="waveform"]')).toBeInViewport();await page.keyboard.press('Enter');const dialog=page.locator('#generator-dialog');await expect(dialog).toBeVisible();
 for(const theme of ['light','dark']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);const r=(await dialog.boundingBox())!;expect(r.x).toBeGreaterThanOrEqual(0);expect(r.y).toBeGreaterThanOrEqual(0);expect(r.x+r.width).toBeLessThanOrEqual(390);expect(r.y+r.height).toBeLessThanOrEqual(550);await expect(dialog.locator('[data-insert]')).toBeInViewport();await page.screenshot({path:`test-results/structural-mobile-${theme}.png`,scale:'css'});}
 await page.keyboard.press('Escape');await page.setViewportSize({width:1280,height:900});await page.locator('[data-tool-search]').click();await page.locator('#tool-search-dialog input').fill('living hinge');await page.locator('.tool-search-result').first().click();await expect(page.locator('#generator-title')).toHaveText('Flexure & living hinge');
 const missing=await page.evaluate(()=>[...document.querySelectorAll('[data-generator] use')].map(use=>use.getAttribute('href')!).filter(id=>!document.querySelector(id)));expect(missing).toEqual([]);
});
