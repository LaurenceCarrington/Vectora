import paper from 'paper';
import type {Generated} from './geometry';
import type {Shape} from '../types';
/** Bore circles stay exact cubic circles. Sampled engineering curves become editable path nodes. */
export function generatedShapes(result:Generated,center:paper.Point):{shape:Shape;name:string;operation?:'engrave'}[]{
 const offset=center.subtract(new paper.Point(result.bounds.x+result.bounds.width/2,result.bounds.y+result.bounds.height/2));
 return result.parts.map(part=>{
  const paths=part.contours.map(c=>'radius'in c?new paper.Path.Circle({center:new paper.Point(...c.center),radius:c.radius,insert:false}):new paper.Path({segments:c.points,closed:c.closed,insert:false}));
  // Inner contours use opposite winding for other applications that use nonzero filling.
  paths.forEach((path,i)=>{if(path.closed)path.clockwise=i===0;});
  const shape:Shape=paths.length===1?paths[0]:new paper.CompoundPath({children:paths,insert:false});shape.translate(offset);shape.fillColor=null;return {shape,name:part.name,operation:part.operation};
 });
}
