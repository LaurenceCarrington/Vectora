/** Inspect bounded file bytes before handing compressed images to a pixel decoder.
 * PNG/GIF specs: w3.org/TR/png-3/ and w3.org/Graphics/GIF/spec-gif89a.txt
 * WebP: developers.google.com/speed/webp/docs/riff_container
 * BMP: Microsoft BITMAPINFOHEADER; JPEG: ISO start-of-frame marker layout.
 * This validates dimensions/structure, not compressed pixels: the browser still
 * validates the image, and callers retain the decoded-size check as a backstop. */
export const MAX_RASTER_BYTES=20*1024*1024;
export const MAX_RASTER_PIXELS=40000000;
export interface RasterDimensions {width:number;height:number}
const invalid=():never=>{throw new Error('This image has an invalid or unsupported header. Choose a PNG, JPG, WebP, GIF or BMP image.');};
function dimensions(width:number,height:number):RasterDimensions {
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)invalid();
 if(width*height>MAX_RASTER_PIXELS)throw new Error('Choose an image with at most 40 million pixels.');
 return {width,height};
}
function same(a:RasterDimensions,b:RasterDimensions):void {if(a.width!==b.width||a.height!==b.height)invalid();}
export function rasterImageDimensions(bytes:Uint8Array):RasterDimensions {
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const range=(offset:number,length:number,end=bytes.length)=>{if(offset<0||length<0||offset+length>end||end>bytes.length)invalid();};
 const text=(offset:number,length:number)=>{range(offset,length);return String.fromCharCode(...bytes.subarray(offset,offset+length));};
 const u16=(offset:number,little=false)=>{range(offset,2);return view.getUint16(offset,little);};
 const u24=(offset:number)=>{range(offset,3);return bytes[offset]+bytes[offset+1]*256+bytes[offset+2]*65536;};
 const u32=(offset:number,little=false)=>{range(offset,4);return view.getUint32(offset,little);};
 const fits=(canvas:RasterDimensions,frame:RasterDimensions,x=0,y=0)=>{if(x+frame.width>canvas.width||y+frame.height>canvas.height)invalid();};
 if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((byte,i)=>bytes[i]===byte)){
  range(0,33);if(u32(8)!==13||text(12,4)!=='IHDR')invalid();
  const size=dimensions(u32(16),u32(20));
  for(let offset=33;offset<bytes.length;){
   range(offset,12);const n=u32(offset),kind=text(offset+4,4),body=offset+8;range(offset,n+12);
   if(kind==='fcTL'){if(n!==26)invalid();const frame=dimensions(u32(body+4),u32(body+8));fits(size,frame,u32(body+12),u32(body+16));}
   if(kind==='IHDR')invalid();
   offset+=n+12;if(kind==='IEND'){if(n!==0)invalid();break;}
  }
  return size;
 }
 if(bytes.length>=6&&['GIF87a','GIF89a'].includes(text(0,6))){
  range(0,13);const size=dimensions(u16(6,true),u16(8,true));
  let offset=13+(bytes[10]&128?3*(1<<((bytes[10]&7)+1)):0);range(0,offset);
  const blocks=()=>{for(;;){range(offset,1);const n=bytes[offset++];if(!n)return;range(offset,n);offset+=n;}};
  while(offset<bytes.length){
   const kind=bytes[offset++];if(kind===0x3b)return size;
   if(kind===0x21){range(offset,1);offset++;blocks();continue;}
   if(kind!==0x2c)invalid();range(offset,9);
   const frame=dimensions(u16(offset+4,true),u16(offset+6,true));fits(size,frame,u16(offset,true),u16(offset+2,true));
   const packed=bytes[offset+8];offset+=9;if(packed&128)offset+=3*(1<<((packed&7)+1));range(offset,1);offset++;blocks();
  }
  return invalid();
 }
 if(bytes.length>=2&&bytes[0]===0xff&&bytes[1]===0xd8){
  let offset=2,size:RasterDimensions|undefined;
  while(offset<bytes.length){
   if(bytes[offset++]!==0xff)invalid();while(offset<bytes.length&&bytes[offset]===0xff)offset++;
   range(offset,1);const marker=bytes[offset++];if(marker===0xda||marker===0xd9)break;
   if(marker===1||marker>=0xd0&&marker<=0xd8)continue;
   const n=u16(offset);if(n<2)invalid();range(offset,n);
   if(marker>=0xc0&&marker<=0xcf&&![0xc4,0xc8,0xcc].includes(marker)){
    if(n<8)invalid();const frame=dimensions(u16(offset+5),u16(offset+3));if(size)same(size,frame);else size=frame;
   }
   offset+=n;
  }
  return size??invalid();
 }
 if(bytes.length>=2&&text(0,2)==='BM'){
  range(0,26);const n=u32(14,true);range(14,n);const pixels=u32(10,true);if(pixels<14+n||pixels>bytes.length)invalid();
  if(n===12)return dimensions(u16(18,true),u16(20,true));
  if(![16,40,52,56,64,108,124].includes(n))invalid();
  // Embedded JPEG/PNG would require checking its own dimensions too. These
  // compression modes are not browser bitmap formats; reject them explicitly.
  if(n>=40&&[4,5].includes(u32(30,true)))invalid();
  if(n===16||n===64)return dimensions(u32(18,true),u32(22,true));
  return dimensions(view.getInt32(18,true),Math.abs(view.getInt32(22,true)));
 }
 if(bytes.length>=12&&text(0,4)==='RIFF'&&text(8,4)==='WEBP'){
  const end=u32(4,true)+8;range(0,end);if(end<12)invalid();
  let canvas:RasterDimensions|undefined,image:RasterDimensions|undefined;
  const bitstream=(kind:string,body:number,n:number):RasterDimensions=>{
   if(kind==='VP8L'){
    if(n<5||bytes[body]!==0x2f)invalid();const bits=u32(body+1,true);if(bits>>>29)invalid();
    return dimensions((bits&0x3fff)+1,((bits>>>14)&0x3fff)+1);
   }
   if(n<10||bytes[body]&1||text(body+3,3)!=='\x9d\x01\x2a')invalid();
   return dimensions(u16(body+6,true)&0x3fff,u16(body+8,true)&0x3fff);
  };
  const chunks=(start:number,stop:number,frame?:RasterDimensions)=>{
   let found=false;
   for(let offset=start;offset<stop;){
    range(offset,8,stop);const kind=text(offset,4),n=u32(offset+4,true),body=offset+8;range(body,n+(n&1),stop);
    if(kind==='VP8X'){
     if(frame||canvas||n<10)invalid();canvas=dimensions(u24(body+4)+1,u24(body+7)+1);if(image)same(canvas,image);
    }else if(kind==='VP8 '||kind==='VP8L'){
     const size=bitstream(kind,body,n);if(frame)same(frame,size);else{if(image)invalid();image=size;if(canvas)same(canvas,size);}found=true;
    }else if(kind==='ANMF'){
     const bounds=canvas;if(frame||!bounds||n<16)return invalid();const size=dimensions(u24(body+6)+1,u24(body+9)+1);fits(bounds,size,u24(body)*2,u24(body+3)*2);
     if(!chunks(body+16,body+n,size))invalid();found=true;
    }
    offset=body+n+(n&1);
   }
   return found;
  };
  if(!chunks(12,end))invalid();return canvas??image??invalid();
 }
 return invalid();
}
export async function validateRasterImage(file:Blob):Promise<RasterDimensions> {
 if(file.size>MAX_RASTER_BYTES)throw new Error('Choose an image smaller than 20 MB.');
 return rasterImageDimensions(new Uint8Array(await file.arrayBuffer()));
}
