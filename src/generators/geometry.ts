import {pattern,type PatternImage} from './patterns';
import {PATTERN_CATALOG,type PatternFamily} from './patternCatalog';
import {structural} from './structural';
import {CATALOG,type Family,type Values} from './catalog';
export type Point=[number,number];
export type Contour={points:Point[];closed:boolean}|{center:Point;radius:number};
export interface Part {name:string;contours:Contour[];operation?:'engrave'}
export interface Generated {name:string;parts:Part[];guides:Contour[];metrics:Record<string,string>;notes:string[];bounds:{x:number;y:number;width:number;height:number}}
const TAU=2*Math.PI,rad=Math.PI/180,TOL=.015;
const polar=(r:number,a:number):Point=>[r*Math.cos(a),r*Math.sin(a)];
const poly=(points:Point[],closed=true):Contour=>({points,closed});
const circle=(radius:number,center:Point=[0,0]):Contour=>({center,radius});
function check(ok:boolean,message:string):asserts ok {if(!ok)throw new Error(message);}
function arc(r:number,start:number,end:number,center:Point=[0,0]):Point[]{const steps=Math.max(1,Math.ceil(Math.abs(end-start)/Math.min(.1,2*Math.acos(Math.max(-1,1-TOL/r)))));return Array.from({length:steps+1},(_,i)=>{const p=polar(r,start+(end-start)*i/steps);return [p[0]+center[0],p[1]+center[1]];});}
function sampled(fn:(t:number)=>Point,a:number,b:number):Point[]{
 const out:Point[]=[fn(a)];
 const split=(x:number,y:number,p:Point,q:Point,depth:number)=>{const m=(x+y)/2,c=fn(m),error=Math.hypot(c[0]-(p[0]+q[0])/2,c[1]-(p[1]+q[1])/2);if(depth<14&&error>TOL){split(x,m,p,c,depth+1);split(m,y,c,q,depth+1);}else out.push(q);};
 split(a,b,out[0],fn(b),0);return out;
}
const mm=(n:number)=>`${Number(n.toFixed(3))} mm`;
export function generate(family:Family,id:string,values:Values,image?:PatternImage):Generated {
 const profile=CATALOG[family]?.profiles.find(p=>p.id===id);check(!!profile,'Choose an available profile.');
 const v:Record<string,number>={};for(const f of profile.fields){const x=values[f.key];check(typeof x==='number'&&Number.isFinite(x)&&x>=f.min&&x<=f.max&&(!(f.step===1&&f.unit==='')||Number.isInteger(x)),`${f.label} must be ${f.min}–${f.max}${f.unit?` ${f.unit}`:''}${f.step===1&&f.unit===''?' (whole numbers)':''}.`);v[f.key]=x;}
 const parts:Part[]=[],guides:Contour[]=[],notes:string[]=[],metrics:Record<string,string>={};
 const add=(name:string,points:Point[],bore=0)=>parts.push({name,contours:[poly(points),...(bore?[circle(bore/2)]:[])]});
 const fitBore=(radius:number)=>check(v.bore/2<radius-.01,'The bore must fit inside the smallest profile radius.');
 if(family==='gear'){
  const beta=(v.helix??0)*rad,c=id==='bevel'?Math.cos(v.cone*rad):1,m=v.module,mt=m/Math.cos(beta),alpha=Math.atan(Math.tan(v.pressure*rad)/Math.cos(beta)),rp=mt*v.teeth/2,virtual=rp/c,rb=virtual*Math.cos(alpha),ra=virtual+m,rf=virtual-1.25*m;
  const inv=(r:number)=>{const t=Math.sqrt(Math.max(0,(r/rb)**2-1));return t-Math.atan(t);};
  const half=(Math.PI/(2*(v.teeth/c))-v.backlash/(2*virtual)),angle=(r:number)=>(half+inv(virtual)-inv(r))/c,start=Math.max(rf,rb),step=TAU/v.teeth,phase=id==='rack'?Math.PI/2:0;
  check(angle(ra)>0&&angle(start)<step/2,'Backlash or tooth proportions leave pointed or overlapping teeth. Reduce backlash or change teeth/module.');fitBore(rf*c);
  const points:Point[]=[];
  for(let i=0;i<v.teeth;i++){
   const a=phase+i*step;points.push(polar(rf*c,a-angle(start)));
   const t0=Math.sqrt(Math.max(0,(start/rb)**2-1)),t1=Math.sqrt((ra/rb)**2-1);
   points.push(...sampled(t=>{const r=rb*Math.sqrt(1+t*t);return polar(r*c,a-angle(r));},t0,t1));
   points.push(...arc(ra*c,a-angle(ra),a+angle(ra)));
   points.push(...sampled(t=>{const r=rb*Math.sqrt(1+t*t);return polar(r*c,a+angle(r));},t1,t0));
   points.push(polar(rf*c,a+angle(start)),...arc(rf*c,a+angle(start),a+step-angle(start)));
  }
  add(profile.label,points,v.bore);guides.push(circle(rp),circle(rb*c));
  metrics['Pitch diameter']=mm(2*rp);metrics['Outside diameter']=mm(2*ra*c);metrics['Root diameter']=mm(2*rf*c);
  if(id==='helical'){metrics['Transverse module']=mm(mt);metrics['Transverse pressure']=`${(alpha/rad).toFixed(2)}°`;}
  notes.push('Involute flanks; root fillets and cutter undercut are not modelled.');
  if(v.teeth/c<2/Math.sin(alpha)**2)notes.push('Low tooth count: a generated cutter profile may require undercut or profile shift.');
  if(id==='rack'){
   const pitch=Math.PI*m,half=pitch/4-v.backlash/2,tip=half-m*Math.tan(alpha),root=half+1.25*m*Math.tan(alpha);
   check(tip>0&&root<pitch/2,'Rack teeth overlap or have no top land. Change pressure angle or backlash.');
   const left=-Math.floor(v.rackTeeth/2)*pitch,right=left+v.rackTeeth*pitch,base=rp+1.25*m+v.base,pts:Point[]=[[left,base],[left,rp+1.25*m]];
   for(let i=0;i<v.rackTeeth;i++){const x=left+(i+.5)*pitch;pts.push([x-root,rp+1.25*m],[x-tip,rp-m],[x+tip,rp-m],[x+root,rp+1.25*m]);}
   pts.push([right,rp+1.25*m],[right,base]);add('Rack',pts);guides.push(poly([[left,rp],[right,rp]],false));metrics['Rack pitch']=mm(pitch);
  }
 }else if(family==='drive'){
  const step=TAU/v.teeth,pts:Point[]=[];let rp:number,outer:number,root:number;
  if(id==='sprocket'){
   rp=v.pitch/(2*Math.sin(Math.PI/v.teeth));const seat=v.roller/2+v.clearance;outer=rp+v.tip;root=rp-seat;
   check(v.roller+2*v.clearance<v.pitch&&v.tip<seat&&root>0,'Roller seats must be smaller than the pitch; tip height must be smaller than the seat radius.');
   const delta=Math.acos((rp*rp+outer*outer-seat*seat)/(2*rp*outer)),local=Math.acos((outer*outer-rp*rp-seat*seat)/(2*rp*seat));
   check(delta<step/2,'Roller seats overlap. Reduce roller diameter or clearance.');
   for(let i=0;i<v.teeth;i++){const a=i*step,centre=polar(rp,a);pts.push(...arc(seat,a-local,a-TAU+local,centre),...arc(outer,a+delta,a+step-delta));}
   notes.push('Custom roller seats, not an ANSI/ISO sprocket tooth specification.');
  }else{
   rp=v.teeth*v.pitch/TAU;outer=rp-v.offset;root=outer-v.depth;check(root>0&&v.width<2*outer,'Groove depth or opening is too large for this pulley.');
   const opening=Math.asin(v.width/(2*outer));check(opening<step/2,'Grooves overlap: reduce their opening or increase pitch.');
   let bottom=0;if(id==='trapezoid'){const width=v.width-2*v.depth*Math.tan(v.flank*rad);check(width>0&&width<2*root,'The flank angle/depth leaves no groove floor.');bottom=Math.asin(width/(2*root));check(bottom<=opening,'Groove floor is wider angularly than its opening. Increase flank angle.');}
   for(let i=0;i<v.teeth;i++){const a=i*step;if(id==='round')pts.push(...sampled(t=>polar(outer-v.depth*Math.sin(t),a-opening*Math.cos(t)),0,Math.PI));else pts.push(polar(outer,a-opening),...arc(root,a-bottom,a+bottom),polar(outer,a+opening));pts.push(...arc(outer,a+opening,a+step-opening));}
   notes.push('Custom groove geometry; match the dimensions to your intended belt.');
  }
  fitBore(root);add(profile.label,pts,v.bore);guides.push(circle(rp));metrics['Pitch diameter']=mm(2*rp);metrics['Outside diameter']=mm(2*outer);metrics['Root diameter']=mm(2*root);
 }else if(family==='fastener'){
  if(id==='washer'){fitBore(v.diameter/2);parts.push({name:profile.label,contours:[circle(v.diameter/2),circle(v.bore/2)]});}
  else if(id==='nut'){fitBore(v.across/2);add(profile.label,Array.from({length:6},(_,i)=>polar(v.across/Math.sqrt(3),i*TAU/6)),v.bore);metrics['Across flats']=mm(v.across);}
  else{
   const r=v.diameter/2,run=v.depth*Math.tan(v.angle*rad/2),flat=(v.pitch-2*run)/2;
   check(v.depth<r&&flat>.005,'Thread depth/angle must leave positive root and crest flats, and a positive core diameter.');check(v.length/v.pitch<=400,'Limit the thread to 400 pitches; increase pitch or reduce length.');
   if(id==='bolt')check(v.across>v.diameter,'Head across flats must exceed thread diameter.');
   const breaks=[0,flat/2,flat/2+run,v.pitch-flat/2-run,v.pitch-flat/2,v.pitch],depths=[0,0,v.depth,v.depth,0,0];
   const depth=(x:number)=>{const t=((x%v.pitch)+v.pitch)%v.pitch;let i=1;while(i<breaks.length-1&&t>breaks[i])i++;return depths[i-1]+(depths[i]-depths[i-1])*(t-breaks[i-1])/(breaks[i]-breaks[i-1]);};
   const edge=(phase:number,sign:number):Point[]=>{const xs=[0,v.length];for(let i=-1;i<=Math.ceil(v.length/v.pitch);i++)for(const b of breaks){const x=i*v.pitch+b-phase;if(x>0&&x<v.length)xs.push(x);}return [...new Set(xs)].sort((a,b)=>a-b).map(x=>[x,sign*(r-depth(x+phase))]);};
   const top=edge(0,-1),bottom=edge(v.pitch/2,1).reverse();const pts=[...top,...bottom];if(id==='bolt')pts.push([0,v.across/2],[-v.head,v.across/2],[-v.head,-v.across/2],[0,-v.across/2]);add(profile.label,pts);
   guides.push(poly([[-(v.head??0),0],[v.length,0]],false));metrics['Pitch']=mm(v.pitch);metrics['Core diameter']=mm(v.diameter-2*v.depth);metrics['Crest / root flat']=mm(flat);notes.push('Custom 2D thread section; no tolerance class, helical solid or standard thread truncation.');
  }
 }else if(family==='cam'){
  check(v.rise+v.dwell+v.return<=360,'Rise + high dwell + return must not exceed 360°.');
  const rise=v.rise*rad,dwell=v.dwell*rad,ret=v.return*rad;
  const motion=(t:number):[number,number,number]=>id==='cycloidal'?[t-Math.sin(TAU*t)/TAU,1-Math.cos(TAU*t),TAU*Math.sin(TAU*t)]:id==='harmonic'?[(1-Math.cos(Math.PI*t))/2,Math.PI*Math.sin(Math.PI*t)/2,Math.PI**2*Math.cos(Math.PI*t)/2]:[10*t**3-15*t**4+6*t**5,30*t*t-60*t**3+30*t**4,60*t-180*t*t+120*t**3];
  let maxPressure=0,minRadius=Infinity,maxOffsetCurvature=0;
  const at=(a:number,guide=false):Point=>{
   let s=0,velocity=0,accel=0;
   if(a<rise){const f=motion(a/rise);s=v.lift*f[0];velocity=v.lift*f[1]/rise;accel=v.lift*f[2]/rise**2;}
   else if(a<rise+dwell)s=v.lift;
   else if(a<rise+dwell+ret){const f=motion((a-rise-dwell)/ret);s=v.lift*(1-f[0]);velocity=-v.lift*f[1]/ret;accel=-v.lift*f[2]/ret**2;}
   const r=v.base+v.roller+s,c=Math.cos(a),sn=Math.sin(a),dx=velocity*c-r*sn,dy=velocity*sn+r*c,speed=Math.hypot(dx,dy),p:Point=[r*c,r*sn];
   maxPressure=Math.max(maxPressure,Math.atan(Math.abs(velocity)/r)/rad);maxOffsetCurvature=Math.max(maxOffsetCurvature,v.roller*(r*r+2*velocity**2-r*accel)/(speed**3));
   if(!guide){p[0]-=v.roller*dy/speed;p[1]+=v.roller*dx/speed;minRadius=Math.min(minRadius,Math.hypot(...p));}return p;
  };
  const angles=[0,rise,rise+dwell,rise+dwell+ret,TAU];for(let a=rad;a<TAU;a+=rad)angles.push(a);angles.sort((a,b)=>a-b);
  const pts:Point[]=[];for(let i=1;i<angles.length;i++)if(angles[i]>angles[i-1])pts.push(...sampled(a=>at(a),angles[i-1],angles[i]));
  check(maxOffsetCurvature<.98,'Roller offset would undercut or form a cusp. Reduce roller/lift, increase base radius, or use longer rise/return angles.');fitBore(minRadius);add(profile.label,pts,v.bore);guides.push(circle(v.base));if(v.roller)guides.push(poly(angles.map(a=>at(a,true))));
  metrics['Low dwell']=`${360-v.rise-v.dwell-v.return}°`;metrics['Maximum pressure angle']=`${maxPressure.toFixed(1)}°`;metrics['Follower']=v.roller?'Roller':'Knife edge';if(maxPressure>30)notes.push('Pressure angle exceeds 30°. A larger base or longer rise/return can reduce side loading.');
 }
 else {const result=family in PATTERN_CATALOG?pattern(family as PatternFamily,id,v,image):structural(family as Parameters<typeof structural>[0],id,v);parts.push(...result.parts);guides.push(...result.guides);notes.push(...result.notes);Object.assign(metrics,result.metrics);}
 // Remove shared sample endpoints and closing duplicates before creating editable paths.
 for(const part of parts)for(const contour of part.contours)if('points'in contour){contour.points=contour.points.filter((p,i,all)=>!i||Math.hypot(p[0]-all[i-1][0],p[1]-all[i-1][1])>1e-8);const a=contour.points[0],b=contour.points.at(-1)!;if(Math.hypot(a[0]-b[0],a[1]-b[1])<1e-8)contour.points.pop();}
 const all=parts.flatMap(p=>p.contours.flatMap(c=>'points'in c?c.points:[[c.center[0]-c.radius,c.center[1]-c.radius],[c.center[0]+c.radius,c.center[1]+c.radius]]));
 check(all.length<=50000&&all.every(p=>p.every(Number.isFinite)),'Profile is too complex or contains invalid geometry.');
 const xs=all.map(p=>p[0]),ys=all.map(p=>p[1]),x=Math.min(...xs),y=Math.min(...ys),width=Math.max(...xs)-x,height=Math.max(...ys)-y;
 check(width>0&&height>0,'Profile must have positive dimensions.');return {name:profile.label,parts,guides,metrics,notes,bounds:{x,y,width,height}};
}
export function contourSVG(c:Contour):string {if('radius'in c)return `<circle cx="${c.center[0]}" cy="${c.center[1]}" r="${c.radius}"/>`;return `<path d="${c.points.map((p,i)=>`${i?'L':'M'}${p[0]},${p[1]}`).join(' ')}${c.closed?'Z':''}"/>`;}
