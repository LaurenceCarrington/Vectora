import paper from 'paper';
import {documentPath} from './deletion';
import {NUMERIC_EPSILON_MM as EPS,validDimension,validNumber} from './units';
export type CornerKind='fillet'|'chamfer';
function corner(path:paper.Path,index:number){
 const node=path.segments[index],prev=node?.previous,next=node?.next;
 if(!node||!prev||!next||prev===next)throw new Error('Choose an interior corner with two adjoining straight edges.');
 const incoming=prev.curve,outgoing=node.curve;
 if(!incoming?.isStraight()||!outgoing?.isStraight())throw new Error('Fillet and chamfer require two adjoining straight edges.');
 const a=prev.point.subtract(node.point),b=next.point.subtract(node.point);
 if(a.length<=EPS||b.length<=EPS)throw new Error('The corner has a zero-length edge.');
 const u=a.normalize(),v=b.normalize(),angle=Math.acos(Math.max(-1,Math.min(1,u.dot(v))));
 if(angle<1e-6||Math.PI-angle<1e-6)throw new Error('Choose a sharp corner, rather than a straight or folded-back node.');
 return {node,prev,next,u,v,angle};
}
export function canRoundCorner(source:paper.Path,index:number):boolean {
 const copy=documentPath(source);try{corner(copy,index);return true;}catch{return false;}finally{copy.remove();}
}
/** Returns an uninserted document-space path. The source is never changed. */
export function editCorners(source:paper.Path,indices:readonly number[],kind:CornerKind,size:number):paper.Path {
 if(!validDimension(size))throw new Error('Enter a distance from 0.001 to 1,000,000 mm.');
 if(!indices.length)throw new Error('Select at least one corner.');
 const copy=documentPath(source);
 try{
  const cuts=new Map<number,{segments:paper.Segment[];trim:number}>();
  for(const index of new Set(indices)){
   const {node,u,v,angle}=corner(copy,index),trim=kind==='fillet'?size/Math.tan(angle/2):size;
   const a=node.point.add(u.multiply(trim)),b=node.point.add(v.multiply(trim));
   let segments:paper.Segment[];
   if(kind==='chamfer')segments=[new paper.Segment(a),new paper.Segment(b)];
   else{
    const center=node.point.add(u.add(v).normalize(size/Math.sin(angle/2))),sweep=Math.sign(u.multiply(-1).cross(v))*(Math.PI-angle),steps=Math.ceil(Math.abs(sweep)/(Math.PI/2)),delta=sweep/steps,arm=4/3*Math.tan(Math.abs(delta)/4)*size;
    segments=Array.from({length:steps+1},(_,i)=>{const radial=a.subtract(center).rotate(delta*i*180/Math.PI,new paper.Point(0,0)),point=i===0?a:i===steps?b:center.add(radial),tangent=radial.rotate(Math.sign(delta)*90,new paper.Point(0,0)).normalize(arm);return new paper.Segment(point,i?tangent.multiply(-1):undefined,i<steps?tangent:undefined);});
   }
   cuts.set(index,{segments,trim});
  }
  // Both ends of an edge consume the same shared length; validate them together.
  for(let i=0;i<copy.curves.length;i++){const j=(i+1)%copy.segments.length,used=(cuts.get(i)?.trim??0)+(cuts.get(j)?.trim??0);if(used>copy.segments[i].point.getDistance(copy.segments[j].point)+EPS)throw new Error('These corners overlap or exceed an adjoining edge. Enter a smaller radius or distance.');}
  const segments:paper.Segment[]=[];
  copy.segments.forEach((segment,i)=>{const cut=cuts.get(i);if(cut){segments.push(...cut.segments);return;}const next=(i+1)%copy.segments.length,prev=(i+copy.segments.length-1)%copy.segments.length,s=segment.clone();if(cuts.has(prev))s.handleIn=new paper.Point(0,0);if(cuts.has(next))s.handleOut=new paper.Point(0,0);segments.push(s);});
  // Merge only new trim junctions. Coincident anchors elsewhere may define a
  // real Bézier loop; neither those curves nor untouched duplicates may change.
  const generated=new Set([...cuts.values()].flatMap(cut=>cut.segments));
  const touches=(a:paper.Segment,b:paper.Segment)=>
   (generated.has(a)||generated.has(b))&&a.handleOut.isZero()&&b.handleIn.isZero()&&a.point.getDistance(b.point)<=EPS;
  const merged:paper.Segment[]=[];
  for(const segment of segments){
   const last=merged.at(-1);
   if(last&&touches(last,segment)){last.handleOut=segment.handleOut.clone();generated.add(last);}
   else merged.push(segment);
  }
  if(copy.closed&&merged.length>1&&touches(merged.at(-1)!,merged[0])){merged[0].handleIn=merged.at(-1)!.handleIn.clone();merged.pop();}
  if(merged.length<2||!merged.every(s=>[s.point,s.point.add(s.handleIn),s.point.add(s.handleOut)].every(p=>validNumber(p.x)&&validNumber(p.y))))throw new Error('The resulting corner geometry is outside the supported range.');
  copy.removeSegments();copy.addSegments(merged);return copy;
 }catch(error){copy.remove();throw error;}
}
