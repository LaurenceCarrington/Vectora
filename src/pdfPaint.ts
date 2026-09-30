import {exportPNG} from './exportImage';
const NS='http://www.w3.org/2000/svg';
const dataURL=(blob:Blob):Promise<string>=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as string);reader.onerror=()=>reject(new Error('Could not prepare gradient transparency for PDF.'));reader.readAsDataURL(blob);});
/** svg2pdf has no per-stop alpha support. Rasterize only those fills at 300 DPI
 * (capped at 4096 px/side), retaining the other artwork and all strokes as vectors. */
export async function preparePDFPaint(svg:SVGSVGElement):Promise<void> {
 const alphaGradients=new Set([...svg.querySelectorAll('linearGradient,radialGradient')].filter(g=>[...g.querySelectorAll('stop')].some(s=>Number(s.getAttribute('stop-opacity')??1)!==1)).map(g=>g.id));
 if(!alphaGradients.size)return;
 const targets=[...svg.querySelectorAll<SVGGraphicsElement>('path[fill]')].filter(node=>alphaGradients.has(node.getAttribute('fill')!.match(/^url\(#(.+)\)$/)?.[1]??''));
 if(!targets.length)return;
 const host=document.createElement('div');host.style.cssText='position:fixed;left:-100000px;top:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none';host.setAttribute('aria-hidden','true');host.append(svg);document.body.append(host);
 try{for(const node of targets){
  const box=node.getBBox();if(box.width<=0||box.height<=0)continue;
  const raster=document.createElementNS(NS,'svg');raster.setAttribute('xmlns',NS);raster.setAttribute('viewBox',`${box.x} ${box.y} ${box.width} ${box.height}`);
  svg.querySelectorAll('defs').forEach(defs=>raster.append(defs.cloneNode(true)));
  const fill=node.cloneNode(true) as SVGElement;fill.removeAttribute('transform');fill.setAttribute('stroke','none');raster.append(fill);
  const pixels=Math.max(1,Math.min(Math.ceil(box.width*300/25.4),4096,Math.floor(4096*box.width/box.height)));
  const png=await exportPNG(new XMLSerializer().serializeToString(raster),{width:pixels});
  const image=document.createElementNS(NS,'image');for(const [name,value] of Object.entries({x:box.x,y:box.y,width:box.width,height:box.height}))image.setAttribute(name,String(value));
  image.setAttribute('href',await dataURL(png));image.setAttribute('preserveAspectRatio','none');if(node.hasAttribute('transform'))image.setAttribute('transform',node.getAttribute('transform')!);
  node.before(image);node.setAttribute('fill','none');
 }}finally{svg.remove();host.remove();}
}
