import {test,expect} from './fixtures';
const DEV='http://127.0.0.1:5174';

test('curve expansion stops at the point budget without allocating flattened Paper paths',async({page})=>{
 await page.goto(DEV);const result=await page.evaluate(async()=>{
  const p=(window as any).__paper,{flattenInDocument}=await import('/src/geometry.ts');
  const path=new p.Path({insert:false,segments:Array.from({length:30},(_,i)=>new p.Segment([i%2?500000:-500000,0],[0,-500000],[0,500000]))});
  const before=path.exportJSON(),original=p.Path.prototype.flatten;let legacyCalls=0,error='';
  p.Path.prototype.flatten=function(...args:any[]){legacyCalls++;return original.apply(this,args);};
  try{(flattenInDocument as any)(path,.03,64);}catch(e){error=(e as Error).message;}finally{p.Path.prototype.flatten=original;}
  const unchanged=path.exportJSON()===before;path.remove();return {error,legacyCalls,unchanged};
 });expect(result.error).toMatch(/too complex|too many/i);expect(result.legacyCalls).toBe(0);expect(result.unchanged).toBe(true);
});

test('document contour limits are checked before allocating any Paper paths',async({page})=>{
 await page.goto(DEV);const result=await page.evaluate(async()=>{
  const e=(window as any).__vectora,p=(window as any).__paper,{encodeDocument,decodeDocument}=await import('/src/documentFormat.ts');
  e.addShape(new p.Path.Rectangle({insert:false,rectangle:[0,0,10,10]}),'Rectangle');
  const file=JSON.parse(encodeDocument(e)),object=file.layers.find((l:any)=>l.objects.length).objects[0];object.kind='compound';object.contours=Array.from({length:50001},()=>({closed:false,segments:[]}));
  const before=JSON.stringify(e.snapshot()),Path=p.Path;let allocations=0,error='';
  p.Path=new Proxy(Path,{construct(target,args){allocations++;return Reflect.construct(target,args);}});
  try{await decodeDocument(JSON.stringify(file));}catch(e){error=(e as Error).message;}finally{p.Path=Path;}
  return {error,allocations,unchanged:JSON.stringify(e.snapshot())===before};
 });expect(result.error).toMatch(/too many contours/i);expect(result.allocations).toBe(0);expect(result.unchanged).toBe(true);
});

test('Preview and both DXF modes enforce a total budget across separate objects',async({page})=>{
 await page.goto(DEV);const result=await page.evaluate(async()=>{
  const p=(window as any).__paper,{materialPreviewInput}=await import('/src/materialPreviewInput.ts'),{exportDXF}=await import('/src/exportDXF.ts');
  const layer=new p.Layer({insert:false});layer.data={documentId:'cutline',objectRole:'cutline'};
  const objects=Array.from({length:4},()=>{const path=new p.Path({insert:false,segments:Array.from({length:550},(_,i)=>new p.Segment([i%2?500000:-500000,0],[0,-500000],[0,500000]))});path.data.role='cutline';layer.addChild(path);return path;});
  const messages:string[]=[];
  try{try{await materialPreviewInput(objects);}catch(e){messages.push((e as Error).message);}for(const mode of ['standard','laser'] as const){try{exportDXF(objects,false,mode,.03);}catch(e){messages.push((e as Error).message);}}}finally{layer.remove();}
  return messages;
 });expect(result).toHaveLength(3);expect(result.every(message=>/too complex|too many/i.test(message))).toBe(true);
});

test('ordinary transformed curves and 2500 rectangles still export without editing the document',async({page})=>{
 await page.goto(DEV);const result=await page.evaluate(async()=>{
  const p=(window as any).__paper,{flattenInDocument}=await import('/src/geometry.ts'),{exportDXF}=await import('/src/exportDXF.ts');
  const parent=new p.CompoundPath({insert:false});parent.applyMatrix=false;const path=new p.Path({insert:false,segments:[[0,0],[40,0]]});path.firstSegment.handleOut=[10,20];path.lastSegment.handleIn=[-10,20];parent.addChild(path);parent.scale(2,3);parent.rotate(25);parent.translate([20,-10]);
  const reference=new p.Path({insert:false});for(const s of path.segments){const point=path.localToGlobal(s.point);reference.add(new p.Segment(point,path.localToGlobal(s.point.add(s.handleIn)).subtract(point),path.localToGlobal(s.point.add(s.handleOut)).subtract(point)));}reference.flatten(.03);
  const actual=flattenInDocument(parent,.03)[0].points,expected=reference.segments.map((s:any)=>({x:s.point.x,y:s.point.y}));const before=parent.exportJSON();
  const rectangles=Array.from({length:2500},(_,i)=>{const path=new p.Path.Rectangle({insert:false,rectangle:[i%50*12,Math.floor(i/50)*12,10,10]});path.data.role='cutline';return path;});
  try{return {actual,expected,unchanged:parent.exportJSON()===before,standard:exportDXF(rectangles,false,'standard').match(/LWPOLYLINE/g)?.length,laser:exportDXF(rectangles,false,'laser').match(/\r\nLINE\r\n/g)?.length};}finally{reference.remove();parent.remove();rectangles.forEach((r:any)=>r.remove());}
 });expect(result.actual).toEqual(result.expected);expect(result.unchanged).toBe(true);expect(result.standard).toBe(2500);expect(result.laser).toBe(10000);
});

test('document segment limits apply across objects before constructing the first object',async({page})=>{
 await page.goto(DEV);const result=await page.evaluate(async()=>{
  const e=(window as any).__vectora,p=(window as any).__paper,{encodeDocument,decodeDocument}=await import('/src/documentFormat.ts');
  e.addShape(new p.Path.Rectangle({insert:false,rectangle:[0,0,10,10]}),'Rectangle');const file=JSON.parse(encodeDocument(e)),layer=file.layers.find((l:any)=>l.objects.length),a=layer.objects[0];
  a.contours[0].segments=Array(250001).fill([0,0,0,0,0,0]);const b=structuredClone(a);b.data.uid='second-object';layer.objects.push(b);
  const Path=p.Path;let allocations=0,error='';p.Path=new Proxy(Path,{construct(target,args){allocations++;return Reflect.construct(target,args);}});
  try{await decodeDocument(JSON.stringify(file));}catch(e){error=(e as Error).message;}finally{p.Path=Path;}
  return {error,allocations};
 });expect(result.error).toMatch(/too many curve points/i);expect(result.allocations).toBe(0);
});
