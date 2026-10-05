import {simplifyOpen,simplifyClosedContour} from '../vectorizer/autoTracer';
import {MAX_VERTICES,type PaintResult,type Point,type ProcessingSettings} from './types';

interface Edge {a:number;b:number;owners:number[];chain:number;forward:boolean}
interface Chain {raw:Point[];smooth:Point[];closed:boolean}
const cross=(a:Point,b:Point,c:Point)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const area=(points:Point[])=>points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p[0]*q[1]-q[0]*p[1];},0)/2;
const edgeKey=(a:number,b:number)=>a<b?`${a}:${b}`:`${b}:${a}`;
const straight=(points:Point[],closed:boolean)=>points.filter((b,i)=>{if(!closed&&(i===0||i===points.length-1))return true;return Math.abs(cross(points[(i+points.length-1)%points.length],b,points[(i+1)%points.length]))>1e-9;});
function soften(raw:Point[],closed:boolean,heavy:boolean):Point[]{
 const input=raw.map(([x,y])=>({x,y})),simple=closed?simplifyClosedContour(input,heavy?1.7:.65):simplifyOpen(input,heavy?1.7:.65);
 let points=simple.map(({x,y}):Point=>[x,y]);
 // Inspect simplified neighbourhoods, not individual pixel runs: diagonal
 // tips have one-pixel stairs even when the intended corner is very sharp.
 const pinned=new Set<string>();
 for(let i=0;i<points.length;i++){if(!closed&&(i===0||i===points.length-1)){pinned.add(points[i].join(','));continue;}const a=points[(i+points.length-1)%points.length],b=points[i],c=points[(i+1)%points.length],u:Point=[b[0]-a[0],b[1]-a[1]],v:Point=[c[0]-b[0],c[1]-b[1]],length=Math.hypot(...u)*Math.hypot(...v);if(length&&((u[0]*v[0]+u[1]*v[1])/length)<Math.cos(65*Math.PI/180))pinned.add(b.join(','));}
 for(let pass=0;pass<(heavy?3:2);pass++){
  const next:Point[]=[];
  for(let i=0;i<points.length;i++){const b=points[i];if(pinned.has(b.join(','))){next.push(b);continue;}const a=points[(i+points.length-1)%points.length],c=points[(i+1)%points.length];next.push([a[0]*.25+b[0]*.75,a[1]*.25+b[1]*.75],[b[0]*.75+c[0]*.25,b[1]*.75+c[1]*.25]);}points=straight(next,closed);
 }
 // Sub-pixel compaction prevents rounded curves multiplying document size.
 const sampled=points.map(([x,y])=>({x,y})),compact=closed?simplifyClosedContour(sampled,.12):simplifyOpen(sampled,.12);
 return compact.map(({x,y}):Point=>[x,y]);
}
function contains(point:Point,loops:Point[][]):boolean {
 let inside=false;for(const loop of loops)for(let i=0,j=loop.length-1;i<loop.length;j=i++){const a=loop[i],b=loop[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;
}
const between=(a:number,b:number,c:number)=>c>=Math.min(a,b)-1e-8&&c<=Math.max(a,b)+1e-8;
function intersects(a:Point,b:Point,c:Point,d:Point):boolean {
 const A=cross(a,b,c),B=cross(a,b,d),C=cross(c,d,a),D=cross(c,d,b),on=(v:number,p:Point,q:Point,r:Point)=>Math.abs(v)<1e-8&&between(p[0],q[0],r[0])&&between(p[1],q[1],r[1]);
 return A*B<0&&C*D<0||on(A,a,b,c)||on(B,a,b,d)||on(C,c,d,a)||on(D,c,d,b);
}
function labelFits(loops:Point[][],label:Point,rx:number,ry:number):boolean {
 const [x,y]=label,rect:Point[]=[[x-rx,y-ry],[x+rx,y-ry],[x+rx,y+ry],[x-rx,y+ry]];
 if(!rect.every(p=>contains(p,loops)))return false;
 for(const loop of loops)for(let i=0;i<loop.length;i++){const a=loop[i],b=loop[(i+1)%loop.length];if(a[0]>x-rx&&a[0]<x+rx&&a[1]>y-ry&&a[1]<y+ry)return false;for(let j=0;j<4;j++)if(intersects(a,b,rect[j],rect[(j+1)%4]))return false;}return true;
}
/** Relocate a number after smoothing rather than reverting its whole region.
 * Intersect horizontal interior spans across the complete glyph-height slab.
 * Between contour vertices, segment intersections vary linearly, so slab ends
 * and vertex heights describe the extrema of every admissible rectangle. */
function relocateLabel(loops:Point[][],label:Point,rx:number,ry:number,budget:{remaining:number}):Point|undefined {
 const points=loops.flat(),ys=[...new Set(points.map(p=>p[1]))].sort((a,b)=>a-b),min=ys[0]+ry,max=ys[ys.length-1]-ry;
 if(min>=max)return;
 const spans=(y:number):[number,number][]|undefined=>{const hits:number[]=[];for(const loop of loops)for(let i=0;i<loop.length;i++){if(--budget.remaining<0)return;const a=loop[i],b=loop[(i+1)%loop.length];if((a[1]>y)!==(b[1]>y))hits.push(a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]));}hits.sort((a,b)=>a-b);const out:[number,number][]=[];for(let i=0;i+1<hits.length;i+=2)out.push([hits[i],hits[i+1]]);return out;};
 const intersect=(a:[number,number][],b:[number,number][])=>{const out:[number,number][]=[];let i=0,j=0;while(i<a.length&&j<b.length){const left=Math.max(a[i][0],b[j][0]),right=Math.min(a[i][1],b[j][1]);if(right-left>2*rx)out.push([left,right]);if(a[i][1]<b[j][1])i++;else j++;}return out;};
 // Start near the existing label. Bound row sampling independently of image
 // resolution, keeping detailed uploads responsive and deterministic.
 const step=Math.max(.5,ry/2,(max-min)/256),rows=[Math.max(min,Math.min(max,label[1]))];for(let y=min+1e-5;y<max;y+=step)rows.push(y);
 rows.sort((a,b)=>Math.abs(a-label[1])-Math.abs(b-label[1])||a-b);
 let best:Point|undefined,bestDistance=Infinity;
 for(const y of rows){if((y-label[1])**2>=bestDistance)continue;let allowed=spans(y-ry);if(!allowed)return best;const levels=[y+ry,...ys.filter(v=>v>y-ry&&v<y+ry).flatMap(v=>[v-1e-7,v+1e-7])];for(const level of levels){const row=spans(level);if(!row)return best;allowed=intersect(allowed,row);if(!allowed.length)break;}
  for(const [left,right] of allowed){const x=Math.max(left+rx+1e-6,Math.min(right-rx-1e-6,label[0])),candidate:Point=[x,y],distance=(x-label[0])**2+(y-label[1])**2;if(distance<bestDistance&&labelFits(loops,candidate,rx,ry)){best=candidate;bestDistance=distance;}}
 }
 return best;
}

