import paper from 'paper';
import {createCircularArc} from './arc';
import {createHeart} from './heart';
import {applyLineDesign,applyLineWeight,LINE_DESIGNS,validLineWeight,type LineDesign} from './lineAppearance';
import {MIN_DIMENSION_MM,MAX_COORDINATE_MM,validNumber} from './units';
import type {ToolName} from './types';

export type CreationKind='rectangle'|'circle'|'ellipse'|'polygon'|'star'|'heart'|'line'|'arc';
export const CREATION_NAMES:Record<CreationKind,string>={rectangle:'Rectangle',circle:'Circle',ellipse:'Ellipse',polygon:'Polygon',star:'Star',heart:'Heart',line:'Line',arc:'Circular arc'};
export function creationKind(tool:ToolName):CreationKind|null {
 if(tool==='arc'||tool==='arc-three-point'||tool==='arc-endpoints')return 'arc';
 return ['rectangle','circle','ellipse','polygon','star','heart','line'].includes(tool)?tool as CreationKind:null;
}
export interface CreationField {key:string;label:string;prefix:string;name:string;unit:string;value:number;min?:number;max?:number;integer?:boolean}
export function creationFields(kind:CreationKind,centre:{x:number;y:number},sides=6,points=5):CreationField[] {
 const box=['rectangle','ellipse','heart'].includes(kind),width=40,height=kind==='heart'?40:30;
 const field=(key:string,label:string,prefix:string,value:number,unit='mm',min?:number,max?:number):CreationField=>({key,label,prefix,value,unit,min,max,name:unit==='mm'?`${label} (millimetres)`:unit==='°'?`${label} (degrees)`:label});
 return [field('x','X position','X',centre.x-(box?width/2:kind==='line'?20:0),'mm',-MAX_COORDINATE_MM,MAX_COORDINATE_MM),field('y','Y position','Y',centre.y-(box?height/2:0),'mm',-MAX_COORDINATE_MM,MAX_COORDINATE_MM),
  ...(box?[field('width','Width','W',width,'mm',MIN_DIMENSION_MM,MAX_COORDINATE_MM),field('height','Height','H',height,'mm',MIN_DIMENSION_MM,MAX_COORDINATE_MM)]:kind==='line'?[field('length','Length','L',40,'mm',MIN_DIMENSION_MM,MAX_COORDINATE_MM)]:[field('radius','Radius','R',kind==='circle'?15:20,'mm',MIN_DIMENSION_MM,MAX_COORDINATE_MM)]),
  ...(kind==='polygon'||kind==='star'?[{...field('count',kind==='polygon'?'Sides':'Points','#',kind==='polygon'?sides:points,'',3,64),integer:true}]:[]),
  ...(['line','polygon','star'].includes(kind)?[field('angle','Angle','∠',0,'°',-360,360)]:kind==='arc'?[field('start','Start angle','Start',0,'°',-360,360),field('sweep','Sweep','Sweep',180,'°',-359,359)]:[]),
  field('weight','Line weight','Weight',.4,'mm',.001,1000)];
}
export class CreationError extends Error {constructor(message:string,readonly field?:string){super(message);}}
/** Builds an unattached object; exact entries never pass through grid/object snapping. */
export function buildCreationShape(kind:CreationKind,values:Record<string,number>,measurement:'radius'|'diameter',style:LineDesign,colour:string):paper.Path {
 for(const field of creationFields(kind,{x:0,y:0})){
  const value=values[field.key];
  if(!validNumber(value)||field.min!==undefined&&value<field.min||field.max!==undefined&&value>field.max||field.integer&&!Number.isInteger(value))throw new CreationError(`Enter a valid ${field.label.toLowerCase()}${field.integer?' (whole number from 3 to 64)':''}.`,field.key);
 }
 if(!validLineWeight(values.weight)||!LINE_DESIGNS.includes(style))throw new CreationError('Choose a valid line style and weight.','weight');
 if(kind==='arc'&&Math.abs(values.sweep)<1)throw new CreationError('Use a sweep from 1° to 359° in either direction.','sweep');
 const {x,y,width,height,angle=0,count}=values,centre=new paper.Point(x,y);
 let shape:paper.Path;
 if(kind==='rectangle'||kind==='ellipse'||kind==='heart'){
  const rectangle=new paper.Rectangle(x,y,width,height);
  shape=kind==='rectangle'?new paper.Path.Rectangle({rectangle,insert:false}):kind==='ellipse'?new paper.Path.Ellipse({rectangle,insert:false}):createHeart(rectangle);
 }else if(kind==='circle')shape=new paper.Path.Circle({center:centre,radius:values.radius/(measurement==='diameter'?2:1),insert:false});
 else if(kind==='line'){const radians=angle*Math.PI/180;shape=new paper.Path({segments:[centre,centre.add([values.length*Math.cos(radians),values.length*Math.sin(radians)])],closed:false,insert:false});}
 else if(kind==='arc')shape=createCircularArc({cx:x,cy:y,radius:values.radius,start:((values.start%360)+360)%360,sweep:values.sweep});
 else{
  const star=kind==='star',vertices=star?count*2:count;
  shape=new paper.Path({closed:true,insert:false,segments:Array.from({length:vertices},(_,i)=>{const theta=angle*Math.PI/180+i*2*Math.PI/vertices,radius=values.radius*(star&&i%2?.4:1);return centre.add([radius*Math.cos(theta),radius*Math.sin(theta)]);})});
  if(kind==='polygon')shape.data.sides=count;
  shape.data.rotationDegrees=((angle%360)+360)%360;
 }
 const bounds=shape.bounds;
 if(![bounds.left,bounds.top,bounds.right,bounds.bottom].every(validNumber)){shape.remove();throw new CreationError('The shape exceeds the document coordinate limits.');}
 shape.fillColor=null;shape.strokeColor=new paper.Color(colour);applyLineWeight(shape,values.weight);applyLineDesign(shape,style);return shape;
}
