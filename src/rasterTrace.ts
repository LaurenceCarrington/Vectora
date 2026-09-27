import {traceBinaryImage,traceLoopToSvgPath,type TracePathCommand} from './vectorizer/autoTracer';
import {traceCenterlines,centerlinePathToSvgPath} from './vectorizer/centerlineTracer';
import {preprocessImageData} from './vectorizer/imagePreprocess';
export type TraceMode='outline'|'centerline'|'fill';
export type TracePoint=[number,number];
export interface TracePath {points:TracePoint[];closed:boolean;commands?:readonly TracePathCommand[];svg:string}
export interface TraceResult {paths:TracePath[];width:number;height:number;mode:TraceMode;pointCount:number;foregroundPixels:number}
export interface RasterTraceSettings {threshold:number;brightness:number;contrast:number;despeckleSize:number;invert:boolean;simplifyTolerance:number;curveFitting:number;cornerSensitivity:number}
export const DEFAULT_TRACE_SETTINGS:RasterTraceSettings={threshold:128,brightness:0,contrast:0,despeckleSize:8,invert:false,simplifyTolerance:1.25,curveFitting:0.65,cornerSensitivity:0.55};
/** Adapter around the original Vectora preprocessing and tracing pipeline. */
export function processRaster(source:ImageData,mode:TraceMode,settings:RasterTraceSettings){
  const preprocessed=preprocessImageData(source,settings);
  const options={...settings,minimumPathArea:Math.max(2,settings.despeckleSize),maximumPaths:5000};
  const traced=mode==='centerline'?traceCenterlines(preprocessed.mask,source.width,source.height,{minimumPathLength:Math.max(2,settings.despeckleSize),simplifyTolerance:settings.simplifyTolerance,maximumPaths:5000}):traceBinaryImage(preprocessed.mask,source.width,source.height,options);
  const paths:TracePath[]=traced.mode==='centerline'?traced.paths.map(path=>({points:path.points.map(p=>[p.x,p.y]),closed:false,svg:centerlinePathToSvgPath(path)})):traced.loops.map(loop=>({points:loop.points.map(p=>[p.x,p.y]),closed:true,commands:loop.commands,svg:traceLoopToSvgPath(loop)}));
  return {result:{paths,width:source.width,height:source.height,mode,pointCount:traced.pointCount,foregroundPixels:preprocessed.foregroundPixels} satisfies TraceResult,preview:preprocessed.imageData};
}
export function traceRaster(rgba:Uint8ClampedArray,width:number,height:number,threshold:number,mode:TraceMode,options:Partial<RasterTraceSettings>={}):TraceResult{
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>1600||height>1600||rgba.length!==width*height*4)throw new Error('Invalid image dimensions.');
  return processRaster(new ImageData(new Uint8ClampedArray(rgba),width,height),mode,{...DEFAULT_TRACE_SETTINGS,...options,threshold}).result;
}
export function traceSVGPath(paths:TracePath[]):string{return paths.map(path=>path.svg).join(' ');}
