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
