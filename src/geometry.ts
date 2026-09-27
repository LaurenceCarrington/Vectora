import paper from 'paper';
import type { Contour, Shape, Vertex } from './types';
import { geometrySettings, NUMERIC_EPSILON_MM as EPS, validNumber } from './units';
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
export function flattenInDocument(source: Shape): Contour[] {
  return pathsOf(source).map(path => {
    // Transform points AND Bézier handles before flattening: tolerance is in document mm,
    // including non-uniform ancestor transforms, never the Paper view matrix.
    const copy = new paper.Path({insert:false, closed:path.closed});
    try {
      for (const segment of path.segments) {
        const point = path.localToGlobal(segment.point);
        copy.add(new paper.Segment(point,
          path.localToGlobal(segment.point.add(segment.handleIn)).subtract(point),
          path.localToGlobal(segment.point.add(segment.handleOut)).subtract(point)));
      }
      copy.flatten(geometrySettings.flattenToleranceMM);
      return {closed:copy.closed, points:cleanVertices(copy.segments.map(s=>s.point),copy.closed)};
    } finally { copy.remove(); }
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
