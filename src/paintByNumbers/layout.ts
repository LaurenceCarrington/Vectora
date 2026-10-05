import {DEFAULT_PAGE,type PaintResult,type PageSettings,type SheetItem,type SheetLayout,type Point} from './types';
export {DEFAULT_PAGE};
export function pageFrame(aspect:number,colours:number,s:PageSettings){
 let widthMM=s.preset==='a4'?210:s.preset==='a3'?297:s.widthMM,heightMM=s.preset==='a4'?297:s.preset==='a3'?420:s.heightMM;
 if(s.preset!=='custom'&&s.orientation==='landscape')[widthMM,heightMM]=[heightMM,widthMM];
 if(!['a4','a3','custom'].includes(s.preset)||!['portrait','landscape'].includes(s.orientation)||![aspect,widthMM,heightMM,s.marginMM,s.labelSizeMM,s.lineWeightMM].every(Number.isFinite)||aspect<=0||widthMM<40||widthMM>2000||heightMM<40||heightMM>2000||s.marginMM<0||s.labelSizeMM<1.5||s.labelSizeMM>10||s.lineWeightMM<.05||s.lineWeightMM>2||!Number.isInteger(colours)||colours<1||colours>32)throw new Error('Check page dimensions, margin, label size and outline weight.');
 const keyRow=Math.max(8,s.labelSizeMM*1.8),keyHeight=12+Math.ceil(colours/3)*keyRow,availableW=widthMM-2*s.marginMM,availableH=heightMM-2*s.marginMM-keyHeight-8;
 if(availableW<40||availableH<20||availableW/3<12*s.labelSizeMM)throw new Error('The page is too small for the picture and colour key. Increase its size or reduce margins/label size.');
 const width=Math.min(availableW,availableH*aspect),height=width/aspect;
 return {widthMM,heightMM,image:{x:(widthMM-width)/2,y:s.marginMM+(availableH-height)/2,width,height},keyY:s.marginMM+availableH+8,keyRow};
}
export function layoutSheets(result:PaintResult,s:PageSettings):SheetLayout {
 const f=pageFrame(result.width/result.height,result.palette.length,s),numbered:SheetItem[]=[],reference:SheetItem[]=[];
 const path=(name:string,contours:Point[][],fill:string|null,stroke:string|null):SheetItem=>({kind:'path',name,contours,fill,stroke,weightMM:s.lineWeightMM});
 const rectangle=(x:number,y:number,w:number,h:number):Point[][]=>[[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]];
 const page=()=>path('White page',rectangle(0,0,f.widthMM,f.heightMM),'#FFFFFF',null);numbered.push(page());reference.push(page());
 const sx=f.image.width/result.width,sy=f.image.height/result.height;
 for(const region of result.regions){const contours=region.contours.map(c=>c.map(([x,y]):Point=>[f.image.x+x*sx,f.image.y+y*sy]));numbered.push(path(`Region ${region.id+1} · Colour ${region.paletteIndex+1}`,contours,null,'#000000'));numbered.push({kind:'text',name:`Number ${region.paletteIndex+1}`,content:String(region.paletteIndex+1),x:f.image.x+region.label[0]*sx,y:f.image.y+region.label[1]*sy,sizeMM:s.labelSizeMM,colour:'#000000'});reference.push(path(`Colour ${region.paletteIndex+1} · Region ${region.id+1}`,contours,result.palette[region.paletteIndex],null));}
 for(const sheet of [numbered,reference]){
  sheet.push({kind:'text',content:'Colour key',name:'Colour key',x:f.widthMM/2,y:f.keyY+3,sizeMM:Math.max(3,s.labelSizeMM),colour:'#000000'});
  const column=(f.widthMM-2*s.marginMM)/3;
  result.palette.forEach((colour,i)=>{const x=s.marginMM+i%3*column+2,y=f.keyY+12+Math.floor(i/3)*f.keyRow,swatch=Math.min(5,f.keyRow-2);sheet.push(path(`Swatch ${i+1}`,rectangle(x,y,swatch,swatch),colour,null),path(`Swatch border ${i+1}`,rectangle(x,y,swatch,swatch),null,'#000000'));sheet.push({kind:'text',name:`Key ${i+1}`,content:`${i+1}  ${colour}`,x:x+swatch+(column-swatch-4)/2,y:y+swatch/2,sizeMM:s.labelSizeMM,colour:'#000000'});});
 }
 return {widthMM:f.widthMM,heightMM:f.heightMM,numbered,reference};
}
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function sheetSVG(layout:SheetLayout,view:'numbered'|'reference'):string {
 const items=layout[view];return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.widthMM}mm" height="${layout.heightMM}mm" viewBox="0 0 ${layout.widthMM} ${layout.heightMM}">${items.map(item=>item.kind==='path'?`<path d="${item.contours.map(c=>'M'+c.map(p=>p.join(' ')).join('L')+'Z').join(' ')}" fill="${item.fill??'none'}" fill-rule="evenodd" stroke="${item.stroke??'none'}" stroke-width="${item.weightMM}" stroke-linejoin="round"/>`:`<text x="${item.x}" y="${item.y}" text-anchor="middle" dominant-baseline="central" font-family="Lato, sans-serif" font-size="${item.sizeMM}" fill="${item.colour}">${escape(item.content)}</text>`).join('')}</svg>`;
}
