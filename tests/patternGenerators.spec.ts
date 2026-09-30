import {test,expect,Page} from './fixtures';
const DEV='http://127.0.0.1:5174';
async function open(page:Page,family:string){await page.locator('[data-generator-trigger]').click();await page.locator(`[data-generator="${family}"]`).click();const d=page.locator('#generator-dialog');await expect(d).toBeVisible();return d;}
// These tests catch leaking cell cut-outs, non-repeatable seeds, incorrect curve periods,
// disconnected mazes, image-tone reversal/overlapping holes, and intersecting wave strips.
test('Voronoi cut-outs stay within their border and leave the requested web',async({page})=>{
 await page.goto(DEV);const r=await page.evaluate(async()=>{
  const {CATALOG,defaults}=await import('/src/generators/catalog.ts'),{generate}=await import('/src/generators/geometry.ts');const c=(CATALOG as any).voronoi;if(!c)return null;
  const v={...defaults(c.profiles[0]),count:25,width:100,height:80,border:5,web:2};const a=generate('voronoi' as any,c.profiles[0].id,v),b=generate('voronoi' as any,c.profiles[0].id,v),other=generate('voronoi' as any,c.profiles[0].id,{...v,seed:987});const p=(window as any).__paper;
  const holes=a.parts[0].contours.slice(1).map((c:any)=>new p.Path({insert:false,closed:true,segments:c.points}));let min=Infinity,crossings=0;
  for(let i=0;i<holes.length;i++)for(let j=i+1;j<holes.length;j++){crossings+=holes[i].getIntersections(holes[j]).length;for(const s of holes[i].segments)min=Math.min(min,s.point.getDistance(holes[j].getNearestPoint(s.point)));for(const s of holes[j].segments)min=Math.min(min,s.point.getDistance(holes[i].getNearestPoint(s.point)));}
  return {count:holes.length,repeat:JSON.stringify(a)===JSON.stringify(b),different:JSON.stringify(a)!==JSON.stringify(other),min,crossings,bounds:holes.every((h:any)=>h.bounds.left>=5-1e-6&&h.bounds.top>=5-1e-6&&h.bounds.right<=95+1e-6&&h.bounds.bottom<=75+1e-6)};
 });expect(r).not.toBeNull();expect(r!.count).toBeGreaterThan(10);expect(r!.repeat).toBe(true);expect(r!.different).toBe(true);expect(r!.bounds).toBe(true);expect(r!.crossings).toBe(0);expect(r!.min).toBeGreaterThanOrEqual(2-1e-5);
});

test('Spirograph periods close correctly and cycloid repetitions retain their open endpoints',async({page})=>{
 await page.goto(DEV);const r=await page.evaluate(async()=>{
  const {CATALOG,defaults}=await import('/src/generators/catalog.ts'),{generate}=await import('/src/generators/geometry.ts');const c=(CATALOG as any).spirograph;if(!c)return null;
  const run=(id:string,v:any)=>generate('spirograph' as any,id,{...defaults(c.profiles.find((p:any)=>p.id===id)),...v});
  const closed=run('hypotrochoid',{fixed:45,rolling:18,offset:12,turns:2}),open=run('hypotrochoid',{fixed:45,rolling:18,offset:12,turns:1}),cycloid=run('cycloid',{rolling:8,offset:8,turns:3});
  return {closed:closed.parts[0].contours[0],open:open.parts[0].contours[0],cycloid:cycloid.parts[0].contours[0]};
 });expect(r).not.toBeNull();expect((r!.closed as any).closed).toBe(true);expect((r!.open as any).closed).toBe(false);const c=r!.cycloid as any;expect(c.closed).toBe(false);expect(c.points[0]).toEqual([0,0]);expect(c.points.at(-1)[0]).toBeCloseTo(48*Math.PI,5);expect(c.points.at(-1)[1]).toBeCloseTo(0,6);
});

