import { createTextShape, isStrokeFont } from './text';
import { dimensionTextLayout } from './dimensions';
import type { Shape } from './types';
import { flattenInDocument, signedArea } from './geometry';
import { NUMERIC_EPSILON_MM } from './units';
/** ASCII DXF R2000, 2D LWPOLYLINE and annotation TEXT subset. No viewport or overlay data. */
export function exportDXF(objects: readonly Shape[], includeArtwork = false): string {
  const entities: string[] = [];
  let handle = 256;
  const layerNames=new Map<string,string>(),layerColors=new Map<string,number>([['0',7],['CUTLINE',1],['ARTWORK',7],['ANNOTATIONS',7]]);
  const dxfLayer=(object:Shape):string=>{
    if(object.data.dimension)return 'ANNOTATIONS';
    const id=object.layer?.data.documentId??object.data.role,role=object.data.role;
    let name=layerNames.get(id);if(name)return name;
    const base=id==='cutline'?'CUTLINE':id==='artwork'?'ARTWORK':id==='engrave'?'ENGRAVE':(object.layer?.name??role).toUpperCase().replace(/[^A-Z0-9_-]/g,'_');
    name=base;let suffix=2;while(layerColors.has(name)&&name!=='CUTLINE'&&name!=='ARTWORK')name=`${base}_${suffix++}`;
    layerNames.set(id,name);layerColors.set(name,role==='cutline'?1:role==='engrave'?5:7);return name;
  };
  const pair = (code:number, value:string|number) => `${code}\n${value}\n`;
  for (const object of objects) {
    const role = object.data.role;
    if (role !== 'cutline' && role !== 'engrave' && !(includeArtwork && role === 'artwork')) continue;
    const targetLayer=dxfLayer(object);
    for (const contour of exportContours(object)) {
      if (contour.points.length < (contour.closed ? 3 : 2)) continue;
      if (contour.closed && Math.abs(signedArea(contour.points)) < NUMERIC_EPSILON_MM) continue;
      let entity = pair(0,'LWPOLYLINE') + pair(5,(handle++).toString(16).toUpperCase()) + pair(100,'AcDbEntity') + pair(8,targetLayer) + pair(100,'AcDbPolyline') + pair(90,contour.points.length) + pair(70,contour.closed ? 1 : 0);
      for (const point of contour.points) entity += pair(10,format(point.x)) + pair(20,format(-point.y));
      entities.push(entity);
    }
    if(object.data.dimension){
      const layout=dimensionTextLayout(object.data.dimension),position=layout.position,centered=layout.centered;
      const label=layout.label.replace(/Ø/g,'%%c').replace(/[^\x20-\x7e]/g,char=>'\\U+'+char.charCodeAt(0).toString(16).toUpperCase().padStart(4,'0'));
      entities.push(pair(0,'TEXT')+pair(5,(handle++).toString(16).toUpperCase())+pair(100,'AcDbEntity')+pair(8,'ANNOTATIONS')+pair(100,'AcDbText')+pair(10,format(position.x))+pair(20,format(-position.y))+pair(30,0)+pair(40,format(layout.fontSize))+pair(1,label)+pair(50,format(-layout.angle))+pair(72,centered?1:0)+pair(11,format(position.x))+pair(21,format(-position.y))+pair(31,0)+pair(100,'AcDbText')+pair(73,0));
    }
  }
  if (!entities.length) throw new Error(includeArtwork ? 'There are no exportable objects. Draw a shape first.' : 'There are no cut lines. Create a Sticker Outline or enable “Include artwork”.');
  let header = pair(0,'SECTION')+pair(2,'HEADER')+pair(9,'$ACADVER')+pair(1,'AC1015')+pair(9,'$INSUNITS')+pair(70,4)+pair(9,'$MEASUREMENT')+pair(70,1)+pair(9,'$INSBASE')+pair(10,0)+pair(20,0)+pair(30,0)+pair(0,'ENDSEC');
  header += pair(0,'SECTION')+pair(2,'TABLES')+pair(0,'TABLE')+pair(2,'LTYPE')+pair(70,1)+pair(0,'LTYPE')+pair(100,'AcDbSymbolTableRecord')+pair(100,'AcDbLinetypeTableRecord')+pair(2,'CONTINUOUS')+pair(70,0)+pair(3,'Solid line')+pair(72,65)+pair(73,0)+pair(40,0)+pair(0,'ENDTAB')+pair(0,'TABLE')+pair(2,'LAYER')+pair(70,layerColors.size);
  for (const [name,color] of layerColors) header += pair(0,'LAYER')+pair(100,'AcDbSymbolTableRecord')+pair(100,'AcDbLayerTableRecord')+pair(2,name)+pair(70,0)+pair(62,color)+pair(6,'CONTINUOUS');
  return header+pair(0,'ENDTAB')+pair(0,'ENDSEC')+pair(0,'SECTION')+pair(2,'ENTITIES')+entities.join('')+pair(0,'ENDSEC')+pair(0,'EOF');
}
function format(value:number):string { return Number(value.toFixed(8)).toString(); }
export function downloadDXF(contents:string):void {
  const url=URL.createObjectURL(new Blob([contents],{type:'application/dxf'}));
  const anchor=document.createElement('a'); anchor.href=url; anchor.download='vectora.dxf'; anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function exportContours(object:Shape){
  if(!object.data.text||!isStrokeFont(object.data.text.fontId))return flattenInDocument(object);
  const strokes=createTextShape(object.data.text,true);
  try{return flattenInDocument(strokes);}finally{strokes.remove();}
}
