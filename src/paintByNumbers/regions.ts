import {MAX_REGIONS,MAX_VERTICES,type PaintRegion,type PaintResult,type Point,type ProcessingSettings,type QuantizedImage} from './types';
interface Component {parent:number;colour:number;size:number;minX:number;minY:number;maxX:number;maxY:number;neighbours:Map<number,number>}
const failDetail=()=>new Error('Image is too detailed. Choose Low detail, fewer colours or more cleanup.');
const failLabel=()=>new Error('Some regions cannot fit a number. Increase cleanup or page size, lower detail, or reduce label size.');
export function buildRegions(image:QuantizedImage,s:ProcessingSettings):PaintResult {
 const {width:w,height:h,labels,palette}=image,n=w*h,ids=new Int32Array(n).fill(-1),queue=new Int32Array(n),components:Component[]=[];
 const around=(i:number,visit:(j:number)=>void)=>{const x=i%w;if(x)visit(i-1);if(x<w-1)visit(i+1);if(i>=w)visit(i-w);if(i<n-w)visit(i+w);};
 for(let i=0;i<n;i++)if(labels[i]>=0&&ids[i]<0){
  if(components.length>=20000)throw failDetail();const id=components.length,c:Component={parent:id,colour:labels[i],size:0,minX:w,minY:h,maxX:0,maxY:0,neighbours:new Map()};components.push(c);
  let head=0,tail=1;queue[0]=i;ids[i]=id;
  while(head<tail){const p=queue[head++],x=p%w,y=Math.floor(p/w);c.size++;c.minX=Math.min(c.minX,x);c.maxX=Math.max(c.maxX,x);c.minY=Math.min(c.minY,y);c.maxY=Math.max(c.maxY,y);around(p,j=>{if(ids[j]<0&&labels[j]===c.colour){ids[j]=id;queue[tail++]=j;}});}
 }
 const root=(id:number):number=>{let r=id;while(components[r].parent!==r)r=components[r].parent;while(id!==r){const next=components[id].parent;components[id].parent=r;id=next;}return r;};
 const boundary=(a:number,b:number)=>{if(a>=0&&b>=0&&a!==b){components[a].neighbours.set(b,(components[a].neighbours.get(b)??0)+1);components[b].neighbours.set(a,(components[b].neighbours.get(a)??0)+1);}};
 for(let i=0;i<n;i++){if(i%w<w-1)boundary(ids[i],ids[i+1]);if(i<n-w)boundary(ids[i],ids[i+w]);}
 let mergedCount=0;
 const merge=(a:number,b:number):number=>{
  a=root(a);b=root(b);if(a===b)return b;const A=components[a],B=components[b];A.parent=b;B.size+=A.size;B.minX=Math.min(B.minX,A.minX);B.minY=Math.min(B.minY,A.minY);B.maxX=Math.max(B.maxX,A.maxX);B.maxY=Math.max(B.maxY,A.maxY);B.neighbours.delete(a);
  for(const [id,length] of A.neighbours){const r=root(id);if(r===b)continue;const C=components[r];C.neighbours.delete(a);C.neighbours.set(b,(C.neighbours.get(b)??0)+length);B.neighbours.set(r,(B.neighbours.get(r)??0)+length);}A.neighbours.clear();mergedCount++;return b;
 };
 const rgb=palette.map(c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16))),colourDistance=(a:number,b:number)=>rgb[a].reduce((sum,x,i)=>sum+(x-rgb[b][i])**2,0);
 const neighbour=(id:number):number|undefined=>{
  const c=components[id];let best:number|undefined,score=Infinity,border=-1;
  for(const [key,length] of c.neighbours){const r=root(key);if(r===id)continue;const d=colourDistance(c.colour,components[r].colour);if(d<score||d===score&&(length>border||length===border&&(best===undefined||r<best))){best=r;score=d;border=length;}}return best;
 };
 const absorb=(a:number,b:number)=>{
  let target=merge(a,b);const pending=[target];
  while(pending.length){target=root(pending.pop()!);const matches=[...components[target].neighbours.keys()].map(root).filter(r=>r!==target&&components[r].colour===components[target].colour);for(const r of matches)merge(r,target);if(matches.length)pending.push(target);}
 };
 const areaPixels=s.cleanupMM2/(s.imageWidthMM/w*s.imageHeightMM/h);
 for(const id of components.map((_,i)=>i).sort((a,b)=>components[a].size-components[b].size||a-b))if(root(id)===id&&components[id].size<areaPixels){const b=neighbour(id);if(b!==undefined)absorb(id,b);}
 const grid=new Int32Array(n),dist=new Uint16Array(n),run=new Uint16Array(n),positions=new Map<number,Point>();let used:number[]=[],remap=new Map<number,number>();
 for(let pass=0;pass<16;pass++){
  for(let i=0;i<n;i++)grid[i]=ids[i]<0?-1:root(ids[i]);
  const roots=components.flatMap((c,i)=>c.parent===i?[i]:[]);if(roots.length>MAX_REGIONS)throw failDetail();
  used=[...new Set(roots.map(r=>components[r].colour))].sort((a,b)=>a-b);remap=new Map(used.map((c,i)=>[c,i]));
  // Colour tracing has no printed numbers: retain narrow regions without
  // merging them merely because a glyph rectangle cannot fit inside.
  if(s.fitLabels===false){for(const id of roots){const c=components[id];positions.set(id,[(c.minX+c.maxX+1)/2,(c.minY+c.maxY+1)/2]);}break;}
  // Chebyshev distance ranks interior candidates; exact rectangles below verify glyph fit.
  for(let i=0;i<n;i++){
   const id=grid[i],x=i%w,y=Math.floor(i/w);if(id<0){dist[i]=0;run[i]=0;continue;}
   run[i]=x&&grid[i-1]===id?run[i-1]+1:1;let d=1201;
   for(const [dx,dy] of [[-1,0],[-1,-1],[0,-1],[1,-1]]){const X=x+dx,Y=y+dy;d=Math.min(d,X<0||X>=w||Y<0||grid[Y*w+X]!==id?1:dist[Y*w+X]+1);}dist[i]=d;
  }
  for(let i=n-1;i>=0;i--)if(grid[i]>=0){const x=i%w,y=Math.floor(i/w),id=grid[i];for(const [dx,dy] of [[1,0],[1,1],[0,1],[-1,1]]){const X=x+dx,Y=y+dy;dist[i]=Math.min(dist[i],X<0||X>=w||Y>=h||grid[Y*w+X]!==id?1:dist[Y*w+X]+1);}}
  const candidates=new Map<number,{index:number;score:number}[]>();
  for(let i=0;i<n;i++)if(grid[i]>=0){const id=grid[i],c=components[id],x=i%w,y=Math.floor(i/w),score=dist[i]-Math.hypot(x-(c.minX+c.maxX)/2,y-(c.minY+c.maxY)/2)/(w+h)*.01,list=candidates.get(id)??[];
   if(list.length<24||score>list.at(-1)!.score){const entry={index:i,score};let at=list.findIndex(v=>v.score<score);if(at<0)at=list.length;list.splice(at,0,entry);if(list.length>24)list.pop();candidates.set(id,list);}
  }
  positions.clear();const unfit:number[]=[];
  for(const id of roots){const metric=s.metrics[remap.get(components[id].colour)!],rx=(metric.width*s.labelSizeMM/2+(s.clearanceMM??.2))/(s.imageWidthMM/w),ry=(metric.height*s.labelSizeMM/2+(s.clearanceMM??.2))/(s.imageHeightMM/h);let point:Point|undefined;
   for(const candidate of candidates.get(id)??[]){const x=candidate.index%w+.5,y=Math.floor(candidate.index/w)+.5,x0=Math.floor(x-rx),x1=Math.ceil(x+rx)-1,y0=Math.floor(y-ry),y1=Math.ceil(y+ry)-1;if(x0<0||x1>=w||y0<0||y1>=h)continue;
    let fits=true;for(let Y=y0;Y<=y1;Y++)if(grid[Y*w+x1]!==id||run[Y*w+x1]<x1-x0+1){fits=false;break;}if(fits){point=[x,y];break;}
   }
   if(point)positions.set(id,point);else unfit.push(id);
  }
  // A tall glyph can fit a narrow limb outside the isotropic shortlist. Scan
  // every possible rectangle in O(pixels), before merging any valid detail.
  const envelopes=new Map<number,{right:number;bottom:number;width:number;height:number}>();
  for(const id of unfit){const m=s.metrics[remap.get(components[id].colour)!],rx=(m.width*s.labelSizeMM/2+(s.clearanceMM??.2))/(s.imageWidthMM/w),ry=(m.height*s.labelSizeMM/2+(s.clearanceMM??.2))/(s.imageHeightMM/h),left=Math.floor(.5-rx),right=Math.ceil(.5+rx)-1,top=Math.floor(.5-ry),bottom=Math.ceil(.5+ry)-1;envelopes.set(id,{right,bottom,width:right-left+1,height:bottom-top+1});}
  const best=new Map<number,number>(),deque=new Int32Array(h);
  for(let X=0;X<w&&envelopes.size;X++){
   let previous=-1,start=0,head=0,tail=0;
   for(let Y=0;Y<h;Y++){
    const id=grid[Y*w+X],box=envelopes.get(id);
    if(id!==previous){head=tail=0;start=Y;previous=id;}
    if(!box||box.width>w||box.height>h)continue;
    const top=Y-box.height+1;
    while(head<tail&&deque[head]<top)head++;
    while(head<tail&&run[deque[tail-1]*w+X]>=run[Y*w+X])tail--;
    deque[tail++]=Y;
    if(top<start||run[deque[head]*w+X]<box.width)continue;
    const x=X-box.right,y=Y-box.bottom,c=components[id],score=dist[y*w+x]-Math.hypot(x-(c.minX+c.maxX)/2,y-(c.minY+c.maxY)/2)/(w+h)*.01;
    if(score>(best.get(id)??-Infinity)){best.set(id,score);positions.set(id,[x+.5,y+.5]);}
   }
  }
  const remaining=unfit.filter(id=>!positions.has(id));
  if(!remaining.length)break;if(pass===15)throw failLabel();let changed=false;
  for(const key of remaining){const id=root(key);if(id!==key)continue;const b=neighbour(id);if(b===undefined)throw failLabel();absorb(id,b);changed=true;}if(!changed)throw failLabel();
 }
 const contours=traceBoundaries(grid,w,h);let vertexCount=0;const regions:PaintRegion[]=[];
 for(const [id,loops] of contours){vertexCount+=loops.reduce((n,c)=>n+c.length,0);if(vertexCount>MAX_VERTICES)throw failDetail();regions.push({id,paletteIndex:remap.get(components[id].colour)!,contours:loops,label:positions.get(id)!,pixels:components[id].size});}
 return {width:w,height:h,palette:used.map(i=>palette[i]),regions,vertexCount,mergedCount};
}

