import paper from 'paper';
import {documentPath} from './deletion';
import {pathsOf} from './geometry';
import {validNumber} from './units';
import type {Shape} from './types';

export type ShapeOperation='weld'|'subtract'|'intersect';
export const OPERATION_LABELS:Record<ShapeOperation,string>={weld:'Weld',subtract:'Subtract',intersect:'Intersect'};

export function eligibleForShapeOperation(sources:readonly Shape[]):boolean {
 return sources.length>1&&sources.every(s=>s.layer===sources[0].layer&&s.visible&&!s.locked&&s.layer?.visible&&!s.layer.locked&&!s.layer.data.deleted&&!s.data.text&&!s.data.dimension&&pathsOf(s).length>0&&pathsOf(s).every(p=>p.closed&&p.curves.length>1));
}

/** Boolean occupancy in document coordinates. Source items are never modified or inserted. */
export function buildShapeOperation(sources:readonly Shape[],operation:ShapeOperation):Shape {
 if(!eligibleForShapeOperation(sources))throw new Error('Select two or more closed paths on the same visible, unlocked layer. Convert text to paths first.');
 if(sources.length>100||sources.reduce((n,s)=>n+pathsOf(s).reduce((m,p)=>m+p.curves.length,0),0)>2000)throw new Error('This selection is too detailed. Work with fewer shapes at a time.');
 const sorted=[...sources].sort((a,b)=>a.index-b.index),base=sorted[0];
 const copy=(source:Shape):Shape=>{
  const paths=pathsOf(source).map(documentPath);
  const shape:Shape=paths.length===1?paths[0]:new paper.CompoundPath({insert:false,children:paths});
  shape.fillRule=source.fillRule;return shape;
 };
 let result=copy(base);
 try{
  for(const source of sorted.slice(1)){
   const operand=copy(source);
   try{
    const next=(operation==='weld'?result.unite(operand,{insert:false}):operation==='subtract'?result.subtract(operand,{insert:false}):result.intersect(operand,{insert:false})) as Shape;
    result.remove();result=next;
   }finally{operand.remove();}
   if(!pathsOf(result).some(p=>p.curves.length>1&&Math.abs(p.area)>1e-10))throw new Error('The result is empty. Choose another operation or adjust the shapes.');
   if(pathsOf(result).reduce((n,p)=>n+p.segments.length,0)>10000)throw new Error('The result is too detailed. Work with fewer shapes at a time.');
  }
  if(pathsOf(result).some(p=>!p.closed||p.segments.some(s=>[s.point,s.point.add(s.handleIn),s.point.add(s.handleOut)].some(q=>!validNumber(q.x)||!validNumber(q.y)))))throw new Error('The result exceeds the document bounds. Move the shapes closer to the origin.');
  result.style=base.style;result.opacity=base.opacity;result.fillRule='evenodd';
  result.data={uid:crypto.randomUUID(),role:base.data.role,name:OPERATION_LABELS[operation],rotationDegrees:0,customColour:base.data.customColour,fillPaint:base.data.fillPaint?structuredClone(base.data.fillPaint):undefined};
  // Preserve fill semantics when the result is transferred to another document layer.
  if(base.data.regionFill){result.data.regionFill=true;result.data.regionFillColor=base.data.regionFillColor;}
  if(base.data.rasterTrace?.mode==='fill')result.data.rasterTrace={mode:'fill'};
  return result;
 }catch(error){result.remove();throw error;}
}
