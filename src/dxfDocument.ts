/** Minimal, owned R2000 database: model/paper spaces, symbol tables and layouts. */
export type DXFTag=[number,string|number];
export interface DXFEntity {kind:string;layer:string;tags:DXFTag[]}
export interface DXFBounds {minX:number;minY:number;maxX:number;maxY:number}
export function standardDXF(entities:DXFEntity[],layers:Map<string,number>,bounds:DXFBounds):string {
 let next=1;const handle=()=> (next++).toString(16).toUpperCase();
 const tableNames=['VPORT','LTYPE','LAYER','STYLE','VIEW','UCS','APPID','DIMSTYLE','BLOCK_RECORD'];
 const tables=new Map(tableNames.map(name=>[name,handle()]));
 const model=handle(),paper=handle(),root=handle(),groups=handle(),layouts=handle(),modelLayout=handle(),paperLayout=handle(),plotStyles=handle(),normalStyle=handle();
 const tags:DXFTag[]=[];const add=(...pairs:DXFTag[])=>tags.push(...pairs);
 const section=(name:string)=>add([0,'SECTION'],[2,name]);const end=()=>add([0,'ENDSEC']);
 const record=(kind:string,id:string,owner:string,...pairs:DXFTag[])=>add([0,kind],[5,id],[330,owner],...pairs);
 const symbol=(kind:string,...pairs:DXFTag[])=>record(kind,handle(),tables.get(kind)!,[100,'AcDbSymbolTableRecord'],...pairs);
 const {minX,minY,maxX,maxY}=bounds;
 section('CLASSES');
 for(const [name,cpp] of [['LAYOUT','AcDbLayout'],['ACDBDICTIONARYWDFLT','AcDbDictionaryWithDefault'],['ACDBPLACEHOLDER','AcDbPlaceHolder']])add([0,'CLASS'],[1,name],[2,cpp],[3,'ObjectDBX Classes'],[90,0],[280,0],[281,0]);
 end();section('TABLES');
 for(const name of tableNames){
  const count=name==='LTYPE'?3:name==='LAYER'?layers.size:name==='BLOCK_RECORD'?2:['VPORT','STYLE','APPID','DIMSTYLE'].includes(name)?1:0;
  add([0,'TABLE'],[2,name],[5,tables.get(name)!],[330,'0'],[100,'AcDbSymbolTable'],[70,count]);
  if(name==='VPORT')symbol(name,[100,'AcDbViewportTableRecord'],[2,'*Active'],[70,0],[10,0],[20,0],[11,1],[21,1],[12,(minX+maxX)/2],[22,(minY+maxY)/2],[13,0],[23,0],[14,.5],[24,.5],[15,.5],[25,.5],[16,0],[26,0],[36,1],[17,0],[27,0],[37,0],[40,Math.max(maxY-minY,maxX-minX,1)*1.2],[41,1],[42,50],[43,0],[44,0],[50,0],[51,0],[71,0],[72,100],[73,1],[74,3],[75,0],[76,0],[77,0],[78,0],[281,0],[65,0],[146,0]);
  if(name==='LTYPE')for(const line of ['ByBlock','ByLayer','CONTINUOUS'])symbol(name,[100,'AcDbLinetypeTableRecord'],[2,line],[70,0],[3,line==='CONTINUOUS'?'Solid line':''],[72,65],[73,0],[40,0]);
  // R2000 layer plot-style handles are required even when using indexed colours.
  if(name==='LAYER')for(const [layer,color] of layers)symbol(name,[100,'AcDbLayerTableRecord'],[2,layer],[70,0],[62,color],[6,'CONTINUOUS'],[370,-3],[390,normalStyle]);
  if(name==='STYLE')symbol(name,[100,'AcDbTextStyleTableRecord'],[2,'STANDARD'],[70,0],[40,0],[41,1],[50,0],[71,0],[42,1],[3,'txt'],[4,'']);
  if(name==='APPID')symbol(name,[100,'AcDbRegAppTableRecord'],[2,'ACAD'],[70,0]);
  if(name==='DIMSTYLE'){
   add([100,'AcDbDimStyleTable']);
   add([0,'DIMSTYLE'],[105,handle()],[330,tables.get(name)!],[100,'AcDbSymbolTableRecord'],[100,'AcDbDimStyleTableRecord'],[2,'Standard'],[70,0],[40,1],[41,2.5],[42,.625],[43,3.75],[44,1.25],[140,2.5],[141,2.5],[143,.03937007874],[144,1],[146,1],[147,.625],[77,1],[78,8],[171,3],[172,1],[271,2],[272,2],[273,2],[274,3],[277,2],[278,44],[284,8],[289,3],[371,-2],[372,-2]);
  }
  if(name==='BLOCK_RECORD')for(const [id,label,layout] of [[model,'*Model_Space',modelLayout],[paper,'*Paper_Space',paperLayout]])record(name,id,tables.get(name)!,[100,'AcDbSymbolTableRecord'],[100,'AcDbBlockTableRecord'],[2,label],[340,layout]);
  add([0,'ENDTAB']);
 }
 end();section('BLOCKS');
 for(const [id,name] of [[model,'*Model_Space'],[paper,'*Paper_Space']]){
  record('BLOCK',handle(),id,[100,'AcDbEntity'],[8,'0'],[100,'AcDbBlockBegin'],[2,name],[70,0],[10,0],[20,0],[30,0],[3,name],[1,'']);
  record('ENDBLK',handle(),id,[100,'AcDbEntity'],[8,'0'],[100,'AcDbBlockEnd']);
 }
 end();section('ENTITIES');
 for(const entity of entities){
  record(entity.kind,handle(),model,[100,'AcDbEntity'],[8,entity.layer],[6,'CONTINUOUS'],[62,layers.get(entity.layer)!]);
  for(const tag of entity.tags)tags.push(tag);
 }
 end();section('OBJECTS');
 record('DICTIONARY',root,'0',[100,'AcDbDictionary'],[280,0],[281,1],[3,'ACAD_GROUP'],[350,groups],[3,'ACAD_LAYOUT'],[350,layouts],[3,'ACAD_PLOTSTYLENAME'],[350,plotStyles]);
 record('ACDBDICTIONARYWDFLT',plotStyles,root,[100,'AcDbDictionary'],[281,1],[3,'Normal'],[350,normalStyle],[100,'AcDbDictionaryWithDefault'],[340,normalStyle]);
 record('ACDBPLACEHOLDER',normalStyle,plotStyles);
 record('DICTIONARY',groups,root,[100,'AcDbDictionary'],[280,0],[281,1]);
 record('DICTIONARY',layouts,root,[100,'AcDbDictionary'],[280,0],[281,1],[3,'Model'],[350,modelLayout],[3,'Layout1'],[350,paperLayout]);
 for(const [id,name,block,order] of [[modelLayout,'Model',model,0],[paperLayout,'Layout1',paper,1]] as const){
  record('LAYOUT',id,layouts,[100,'AcDbPlotSettings'],[1,''],[4,'A4'],[6,''],[40,0],[41,0],[42,0],[43,0],[44,297],[45,210],[46,0],[47,0],[48,0],[49,0],[140,0],[141,0],[142,1],[143,1],[70,order===0?1024:0],[72,1],[73,0],[74,5],[7,''],[75,16],[76,0],[77,2],[78,300],[147,1],[148,0],[149,0],
   [100,'AcDbLayout'],[1,name],[70,1],[71,order],[10,0],[20,0],[11,297],[21,210],[12,0],[22,0],[32,0],[14,minX],[24,minY],[34,0],[15,maxX],[25,maxY],[35,0],[146,0],[13,0],[23,0],[33,0],[16,1],[26,0],[36,0],[17,0],[27,1],[37,0],[76,1],[330,block]);
 }
 end();add([0,'EOF']);
 const header:DXFTag[]=[[0,'SECTION'],[2,'HEADER'],[9,'$ACADVER'],[1,'AC1015'],[9,'$DWGCODEPAGE'],[3,'ANSI_1252'],[9,'$HANDSEED'],[5,handle()],[9,'$INSUNITS'],[70,4],[9,'$MEASUREMENT'],[70,1],[9,'$LUNITS'],[70,2],[9,'$LUPREC'],[70,8],[9,'$INSBASE'],[10,0],[20,0],[30,0],[9,'$EXTMIN'],[10,minX],[20,minY],[30,0],[9,'$EXTMAX'],[10,maxX],[20,maxY],[30,0],[0,'ENDSEC']];
 return [...header,...tags].map(([code,value])=>`${code}\n${typeof value==='number'?Number(value.toFixed(8)):value}\n`).join('');
}
