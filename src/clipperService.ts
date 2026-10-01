import paper from 'paper';
import {layerType,layerRole} from './documentLayers';
import { applyCutlineStyle } from './shapeStyles';
import ClipperFactory from 'clipper2-wasm/dist/es/clipper2z.js';
import wasmURL from 'clipper2-wasm/dist/es/clipper2z.wasm?url';
import type { MainModule, PathsD } from 'clipper2-wasm/dist/clipper2z';
import type { Contour, Shape } from './types';
import { pathsOf, exteriorContours, flattenInDocument, signedArea, validateOutlineContours, cleanVertices } from './geometry';
import { CLIPPER_PRECISION, OFFSET_ARC_TOLERANCE_MM, validDimension } from './units';
let module: MainModule | undefined;
let initialization: Promise<void> | undefined;
export function initializeClipper(): Promise<void> {
  return initialization ??= ClipperFactory({locateFile:()=>wasmURL}).then(value=>{module=value;});
}
export function createStickerOutline(source: Shape, offsetDistanceMM: number): Shape {
  if (!module) throw new Error('The outline engine is not ready.');
  if (!validDimension(offsetDistanceMM) || offsetDistanceMM > 10000) throw new Error('Enter a positive outline distance from 0.001 to 10,000 mm.');
  const contours=flattenInDocument(source);
  validateOutlineContours(contours);
  const engine=module;
  const input=new engine.PathsD();
  let output:PathsD|undefined;
  const results:Contour[]=[];
  try {
    for (const contour of exteriorContours(contours)) {
      const points=signedArea(contour.points)>0 ? contour.points : [...contour.points].reverse();
      const path=engine.MakePathD(points.flatMap(p=>[p.x,p.y]));
      try { input.push_back(path); } finally { path.delete(); }
    }
    output=engine.InflatePathsD(input,offsetDistanceMM,engine.JoinType.Round,engine.EndType.Polygon,2,CLIPPER_PRECISION,OFFSET_ARC_TOLERANCE_MM);
    for(let i=0;i<output.size();i++) {
      const path=output.get(i);
      try {
        const points=[];
        for(let j=0;j<path.size();j++) {
          const point=path.get(j);
          try { points.push({x:point.x,y:point.y}); } finally { point.delete(); }
        }
        results.push({points:cleanVertices(points,true),closed:true});
      } finally { path.delete(); }
    }
  } finally { output?.delete(); input.delete(); }
  const exteriors=exteriorContours(results.filter(c=>c.points.length>=3));
  if (!exteriors.length) throw new Error('No exterior cut line was produced.');
  const paths=exteriors.map(c=>new paper.Path({insert:false,closed:true,segments:c.points.map(p=>new paper.Point(p.x,p.y))}));
  const result:Shape=paths.length===1 ? paths[0] : new paper.CompoundPath({insert:false,children:paths});
  applyCutlineStyle(result);
  result.data={role:'cutline',name:'Sticker outline',offsetDistanceMM};
  return result;
}

export type OffsetSettings={distance:number;direction:'inward'|'outward';corners:'round'|'sharp'|'bevel'};
export function offsetEligible(source:Shape):boolean {
  return !source.data.text&&!source.data.dimension&&source.visible&&!source.locked&&source.layer.visible&&!source.layer.locked&&!source.layer.data.deleted&&pathsOf(source).length>0&&pathsOf(source).every(p=>p.closed&&p.curves.length>1);
}
/** Offsets closed occupied areas, including holes, in document millimetres. */
export function createPathOffset(source:Shape,settings:OffsetSettings):Shape {
  if(!module)throw new Error('The outline engine is not ready.');
  const {distance,direction,corners}=settings;
  if(!validDimension(distance)||distance>10000)throw new Error('Enter a distance from 0.001 to 10,000 mm.');
  if(!['inward','outward'].includes(direction)||!['round','sharp','bevel'].includes(corners))throw new Error('Choose a direction and corner style.');
  if(source.data.text||source.data.dimension||!pathsOf(source).every(p=>p.closed))throw new Error('Select closed paths; convert text to paths first.');
  if(pathsOf(source).reduce((sum,p)=>sum+p.curves.length,0)>2000)throw new Error('This shape is too complex to offset.');
  const contours=flattenInDocument(source,Math.min(.01,distance/10));
  if(contours.reduce((sum,c)=>sum+c.points.length,0)>12000)throw new Error('This shape is too complex to offset.');
  const engine=module,input=new engine.PathsD();let normalized:PathsD|undefined,output:PathsD|undefined;
  const paths:paper.Path[]=[];
  try {
    for(const c of contours){if(c.points.length<3)continue;const path=engine.MakePathD(c.points.flatMap(p=>[p.x,p.y]));try{input.push_back(path);}finally{path.delete();}}
    // Unfilled nested outlines describe holes regardless of drawing direction. Filled shapes
    // retain their displayed fill rule. Union gives the offset engine consistent winding.
    normalized=engine.UnionSelfD(input,!source.fillColor||source.fillRule==='evenodd'?engine.FillRule.EvenOdd:engine.FillRule.NonZero,CLIPPER_PRECISION);
    // One chord per convex corner produces a true bevel (Square joins would extend it).
    const tolerance=corners==='bevel'?distance:Math.min(OFFSET_ARC_TOLERANCE_MM,distance/10);
    output=engine.InflatePathsD(normalized,direction==='inward'?-distance:distance,corners==='sharp'?engine.JoinType.Miter:engine.JoinType.Round,engine.EndType.Polygon,10,CLIPPER_PRECISION,tolerance);
    let count=0;
    for(let i=0;i<output.size();i++){
      const path=output.get(i),points=[];
      try{count+=path.size();if(count>20000)throw new Error('The offset is too complex. Try a smaller distance.');for(let j=0;j<path.size();j++){const p=path.get(j);try{points.push({x:p.x,y:p.y});}finally{p.delete();}}}finally{path.delete();}
      const vertices=cleanVertices(points,true);if(vertices.length>=3)paths.push(new paper.Path({insert:false,closed:true,segments:vertices.map(p=>new paper.Point(p.x,p.y))}));
    }
    if(!paths.length)throw new Error('This distance removes the whole shape. Try a smaller inward offset.');
    const result:Shape=paths.length===1?paths[0]:new paper.CompoundPath({insert:false,children:paths});
    result.style=source.style;result.opacity=source.opacity;result.fillColor=null;result.fillRule='evenodd';
    if(!result.strokeColor){result.strokeColor=new paper.Color(getComputedStyle(document.documentElement).getPropertyValue(layerType(layerRole(source.layer)).color).trim());result.strokeWidth=1.5;result.strokeScaling=false;}
    result.data={uid:crypto.randomUUID(),role:source.data.role,name:`${source.data.name??'Path'} offset`,rotationDegrees:0,customStroke:source.data.customStroke};
    return result;
  }catch(error){paths.forEach(p=>p.remove());throw error;}
  finally{output?.delete();normalized?.delete();input.delete();}
}