/** Smooth each shared chain once, then reuse its exact reverse for its neighbour. */
export function smoothRegions(result:PaintResult,s:ProcessingSettings):PaintResult {
 if(s.smoothing==='off')return result;
 const stride=result.width+1,code=([x,y]:Point)=>y*stride+x,xy=(c:number):Point=>[c%stride,Math.floor(c/stride)],edges:Edge[]=[],lookup=new Map<string,number>(),nodes=new Map<number,number[]>();
 for(const region of result.regions)for(const loop of region.contours)for(let i=0;i<loop.length;i++){
  const a=code(loop[i]),b=code(loop[(i+1)%loop.length]),key=edgeKey(a,b),existing=lookup.get(key);
  if(existing!==undefined){edges[existing].owners.push(region.id);continue;}
  const index=edges.length;lookup.set(key,index);edges.push({a,b,owners:[region.id],chain:-1,forward:true});for(const v of [a,b]){const list=nodes.get(v)??[];list.push(index);nodes.set(v,list);}
 }
 const anchors=new Set<number>();
 for(const [v,list] of nodes){const p=xy(v);if(list.length!==2||p[0]===0||p[0]===result.width||p[1]===0||p[1]===result.height){anchors.add(v);continue;}
  const a=edges[list[0]],b=edges[list[1]];if(a.owners.join(',')!==b.owners.join(',')){anchors.add(v);continue;}
  const q=xy(a.a===v?a.b:a.a),r=xy(b.a===v?b.b:b.a),u:Point=[p[0]-q[0],p[1]-q[1]],t:Point=[r[0]-p[0],r[1]-p[1]],l=Math.hypot(...u),m=Math.hypot(...t);
  if(l>=3&&m>=3&&(u[0]*t[0]+u[1]*t[1])/(l*m)<.5)anchors.add(v);
 }
 const chains:Chain[]=[];
 const walk=(initial:number,start:number)=>{const id=chains.length,raw:Point[]=[xy(start)];let index=initial,v=start,closed=false;
  while(true){const edge=edges[index];edge.chain=id;edge.forward=edge.a===v;v=edge.forward?edge.b:edge.a;if(v===start){closed=true;break;}raw.push(xy(v));if(anchors.has(v))break;const next=nodes.get(v)!.find(i=>edges[i].chain<0);if(next===undefined)break;index=next;}
  chains.push({raw,smooth:soften(raw,closed,s.smoothing!=='light'),closed});
 };
 // Start anchored chains first so a contour's arbitrary first point cannot split them.
 for(let i=0;i<edges.length;i++){const e=edges[i];if(e.chain<0&&(anchors.has(e.a)||anchors.has(e.b)))walk(i,anchors.has(e.a)?e.a:e.b);}
 for(let i=0;i<edges.length;i++)if(edges[i].chain<0)walk(i,edges[i].a);
 const owners=new Uint8Array(chains.length);for(const edge of edges)owners[edge.chain]=Math.max(owners[edge.chain],edge.owners.length);
 const fixed=new Set<number>();
 const labelBudget={remaining:2000000};
 const build=()=>result.regions.map(region=>({...region,contours:region.contours.map(loop=>{
  const refs=loop.map((p,i)=>{const e=edges[lookup.get(edgeKey(code(p),code(loop[(i+1)%loop.length])))!];return {id:e.chain,forward:(e.a===code(p))===e.forward};});
  const first=refs.findIndex((ref,i)=>ref.id!==refs[(i+refs.length-1)%refs.length].id);
  if(first<0){const ref=refs[0],c=chains[ref.id],points=fixed.has(ref.id)?c.raw:c.smooth;return ref.forward?points:[...points].reverse();}
  const out:Point[]=[];let previous=-1;
  for(let i=0;i<refs.length;i++){const ref=refs[(first+i)%refs.length];if(ref.id===previous)continue;previous=ref.id;const c=chains[ref.id],points=fixed.has(ref.id)?c.raw:c.smooth,oriented=ref.forward?points:[...points].reverse();out.push(...oriented.slice(0,-1));}return out;
 })}));
 for(let pass=0;pass<4;pass++){
  const regions=build(),bad=new Set<number>();let vertices=0;
  for(let i=0;i<regions.length;i++){
   const r=regions[i],original=result.regions[i];
   vertices+=r.contours.reduce((n,c)=>n+c.length,0);
   const invalid=r.contours.some((c,j)=>c.length<3||area(c)*area(original.contours[j])<=0||Math.abs(area(c))<Math.abs(area(original.contours[j]))*.25);
   let validLabel=true;
   if(s.fitLabels!==false){const m=s.metrics[r.paletteIndex],rx=(m.width*s.labelSizeMM/2+(s.clearanceMM??.2))/(s.imageWidthMM/result.width),ry=(m.height*s.labelSizeMM/2+(s.clearanceMM??.2))/(s.imageHeightMM/result.height);validLabel=labelFits(r.contours,r.label,rx,ry);if(!invalid&&!validLabel){const label=relocateLabel(r.contours,r.label,rx,ry,labelBudget);if(label){r.label=label;validLabel=true;}}}
   if(invalid||!validLabel)for(const loop of original.contours)for(let j=0;j<loop.length;j++)bad.add(edges[lookup.get(edgeKey(code(loop[j]),code(loop[(j+1)%loop.length])))!].chain);
  }
  if(vertices>MAX_VERTICES){
   const growth=chains.map((c,id)=>({id,extra:(c.smooth.length-c.raw.length)*owners[id]})).filter(c=>!fixed.has(c.id)&&c.extra>0).sort((a,b)=>b.extra-a.extra||a.id-b.id);
   for(const c of growth){fixed.add(c.id);vertices-=c.extra;if(vertices<=MAX_VERTICES)break;}continue;
  }
  // Spatially indexed segments catch self-crossings and collisions with holes
  // or other regions. Shared endpoints are intentional junctions.
  interface Segment {a:Point;b:Point;chain:number}
  const segments:Segment[]=[],buckets=new Map<string,number[]>();let comparisons=0;
  for(let id=0;id<chains.length;id++){const c=chains[id],points=fixed.has(id)?c.raw:c.smooth;for(let i=0;i<points.length-(c.closed?0:1);i++){
   const a=points[i],b=points[(i+1)%points.length],keys=new Set<string>(),steps=Math.max(1,Math.ceil(Math.max(Math.abs(b[0]-a[0]),Math.abs(b[1]-a[1]))/8));
   const x0=Math.floor(Math.min(a[0],b[0])/8),x1=Math.floor(Math.max(a[0],b[0])/8),y0=Math.floor(Math.min(a[1],b[1])/8),y1=Math.floor(Math.max(a[1],b[1])/8);
   if((x1-x0+1)*(y1-y0+1)<=32){for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)keys.add(`${x},${y}`);}
   else for(let step=0;step<=steps;step++){const x=Math.floor((a[0]+(b[0]-a[0])*step/steps)/8),y=Math.floor((a[1]+(b[1]-a[1])*step/steps)/8);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)keys.add(`${x+dx},${y+dy}`);}
   const seen=new Set<number>();for(const key of keys)for(const index of buckets.get(key)??[]){if(seen.has(index))continue;seen.add(index);if(++comparisons>2000000)throw new Error('This image is too detailed to smooth safely. Choose Light smoothing or lower detail.');const other=segments[index];if([a,b].some(p=>[other.a,other.b].some(q=>p[0]===q[0]&&p[1]===q[1]))){const axis=Math.abs(b[0]-a[0])>=Math.abs(b[1]-a[1])?0:1,overlap=Math.min(Math.max(a[axis],b[axis]),Math.max(other.a[axis],other.b[axis]))-Math.max(Math.min(a[axis],b[axis]),Math.min(other.a[axis],other.b[axis]));if(Math.abs(cross(a,b,other.a))>1e-8||Math.abs(cross(a,b,other.b))>1e-8||overlap<=1e-8)continue;}if(intersects(a,b,other.a,other.b)){bad.add(id);bad.add(other.chain);}}
   const index=segments.length;segments.push({a,b,chain:id});for(const key of keys){const list=buckets.get(key)??[];list.push(index);buckets.set(key,list);}
  }}
  if(!bad.size)return {...result,regions,vertexCount:vertices};
  let changed=false;for(const id of bad)if(!fixed.has(id)){fixed.add(id);changed=true;}if(!changed)return result;
 }
 return result;
}
