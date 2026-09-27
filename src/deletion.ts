import paper from 'paper';
import { pathsOf } from './geometry';
import { NUMERIC_EPSILON_MM as EPS } from './units';
import type { Shape } from './types';

export interface DeletePlan { owner:Shape; preview:paper.Path[]; remaining:paper.Path[]|null }
/** Copies Bézier geometry into document mm, including all parent transforms. */
export function documentPath(source:paper.Path):paper.Path {
  return new paper.Path({insert:false,closed:source.closed,segments:source.segments.map(segment=>{
    const point=source.localToGlobal(segment.point);
    return new paper.Segment(point,source.localToGlobal(segment.point.add(segment.handleIn)).subtract(point),source.localToGlobal(segment.point.add(segment.handleOut)).subtract(point));
  })});
}
export function disposeDeletePlan(plan:DeletePlan|null):void {
  if(plan)for(const path of [...plan.preview,...(plan.remaining??[])])path.remove();
}
/** Existing anchors and intersections bound deletable sections, without flattening or grid rounding. */
function dissect(target:paper.Path,boundaries:paper.Path[],point:paper.Point):{removed:paper.Path;remaining:paper.Path[]}|null {
  const length=target.length,location=target.getNearestLocation(point);
  if(!location||length<=EPS)return null;
  const offsets:number[]=[0];
  let distance=0;
  for(const curve of target.curves){distance+=curve.length;offsets.push(distance);}
  for(const boundary of boundaries){
    for(const hit of target.getIntersections(boundary)){
      offsets.push(hit.offset);
      if(boundary===target)offsets.push(hit.intersection.offset);
    }
  }
  const cuts=offsets.map(offset=>target.closed&&length-offset<EPS?0:offset).sort((a,b)=>a-b).filter((offset,i,all)=>(i===0||offset-all[i-1]>EPS)&&(target.closed||offset>EPS&&offset<length-EPS));
  if(cuts.length<(target.closed?2:1))return {removed:target.clone({insert:false}) as paper.Path,remaining:[]};
  const copy=target.clone({insert:false}) as paper.Path;
  const base=target.closed?cuts[0]:0;
  if(target.closed)copy.splitAt(base);
  const breaks=cuts.map(cut=>cut-base).filter(cut=>cut>EPS&&cut<length-EPS);
  const parts:paper.Path[]=[];
  for(const cut of [...breaks].reverse()){
    const tail=copy.splitAt(cut);
    if(!tail){copy.remove();parts.forEach(path=>path.remove());throw new Error('Could not split this section. Try another point on the line.');}
    parts.unshift(tail);
  }
  parts.unshift(copy);
  const offset=target.closed?(location.offset-base+length)%length:location.offset;
  const index=breaks.filter(cut=>cut<=offset+EPS).length;
  const [removed]=parts.splice(index,1);
  // Keep each surviving run connected; break only where geometry was deleted.
  const joinRun=(run:paper.Path[]):paper.Path[]=>{
    if(!run.length)return [];
    const first=run[0];for(const next of run.slice(1))first.join(next,EPS);
    return [first];
  };
  const remaining=target.closed?joinRun([...parts.slice(index),...parts.slice(0,index)]):[...joinRun(parts.slice(0,index)),...joinRun(parts.slice(index))];
  return {removed,remaining};
}
export function createDeletePlan(objects:readonly Shape[],point:paper.Point,tolerance:number,mode:'dissect-delete'|'line-delete'):DeletePlan|null {
  const entries=objects.filter(owner=>owner.layer.visible).map(owner=>({owner,paths:pathsOf(owner).map(documentPath)}));
  try{
    for(const entry of [...entries].reverse()){
      if(entry.owner.layer.locked)continue;
      const target=[...entry.paths].reverse().find(path=>{const location=path.getNearestLocation(point);return location&&location.point.getDistance(point)<=tolerance;});
      if(!target)continue;
      if(mode==='line-delete')return {owner:entry.owner,preview:entry.paths.map(path=>path.clone({insert:false}) as paper.Path),remaining:null};
      const result=dissect(target,entries.flatMap(entry=>entry.paths),point);
      if(!result)return null;
      const remaining=entry.paths.flatMap(path=>path===target?result.remaining:[path.clone({insert:false}) as paper.Path]);
      return {owner:entry.owner,preview:[result.removed],remaining};
    }
    return null;
  }finally{for(const entry of entries)entry.paths.forEach(path=>path.remove());}
}
