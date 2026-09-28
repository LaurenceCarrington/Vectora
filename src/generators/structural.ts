import type {Part,Contour,Point,Generated} from './geometry';
import type {StructuralFamily} from './structuralCatalog';
type Rect=[number,number,number,number];
type Draft=Omit<Generated,'name'|'bounds'>;
const poly=(points:Point[],closed=true):Contour=>({points,closed});
const rect=([x,y,w,h]:Rect)=>poly([[x,y],[x+w,y],[x+w,y+h],[x,y+h]]);
function check(ok:boolean,message:string):asserts ok {if(!ok)throw new Error(message);}
const mm=(value:number)=>`${Number(value.toFixed(3))} mm`;
const line=(a:Point,b:Point)=>poly([a,b],false);
/** Exact axis-aligned union/difference, using a bounded coordinate-compressed cell grid. */
export function rectangleOutline(add:Rect[],remove:Rect[]=[]):Contour[] {
 const round=(x:number)=>Number(x.toFixed(8));
 const all=[...add,...remove];check(all.every(r=>r.every(Number.isFinite)&&r[2]>0&&r[3]>0),'Every panel feature must have positive dimensions.');
 const xs=[...new Set(all.flatMap(([x,,w])=>[round(x),round(x+w)]))].sort((a,b)=>a-b),ys=[...new Set(all.flatMap(([,y,,h])=>[round(y),round(y+h)]))].sort((a,b)=>a-b),nx=xs.length-1,ny=ys.length-1;
 check(nx*ny<=100000,'Too many panel features. Increase finger width or reduce the dimensions.');
 const cells=new Uint8Array(nx*ny),xi=new Map(xs.map((x,i)=>[x,i])),yi=new Map(ys.map((y,i)=>[y,i]));
 const paint=(rects:Rect[],value:number)=>{for(const [x,y,w,h] of rects)for(let j=yi.get(round(y))!;j<yi.get(round(y+h))!;j++)cells.fill(value,j*nx+xi.get(round(x))!,j*nx+xi.get(round(x+w))!);};paint(add,1);paint(remove,0);
 const edges=new Map<number,number>(),stride=nx+1;
 const edge=(a:number,b:number)=>{check(!edges.has(a),'Features touch at a single point. Increase their spacing.');edges.set(a,b);};
 for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)if(cells[y*nx+x]){const a=y*stride+x,b=a+1,c=a+stride+1,d=a+stride;if(!y||!cells[(y-1)*nx+x])edge(a,b);if(x===nx-1||!cells[y*nx+x+1])edge(b,c);if(y===ny-1||!cells[(y+1)*nx+x])edge(c,d);if(!x||!cells[y*nx+x-1])edge(d,a);}
 const contours:Contour[]=[];while(edges.size){const start=edges.keys().next().value!,ids:number[]=[];let current=start;do{ids.push(current);const next=edges.get(current);check(next!==undefined,'Panel outline is disconnected.');edges.delete(current);current=next;}while(current!==start);
  const pts:Point[]=ids.map(i=>[xs[i%stride],ys[Math.floor(i/stride)]]);contours.push(poly(pts.filter((p,i)=>{const a=pts[(i+pts.length-1)%pts.length],b=pts[(i+1)%pts.length];return Math.abs((p[0]-a[0])*(b[1]-p[1])-(p[1]-a[1])*(b[0]-p[0]))>1e-9;})));
 }
 check(contours.length>0,'No material remains in this panel.');return contours;
}
function shifted(contours:Contour[],dx:number,dy:number):Contour[]{return contours.map(c=>'radius'in c?{center:[c.center[0]+dx,c.center[1]+dy],radius:c.radius}:poly(c.points.map(([x,y])=>[x+dx,y+dy]),c.closed));}
function insetTriangle(points:Point[],distance:number):Point[]{
 const area=points.reduce((s,p,i)=>{const q=points[(i+1)%points.length];return s+p[0]*q[1]-p[1]*q[0];},0)/2;
 if(area<0)points=[...points].reverse();
 const perimeter=points.reduce((s,p,i)=>s+Math.hypot(p[0]-points[(i+1)%3][0],p[1]-points[(i+1)%3][1]),0);
 check(2*Math.abs(area)/perimeter>distance+.05,'Members close the truss openings. Reduce member width or use fewer bays.');
 const edges=points.map((p,i)=>{const q=points[(i+1)%3],dx=q[0]-p[0],dy=q[1]-p[1],length=Math.hypot(dx,dy);return {p:[p[0]-dy/length*distance,p[1]+dx/length*distance] as Point,d:[dx,dy] as Point};});
 return edges.map((b,i)=>{const a=edges[(i+2)%3],cross=a.d[0]*b.d[1]-a.d[1]*b.d[0],t=((b.p[0]-a.p[0])*b.d[1]-(b.p[1]-a.p[1])*b.d[0])/cross;return [a.p[0]+t*a.d[0],a.p[1]+t*a.d[1]];});
}
export function structural(family:StructuralFamily,id:string,v:Record<string,number>):Draft {
 const parts:Part[]=[],guides:Contour[]=[],notes:string[]=[],metrics:Record<string,string>={};
 if(family==='box'){
  const w=v.width,d=v.depth,h=v.height,t=v.thickness,c=v.fit;
  check(Math.min(w,d,h)>4*t,'Panel dimensions must exceed four sheet thicknesses.');
  if(id==='finger-box'||id==='open-box'){
   const counts=new Map<number,number>();for(const length of [w,d,h]){let count=Math.max(3,Math.floor((length-2*t)/v.finger));if(count%2===0)count--;check(count<=101,'Too many fingers. Increase target finger width (maximum 101 divisions per edge).');check((length-2*t)/count>Math.max(t,c*2),'Finger divisions must be wider than sheet thickness and clearance.');counts.set(length,count);}
   // 0: bottom, 1: right, 2: top, 3: left. Opposite parts share the same global edge parameter.
   function face(name:string,a:number,b:number,phase:(number|null)[],corners:boolean,x:number,y:number){
    const cuts:Rect[]=[];
    for(let edge=0;edge<4;edge++){const mode=phase[edge];if(mode===null)continue;const length=edge%2?b:a,count=counts.get(length)!,pitch=(length-2*t)/count;
     for(let i=0;i<count;i++)if(i%2===mode){const start=Math.max(t,t+i*pitch-c/2),end=Math.min(length-t,t+(i+1)*pitch+c/2);cuts.push(edge===0?[start,b-t,end-start,t]:edge===2?[start,0,end-start,t]:edge===1?[a-t,start,t,end-start]:[0,start,t,end-start]);}
    }
    if(corners)cuts.push([0,0,t,t],[a-t,0,t,t],[0,b-t,t,t],[a-t,b-t,t,t]);
    const contours=rectangleOutline([[0,0,a,b]],cuts);check(contours.length===1,'Finger settings disconnect a panel. Increase finger width.');parts.push({name,contours:shifted(contours,x,y)});
   }
   const g=v.gap,top=id==='finger-box';
   face('Front',w,h,[1,1,top?1:null,1],false,0,0);face('Back',w,h,[1,1,top?1:null,1],false,w+g,0);
   face('Left',d,h,[1,0,top?1:null,0],true,0,h+g);face('Right',d,h,[1,0,top?1:null,0],true,d+g,h+g);
   face('Base',w,d,[0,0,0,0],true,0,2*(h+g));if(top)face('Top',w,d,[0,0,0,0],true,w+g,2*(h+g));
   metrics['Outside size']=`${w} × ${d} × ${h} mm`;metrics['Inside size']=`${w-2*t} × ${d-2*t} × ${h-(top?2:1)*t} mm`;metrics['Sheet thickness']=mm(t);metrics['Panels']=String(parts.length);
   metrics['Finger pitch · W / D / H']=[w,d,h].map(l=>((l-2*t)/counts.get(l)!).toFixed(2)).join(' / ')+' mm';
   notes.push('Joint clearance widens the notches. Dimensions are finished-part outlines; apply measured kerf compensation in your cutting software.');
  }else{
   check(c<t&&v.tab>c,'Joint clearance must be smaller than the tab and sheet thickness.');
   const spacing=w/(v.count+1),centres=Array.from({length:v.count},(_,i)=>(i+1)*spacing);check(spacing>v.tab+c+2*t,'Tabs or slots overlap or leave too little edge material. Reduce tab width/count.');
   const adds:Rect[]=[[0,0,w,h],...centres.map(x=>[x-v.tab/2,h,v.tab,t] as Rect)],cuts:Rect[]=[];
   const receiver:Contour[]=[rect([0,0,w,d]),...centres.map(x=>rect([x-(v.tab+c)/2,(d-t-c)/2,v.tab+c,t+c]))];
   if(id==='t-slot'){
    check(v.count%2===0,'Use an even tab count to leave the centre clear for the bolt.');const nut=v.nut+c,bolt=v.bolt+c,nh=v.nutHeight+c;
    check(bolt<d-2*t,'Bolt hole must fit inside the receiver with at least one sheet thickness of edge material.');
    check(nut>bolt&&v.setback>nh/2+t&&v.setback+nh/2<h-t,'Nut pocket must be wider than the bolt, inside the panel, and clear of its edge.');
    check(spacing-v.tab>nut+2*t,'The nut pocket is too close to the tabs. Widen the panel or reduce tab/nut widths.');
    const y=h-v.setback;cuts.push([w/2-bolt/2,y,bolt,h-y],[w/2-nut/2,y-nh/2,nut,nh]);receiver.push({center:[w/2,d/2],radius:bolt/2});metrics['Bolt clearance hole']=mm(bolt);metrics['Nut pocket']=`${nut.toFixed(2)} × ${nh.toFixed(2)} mm`;
   }
   const upright=rectangleOutline(adds,cuts);check(upright.length===1,'The joint disconnects the upright panel.');parts.push({name:id==='t-slot'?'T-slot upright':'Tabbed upright',contours:upright},{name:'Receiver plate',contours:shifted(receiver,0,h+t+v.gap)});metrics['Tabs']=String(v.count);metrics['Receiver slots']=`${(v.tab+c).toFixed(2)} × ${(t+c).toFixed(2)} mm`;
   notes.push('Two-panel joint: the tabs pass through the receiver; the upright stands perpendicular to it. Apply kerf compensation in your cutting software.');
  }
 }else if(family==='hinge'){
  const horizontal=id==='hinge-horizontal',w=horizontal?v.height:v.width,h=horizontal?v.width:v.height,m=v.margin,slot=id==='hinge-slots'?v.slotWidth:0,period=v.length+v.bridge;
  check(w>2*m+v.spacing+slot&&h>2*m+v.length,'Panel interior must fit a full slit and at least two columns. Reduce margins/length/spacing.');
  check(v.spacing-slot-v.kerf>=.2&&v.bridge-v.kerf>=.2&&m>slot/2+v.kerf,'Cut width leaves less than 0.2 mm of material in a web, bridge or border. Increase spacing/bridges/margin.');
  check(!slot||v.length>slot,'Slot length must exceed its width.');
  const columns=Math.floor((w-2*m-slot)/v.spacing)+1,estimate=columns*(Math.ceil((h-2*m)/period)+1);check(estimate<=2500,'Pattern exceeds 2,500 cuts. Increase spacing or slit length, or reduce panel size.');
  const contours:Contour[]=[rect([0,0,v.width,v.height])],x0=(w-(columns-1)*v.spacing)/2;
  const orient=([x,y]:Point):Point=>horizontal?[y,x]:[x,y];let cuts=0;
  for(let col=0;col<columns;col++){
   const x=x0+col*v.spacing,offset=col%2?period/2:0;
   for(let start=m-offset;start<h-m;start+=period){const a=Math.max(m,start),b=Math.min(h-m,start+v.length);if(b-a<Math.max(slot+.05,.5))continue;
    if(!slot)contours.push(line(orient([x,a]),orient([x,b])));
    else {const r=slot/2,steps=Math.max(12,Math.ceil(Math.PI/(2*Math.acos(1-.015/r)))),points:Point[]=[];for(let i=0;i<=steps;i++){const angle=Math.PI+i*Math.PI/steps;points.push([x+r*Math.cos(angle),a+r+r*Math.sin(angle)]);}for(let i=0;i<=steps;i++){const angle=i*Math.PI/steps;points.push([x+r*Math.cos(angle),b-r+r*Math.sin(angle)]);}contours.push(poly(points.map(orient)));}cuts++;
   }
  }
  parts.push({name:'Living hinge panel',contours});guides.push(line(orient([w/2,0]),orient([w/2,h])));metrics['Cuts']=String(cuts);metrics['Columns']=String(columns);metrics['Remaining side web']=mm(v.spacing-slot-v.kerf);metrics['Remaining bridge']=mm(v.bridge-v.kerf);
  notes.push('Cut geometry only: achievable bend radius depends on material, thickness and grain. Test a small coupon before choosing your final pattern.');
 }else if(family==='packaging'){
  const w=v.width,d=v.depth,h=v.height,g=v.glue,s=v.slot,adds:Rect[]=[],folds:Contour[]=[];
  check(g<Math.min(w,d,h)/2&&s<Math.min(w,d,h)/5,'Glue tabs or separation are too large for these panel dimensions.');
  if(id==='glue-tray'){
   adds.push([0,0,w,d],[0,-h,w,h],[0,d,w,h],[-h,0,h,d],[w,0,h,d]);
   folds.push(line([0,0],[w,0]),line([0,d],[w,d]),line([0,0],[0,d]),line([w,0],[w,d]));
   for(const x of [-h+s,w+s])for(const y of [-g,d]){adds.push([x,y,h-2*s,g]);const yy=y<0?0:d;folds.push(line([x,yy],[x+h-2*s,yy]));}
   metrics['Base / wall']=`${w} × ${d} / ${h} mm`;
  }else{
   const total=2*(w+d),widths=[w,d,w,d],xs=[0,w,w+d,2*w+d];check(v.clearance<d/4,'Flap shortfall must be less than one quarter of panel depth.');
   adds.push([0,0,total,h],[-g,s,g,h-2*s]);folds.push(line([0,s],[0,h-s]));for(const x of xs.slice(1))folds.push(line([x,0],[x,h]));
   if(id==='shipping-carton')check(w>=d,'For this shipping carton, panel width must be at least panel depth.');
   for(let i=0;i<4;i++)for(const bottom of [false,true]){
    const x=xs[i]+s/2,pw=widths[i]-s,major=id==='tuck-carton'&&(bottom?i===2:i===0),dust=i%2===1;
    if(id==='tuck-carton'&&!major&&!dust)continue;
    const length=id==='shipping-carton'?d/2-v.clearance:major?d-v.clearance:Math.min(d*.65,w*.45)-v.clearance;
    check(length>s,'Flaps are too short for the separation and shortfall.');adds.push([x,bottom?h:-length,pw,length]);folds.push(line([x,bottom?h:0],[x+pw,bottom?h:0]));
    if(major){const shoulder=Math.max(s,pw*.08),tw=pw-2*shoulder;check(tw>2*s&&v.tuck<h/2,'Tuck tongue must fit the panel width and be shorter than half the body height.');adds.push([x+shoulder,bottom?h+length:-length-v.tuck,tw,v.tuck]);folds.push(line([x+shoulder,bottom?h+length:-length],[x+shoulder+tw,bottom?h+length:-length]));}
   }
   metrics['Body panels']=`${w} / ${d} / ${w} / ${d} mm`;metrics['Body height']=mm(h);if(id==='shipping-carton')metrics['Closure gap']=mm(2*v.clearance);
  }
  const outline=rectangleOutline(adds);check(outline.length===1,'Packaging tabs overlap or disconnect the net. Reduce their dimensions.');parts.push({name:'Packaging cut outline',contours:outline},{name:'Packaging fold / score lines',contours:folds,operation:'engrave'});metrics['Fold lines']=String(folds.length);
  notes.push('Panel sizes are crease-to-crease. Adjust for measured board caliper and your crease tooling; this is a custom net, not a certified die specification.');
 }else{
  const w=v.width,h=v.height,m=v.member;check(Math.min(w,h)>3*m,'Member width must leave room inside the frame.');const contours:Contour[]=[rect([0,0,w,h])];
  if(id==='frame-grid'){
   const cw=(w-m)/v.columns,ch=(h-m)/v.rows;check(Math.min(cw,ch)>m+.2,'Members close the framework openings. Reduce member width or row/column count.');
   for(let row=0;row<v.rows;row++)for(let col=0;col<v.columns;col++)contours.push(rect([m+col*cw,m+row*ch,cw-m,ch-m]));metrics['Openings']=`${v.columns} × ${v.rows}`;metrics['Opening size']=`${(cw-m).toFixed(2)} × ${(ch-m).toFixed(2)} mm`;
  }else{
   const x0=m/2,y0=m/2,y1=h-m/2,pitch=(w-m)/v.bays,triangles:Point[][]=[];
   if(id==='warren'){
    const zig=Array.from({length:v.bays+1},(_,i):Point=>[x0+i*pitch,i%2?y0:y1]);for(let i=1;i<v.bays;i++)triangles.push([zig[i-1],zig[i],zig[i+1]]);triangles.push([[x0,y0],zig[0],zig[1]],[zig[v.bays-1],zig[v.bays],[w-m/2,v.bays%2?y1:y0]]);guides.push(poly(zig,false));
   }else{
    check(v.bays%2===0,'Pratt and Howe profiles use an even number of bays.');
    for(let i=0;i<v.bays;i++){const a:Point=[x0+i*pitch,y0],b:Point=[x0+(i+1)*pitch,y0],c:Point=[b[0],y1],d:Point=[a[0],y1],down=(i<v.bays/2)===(id==='pratt');triangles.push(...(down?[[a,b,c],[a,c,d]]:[[a,b,d],[b,c,d]]));guides.push(down?line(a,c):line(b,d));if(i)guides.push(line(a,d));}
   }
   contours.push(...triangles.map(tri=>poly(insetTriangle(tri,m/2))));metrics['Bays']=String(v.bays);metrics['Bay spacing']=mm(pitch);metrics['Openings']=String(triangles.length);
  }
  parts.push({name:id==='frame-grid'?'Rectangular framework':`${id[0].toUpperCase()+id.slice(1)} truss`,contours});metrics['Member width']=mm(m);notes.push('Flat cutting geometry. Connections, supports, material strength and load capacity are not modelled.');
 }
 return {parts,guides,metrics,notes};
}