/** Pixel boundaries share exact vertices. Junctions survive collinear simplification. */
function traceBoundaries(grid:Int32Array,w:number,h:number):Map<number,Point[][]> {
 interface Edge {a:number;b:number;direction:number;used:boolean}
 const byRegion=new Map<number,Edge[]>(),stride=w+1;let count=0;
 const edge=(id:number,x:number,y:number,X:number,Y:number,direction:number)=>{if(++count>800000)throw failDetail();const list=byRegion.get(id)??[];list.push({a:y*stride+x,b:Y*stride+X,direction,used:false});byRegion.set(id,list);};
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x,id=grid[i];if(id<0)continue;if(!y||grid[i-w]!==id)edge(id,x,y,x+1,y,0);if(x===w-1||grid[i+1]!==id)edge(id,x+1,y,x+1,y+1,1);if(y===h-1||grid[i+w]!==id)edge(id,x+1,y+1,x,y+1,2);if(!x||grid[i-1]!==id)edge(id,x,y+1,x,y,3);}
 const xy=(code:number):Point=>[code%stride,Math.floor(code/stride)];
 const junction=([x,y]:Point)=>new Set([[-1,-1],[0,-1],[-1,0],[0,0]].map(([dx,dy])=>{const X=x+dx,Y=y+dy;return X<0||X>=w||Y<0||Y>=h?-1:grid[Y*w+X];})).size>2;
 const result=new Map<number,Point[][]>();let vertices=0;
 for(const [id,edges] of byRegion){const outgoing=new Map<number,Edge[]>();for(const e of edges){const a=outgoing.get(e.a)??[];a.push(e);outgoing.set(e.a,a);}const loops:Point[][]=[];
  for(const initial of edges)if(!initial.used){let e=initial;const raw:Point[]=[],limit=edges.length+1;do{e.used=true;raw.push(xy(e.a));const next=(outgoing.get(e.b)??[]).filter(v=>!v.used);if(e.b===initial.a)break;next.sort((a,b)=>[1,0,3,2].indexOf((a.direction-e.direction+4)%4)-[1,0,3,2].indexOf((b.direction-e.direction+4)%4));if(!next.length||raw.length>limit)throw new Error('Could not build closed colour regions. Try lower detail.');e=next[0];}while(true);
   // Diagonal hole/exterior contacts revisit a vertex. Separate the cycles
   // without changing their winding or the occupied even-odd area.
   const stack:Point[]=[],seen=new Map<number,number>(),cycles:Point[][]=[];
   for(const point of [...raw,raw[0]]){const code=point[1]*stride+point[0],at=seen.get(code);if(at===undefined){seen.set(code,stack.length);stack.push(point);}else{const cycle=stack.slice(at);if(cycle.length>=3)cycles.push(cycle);for(const p of stack.splice(at+1))seen.delete(p[1]*stride+p[0]);}}
   for(const cycle of cycles){const points=cycle.filter((b,i)=>{const a=cycle[(i+cycle.length-1)%cycle.length],c=cycle[(i+1)%cycle.length];return (b[0]-a[0])*(c[1]-b[1])!==(b[1]-a[1])*(c[0]-b[0])||junction(b);});if(points.length<3)throw failDetail();vertices+=points.length;if(vertices>MAX_VERTICES)throw failDetail();loops.push(points);}
  }result.set(id,loops);
 }
 return result;
}
