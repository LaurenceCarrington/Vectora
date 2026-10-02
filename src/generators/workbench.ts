import type {PatternImage} from './patterns';
import {validateRasterImage,MAX_RASTER_PIXELS} from '../rasterImage';
import {CATALOG,defaults,type Family,type Values,type Profile} from './catalog';
import {generate,contourSVG,type Generated} from './geometry';
export interface GeneratorHost {destination:(result?:Generated)=>{name:string;error?:string};insert:(result:Generated)=>void;returnFocus:()=>void}
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** Shared editor/reference workbench. Previews never enter the document. */
export class GeneratorWorkbench {
 private dialog=document.createElement('dialog');
 private family:Family='gear';private profile!:Profile;private result?:Generated;private timer?:ReturnType<typeof setTimeout>;
 private image?:PatternImage;private imageRevision=0;
 private saved=new Map<string,Values>();private values:Values={};
 private query<T extends Element=HTMLElement>(selector:string):T{return this.dialog.querySelector<T>(selector)!;}
 constructor(private host:GeneratorHost){
  this.dialog.className='generator-dialog menu-surface';this.dialog.id='generator-dialog';this.dialog.setAttribute('aria-labelledby','generator-title');
  this.dialog.innerHTML=`<header class="generator-header"><div><span class="help-eyebrow">VECTORA / GENERATORS</span><h2 id="generator-title"></h2></div><button class="tool" type="button" aria-label="Close generator" title="Close (Esc)" data-generator-close><svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-close"/></svg></button></header><div class="generator-body"><section class="generator-preview"><div class="generator-preview-heading"><span>Live preview · mm</span><label><input type="checkbox" data-guides checked> Guides</label></div><svg class="generator-svg" role="img" aria-label="Generated profile preview" viewBox="-50 -50 100 100"></svg><div class="generator-legend" hidden><span>Solid · active layer</span><span class="generator-fold-key">Dashed · Engrave Path</span></div><div class="generator-size"></div></section><section class="generator-controls" aria-label="Generator settings"><label class="generator-field">Profile<select data-profile aria-label="Profile"></select></label><p class="generator-description"></p><div class="generator-image" hidden><input type="file" data-pattern-file accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" hidden><button type="button" class="generator-image-pick" data-pattern-pick><canvas width="240" height="100" hidden></canvas><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-image"/></svg><span data-pattern-label>Choose an image</span><small>PNG, JPG, WebP, GIF or BMP · stays on your device</small></button></div><div class="generator-fields"></div><button type="button" class="button" data-new-seed hidden>New seed</button><button type="button" class="button" data-reset>Reset parameters</button><dl class="generator-metrics"></dl><div class="generator-notes"></div></section></div><footer class="generator-footer"><div class="generator-feedback" role="status" aria-live="polite"></div><div class="generator-actions"><button type="button" class="button" data-generator-close>Cancel</button><button type="button" class="button" data-insert>Insert paths</button></div></footer>`;
  document.body.append(this.dialog);
  this.query<HTMLSelectElement>('[data-profile]').onchange=()=>this.choose(this.query<HTMLSelectElement>('[data-profile]').value);
  this.query('[data-pattern-pick]').onclick=()=>this.query<HTMLInputElement>('[data-pattern-file]').click();
  this.query<HTMLInputElement>('[data-pattern-file]').onchange=()=>{const input=this.query<HTMLInputElement>('[data-pattern-file]'),file=input.files?.[0];input.value='';if(file)void this.loadImage(file);};
  this.query('[data-new-seed]').onclick=()=>{this.values.seed=1+Math.floor(Math.random()*2147483646);this.fields();this.render();};
  this.query('[data-reset]').onclick=()=>{this.values=defaults(this.profile);this.saved.set(this.profile.id,this.values);this.fields();this.render();};
  this.query<HTMLInputElement>('[data-guides]').onchange=()=>this.query('.generator-guides')?.classList.toggle('is-hidden',!this.query<HTMLInputElement>('[data-guides]').checked);
  this.dialog.querySelectorAll<HTMLElement>('[data-generator-close]').forEach(b=>b.onclick=()=>this.dialog.close());
  this.query('[data-insert]').onclick=()=>{
   // Revalidate the current values and destination immediately before any document mutation.
   this.render();if(!this.result||this.host.destination(this.result).error)return;
   try{this.host.insert(this.result);this.dialog.close();}catch(error){this.feedback((error as Error).message,true);}
  };
  this.dialog.addEventListener('close',()=>{clearTimeout(this.timer);this.imageRevision++;this.result=undefined;this.host.returnFocus();});
  this.dialog.addEventListener('keydown',event=>{
   event.stopPropagation();if(event.isComposing)return;
   if(event.key==='Escape'){event.preventDefault();this.dialog.close();}
   if(event.key==='Tab'){
    const els=[...this.dialog.querySelectorAll<HTMLElement>('button,input,select')].filter(el=>!el.matches(':disabled')&&el.getClientRects().length),first=els[0],last=els.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
   }
  });
 }
 open(family:Family):void {
  if(document.querySelector('dialog[open]'))return;
  this.family=family;this.query('#generator-title').textContent=CATALOG[family].title;
  this.query<HTMLSelectElement>('[data-profile]').innerHTML=CATALOG[family].profiles.map(p=>`<option value="${p.id}">${escape(p.label)}</option>`).join('');
  this.choose(CATALOG[family].profiles[0].id);this.dialog.showModal();this.query<HTMLSelectElement>('[data-profile]').focus();
 }
 private choose(id:string):void {this.profile=CATALOG[this.family].profiles.find(p=>p.id===id)!;this.values=this.saved.get(id)??defaults(this.profile);this.saved.set(id,this.values);this.query('.generator-description').textContent=this.profile.description;this.query('.generator-image').hidden=this.family!=='halftone';this.fields();this.render();}
 private fields():void {
  this.query('.generator-fields').innerHTML=this.profile.fields.map(f=>f.toggle?`<label class="generator-toggle"><input type="checkbox" data-param="${f.key}" aria-label="${escape(f.label)}" ${this.values[f.key]?'checked':''}>${escape(f.label)}</label>`:`<label class="generator-field">${escape(f.label)}<span class="number-shell"><input class="number-input" type="number" aria-label="${escape(f.label)}" data-param="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" value="${this.values[f.key]}" required><span class="number-unit">${f.unit}</span></span></label>`).join('');
  this.query('[data-new-seed]').hidden=!this.profile.fields.some(f=>f.key==='seed');
  this.dialog.querySelectorAll<HTMLInputElement>('[data-param]').forEach(input=>input.oninput=()=>{
   this.values[input.dataset.param!]=input.type==='checkbox'?Number(input.checked):input.valueAsNumber;this.result=undefined;this.query<HTMLButtonElement>('[data-insert]').disabled=true;
   this.query('.generator-svg').classList.add('is-pending');this.feedback('Updating preview…');clearTimeout(this.timer);this.timer=setTimeout(()=>this.render(),80);
  });
 }
 private async loadImage(file:File):Promise<void> {
  const revision=++this.imageRevision;this.image=undefined;this.query('canvas').hidden=true;this.query('[data-pattern-label]').textContent='Loading image…';this.render();this.feedback('Loading image…');
  let bitmap:ImageBitmap|undefined;
  try {
   if(file.size>20*1024*1024)throw new Error('Choose an image smaller than 20 MB.');
   if(!/\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name))throw new Error('Choose a PNG, JPG, WebP, GIF or BMP image.');
   await validateRasterImage(file);if(revision!==this.imageRevision||!this.dialog.open)return;
   bitmap=await createImageBitmap(file);
   if(revision!==this.imageRevision||!this.dialog.open)return;
   if(bitmap.width*bitmap.height>MAX_RASTER_PIXELS)throw new Error('Choose an image with at most 40 million pixels.');
   const scale=Math.min(1,512/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
   const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);this.image=ctx.getImageData(0,0,canvas.width,canvas.height);
   const thumb=this.query<HTMLCanvasElement>('canvas'),tc=thumb.getContext('2d')!,fit=Math.min(thumb.width/bitmap.width,thumb.height/bitmap.height);tc.clearRect(0,0,thumb.width,thumb.height);tc.drawImage(bitmap,(thumb.width-bitmap.width*fit)/2,(thumb.height-bitmap.height*fit)/2,bitmap.width*fit,bitmap.height*fit);thumb.hidden=false;
   this.query('[data-pattern-label]').textContent=`${file.name} · click to replace`;this.render();
  }catch(error){if(revision!==this.imageRevision||!this.dialog.open)return;this.image=undefined;this.query('[data-pattern-label]').textContent='Choose another image';this.render();this.feedback(error instanceof Error&&error.name!=='InvalidStateError'?error.message:'This image could not be decoded. Choose another file.',true);}
  finally{bitmap?.close();}
 }
 private feedback(message:string,error=false):void {const el=this.query('.generator-feedback');el.textContent=message;el.classList.toggle('is-error',error);}
 private render():void {
  clearTimeout(this.timer);const svg=this.query<SVGSVGElement>('.generator-svg');svg.classList.remove('is-pending');
  this.dialog.querySelectorAll<HTMLInputElement>('[data-param][type=number]').forEach(input=>input.setAttribute('aria-invalid',String(!Number.isFinite(input.valueAsNumber)||input.valueAsNumber<Number(input.min)||input.valueAsNumber>Number(input.max))));
  try{
   this.result=generate(this.family,this.profile.id,this.values,this.image);const r=this.result,b=r.bounds,pad=Math.max(b.width,b.height)*.12+1;
   svg.setAttribute('viewBox',`${b.x-pad} ${b.y-pad} ${b.width+2*pad} ${b.height+2*pad}`);
   const labels=this.family==='box'?r.parts.map(part=>{const points=part.contours.flatMap(c=>'points'in c?c.points:[c.center]);const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);return `<text class="generator-part-label" x="${(Math.min(...xs)+Math.max(...xs))/2}" y="${Math.min(...ys)+(Math.max(...ys)-Math.min(...ys))*(part.name==='Receiver plate'?.28:.5)}" font-size="${Math.max(b.width,b.height)*.025}">${escape(part.name)}</text>`;}).join(''):'';
   svg.innerHTML=`<g class="generator-guides${this.query<HTMLInputElement>('[data-guides]').checked?'':' is-hidden'}">${r.guides.map(contourSVG).join('')}${labels}</g><g class="generator-outlines">${r.parts.map(p=>`<g${p.operation==='engrave'?' class="generator-folds"':''}>${p.contours.map(contourSVG).join('')}</g>`).join('')}</g>`;
   this.query('.generator-legend').hidden=!r.parts.some(p=>p.operation==='engrave');
   this.query('.generator-size').textContent=`${b.width.toFixed(2)} × ${b.height.toFixed(2)} mm · ${r.parts.filter(p=>!p.operation).length} ${r.parts.filter(p=>!p.operation).length===1?'part':'parts'}${r.parts.some(p=>p.operation==='engrave')?' + fold paths':''}`;
   this.query('.generator-metrics').innerHTML=Object.entries(r.metrics).map(([k,v])=>`<div><dt>${escape(k)}</dt><dd>${escape(v)}</dd></div>`).join('');
   this.query('.generator-notes').innerHTML=r.notes.map(n=>`<p>${escape(n)}</p>`).join('');
   const target=this.host.destination(r);this.feedback(target.error??`Insert into ${target.name}${r.parts.some(p=>p.operation==='engrave')?' · folds → Engrave Path':' · editable paths'}`,!!target.error);this.query<HTMLButtonElement>('[data-insert]').disabled=!!target.error;
  }catch(error){this.result=undefined;svg.innerHTML='';this.query('.generator-legend').hidden=true;this.query('.generator-size').textContent='Adjust the parameters to preview';this.query('.generator-metrics').innerHTML='';this.query('.generator-notes').innerHTML='';this.feedback((error as Error).message,true);this.query<HTMLButtonElement>('[data-insert]').disabled=true;}
 }
}