test('Seeded rectangular mazes connect every cell without loops; circular labyrinths are single non-crossing paths',async({page})=>{
 await page.goto(DEV);const r=await page.evaluate(async()=>{
  const {CATALOG,defaults}=await import('/src/generators/catalog.ts'),{generate}=await import('/src/generators/geometry.ts');const cat=(CATALOG as any).maze;if(!cat)return null;
  const v={...defaults(cat.profiles[0]),width:40,height:30,columns:4,rows:3},result=generate('maze' as any,'maze-lines',v),walls=result.parts.flatMap(p=>p.contours).filter((c:any)=>c.points),p=(window as any).__paper;
  const paths=walls.map((c:any)=>new p.Path({insert:false,segments:c.points,closed:c.closed})),edges:number[][]=[];
  for(let y=0;y<3;y++)for(let x=0;x<4;x++)for(const [dx,dy] of [[1,0],[0,1]])if(x+dx<4&&y+dy<3){const path=new p.Path({insert:false,segments:[[x*10+5,y*10+5],[(x+dx)*10+5,(y+dy)*10+5]]});if(!paths.some((w:any)=>path.getIntersections(w).length))edges.push([y*4+x,(y+dy)*4+x+dx]);}
  const seen=new Set([0]);let more=true;while(more){more=false;for(const [a,b] of edges)if(seen.has(a)!==seen.has(b)){seen.add(a);seen.add(b);more=true;}}
  const profile=cat.profiles.find((p:any)=>p.id==='labyrinth'),lab=generate('maze' as any,'labyrinth',defaults(profile)),line=lab.parts[0].contours[0] as any,path=new p.Path({insert:false,segments:line.points,closed:line.closed});
  return {edges:edges.length,seen:seen.size,repeat:JSON.stringify(result)===JSON.stringify(generate('maze' as any,'maze-lines',v)),closed:line.closed,crossings:path.getCrossings(path).length};
 });expect(r).not.toBeNull();expect(r).toMatchObject({edges:11,seen:12,repeat:true,closed:false,crossings:0});
});

test('Image holes follow tone, invert safely and preserve spacing and transparent areas',async({page})=>{
 await page.goto(DEV);const r=await page.evaluate(async()=>{
  const {CATALOG,defaults}=await import('/src/generators/catalog.ts'),{generate}=await import('/src/generators/geometry.ts');const cat=(CATALOG as any).halftone;if(!cat)return null;
  const data=new Uint8ClampedArray(16*8*4);for(let y=0;y<8;y++)for(let x=0;x<16;x++){const i=(y*16+x)*4;data[i]=data[i+1]=data[i+2]=x<8?0:255;data[i+3]=255;}
  const image={width:16,height:8,data},v={...defaults(cat.profiles[0]),width:100,height:50,border:5,spacing:4,maxDiameter:3,gap:.8};
  const run=(id:string,extra:any={},source=image)=>(generate as any)('halftone',id,{...v,...extra},source);const a=run('halftone-square'),b=run('halftone-square',{invert:1}),stipple=run('stipple');
  const holes=(r:any)=>r.parts[0].contours.filter((c:any)=>'radius'in c),ha=holes(a),hb=holes(b),hs=holes(stipple);let min=Infinity;
  for(let i=0;i<hs.length;i++)for(let j=i+1;j<hs.length;j++)min=Math.min(min,Math.hypot(hs[i].center[0]-hs[j].center[0],hs[i].center[1]-hs[j].center[1])-hs[i].radius-hs[j].radius);
  const transparent=run('halftone-square',{invert:1},{width:16,height:8,data:new Uint8ClampedArray(data.length)});return {left:ha.filter((c:any)=>c.center[0]<40).length,right:ha.filter((c:any)=>c.center[0]>60).length,inverted:hb.filter((c:any)=>c.center[0]>60).length,min,transparent:holes(transparent).length};
 });expect(r).not.toBeNull();expect(r!.left).toBeGreaterThan(20);expect(r!.right).toBe(0);expect(r!.inverted).toBeGreaterThan(20);expect(r!.min).toBeGreaterThanOrEqual(.8-1e-6);expect(r!.transparent).toBe(0);
});

