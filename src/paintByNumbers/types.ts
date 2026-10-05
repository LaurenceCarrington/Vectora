export type Point=[number,number];
export interface RasterSource {width:number;height:number;data:Uint8ClampedArray}
export interface QuantizedImage {width:number;height:number;labels:Int16Array;palette:string[]}
/** Actual glyph bounds relative to its creation origin, per mm of font size. */
export interface LabelMetric {number:number;left:number;top:number;width:number;height:number}
export type Smoothing='off'|'light'|'heavy';
export interface ProcessingSettings {colours:number;cleanupMM2:number;imageWidthMM:number;imageHeightMM:number;labelSizeMM:number;metrics:LabelMetric[];page?:PageSettings;clearanceMM?:number;smoothing?:Smoothing;fitLabels?:boolean}
export interface PaintRegion {id:number;paletteIndex:number;contours:Point[][];label:Point;pixels:number}
export interface PaintResult {width:number;height:number;palette:string[];regions:PaintRegion[];vertexCount:number;mergedCount:number}
export interface PageSettings {preset:'a4'|'a3'|'custom';orientation:'portrait'|'landscape';widthMM:number;heightMM:number;marginMM:number;labelSizeMM:number;lineWeightMM:number}
export type SheetItem={kind:'path';contours:Point[][];fill:string|null;stroke:string|null;weightMM:number;name:string}|{kind:'text';content:string;x:number;y:number;sizeMM:number;colour:string;name:string};
export interface SheetLayout {widthMM:number;heightMM:number;numbered:SheetItem[];reference:SheetItem[]}
export const DEFAULT_PAGE:PageSettings={preset:'a4',orientation:'portrait',widthMM:210,heightMM:297,marginMM:10,labelSizeMM:3,lineWeightMM:.2};
export const MAX_REGIONS=2000,MAX_VERTICES=100000;
