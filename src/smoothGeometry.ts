import paper from 'paper';
import {preciseGeometry} from './shapeProperties';
import {validNumber} from './units';

export interface SmoothSettings {strength:number;detail:number}
/** Four cubic quadrants stay exact after any affine transformation, including shear. */
function affineEllipse(path:paper.Path):boolean {
 if(!path.closed||path.segments.length!==4)return false;
 const centre=path.segments.reduce((sum,s)=>sum.add(s.point),new paper.Point(0,0)).divide(4),u=path.segments[0].point.subtract(centre),v=path.segments[1].point.subtract(centre);
 const k=.5522847498307936,radials=[u,v,u.multiply(-1),v.multiply(-1)],out=[v.multiply(k),u.multiply(-k),v.multiply(-k),u.multiply(k)];
 const tolerance=Math.max(2e-11,Math.max(u.length,v.length)*1e-9,Math.max(Math.abs(centre.x),Math.abs(centre.y))*Number.EPSILON*16);
 return Math.abs(u.cross(v))>1e-14&&path.segments.every((s,i)=>s.point.getDistance(centre.add(radials[i]))<=tolerance&&s.handleOut.getDistance(out[i])<=tolerance&&s.handleIn.getDistance(out[i].multiply(-1))<=tolerance);
}
/** Joined/exploded arcs may no longer carry their original primitive metadata. */
function circularCubics(path:paper.Path):boolean {
 let centre:paper.Point|null=null,radius=0;
 return path.curves.every(curve=>{
  const a=curve.segment1,b=curve.segment2;
  if(!a.handleOut.length||!b.handleIn.length)return false;
  const zero=new paper.Point(0,0),n0=a.handleOut.normalize().rotate(90,zero),n1=b.handleIn.normalize().rotate(90,zero),cross=n0.cross(n1);
  if(Math.abs(cross)<1e-10)return false;
  const c=a.point.add(n0.multiply(b.point.subtract(a.point).cross(n1)/cross)),u=a.point.subtract(c),v=b.point.subtract(c),r=u.length;
  const tolerance=Math.max(2e-11,r*1e-8,Math.max(Math.abs(c.x),Math.abs(c.y))*Number.EPSILON*32);
  if(!r||Math.abs(v.length-r)>tolerance||(centre&&(centre.getDistance(c)>tolerance||Math.abs(radius-r)>tolerance)))return false;
  const sweep=u.getDirectedAngle(v),k=4/3*Math.tan(Math.abs(sweep)*Math.PI/720),direction=Math.sign(sweep);
  if(!direction||Math.abs(sweep)>90.000001||a.handleOut.getDistance(u.rotate(direction*90,zero).multiply(k))>tolerance||b.handleIn.getDistance(v.rotate(-direction*90,zero).multiply(k))>tolerance)return false;
  centre=c;radius=r;return true;
 });
}
/** Work in document millimetres. Split at real corners before fitting each run. */
export function smoothPath(source:paper.Path,settings:SmoothSettings):paper.Path {
 const result=source.clone({insert:false}) as paper.Path;
 const strength=Math.max(0,Math.min(1,settings.strength/100)),detail=Math.max(0,settings.detail);
 if((!strength&&!detail)||source.segments.length<3)return result;
 if(affineEllipse(source)||preciseGeometry(source)||circularCubics(source))return result;
 const native=source.toShape(false);if(native){native.remove();return result;}
 const segments=source.segments,n=segments.length;
 const pins:number[]=[];
 for(let i=0;i<n;i++){
  if(!source.closed&&(i===0||i===n-1)){pins.push(i);continue;}
  const s=segments[i],previous=segments[(i+n-1)%n],next=segments[(i+1)%n];
  const incoming=s.handleIn.length?s.handleIn.multiply(-1):s.point.subtract(previous.point);
  const outgoing=s.handleOut.length?s.handleOut:next.point.subtract(s.point);
  if(!incoming.length||!outgoing.length)continue;
  const angle=Math.abs(incoming.getDirectedAngle(outgoing));
  // A one-node zigzag is jitter; a sustained change in direction is a corner.
  const span=Math.min(3,Math.floor((n-1)/2));
  const a=segments[source.closed?(i-span+n)%n:Math.max(0,i-span)].point;
  const b=segments[source.closed?(i+span)%n:Math.min(n-1,i+span)].point;
  const sustained=Math.abs(s.point.subtract(a).getDirectedAngle(b.subtract(s.point)));
  if(angle>=25&&(s.handleIn.length||s.handleOut.length||sustained>=25))pins.push(i);
 }
 const soften=(input:paper.Segment[],closed:boolean):paper.Segment[]=>{
  const run=new paper.Path({insert:false,segments:input.map(s=>s.clone()),closed});
  // Move only unhandled noisy anchors; fitted curve anchors retain their position.
  for(let pass=0;pass<3;pass++){
   const points=run.segments.map(s=>s.point.clone());
   for(let i=0;i<points.length;i++){
    const s=run.segments[i];if(!closed&&(i===0||i===points.length-1)||s.handleIn.length||s.handleOut.length)continue;
    const mean=points[(i+points.length-1)%points.length].add(points[(i+1)%points.length]).divide(2);
    s.point=points[i].add(mean.subtract(points[i]).multiply(strength*.4));
   }
  }
  if(detail>0&&run.segments.length>2){
   const fitted=run.clone({insert:false}) as paper.Path;
   fitted.simplify(detail);
   // Never collapse a contour or a small hole into an empty/degenerate path.
   if(fitted.segments.length>=(closed?3:2)&&(!closed||Math.abs(fitted.area)>1e-8)){
    run.removeSegments();run.addSegments(fitted.segments.map(s=>s.clone()));
   }
   fitted.remove();
  }
  if(strength&&run.segments.length>2){
   const handles=run.segments.map(s=>[s.handleIn.clone(),s.handleOut.clone()]);
   run.smooth({type:'catmull-rom',factor:.5});
   run.segments.forEach((s,i)=>{s.handleIn=handles[i][0].add(s.handleIn.subtract(handles[i][0]).multiply(strength));s.handleOut=handles[i][1].add(s.handleOut.subtract(handles[i][1]).multiply(strength));});
  }
  const output=run.segments.map(s=>s.clone());run.remove();return output;
 };
 if(!pins.length){result.removeSegments();result.addSegments(soften(segments,true));return result;}
 const output:paper.Segment[]=[];
 const count=source.closed?pins.length:pins.length-1;
 for(let run=0;run<count;run++){
  const start=pins[run],end=pins[(run+1)%pins.length],input:paper.Segment[]=[];
  for(let i=start;;i=(i+1)%n){input.push(segments[i]);if(i===end&&(i!==start||input.length>1))break;if(input.length>n){input.push(segments[end]);break;}}
  const smoothed=soften(input,false);
  if(output.length){output[output.length-1].handleOut=smoothed[0].handleOut;output.push(...smoothed.slice(1));}else output.push(...smoothed);
 }
 if(source.closed&&output.length>1){output[0].handleIn=output[output.length-1].handleIn;output.pop();}
 result.removeSegments();result.addSegments(output);return result;
}