test('Noise and sine panels have bounded non-overlapping strips and reproducible seeds',async({page})=>{
 await page.goto(DEV);const r=await page.evaluate(async()=>{
  const {CATALOG,defaults}=await import('/src/generators/catalog.ts'),{generate}=await import('/src/generators/geometry.ts');const cat=(CATALOG as any).waveform;if(!cat)return null;const p=(window as any).__paper;
  return cat.profiles.map((profile:any)=>{const v=defaults(profile),r=generate('waveform' as any,profile.id,v),paths=r.parts[0].contours.slice(1).map((c:any)=>new p.Path({insert:false,segments:c.points,closed:c.closed}));let crossing=0;for(let i=0;i<paths.length;i++){crossing+=paths[i].getCrossings(paths[i]).length;for(let j=i+1;j<paths.length;j++)crossing+=paths[i].getIntersections(paths[j]).length;}return {id:profile.id,crossing,repeat:JSON.stringify(r)===JSON.stringify(generate('waveform' as any,profile.id,v)),inside:paths.every((p:any)=>p.bounds.left>=5-1e-5&&p.bounds.right<=115+1e-5&&p.bounds.top>=5&&p.bounds.bottom<=85)};});
 });expect(r).not.toBeNull();for(const p of r!){expect(p.crossing,p.id).toBe(0);expect(p.repeat).toBe(true);expect(p.inside).toBe(true);}
});

test('Pattern menus and image controls support local loading, replacement errors, insertion and undo',async({page})=>{
 await page.goto(DEV);await page.locator('[data-generator-trigger]').click();await expect(page.locator('[data-generator="halftone"]')).toHaveCount(1);await page.locator('[data-generator="halftone"]').click();const d=page.locator('#generator-dialog');await expect(d.locator('[data-insert]')).toBeDisabled();
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=16;c.height=8;const ctx=c.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,16,8);ctx.fillStyle='black';ctx.fillRect(0,0,8,8);return c.toDataURL().split(',')[1];});
 await d.locator('[data-pattern-file]').setInputFiles({name:'tone.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await expect(d.locator('[data-insert]')).toBeEnabled();await expect(d.locator('.generator-svg circle')).not.toHaveCount(0);
 await d.locator('[data-pattern-file]').setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('invalid')});await expect(d.locator('[data-insert]')).toBeDisabled();await expect(d.locator('.generator-svg circle')).toHaveCount(0);
 await d.locator('[data-pattern-file]').setInputFiles({name:'tone.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await expect(d.locator('[data-insert]')).toBeEnabled();await d.locator('[data-insert]').click();
 const count=await page.evaluate(()=>{const e=(window as any).__vectora,children=e.selected.children.length;e.undo();return {children,after:e.objects.length};});expect(count.children).toBeGreaterThan(20);expect(count.after).toBe(0);
});

test('Every pattern profile produces bounded editable geometry and rejects excessive density',async({page})=>{
 await page.goto(DEV);const result=await page.evaluate(async()=>{
  const {PATTERN_CATALOG}=await import('/src/generators/patternCatalog.ts'),{defaults}=await import('/src/generators/catalog.ts'),{generate}=await import('/src/generators/geometry.ts');
  const image={width:1,height:1,data:new Uint8ClampedArray([0,0,0,255])};const profiles=Object.entries(PATTERN_CATALOG).flatMap(([family,cat])=>cat.profiles.map(p=>{const v=defaults(p),r=generate(family as any,p.id,v,image);return {id:p.id,bounds:r.bounds,count:r.parts.reduce((n,p)=>n+p.contours.length,0),finite:r.parts.every(p=>p.contours.every(c=>'points'in c?c.points.every(p=>p.every(Number.isFinite)):Number.isFinite(c.radius)&&c.radius>0))};}));
  const invalid=[['maze','maze-lines',{columns:80,rows:80}],['halftone','halftone-square',{width:2000,height:2000}],['waveform','sine-strips',{amplitude:100}],['voronoi','voronoi-cells',{border:100}],['spirograph','hypotrochoid',{fixed:1,rolling:2}]].map(([family,id,values])=>{const p=(PATTERN_CATALOG as any)[family as string].profiles.find((p:any)=>p.id===id);try{generate(family as any,id as string,{...defaults(p),...values as any},image);return false;}catch{return true;}});return {profiles,invalid};
 });expect(result.profiles).toHaveLength(14);for(const p of result.profiles){expect(p.finite,p.id).toBe(true);expect(p.count,p.id).toBeGreaterThan(0);if(p.id==='maze-walls'){expect(p.bounds.width).toBeCloseTo(120,5);expect(p.bounds.height).toBeCloseTo(90,5);}}expect(result.invalid.every(Boolean)).toBe(true);
});

