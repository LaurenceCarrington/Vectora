export const GRID_TYPES = ['square','isometric','polar','hexagonal','triangular','dot'] as const;
export type GridType = typeof GRID_TYPES[number];
export const GRID_NAMES: Record<GridType,string> = {square:'Square',isometric:'Isometric',polar:'Polar (Radial)',hexagonal:'Hexagonal',triangular:'Triangular',dot:'Dot (Step)'};
export const GRID_HELP:Record<GridType,string>={square:'Distance between grid lines. Major lines appear every five cells.',isometric:'Edge length in millimetres. Snap to intersections along the 30° axes.',polar:'Distance between rings. Snap to ring/spoke crossings and the origin.',hexagonal:'Hexagon side length in millimetres. Snap to hexagon corners.',triangular:'Triangle side length in millimetres. Snap to triangle corners.',dot:'Distance between dots in millimetres. Snap to each dot.'};
export interface GridConfig { type:GridType; spacing:number; angle:number }
export interface XY { x:number; y:number }
export interface GridBounds { left:number; right:number; top:number; bottom:number }
export type GridMark = {kind:'line';a:XY;b:XY;major:boolean}|{kind:'circle';center:XY;radius:number;major:boolean}|{kind:'dot';center:XY;major:boolean};
const root3=Math.sqrt(3);
const add=(a:XY,b:XY):XY=>({x:a.x+b.x,y:a.y+b.y});
const mul=(a:XY,n:number):XY=>({x:a.x*n,y:a.y*n});
function basis(type:GridType,s:number):[XY,XY] {
  return type==='isometric'?[{x:root3*s/2,y:s/2},{x:0,y:s}]:[{x:s,y:0},{x:s/2,y:root3*s/2}];
}
function coordinates(p:XY,u:XY,v:XY):XY {
  const d=u.x*v.y-u.y*v.x;return {x:(p.x*v.y-p.y*v.x)/d,y:(u.x*p.y-u.y*p.x)/d};
}
function hexCenter(q:number,r:number,s:number):XY {return {x:1.5*s*q,y:root3*s*(r+q/2)};}
function hexVertex(center:XY,n:number,s:number):XY {const a=n*Math.PI/3;return {x:center.x+s*Math.cos(a),y:center.y+s*Math.sin(a)};}

/** Nearest actual vertex/intersection, including negative document coordinates. */
export function snapGridPoint(point:XY,config:GridConfig):XY {
  const s=config.spacing;
  if(config.type==='square'||config.type==='dot')return {x:Math.round(point.x/s)*s,y:Math.round(point.y/s)*s};
  let best:XY={x:0,y:0},distance=Infinity;
  const consider=(p:XY)=>{const d=(p.x-point.x)**2+(p.y-point.y)**2;if(d<distance){distance=d;best=p;}};
  if(config.type==='polar'){
    consider({x:0,y:0});
    for(let degrees=0;degrees<360;degrees+=config.angle){
      const angle=degrees*Math.PI/180,c=Math.cos(angle),d=Math.sin(angle);
      const radius=Math.max(0,Math.round((point.x*c+point.y*d)/s))*s;
      consider({x:radius*c,y:radius*d});
    }
  }else if(config.type==='hexagonal'){
    const q0=Math.round(point.x/(1.5*s));
    for(let q=q0-2;q<=q0+2;q++){
      const r0=Math.round(point.y/(root3*s)-q/2);
      for(let r=r0-2;r<=r0+2;r++)for(let n=0;n<6;n++)consider(hexVertex(hexCenter(q,r,s),n,s));
    }
  }else{
    const [u,v]=basis(config.type,s),p=coordinates(point,u,v);
    for(let i=Math.round(p.x)-1;i<=Math.round(p.x)+1;i++)for(let j=Math.round(p.y)-1;j<=Math.round(p.y)+1;j++)consider(add(mul(u,i),mul(v,j)));
  }
  return best;
}

