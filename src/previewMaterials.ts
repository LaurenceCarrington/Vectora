import type {PreviewModel} from './previewModel';
export const PREVIEW_MATERIALS=[
 {id:'plywood',name:'Birch plywood',base:'#cfaa77',edge:'#624025',mark:'#50311e',roughness:0.82,metalness:0,grain:'wood'},
 {id:'mdf',name:'MDF',base:'#ad8250',edge:'#705035',mark:'#42291b',roughness:0.95,metalness:0,grain:'noise'},
 {id:'acrylic',name:'Frosted acrylic',base:'#75a9b8',edge:'#365d6a',mark:'#edf9fc',roughness:0.24,metalness:0.05,grain:'plain'},
 {id:'aluminium',name:'Brushed aluminium',base:'#bac1c7',edge:'#727b84',mark:'#303840',roughness:0.36,metalness:0.7,grain:'metal'},
 {id:'leather',name:'Natural leather',base:'#a56438',edge:'#553522',mark:'#382218',roughness:0.92,metalness:0,grain:'noise'},
] as const;
export type PreviewMaterial=typeof PREVIEW_MATERIALS[number];
/** A deterministic material surface in document coordinates, with marks clipped by the mesh. */
export function materialCanvas(model:PreviewModel,material:PreviewMaterial,engraving:boolean):HTMLCanvasElement{
 const canvas=document.createElement('canvas'),b=model.bounds,size=1536;
 canvas.width=Math.max(32,Math.round(size*b.width/Math.max(b.width,b.height)));canvas.height=Math.max(32,Math.round(size*b.height/Math.max(b.width,b.height)));
 const ctx=canvas.getContext('2d')!;ctx.fillStyle=material.base;ctx.fillRect(0,0,canvas.width,canvas.height);
 let seed=1234567;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 if(material.grain==='wood'){
  for(let i=0;i<360;i++){const y=random()*canvas.height;ctx.strokeStyle=`rgba(80,42,15,${0.025+random()*0.065})`;ctx.lineWidth=0.4+random()*1.1;ctx.beginPath();ctx.moveTo(0,y);ctx.bezierCurveTo(canvas.width*.3,y+Math.sin(i)*22,canvas.width*.7,y+Math.cos(i)*16,canvas.width,y+Math.sin(i*.7)*20);ctx.stroke();}
 }else if(material.grain==='metal'){
  for(let y=0;y<canvas.height;y++){ctx.fillStyle=`rgba(255,255,255,${random()*.13})`;ctx.fillRect(0,y,canvas.width,1);}
 }else if(material.grain==='noise'){
  for(let i=0;i<45000;i++){ctx.fillStyle=random()>.5?'#ffffff0d':'#0000000c';ctx.fillRect(random()*canvas.width,random()*canvas.height,1,1);}
 }
 if(engraving){ctx.scale(canvas.width/b.width,canvas.height/b.height);ctx.translate(-b.x,-b.y);ctx.strokeStyle=material.mark;ctx.fillStyle=material.mark;ctx.lineWidth=.3;ctx.lineCap='round';ctx.lineJoin='round';for(const mark of model.marks){const path=new Path2D(mark.path);if(mark.fill)ctx.fill(path,mark.fillRule);else ctx.stroke(path);}}
 return canvas;
}
