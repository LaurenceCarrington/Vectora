import type paper from 'paper';
import type {ObjectRole} from './types';
export const LAYER_TYPES=[
  {role:'artwork',name:'Artwork',type:'artwork',color:'--layer-artwork'},
  {role:'cutline',name:'Cut Path',type:'cut',color:'--color-cutline'},
  {role:'engrave',name:'Engrave Path',type:'engrave',color:'--color-engrave'},
  {role:'construction',name:'Construction Path',type:'construction',color:'--color-construction'},
  {role:'raster',name:'Raster Engrave',type:'raster',color:'--layer-raster'},
] as const;
export const layerType=(role:ObjectRole)=>LAYER_TYPES.find(type=>type.role===role)!;
export const layerId=(layer:paper.Layer):string=>layer.data.documentId;
export const layerRole=(layer:paper.Layer):ObjectRole=>layer.data.objectRole;
export interface LayerSnapshot {id:string;name:string;role:ObjectRole;visible:boolean;locked:boolean;deleted:boolean;objects?:string}
