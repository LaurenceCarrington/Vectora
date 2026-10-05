import {test,expect} from './fixtures';
const DEV='http://127.0.0.1:5174';
test('Paint palette preserves flat colours, reduces deterministically and respects transparent pixels',async({page})=>{
 await page.goto(DEV);const r=await page.evaluate(async()=>{
  const {quantize}=await import('/src/paintByNumbers/quantize.ts');
  const solid=quantize({width:2,height:1,data:new Uint8ClampedArray([255,0,0,255,255,0,0,255])},12);
  const image={width:4,height:1,data:new Uint8ClampedArray([255,0,0,255,0,0,255,255,0,0,0,0,0,0,0,128])};
  const a=quantize(image,3),b=quantize(image,3);
  return {solid:{palette:solid.palette,labels:[...solid.labels]},palette:a.palette,labels:[...a.labels],repeat:JSON.stringify(a)===JSON.stringify(b)};
 });expect(r.solid).toEqual({palette:['#FF0000'],labels:[0,0]});expect(r.palette).toEqual(['#0000FF','#7F7F7F','#FF0000']);expect(r.labels[2]).toBe(-1);expect(r.repeat).toBe(true);
});
test('Paint palette bounds unique colours and rejects invalid source/count before allocating',async({page})=>{
 await page.goto(DEV);const r=await page.evaluate(async()=>{const {quantize}=await import('/src/paintByNumbers/quantize.ts');const data=new Uint8ClampedArray(100*4);for(let i=0;i<100;i++)data.set([i*2,255-i*2,i,255],i*4);const source={width:10,height:10,data},a=quantize(source,8);const invalid=[()=>quantize(source,33),()=>quantize(source,2.5),()=>quantize({...source,width:Infinity},8),()=>quantize({...source,width:1201},8),()=>quantize({...source,data:new Uint8ClampedArray(3)},8)].map(fn=>{try{fn();return false;}catch{return true;}});return {palette:a.palette,labels:[...a.labels],invalid};});expect(new Set(r.palette).size).toBe(r.palette.length);expect(r.palette.length).toBeLessThanOrEqual(8);expect(new Set(r.labels).size).toBe(r.palette.length);expect(r.invalid.every(Boolean)).toBe(true);
});
test('Paint regions preserve shared borders, islands, holes and readable interior labels',async({page})=>{
 await page.goto(DEV);const results=await page.evaluate(async()=>{
  const {processPaint}=await import('/src/paintByNumbers/process.ts'),p=(window as any).__paper;
  const metrics=Array.from({length:32},(_,i)=>({number:i+1,left:0,top:0,width:i<9?.5:1,height:.8}));
  const cases=[{w:40,h:40,colour:(x:number,y:number)=>x<20?0:1},{w:40,h:40,colour:(x:number,y:number)=>x>=12&&x<28&&y>=12&&y<28?1:0},{w:4,h:4,colour:(x:number,y:number)=>(x+y)%2},{w:40,h:40,colour:(x:number)=>x<15?0:x<25?-1:0}];
  return cases.map(c=>{const data=new Uint8ClampedArray(c.w*c.h*4);let area=0;for(let y=0;y<c.h;y++)for(let x=0;x<c.w;x++){const n=c.colour(x,y);if(n>=0){data.set(n?[0,0,255,255]:[255,0,0,255],(y*c.w+x)*4);area++;}}
   const r=processPaint({width:c.w,height:c.h,data},{colours:2,cleanupMM2:0,imageWidthMM:100,imageHeightMM:100,labelSizeMM:3,metrics});let actual=0,crossings=0,inside=true,holes=0;
   for(const region of r.regions){const path=new p.CompoundPath({insert:false,children:region.contours.map(points=>new p.Path({insert:false,segments:points,closed:true}))});path.fillRule='evenodd';actual+=Math.abs(path.area);holes+=region.contours.length-1;crossings+=path.getCrossings(path).length;const m=metrics[region.paletteIndex],rx=m.width*3*c.w/100/2,ry=m.height*3*c.h/100/2;for(const [x,y] of [[-rx,-ry],[rx,-ry],[rx,ry],[-rx,ry],[0,0]])inside&&=path.contains(new p.Point(region.label[0]+x,region.label[1]+y));path.remove();}
   return {area,actual,crossings,inside,holes,regions:r.regions.length,repeat:JSON.stringify(r)===JSON.stringify(processPaint({width:c.w,height:c.h,data},{colours:2,cleanupMM2:0,imageWidthMM:100,imageHeightMM:100,labelSizeMM:3,metrics}))};});
 });for(const r of results){expect(r.actual).toBeCloseTo(r.area,6);expect(r.crossings).toBe(0);expect(r.inside).toBe(true);expect(r.repeat).toBe(true);}expect(results[1].holes).toBe(1);expect(results[2].regions).toBe(16);expect(results[3].regions).toBe(2);
});
test('Paint cleanup keeps coverage and rejects isolated unlabelable fragments and invalid settings',async({page})=>{
 await page.goto(DEV);const r=await page.evaluate(async()=>{const {processPaint}=await import('/src/paintByNumbers/process.ts');const metrics=Array.from({length:32},(_,i)=>({number:i+1,left:0,top:0,width:1,height:1})),settings={colours:2,cleanupMM2:10,imageWidthMM:100,imageHeightMM:100,labelSizeMM:3,metrics};const data=new Uint8ClampedArray(40*40*4);for(let i=0;i<1600;i++)data.set([255,0,0,255],i*4);data.set([0,0,255,255],(20*40+20)*4);const a=processPaint({width:40,height:40,data},settings);const tiny=new Uint8ClampedArray(40*40*4);tiny.set([255,0,0,255],0);const invalid=[()=>processPaint({width:40,height:40,data:tiny},{...settings,imageWidthMM:10,imageHeightMM:10}),()=>processPaint({width:40,height:40,data:new Uint8ClampedArray(data.length)},settings),()=>processPaint({width:40,height:40,data},{...settings,labelSizeMM:NaN}),()=>processPaint({width:40,height:40,data},{...settings,metrics:[]})].map(fn=>{try{fn();return false;}catch{return true;}});return {regions:a.regions.length,pixels:a.regions.reduce((n,c)=>n+c.pixels,0),merged:a.mergedCount,invalid};});expect(r).toMatchObject({regions:1,pixels:1600});expect(r.merged).toBeGreaterThan(0);expect(r.invalid.every(Boolean)).toBe(true);
});
