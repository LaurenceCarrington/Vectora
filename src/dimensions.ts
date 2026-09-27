import paper from 'paper';
import type { Shape, ToolName } from './types';
import { pathsOf } from './geometry';
import { documentPath } from './deletion';
import { MIN_DIMENSION_MM } from './units';

export type DimensionTool='dimension-aligned'|'dimension-linear'|'dimension-radial'|'dimension-diameter'|'leader';
export const DIMENSION_TOOLS:DimensionTool[]=['dimension-aligned','dimension-linear','dimension-radial','dimension-diameter','leader'];
export const DIMENSION_NAMES:Record<DimensionTool,string>={'dimension-aligned':'Aligned dimension','dimension-linear':'Linear dimension','dimension-radial':'Radial dimension','dimension-diameter':'Diameter dimension',leader:'Leader callout'};
export interface DimensionData {kind:DimensionTool;points:[number,number][];axis?:'x'|'y';text?:string;transform:[number,number,number,number,number,number]}
export function isDimensionTool(tool:ToolName):tool is DimensionTool{return DIMENSION_TOOLS.includes(tool as DimensionTool);}
const mm=(value:number)=>`${Number(value.toFixed(2))} mm`;
export function dimensionLayout(data:DimensionData){
  const [a,b,c]=data.points.map(point=>new paper.Point(point)),matrix=new paper.Matrix(...data.transform);
  const lines:paper.Point[][]=[];
  const line=(...points:paper.Point[])=>lines.push(points);
  const arrow=(tip:paper.Point,toward:paper.Point)=>{
    const u=toward.subtract(tip).normalize(2.2),n=u.rotate(90,new paper.Point(0,0)).normalize(0.7);line(tip.add(u).add(n),tip,tip.add(u).subtract(n));
  };
  let label='',position=c.clone(),angle=0;
  if(data.kind==='leader'){
    label=data.text||'Callout';line(a,b,c);arrow(a,b);position=c.add([1,-1]);
  }else if(data.kind==='dimension-radial'||data.kind==='dimension-diameter'){
    const radius=a.getDistance(b),u=c.subtract(a).normalize(radius),edge=a.add(u),far=a.subtract(u);
    label=(data.kind==='dimension-radial'?'R ':'Ø ')+mm(matrix.transform(a).getDistance(matrix.transform(b))*(data.kind==='dimension-diameter'?2:1));
    if(data.kind==='dimension-diameter'){line(far,edge,c);arrow(far,edge);arrow(edge,far);}else{line(a,edge,c);arrow(edge,a);}
    position=c.add([1,-1]);
  }else{
    let p:paper.Point,q:paper.Point,n:paper.Point;
    if(data.kind==='dimension-linear'){
      const horizontal=data.axis==='x';p=horizontal?new paper.Point(a.x,c.y):new paper.Point(c.x,a.y);q=horizontal?new paper.Point(b.x,c.y):new paper.Point(c.x,b.y);n=horizontal?new paper.Point(0,1):new paper.Point(1,0);
    }else{
      n=b.subtract(a).normalize().rotate(90,new paper.Point(0,0));const offset=c.subtract(a).dot(n);p=a.add(n.multiply(offset));q=b.add(n.multiply(offset));
    }
    const u=q.subtract(p).normalize(),length=matrix.transform(p).getDistance(matrix.transform(q));label=mm(length);
    for(const [anchor,end] of [[a,p],[b,q]]){const direction=end.subtract(anchor).length?end.subtract(anchor).normalize():n;line(anchor.add(direction.multiply(1)),end.add(direction.multiply(2)));}
    const middle=p.add(q).divide(2),gap=Math.min(p.getDistance(q)*0.35,label.length*0.9+1);
    if(p.getDistance(q)>MIN_DIMENSION_MM){line(p,middle.subtract(u.multiply(gap)));line(middle.add(u.multiply(gap)),q);arrow(p,q);arrow(q,p);}
    position=middle.add(n.multiply(-1));angle=u.angle;if(angle>90||angle< -90)angle+=180;
  }
  return {lines,label,position,angle,matrix,fontSize:3.2};
}
export function createDimension(data:DimensionData):paper.CompoundPath {
  const layout=dimensionLayout(data);
  const shape=new paper.CompoundPath({insert:false,children:layout.lines.map(segments=>new paper.Path({insert:false,segments})),strokeColor:'#383838',strokeWidth:1,strokeScaling:false,fillColor:null});
  shape.transform(layout.matrix);shape.data.dimension=structuredClone(data);return shape;
}
export function transformDimension(item:Shape,matrix:paper.Matrix):void {
  const data=item.data.dimension as DimensionData|undefined;if(!data)return;
  const transform=new paper.Matrix(...data.transform);transform.prepend(matrix);item.data.dimension={...structuredClone(data),transform:transform.values};
}
export function dimensionTextLayout(data:DimensionData){
  const layout=dimensionLayout(data),origin=layout.matrix.transform(new paper.Point(0,0));
  const direction=new paper.Point({length:1,angle:layout.angle});
  const baseline=layout.matrix.transform(direction).subtract(origin),vertical=layout.matrix.transform(direction.rotate(90,new paper.Point(0,0))).subtract(origin);
  let angle=baseline.angle;if(angle>90)angle-=180;if(angle< -90)angle+=180;
  return {label:layout.label,position:layout.matrix.transform(layout.position),fontSize:layout.fontSize*vertical.length,angle,centered:data.kind==='dimension-aligned'||data.kind==='dimension-linear'};
}
export function dimensionLabel(item:Shape):paper.PointText|null {
  if(!item.data.dimension)return null;
  const layout=dimensionTextLayout(item.data.dimension);
  const text=new paper.PointText({insert:false,point:layout.position,content:layout.label,fontSize:layout.fontSize,fontFamily:'Arial, sans-serif',fillColor:item.strokeColor??'#383838',justification:layout.centered?'center':'left'});
  text.rotate(layout.angle,layout.position);return text;
}
/** Pick true circles and circular arcs; ellipses do not have one radius. */
export function circleAt(objects:readonly Shape[],point:paper.Point,tolerance:number):{center:paper.Point;radius:number}|null {
  for(const owner of [...objects].reverse())if(owner.layer.visible&&!owner.data.dimension&&!owner.data.text){
    if(owner.data.arc){const arc=owner.data.arc;const copy=documentPath(owner as paper.Path),near=copy.getNearestPoint(point);copy.remove();if(near&&near.getDistance(point)<=tolerance)return {center:new paper.Point(arc.cx,arc.cy),radius:arc.radius};}
    for(const path of pathsOf(owner))if(path.closed&&path.segments.length>=4){
      const copy=documentPath(path),center=copy.bounds.center,radius=copy.bounds.width/2;
      const circular=radius>MIN_DIMENSION_MM&&Math.abs(copy.bounds.height/2-radius)<radius*0.0005&&copy.curves.every(curve=>[0,0.25,0.5,0.75].every(t=>Math.abs(curve.getPointAtTime(t).getDistance(center)-radius)<radius*0.0005));
      const near=circular?copy.getNearestPoint(point):null;copy.remove();if(near&&near.getDistance(point)<=tolerance)return {center,radius};
    }
  }
  return null;
}
