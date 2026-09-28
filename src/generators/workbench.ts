import {CATALOG,defaults,type Family,type Values,type Profile} from './catalog';
import {generate,contourSVG,type Generated} from './geometry';
export interface GeneratorHost {destination:()=>{name:string;error?:string};insert:(result:Generated)=>void;returnFocus:()=>void}
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** Shared editor/reference workbench. Previews never enter the document. */
export class GeneratorWorkbench {
 private dialog=document.createElement('dialog');
 private family:Family='gear';private profile!:Profile;private result?:Generated;private timer?:ReturnType<typeof setTimeout>;
 private saved=new Map<string,Values>();private values:Values={};
 private query<T extends Element=HTMLElement>(selector:string):T{return this.dialog.querySelector<T>(selector)!;}
 constructor(private host:GeneratorHost){
  this.dialog.className='generator-dialog menu-surface';this.dialog.id='generator-dialog';this.dialog.setAttribute('aria-labelledby','generator-title');
  this.dialog.innerHTML=`<header class="generator-header"><div><span class="help-eyebrow">VECTORA / GENERATORS</span><h2 id="generator-title"></h2></div><button class="tool" type="button" aria-label="Close generator" title="Close (Esc)" data-generator-close><svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-close"/></svg></button></header><div class="generator-body"><section class="generator-preview"><div class="generator-preview-heading"><span>Live preview · mm</span><label><input type="checkbox" data-guides checked> Guides</label></div><svg class="generator-svg" role="img" aria-label="Generated profile preview" viewBox="-50 -50 100 100"></svg><div class="generator-size"></div></section><section class="generator-controls" aria-label="Generator settings"><label class="generator-field">Profile<select data-profile aria-label="Profile"></select></label><p class="generator-description"></p><div class="generator-fields"></div><button type="button" class="button" data-reset>Reset parameters</button><dl class="generator-metrics"></dl><div class="generator-notes"></div></section></div><footer class="generator-footer"><div class="generator-feedback" role="status" aria-live="polite"></div><div class="generator-actions"><button type="button" class="button" data-generator-close>Cancel</button><button type="button" class="button" data-insert>Insert paths</button></div></footer>`;
  document.body.append(this.dialog);
  this.query<HTMLSelectElement>('[data-profile]').onchange=()=>this.choose(this.query<HTMLSelectElement>('[data-profile]').value);
  this.query('[data-reset]').onclick=()=>{this.values=defaults(this.profile);this.saved.set(this.profile.id,this.values);this.fields();this.render();};
  this.query<HTMLInputElement>('[data-guides]').onchange=()=>this.query('.generator-guides')?.classList.toggle('is-hidden',!this.query<HTMLInputElement>('[data-guides]').checked);
  this.dialog.querySelectorAll<HTMLElement>('[data-generator-close]').forEach(b=>b.onclick=()=>this.dialog.close());
  this.query('[data-insert]').onclick=()=>{
   // Revalidate the current values and destination immediately before any document mutation.
   this.render();if(!this.result||this.host.destination().error)return;
   try{this.host.insert(this.result);this.dialog.close();}catch(error){this.feedback((error as Error).message,true);}
  };
  this.dialog.addEventListener('close',()=>{clearTimeout(this.timer);this.result=undefined;this.host.returnFocus();});
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
 private choose(id:string):void {this.profile=CATALOG[this.family].profiles.find(p=>p.id===id)!;this.values=this.saved.get(id)??defaults(this.profile);this.saved.set(id,this.values);this.query('.generator-description').textContent=this.profile.description;this.fields();this.render();}
 private fields():void {
  this.query('.generator-fields').innerHTML=this.profile.fields.map(f=>`<label class="generator-field">${escape(f.label)}<span class="number-shell"><input class="number-input" type="number" aria-label="${escape(f.label)}" data-param="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" value="${this.values[f.key]}" required><span class="number-unit">${f.unit}</span></span></label>`).join('');
  this.dialog.querySelectorAll<HTMLInputElement>('[data-param]').forEach(input=>input.oninput=()=>{
   this.values[input.dataset.param!]=input.valueAsNumber;this.result=undefined;this.query<HTMLButtonElement>('[data-insert]').disabled=true;
   this.query('.generator-svg').classList.add('is-pending');this.feedback('Updating preview…');clearTimeout(this.timer);this.timer=setTimeout(()=>this.render(),80);
  });
 }
 private feedback(message:string,error=false):void {const el=this.query('.generator-feedback');el.textContent=message;el.classList.toggle('is-error',error);}
 private render():void {
  clearTimeout(this.timer);const svg=this.query<SVGSVGElement>('.generator-svg');svg.classList.remove('is-pending');
  this.dialog.querySelectorAll<HTMLInputElement>('[data-param]').forEach(input=>input.setAttribute('aria-invalid',String(!Number.isFinite(input.valueAsNumber)||input.valueAsNumber<Number(input.min)||input.valueAsNumber>Number(input.max))));
  try{
   this.result=generate(this.family,this.profile.id,this.values);const r=this.result,b=r.bounds,pad=Math.max(b.width,b.height)*.12+1;
   svg.setAttribute('viewBox',`${b.x-pad} ${b.y-pad} ${b.width+2*pad} ${b.height+2*pad}`);
   svg.innerHTML=`<g class="generator-guides${this.query<HTMLInputElement>('[data-guides]').checked?'':' is-hidden'}">${r.guides.map(contourSVG).join('')}</g><g class="generator-outlines">${r.parts.flatMap(p=>p.contours.map(contourSVG)).join('')}</g>`;
   this.query('.generator-size').textContent=`${b.width.toFixed(2)} × ${b.height.toFixed(2)} mm · ${r.parts.length} ${r.parts.length===1?'part':'parts'}`;
   this.query('.generator-metrics').innerHTML=Object.entries(r.metrics).map(([k,v])=>`<div><dt>${escape(k)}</dt><dd>${escape(v)}</dd></div>`).join('');
   this.query('.generator-notes').innerHTML=r.notes.map(n=>`<p>${escape(n)}</p>`).join('');
   const target=this.host.destination();this.feedback(target.error??`Insert into ${target.name} · editable outlines`,!!target.error);this.query<HTMLButtonElement>('[data-insert]').disabled=!!target.error;
  }catch(error){this.result=undefined;svg.innerHTML='';this.query('.generator-size').textContent='Adjust the parameters to preview';this.query('.generator-metrics').innerHTML='';this.query('.generator-notes').innerHTML='';this.feedback((error as Error).message,true);this.query<HTMLButtonElement>('[data-insert]').disabled=true;}
 }
}
