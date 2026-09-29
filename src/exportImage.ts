/** Export from a frozen SVG snapshot so asynchronous conversion never changes the drawing. */
export function exportImageSource(contents:string):{svg:SVGSVGElement;width:number;height:number} {
 const svg=new DOMParser().parseFromString(contents,'image/svg+xml').documentElement as unknown as SVGSVGElement;
 const view=(svg.getAttribute('viewBox')??'').split(/\s+/).map(Number),width=view[2],height=view[3];
 if(svg.localName!=='svg'||view.length!==4||!view.every(Number.isFinite)||width<=0||height<=0)throw new Error('The drawing has invalid export dimensions.');
 return {svg,width,height};
}
export function downloadImage(blob:Blob,format:'pdf'|'png'):void {
 const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=`vectora.${format}`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
/** Canvas encoders advertise 96 DPI. Replace pHYs with the chosen sampling density. */
async function pngDensity(blob:Blob,dpi:number):Promise<Blob> {
 const data=new Uint8Array(await blob.arrayBuffer()),chunk=new Uint8Array(21),view=new DataView(chunk.buffer);view.setUint32(0,9);chunk.set([112,72,89,115],4);view.setUint32(8,Math.round(dpi/0.0254));view.setUint32(12,Math.round(dpi/0.0254));chunk[16]=1;
 let crc=0xffffffff;for(const byte of chunk.subarray(4,17)){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}view.setUint32(17,(crc^0xffffffff)>>>0);
 const parts:BlobPart[]=[data.slice(0,33),chunk];for(let i=33;i<data.length;){const length=new DataView(data.buffer,data.byteOffset+i,4).getUint32(0),end=i+length+12;if(String.fromCharCode(...data.subarray(i+4,i+8))!=='pHYs')parts.push(data.slice(i,end));i=end;}
 return new Blob(parts,{type:'image/png'});
}
export async function exportPNG(contents:string,options:{dpi?:number;width?:number;background?:string}={}):Promise<Blob> {
 const {svg,width,height}=exportImageSource(contents),dpi=options.dpi??300;
 if(!Number.isFinite(dpi)||dpi<1||dpi>2400||options.width!==undefined&&(!Number.isFinite(options.width)||options.width<1))throw new Error('Enter a valid resolution (1–2400 DPI) and pixel width.');
 const px=options.width?Math.round(options.width):Math.max(1,Math.ceil(width*dpi/25.4-1e-7)),py=options.width?Math.max(1,Math.round(px*height/width)):Math.max(1,Math.ceil(height*dpi/25.4-1e-7));
 if(px>16384||py>16384||px*py>32000000)throw new Error('PNG is too large at this resolution (maximum 32 megapixels or 16,384 pixels per side). Reduce the drawing size or export PDF/SVG.');
 svg.setAttribute('width',String(px));svg.setAttribute('height',String(py));
 const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml;charset=utf-8'})),image=new Image(),canvas=document.createElement('canvas');
 try{image.src=url;await image.decode();canvas.width=px;canvas.height=py;const ctx=canvas.getContext('2d');if(!ctx)throw new Error('The browser could not create the PNG canvas.');if(options.background){ctx.fillStyle=options.background;ctx.fillRect(0,0,px,py);}ctx.drawImage(image,0,0,px,py);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('The browser could not encode the PNG.')),'image/png'));return await pngDensity(blob,dpi);
 }finally{URL.revokeObjectURL(url);canvas.width=canvas.height=0;}
}
