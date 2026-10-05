import type {Generated,Part,Point} from './geometry';

type Draft=Omit<Generated,'name'|'bounds'>;
const midpoint=(a:Point,b:Point):Point=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
function distance(p:Point,a:Point,b:Point):number {
 const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
 const t=length?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)):0;
 return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
}
function random(seed:number):()=>number {
 let s=seed|0;return()=>{s=(s+0x6D2B79F5)|0;let t=Math.imul(s^(s>>>15),1|s);t^=t+Math.imul(t^(t>>>7),61|t);return ((t^(t>>>14))>>>0)/4294967296;};
}
/** Build each shared boundary once; adjacent pieces use the same samples in reverse. */
export function jigsaw(id:string,v:Record<string,number>):Draft {
 const {width:w,height:h,columns:cols,rows,tabSize,variation,seed}=v;
 const pieces=id==='jigsaw-pieces',gap=pieces?v.gap:0,dx=w/cols,dy=h/rows;
 if(cols*rows>1000)throw new Error('Limit the puzzle to 1,000 pieces. Reduce rows or columns.');
 if(Math.min(dx,dy)<5)throw new Error('Each piece must be at least 5 mm wide and high. Reduce rows or columns.');
 const rnd=random(seed),depth=tabSize/100*Math.min(dx,dy);
 // Individual outlines duplicate internal samples, so reserve half the output budget.
 const limit=pieces?24000:48000;let samples=0;
 const append=(out:Point[],p:Point)=>{if(++samples>limit)throw new Error('Puzzle is too detailed. Reduce rows, columns, dimensions or tab size.');out.push(p);};
 const cubic=(out:Point[],a:Point,b:Point,c:Point,d:Point,level=0):void=>{
  if(Math.max(distance(b,a,d),distance(c,a,d))<=.015){append(out,d);return;}
  if(level>=14)throw new Error('Puzzle curve exceeds the detail limit. Reduce dimensions or tab size.');
  const ab=midpoint(a,b),bc=midpoint(b,c),cd=midpoint(c,d),abc=midpoint(ab,bc),bcd=midpoint(bc,cd),m=midpoint(abc,bcd);
  cubic(out,a,ab,abc,m,level+1);cubic(out,m,bcd,cd,d,level+1);
 };
 const edge=(a:Point,b:Point,outer:boolean):Point[]=>{
  const out:Point[]=[];append(out,a);
  if(outer){append(out,b);return out;}
  const length=Math.hypot(b[0]-a[0],b[1]-a[1]),ux=(b[0]-a[0])/length,uy=(b[1]-a[1])/length;
  const sign=rnd()<.5?-1:1,d=depth*(1-variation/100*rnd()),centre=length*(.5+(rnd()*2-1)*variation/100*.2);
  const point=(x:number,y:number):Point=>[a[0]+ux*(centre+x*d)-uy*y*d*sign,a[1]+uy*(centre+x*d)+ux*y*d*sign];
  let start=point(-1.35,0);append(out,start);
  const curves=[[-.6,0,-.28,-.1,-.32,.25],[-.36,.6,-.8,.35,-.8,.75],[-.8,1.2,.8,1.2,.8,.75],[.8,.35,.36,.6,.32,.25],[.28,-.1,.6,0,1.35,0]];
  for(const [x1,y1,x2,y2,x3,y3] of curves){const end=point(x3,y3);cubic(out,start,point(x1,y1),point(x2,y2),end);start=end;}
  append(out,b);return out;
 };
 const xs=Array.from({length:cols+1},(_,i)=>w*i/cols),ys=Array.from({length:rows+1},(_,i)=>h*i/rows);
 const horizontal=ys.map((y,row)=>Array.from({length:cols},(_,col)=>edge([xs[col],y],[xs[col+1],y],row===0||row===rows)));
 const vertical=xs.map((x,col)=>Array.from({length:rows},(_,row)=>edge([x,ys[row]],[x,ys[row+1]],col===0||col===cols)));
 const join=(edges:Point[][])=>edges.flatMap((e,i)=>i?e.slice(1):e);
 const parts:Part[]=[],add=(name:string,points:Point[],closed:boolean)=>parts.push({name,contours:[{points,closed}]});
 if(pieces){
  // Conservative tab envelopes make the requested gap a minimum between piece bounds.
  const spacing=gap>0?2*1.2*depth+gap:0;
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
   const points=join([horizontal[row][col],vertical[col+1][row],horizontal[row+1][col].slice().reverse(),vertical[col][row].slice().reverse()]);
   points.pop();add(`Piece ${row+1}, ${col+1}`,points.map(([x,y]):Point=>[x+col*spacing,y+row*spacing]),true);
  }
 }else{
  add('Puzzle perimeter',[[0,0],[w,0],[w,h],[0,h]],true);
  for(let row=1;row<rows;row++)add(`Horizontal cut ${row}`,join(horizontal[row]),false);
  for(let col=1;col<cols;col++)add(`Vertical cut ${col}`,join(vertical[col]),false);
 }
 return {parts,guides:[],metrics:{'Pieces':String(cols*rows),'Assembled size':`${w} × ${h} mm`,'Piece cell':`${Number(dx.toFixed(3))} × ${Number(dy.toFixed(3))} mm`,'Output':pieces?'Individual closed pieces':'Shared cuts once',...(pieces?{'Minimum spacing':`${gap} mm`}:{})},notes:[pieces?(gap?'Pieces are separated without changing their matching outlines.':'Zero spacing assembles the pieces with duplicated shared edges. Choose Cutting layout to cut each edge once.'):'The straight perimeter and each shared internal edge are cut once.','Nominal tab/socket geometry. Apply material-specific kerf compensation in your cutting software.']};
}
