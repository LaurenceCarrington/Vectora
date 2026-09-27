import paper from 'paper';
import { applyCutlineStyle } from './shapeStyles';
import ClipperFactory from 'clipper2-wasm/dist/es/clipper2z.js';
import wasmURL from 'clipper2-wasm/dist/es/clipper2z.wasm?url';
import type { MainModule, PathsD } from 'clipper2-wasm/dist/clipper2z';
import type { Contour, Shape } from './types';
import { exteriorContours, flattenInDocument, signedArea, validateOutlineContours, cleanVertices } from './geometry';
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

/** Resolve crossing and nested preview cut loops with even–odd material occupancy. */
export function previewCutContours(contours:Contour[]):Contour[] {
  if(!module)throw new Error('The outline engine is not ready.');
  const engine=module,input=new engine.PathsD();let output:PathsD|undefined;
  try{
    for(const contour of contours){const path=engine.MakePathD(contour.points.flatMap(p=>[p.x,p.y]));try{input.push_back(path);}finally{path.delete();}}
    output=engine.UnionSelfD(input,engine.FillRule.EvenOdd,CLIPPER_PRECISION);
    const result:Contour[]=[];
    for(let i=0;i<output.size();i++){const path=output.get(i);try{const points=[];for(let j=0;j<path.size();j++){const p=path.get(j);try{points.push({x:p.x,y:p.y});}finally{p.delete();}}if(points.length>=3)result.push({closed:true,points});}finally{path.delete();}}
    return result;
  }finally{output?.delete();input.delete();}
}
