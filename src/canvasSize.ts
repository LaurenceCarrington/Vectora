export type CanvasUnit='mm'|'cm'|'in';
export type CanvasSize={kind:'infinite'}|{kind:'fixed';width:number;height:number;unit:CanvasUnit};
export const unitScale:Record<CanvasUnit,number>={mm:1,cm:10,in:25.4};
export const MAX_CANVAS_MM=10000;
export function validateCanvasSize(value:unknown):CanvasSize {
 if(value===undefined)return {kind:'infinite'};
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid canvas settings.');
 const v=value as Record<string,unknown>;
 if(v.kind==='infinite')return {kind:'infinite'};
 if(v.kind!=='fixed'||!['mm','cm','in'].includes(v.unit as string)||typeof v.width!=='number'||typeof v.height!=='number'||![v.width,v.height].every(n=>Number.isFinite(n)&&n>=.1&&n<=MAX_CANVAS_MM))throw new Error('Canvas width and height must be between 0.1 and 10,000 mm.');
 return {kind:'fixed',width:v.width,height:v.height,unit:v.unit as CanvasUnit};
}
export const canvasPresets:Array<{id:string;label:string;width:number;height:number;detail:string;group:'workspace'|'machine'|'sticker';unit?:CanvasUnit}>=[
 {id:'infinite',label:'Infinite canvas',width:0,height:0,detail:'No boundary',group:'workspace'},
 {id:'custom',label:'Custom size',width:300,height:200,detail:'Your dimensions',group:'workspace'},
 {id:'laser-compact',label:'300 × 200 mm',width:300,height:200,detail:'Compact laser bed',group:'machine'},
 {id:'laser-desktop',label:'600 × 305 mm',width:600,height:305,detail:'Desktop CO₂ laser',group:'machine'},
 {id:'sheet-small',label:'600 × 400 mm',width:600,height:400,detail:'Medium laser bed',group:'machine'},
 {id:'sheet-large',label:'900 × 600 mm',width:900,height:600,detail:'Large laser bed',group:'machine'},
 {id:'laser-large',label:'1300 × 900 mm',width:1300,height:900,detail:'Large-format laser',group:'machine'},
 {id:'cnc-desktop',label:'300 × 180 mm',width:300,height:180,detail:'Desktop CNC bed',group:'machine'},
 {id:'a4',label:'A4',width:210,height:297,detail:'210 × 297 mm',group:'sticker'},
 {id:'a3',label:'A3',width:297,height:420,detail:'297 × 420 mm',group:'sticker'},
 {id:'letter',label:'US Letter',width:215.9,height:279.4,detail:'8.5 × 11 in',group:'sticker',unit:'in'},
 {id:'tabloid',label:'US Tabloid',width:279.4,height:431.8,detail:'11 × 17 in',group:'sticker',unit:'in'}
];
