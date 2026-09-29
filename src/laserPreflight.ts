import type {Shape} from './types';
import type {LaserJobSettings} from './laserJob';
import {validateLaserJobSettings} from './laserJob';
import {pathsOf} from './geometry';
import {documentPath} from './deletion';
import {hasFilledArea} from './shapeStyles';

export type LaserOperation='cutline'|'engrave';
export interface LaserJobPath {
  objectId:string;
  role:LaserOperation;
  d:string;
  closed:boolean;
  filled:boolean;
  bounds:{x:number;y:number;width:number;height:number};
}
export interface LaserIssue {
  code:'empty-job'|'open-cut'|'duplicate-cut'|'bed-too-small'|'filled-engrave'|'degenerate-cut'|'analysis-limit';
  severity:'error'|'warning';
  message:string;
  objectId?:string;
}
export interface LaserJobAnalysis {
  paths:LaserJobPath[];
  bounds:{x:number;y:number;width:number;height:number};
  fitBounds:{x:number;y:number;width:number;height:number};
  cutLengthMM:number;
  engraveLengthMM:number;
  issues:LaserIssue[];
  complete:boolean;
}

const SEGMENT_LIMIT=20000;
const CONTOUR_LIMIT=5000;
const mm=(value:number)=>`${Number(value.toFixed(2))} mm`;
const quantize=(value:number)=>Math.round(value*1e6);

/** Lexicographically least cyclic rotation; linear time for dense paths. */
function rotation(tokens:string[]):string {
  const count=tokens.length,doubled=[...tokens,...tokens];let first=0,second=1,offset=0;
  while(first<count&&second<count&&offset<count){
    const a=doubled[first+offset],b=doubled[second+offset];
    if(a===b){offset++;continue;}
    if(a>b)first+=offset+1;else second+=offset+1;
    if(first===second)second++;offset=0;
  }
  const start=Math.min(first,second);
  return Array.from({length:count},(_,index)=>doubled[start+index]).join('|');
}

function contourKey(path:ReturnType<typeof documentPath>):string {
  const segments=path.segments;
  const token=(segment:typeof segments[number],reverse=false)=>{
    const incoming=reverse?segment.handleOut:segment.handleIn;
    const outgoing=reverse?segment.handleIn:segment.handleOut;
    return [segment.point.x,segment.point.y,incoming.x,incoming.y,outgoing.x,outgoing.y].map(quantize).join(',');
  };
  const forward=segments.map(segment=>token(segment));
  const backward=[...segments].reverse().map(segment=>token(segment,true));
  const a=path.closed?rotation(forward):forward.join('|');
  const b=path.closed?rotation(backward):backward.join('|');
  return `${path.closed?'closed':'open'}:${a<b?a:b}`;
}

