import {test,expect} from './fixtures';
import {mixedDrawing} from './mixedDrawingHelpers';

test('Selection, panning and marquee do not serialise document geometry',async({page})=>{
 await page.goto('http://127.0.0.1:5174');await mixedDrawing(page,2500);
 // Allow the ordinary recovery timer to settle before measuring gesture work.
 await page.waitForTimeout(350);
 const points=await page.evaluate(()=>{
  const e=(window as any).__vectora,p=(window as any).__paper,r=e.canvas.getBoundingClientRect(),toScreen=(v:any)=>{const s=p.view.projectToView(v);return{x:s.x+r.x,y:s.y+r.y};};
  let snapshots=0;const original=e.snapshot.bind(e);e.snapshot=()=>{snapshots++;return original();};(window as any).__snapshotCount=()=>snapshots;
  return {shape:toScreen(e.objects[1250].bounds.center),empty:toScreen([598,154])};
 });
 await page.mouse.click(points.shape.x,points.shape.y);
 expect(await page.evaluate(()=>(window as any).__vectora.selectedItems[0].data.uid)).toBe('mixed-1250');
 await page.mouse.move(points.empty.x,points.empty.y);await page.mouse.down();await page.mouse.move(points.empty.x+50,points.empty.y+50,{steps:3});await page.keyboard.press('Escape');await page.mouse.up();
 expect(await page.evaluate(()=>(window as any).__vectora.selectedItems[0].data.uid)).toBe('mixed-1250');
 await page.keyboard.down('Space');await page.mouse.move(600,400);await page.mouse.down();await page.mouse.move(630,425,{steps:3});await page.mouse.up();await page.keyboard.up('Space');
 expect(await page.evaluate(()=>(window as any).__snapshotCount())).toBe(0);
});

test('Moving captures history only when geometry changes and cancellation preserves mixed paint',async({page})=>{
 await page.goto('http://127.0.0.1:5174');await mixedDrawing(page,2500);await page.waitForTimeout(350);
 const before=await page.evaluate(()=>{const e=(window as any).__vectora;e.select(e.objects[1252]);return e.snapshot().artwork;});
 const at=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper,v=p.view.projectToView(e.selected.bounds.center),r=e.canvas.getBoundingClientRect();let snapshots=0;const original=e.snapshot.bind(e);e.snapshot=()=>{snapshots++;return original();};(window as any).__snapshotCount=()=>snapshots;return{x:v.x+r.x,y:v.y+r.y};});
 await page.mouse.move(at.x,at.y);await page.mouse.down();expect(await page.evaluate(()=>(window as any).__snapshotCount())).toBe(0);
 await page.mouse.move(at.x+20,at.y+10,{steps:3});expect(await page.evaluate(()=>(window as any).__snapshotCount())).toBe(1);
 await page.keyboard.press('Escape');await page.mouse.up();
 expect(await page.evaluate(()=>(window as any).__vectora.snapshot().artwork)).toBe(before);
});

test('Recovery reuses committed history and an immediate refresh keeps the committed move',async({page})=>{
 await page.goto('http://127.0.0.1:5174');await mixedDrawing(page,2500);await page.waitForTimeout(350);
 const at=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper,v=p.view.projectToView(e.objects[1250].bounds.center),r=e.canvas.getBoundingClientRect();const events:any[]=[];(window as any).__releaseWork=events;
  const original=e.snapshot.bind(e);let releasing=false;e.canvas.addEventListener('pointerup',()=>{releasing=true;},{capture:true});e.canvas.addEventListener('pointerup',()=>{releasing=false;});
  e.snapshot=()=>{if(releasing)events.push('snapshot');return original();};return{x:v.x+r.x,y:v.y+r.y};});
 await page.mouse.move(at.x,at.y);await page.mouse.down();await page.mouse.move(at.x+30,at.y+10,{steps:3});await page.mouse.up();
 expect(await page.evaluate(()=>(window as any).__releaseWork)).toEqual(['snapshot']);
 const expected=await page.evaluate(()=>{const b=(window as any).__vectora.objects.find((s:any)=>s.data.uid==='mixed-1250').bounds;return [b.x,b.y];});
 page.once('dialog',d=>d.accept());await page.reload();await expect(page.locator('#workspace')).not.toHaveAttribute('inert','');
 expect(await page.evaluate(()=>{const b=(window as any).__vectora.objects.find((s:any)=>s.data.uid==='mixed-1250').bounds;return [b.x,b.y];})).toEqual(expected);
 expect(await page.evaluate(()=>(window as any).__vectora.objects.length)).toBe(2500);
});

