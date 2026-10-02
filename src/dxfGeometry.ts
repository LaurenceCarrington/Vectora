import type paper from 'paper';
import {createTextShape,isStrokeFont} from './text';
import {flattenInDocument,pathsOf,validateGeometryInput} from './geometry';
import {MAX_DXF_POINTS} from './processingLimits';
import {documentPath} from './deletion';
import {validNumber} from './units';
import type {Shape,Contour} from './types';

/** Both DXF formats share the same document-space curve tolerance and font geometry. */
export function exportContours(object:Shape,tolerance?:number,maxPoints=MAX_DXF_POINTS){
 validateDXFTolerance(tolerance);
 if(!object.data.text||!isStrokeFont(object.data.text.fontId))return flattenInDocument(object,tolerance,maxPoints);
 const strokes=createTextShape(object.data.text,true);
 try{return flattenInDocument(strokes,tolerance,maxPoints);}finally{strokes.remove();}
}

export interface CircularContour {kind:'CIRCLE'|'ARC';cx:number;cy:number;radius:number;start:number;end:number}
export type StandardContour=CircularContour|{kind:'LWPOLYLINE';contour:Contour};
export function validateDXFTolerance(tolerance?:number):void {
 if(tolerance!==undefined&&(!Number.isFinite(tolerance)||tolerance<.001||tolerance>1))throw new Error('DXF curve tolerance must be between 0.001 and 1 mm.');
}
const degrees=(n:number)=>{const a=(n*180/Math.PI%360+360)%360;return Math.abs(a-360)<1e-7||Math.abs(a)<1e-7?0:a;};
/** Recognise the actual circular cubic construction, never stale shape metadata.
 * Affine-distorted circles and locally edited handles fall back to polylines. */
function circularContour(path:paper.Path):CircularContour|null {
 let cx=0,cy=0,radius=0,total=0,start=0;
 const cross=(ax:number,ay:number,bx:number,by:number)=>ax*by-ay*bx;
 for(const [i,curve] of path.curves.entries()){
  const [x0,y0,x1,y1,x2,y2,x3,y3]=curve.values;
  const ux=x1-x0,uy=y1-y0,vx=x3-x2,vy=y3-y2;
  const ul=Math.hypot(ux,uy),vl=Math.hypot(vx,vy);if(ul<1e-12||vl<1e-12)return null;
  const n0x=-uy/ul,n0y=ux/ul,n1x=-vy/vl,n1y=vx/vl,den=cross(n0x,n0y,n1x,n1y);if(Math.abs(den)<1e-9)return null;
  const distance=cross(x3-x0,y3-y0,n1x,n1y)/den;
  const x=x0+n0x*distance,y=y0+n0y*distance,r=Math.abs(distance),eps=Math.max(1e-8,r*1e-9);
  const a0=Math.atan2(y0-y,x0-x),a1=Math.atan2(y3-y,x3-x),sweep=Math.atan2(Math.sin(a1-a0),Math.cos(a1-a0));
  if(r<.001||!validNumber(r)||Math.abs(sweep)<1e-8||Math.abs(sweep)>Math.PI/2+1e-7)return null;
  const k=4/3*Math.tan(Math.abs(sweep)/4)*Math.sign(sweep);
  if(Math.abs(Math.hypot(x3-x,y3-y)-r)>eps||Math.hypot(ux+(y0-y)*k,uy-(x0-x)*k)>eps||Math.hypot(vx+(y3-y)*k,vy-(x3-x)*k)>eps)return null;
  if(i===0){cx=x;cy=y;radius=r;start=a0;}else if(Math.hypot(cx-x,cy-y)>eps||Math.abs(radius-r)>eps||total*sweep<=0)return null;
  total+=sweep;
 }
 if(!total||!validNumber(cx)||!validNumber(cy))return null;
 if(path.closed?Math.abs(Math.abs(total)-Math.PI*2)>1e-7:Math.abs(total)>=Math.PI*2-1e-7)return null;
 // DXF arcs run counterclockwise in Y-up coordinates; reversing endpoints retains the locus.
 return {kind:path.closed?'CIRCLE':'ARC',cx,cy:-cy,radius,start:degrees(-(total>0?start+total:start)),end:degrees(-(total>0?start:start+total))};
}
export function standardContours(object:Shape,tolerance?:number,maxPoints=MAX_DXF_POINTS):StandardContour[]{
 validateGeometryInput([object]);
 if(object.data.text||object.data.dimension)return exportContours(object,tolerance,maxPoints).map(contour=>({kind:'LWPOLYLINE',contour}));
 let remaining=maxPoints;
 return pathsOf(object).flatMap<StandardContour>(source=>{
  const path=documentPath(source);
  try{
   const circular=circularContour(path);
   if(circular){if(remaining<1)throw new Error('This drawing has too many curve points to export. Process fewer objects.');remaining--;return [circular];}
   const contours=flattenInDocument(path,tolerance,remaining);remaining-=contours.reduce((n,c)=>n+c.points.length,0);
   return contours.map(contour=>({kind:'LWPOLYLINE' as const,contour}));
  }finally{path.remove();}
 });
}
/** Extrema in DXF coordinates, including cardinal points on the counterclockwise arc. */
export function circularBounds(c: CircularContour):{x:number;y:number}[]{
 const angles=c.kind==='CIRCLE'?[0,90,180,270]:[c.start,c.end,...[0,90,180,270].filter(a=>(a-c.start+360)%360<=(c.end-c.start+360)%360+1e-7)];
 return angles.map(a=>({x:c.cx+c.radius*Math.cos(a*Math.PI/180),y:c.cy+c.radius*Math.sin(a*Math.PI/180)}));
}
