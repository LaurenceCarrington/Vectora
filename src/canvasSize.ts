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
export const canvasPresets=[
 {id:'infinite',label:'Infinite canvas',width:0,height:0,detail:'No boundary'},
 {id:'custom',label:'Custom size',width:300,height:200,detail:'Your dimensions'},
 {id:'a5',label:'A5',width:148,height:210,detail:'148 × 210 mm'},
 {id:'a4',label:'A4',width:210,height:297,detail:'210 × 297 mm'},
 {id:'a3',label:'A3',width:297,height:420,detail:'297 × 420 mm'},
 {id:'letter',label:'US Letter',width:215.9,height:279.4,detail:'8.5 × 11 in'},
 {id:'sheet-small',label:'600 × 400 mm',width:600,height:400,detail:'Landscape sheet'},
 {id:'sheet-large',label:'900 × 600 mm',width:900,height:600,detail:'Landscape sheet'}
];
