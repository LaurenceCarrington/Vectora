import paper from 'paper';
import {pathsOf} from './geometry';
import {transformText} from './text';
import {validNumber,MIN_DIMENSION_MM} from './units';
import type {Shape} from './types';

export type PatternKind='rectangular'|'circular';
export type PatternSettings=
 | {kind:'rectangular';rows:number;columns:number;dx:number;dy:number}
 | {kind:'circular';count:number;angle:number;cx:number;cy:number;rotate:boolean};
export interface PatternCopy {source:Shape;copy:Shape}
const MAX_OBJECTS=1000,MAX_NODES=100_000;
const count=(n:number)=>Number.isInteger(n)&&n>=1&&n<=MAX_OBJECTS;
const normalAngle=(n:number)=>((n%360)+360)%360;

/** Instance zero is the unchanged source selection. Validate budgets before allocating copies. */
export function buildObjectPattern(sources:readonly Shape[],settings:PatternSettings,anchor:paper.Point):{copies:PatternCopy[];instances:number} {
 let instances:number;
 if(settings.kind==='rectangular'){
  if(!count(settings.rows)||!count(settings.columns))throw new Error('Rows and columns must be whole numbers from 1 to 1,000.');
  if(!validNumber(settings.dx)||!validNumber(settings.dy))throw new Error('Enter finite spacing within ±1,000,000 mm.');
  if(settings.columns>1&&Math.abs(settings.dx)<MIN_DIMENSION_MM||settings.rows>1&&Math.abs(settings.dy)<MIN_DIMENSION_MM)throw new Error('Repeated rows and columns need at least 0.001 mm spacing.');
  instances=settings.rows*settings.columns;
 }else{
  if(!count(settings.count))throw new Error('Instances must be a whole number from 2 to 1,000.');
  if(!Number.isFinite(settings.angle)||Math.abs(settings.angle)<.001||Math.abs(settings.angle)>360)throw new Error('Enter a total angle from −360° to 360°, excluding zero.');
  if(!validNumber(settings.cx)||!validNumber(settings.cy))throw new Error('Enter a centre within ±1,000,000 mm.');
  if(!settings.rotate&&anchor.getDistance(new paper.Point(settings.cx,settings.cy))<MIN_DIMENSION_MM)throw new Error('Choose a centre away from the selection, or enable Rotate copies.');
  instances=settings.count;
 }
 if(instances<2)throw new Error('Choose at least two instances, including the original.');
 if(!sources.length||instances*sources.length>MAX_OBJECTS)throw new Error('Keep the pattern within 1,000 total objects, including originals.');
 const nodes=sources.reduce((sum,source)=>sum+pathsOf(source).reduce((n,path)=>n+path.segments.length,0),0);
 if(instances*nodes>MAX_NODES)throw new Error('This selection is too detailed for that many copies. Reduce the instance count.');
 // Selection order is a user gesture, not stacking order. Keep each motif visually identical.
 const ordered=[...sources].sort((a,b)=>a.layer.index-b.layer.index||a.index-b.index);
 const copies:PatternCopy[]=[];
 try{
  for(let i=1;i<instances;i++){
   let matrix:paper.Matrix,rotation=0;
   if(settings.kind==='rectangular')matrix=new paper.Matrix().translate(new paper.Point((i%settings.columns)*settings.dx,Math.floor(i/settings.columns)*settings.dy));
   else{
    const center=new paper.Point(settings.cx,settings.cy),angle=settings.angle*i/(Math.abs(settings.angle)===360?instances:instances-1);
    if(settings.rotate){matrix=new paper.Matrix().rotate(angle,center);rotation=angle;}
    else matrix=new paper.Matrix().translate(anchor.rotate(angle,center).subtract(anchor));
   }
   for(const source of ordered){
    const copy=source.clone({insert:false}) as Shape;copies.push({source,copy});
    copy.data={...structuredClone(source.data),uid:crypto.randomUUID()};
    copy.transform(matrix);transformText(copy,matrix);
    if(rotation)copy.data.rotationDegrees=normalAngle((source.data.rotationDegrees??0)+rotation);
    if(source.data.arc){const arc=source.data.arc,center=matrix.transform(new paper.Point(arc.cx,arc.cy));copy.data.arc={...arc,cx:center.x,cy:center.y,start:normalAngle(arc.start+rotation)};}
    const b=copy.bounds;
    if(![b.left,b.top,b.right,b.bottom].every(validNumber)||!pathsOf(copy).every(path=>path.segments.every(s=>[s.point,s.point.add(s.handleIn),s.point.add(s.handleOut)].every(p=>{const q=path.localToGlobal(p);return validNumber(q.x)&&validNumber(q.y);}))))throw new Error('The pattern would exceed the document coordinate limits.');
   }
  }
  return {copies,instances};
 }catch(error){copies.forEach(({copy})=>copy.remove());throw error;}
}
