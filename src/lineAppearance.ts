import type {Shape} from './types';
import {BASE_ZOOM} from './units';

export const LINE_DESIGNS=['solid','dashed','dotted','dash-dot'] as const;
export type LineDesign=typeof LINE_DESIGNS[number];
export function lineWeightMM(item:Shape):number {return item.strokeScaling?item.strokeWidth:item.strokeWidth/BASE_ZOOM;}
export function lineDesign(item:Shape):LineDesign {
 const dash=item.dashArray;
 return !dash.length?'solid':dash.length===2&&dash[0]===0?'dotted':dash.length===4?'dash-dot':'dashed';
}
export function validLineWeight(value:number):boolean {return Number.isFinite(value)&&value>=.001&&value<=1000;}
/** Explicit stroke settings use document millimetres; legacy default strokes use CSS pixels. */
export function applyLineWeight(item:Shape,weight:number):void {
 const previous=item.strokeWidth;
 item.dashArray=item.dashArray.map(value=>previous?value*weight/previous:value);
 item.dashOffset=previous?item.dashOffset*weight/previous:item.dashOffset;
 item.strokeWidth=weight;item.strokeScaling=true;item.data.customStroke=true;
}
export function applyLineDesign(item:Shape,design:LineDesign):void {
 const weight=lineWeightMM(item);
 applyLineWeight(item,weight);
 item.dashArray=design==='solid'?[]:design==='dashed'?[4*weight,2*weight]:design==='dotted'?[0,2*weight]:[4*weight,2*weight,0,2*weight];
 item.strokeCap=design==='dotted'||design==='dash-dot'?'round':'butt';item.dashOffset=0;
}