/** Render only true grid geometry. Hide overcrowded details instead of changing spacing. */
export function gridMarks(bounds:GridBounds,zoom:number,config:GridConfig):GridMark[] {
  const s=config.spacing,marks:GridMark[]=[],corners=[{x:bounds.left,y:bounds.top},{x:bounds.right,y:bounds.top},{x:bounds.right,y:bounds.bottom},{x:bounds.left,y:bounds.bottom}];
  const line=(a:XY,b:XY,major=false)=>marks.push({kind:'line',a,b,major});
  const infiniteLine=(anchor:XY,direction:XY,major:boolean)=>{
    let low=-Infinity,high=Infinity;
    for(const [p,d,min,max] of [[anchor.x,direction.x,bounds.left,bounds.right],[anchor.y,direction.y,bounds.top,bounds.bottom]]){
      if(Math.abs(d)<1e-12){if(p<min||p>max)return;continue;}
      const a=(min-p)/d,b=(max-p)/d;low=Math.max(low,Math.min(a,b));high=Math.min(high,Math.max(a,b));
    }
    if(low<=high)line(add(anchor,mul(direction,low)),add(anchor,mul(direction,high)),major);
  };
  const stride=s*zoom>=2?1:5,step=s*stride;
  if(config.type==='square'){
    if(step*zoom<2)return marks;
    for(let i=Math.ceil(bounds.left/step);i<=Math.floor(bounds.right/step);i++)line({x:i*step,y:bounds.top},{x:i*step,y:bounds.bottom},i*stride%5===0);
    for(let i=Math.ceil(bounds.top/step);i<=Math.floor(bounds.bottom/step);i++)line({x:bounds.left,y:i*step},{x:bounds.right,y:i*step},i*stride%5===0);
  }else if(config.type==='dot'){
    const stride=s*zoom>=6?1:5,step=s*stride;
    if(step*zoom<6||(bounds.right-bounds.left)*(bounds.bottom-bounds.top)/(step*step)>20000)return marks;
    for(let x=Math.ceil(bounds.left/step);x<=Math.floor(bounds.right/step);x++)for(let y=Math.ceil(bounds.top/step);y<=Math.floor(bounds.bottom/step);y++)marks.push({kind:'dot',center:{x:x*step,y:y*step},major:x*stride%5===0&&y*stride%5===0});
  }else if(config.type==='polar'){
    const radius=Math.max(...corners.map(p=>Math.hypot(p.x,p.y)));
    if(step*zoom>=2){
      const dx=Math.max(bounds.left,0,-bounds.right),dy=Math.max(bounds.top,0,-bounds.bottom);
      for(let i=Math.max(1,Math.ceil(Math.hypot(dx,dy)/step));i<=Math.floor(radius/step);i++)marks.push({kind:'circle',center:{x:0,y:0},radius:i*step,major:i*stride%5===0});
    }
    for(let degrees=0;degrees<360;degrees+=config.angle){const a=degrees*Math.PI/180;line({x:0,y:0},{x:radius*Math.cos(a),y:radius*Math.sin(a)},degrees%90===0);}
  }else if(config.type==='hexagonal'){
    if(s*zoom<8||(bounds.right-bounds.left)*(bounds.bottom-bounds.top)/(s*s)>15000)return marks;
    const edges=new Set<string>();
    for(let q=Math.floor(bounds.left/(1.5*s))-1;q<=Math.ceil(bounds.right/(1.5*s))+1;q++){
      for(let r=Math.floor(bounds.top/(root3*s)-q/2)-1;r<=Math.ceil(bounds.bottom/(root3*s)-q/2)+1;r++){
        const c=hexCenter(q,r,s);
        for(let n=0;n<6;n++){
          const a=hexVertex(c,n,s),b=hexVertex(c,n+1,s);
          if(Math.max(a.x,b.x)<bounds.left||Math.min(a.x,b.x)>bounds.right||Math.max(a.y,b.y)<bounds.top||Math.min(a.y,b.y)>bounds.bottom)continue;
          const key=[a,b].map(p=>`${Math.round(p.x/s*1e6)},${Math.round(p.y/s*1e6)}`).sort().join(':');
          if(!edges.has(key)){edges.add(key);line(a,b);}
        }
      }
    }
  }else{
    const [u,v]=basis(config.type,s),coords=corners.map(p=>coordinates(p,u,v));
    if(step*zoom*root3/2<2)return marks;
    for(const family of [0,1,2]){
      const values=coords.map(p=>family===0?p.x:family===1?p.y:p.x+p.y);
      for(let i=Math.ceil(Math.min(...values)/stride);i<=Math.floor(Math.max(...values)/stride);i++){
        const n=i*stride;
        infiniteLine(family===1?mul(v,n):mul(u,n),family===0?v:family===1?u:add(v,mul(u,-1)),n%5===0);
      }
    }
  }
  return marks;
}