/** Cache the original topology once; curves are compared only within one selected object. */
export function contourTopology(paths:paper.Path[]):string {
 const contours:unknown[]=[],relations:(number|boolean)[][]=[];
 for(let i=0;i<paths.length;i++){
  const a=paths[i];contours.push([a.closed,a.closed?Math.sign(a.area):0,a.getIntersections(a).length]);
 }
 const sorted=paths.map((path,index)=>({path,index,bounds:path.bounds})).sort((a,b)=>a.bounds.left-b.bounds.left);
 let candidates=0;
 for(let i=0;i<sorted.length;i++){
  const a=sorted[i];
  for(let j=i+1;j<sorted.length&&sorted[j].bounds.left<=a.bounds.right;j++){
   const b=sorted[j];if(!a.bounds.intersects(b.bounds))continue;
   // A pathological overlapping compound cannot monopolise a live UI gesture.
   if(++candidates>100000)throw new Error('Too many overlapping contours. Explode the object and smooth smaller selections.');
   const first=a.index<b.index?a:b,second=first===a?b:a;
   const intersections=first.path.getIntersections(second.path).length;
   const containsFirst=first.path.closed&&first.path.contains(second.path.firstSegment.point),containsSecond=second.path.closed&&second.path.contains(first.path.firstSegment.point);
   if(intersections||containsFirst||containsSecond)relations.push([first.index,second.index,intersections,containsFirst,containsSecond]);
  }
 }
 relations.sort((a,b)=>(a[0] as number)-(b[0] as number)||(a[1] as number)-(b[1] as number));
 return JSON.stringify([contours,relations]);
}
export function validSmoothedContours(paths:paper.Path[],topology:string):boolean {
 return paths.every(path=>path.segments.length>=(path.closed?3:2)&&(!path.closed||Math.abs(path.area)>1e-10)&&path.segments.every(s=>[s.point.x,s.point.y,s.point.x+s.handleIn.x,s.point.y+s.handleIn.y,s.point.x+s.handleOut.x,s.point.y+s.handleOut.y].every(validNumber)))&&contourTopology(paths)===topology;
}
