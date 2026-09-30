import paper from 'paper';
import type {Shape} from './types';
export type GradientColour=paper.Color&{origin:paper.Point;destination:paper.Point};
export type ColourPaint={kind:'colour';colour:string;opacity:number};
export type GradientPaint={kind:'gradient';type:'linear'|'radial';angle:number;opacity:number;stops:{colour:string;offset:number;opacity:number}[]};
export type PatternPaint={kind:'pattern';type:'stripes'|'crosshatch'|'dots'|'checkerboard';foreground:string;background:string;transparent:boolean;size:number;angle:number;detail:number;opacity:number};
export type FillPaint=ColourPaint|GradientPaint|PatternPaint;
export const defaultGradient=():GradientPaint=>({kind:'gradient',type:'linear',angle:0,opacity:1,stops:[{colour:'#FF0000',offset:0,opacity:1},{colour:'#0000FF',offset:1,opacity:1}]});
export const defaultPattern=():PatternPaint=>({kind:'pattern',type:'stripes',foreground:'#FF0000',background:'#FFFFFF',transparent:true,size:5,angle:45,detail:20,opacity:1});
export function validateFillPaint(value:unknown):FillPaint {
 const p=value as FillPaint;const fail=():never=>{throw new Error('This is not a valid fill appearance.');};
 const n=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:fail();
 const c=(v:unknown)=>typeof v==='string'&&/^#[\da-f]{6}$/i.test(v)?v.toUpperCase():fail();
 if(!p||typeof p!=='object')return fail();const opacity=n(p.opacity,0,1);
 if(p.kind==='colour')return {kind:p.kind,colour:c(p.colour),opacity};
 if(p.kind==='gradient'){
  if(!['linear','radial'].includes(p.type)||!Array.isArray(p.stops)||p.stops.length<2||p.stops.length>8)return fail();
  return {kind:p.kind,type:p.type,angle:n(p.angle,-360,360),opacity,stops:p.stops.map(s=>({colour:c(s?.colour),offset:n(s?.offset,0,1),opacity:n(s?.opacity,0,1)})).sort((a,b)=>a.offset-b.offset)};
 }
 if(p.kind==='pattern'&&['stripes','crosshatch','dots','checkerboard'].includes(p.type)&&typeof p.transparent==='boolean')return {kind:p.kind,type:p.type,foreground:c(p.foreground),background:c(p.background),transparent:p.transparent,size:n(p.size,.5,100),angle:n(p.angle,-360,360),detail:n(p.detail,5,90),opacity};
 return fail();
}
export const paintColour=(p:FillPaint):string=>p.kind==='colour'?p.colour:p.kind==='gradient'?p.stops[0].colour:p.foreground;
const alphaColour=(hex:string,alpha:number)=>{const c=new paper.Color(hex);c.alpha=alpha;return c;};
export function createPaintColour(p:FillPaint,bounds:paper.Rectangle):paper.Color {
 if(p.kind==='colour')return new paper.Color(p.colour);
 const radians=p.angle*Math.PI/180,direction=new paper.Point(Math.cos(radians),Math.sin(radians));
 if(p.kind==='gradient'){
  const half=Math.max(.001,p.type==='radial'?Math.max(bounds.width,bounds.height)/2:(Math.abs(direction.x)*bounds.width+Math.abs(direction.y)*bounds.height)/2);
  return new paper.Color({gradient:{stops:p.stops.map(s=>new paper.GradientStop(alphaColour(s.colour,s.opacity),s.offset)),radial:p.type==='radial'},origin:p.type==='radial'?bounds.center:bounds.center.subtract(direction.multiply(half)),destination:bounds.center.add(direction.multiply(half))});
 }
 // A gradient's three native points carry the pattern's affine frame through
 // Paper transforms, cloning and history. Canvas drawing supplies a repeating tile.
 const origin=bounds.topLeft,destination=origin.add(direction.multiply(p.size)),highlight=origin.add(new paper.Point(-direction.y,direction.x).multiply(p.size));
 return new paper.Color({gradient:{stops:[[p.foreground,0],[p.background,1]]},origin,destination,highlight});
}
const tiles=new Map<string,HTMLCanvasElement>();
function patternTile(p:PatternPaint):HTMLCanvasElement {
 const key=JSON.stringify([p.type,p.foreground,p.background,p.transparent,p.detail]);let tile=tiles.get(key);if(tile)return tile;
 tile=document.createElement('canvas');tile.width=tile.height=128;const ctx=tile.getContext('2d')!;
 if(!p.transparent){ctx.fillStyle=p.background;ctx.fillRect(0,0,128,128);}ctx.fillStyle=p.foreground;const detail=p.detail/100;
 if(p.type==='dots'){ctx.beginPath();ctx.arc(64,64,64*detail,0,Math.PI*2);ctx.fill();}
 else if(p.type==='checkerboard'){ctx.fillRect(0,0,64,64);ctx.fillRect(64,64,64,64);}
 else {ctx.fillRect(0,0,128,128*detail);if(p.type==='crosshatch')ctx.fillRect(0,0,128*detail,128);}
 tiles.set(key,tile);if(tiles.size>64)tiles.delete(tiles.keys().next().value!);return tile;
}
const boundPatterns=new WeakMap<paper.Color,string>();
export function refreshFillPaint(item:paper.Item):void {
 const p=item.data.fillPaint as FillPaint|undefined,color=item.fillColor;if(item.data.role!=='artwork'||p?.kind!=='pattern'||color?.type!=='gradient')return;
 const key=JSON.stringify(p);if(boundPatterns.get(color)===key)return;boundPatterns.set(color,key);
 // toCanvasStyle is Paper's colour renderer. Override only this colour instance;
 // model geometry remains an ordinary path with its exact clipping and hole rules.
 (color as GradientColour&{toCanvasStyle:(ctx:CanvasRenderingContext2D,matrix?:paper.Matrix)=>CanvasPattern|string}).toCanvasStyle=function(ctx,matrix){
  const inverse=matrix?.inverted(),point=(v:paper.Point)=>inverse?inverse.transform(v):v;
  const origin=point(this.origin),x=point(this.destination).subtract(origin),y=point(this.highlight).subtract(origin),pattern=ctx.createPattern(patternTile(p),'repeat');
  if(!pattern)return p.foreground;pattern.setTransform(new DOMMatrix([x.x/128,x.y/128,y.x/128,y.y/128,origin.x,origin.y]));return pattern;
 };
}
export function applyFillPaint(item:Shape,p:FillPaint):void {
 const previous=item.data.fillPaint as FillPaint|undefined,old=item.fillColor as GradientColour|null,next=createPaintColour(p,item.bounds) as GradientColour;
 // Colour/opacity edits retain the transformed frame. Geometry controls start a new frame.
 if(previous&&p.kind!=='colour'&&previous.kind===p.kind&&old?.type==='gradient'&&previous.type===p.type&&previous.angle===p.angle&&(p.kind!=='pattern'||previous.kind==='pattern'&&previous.size===p.size)){
  next.origin=old.origin.clone();next.destination=old.destination.clone();if(p.kind==='pattern')next.highlight=old.highlight.clone();
 }
 item.fillColor=next;item.opacity=p.opacity;
 if(p.kind==='colour'){delete item.data.fillPaint;item.data.regionFillColor=p.colour;item.data.customColour=p.colour;}
 else {item.data.fillPaint=structuredClone(p);item.data.regionFillColor=paintColour(p);item.data.customColour=paintColour(p);refreshFillPaint(item);}
}
const NS='http://www.w3.org/2000/svg';
function node(name:string,attrs:Record<string,string|number>):SVGElement {const el=document.createElementNS(NS,name);for(const [key,value] of Object.entries(attrs))el.setAttribute(key,String(value));return el;}
/** SVG uses the same transformed paint frame as the editor; PNG and PDF consume it. */
export function paintDefinition(p:Exclude<FillPaint,ColourPaint>,color:paper.Color,id:string):SVGElement {
 const frame=color as GradientColour,o=frame.origin,d=frame.destination;
 if(p.kind==='gradient'){
  const el=p.type==='linear'?node('linearGradient',{id,gradientUnits:'userSpaceOnUse',x1:o.x,y1:o.y,x2:d.x,y2:d.y}):node('radialGradient',{id,gradientUnits:'userSpaceOnUse',cx:o.x,cy:o.y,r:Math.max(.001,o.getDistance(d))});
  for(const s of p.stops)el.append(node('stop',{offset:s.offset,'stop-color':s.colour,'stop-opacity':s.opacity}));return el;
 }
 const x=d.subtract(o),y=color.highlight.subtract(o),el=node('pattern',{id,patternUnits:'userSpaceOnUse',width:1,height:1,patternTransform:`matrix(${x.x} ${x.y} ${y.x} ${y.y} ${o.x} ${o.y})`});
 if(!p.transparent)el.append(node('rect',{width:1,height:1,fill:p.background}));const detail=p.detail/100;
 if(p.type==='dots')el.append(node('circle',{cx:.5,cy:.5,r:detail/2,fill:p.foreground}));
 else if(p.type==='checkerboard'){el.append(node('rect',{width:.5,height:.5,fill:p.foreground}),node('rect',{x:.5,y:.5,width:.5,height:.5,fill:p.foreground}));}
 else{el.append(node('rect',{width:1,height:detail,fill:p.foreground}));if(p.type==='crosshatch')el.append(node('rect',{width:detail,height:1,fill:p.foreground}));}
 return el;
}
export function paintPreview(p:FillPaint):string {
 const svg=node('svg',{viewBox:'0 0 100 60',preserveAspectRatio:'none',xmlns:NS});if(p.kind==='colour'){svg.append(node('rect',{width:100,height:60,fill:p.colour,opacity:p.opacity}));}
 else {const color=createPaintColour(p,new paper.Rectangle(0,0,100,60)),defs=node('defs',{});defs.append(paintDefinition(p,color,`paint-preview-${p.kind}`));svg.append(defs,node('rect',{width:100,height:60,fill:`url(#paint-preview-${p.kind})`,opacity:p.opacity}));}
 return new XMLSerializer().serializeToString(svg);
}
