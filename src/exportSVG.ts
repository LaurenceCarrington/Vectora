import {paintDefinition,paintColour,type FillPaint} from './fillPaint';
import paper from 'paper';
import {documentPath} from './deletion';
import {pathsOf} from './geometry';
import {dimensionLabel} from './dimensions';
import {applyArtworkTheme} from './shapeStyles';
import {BASE_ZOOM,MIN_DIMENSION_MM} from './units';
import type {Shape} from './types';

const NS='http://www.w3.org/2000/svg';
const format=(value:number)=>String(Number(value.toFixed(8)));

/** Visible geometry in mm. Export ink defaults to black; Preview can retain the current theme ink. */
export function exportSVG(objects:readonly Shape[],includeHidden=false,artworkInk='#000000'):string {
  const svg=document.createElementNS(NS,'svg');
  svg.setAttribute('version','1.1');
  let paintIndex=0;
  const groups=new Map<paper.Layer,SVGGElement>();
  let bounds:paper.Rectangle|null=null;
  const items=objects.filter(item=>['artwork','cutline','engrave','raster'].includes(item.data.role)&&(includeHidden||(item.visible&&item.layer.visible))&&!item.layer.data.deleted&&item.opacity>0)
    .sort((a,b)=>a.layer.index-b.layer.index||a.index-b.index);
  for(const item of items){
    const contours=pathsOf(item).filter(path=>path.segments.length>1).map(documentPath);
    if(!contours.length)continue;
    const copy:Shape=contours.length===1?contours[0]:new paper.CompoundPath({insert:false,children:contours});
    const label=dimensionLabel(item);
    try{
      copy.style=item.style;copy.opacity=item.opacity;
      const paint=item.data.role==='artwork'?item.data.fillPaint as FillPaint|undefined:undefined;
      let paintId:string|undefined;
      if(paint&&paint.kind!=='colour'&&item.fillColor?.type==='gradient'){paintId=`fill-paint-${++paintIndex}`;const defs=document.createElementNS(NS,'defs');defs.append(paintDefinition(paint,item.fillColor,paintId));svg.append(defs);copy.fillColor=new paper.Color(paintColour(paint));}
      if(item.data.role==='artwork'){
        // Canvas white/charcoal is a theme affordance, not the exported ink colour.
        // Keep explicit filled regions, including white fills, unchanged.
        copy.data.regionFill=item.data.regionFill;copy.data.customColour=item.data.customColour;
        if(label){label.data.customColour=item.data.customColour;label.opacity=item.opacity;}
        applyArtworkTheme(copy,artworkInk);
        if(label)applyArtworkTheme(label,artworkInk);
      }
      // Freeze screen-sized editor strokes at their 100% physical width.
      copy.strokeScaling=true;copy.strokeWidth=item.strokeScaling?item.strokeWidth:item.strokeWidth/BASE_ZOOM;
      if(!copy.fillColor&&!copy.strokeColor&&!label)continue;
      let group=groups.get(item.layer);
      if(!group){
        group=document.createElementNS(NS,'g');group.setAttribute('id',`layer-${groups.size+1}`);
        group.setAttribute('data-layer-name',item.layer.name);group.setAttribute('data-layer-role',item.data.role);
        const title=document.createElementNS(NS,'title');title.textContent=item.layer.name;group.append(title);
        groups.set(item.layer,group);svg.append(group);
      }
      for(const shape of [copy,...(label?[label]:[])]){
        const node=shape.exportSVG({asString:false,precision:8,matchShapes:false}) as SVGElement;
        if(shape===copy&&paintId)node.setAttribute('fill',`url(#${paintId})`);
        node.removeAttribute('data-paper-data');group.append(node);
        const extent=shape.strokeBounds;
        bounds=bounds?bounds.unite(extent):extent.clone();
      }
    }finally{copy.remove();label?.remove();}
  }
  if(!bounds)throw new Error('There are no visible objects to export. Draw a shape or show an artwork, cut or engraving layer.');
  const width=Math.max(bounds.width,MIN_DIMENSION_MM),height=Math.max(bounds.height,MIN_DIMENSION_MM);
  svg.setAttribute('width',`${format(width)}mm`);svg.setAttribute('height',`${format(height)}mm`);
  svg.setAttribute('viewBox',[bounds.x,bounds.y,width,height].map(format).join(' '));
  return '<?xml version="1.0" encoding="UTF-8"?>\n'+new XMLSerializer().serializeToString(svg);
}

export function downloadSVG(contents:string):void {
  const url=URL.createObjectURL(new Blob([contents],{type:'image/svg+xml;charset=utf-8'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download='vectora.svg';anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
