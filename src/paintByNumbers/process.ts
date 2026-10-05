import {quantize} from './quantize';
import {buildRegions} from './regions';
import type {PaintResult,ProcessingSettings,RasterSource} from './types';
export function processPaint(source:RasterSource,settings:ProcessingSettings):PaintResult {
 const s=settings;
 if(![s.cleanupMM2,s.imageWidthMM,s.imageHeightMM,s.labelSizeMM].every(Number.isFinite)||s.cleanupMM2<0||s.cleanupMM2>10000||s.imageWidthMM<=0||s.imageWidthMM>2000||s.imageHeightMM<=0||s.imageHeightMM>2000||s.labelSizeMM<1.5||s.labelSizeMM>10)throw new Error('Check the page, cleanup and label settings.');
 if(!Array.isArray(s.metrics)||s.metrics.length!==32||s.metrics.some((m,i)=>m.number!==i+1||![m.left,m.top,m.width,m.height].every(Number.isFinite)||m.width<=0||m.height<=0||m.width>5||m.height>5))throw new Error('The label font is not ready. Try again.');
 return buildRegions(quantize(source,s.colours),s);
}
