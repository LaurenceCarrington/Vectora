import paper from 'paper';
import { MAX_COORDINATE_MM, MIN_DIMENSION_MM, validNumber } from './units';

/** An open circular arc through three distinct document-space points. */
export function createArc(from:paper.Point,through:paper.Point,to:paper.Point):paper.Path {
  if([from,through,to].some(p=>!validNumber(p.x)||!validNumber(p.y)))throw new Error('Arc points must be within the document coordinate limits.');
  const a=through.subtract(from),b=to.subtract(from),c=to.subtract(through);
  const lengths=[a.length,b.length,c.length],cross=Math.abs(a.cross(b));
  if(Math.min(...lengths)<MIN_DIMENSION_MM)throw new Error('Choose three different points for the arc.');
  if(cross/Math.max(...lengths)<MIN_DIMENSION_MM)throw new Error('Arc points cannot lie on a straight line. Choose a different point.');
  const radius=lengths[0]*lengths[1]*lengths[2]/(2*cross);
  if(!Number.isFinite(radius)||radius>MAX_COORDINATE_MM)throw new Error('The arc is too large. Choose points with more curvature.');
  const item=new paper.Path.Arc({from,through,to,insert:false,closed:false});
  if(![item.bounds.left,item.bounds.right,item.bounds.top,item.bounds.bottom].every(validNumber)){
    item.remove();throw new Error('The arc exceeds the document coordinate limits.');
  }
  return item;
}

export interface ArcGeometry { cx:number; cy:number; radius:number; start:number; sweep:number }
export function arcPoint(arc:ArcGeometry,angle:number):paper.Point {
  return new paper.Point(arc.cx+arc.radius*Math.cos(angle*Math.PI/180),arc.cy+arc.radius*Math.sin(angle*Math.PI/180));
}
export function createCircularArc(arc:ArcGeometry):paper.Path {
  if(![arc.cx,arc.cy,arc.radius,arc.start,arc.sweep].every(Number.isFinite)||arc.radius<MIN_DIMENSION_MM||arc.radius>MAX_COORDINATE_MM||Math.abs(arc.sweep)<1||Math.abs(arc.sweep)>359)throw new Error('Use a radius of at least 0.001 mm and a sweep from 1° to 359° in either direction.');
  // Known circular parameters do not need the three-point collinearity threshold.
  // Build at most 90° cubic spans, including tiny radii and shallow signed sweeps.
  const spans=Math.ceil(Math.abs(arc.sweep)/90),step=arc.sweep/spans;
  const path=new paper.Path({insert:false,closed:false});
  for(let i=0;i<=spans;i++){
    const angle=(arc.start+i*step)*Math.PI/180,k=4/3*Math.tan(step*Math.PI/720)*arc.radius;
    const tangent=new paper.Point(-Math.sin(angle),Math.cos(angle)).multiply(k);
    path.add(new paper.Segment(arcPoint(arc,arc.start+i*step),i?tangent.multiply(-1):undefined,i<spans?tangent:undefined));
  }
  if(![path.bounds.left,path.bounds.right,path.bounds.top,path.bounds.bottom].every(validNumber)){
    path.remove();throw new Error('The arc exceeds the document coordinate limits.');
  }
  path.data.arc={...arc};return path;
}
export function updateCircularArc(path:paper.Path,arc:ArcGeometry):void {
  const replacement=createCircularArc(arc);
  path.removeSegments();path.addSegments(replacement.segments);path.data.arc={...arc};replacement.remove();
}
/** Angle magnets are independent of the document grid: circular geometry stays circular. */
export function snapArcAngle(angle:number,shift=false):number {
  const step=shift?15:90,nearest=Math.round(angle/step)*step;
  return shift||Math.abs(nearest-angle)<=4?nearest:angle;
}

/** Fixed endpoints; perpendicular pointer distance controls the signed sweep. */
export function createEndpointArc(from:paper.Point,to:paper.Point,pointer:paper.Point,shift=false):paper.Path {
  const chord=to.subtract(from),length=chord.length;
  if(length<MIN_DIMENSION_MM)throw new Error('Choose different start and end points.');
  const normal=new paper.Point(-chord.y,chord.x).divide(length),midpoint=from.add(to).divide(2);
  const height=pointer.subtract(midpoint).dot(normal);
  const raw=-4*Math.atan2(2*height,length)*180/Math.PI;
  if(Math.abs(raw)<1)throw new Error('Move away from the straight guide to bend the arc.');
  const snapped=snapArcAngle(raw,shift);
  const sweep=Math.sign(raw)*Math.min(359,Math.max(shift?15:1,Math.abs(snapped)));
  const centre=midpoint.add(normal.multiply(length/(2*Math.tan(sweep*Math.PI/360))));
  const start=from.subtract(centre);
  return createCircularArc({cx:centre.x,cy:centre.y,radius:start.length,start:start.angle,sweep});
}