test('Exact selection only hit-tests nearby objects while keeping stroke priority and hidden/locked exclusion',async({page})=>{
 await page.goto('http://127.0.0.1:5174');await mixedDrawing(page,2500);
 const result=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper;let tests=0;
  for(const item of e.objects){const original=item.hitTest.bind(item);item.hitTest=(...args:any[])=>{tests++;return original(...args);};}
  const hit=e.hitObject(new p.Point(600,148));return {uid:hit?.data.uid,tests};});
 expect(result.uid).toBe('mixed-1250');expect(result.tests).toBeLessThan(10);
 const priority=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper,a=new p.Path.Rectangle({insert:false,rectangle:[600,144,8,8],strokeColor:'red',strokeWidth:1.5,strokeScaling:false}),b=new p.Path.Rectangle({insert:false,rectangle:[600,144,8,8],fillColor:'red'});a.data={uid:'edge',role:'cutline'};b.data={uid:'fill',role:'artwork'};const l=e.addDocumentLayer('artwork');e.cutlines.addChild(a);l.addChild(b);const first=e.hitObject(new p.Point(600,148))?.data.uid;e.cutlines.locked=true;const locked=e.hitObject(new p.Point(600,148))?.data.uid;l.visible=false;const hidden=e.hitObject(new p.Point(604,148))?.data.uid;return {first,locked,hidden};});
 expect(priority).toEqual({first:'edge',locked:'mixed-1250',hidden:'mixed-1250'});
});

test('Artwork history serialisation avoids reparsing each exported object',async({page})=>{
 await page.goto('http://127.0.0.1:5174');await mixedDrawing(page,2500);
 const parses=await page.evaluate(()=>{let count=0;const original=JSON.parse;JSON.parse=function(...args:Parameters<typeof JSON.parse>){count++;return original(...args);};try{(window as any).__vectora.snapshot();}finally{JSON.parse=original;}return count;});
 expect(parses).toBe(0);
});

test('Conservative hit bounds preserve thick butt-cap endpoint targets at different zooms',async({page})=>{
 await page.goto('http://127.0.0.1:5174');
 const hits=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper,path=new p.Path({insert:false,segments:[[0,0],[100,0]],strokeColor:'white',strokeWidth:40,strokeScaling:false,strokeCap:'butt'});path.data={uid:'thick-endpoint',role:'artwork'};e.artwork.addChild(path);
  return [1,4,.2].map(zoom=>{p.view.zoom=zoom;const point=new p.Point(-15/zoom,0);return {zoom,precise:path.hitTest(point,{stroke:true,segments:true,tolerance:6/zoom})?.type,selected:e.hitObject(point)?.data.uid};});
 });
 expect(hits).toEqual([1,4,.2].map(zoom=>({zoom,precise:'segment',selected:'thick-endpoint'})));
 const transformed=await page.evaluate(()=>{const e=(window as any).__vectora,p=(window as any).__paper,path=e.objects[0];p.view.zoom=1;path.applyMatrix=false;path.strokeScaling=true;path.matrix=new p.Matrix(2,1,.5,3,30,40);const point=path.localToGlobal(new p.Point(-15,0));return {precise:path.hitTest(point,{stroke:true,segments:true,tolerance:6})?.type,selected:e.hitObject(point)?.data.uid};});
 expect(transformed).toEqual({precise:'segment',selected:'thick-endpoint'});
});
