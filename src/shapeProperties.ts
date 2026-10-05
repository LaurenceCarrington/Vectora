import paper from 'paper';
import {documentPath} from './deletion';
import {MIN_DIMENSION_MM,validNumber} from './units';
import type {Shape} from './types';
export type PreciseProperty='x'|'y'|'radius'|'length'|'angle'|'count';
export interface PreciseGeometry {kind:'circle'|'line'|'polygon'|'star'|'arc';x:number;y:number;radius?:number;length?:number;angle?:number;count?:number;direction?:number}
const normalized=(angle:number)=>((angle%360)+360)%360;
/** Recognise current geometry, never trust an object's editable name or stale primitive metadata. */
export function preciseGeometry(item:Shape|null):PreciseGeometry|null {
 if(!(item instanceof paper.Path)||item.data.text||item.data.dimension)return null;
 if(item.data.arc){const a=item.data.arc;return {kind:'arc',x:a.cx,y:a.cy,radius:a.radius};}
 if(item.segments.length>128)return null;
 const path=documentPath(item);
 try{
  if(!path.closed&&path.segments.length===2&&!path.hasHandles()){
   const start=path.firstSegment.point,delta=path.lastSegment.point.subtract(start);
   return delta.length>=MIN_DIMENSION_MM?{kind:'line',x:start.x,y:start.y,length:delta.length,angle:normalized(delta.angle)}:null;
  }
  const native=path.toShape(false);
  if(native){const type=native.type,radius=native.radius as number;native.remove();if(type==='circle')return {kind:'circle',x:path.bounds.center.x,y:path.bounds.center.y,radius};if(type==='rectangle'&&item.data.sides!==4)return null;}
  // Documents round coordinates to 12 decimals. Paper's strict kappa test can
  // reject saved small circles, so compare the four anchors and tangents in mm.
  if(path.closed&&path.segments.length===4&&path.hasHandles()){
   const centre=path.segments.reduce((sum,s)=>sum.add(s.point),new paper.Point(0,0)).divide(4);
   const first=path.firstSegment.point.subtract(centre),radius=first.length;
   const direction=Math.sign(first.cross(path.segments[1].point.subtract(centre)));
   const tolerance=Math.max(2e-11,radius*1e-10,Math.max(Math.abs(centre.x),Math.abs(centre.y))*Number.EPSILON*16);
   if(radius>=MIN_DIMENSION_MM-tolerance&&direction&&path.segments.every((s,i)=>{
    const radial=first.rotate(direction*i*90,new paper.Point(0,0)),tangent=radial.rotate(direction*90,new paper.Point(0,0)).multiply(.5522847498307936);
    return s.point.getDistance(centre.add(radial))<=tolerance&&s.handleOut.getDistance(tangent)<=tolerance&&s.handleIn.getDistance(tangent.multiply(-1))<=tolerance;
   }))return {kind:'circle',x:centre.x,y:centre.y,radius};
  }
  if(!path.closed||path.hasHandles()||path.segments.length<3||path.segments.length>128)return null;
  const points=path.segments.map(s=>s.point),centre=points.reduce((sum,p)=>sum.add(p),new paper.Point(0,0)).divide(points.length);
  const first=points[0].subtract(centre),radius=first.length;if(radius<MIN_DIMENSION_MM)return null;
  const direction=Math.sign(first.cross(points[1].subtract(centre)));if(!direction)return null;
  const tolerance=Math.max(1e-7,radius*1e-10);
  const matches=(star:boolean)=>points.every((point,i)=>{
   const angle=(first.angle+direction*i*360/points.length)*Math.PI/180,r=radius*(star&&i%2?.4:1);
   return point.getDistance(centre.add([r*Math.cos(angle),r*Math.sin(angle)]))<=tolerance;
  });
  if(points.length<=64&&matches(false))return {kind:'polygon',x:centre.x,y:centre.y,radius,count:points.length,angle:normalized(first.angle),direction};
  if(points.length%2===0&&points.length>=6&&matches(true))return {kind:'star',x:centre.x,y:centre.y,radius,count:points.length/2,angle:normalized(first.angle),direction};
  return null;
 }finally{path.remove();}
}
/** Edits a detached copy, preserving styling, identity, transformations and stacking. */
export function editedPreciseShape(source:paper.Path,geometry:PreciseGeometry,key:PreciseProperty,value:number):paper.Path {
 if(!validNumber(value))throw new Error('Enter a finite value within ±1,000,000.');
 if((key==='radius'||key==='length')&&value<MIN_DIMENSION_MM)throw new Error('Use a dimension of at least 0.001 mm.');
 if(key==='count'&&(!Number.isInteger(value)||value<3||value>64))throw new Error('Use a whole number from 3 to 64.');
 const copy=source.clone({insert:false}),pivot=new paper.Point(geometry.x,geometry.y),matrix=new paper.Matrix();
 try{
  if(key==='count'){
   if(geometry.kind!=='polygon'&&geometry.kind!=='star')throw new Error('This shape has no side or point count.');
   const vertices=geometry.kind==='star'?value*2:value;
   copy.removeSegments();copy.addSegments(Array.from({length:vertices},(_,i)=>{
    const angle=(geometry.angle!+geometry.direction!*i*360/vertices)*Math.PI/180,r=geometry.radius!*(geometry.kind==='star'&&i%2?.4:1);
    return new paper.Segment(source.globalToLocal(pivot.add([r*Math.cos(angle),r*Math.sin(angle)])));
   }));
   if(geometry.kind==='polygon')copy.data.sides=value;
  }else{
   if(key==='x'||key==='y')matrix.translate(key==='x'?[value-geometry.x,0]:[0,value-geometry.y]);
   else if(key==='radius'||key==='length')matrix.scale(value/(key==='radius'?geometry.radius!:geometry.length!),pivot);
   else if(key==='angle'){const delta=normalized(value)-geometry.angle!;matrix.rotate(delta,pivot);copy.data.rotationDegrees=normalized((source.data.rotationDegrees??0)+delta);}
   const parent=source.parent.globalMatrix;
   copy.transform(parent.inverted().append(matrix).append(parent));
   if(source.data.arc){const a=source.data.arc,centre=matrix.transform(new paper.Point(a.cx,a.cy));copy.data.arc={...a,cx:centre.x,cy:centre.y};}
  }
  const world=documentPath(copy);world.transform(source.parent.globalMatrix);const bounds=world.bounds;world.remove();
  if(![bounds.left,bounds.right,bounds.top,bounds.bottom].every(validNumber))throw new Error('The resulting shape exceeds the document coordinate limits.');
  return copy;
 }catch(error){copy.remove();throw error;}
}
