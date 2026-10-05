import paper from 'paper';
import {ColourPopover} from '../colourPopover';
import {validateRasterImage,MAX_RASTER_PIXELS} from '../rasterImage';
import type {Shape} from '../types';
import {pageFrame,layoutSheets} from './layout';
import {loadLabelMetrics,prepareSheets,previewSheetSVG} from './paperSheets';
import {DEFAULT_PAGE,type PaintResult,type PageSettings,type RasterSource,type Smoothing} from './types';
interface Host {insert:(sheets:{name:string;items:Shape[]}[])=>void;canInsert:boolean;returnFocus:()=>void}
const field=(key:string,label:string,value:number,min:number,max:number,step:number,unit='')=>`<label class="generator-field">${label}<span class="number-shell"><input class="number-input" data-paint-setting="${key}" aria-label="${label}" type="number" value="${value}" min="${min}" max="${max}" step="${step}" required><span class="number-unit">${unit}</span></span></label>`;
const select=(key:string,label:string,options:[string,string][],value:string)=>`<label class="generator-field">${label}<select data-paint-setting="${key}" aria-label="${label}">${options.map(([id,text])=>`<option value="${id}" ${id===value?'selected':''}>${text}</option>`).join('')}</select></label>`;
/** Dedicated worker-backed generator; previews never mutate the editor. */
export class PaintByNumbersDialog {
 private dialog=document.createElement('dialog');private picker:ColourPopover;
 private source:RasterSource|null=null;private result:PaintResult|null=null;private worker:Worker|null=null;private timer?:ReturnType<typeof setTimeout>;
 private generation=0;private sourceRevision=0;private view:'numbered'|'reference'='numbered';private palette:string[]=[];private readyKey='';private inserting=false;
 private get<T extends HTMLElement=HTMLElement>(selector:string):T{return this.dialog.querySelector<T>(selector)!;}
 constructor(private host:Host){
  this.dialog.id='paint-by-numbers-dialog';this.dialog.className='generator-dialog paint-numbers-dialog menu-surface';this.dialog.setAttribute('aria-labelledby','paint-numbers-title');
  this.dialog.innerHTML=`<header class="generator-header"><div><span class="help-eyebrow">VECTORA / GENERATORS</span><h2 id="paint-numbers-title">Colour by numbers</h2></div><button class="tool" type="button" data-paint-close aria-label="Close colour by numbers"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-close"/></svg></button></header><div class="generator-body"><section class="generator-preview"><div class="paint-view-tabs" role="tablist" aria-label="Sheet preview"><button type="button" role="tab" data-paint-tab="numbered" aria-selected="true" aria-controls="paint-sheet-view">Numbered sheet</button><button type="button" role="tab" data-paint-tab="reference" aria-selected="false" aria-controls="paint-sheet-view" tabindex="-1">Colour reference</button></div><div class="paint-sheet-view" id="paint-sheet-view" data-paint-view role="tabpanel" aria-label="Sheet preview">Choose an image to begin.</div><div class="generator-size" data-paint-size></div></section><section class="generator-controls" aria-label="Colour by numbers settings"><div class="generator-image"><input type="file" data-paint-file accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" hidden><button type="button" class="generator-image-pick" data-paint-pick><canvas width="240" height="100" data-paint-thumbnail hidden></canvas><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-image"/></svg><span data-paint-filename>Choose an image</span><small>Processed locally · PNG, JPG, WebP, GIF or BMP</small></button></div><div class="generator-fields">${field('colours','Colour count',12,2,32,1)}${select('detail','Detail',[['400','Low'],['800','Medium'],['1200','High']],'800')}${select('smoothing','Smoothing',[['off','Off'],['light','Light'],['heavy','Heavy']],'heavy')}${field('cleanup','Small-region cleanup',10,0,10000,1,'mm²')}${field('label','Label size',3,1.5,10,.1,'mm')}${field('weight','Outline weight',.2,.05,2,.05,'mm')}${select('preset','Page size',[['a4','A4'],['a3','A3'],['custom','Custom']],'a4')}${select('orientation','Orientation',[['portrait','Portrait'],['landscape','Landscape']],'portrait')}${field('width','Page width',210,40,2000,1,'mm')}${field('height','Page height',297,40,2000,1,'mm')}${field('margin','Page margin',10,0,200,1,'mm')}</div><label class="generator-toggle"><input type="checkbox" data-paint-reference checked> Include colour reference</label><h3 class="paint-palette-title">Colour key</h3><div class="paint-number-palette" data-paint-palette></div><p class="generator-notes">Click a swatch to edit its colour. Changing generation settings resets palette edits. Sheets insert as editable artwork; export the numbered selection as SVG or PDF.</p></section></div><footer class="generator-footer"><div class="generator-feedback" data-paint-status role="status" aria-live="polite">Choose an image to begin.</div><div class="generator-actions"><button type="button" class="button" data-paint-close>Cancel</button><button type="button" class="button" data-paint-insert disabled>Insert into canvas</button></div></footer>`;
  document.body.append(this.dialog);this.picker=new ColourPopover(this.dialog,'paint-numbers');this.dialog.append(document.getElementById('paint-numbers-colour-popover')!);
  this.get('[data-paint-pick]').onclick=()=>this.get<HTMLInputElement>('[data-paint-file]').click();this.get<HTMLInputElement>('[data-paint-file]').onchange=()=>{const input=this.get<HTMLInputElement>('[data-paint-file]'),file=input.files?.[0];input.value='';if(file)void this.load(file);};
  this.dialog.querySelectorAll<HTMLElement>('[data-paint-close]').forEach(button=>button.onclick=()=>this.dialog.close());
  this.dialog.addEventListener('input',event=>{const input=event.target as HTMLInputElement;if(input.matches('[data-paint-setting]'))this.queue();});
  this.dialog.addEventListener('change',event=>{const input=event.target as HTMLInputElement;if(input.matches('[data-paint-setting]')){if(input.dataset.paintSetting==='orientation'&&this.value('preset')==='custom'){const w=this.number('width'),h=this.number('height');this.control<HTMLInputElement>('width').value=String(h);this.control<HTMLInputElement>('height').value=String(w);}this.dimensions();this.queue();}});
  this.dialog.querySelectorAll<HTMLButtonElement>('[data-paint-tab]').forEach(button=>button.onclick=()=>this.choose(button.dataset.paintTab as typeof this.view));
  this.get('[data-paint-insert]').onclick=()=>void this.insert();
  this.dialog.addEventListener('keydown',event=>{
   event.stopPropagation();if(event.isComposing)return;
   if(event.key==='Escape'){event.preventDefault();const picker=this.get('#paint-numbers-colour-popover');if(!picker.hidden)this.picker.close(true);else this.dialog.close();}
   const tab=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-paint-tab]');if(tab&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();this.choose(event.key==='Home'?'numbered':event.key==='End'?'reference':this.view==='numbered'?'reference':'numbered');this.get<HTMLButtonElement>(`[data-paint-tab="${this.view}"]`).focus();}
   if(event.key==='Tab'){const targets=[...this.dialog.querySelectorAll<HTMLElement>('button,input,select,[tabindex]')].filter(el=>el.tabIndex>=0&&!el.matches(':disabled')&&el.getClientRects().length),first=targets[0],last=targets.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  });
  this.dialog.addEventListener('close',()=>{this.sourceRevision++;this.generation++;clearTimeout(this.timer);this.worker?.terminate();this.worker=null;this.source=null;this.result=null;this.palette=[];this.picker.close();this.host.returnFocus();});
 }
 open():void {
  if(document.querySelector('dialog[open]'))return;this.get<HTMLInputElement>('[data-paint-reference]').checked=true;this.get('[data-paint-filename]').textContent='Choose an image';this.get('canvas').hidden=true;this.view='numbered';this.inserting=false;
  const defaults={colours:12,detail:800,smoothing:'heavy',cleanup:10,label:3,weight:.2,preset:'a4',orientation:'portrait',width:210,height:297,margin:10};for(const [key,value] of Object.entries(defaults))this.control(key).value=String(value);this.dimensions();this.clear('Choose an image to begin.');this.choose('numbered');this.dialog.showModal();this.get('[data-paint-pick]').focus();
 }
 private control<T extends HTMLInputElement|HTMLSelectElement=HTMLInputElement>(key:string):T{return this.get<T>(`[data-paint-setting="${key}"]`);}
 private value(key:string):string{return this.control(key).value;}
 private number(key:string):number{return Number(this.value(key))===0&&this.value(key)===''?NaN:Number(this.value(key));}
 private page():PageSettings{return {preset:this.value('preset') as PageSettings['preset'],orientation:this.value('orientation') as PageSettings['orientation'],widthMM:this.number('width'),heightMM:this.number('height'),marginMM:this.number('margin'),labelSizeMM:this.number('label'),lineWeightMM:this.number('weight')};}
 private key():string{return JSON.stringify([this.sourceRevision,this.value('colours'),this.value('detail'),this.value('smoothing'),this.value('cleanup'),this.page()]);}
 private dimensions():void {const preset=this.value('preset'),landscape=this.value('orientation')==='landscape';for(const key of ['width','height'])this.control(key).disabled=preset!=='custom';if(preset!=='custom'){let w=preset==='a3'?297:210,h=preset==='a3'?420:297;if(landscape)[w,h]=[h,w];this.control('width').value=String(w);this.control('height').value=String(h);}}
 private feedback(message:string,error=false):void{const status=this.get('[data-paint-status]');status.textContent=message;status.classList.toggle('is-error',error);}
 private clear(message:string,error=false):void {this.result=null;this.readyKey='';this.get<HTMLButtonElement>('[data-paint-insert]').disabled=true;this.get('[data-paint-view]').textContent=message;this.get('[data-paint-view]').setAttribute('aria-busy','false');this.get('[data-paint-palette]').replaceChildren();this.get('[data-paint-size]').textContent='';this.feedback(message,error);}
 private async load(file:File):Promise<void>{
  const revision=++this.sourceRevision;this.generation++;clearTimeout(this.timer);this.worker?.terminate();this.source=null;this.picker.close();this.clear('Loading image…');let bitmap:ImageBitmap|undefined;
  try{
   if(!/\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name))throw new Error('Choose a PNG, JPG, WebP, GIF or BMP image.');await validateRasterImage(file);if(revision!==this.sourceRevision||!this.dialog.open)return;
   bitmap=await createImageBitmap(file);if(revision!==this.sourceRevision||!this.dialog.open)return;if(bitmap.width*bitmap.height>MAX_RASTER_PIXELS)throw new Error('Choose an image with at most 40 million pixels.');
   const scale=Math.min(1,1200/Math.max(bitmap.width,bitmap.height)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(bitmap.width*scale));c.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=c.getContext('2d',{willReadFrequently:true})!;ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(bitmap,0,0,c.width,c.height);this.source=ctx.getImageData(0,0,c.width,c.height);
   this.get('[data-paint-filename]').textContent=file.name;this.queue();
  }catch(error){if(revision===this.sourceRevision&&this.dialog.open){this.get('canvas').hidden=true;this.clear(error instanceof Error?error.message:'Could not decode this image.',true);}}
  finally{bitmap?.close();}
 }
 private thumbnail():void {
  if(!this.source)return;const source=this.source,canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(source.data),source.width,source.height),0,0);
  const thumbnail=this.get<HTMLCanvasElement>('[data-paint-thumbnail]'),ctx=thumbnail.getContext('2d')!,fit=Math.min(thumbnail.width/source.width,thumbnail.height/source.height),strength=this.value('smoothing');ctx.clearRect(0,0,thumbnail.width,thumbnail.height);ctx.save();ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.filter=strength==='heavy'?'blur(0.7px)':strength==='light'?'blur(0.3px)':'none';ctx.drawImage(canvas,(thumbnail.width-source.width*fit)/2,(thumbnail.height-source.height*fit)/2,source.width*fit,source.height*fit);ctx.restore();thumbnail.hidden=false;
 }
 private queue():void {
  clearTimeout(this.timer);this.worker?.terminate();this.worker=null;this.result=null;this.readyKey='';this.get<HTMLButtonElement>('[data-paint-insert]').disabled=true;const generation=++this.generation;this.picker.close();if(!this.source)return;this.thumbnail();
  this.get('[data-paint-view]').classList.add('is-pending');this.get('[data-paint-view]').setAttribute('aria-busy','true');this.feedback('Updating preview…');this.timer=setTimeout(()=>void this.process(generation),90);
 }
 private async process(generation:number):Promise<void>{
  try{
   const base=this.source!;const size=this.number('detail');if(![400,800,1200].includes(size))throw new Error('Choose Low, Medium or High detail.');
   const colours=this.number('colours');if(!Number.isInteger(colours)||colours<2||colours>32)throw new Error('Choose 2–32 colours.');const frame=pageFrame(base.width/base.height,1,this.page()),metrics=await loadLabelMetrics();if(generation!==this.generation||!this.dialog.open)return;
   let source=base;if(Math.max(base.width,base.height)>size){const c=document.createElement('canvas'),original=document.createElement('canvas');original.width=base.width;original.height=base.height;original.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(base.data),base.width,base.height),0,0);const scale=size/Math.max(base.width,base.height);c.width=Math.max(1,Math.round(base.width*scale));c.height=Math.max(1,Math.round(base.height*scale));const ctx=c.getContext('2d')!;ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(original,0,0,c.width,c.height);source=c.getContext('2d',{willReadFrequently:true})!.getImageData(0,0,c.width,c.height);}
   const key=this.key(),worker=this.worker=new Worker(new URL('./paint.worker.ts',import.meta.url),{type:'module'});
   worker.onerror=()=>{if(generation===this.generation)this.clear('Could not process this image. Choose lower detail and try again.',true);worker.terminate();};
   worker.onmessage=event=>{
    if(generation!==this.generation||!this.dialog.open||event.data.revision!==generation||event.data.requestId!==generation)return;worker.terminate();this.worker=null;this.get('[data-paint-view]').classList.remove('is-pending');
    if(event.data.error){this.clear(event.data.error,true);return;}this.result=event.data.result;this.palette=[...this.result!.palette];this.readyKey=key;this.renderPalette();this.render();
   };
   worker.postMessage({type:'process',source,settings:{colours,smoothing:this.value('smoothing') as Smoothing,cleanupMM2:this.number('cleanup'),imageWidthMM:frame.image.width,imageHeightMM:frame.image.height,labelSizeMM:this.number('label'),page:this.page(),clearanceMM:Math.max(.2,this.number('weight')/2+.1),metrics},revision:generation,requestId:generation});
  }catch(error){if(generation===this.generation&&this.dialog.open)this.clear((error as Error).message,true);}
 }
 private choose(view:typeof this.view):void {this.view=view;this.dialog.querySelectorAll<HTMLButtonElement>('[data-paint-tab]').forEach(b=>{const active=b.dataset.paintTab===view;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;});this.render();}
 private render():void {
  if(!this.result)return;try{const layout=layoutSheets({...this.result,palette:this.palette},this.page());this.get('[data-paint-view]').innerHTML=previewSheetSVG(layout,this.view);this.get('[data-paint-view]').setAttribute('aria-busy','false');this.get('[data-paint-size]').textContent=`${layout.widthMM} × ${layout.heightMM} mm · ${this.result.regions.length} regions · ${this.palette.length} colours`;
   this.feedback(this.host.canInsert?`${this.result.regions.length} regions · Insert editable artwork, then export the numbered selection.`:'Reference preview · insert paths in the editor.');this.get<HTMLButtonElement>('[data-paint-insert]').disabled=!this.host.canInsert||this.readyKey!==this.key()||this.inserting;
  }catch(error){this.clear((error as Error).message,true);}
 }
 private renderPalette():void {
  const root=this.get('[data-paint-palette]');root.replaceChildren();this.palette.forEach((colour,index)=>{const button=document.createElement('button');button.type='button';button.className='paint-number-swatch';button.setAttribute('aria-label',`Edit colour ${index+1}`);button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');const chip=document.createElement('span');chip.className='paint-number-chip';chip.style.background=colour;chip.setAttribute('aria-hidden','true');const text=document.createElement('span');text.textContent=`${index+1}  ${colour}`;button.append(chip,text);button.onclick=()=>this.picker.open(button,`Colour ${index+1}`,{hex:this.palette[index],opacity:100},false,paint=>{this.palette[index]=paint.hex;chip.style.background=paint.hex;text.textContent=`${index+1}  ${paint.hex}`;this.render();});root.append(button);});
 }
 private async insert():Promise<void>{
  if(!this.result||!this.host.canInsert||this.readyKey!==this.key()||this.inserting)return;const generation=this.generation;this.inserting=true;this.get<HTMLButtonElement>('[data-paint-insert]').disabled=true;let sheets:{name:string;items:Shape[]}[]=[];
  try{const layout=layoutSheets({...this.result,palette:this.palette},this.page());sheets=await prepareSheets(layout,paper.view.center,this.get<HTMLInputElement>('[data-paint-reference]').checked);if(!this.dialog.open||generation!==this.generation||this.readyKey!==this.key()){sheets.forEach(s=>s.items.forEach(i=>i.remove()));return;}this.host.insert(sheets);this.dialog.close();}
  catch(error){sheets.forEach(s=>s.items.forEach(i=>i.remove()));if(this.dialog.open)this.feedback((error as Error).message,true);}
  finally{this.inserting=false;if(this.dialog.open)this.get<HTMLButtonElement>('[data-paint-insert]').disabled=!this.result||!this.host.canInsert||this.readyKey!==this.key();}
 }
}
