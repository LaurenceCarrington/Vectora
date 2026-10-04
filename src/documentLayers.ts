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
export interface LayerSnapshot {id:string;name:string;role:ObjectRole;visible:boolean;locked:boolean;deleted:boolean;objects?:string;colour?:string}

/** Reserved default IDs keep their operation names and colours. Older UUID layers are custom too. */
export const isCustomLayer=(layer:paper.Layer):boolean=>!LAYER_TYPES.some(type=>type.role===layerId(layer));
export const layerColour=(layer:paper.Layer):string=>layer.data.colour??getComputedStyle(document.documentElement).getPropertyValue(layerType(layerRole(layer)).color).trim();
export function validateLayerName(value:string):string {
 const name=value.trim();if(!name||name.length>200)throw new Error('Enter a layer name between 1 and 200 characters.');return name;
}
export function validateLayerColour(value:string):string {
 if(!/^#[0-9a-f]{6}$/i.test(value))throw new Error('Enter a six-digit hex layer colour.');return value.toUpperCase();
}
