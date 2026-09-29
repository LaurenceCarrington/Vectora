import {exportImageSource} from './exportImage';
const NS='http://www.w3.org/2000/svg';
/** Lay out a frozen SVG in physical millimetres, without touching editor geometry. */
export function layoutSVG(contents:string,options:{scale?:number;margin?:number;page?:[number,number];groups?:boolean}={}):string {
 const {svg,width,height}=exportImageSource(contents),view=svg.getAttribute('viewBox')!.split(/\s+/).map(Number);
 const scale=options.scale??1,margin=options.margin??0;
 if(!Number.isFinite(scale)||scale<=0||!Number.isFinite(margin)||margin<0)throw new Error('Enter a positive scale and a non-negative margin.');
 const w=options.page?.[0]??width*scale+margin*2,h=options.page?.[1]??height*scale+margin*2;
 if(w<=margin*2||h<=margin*2||width*scale>w-margin*2+1e-7||height*scale>h-margin*2+1e-7)throw new Error('The drawing does not fit this page. Reduce the scale or margins, or choose Fit drawing.');
 if(options.groups===false)svg.querySelectorAll('g[data-layer-name]').forEach(group=>{group.querySelector('title')?.remove();group.replaceWith(...group.childNodes);});
 const group=document.createElementNS(NS,'g');group.setAttribute('transform',`translate(${(w-width*scale)/2} ${(h-height*scale)/2}) scale(${scale}) translate(${-view[0]} ${-view[1]})`);
 group.append(...svg.childNodes);svg.append(group);svg.setAttribute('viewBox',`0 0 ${w} ${h}`);svg.setAttribute('width',`${w}mm`);svg.setAttribute('height',`${h}mm`);
 return new XMLSerializer().serializeToString(svg);
}
/** Supported writer records only; preserve all non-position tags and the original line endings. */
export function dxfAtOrigin(contents:string):string {
 const sep=contents.includes('\r\n')?'\r\n':'\n',lines=contents.trimEnd().split(/\r?\n/);
 let section='',header='',minX=Infinity,minY=Infinity;const xs:number[]=[],ys:number[]=[],extentX:number[]=[],extentY:number[]=[];
 for(let i=0;i<lines.length;i+=2){const code=Number(lines[i]),value=lines[i+1];
  if(code===2&&lines[i-2]==='0'&&lines[i-1]==='SECTION')section=value;
  if(code===0&&value==='ENDSEC')section='';
  if(code===9)header=value;
  if(section==='ENTITIES'){if(code===10||code===11){xs.push(i+1);minX=Math.min(minX,Number(value));}if(code===20||code===21){ys.push(i+1);minY=Math.min(minY,Number(value));}}
  if(section==='HEADER'&&(header==='$EXTMIN'||header==='$EXTMAX')){if(code===10)extentX.push(i+1);if(code===20)extentY.push(i+1);}
 }
 if(extentX.length)minX=Number(lines[extentX[0]]);if(extentY.length)minY=Number(lines[extentY[0]]);
 for(const i of [...xs,...extentX])lines[i]=String(Number((Number(lines[i])-minX).toFixed(8)));
 for(const i of [...ys,...extentY])lines[i]=String(Number((Number(lines[i])-minY).toFixed(8)));
 return lines.join(sep)+sep;
}
/** Render the actual emitted DXF subset for a faithful geometry-only preview. */
export function previewDXF(contents:string):string {
 const lines=contents.trimEnd().split(/\r?\n/),svg=document.createElementNS(NS,'svg');let section='',record:{kind:string;tags:[number,string][]}|null=null;
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 const point=(x:number,y:number)=>{minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);return `${x},${y}`;};
 const flush=()=>{if(!record)return;const {kind,tags}=record;const get=(n:number)=>tags.find(([code])=>code===n)?.[1]??'0';const color=get(8).startsWith('CUT')?'#ff0000':get(8).startsWith('ENGRAVE')?'#0000ff':'#000000';
  if(kind==='LINE'||kind==='LWPOLYLINE'){
   const ys=tags.filter(([c])=>c===20);
   const points=kind==='LINE'?[point(Number(get(10)),-Number(get(20))),point(Number(get(11)),-Number(get(21)))]:tags.filter(([c])=>c===10).map(([,x],i)=>point(Number(x),-Number(ys[i][1])));
   const el=document.createElementNS(NS,kind==='LWPOLYLINE'&&(Number(get(70))&1)!==0?'polygon':'polyline');el.setAttribute('points',points.join(' '));el.setAttribute('fill','none');el.setAttribute('stroke',color);el.setAttribute('stroke-width','.26458333');svg.append(el);
  }else if(kind==='TEXT'){const x=Number(get(72))===1?Number(get(11)):Number(get(10)),y=-(Number(get(72))===1?Number(get(21)):Number(get(20))),el=document.createElementNS(NS,'text');point(x,y);el.setAttribute('x',String(x));el.setAttribute('y',String(y));el.setAttribute('font-size',get(40));el.setAttribute('fill',color);el.setAttribute('text-anchor',Number(get(72))===1?'middle':'start');el.setAttribute('transform',`rotate(${-Number(get(50))} ${x} ${y})`);el.textContent=get(1).replace(/%%c/g,'Ø').replace(/\\U\+([a-f0-9]{4})/gi,(_,h)=>String.fromCharCode(parseInt(h,16)));el.setAttribute('font-family','Arial, sans-serif');
   const ctx=document.createElement('canvas').getContext('2d')!;const fontSize=Number(get(40));ctx.font=`${fontSize}px Arial`;const metrics=ctx.measureText(el.textContent??''),offset=Number(get(72))===1?metrics.width/2:0,angle=-Number(get(50))*Math.PI/180;
   for(const [dx,dy] of [[-offset,-(metrics.actualBoundingBoxAscent||fontSize)],[metrics.width-offset,-(metrics.actualBoundingBoxAscent||fontSize)],[metrics.width-offset,metrics.actualBoundingBoxDescent||0],[-offset,metrics.actualBoundingBoxDescent||0]])point(x+dx*Math.cos(angle)-dy*Math.sin(angle),y+dx*Math.sin(angle)+dy*Math.cos(angle));
   svg.append(el);}
 };
 for(let i=0;i<lines.length;i+=2){const code=Number(lines[i]),value=lines[i+1];if(code===2&&lines[i-2]==='0'&&lines[i-1]==='SECTION')section=value;if(code===0){flush();record=section==='ENTITIES'&&value!=='ENDSEC'?{kind:value,tags:[]}:null;if(value==='ENDSEC')section='';}else record?.tags.push([code,value]);}
 svg.setAttribute('data-export-width',String(maxX-minX));svg.setAttribute('data-export-height',String(maxY-minY));
 const pad=.26458333/2,w=Math.max(.01,maxX-minX)+2*pad,h=Math.max(.01,maxY-minY)+2*pad;svg.setAttribute('viewBox',`${minX-pad} ${minY-pad} ${w} ${h}`);svg.setAttribute('width',`${w}mm`);svg.setAttribute('height',`${h}mm`);return new XMLSerializer().serializeToString(svg);
}
