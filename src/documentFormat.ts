import {validateGridSettings} from './gridSettings';
import {validateCanvasSize} from './canvasSize';
import {validateFillPaint,type GradientColour} from './fillPaint';
import paper from 'paper';
import type {CADEditor} from './editor';
import type {DocumentSnapshot,ObjectRole,Shape} from './types';
import {documentPath} from './deletion';
import {pathsOf} from './geometry';
import {loadTextFont,TEXT_FONTS} from './text';
import {DIMENSION_TOOLS} from './dimensions';
import {MAX_COORDINATE_MM,MIN_ZOOM,MAX_ZOOM} from './units';
import {LAYER_TYPES} from './documentLayers';
import {MAX_SOURCE_CONTOURS,MAX_SOURCE_SEGMENTS} from './processingLimits';

export const MAX_DOCUMENT_BYTES=50*1024*1024;
type JsonObject=Record<string,any>;
const roles=LAYER_TYPES.map(layer=>layer.role);
const fail=():never=>{throw new Error('This is not a valid Vectora document.');};
const record=(value:unknown):JsonObject=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as JsonObject:fail();
const number=(value:unknown,limit=MAX_COORDINATE_MM):number=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=limit?value:fail();
const string=(value:unknown,max=500):string=>typeof value==='string'&&value.length<=max?value:fail();
const bool=(value:unknown):boolean=>typeof value==='boolean'?value:fail();
const tuple=(value:unknown,length:number):number[]=>Array.isArray(value)&&value.length===length?value.map(x=>number(x)):fail();
const id=(value:unknown):string=>typeof value==='string'&&/^[\w-]{1,100}$/.test(value)?value:fail();
const colour=(value:unknown):string|null=>value===null?null:typeof value==='string'&&/^(#[\da-f]{3,8}|rgba?\([\d.,\s]+\))$/i.test(value)?value:fail();

function savedColour(c:paper.Color|null):unknown {
 if(!c)return null;if(c.type!=='gradient')return c.toCSS(true);
 const frame=c as GradientColour;
 return {type:'gradient',radial:c.gradient.radial,stops:c.gradient.stops.map((s,i)=>({colour:s.color.toCSS(true),opacity:s.color.alpha,offset:s.offset??i/(c.gradient.stops.length-1)})),origin:[frame.origin.x,frame.origin.y],destination:[frame.destination.x,frame.destination.y],highlight:c.highlight?[c.highlight.x,c.highlight.y]:null};
}
function restoredColour(value:unknown):paper.Color|null {
 if(value===null||typeof value==='string'){const c=colour(value);return c?new paper.Color(c):null;}
 const v=record(value);if(v.type!=='gradient'||!Array.isArray(v.stops)||v.stops.length<2||v.stops.length>8)fail();
 const stops=v.stops.map((raw:unknown)=>{const s=record(raw),c=new paper.Color(colour(s.colour)??fail()),opacity=number(s.opacity,1),offset=number(s.offset,1);if(opacity<0||offset<0)fail();c.alpha=opacity;return new paper.GradientStop(c,offset);});
 const origin=tuple(v.origin,2),destination=tuple(v.destination,2),highlight=v.highlight===null?null:tuple(v.highlight,2);
 return new paper.Color({gradient:{stops,radial:bool(v.radial)},origin:new paper.Point(origin[0],origin[1]),destination:new paper.Point(destination[0],destination[1]),...(highlight?{highlight:new paper.Point(highlight[0],highlight[1])}:{})});
}

export function documentKey(editor:CADEditor,snapshot=editor.snapshot()):string {
 const {artwork,cutlines,layers,canvasSize,grid}=snapshot;return JSON.stringify({artwork,cutlines,layers,canvasSize,grid});
}
export function encodeDocument(editor:CADEditor,pretty=true):string {
 const layers=editor.documentLayers.map(layer=>({id:layer.data.documentId,name:layer.name,role:layer.data.objectRole,visible:layer.visible,locked:layer.locked,objects:layer.children.map(child=>{
  const item=child as Shape;
  return {kind:item instanceof paper.Path?'path':'compound',contours:pathsOf(item).map(path=>{
   const copy=documentPath(path);try{return {closed:copy.closed,segments:copy.segments.map(s=>[s.point.x,s.point.y,s.handleIn.x,s.handleIn.y,s.handleOut.x,s.handleOut.y])};}finally{copy.remove();}
  }),data:structuredClone(item.data),visible:item.visible,locked:item.locked,style:{fill:savedColour(item.fillColor),stroke:savedColour(item.strokeColor),width:item.strokeWidth,scaling:item.strokeScaling,fillRule:item.fillRule,cap:item.strokeCap,join:item.strokeJoin,miter:item.miterLimit,dash:item.dashArray,offset:item.dashOffset,opacity:item.opacity}};
 })}));
 return JSON.stringify({format:'vectora',version:1,units:'mm',rasterLayerInitialized:true,grid:editor.grid.config,canvasSize:editor.canvasSize,activeLayerId:editor.activeLayerId,layers,view:{zoom:paper.view.zoom,center:[paper.view.center.x,paper.view.center.y]}},null,pretty?2:undefined);
}

function metadata(value:unknown,role:ObjectRole,ids:Set<string>,fonts:Set<string>):JsonObject {
 const data=record(value),uid=id(data.uid);if(ids.has(uid))fail();ids.add(uid);
 const out:JsonObject={uid,role,name:string(data.name??'Object')};
 if(data.rotationDegrees!==undefined)out.rotationDegrees=number(data.rotationDegrees,1e12);
 if(data.joined!==undefined)out.joined=bool(data.joined);
 if(data.sides!==undefined){out.sides=number(data.sides,64);if(!Number.isInteger(out.sides)||out.sides<3)fail();}
 if(data.regionFill!==undefined)out.regionFill=bool(data.regionFill);
 if(data.fillPaint!==undefined){try{out.fillPaint=validateFillPaint(data.fillPaint);}catch{fail();}}
 if(data.customColour!==undefined)out.customColour=colour(data.customColour);
 if(data.customStroke!==undefined)out.customStroke=bool(data.customStroke);
 if(data.regionFillColor!==undefined)out.regionFillColor=colour(data.regionFillColor);
 if(data.rasterTrace!==undefined){
  const trace=record(data.rasterTrace);if(!['outline','centerline','fill'].includes(trace.mode))fail();out.rasterTrace={mode:trace.mode};
  if(trace.sourceName!==undefined)out.rasterTrace.sourceName=string(trace.sourceName,1000);
  if(trace.settings!==undefined){const settings=record(trace.settings),saved:JsonObject={invert:bool(settings.invert)};for(const key of ['threshold','brightness','contrast','despeckleSize','simplifyTolerance','curveFitting','cornerSensitivity'])saved[key]=number(settings[key],10000);out.rasterTrace.settings=saved;}
 }
 if(data.arc!==undefined){const a=record(data.arc);out.arc={cx:number(a.cx),cy:number(a.cy),radius:number(a.radius),start:number(a.start,1e12),sweep:number(a.sweep,359)};if(a.radius<0.001||Math.abs(a.sweep)<1)fail();}
 if(data.text!==undefined){
  const t=record(data.text),fontId=string(t.fontId??'lato');if(!TEXT_FONTS.some(font=>font.id===fontId))fail();fonts.add(fontId);
  const content=string(t.content,500),sizeMM=number(t.sizeMM,1000);if(!content.trim()||sizeMM<0.1)fail();
  out.text={content,fontId,sizeMM,transform:tuple(t.transform,6)};
  if(!Array.isArray(t.glyphContours)||!Array.isArray(t.glyphLabels)||t.glyphContours.length>500||t.glyphContours.length!==t.glyphLabels.length)fail();
  out.text.glyphContours=t.glyphContours.map((v:unknown)=>{const n=number(v,2000);return Number.isInteger(n)&&n>=0?n:fail();});
  out.text.glyphLabels=t.glyphLabels.map((v:unknown)=>string(v,20));
 }
 if(data.dimension!==undefined){
  const d=record(data.dimension);if(!DIMENSION_TOOLS.includes(d.kind)||!Array.isArray(d.points)||d.points.length!==3)fail();
  out.dimension={kind:d.kind,points:d.points.map((point:unknown)=>tuple(point,2)),transform:tuple(d.transform,6)};
  if(d.axis!==undefined){if(d.axis!=='x'&&d.axis!=='y')fail();out.dimension.axis=d.axis;}
  if(d.text!==undefined)out.dimension.text=string(d.text,5000);
 }
 return out;
}

/** Validate and construct off-canvas paths before replacing any live document. */
export async function decodeDocument(contents:string):Promise<{snapshot:DocumentSnapshot;view:{zoom:number;center:[number,number]}}> {
 if(new Blob([contents]).size>MAX_DOCUMENT_BYTES)throw new Error('Choose a Vectora document smaller than 50 MB.');
 let file:JsonObject;try{file=record(JSON.parse(contents));}catch{throw new Error('Choose a valid .vectora document.');}
 if(file.format!=='vectora'||file.units!=='mm')fail();
 if(file.version!==1)throw new Error('This Vectora document version is not supported.');
 const rasterLayerInitialized=file.rasterLayerInitialized===undefined?false:bool(file.rasterLayerInitialized);
 if(!Array.isArray(file.layers)||file.layers.length>1000)fail();
 // Count the entire document before constructing any Paper paths. Empty
 // contours still allocate objects and must consume a contour budget.
 let objectCount=0,contourCount=0,segmentCount=0;
 for(const rawLayer of file.layers){
  const l=record(rawLayer);if(!Array.isArray(l.objects))fail();
  for(const rawObject of l.objects){
   if(++objectCount>20000)throw new Error('This document contains too many objects.');
   const o=record(rawObject);if(!Array.isArray(o.contours))fail();
   if((contourCount+=o.contours.length)>MAX_SOURCE_CONTOURS)throw new Error('This document contains too many contours.');
   for(const rawContour of o.contours){
    const c=record(rawContour);if(!Array.isArray(c.segments))fail();
    if((segmentCount+=c.segments.length)>MAX_SOURCE_SEGMENTS)throw new Error('This document contains too many curve points.');
   }
  }
 }
 const view=record(file.view),zoom=number(view.zoom,MAX_ZOOM);if(zoom<MIN_ZOOM)fail();const center=tuple(view.center,2) as [number,number];
 const canvasSize=validateCanvasSize(file.canvasSize),grid=validateGridSettings(file.grid);
 const layerIds=new Set<string>(),objectIds=new Set<string>(),fonts=new Set<string>();
 const states:any[]=[];let artwork='[]',cutlines='[]';
 for(const rawLayer of file.layers){
  const l=record(rawLayer),layerId=id(l.id),name=string(l.name,200),role=l.role as ObjectRole;
  if(layerIds.has(layerId)||!roles.includes(role)||!name.trim()||!Array.isArray(l.objects))fail();layerIds.add(layerId);
  if((layerId==='artwork'&&role!=='artwork')||(layerId==='cutline'&&role!=='cutline'))fail();
  const state={id:layerId,name,role,visible:bool(l.visible),locked:bool(l.locked),deleted:false,objects:'[]'};
  const objects:string[]=[];
  for(const rawObject of l.objects){
   const o=record(rawObject),style=record(o.style);if(!['path','compound'].includes(o.kind)||!Array.isArray(o.contours)||!o.contours.length||(o.kind==='path'&&o.contours.length!==1))fail();
   const data=metadata(o.data,role,objectIds,fonts),contours:paper.Path[]=[];let shape:Shape|undefined;
   try{
    for(const rawContour of o.contours){
     const c=record(rawContour);if(!Array.isArray(c.segments))fail();
     const segments=c.segments.map((values:unknown)=>{const [x,y,ix,iy,ox,oy]=tuple(values,6);return new paper.Segment(new paper.Point(x,y),new paper.Point(ix,iy),new paper.Point(ox,oy));});
     contours.push(new paper.Path({insert:false,segments,closed:bool(c.closed)}));
    }
    shape=o.kind==='path'?contours[0]:new paper.CompoundPath({insert:false,children:contours});
    shape.data=data;shape.visible=bool(o.visible);shape.locked=bool(o.locked);
    shape.fillColor=restoredColour(style.fill);shape.strokeColor=restoredColour(style.stroke);
    if(data.role==='artwork'&&data.fillPaint&&data.fillPaint.kind!=='colour'){
     if(shape.fillColor?.type!=='gradient'||data.fillPaint.kind==='pattern'&&!shape.fillColor.highlight)fail();
    }
    shape.strokeWidth=number(style.width,10000);if(style.width<0)fail();shape.strokeScaling=bool(style.scaling);
    if(!['nonzero','evenodd'].includes(style.fillRule)||!['butt','round','square'].includes(style.cap)||!['miter','round','bevel'].includes(style.join))fail();
    shape.fillRule=style.fillRule;shape.strokeCap=style.cap;shape.strokeJoin=style.join;shape.miterLimit=number(style.miter,10000);
    if(!Array.isArray(style.dash)||style.dash.length>1000)fail();shape.dashArray=style.dash.map((v:unknown)=>{const n=number(v,10000);return n>=0?n:fail();});
    shape.dashOffset=number(style.offset);shape.opacity=number(style.opacity,1);if(style.opacity<0)fail();
    if(![shape.bounds.left,shape.bounds.right,shape.bounds.top,shape.bounds.bottom].every(v=>Number.isFinite(v)&&Math.abs(v)<=MAX_COORDINATE_MM))fail();
    objects.push(shape.exportJSON({precision:12}) as unknown as string);
   }finally{shape?.remove();contours.forEach(path=>path.remove());}
  }
  if(layerId==='artwork')artwork=JSON.stringify(objects);else if(layerId==='cutline')cutlines=JSON.stringify(objects);else state.objects=JSON.stringify(objects);
  states.push(state);
 }
 // Earlier documents gain the empty default without replacing existing IDs or
 // geometry. The marker preserves deliberate layer removal in current files.
 if(!rasterLayerInitialized&&!states.some(layer=>layer.role==='raster')){
  let rasterId='raster',suffix=2;while(layerIds.has(rasterId))rasterId=`raster-${suffix++}`;
  layerIds.add(rasterId);states.push({id:rasterId,name:'Raster Engrave',role:'raster',visible:true,locked:false,deleted:false,objects:'[]'});
 }
 for(const role of ['artwork','cutline'])if(!layerIds.has(role))states.push({id:role,name:role==='artwork'?'Artwork':'Cut Path',role,visible:false,locked:false,deleted:true});
 await Promise.all([...fonts].map(loadTextFont));
 const activeLayerId=file.activeLayerId===undefined?'artwork':id(file.activeLayerId);
 return {snapshot:{grid,canvasSize,activeLayerId:layerIds.has(activeLayerId)?activeLayerId:'artwork',artwork,cutlines,layers:JSON.stringify(states),selected:null,selectedIds:[]},view:{zoom,center}};
}
