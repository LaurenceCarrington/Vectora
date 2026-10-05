import paper from 'paper';
import {loadTextFont,createTextShape,transformText} from '../text';
import type {Shape} from '../types';
import type {LabelMetric,SheetItem,SheetLayout} from './types';
import {sheetSVG} from './layout';
let metrics:Promise<LabelMetric[]>|undefined;
export function loadLabelMetrics():Promise<LabelMetric[]> {
 return metrics??=(async()=>{await loadTextFont('lato');return Array.from({length:32},(_,i)=>{const shape=createTextShape({content:String(i+1),sizeMM:1,fontId:'lato',transform:[1,0,0,1,0,0]});try{const b=shape.bounds;return {number:i+1,left:b.x,top:b.y,width:b.width,height:b.height};}finally{shape.remove();}});})().catch(error=>{metrics=undefined;throw error;});
}
/** Use the same actual glyph outlines and ink-bound centring as insertion. */
export function previewSheetSVG(layout:SheetLayout,view:'numbered'|'reference'):string {
 const glyphs=new Map<string,paper.CompoundPath>();
 try{return sheetSVG(layout,view,item=>{const key=JSON.stringify([item.content,item.sizeMM]);let shape=glyphs.get(key);if(!shape){shape=createTextShape({content:item.content,sizeMM:item.sizeMM,fontId:'lato',transform:[1,0,0,1,0,0]});glyphs.set(key,shape);}shape.translate(new paper.Point(item.x,item.y).subtract(shape.bounds.center));return `<path data-paint-label="true" d="${shape.pathData}" fill="${item.colour}" stroke="none"/>`;});}
 finally{glyphs.forEach(shape=>shape.remove());}
}
export async function prepareSheets(layout:SheetLayout,center:paper.Point,includeReference:boolean):Promise<{name:string;items:Shape[]}[]> {
 await loadTextFont('lato');const sheets:{name:string;items:Shape[]}[]=[],allocated:Shape[]=[];
 try{
  const create=(item:SheetItem,offset:paper.Point):Shape=>{
   let shape:Shape;
   if(item.kind==='text'){
    shape=createTextShape({content:item.content,sizeMM:item.sizeMM,fontId:'lato',transform:[1,0,0,1,0,0]});allocated.push(shape);const delta=new paper.Point(item.x,item.y).add(offset).subtract(shape.bounds.center);const matrix=new paper.Matrix(1,0,0,1,delta.x,delta.y);shape.transform(matrix);transformText(shape,matrix);void shape.fillColor;void shape.strokeColor;shape.data.customColour=item.colour;shape.fillColor=new paper.Color(item.colour);shape.strokeColor=null;
   }else{
    const paths=item.contours.map(c=>new paper.Path({insert:false,segments:c,closed:true}));shape=paths.length===1?paths[0]:new paper.CompoundPath({insert:false,children:paths});allocated.push(shape);shape.fillRule='evenodd';shape.translate(offset);void shape.fillColor;void shape.strokeColor;shape.fillColor=item.fill?new paper.Color(item.fill):null;shape.strokeColor=item.stroke?new paper.Color(item.stroke):null;shape.strokeWidth=item.weightMM;shape.strokeScaling=true;shape.strokeJoin='round';shape.data.customColour=item.stroke??item.fill;if(item.stroke)shape.data.customStroke=true;if(item.fill){shape.data.regionFill=true;shape.data.regionFillColor=item.fill;}
   }
   shape.data.name=item.name;return shape;
  };
  const offset=center.subtract(new paper.Point(layout.widthMM/2,layout.heightMM/2));sheets.push({name:'Colour by numbers',items:layout.numbered.map(item=>create(item,offset))});if(includeReference)sheets.push({name:'Colour reference',items:layout.reference.map(item=>create(item,offset.add(new paper.Point(layout.widthMM+20,0))))});return sheets;
 }catch(error){allocated.forEach(shape=>shape.remove());throw error;}
}
