import type {Shape,Vertex} from './types';
import {dimensionLabel,dimensionTextLayout} from './dimensions';
import {NUMERIC_EPSILON_MM,validNumber} from './units';
import {exportContours} from './dxfGeometry';

/** Legacy ASCII R12: independent 2D LINEs and optional annotation TEXT. One drawing unit is 1 mm. */
export function exportLaserDXF(objects:readonly Shape[],includeArtwork:boolean,tolerance?:number):string {
 const pair=(code:number,value:string|number)=>`${code}\r\n${value}\r\n`;
 const number=(n:number)=>{if(!validNumber(n))throw new Error('DXF geometry exceeds the supported coordinate range.');return String(Number(n.toFixed(8)));};
 const entities:string[]=[],layers=new Map<string,number>([['0',7]]),names=new Map<string,string>();
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 const include=(x:number,y:number)=>{number(x);number(y);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);};
 const layerName=(object:Shape):string=>{
  if(object.data.dimension){layers.set('ANNOTATIONS',7);return 'ANNOTATIONS';}
  const id=object.layer?.data.documentId??object.data.role,existing=names.get(id);if(existing)return existing;
  const base=(id==='cutline'?'CUTLINE':id==='artwork'?'ARTWORK':id==='engrave'?'ENGRAVE':object.layer?.name??object.data.role).toUpperCase().replace(/[^A-Z0-9_-]/g,'_').slice(0,31)||'LAYER';
  let name=base,suffix=2;while(layers.has(name)||name==='ANNOTATIONS'){const tail=`_${suffix++}`;name=base.slice(0,31-tail.length)+tail;}
  names.set(id,name);layers.set(name,object.data.role==='cutline'?1:object.data.role==='engrave'?5:7);return name;
 };
 for(const object of objects){
  const role=object.data.role;if(role!=='cutline'&&role!=='engrave'&&!(includeArtwork&&role==='artwork'))continue;
  const layer=layerName(object),style=pair(8,layer)+pair(6,'CONTINUOUS')+pair(62,layers.get(layer)!);
  const line=(a:Vertex,b:Vertex)=>{
   if(Math.hypot(a.x-b.x,a.y-b.y)<=NUMERIC_EPSILON_MM)return;
   include(a.x,-a.y);include(b.x,-b.y);
   entities.push(pair(0,'LINE')+style+pair(10,number(a.x))+pair(20,number(-a.y))+pair(30,0)+pair(11,number(b.x))+pair(21,number(-b.y))+pair(31,0));
  };
  for(const contour of exportContours(object,tolerance)){
   const points=contour.points;if(points.length<(contour.closed?3:2))continue;
   for(let i=1;i<points.length;i++)line(points[i-1],points[i]);
   if(contour.closed)line(points[points.length-1],points[0]);
  }
  if(object.data.dimension){
   const layout=dimensionTextLayout(object.data.dimension),p=layout.position,label=layout.label.replace(/Ø/g,'%%c');
   if(/[^\x20-\x7e]/.test(label)||label.length>255)throw new Error('Laser-compatible DXF annotation labels support up to 255 ASCII characters and the diameter symbol. Edit the label or use another export format.');
   include(p.x,-p.y);
   const text=dimensionLabel(object);if(text){try{const b=text.bounds;include(b.left,-b.bottom);include(b.right,-b.top);}finally{text.remove();}}
   entities.push(pair(0,'TEXT')+style+pair(7,'STANDARD')+pair(10,number(p.x))+pair(20,number(-p.y))+pair(30,0)+pair(40,number(layout.fontSize))+pair(1,label)+pair(50,number(-layout.angle))+pair(72,layout.centered?1:0)+pair(11,number(p.x))+pair(21,number(-p.y))+pair(31,0)+pair(73,0));
  }
 }
 if(!entities.length)throw new Error(includeArtwork?'There are no exportable objects. Draw a shape first.':'There are no cut lines. Add a shape to Cut Path or enable “Include artwork”.');
 const point=(name:string,x:number,y:number)=>pair(9,name)+pair(10,number(x))+pair(20,number(y))+pair(30,0);
 // R12 has no standardized $INSUNITS. Keep numeric millimetres and ask for mm on import.
 let out=pair(0,'SECTION')+pair(2,'HEADER')+pair(9,'$ACADVER')+pair(1,'AC1009')+pair(9,'$LUNITS')+pair(70,2)+pair(9,'$LUPREC')+pair(70,8)+point('$INSBASE',0,0)+point('$EXTMIN',minX,minY)+point('$EXTMAX',maxX,maxY)+pair(0,'ENDSEC');
 out+=pair(0,'SECTION')+pair(2,'TABLES')+pair(0,'TABLE')+pair(2,'LTYPE')+pair(70,1)+pair(0,'LTYPE')+pair(2,'CONTINUOUS')+pair(70,0)+pair(3,'Solid line')+pair(72,65)+pair(73,0)+pair(40,0)+pair(0,'ENDTAB');
 out+=pair(0,'TABLE')+pair(2,'LAYER')+pair(70,layers.size);
 for(const [name,color] of layers)out+=pair(0,'LAYER')+pair(2,name)+pair(70,0)+pair(62,color)+pair(6,'CONTINUOUS');
 out+=pair(0,'ENDTAB')+pair(0,'TABLE')+pair(2,'STYLE')+pair(70,1)+pair(0,'STYLE')+pair(2,'STANDARD')+pair(70,0)+pair(40,0)+pair(41,1)+pair(50,0)+pair(71,0)+pair(42,1)+pair(3,'txt')+pair(4,'')+pair(0,'ENDTAB')+pair(0,'ENDSEC');
 return out+pair(0,'SECTION')+pair(2,'ENTITIES')+entities.join('')+pair(0,'ENDSEC')+pair(0,'EOF');
}
