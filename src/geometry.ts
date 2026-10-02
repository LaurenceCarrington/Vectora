import paper from 'paper';
import type { Contour, Shape, Vertex } from './types';
import { geometrySettings, NUMERIC_EPSILON_MM as EPS, validNumber } from './units';
import {MAX_SOURCE_SEGMENTS,MAX_SOURCE_CONTOURS,MAX_FLATTEN_POINTS,MAX_DXF_POINTS} from './processingLimits';
export function pathsOf(source: Shape): paper.Path[] {
  return source instanceof paper.Path ? [source] : source.children as paper.Path[];
}
export function cleanVertices(points: Vertex[], closed: boolean): Vertex[] {
  const result: Vertex[] = [];
  for (const p of points) {
    if (!validNumber(p.x) || !validNumber(p.y)) throw new Error('Geometry exceeds the supported coordinate range (±1,000,000 mm).');
    const last = result.at(-1);
    if (!last || Math.hypot(p.x-last.x, p.y-last.y) > EPS) result.push({x:p.x,y:p.y});
  }
  if (closed && result.length > 1 && distance(result[0],result[result.length-1]) <= EPS) result.pop();
  return result;
}
export function validateGeometryInput(objects:readonly Shape[]):void {
  let segments=0,contours=0;
  for(const object of objects)for(const path of pathsOf(object)){
    if(++contours>MAX_SOURCE_CONTOURS||(segments+=path.segments.length)>MAX_SOURCE_SEGMENTS)
      throw new Error('This geometry is too complex to process. Simplify the paths or process fewer objects.');
  }
}
// Paper 0.12.18 exposes these scalar cubic operations at runtime but omits
// their declarations. Use its own predicates to preserve Path.flatten semantics.
const cubic=paper.Curve as unknown as {
  isStraight(values:number[]):boolean;
  isFlatEnough(values:number[],tolerance:number):boolean;
  subdivide(values:number[],time:number):[number[],number[]];
};
export function flattenInDocument(source: Shape, toleranceMM=geometrySettings.flattenToleranceMM,maxPoints=MAX_FLATTEN_POINTS): Contour[] {
  if(!Number.isFinite(toleranceMM)||toleranceMM<=0||!Number.isInteger(maxPoints)||maxPoints<0||maxPoints>MAX_DXF_POINTS)throw new Error('Invalid curve processing limits.');
  validateGeometryInput([source]);
  let count=0;
  return pathsOf(source).map(path=>{
    const points:Vertex[]=[];let end:Vertex|undefined;
    const append=(x:number,y:number)=>{
      if(!validNumber(x)||!validNumber(y))throw new Error('Geometry exceeds the supported coordinate range (±1,000,000 mm).');
      const last=points.at(-1);if(last&&Math.hypot(x-last.x,y-last.y)<=EPS)return;
      if(count>=maxPoints)throw new Error('This geometry has too many curve points. Simplify the paths, increase the curve tolerance or process fewer objects.');
      count++;points.push({x,y});
    };
    const visit=(values:number[],depth:number):void=>{
      // Match Paper's 1/256 minimum parameter span, without its unbounded
      // parts/Segment/Path allocations. The budget is enforced on every point.
      if(depth<8&&!cubic.isStraight(values)&&!cubic.isFlatEnough(values,toleranceMM)){
        const halves=cubic.subdivide(values,.5);visit(halves[0],depth+1);visit(halves[1],depth+1);
      }else if(Math.hypot(values[6]-values[0],values[7]-values[1])>0){
        append(values[0],values[1]);end={x:values[6],y:values[7]};
      }
    };
    const length=path.segments.length,curves=path.closed?length:Math.max(0,length-1);
    for(let i=0;i<curves;i++){
      const a=path.segments[i],b=path.segments[(i+1)%length];
      // Tolerance is in document mm, including all ancestor transforms.
      const p0=path.localToGlobal(a.point),p1=path.localToGlobal(a.point.add(a.handleOut)),p2=path.localToGlobal(b.point.add(b.handleIn)),p3=path.localToGlobal(b.point);
      visit([p0.x,p0.y,p1.x,p1.y,p2.x,p2.y,p3.x,p3.y],0);
    }
    if(!path.closed&&end)append(end.x,end.y);
    if(path.closed&&points.length>1&&distance(points[0],points[points.length-1])<=EPS){points.pop();count--;}
    return {closed:path.closed,points};
  });
}
export function distance(a:Vertex,b:Vertex):number { return Math.hypot(a.x-b.x,a.y-b.y); }
export function signedArea(p:Vertex[]):number { return p.reduce((a,v,i)=> {const w=p[(i+1)%p.length]; return a+v.x*w.y-w.x*v.y;},0)/2; }
function cross(a:Vertex,b:Vertex,c:Vertex):number { return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x); }
function onSegment(a:Vertex,b:Vertex,p:Vertex):boolean {
  return Math.abs(cross(a,b,p))<=EPS && p.x>=Math.min(a.x,b.x)-EPS && p.x<=Math.max(a.x,b.x)+EPS && p.y>=Math.min(a.y,b.y)-EPS && p.y<=Math.max(a.y,b.y)+EPS;
}
function intersects(a:Vertex,b:Vertex,c:Vertex,d:Vertex):boolean {
  const abC=cross(a,b,c),abD=cross(a,b,d),cdA=cross(c,d,a),cdB=cross(c,d,b);
  return (abC*abD<0 && cdA*cdB<0) || onSegment(a,b,c)||onSegment(a,b,d)||onSegment(c,d,a)||onSegment(c,d,b);
}
export function contains(p:Vertex[], v:Vertex):boolean {
  let inside=false;
  for(let i=0,j=p.length-1;i<p.length;j=i++) {
    const a=p[i],b=p[j];
    if((a.y>v.y)!==(b.y>v.y) && v.x<(b.x-a.x)*(v.y-a.y)/(b.y-a.y)+a.x) inside=!inside;
  }
  return inside;
}
export function exteriorContours(contours:Contour[]):Contour[] {
  return contours.filter((c,i)=>!contours.some((other,j)=>i!==j && Math.abs(signedArea(other.points))>Math.abs(signedArea(c.points)) && contains(other.points,c.points[0])));
}
export function validateOutlineContours(contours:Contour[]):void {
  if(!contours.length) throw new Error('Select a closed shape first.');
  for(const {points:p,closed} of contours) {
    if(!closed) throw new Error('Sticker outlines require closed paths.');
    if(p.length<3 || Math.abs(signedArea(p))<EPS) throw new Error('The selected shape is degenerate or self-intersecting.');
    if(p.length>12000) throw new Error('This shape has too many vertices for the MVP. Increase the curve tolerance.');
    for(let i=0;i<p.length;i++) {
      const prev=p[(i+p.length-1)%p.length],next=p[(i+1)%p.length];
      if(Math.abs(cross(prev,p[i],next))<=EPS && (prev.x-p[i].x)*(next.x-p[i].x)+(prev.y-p[i].y)*(next.y-p[i].y)>EPS) throw new Error('The selected path doubles back on itself.');
      for(let j=i+1;j<p.length;j++) {
        if(j===i+1 || (i===0 && j===p.length-1)) continue;
        if(intersects(p[i],next,p[j],p[(j+1)%p.length])) throw new Error('Self-intersecting paths cannot produce a sticker outline.');
      }
    }
  }
  for(let i=0;i<contours.length;i++) for(let j=i+1;j<contours.length;j++) {
    const a=contours[i].points,b=contours[j].points;
    for(let k=0;k<a.length;k++) for(let l=0;l<b.length;l++) if(intersects(a[k],a[(k+1)%a.length],b[l],b[(l+1)%b.length])) throw new Error('Contours must not cross or touch one another.');
  }
}
