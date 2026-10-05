import type {Contour,Generated,Point} from './geometry';
import type {PatternFamily} from './patternCatalog';
import {rectangleOutline} from './structural';
import {jigsaw} from './jigsaw';
export interface PatternImage {width:number;height:number;data:Uint8ClampedArray}
type Draft=Omit<Generated,'name'|'bounds'>;
const TAU=2*Math.PI;
const poly=(points:Point[],closed=true):Contour=>({points,closed});
const rect=(w:number,h:number)=>poly([[0,0],[w,0],[w,h],[0,h]]);
function check(ok:boolean,message:string):asserts ok {if(!ok)throw new Error(message);}
function random(seed:number):()=>number {let s=seed|0;return()=>{s=(s+0x6D2B79F5)|0;let t=Math.imul(s^(s>>>15),1|s);t^=t+Math.imul(t^(t>>>7),61|t);return ((t^(t>>>14))>>>0)/4294967296;};}
const clamp=(x:number,a=0,b=1)=>Math.max(a,Math.min(b,x));
function clip(points:Point[],nx:number,ny:number,d:number):Point[]{
 const out:Point[]=[];for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],da=a[0]*nx+a[1]*ny-d,db=b[0]*nx+b[1]*ny-d;if(da<=1e-9)out.push(a);if((da<0)!==(db<0)){const t=da/(da-db);out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}}return out;
}
function centroid(p:Point[]):Point {let area=0,x=0,y=0;for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length],c=a[0]*b[1]-b[0]*a[1];area+=c;x+=(a[0]+b[0])*c;y+=(a[1]+b[1])*c;}return Math.abs(area)>1e-9?[x/(3*area),y/(3*area)]:p[0];}
function perlin(seed:number):(x:number,y:number)=>number {
 const rnd=random(seed),p=Array.from({length:256},(_,i)=>i);for(let i=255;i>0;i--){const j=Math.floor(rnd()*(i+1));[p[i],p[j]]=[p[j],p[i]];}
 const fade=(t:number)=>t*t*t*(t*(t*6-15)+10),mix=(a:number,b:number,t:number)=>a+(b-a)*t;
 const grad=(x:number,y:number,dx:number,dy:number)=>{const angle=(p[(p[x&255]+y)&255]&7)*Math.PI/4;return dx*Math.cos(angle)+dy*Math.sin(angle);};
 return(x,y)=>{const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;return mix(mix(grad(ix,iy,fx,fy),grad(ix+1,iy,fx-1,fy),fade(fx)),mix(grad(ix,iy+1,fx,fy-1),grad(ix+1,iy+1,fx-1,fy-1),fade(fx)),fade(fy));};
}
export function pattern(family:PatternFamily,id:string,v:Record<string,number>,image?:PatternImage):Draft {
 if(family==='jigsaw')return jigsaw(id,v);
 const r:Draft={parts:[],guides:[],metrics:{},notes:[]},w=v.width,h=v.height,b=v.border,rnd=random(v.seed??1);
 const add=(name:string,contours:Contour[])=>r.parts.push({name,contours});
 if(['voronoi','halftone','waveform'].includes(family))check(2*b<Math.min(w,h),'The border must leave space inside the panel.');
 if(family==='voronoi'){
  check(Math.min(w-2*b,h-2*b)>=.01,'The border must leave at least 0.01 mm inside the panel.');
  const cols=Math.min(v.count,Math.ceil(Math.sqrt(v.count*(w-2*b)/(h-2*b)))),rows=Math.ceil(v.count/cols),slots=Array.from({length:cols*rows},(_,i)=>i);
  for(let i=slots.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[slots[i],slots[j]]=[slots[j],slots[i]];}
  let sites:Point[]=slots.slice(0,v.count).map(i=>[b+(i%cols+.15+.7*rnd())*(w-2*b)/cols,b+(Math.floor(i/cols)+.15+.7*rnd())*(h-2*b)/rows]);
  const cell=(site:Point,index:number,gap:number)=>{let p:Point[]=[[b,b],[w-b,b],[w-b,h-b],[b,h-b]];for(let j=0;j<sites.length&&p.length;j++)if(j!==index){const q=sites[j],nx=q[0]-site[0],ny=q[1]-site[1];p=clip(p,nx,ny,(q[0]**2+q[1]**2-site[0]**2-site[1]**2)/2-gap*Math.hypot(nx,ny)/2);}return p;};
  for(let k=0;k<v.relax;k++)sites=sites.map((s,i)=>centroid(cell(s,i,0)));
  const holes=sites.map((s,i)=>cell(s,i,v.web)).filter(p=>p.length>=3);check(holes.length>0,'The material web leaves no cells. Reduce its width.');add('Voronoi panel',[rect(w,h),...holes.map(p=>poly(p))]);r.metrics['Cut-out cells']=String(holes.length);r.metrics['Material web']=`${v.web} mm`;if(holes.length<v.count)r.notes.push(`${v.count-holes.length} small cells collapsed at this web width and were omitted.`);
 }else if(family==='spirograph'){
  const R=v.fixed,a=v.rolling,d=v.offset,inside=id==='hypotrochoid',line=id==='cycloid';if(inside)check(R>a,'The rolling radius must be smaller than the fixed radius.');
  const base=inside?R-a:R+a,k=base/a,end=TAU*v.turns,M=line?d:Math.abs(base)+d*k*k;
  const steps=Math.ceil(end/Math.min(.06,Math.sqrt(8*.015/Math.max(M,1))));check(steps<=20000,'Curve is too dense. Reduce revolutions or the radius ratio.');
  const points:Point[]=Array.from({length:steps+1},(_,i)=>{const t=end*i/steps;if(line)return [a*t-d*Math.sin(t),a-d*Math.cos(t)];return inside?[base*Math.cos(t)+d*Math.cos(k*t),base*Math.sin(t)-d*Math.sin(k*t)]:[base*Math.cos(t)-d*Math.cos(k*t),base*Math.sin(t)-d*Math.sin(k*t)];});
  const closed=!line&&Math.abs(R/a*v.turns-Math.round(R/a*v.turns))<1e-9;add('Cycloidal curve',[poly(points,closed)]);r.metrics['Path']=closed?'Closed period':'Open curve';r.metrics['Samples']=String(points.length);r.notes.push('Self-crossings are part of the curve; this is a line pattern, not a panel with separate holes.');
 }else if(family==='maze'){
  if(id==='labyrinth'){
   const outer=v.diameter/2;check(outer-(v.rings-1)*v.pitch>v.pitch,'Reduce rings or spacing to leave a positive inner radius.');const points:Point[]=[],start=v.opening*Math.PI/360,end=TAU-start;
   for(let ring=0;ring<v.rings;ring++){const radius=outer-ring*v.pitch,steps=Math.ceil((end-start)/Math.min(.08,Math.sqrt(8*.015/radius)));for(let i=0;i<=steps;i++){const t=ring%2?end-(end-start)*i/steps:start+(end-start)*i/steps;points.push([radius*Math.cos(t),radius*Math.sin(t)]);}}points.push([0,0]);check(points.length<=20000,'Labyrinth is too dense. Reduce rings or diameter.');add('Circular labyrinth',[poly(points,false)]);r.metrics['Rings']=String(v.rings);
  }else{
   const cols=v.columns,rows=v.rows,count=cols*rows;check(count<=1600,'Limit the maze to 1,600 cells.');const wall=id==='maze-walls'?v.wall:0;const dx=(w-wall)/cols,dy=(h-wall)/rows,origin=wall/2;check(wall<Math.min(dx,dy)/2,'Wall width must be less than half the cell spacing.');
   const visited=new Uint8Array(count),parent=new Int32Array(count).fill(-1),stack=[0],passages=new Set<string>(),key=(a:number,b:number)=>`${Math.min(a,b)}:${Math.max(a,b)}`;visited[0]=1;
   while(stack.length){const a=stack.at(-1)!,x=a%cols,y=Math.floor(a/cols),options=[...(x?[a-1]:[]),...(x<cols-1?[a+1]:[]),...(y?[a-cols]:[]),...(y<rows-1?[a+cols]:[])].filter(i=>!visited[i]);if(!options.length){stack.pop();continue;}const next=options[Math.floor(rnd()*options.length)];visited[next]=1;parent[next]=a;passages.add(key(a,next));stack.push(next);}
   const lines:Point[][]=[],line=(x:number,y:number,X:number,Y:number)=>lines.push([[origin+x*dx,origin+y*dy],[origin+X*dx,origin+Y*dy]]);
   line(1,0,cols,0);line(0,rows,cols-1,rows);line(0,0,0,rows);line(cols,0,cols,rows);
   for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){const a=y*cols+x;if(x<cols-1&&!passages.has(key(a,a+1)))line(x+1,y,x+1,y+1);if(y<rows-1&&!passages.has(key(a,a+cols)))line(x,y+1,x+1,y+1);}
   if(wall){const rectangles:[number,number,number,number][]=lines.map(([a,z])=>[Math.min(a[0],z[0])-wall/2,Math.min(a[1],z[1])-wall/2,Math.abs(z[0]-a[0])+wall,Math.abs(z[1]-a[1])+wall]);add('Maze wall outlines',rectangleOutline(rectangles));}else add('Maze wall lines',lines.map(p=>poly(p,false)));
   const route:Point[]=[];for(let a=count-1;a>=0;a=parent[a])route.push([origin+(a%cols+.5)*dx,origin+(Math.floor(a/cols)+.5)*dy]);route.reverse();r.guides.push(poly([[origin+dx/2,0],...route,[origin+(cols-.5)*dx,h]],false));r.metrics['Cells']=String(count);r.metrics['Routes between cells']='Exactly one';
  }
 }else if(family==='halftone'){
  check(!!image,'Choose an image to preview the pattern.');check(image.width>0&&image.height>0&&image.data.length===image.width*image.height*4,'Image data is invalid.');check(v.minDiameter<=v.maxDiameter,'Minimum hole diameter must not exceed the maximum.');check(v.maxDiameter+v.gap<=v.spacing+1e-9,'Hole diameter plus material gap must fit within point spacing.');
  const margin=b+v.maxDiameter/2,innerW=w-2*margin,innerH=h-2*margin;check(innerW>0&&innerH>0,'The border and hole diameter leave no pattern area.');const rowStep=v.spacing*(id==='halftone-hex'?Math.sqrt(3)/2:1),cols=Math.floor(innerW/v.spacing)+1,rows=Math.floor(innerH/rowStep)+1;check(cols*rows<=6000,'Limit the pattern to 6,000 points. Increase spacing or reduce panel size.');
  const points:Point[]=[];for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){let px=margin+(innerW-(cols-1)*v.spacing)/2+x*v.spacing+(id==='halftone-hex'&&y%2?v.spacing/2:0),py=margin+(innerH-(rows-1)*rowStep)/2+y*rowStep;if(id==='stipple'){px+=(rnd()-.5)*v.spacing*.4;py+=(rnd()-.5)*v.spacing*.4;}if(px>=margin&&px<=w-margin&&py>=margin&&py<=h-margin)points.push([px,py]);}
  const buckets=new Map<string,number[]>(),bucket=(x:number,y:number)=>`${x},${y}`;points.forEach(([x,y],i)=>{const key=bucket(Math.floor(x/v.spacing),Math.floor(y/v.spacing));buckets.set(key,[...(buckets.get(key)??[]),i]);});
  const scale=Math.min((w-2*b)/image.width,(h-2*b)/image.height),ox=(w-image.width*scale)/2,oy=(h-image.height*scale)/2;
  const ink=(x:number,y:number)=>{if(x<ox||y<oy||x>ox+image.width*scale||y>oy+image.height*scale)return 0;const px=clamp((x-ox)/scale-.5,0,image.width-1),py=clamp((y-oy)/scale-.5,0,image.height-1),ix=Math.floor(px),iy=Math.floor(py);let tone=0;for(let dy=0;dy<=1;dy++)for(let dx=0;dx<=1;dx++){const i=(Math.min(iy+dy,image.height-1)*image.width+Math.min(ix+dx,image.width-1))*4,weight=(dx?px-ix:1-px+ix)*(dy?py-iy:1-py+iy),lum=(.2126*image.data[i]+.7152*image.data[i+1]+.0722*image.data[i+2])/255,t=clamp((lum-.5)*v.contrast/100+.5);tone+=weight*(v.invert?t:1-t)*image.data[i+3]/255;}return tone;};
  const holes:Contour[]=[];points.forEach(([x,y],i)=>{let max=v.maxDiameter;const bx=Math.floor(x/v.spacing),by=Math.floor(y/v.spacing);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)for(const j of buckets.get(bucket(bx+dx,by+dy))??[])if(j!==i)max=Math.min(max,Math.hypot(x-points[j][0],y-points[j][1])-v.gap);const diameter=max*Math.sqrt(ink(x,y));if(diameter>=v.minDiameter)holes.push({center:[x,y],radius:diameter/2});});
  add('Image hole panel',[rect(w,h),...holes]);r.metrics['Holes']=String(holes.length);r.metrics['Sample points']=String(points.length);if(!holes.length)r.notes.push('No holes at these settings. Try inverting the image or reducing the minimum diameter.');r.notes.push('The source image stays on this device. Inserted holes are editable vector circles.');
 }else{
  const strip=id.endsWith('strips')?v.strip:0,pitch=(h-2*b)/(v.rows+1);check(2*v.amplitude+strip+v.gap<=pitch,'Reduce amplitude/strip height or rows to preserve the minimum gap.');
  const noise=perlin(v.seed??1),octaves=v.octaves??1,steps=Math.ceil((w-2*b)/Math.min(v.wavelength/(32*2**(octaves-1)),(w-2*b)/200));check((steps+1)*v.rows*(strip?2:1)<=20000,'Pattern is too dense. Reduce rows/octaves or increase wavelength.');
  const contours:Contour[]=[rect(w,h)];for(let row=0;row<v.rows;row++){const base=b+(row+1)*pitch,points:Point[]=Array.from({length:steps+1},(_,i)=>{const x=b+(w-2*b)*i/steps;let f=0;if(id.startsWith('sine'))f=Math.sin(TAU*(x-b)/v.wavelength+row*v.phase*Math.PI/180);else{let weight=1,total=0,freq=1;for(let o=0;o<octaves;o++){f+=weight*noise(x/v.wavelength*freq,base/v.wavelength*freq);total+=weight;weight/=2;freq*=2;}f=clamp(f/total,-1,1);}return [x,base+v.amplitude*f];});contours.push(strip?poly([...points.map(([x,y]):Point=>[x,y-strip/2]),...points.slice().reverse().map(([x,y]):Point=>[x,y+strip/2])]):poly(points,false));}add('Wave panel',contours);r.metrics['Wave rows']=String(v.rows);r.metrics['Row spacing']=`${pitch.toFixed(2)} mm`;
 }
 return r;
}
