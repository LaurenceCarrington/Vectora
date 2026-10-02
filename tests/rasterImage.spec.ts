import {test,expect} from './fixtures';
const DEV='http://127.0.0.1:5174';
function oversizedPNG(){const data=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(data);data.writeUInt32BE(13,8);data.write('IHDR',12);data.writeUInt32BE(10000,16);data.writeUInt32BE(10000,20);data[24]=8;data[25]=6;return {name:'oversized.png',mimeType:'image/png',buffer:data};}
function bmp(core=false,topDown=false,short=false){const dib=core?12:short?16:40,offset=14+dib,data=Buffer.alloc(offset+24);data.write('BM');data.writeUInt32LE(data.length,2);data.writeUInt32LE(offset,10);data.writeUInt32LE(dib,14);if(core){data.writeUInt16LE(3,18);data.writeUInt16LE(2,20);data.writeUInt16LE(1,22);data.writeUInt16LE(24,24);}else{data.writeInt32LE(3,18);data.writeInt32LE(topDown?-2:2,22);data.writeUInt16LE(1,26);data.writeUInt16LE(24,28);}return data;}
function webp(kind:string,payload:Buffer){const data=Buffer.alloc(20+payload.length+(payload.length&1));data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WEBP',8);data.write(kind,12);data.writeUInt32LE(payload.length,16);payload.copy(data,20);return data;}
function pngChunk(kind:string,payload:Buffer){const data=Buffer.alloc(payload.length+12);data.writeUInt32BE(payload.length);data.write(kind,4);payload.copy(data,8);return data;}
for(const surface of ['tracing','generator'] as const)test(`${surface} rejects oversized image headers before invoking the pixel decoder`,async({page})=>{
 // The decoder is the dangerous external boundary here: it must never be
 // reached for an oversized header. Avoid allocating a 100-million-pixel image.
 await page.addInitScript(()=>{window.createImageBitmap=async()=>{throw new Error('Pixel decoder reached before validation');};});
 await page.goto(DEV);const before=await page.evaluate(()=>JSON.stringify((window as any).__vectora.snapshot()));
 if(surface==='tracing'){
  await page.getByRole('button',{name:'Images',exact:true}).click();await page.getByRole('menuitem',{name:'Raster to vector',exact:true}).click();
  await page.locator('#raster-file').setInputFiles(oversizedPNG());await expect(page.locator('#raster-error')).toContainText('40 million');await expect(page.locator('#raster-add')).toBeDisabled();
 }else{
  await page.locator('[data-generator-trigger]').click();await page.locator('[data-generator="halftone"]').click();
  await page.locator('[data-pattern-file]').setInputFiles(oversizedPNG());await expect(page.locator('.generator-feedback')).toContainText('40 million');await expect(page.locator('#generator-dialog [data-insert]')).toBeDisabled();
 }
 expect(await page.evaluate(()=>JSON.stringify((window as any).__vectora.snapshot()))).toBe(before);
});

for(const surface of ['tracing','generator'] as const)for(const action of ['close','replace'] as const)test(`${surface} never decodes an obsolete image after ${action} during header reading`,async({page})=>{
 await page.addInitScript(()=>{
  const read=File.prototype.arrayBuffer,decode=window.createImageBitmap;
  (window as any).__decodedFiles=[];
  File.prototype.arrayBuffer=async function(){const bytes=await read.call(this);if(this.name==='pending.png'){(window as any).__headerPending=true;await new Promise<void>(resolve=>{(window as any).__releaseHeader=resolve;});}return bytes;};
  window.createImageBitmap=((file:File,...args:any[])=>{(window as any).__decodedFiles.push(file.name);return (decode as any)(file,...args);}) as typeof createImageBitmap;
 });
 await page.goto(DEV);const before=await page.evaluate(()=>JSON.stringify((window as any).__vectora.snapshot()));
 const image=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=64;canvas.getContext('2d')!.fillRect(8,8,48,48);return canvas.toDataURL().split(',')[1];});
 if(surface==='tracing'){await page.getByRole('button',{name:'Images',exact:true}).click();await page.getByRole('menuitem',{name:'Raster to vector',exact:true}).click();}
 else{await page.locator('[data-generator-trigger]').click();await page.locator('[data-generator="halftone"]').click();}
 const input=page.locator(surface==='tracing'?'#raster-file':'[data-pattern-file]');
 await input.setInputFiles({name:'pending.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});await page.waitForFunction(()=>(window as any).__headerPending);
 if(action==='close'){await page.keyboard.press('Escape');await expect(page.locator(surface==='tracing'?'#raster-dialog':'#generator-dialog')).toBeHidden();}
 else{await input.setInputFiles({name:'current.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});await page.waitForFunction(()=>(window as any).__decodedFiles.includes('current.png'));}
 await page.evaluate(async()=>{(window as any).__releaseHeader();await new Promise(requestAnimationFrame);});
 expect(await page.evaluate(()=>(window as any).__decodedFiles)).toEqual(action==='close'?[]:['current.png']);
 expect(await page.evaluate(()=>JSON.stringify((window as any).__vectora.snapshot()))).toBe(before);
});

test('PNG, JPEG, WebP, GIF and BMP headers agree with real browser-decoded dimensions',async({page})=>{
 await page.goto(DEV);const fixtures=[{type:'image/gif',data:Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64').toString('base64')},...[[false,false,false],[false,true,false],[true,false,false],[false,false,true]].map(([core,topDown,short])=>({type:'image/bmp',data:bmp(core,topDown,short).toString('base64')}))];
 const result=await page.evaluate(async fixtures=>{
  const {validateRasterImage}=await import('/src/rasterImage.ts'),canvas=document.createElement('canvas');canvas.width=3;canvas.height=2;canvas.getContext('2d')!.fillRect(0,0,3,2);
  const files=fixtures.map(f=>new Blob([Uint8Array.from(atob(f.data),c=>c.charCodeAt(0))],{type:f.type}));
  for(const type of ['image/png','image/jpeg','image/webp']){const url=canvas.toDataURL(type);if(!url.startsWith(`data:${type}`))throw new Error('Browser did not encode '+type);files.push(await (await fetch(url)).blob());}
  const result=[];for(const file of files){const size=await validateRasterImage(file),bitmap=await createImageBitmap(file);result.push({header:size,decoded:{width:bitmap.width,height:bitmap.height}});bitmap.close();}return result;
 },fixtures);
 expect(result[0]).toEqual({header:{width:1,height:1},decoded:{width:1,height:1}});for(const size of result.slice(1))expect(size).toEqual({header:{width:3,height:2},decoded:{width:3,height:2}});
});

test('header parsing rejects truncated, contradictory and oversized embedded frames',async({page})=>{
 await page.goto(DEV);
 const lossless=Buffer.alloc(5);lossless[0]=0x2f;lossless.writeUInt32LE((3-1)|((2-1)<<14),1);
 const extended=Buffer.alloc(10);extended[0]=16;extended.writeUIntLE(1,4,3);extended.writeUIntLE(1,7,3);
 const mismatch=Buffer.concat([webp('VP8X',extended),webp('VP8L',lossless).subarray(12)]);mismatch.writeUInt32LE(mismatch.length-8,4);
 const bmpHuge=bmp();bmpHuge.writeInt32LE(10000,18);bmpHuge.writeInt32LE(10000,22);
 const gifHuge=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');gifHuge.writeUInt16LE(10000,6);gifHuge.writeUInt16LE(10000,8);
 const gifFrame=Buffer.from(gifHuge);gifFrame.writeUInt16LE(1,6);gifFrame.writeUInt16LE(1,8);const descriptor=gifFrame.indexOf(0x2c);gifFrame.writeUInt16LE(10000,descriptor+5);gifFrame.writeUInt16LE(10000,descriptor+7);
 const png=oversizedPNG().buffer;png.writeUInt32BE(3,16);png.writeUInt32BE(2,20);const fc=Buffer.alloc(26);fc.writeUInt32BE(10000,4);fc.writeUInt32BE(10000,8);const animatedPNG=Buffer.concat([png,pngChunk('fcTL',fc),pngChunk('IEND',Buffer.alloc(0))]);
 const largeLossless=Buffer.alloc(5);largeLossless[0]=0x2f;largeLossless.writeUInt32LE(9999|(9999<<14),1);
 const jpegHuge=Buffer.from([255,216,255,192,0,17,8,39,16,39,16,3,1,17,0,2,17,0,3,17,0,255,217]);
 const badJpeg=Buffer.from([255,216,255,224,0,1]);
 const result=await page.evaluate(async data=>{
  const {rasterImageDimensions}=await import('/src/rasterImage.ts');const messages=[];
  for(const fixture of data){try{rasterImageDimensions(Uint8Array.from(fixture));messages.push('accepted');}catch(e){messages.push((e as Error).message);}}
  // Verify byteOffset handling: parsing a view must not read the prefix/suffix.
  const storage=new Uint8Array([99,99,...data[0],99]);const offset=rasterImageDimensions(storage.subarray(2,storage.length-1));
  return {messages,offset};
 },[webp('VP8L',lossless),Buffer.alloc(0),Buffer.from([137,80,78,71,13,10,26,10]),badJpeg,mismatch,bmpHuge,gifHuge,gifFrame,animatedPNG,webp('VP8L',largeLossless),jpegHuge].map(data=>Array.from(data)));
 expect(result.offset).toEqual({width:3,height:2});expect(result.messages[0]).toBe('accepted');expect(result.messages.slice(1).every(message=>message!=='accepted')).toBe(true);for(const message of result.messages.slice(5))expect(message).toContain('40 million');
});
