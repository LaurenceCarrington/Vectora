import paper from 'paper';
import {documentPath} from './deletion';
import {pathsOf} from './geometry';
import type {Shape} from './types';

const EPS=1e-6;
type Node={id:number;point:paper.Point;edges:Edge[]};
type Edge={from:Node;to:Node;out:paper.Point;incoming:paper.Point;angle:number;twin:Edge;visited:boolean};

/** Keep disconnected remote outlines out of the expensive face/intersection work.
 * Bounds connectivity is deliberately conservative: it includes open-line
 * enclosures, tangent contacts and disconnected holes inside an enclosing area.
 */
function localPaths(paths:paper.Path[],point:paper.Point):paper.Path[] {
  let entries=paths.map((path,index)=>{
    const bounds=path.bounds,parent=path.parent;
    // Path bounds include its own matrix but are in the parent's coordinates.
    // Transform the four corners conservatively before pruning compound paths.
    const corners=[bounds.topLeft,bounds.topRight,bounds.bottomLeft,bounds.bottomRight]
      .map(corner=>parent?parent.globalMatrix.transform(corner):corner);
    const xs=corners.map(corner=>corner.x),ys=corners.map(corner=>corner.y);
    return {path,index,bounds:new paper.Rectangle(new paper.Point(Math.min(...xs),Math.min(...ys)),new paper.Point(Math.max(...xs),Math.max(...ys)))};
  });
  const overlaps=(a:paper.Rectangle,b:paper.Rectangle):boolean=>a.left<=b.right+EPS&&b.left<=a.right+EPS&&a.top<=b.bottom+EPS&&b.top<=a.bottom+EPS;
  // The result is clipped inside every closed contour containing the click.
  // Its smallest enclosing bounds therefore safely exclude remote geometry,
  // even when a large border otherwise connects the entire drawing's bounds.
  let window:paper.Rectangle|null=null;
  for(const entry of entries){
    if(!entry.path.closed||!entry.bounds.contains(point))continue;
    const local=entry.path.parent?entry.path.parent.globalToLocal(point):point;
    if(local&&entry.path.contains(local)&&(!window||entry.bounds.area<window.area))window=entry.bounds;
  }
  if(window)entries=entries.filter(entry=>overlaps(entry.bounds,window!));
  const parents=paths.map((_,index)=>index);
  const root=(index:number):number=>{while(parents[index]!==index){parents[index]=parents[parents[index]];index=parents[index];}return index;};
  const ordered=[...entries].sort((a,b)=>a.bounds.left-b.bounds.left);
  let active:typeof entries=[];
  for(const entry of ordered){
    active=active.filter(other=>other.bounds.right+EPS>=entry.bounds.left);
    for(const other of active)if(overlaps(entry.bounds,other.bounds))parents[root(entry.index)]=root(other.index);
    active.push(entry);
  }
  const components=new Map<number,paper.Rectangle>();
  for(const entry of entries){const id=root(entry.index),bounds=components.get(id);components.set(id,bounds?bounds.unite(entry.bounds):entry.bounds.clone());}
  const enclosing=[...components.values()].filter(bounds=>bounds.contains(point));
  if(!enclosing.length)return [];
  return entries.filter(entry=>enclosing.some(bounds=>overlaps(bounds,components.get(root(entry.index))!))).map(entry=>entry.path);
}

