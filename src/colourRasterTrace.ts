import {quantize} from './paintByNumbers/quantize';
import {buildRegions} from './paintByNumbers/regions';
import {smoothRegions} from './paintByNumbers/smoothing';
import type {ProcessingSettings} from './paintByNumbers/types';
import type {RasterTraceSettings,TracePath,TraceResult} from './rasterTrace';

/** Colour tracing shares cleanup and boundary smoothing with Colour by Numbers,
 * without its printed-label constraints or page layout. */
export function processColourRaster(source:ImageData,settings:RasterTraceSettings):{result:TraceResult;preview:ImageData} {
 const {brightness,contrast,despeckleSize,colourSmoothing}=settings;
 if(!Number.isFinite(brightness)||Math.abs(brightness)>100||!Number.isFinite(contrast)||Math.abs(contrast)>100||!Number.isFinite(despeckleSize)||despeckleSize<0||despeckleSize>64||![0,1,2].includes(colourSmoothing)||typeof settings.invert!=='boolean')throw new Error('Check the colour tracing settings.');
 const data=new Uint8ClampedArray(source.data),c=contrast*2.55,factor=259*(c+255)/(255*(259-c));
 for(let i=0;i<data.length;i+=4)for(let channel=0;channel<3;channel++){const value=Math.max(0,Math.min(255,factor*(data[i+channel]-128)+128+brightness*2.55));data[i+channel]=settings.invert?255-value:value;}
 const image=quantize({width:source.width,height:source.height,data},settings.colourCount,1600);
 const options:ProcessingSettings={colours:settings.colourCount,cleanupMM2:despeckleSize,imageWidthMM:source.width,imageHeightMM:source.height,labelSizeMM:0,metrics:[],fitLabels:false,smoothing:colourSmoothing===0?'off':colourSmoothing===1?'light':'heavy'};
 const regions=smoothRegions(buildRegions(image,options),options),paths:TracePath[]=regions.regions.map(region=>({points:region.contours.flat(),contours:region.contours,closed:true,fill:regions.palette[region.paletteIndex],svg:region.contours.map(c=>'M'+c.map(p=>p.join(' ')).join('L')+'Z').join(' ')}));
 return {result:{paths,width:source.width,height:source.height,mode:'colour',pointCount:regions.vertexCount,foregroundPixels:regions.regions.reduce((n,r)=>n+r.pixels,0)},preview:new ImageData(data,source.width,source.height)};
}
