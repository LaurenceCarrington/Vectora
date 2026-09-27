import paper from 'paper';
import {hasFilledArea} from './shapeStyles';
import {flattenInDocument,pathsOf,contains,signedArea} from './geometry';
import {documentPath} from './deletion';
import {initializeClipper,previewCutContours} from './clipperService';
import type {Contour,Shape} from './types';
export interface PreviewMark {path:string;fill:boolean;fillRule:CanvasFillRule}
export interface PreviewModel {contours:Contour[];parents:number[];depths:number[];marks:PreviewMark[];bounds:{x:number;y:number;width:number;height:number};openCuts:number;stock:boolean;parts:number;holes:number}
/** Copies geometry only; hidden objects, annotations, artwork and construction are excluded. */
export async function buildPreviewModel(objects:readonly Shape[]):Promise<PreviewModel|null>{
 const cuts:Contour[]=[],marks:PreviewMark[]=[];let extent:paper.Rectangle|null=null,openCuts=0,vertices=0;
 const items=objects.filter(item=>item.visible&&item.layer.visible&&!item.layer.data.deleted&&item.opacity>0&&!item.data.dimension&&['cutline','engrave'].includes(item.data.role));
 for(const item of items){
  if(item.data.role==='cutline'){
   for(const c of flattenInDocument(item)){
    vertices+=c.points.length;if(vertices>60000||cuts.length>2000)throw new Error('This design is too complex for 3D preview. Try hiding some layers.');
    if(c.closed&&c.points.length>=3)cuts.push(c);else openCuts++;
   }
  }else{
   const copies=pathsOf(item).map(documentPath);
   try{marks.push({path:copies.map(p=>p.pathData).join(' '),fill:hasFilledArea(item),fillRule:item.fillRule==='evenodd'?'evenodd':'nonzero'});for(const p of copies)extent=extent?extent.unite(p.bounds):p.bounds.clone();}finally{copies.forEach(p=>p.remove());}
  }
 }
 if(!cuts.length&&!marks.length)return null;
 await initializeClipper();let contours=cuts.length?previewCutContours(cuts):[];const stock=!cuts.length;
 if(stock&&extent){const margin=Math.max(5,Math.max(extent.width,extent.height)*0.08),b=extent.expand(margin*2);contours=[{closed:true,points:[{x:b.left,y:b.top},{x:b.right,y:b.top},{x:b.right,y:b.bottom},{x:b.left,y:b.bottom}]}];}
 if(!contours.length)throw new Error('No material remains inside the closed cut paths. Check for duplicate outlines.');
 let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;for(const c of contours)for(const p of c.points){x=Math.min(x,p.x);y=Math.min(y,p.y);right=Math.max(right,p.x);bottom=Math.max(bottom,p.y);}const width=right-x,height=bottom-y;
 if(width<0.001||height<0.001)throw new Error('The cut paths are too small to preview.');
 const areas=contours.map(c=>Math.abs(signedArea(c.points)));
 const parents=contours.map((c,i)=>{let parent=-1;for(let j=0;j<contours.length;j++)if(areas[j]>areas[i]&&contains(contours[j].points,c.points[0])&&(parent<0||areas[j]<areas[parent]))parent=j;return parent;});
 const depths=parents.map((_,i)=>{let d=0;for(let p=parents[i];p>=0;p=parents[p])d++;return d;});
 return {contours,parents,depths,marks,bounds:{x,y,width,height},openCuts,stock,parts:depths.filter(d=>d%2===0).length,holes:depths.filter(d=>d%2===1).length};
}
