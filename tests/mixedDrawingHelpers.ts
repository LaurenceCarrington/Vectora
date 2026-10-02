import type {Page} from '@playwright/test';

/** Deterministic, non-overlapping geometry, including real editable glyphs and paint frames. */
export async function mixedDrawing(page:Page,count:number):Promise<void> {
 await page.evaluate(async count=>{
  const e=(window as any).__vectora,p=(window as any).__paper;
  const {loadTextFont,createTextShape}=await import('/src/text.ts');
  const {applyFillPaint,defaultGradient,defaultPattern}=await import('/src/fillPaint.ts');
  await loadTextFont('lato');
  for(let i=0;i<count;i++){
   const x=(i%100)*12,y=Math.floor(i/100)*12;let shape:any;
   switch(i%5){
    case 0:shape=new p.Path.Rectangle({insert:false,rectangle:[x,y,8,8]});break;
    case 1:shape=new p.Path({insert:false,pathData:`M${x} ${y+4} C${x} ${y} ${x+8} ${y} ${x+8} ${y+4} C${x+8} ${y+8} ${x} ${y+8} ${x} ${y+4}`});break;
    case 2:shape=new p.Path.Circle({insert:false,center:[x+4,y+4],radius:4});applyFillPaint(shape,defaultGradient());break;
    case 3:shape=new p.CompoundPath({insert:false,pathData:`M${x} ${y}h8v8h-8z M${x+3} ${y+3}v2h2v-2z`});applyFillPaint(shape,defaultPattern());break;
    default:shape=createTextShape({content:'M5',sizeMM:6,fontId:'lato',transform:[1,0,0,1,x,y]});
   }
   if(i%5<2){shape.strokeColor='#FFFFFF';shape.strokeWidth=1.5;shape.strokeScaling=false;}
   Object.assign(shape.data,{uid:`mixed-${i}`,name:['Rectangle','Curve','Gradient','Pattern','Text'][i%5],role:'artwork'});
   e.artwork.addChild(shape);
  }
  p.view.center=[600,Math.ceil(count/100)*6];p.view.zoom=4;e.setSnappingEnabled(false);e.refreshTheme();
 },count);
}
