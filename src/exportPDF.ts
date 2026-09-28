import {jsPDF} from 'jspdf';
import {svg2pdf} from 'svg2pdf.js';
import type {Font} from 'opentype.js';
import {exportImageSource} from './exportImage';
let captionFont:Promise<Font>|undefined;
function loadCaptionFont():Promise<Font> {
 return captionFont??=(async()=>{const response=await fetch(`${import.meta.env.BASE_URL}fonts/Lato-Regular.ttf`);if(!response.ok)throw new Error('Could not load the PDF label font. Try again.');const {parse}=await import('opentype.js');return parse(await response.arrayBuffer());})().catch(error=>{captionFont=undefined;throw error;});
}
/** Outline annotation labels, retaining their original advance, baseline, anchor and rotation.
 * This avoids svg2pdf's browser/PDF font metric mismatch and missing-glyph truncation. */
async function outlineLabels(svg:SVGSVGElement):Promise<void> {
 const labels=[...svg.querySelectorAll('text')];if(!labels.length)return;
 const font=await loadCaptionFont(),ctx=document.createElement('canvas').getContext('2d')!;
 for(const text of labels){
  const content=text.textContent??'';
  const unsupported=[...new Set([...content].filter(char=>!font.charToGlyphIndex(char)))];
  if(unsupported.length)throw new Error(`PDF callout contains unsupported characters: ${unsupported.join(' ')}. Edit the label or export PNG/SVG to preserve its system-font appearance.`);
  const size=parseFloat(text.getAttribute('font-size')??'16'),x=parseFloat(text.getAttribute('x')??'0'),y=parseFloat(text.getAttribute('y')??'0');
  ctx.font=`${size}px ${text.getAttribute('font-family')??'Arial, sans-serif'}`;const measured=ctx.measureText(content),width=measured.width;
  const outline=font.getPath(content,0,0,size),advance=font.getAdvanceWidth(content,size),box=outline.getBoundingBox();
  const sx=advance>0?width/advance:1,sy=Math.min(1,box.y1<0?measured.fontBoundingBoxAscent/-box.y1:1,box.y2>0?measured.fontBoundingBoxDescent/box.y2:1);
  const anchor=text.getAttribute('text-anchor'),offset=anchor==='middle'?width/2:anchor==='end'?width:0;
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');
  for(const attr of text.attributes)if(!['x','y','text-anchor','font-family','font-size','transform'].includes(attr.name))path.setAttribute(attr.name,attr.value);
  // Serialize native commands directly: the font library formatter can emit NaN near integer coordinates.
  const number=(n:number)=>String(Number(n.toFixed(8)));
  const d=outline.commands.map(c=>{switch(c.type){case 'M':case 'L':return `${c.type}${number(c.x)} ${number(c.y)}`;case 'Q':return `Q${number(c.x1)} ${number(c.y1)} ${number(c.x)} ${number(c.y)}`;case 'C':return `C${number(c.x1)} ${number(c.y1)} ${number(c.x2)} ${number(c.y2)} ${number(c.x)} ${number(c.y)}`;case 'Z':return 'Z';}}).join(' ');
  path.setAttribute('d',d);path.setAttribute('transform',`${text.getAttribute('transform')??''} translate(${x-offset} ${y}) scale(${sx} ${sy})`);text.replaceWith(path);
 }
}
/** A single content-fitted vector page. All lettering is exported as vector outlines. */
export async function exportPDF(contents:string):Promise<Blob> {
 const {svg,width,height}=exportImageSource(contents);
 // jsPDF caps ordinary page dimensions at 14,400 PDF points. Never silently scale or crop.
 if(width>5080||height>5080)throw new Error('PDF is too large at actual size (maximum 5,080 mm per side). Reduce the drawing size or export SVG.');
 const doc=new jsPDF({unit:'mm',format:[width,height],orientation:width>height?'landscape':'portrait',compress:true,putOnlyUsedFonts:true,floatPrecision:12});
 doc.setProperties({title:'Vectora drawing',creator:'Vectora'});await outlineLabels(svg);
 svg.setAttribute('width',String(width));svg.setAttribute('height',String(height));
 await svg2pdf(svg,doc,{x:0,y:0,width,height});return doc.output('blob');
}