test('Pattern controls remain usable in both themes and on a narrow screen',async({page})=>{
 await page.goto(DEV);const d=await open(page,'voronoi');const before=await d.locator('.generator-outlines').innerHTML();await d.getByRole('button',{name:'New seed',exact:true}).click();expect(await d.locator('.generator-outlines').innerHTML()).not.toBe(before);await d.getByRole('button',{name:'Reset parameters'}).click();expect(await d.locator('.generator-outlines').innerHTML()).toBe(before);
 for(const theme of ['dark','light']){await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.screenshot({path:`test-results/pattern-${theme}.png`,scale:'css'});}
 await d.getByRole('button',{name:'Cancel',exact:true}).click();await page.setViewportSize({width:390,height:550});await open(page,'halftone');await expect(d.locator('[data-pattern-pick]')).toBeVisible();await expect(d.locator('[data-insert]')).toBeInViewport();const box=(await d.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);await page.screenshot({path:'test-results/pattern-mobile.png',scale:'css'});
});

test('Voronoi rejects nearly collapsed interiors before allocating a point grid',async({page})=>{
 await page.goto(DEV);const result=await page.evaluate(async()=>{const {CATALOG,defaults}=await import('/src/generators/catalog.ts'),{generate}=await import('/src/generators/geometry.ts');try{generate('voronoi','voronoi-cells',{...defaults(CATALOG.voronoi.profiles[0]),width:120,height:90,border:44.9999,count:2});return 'accepted';}catch(e){return (e as Error).message;}});expect(result).toContain('0.01 mm');
});

test('Pattern paths keep their active layer and exact circles through save, export and undo',async({page})=>{
 await page.goto(DEV);const r=await page.evaluate(async()=>{
  const {CATALOG,defaults}=await import('/src/generators/catalog.ts'),{generate}=await import('/src/generators/geometry.ts'),{generatedShapes}=await import('/src/generators/paperShapes.ts'),{encodeDocument,decodeDocument}=await import('/src/documentFormat.ts'),{exportSVG}=await import('/src/exportSVG.ts'),{exportDXF}=await import('/src/exportDXF.ts');const e=(window as any).__vectora,p=(window as any).__paper;
  const source={width:1,height:1,data:new Uint8ClampedArray([0,0,0,255])},result=generate('halftone','halftone-hex',defaults(CATALOG.halftone.profiles[1]),source);e.setActiveLayer('cutline');e.addGeneratedShapes(generatedShapes(result,p.view.center));const role=e.objects[0].data.role,curves=e.objects[0].children.slice(1).map((c:any)=>c.curves.length),saved=encodeDocument(e),svg=exportSVG(e.objects),dxf=exportDXF(e.objects,false);e.undo();const empty=e.objects.length;e.redo();const decoded=await decodeDocument(saved);e.loadDocument(decoded.snapshot,decoded.view);return {role,curves,empty,count:e.objects.length,svg,dxf};
 });expect(r.role).toBe('cutline');expect(r.curves.length).toBeGreaterThan(100);expect(r.curves.every((n:number)=>n===4)).toBe(true);expect(r.empty).toBe(0);expect(r.count).toBe(1);expect(r.svg).toContain('<path');expect(r.dxf).toContain('LWPOLYLINE');
});

test('Production, design reference and tool search expose all decorative families',async({page})=>{
 for(const url of ['http://127.0.0.1:4173',DEV+'/reference/design-system.html']){await page.goto(url);for(const family of ['voronoi','spirograph','maze','waveform']){const d=await open(page,family);await expect(d.locator('.generator-outlines path')).not.toHaveCount(0);if(url.includes('reference'))await expect(d.locator('.generator-feedback')).toHaveText('Reference preview · insert paths in the editor.');else await expect(d.locator('[data-insert]')).toBeEnabled();await page.keyboard.press('Escape');}}
 await page.goto(DEV);await page.locator('[data-tool-search]').click();await page.locator('#tool-search-dialog input').fill('stipple');await page.locator('.tool-search-result').first().click();await expect(page.locator('#generator-title')).toHaveText('Halftone & stipple');
});