/** Trace bounded faces of the visible Bézier outline network, preserving curves. */
export function regionAt(objects:readonly Shape[],point:paper.Point):Shape|null {
  const sources=objects.filter(item=>item.visible&&item.layer.visible&&!item.data.dimension).flatMap(pathsOf).filter(path=>path.visible);
  const paths:paper.Path[]=[];
  const faces:paper.Path[]=[];
  try {
    for(const source of localPaths(sources,point))paths.push(documentPath(source));
    // A point on an outline is ambiguous: never paint both sides of it.
    if(paths.some(path=>path.curves.length&&path.getNearestPoint(point).getDistance(point)<EPS))return null;
    const curves=paths.flatMap(path=>path.curves);
    if(curves.length>4000)throw new Error('This connected area has too many curves to fill at once. Simplify it or hide unrelated layers and try again.');
    const cuts=new Map(curves.map(curve=>[curve,[0,1]]));
    const add=(location:paper.CurveLocation|null)=>{if(location)cuts.get(location.curve)?.push(location.time);};
    for(let i=0;i<paths.length;i++)for(let j=i;j<paths.length;j++){
      if(i!==j&&!paths[i].bounds.intersects(paths[j].bounds))continue;
      for(const hit of paths[i].getIntersections(paths[j])){add(hit);add(hit.intersection);}
    }
    const buckets=new Map<string,Node[]>(),nodes:Node[]=[],edges:Edge[]=[],seen=new Map<string,Edge[]>();
    const nodeAt=(p:paper.Point):Node=>{
      const x=Math.round(p.x/EPS),y=Math.round(p.y/EPS);
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const node of buckets.get(`${x+dx},${y+dy}`)??[])if(node.point.getDistance(p)<EPS)return node;
      const node:Node={id:nodes.length,point:p.clone(),edges:[]},key=`${x},${y}`;buckets.set(key,[...(buckets.get(key)??[]),node]);nodes.push(node);return node;
    };
    for(const curve of curves){
      const times=cuts.get(curve)!.sort((a,b)=>a-b).filter((time,i,array)=>!i||time-array[i-1]>1e-9);
      for(let i=1;i<times.length;i++){
        const part=curve.getPart(times[i-1],times[i]);if(part.length<EPS)continue;
        const from=nodeAt(part.point1),to=nodeAt(part.point2),straight=part.isStraight();
        const out=straight?new paper.Point(0,0):part.segment1.handleOut.clone(),incoming=straight?new paper.Point(0,0):part.segment2.handleIn.clone();
        // A previous fill can share this exact curve with an original outline.
        // Compare handles by distance: rounded coordinate keys split coincident
        // edges when tiny boolean-operation errors fall on opposite bucket edges.
        const key=from.id<to.id?`${from.id}/${to.id}`:`${to.id}/${from.id}`,duplicates=seen.get(key)??[];
        if(duplicates.some(other=>{const same=other.from===from?other:other.twin;return same.out.getDistance(out)<EPS*4&&same.incoming.getDistance(incoming)<EPS*4;}))continue;
        const edge={from,to,out,incoming,angle:part.getPointAtTime(0.00001).subtract(part.point1).angle,visited:false} as Edge;
        const twin={from:to,to:from,out:incoming,incoming:out,angle:part.getPointAtTime(0.99999).subtract(part.point2).angle,visited:false,twin:edge} as Edge;
        edge.twin=twin;from.edges.push(edge);to.edges.push(twin);edges.push(edge,twin);seen.set(key,[...duplicates,edge]);
      }
    }
    for(const node of nodes)node.edges.sort((a,b)=>a.angle-b.angle);
    for(const first of edges){
      if(first.visited)continue;
      let edge=first;const walk:Edge[]=[];
      do{
        if(edge.visited)break;edge.visited=true;walk.push(edge);
        const outgoing=edge.to.edges,index=outgoing.indexOf(edge.twin);edge=outgoing[(index+outgoing.length-1)%outgoing.length];
      }while(edge!==first);
      // Remove dangling branches: travelling out and back does not bound a region.
      const boundary:Edge[]=[];for(const current of walk){if(boundary.at(-1)===current.twin)boundary.pop();else boundary.push(current);}
      while(boundary.length>1&&boundary[0]===boundary.at(-1)!.twin){boundary.shift();boundary.pop();}
      if(edge!==first||boundary.length<2)continue;
      const face=new paper.Path({insert:false,closed:true,segments:boundary.map((current,i)=>new paper.Segment(current.from.point,boundary[(i+boundary.length-1)%boundary.length].incoming,current.out))});
      if(face.area>EPS*EPS)faces.push(face);else face.remove();
    }
    const enclosing=faces.filter(face=>face.contains(point)).sort((a,b)=>a.area-b.area),face=enclosing[0];
    if(!face)return null;
    let region=face.clone({insert:false}) as Shape;
    // Disconnected nested outlines are holes in the enclosing face.
    for(const hole of faces)if(hole!==face&&hole.area<face.area&&!hole.contains(point)&&hole.bounds.intersects(face.bounds)){
      const next=region.subtract(hole,{insert:false}) as Shape;region.remove();region=next;
    }
    // Coincident curves from existing fills can make a face walk ambiguous.
    // Restrict it to the same side of EVERY closed outline as the click. In
    // particular, clicking a circle overlap must never colour either crescent.
    for(const boundary of paths)if(boundary.closed&&boundary.bounds.intersects(region.bounds)){
      if(region.compare(boundary))continue;
      const inside=boundary.contains(point),crosses=region.getIntersections(boundary).some(hit=>hit.isCrossing());
      // Do not boolean-clip a region already on the correct side. Repeating
      // boolean operations on coincident/tangent boundaries can lose holes.
      const wrongSide=inside
        ?pathsOf(region).some(path=>path.curves.some(curve=>{const sample=curve.getPointAtTime(.5);return !boundary.contains(sample)&&boundary.getNearestPoint(sample).getDistance(sample)>EPS*4;}))
        :region.contains(boundary.interiorPoint);
      if(!crosses&&!wrongSide)continue;
      const next=(inside?region.intersect(boundary,{insert:false}):region.subtract(boundary,{insert:false})) as Shape;
      region.remove();region=next;
    }
    region.fillRule='evenodd';
    if(!region.contains(point)){region.remove();return null;}
    // Boolean operations can leave disconnected islands with the same winding
    // signature. Keep only the connected component containing the click.
    const contours=pathsOf(region),outer=contours.filter(path=>path.contains(point)).sort((a,b)=>Math.abs(a.area)-Math.abs(b.area))[0];
    if(!outer){region.remove();return null;}
    let component=outer.clone({insert:false}) as Shape;
    for(const hole of contours)if(hole!==outer&&Math.abs(hole.area)<Math.abs(outer.area)&&!hole.contains(point)&&hole.bounds.intersects(outer.bounds)){
      const next=component.subtract(hole,{insert:false}) as Shape;component.remove();component=next;
    }
    region.remove();component.fillRule='evenodd';return component;
  }finally{paths.forEach(path=>path.remove());faces.forEach(face=>face.remove());}
}