/** Inspect document-space geometry without altering a source Paper item or exporting kerf offsets. */
export function analyzeLaserJob(objects:readonly Shape[],settings:LaserJobSettings):LaserJobAnalysis {
  const job=validateLaserJobSettings(settings);
  const sources=objects.filter(item=>{
    const role=item.layer?.data.objectRole;
    return !item.layer?.data.deleted&&(role==='cutline'||role==='engrave');
  });
  const zero={x:0,y:0,width:0,height:0};
  const result:LaserJobAnalysis={paths:[],bounds:{...zero},fitBounds:{...zero},cutLengthMM:0,engraveLengthMM:0,issues:[],complete:true};
  let totalSegments=0,totalContours=0;
  for(const item of sources){for(const path of pathsOf(item)){
    totalContours++;totalSegments+=path.segments.length;
    if(totalContours>CONTOUR_LIMIT||totalSegments>SEGMENT_LIMIT)break;
  }if(totalContours>CONTOUR_LIMIT||totalSegments>SEGMENT_LIMIT)break;}
  if(totalSegments>SEGMENT_LIMIT||totalContours>CONTOUR_LIMIT){
    result.complete=false;
    result.issues.push({code:'analysis-limit',severity:'warning',message:'This job has too many contours or path segments to check completely. Simplify the design before export.'});
    return result;
  }
  if(!sources.length){
    result.issues.push({code:'empty-job',severity:'error',message:'Add a Cut Path or Engrave Path before exporting a laser job.'});
    return result;
  }
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  let cutMinX=Infinity,cutMinY=Infinity,cutMaxX=-Infinity,cutMaxY=-Infinity;
  let engraveMinX=Infinity,engraveMinY=Infinity,engraveMaxX=-Infinity,engraveMaxY=-Infinity;
  const seenCuts=new Map<string,string>();
  for(const item of sources){
    const role=item.layer.data.objectRole as LaserOperation;
    const objectId=String(item.data.uid??'');
    if(role==='engrave'&&hasFilledArea(item))result.issues.push({code:'filled-engrave',severity:'warning',objectId,message:`${item.data.name??'Engrave shape'} is filled. DXF exports its outline; configure area engraving in your laser software.`});
    for(const source of pathsOf(item)){
      const path=documentPath(source);
      try{
        const bounds=path.bounds;
        if(![bounds.x,bounds.y,bounds.width,bounds.height,path.length].every(Number.isFinite)){
          result.complete=false;
          result.issues.push({code:'degenerate-cut',severity:'error',objectId,message:'A path has invalid geometry.'});
          continue;
        }
        minX=Math.min(minX,bounds.left);minY=Math.min(minY,bounds.top);
        maxX=Math.max(maxX,bounds.right);maxY=Math.max(maxY,bounds.bottom);
        if(role==='cutline'){
          cutMinX=Math.min(cutMinX,bounds.left);cutMinY=Math.min(cutMinY,bounds.top);
          cutMaxX=Math.max(cutMaxX,bounds.right);cutMaxY=Math.max(cutMaxY,bounds.bottom);
        }else{
          engraveMinX=Math.min(engraveMinX,bounds.left);engraveMinY=Math.min(engraveMinY,bounds.top);
          engraveMaxX=Math.max(engraveMaxX,bounds.right);engraveMaxY=Math.max(engraveMaxY,bounds.bottom);
        }
        const filled=role==='engrave'&&hasFilledArea(item)&&path.closed;
        result.paths.push({objectId,role,d:path.pathData,closed:path.closed,filled,bounds:{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height}});
        if(role==='cutline'){
          result.cutLengthMM+=path.length;
          if(!path.closed)result.issues.push({code:'open-cut',severity:'warning',objectId,message:`${item.data.name??'Cut path'} is open; the cut may not separate material.`});
          else if(Math.abs(path.area)<1e-9||path.length<1e-6)result.issues.push({code:'degenerate-cut',severity:'warning',objectId,message:`${item.data.name??'Cut path'} has no usable enclosed area.`});
          if(path.length>=1e-6&&(!path.closed||Math.abs(path.area)>=1e-9)){
            const key=contourKey(path),previous=seenCuts.get(key);
            if(previous!==undefined)result.issues.push({code:'duplicate-cut',severity:'warning',objectId,message:`${item.data.name??'Cut path'} duplicates another cut contour.`});
            else seenCuts.set(key,objectId);
          }
        }else result.engraveLengthMM+=path.length;
      }finally{path.remove();}
    }
  }
  if(result.paths.length&&Number.isFinite(minX)){
    const width=maxX-minX,height=maxY-minY;
    result.bounds={x:minX,y:minY,width,height};
    const halfKerf=job.kerfMM/2;
    const fitMinX=Math.min(Number.isFinite(cutMinX)?cutMinX-halfKerf:Infinity,engraveMinX);
    const fitMinY=Math.min(Number.isFinite(cutMinY)?cutMinY-halfKerf:Infinity,engraveMinY);
    const fitMaxX=Math.max(Number.isFinite(cutMaxX)?cutMaxX+halfKerf:-Infinity,engraveMaxX);
    const fitMaxY=Math.max(Number.isFinite(cutMaxY)?cutMaxY+halfKerf:-Infinity,engraveMaxY);
    const requiredWidth=fitMaxX-fitMinX,requiredHeight=fitMaxY-fitMinY;
    result.fitBounds={x:fitMinX,y:fitMinY,width:requiredWidth,height:requiredHeight};
    if(requiredWidth>job.bedWidthMM+1e-9||requiredHeight>job.bedHeightMM+1e-9){
      result.issues.push({code:'bed-too-small',severity:'warning',message:`Job needs ${mm(requiredWidth)} × ${mm(requiredHeight)}${Number.isFinite(cutMinX)?' including the kerf band':''}; bed is ${mm(job.bedWidthMM)} × ${mm(job.bedHeightMM)}.`});
    }
  }
  return result;
}
