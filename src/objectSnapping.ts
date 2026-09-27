import paper from 'paper';
import { documentPath } from './deletion';
import { pathsOf } from './geometry';
import type { Shape } from './types';

export const SNAP_LABELS = { intersection:'Intersection', nearest:'Nearest', centre:'Centre', tangent:'Tangent', perpendicular:'Perpendicular' } as const;
export type ObjectSnapMode = keyof typeof SNAP_LABELS;
export type SnapModes = Record<ObjectSnapMode, boolean>;
export interface ObjectSnap { point:paper.Point; mode:ObjectSnapMode }

/** All real roots in [0,1], including repeated roots, without flattening curves. */
function roots(coefficients:number[]):number[] {
  const scale=Math.max(...coefficients.map(Math.abs));
  if(scale<1e-20)return [];
  const c=coefficients.map(n=>n/scale);
  while(c.length>1&&Math.abs(c[c.length-1])<1e-12)c.pop();
  const value=(t:number)=>c.reduceRight((sum,n)=>sum*t+n,0);
  if(c.length===1)return [];
  if(c.length===2){const t=-c[0]/c[1];return t>=0&&t<=1?[t]:[];}
  const cuts=[0,...roots(c.slice(1).map((n,i)=>n*(i+1))),1].sort((a,b)=>a-b);
  const result=cuts.filter(t=>Math.abs(value(t))<1e-10);
  for(let i=1;i<cuts.length;i++){
    let a=cuts[i-1],b=cuts[i],fa=value(a);
    if(fa*value(b)>=0)continue;
    for(let j=0;j<55;j++){const mid=(a+b)/2,fm=value(mid);if(fa*fm<=0)b=mid;else{a=mid;fa=fm;}}
    result.push((a+b)/2);
  }
  return result.sort((a,b)=>a-b).filter((t,i,all)=>i===0||t-all[i-1]>1e-8);
}

function tangencies(curve:paper.Curve,anchor:paper.Point):paper.Point[] {
  if(curve.isStraight())return [];
  const v=curve.values,p=[0,2,4,6].map(i=>new paper.Point(v[i],v[i+1]));
  const b=[p[0].subtract(anchor),p[1].subtract(p[0]).multiply(3),p[2].subtract(p[1].multiply(2)).add(p[0]).multiply(3),p[3].subtract(p[2].multiply(3)).add(p[1].multiply(3)).subtract(p[0])];
  const d=[b[1],b[2].multiply(2),b[3].multiply(3)],polynomial=Array(6).fill(0) as number[];
  b.forEach((a,i)=>d.forEach((derivative,j)=>polynomial[i+j]+=a.cross(derivative)));
  return roots(polynomial).flatMap(t=>{
    const point=curve.getPointAtTime(t),tangent=curve.getTangentAtTime(t);
    return point&&tangent&&point.getDistance(anchor)>1e-7&&tangent.length>1e-10?[point]:[];
  });
}

/** Centre of a circular three-point arc; reject deformed, noncircular paths. */
function arcCentre(path:paper.Path):paper.Point|null {
  const curve=path.curves.find(c=>!c.isStraight());if(!curve)return null;
  const a=curve.point1,b=curve.point2,n=curve.getNormalAtTime(0),m=curve.getNormalAtTime(1);
  if(!n||!m||Math.abs(n.cross(m))<1e-9)return null;
  const center=a.add(n.multiply(b.subtract(a).cross(m)/n.cross(m))),radius=center.getDistance(a);
  if(radius<1e-8)return null;
  for(const c of path.curves)for(const t of [0,0.5,1]){
    const point=c.getPointAtTime(t),normal=c.getNormalAtTime(t);
    if(!point||!normal||Math.abs(point.getDistance(center)-radius)>radius*0.0004||Math.abs(point.subtract(center).normalize().cross(normal))>0.002)return null;
  }
  return center;
}

/** Resolve against visible document geometry; locked reference objects are allowed. */
export function findObjectSnap(objects:readonly Shape[],cursor:paper.Point,tolerance:number,modes:SnapModes,anchor?:paper.Point,excluded:readonly Shape[]=[]):ObjectSnap|null {
  if(!Object.values(modes).some(Boolean))return null;
  const candidates:ObjectSnap[]=[];
  const add=(point:paper.Point|null,mode:ObjectSnapMode)=>{if(point&&point.getDistance(cursor)<=tolerance)candidates.push({point,mode});};
  const copies:paper.Path[]=[];
  try{
    const nearby:paper.Path[]=[];
    for(const owner of objects){
      if(!owner.visible||!owner.layer.visible||excluded.includes(owner))continue;
      if(modes.centre&&owner instanceof paper.Path){
        if(owner.data.arc)add(new paper.Point(owner.data.arc.cx,owner.data.arc.cy),'centre');
        else if(owner.closed&&['Circle','Ellipse'].includes(owner.data.name))add(owner.bounds.center,'centre');
      }
      for(const source of pathsOf(owner)){
        const copy=documentPath(source);copies.push(copy);
        if(modes.centre&&owner.data.name==='Arc'&&!owner.data.arc)add(arcCentre(copy),'centre');
        if(!copy.bounds.expand(tolerance*2).contains(cursor))continue;
        nearby.push(copy);
        if(modes.nearest)add(copy.getNearestPoint(cursor),'nearest');
        if(anchor)for(const curve of copy.curves){
          if(!curve.bounds.expand(tolerance*2).contains(cursor))continue;
          if(modes.tangent)for(const point of tangencies(curve,anchor))add(point,'tangent');
          if(modes.perpendicular&&curve.isStraight()){
            const start=curve.point1,delta=curve.point2.subtract(start),length2=delta.dot(delta);
            if(length2<1e-16)continue;
            const t=anchor.subtract(start).dot(delta)/length2;
            if(t>=0&&t<=1){const point=start.add(delta.multiply(t));if(point.getDistance(anchor)>1e-7)add(point,'perpendicular');}
          }
        }
      }
    }
    if(modes.intersection)for(let i=0;i<nearby.length;i++)for(let j=i;j<nearby.length;j++){
      if(i!==j&&!nearby[i].bounds.intersects(nearby[j].bounds))continue;
      for(const hit of nearby[i].getIntersections(nearby[j]))add(hit.point,'intersection');
    }
    // Discrete construction points win over the continuous nearest-point fallback.
    const rank=(mode:ObjectSnapMode)=>mode==='nearest'?1:0;
    candidates.sort((a,b)=>rank(a.mode)-rank(b.mode)||a.point.getDistance(cursor)-b.point.getDistance(cursor));
    return candidates[0]??null;
  }finally{copies.forEach(path=>path.remove());}
}
