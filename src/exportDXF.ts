import {standardContours,circularBounds,validateDXFTolerance} from './dxfGeometry';
import {exportLaserDXF} from './exportLaserDXF';
import {standardDXF,type DXFEntity,type DXFTag} from './dxfDocument';
import {dimensionLabel,dimensionTextLayout} from './dimensions';
import {validNumber} from './units';
import type {Shape} from './types';
import {validateGeometryInput} from './geometry';
import {MAX_DXF_POINTS} from './processingLimits';
export type DXFFormat='standard'|'laser';
/** ASCII R2000: native circular geometry, flattened freeform paths and annotation TEXT. */
export function exportDXF(objects:readonly Shape[],includeArtwork=false,mode:DXFFormat='standard',tolerance?:number):string {
 validateDXFTolerance(tolerance);
 if(mode==='laser')return exportLaserDXF(objects,includeArtwork,tolerance);
 const exportable=objects.filter(object=>object.data.role==='cutline'||object.data.role==='engrave'||includeArtwork&&object.data.role==='artwork');
 validateGeometryInput(exportable);let vertices=0;
 const entities:DXFEntity[]=[],layers=new Map<string,number>([['0',7]]),names=new Map<string,string>();
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 const number=(n:number)=>{if(!validNumber(n))throw new Error('DXF geometry exceeds the supported coordinate range.');return n;};
 const include=(x:number,y:number)=>{number(x);number(y);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);};
 const layerName=(object:Shape):string=>{
  if(object.data.dimension){layers.set('ANNOTATIONS',7);return 'ANNOTATIONS';}
  const id=object.layer?.data.documentId??object.data.role,existing=names.get(id);if(existing)return existing;
  const base=(id==='cutline'?'CUTLINE':id==='artwork'?'ARTWORK':id==='engrave'?'ENGRAVE':object.layer?.name??object.data.role).toUpperCase().replace(/[^A-Z0-9_-]/g,'_').slice(0,31)||'LAYER';
  let name=base,suffix=2;while(layers.has(name)||name==='ANNOTATIONS'){const tail=`_${suffix++}`;name=base.slice(0,31-tail.length)+tail;}
  names.set(id,name);layers.set(name,object.data.role==='cutline'?1:object.data.role==='engrave'?5:7);return name;
 };
 for(const object of exportable){
  const role=object.data.role;if(role!=='cutline'&&role!=='engrave'&&!(includeArtwork&&role==='artwork'))continue;
  const layer=layerName(object);
  for(const geometry of standardContours(object,tolerance,MAX_DXF_POINTS-vertices)){
   vertices+=geometry.kind==='LWPOLYLINE'?geometry.contour.points.length:1;
   if(geometry.kind==='LWPOLYLINE'){
    const {points,closed}=geometry.contour;if(points.length<(closed?3:2))continue;
    const tags:DXFTag[]=[[100,'AcDbPolyline'],[90,points.length],[70,closed?1:0]];
    for(const p of points){include(p.x,-p.y);tags.push([10,p.x],[20,-p.y]);}
    entities.push({kind:'LWPOLYLINE',layer,tags});
   }else{
    circularBounds(geometry).forEach(p=>include(p.x,p.y));
    const tags:DXFTag[]=[[100,'AcDbCircle'],[10,number(geometry.cx)],[20,number(geometry.cy)],[30,0],[40,number(geometry.radius)]];
    if(geometry.kind==='ARC')tags.push([100,'AcDbArc'],[50,geometry.start],[51,geometry.end]);
    entities.push({kind:geometry.kind,layer,tags});
   }
  }
  if(object.data.dimension){
   const layout=dimensionTextLayout(object.data.dimension),p=layout.position;
   const label=layout.label.replace(/Ø/g,'%%c').replace(/[^\x20-\x7e]/g,char=>'\\U+'+char.charCodeAt(0).toString(16).toUpperCase().padStart(4,'0'));
   include(p.x,-p.y);const text=dimensionLabel(object);if(text){try{const b=text.bounds;include(b.left,-b.bottom);include(b.right,-b.top);}finally{text.remove();}}
   entities.push({kind:'TEXT',layer,tags:[[100,'AcDbText'],[10,number(p.x)],[20,number(-p.y)],[30,0],[40,number(layout.fontSize)],[1,label],[50,number(-layout.angle)],[7,'STANDARD'],[72,layout.centered?1:0],[11,p.x],[21,-p.y],[31,0],[100,'AcDbText'],[73,0]]});
  }
 }
 if(!entities.length)throw new Error(includeArtwork?'There are no exportable objects. Draw a shape first.':'There are no cut lines. Add a shape to Cut Path or enable “Include artwork”.');
 return standardDXF(entities,layers,{minX,minY,maxX,maxY});
}
export function downloadDXF(contents:string,format:DXFFormat='standard'):void {
  const url=URL.createObjectURL(new Blob([contents],{type:'application/dxf'}));
  const anchor=document.createElement('a'); anchor.href=url; anchor.download=format==='laser'?'vectora-laser.dxf':'vectora.dxf'; anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
