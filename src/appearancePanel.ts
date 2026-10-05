import {ColourPanel,type Paint} from './colourPanel';
import {ColourPopover} from './colourPopover';
import {defaultGradient,defaultPattern,paintPreview,validateFillPaint,type FillPaint,type GradientPaint,type PatternPaint} from './fillPaint';
type Tab='colour'|'gradient'|'pattern';
const field=(label:string,key:string,value:number,min:number,max:number,step=1)=>`<label class="paint-field">${label}<input data-paint-field="${key}" aria-label="${label}" type="number" value="${value}" min="${min}" max="${max}" step="${step}"></label>`;
const colourField=(label:string,key:string,value:string)=>`<div class="paint-field">${label}<div class="paint-colour-field"><button type="button" class="paint-stop-chip" data-pick-pattern="${key}" style="background:${value}" aria-label="Choose ${label.toLowerCase()}" aria-haspopup="dialog" aria-expanded="false" aria-controls="paint-colour-popover" title="Choose ${label.toLowerCase()}"></button><input data-paint-field="${key}" aria-label="${label}" value="${value}" maxlength="7" spellcheck="false"></div></div>`;
export class AppearancePanel {
 private popover:ColourPopover;private colour:ColourPanel;private active:Tab='colour';private busy=false;
 private solid:Paint={hex:'#FF0000',opacity:1};private gradient=defaultGradient();private pattern=defaultPattern();
 constructor(readonly root:HTMLElement,change:(paint:Paint,commit:boolean)=>void,close:()=>void,noFill:()=>void,private changePaint:(paint:FillPaint,commit:boolean)=>void){
  root.innerHTML=`<div class="layers-header"><div class="layer-heading"><h2 class="panel-title" id="colour-panel-title">Fill &amp; appearance</h2></div><button type="button" class="panel-icon" aria-label="Close Fill &amp; appearance panel" title="Close"><svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-close"/></svg></button></div>
   <div class="appearance-tabs" role="tablist" aria-label="Fill type">${(['colour','gradient','pattern'] as Tab[]).map((tab,i)=>`<button type="button" id="appearance-tab-${tab}" role="tab" aria-controls="appearance-${tab}" aria-selected="${i===0}" tabindex="${i===0?0:-1}" data-appearance-tab="${tab}">${tab[0].toUpperCase()+tab.slice(1)}</button>`).join('')}</div>
   ${(['colour','gradient','pattern'] as Tab[]).map((tab,i)=>`<div id="appearance-${tab}" class="appearance-page" role="tabpanel" aria-labelledby="appearance-tab-${tab}" ${i?'hidden':''}></div>`).join('')}`;
  root.querySelector<HTMLButtonElement>('[aria-label="Close Fill & appearance panel"]')!.onclick=close;
  this.colour=new ColourPanel(root.querySelector('#appearance-colour')!, (paint,commit)=>{this.solid=paint;this.busy=true;try{change(paint,commit);}finally{this.busy=false;}},close,noFill,true);
  this.popover=new ColourPopover(root);
  this.buildGradient();this.buildPattern();
  root.addEventListener('click',event=>{
   const button=(event.target as Element).closest<HTMLButtonElement>('[data-pick-stop],[data-pick-pattern]');if(!button||button.disabled)return;
   if(button.dataset.pickStop!==undefined){
    const index=Number(button.dataset.pickStop),stop=this.gradient.stops[index];
    this.popover.open(button,`Stop ${index+1} colour`,{hex:stop.colour,opacity:stop.opacity},true,(paint,commit)=>{
     stop.colour=paint.hex;stop.opacity=paint.opacity;
     const row=button.closest('[data-stop]')!;button.style.background=paint.hex;button.style.setProperty('--stop-opacity',String(paint.opacity));
     (row.querySelector('[data-stop-colour]') as HTMLInputElement).value=paint.hex;(row.querySelector('[data-stop-opacity]') as HTMLInputElement).value=String(Math.round(paint.opacity*100));
     this.error('gradient','');this.preview('gradient',this.gradient);this.publish(commit);
    });
   }else{
    const key=button.dataset.pickPattern as 'foreground'|'background';
    this.popover.open(button,key==='foreground'?'Foreground colour':'Background colour',{hex:this.pattern[key],opacity:1},false,(paint,commit)=>{
     this.pattern[key]=paint.hex;this.error('pattern','');this.renderPattern();this.publish(commit);
    });
   }
  });
  root.querySelectorAll<HTMLButtonElement>('[data-appearance-tab]').forEach(button=>button.onclick=()=>this.tab(button.dataset.appearanceTab as Tab,true));
  root.querySelector('.appearance-tabs')!.addEventListener('keydown',event=>{const e=event as KeyboardEvent,tabs=['colour','gradient','pattern'] as Tab[],index=tabs.indexOf(this.active),next=e.key==='ArrowRight'?(index+1)%3:e.key==='ArrowLeft'?(index+2)%3:e.key==='Home'?0:e.key==='End'?2:-1;if(next>=0){e.preventDefault();e.stopPropagation();this.tab(tabs[next],true);root.querySelector<HTMLButtonElement>(`[data-appearance-tab="${tabs[next]}"]`)!.focus();}});
  root.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();close();}else if(e.key==='Enter'&&e.target instanceof HTMLInputElement){e.preventDefault();e.target.dispatchEvent(new Event('change',{bubbles:true}));}});
  root.querySelectorAll<HTMLButtonElement>('[data-paint-none]').forEach(b=>b.onclick=noFill);
 }
 private tab(tab:Tab,publish:boolean):void {this.popover.close();this.active=tab;for(const button of this.root.querySelectorAll<HTMLButtonElement>('[data-appearance-tab]')){const active=button.dataset.appearanceTab===tab;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;this.root.querySelector<HTMLElement>(`#appearance-${button.dataset.appearanceTab}`)!.hidden=!active;}if(publish)this.publish(false);}
 private current():FillPaint{return this.active==='colour'?{kind:'colour',colour:this.solid.hex,opacity:this.solid.opacity}:this.active==='gradient'?this.gradient:this.pattern;}
 private publish(commit:boolean):void {this.busy=true;try{this.changePaint(structuredClone(this.current()),commit);}finally{this.busy=false;}}
 private common(kind:'gradient'|'pattern'):string {return `<div class="paint-preview" data-paint-preview="${kind}" aria-label="${kind} preview"></div><p class="paint-error" data-paint-error="${kind}" role="status" hidden></p>`;}
 private footer():string{return '<button type="button" class="button paint-none" data-paint-none aria-pressed="false">No fill</button><p class="subtext colour-hint">New fills always go into Artwork. Changes also update selected filled Artwork; unfilled outlines keep their strokes.</p>';}
 private buildGradient():void {
  const page=this.root.querySelector<HTMLElement>('#appearance-gradient')!;
  page.innerHTML=`<div class="paint-controls">${this.common('gradient')}<label class="paint-field">Type<select data-paint-field="type" aria-label="Gradient type"><option value="linear">Linear</option><option value="radial">Radial</option></select></label><div class="paint-field-row">${field('Gradient angle (°)','angle',0,-360,360)}${field('Gradient opacity (%)','opacity',100,0,100)}</div><div class="paint-section-heading"><span>Colour stops</span><button type="button" class="panel-icon" data-add-stop aria-label="Add gradient stop" title="Add stop"><svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-plus"/></svg></button></div><div class="gradient-stops"></div><p class="subtext colour-hint">Click a colour box to choose a colour, or enter a hex value. Positions run from 0 to 100%.</p>${this.footer()}</div>`;
  page.addEventListener('change',()=>this.readGradient());
  page.querySelector<HTMLButtonElement>('[data-add-stop]')!.onclick=()=>{if(this.gradient.stops.length>=8)return;const stops=this.gradient.stops;let index=0;for(let i=1;i<stops.length-1;i++)if(stops[i+1].offset-stops[i].offset>stops[index+1].offset-stops[index].offset)index=i;const a=stops[index],b=stops[index+1];stops.splice(index+1,0,{colour:a.colour,offset:(a.offset+b.offset)/2,opacity:1});this.renderGradient();this.publish(true);};
  page.addEventListener('click',e=>{const remove=(e.target as Element).closest<HTMLElement>('[data-remove-stop]');if(remove&&this.gradient.stops.length>2){this.gradient.stops.splice(Number(remove.dataset.removeStop),1);this.renderGradient();this.publish(true);}});
  this.renderGradient();
 }
 private readGradient():void {
  const page=this.root.querySelector<HTMLElement>('#appearance-gradient')!,value=(key:string)=>(page.querySelector(`[data-paint-field="${key}"]`) as HTMLInputElement).value;
  try{const stops=[...page.querySelectorAll<HTMLElement>('[data-stop]')].map(row=>({colour:(row.querySelector('[data-stop-colour]') as HTMLInputElement).value,offset:Number((row.querySelector('[data-stop-position]') as HTMLInputElement).value)/100,opacity:Number((row.querySelector('[data-stop-opacity]') as HTMLInputElement).value)/100}));
   if([...page.querySelectorAll<HTMLInputElement>('input')].some(input=>!input.value.trim()||!input.checkValidity()))throw new Error();
   this.gradient=validateFillPaint({kind:'gradient',type:value('type'),angle:Number(value('angle')),opacity:Number(value('opacity'))/100,stops}) as GradientPaint;this.error('gradient','');this.renderGradient();this.publish(true);
  }catch{this.error('gradient','Use valid hex colours and positions/opacity from 0 to 100%.');}
 }
 private renderGradient():void {
  const page=this.root.querySelector<HTMLElement>('#appearance-gradient')!;if(!page.querySelector('.gradient-stops'))return;
  const active=document.activeElement instanceof HTMLInputElement&&page.contains(document.activeElement)?document.activeElement.getAttribute('aria-label'):null;
  (page.querySelector('[data-paint-field="type"]') as HTMLSelectElement).value=this.gradient.type;
  (page.querySelector('[data-paint-field="angle"]') as HTMLInputElement).value=String(this.gradient.angle);
  (page.querySelector('[data-paint-field="angle"]') as HTMLInputElement).disabled=this.gradient.type==='radial';
  (page.querySelector('[data-paint-field="opacity"]') as HTMLInputElement).value=String(Math.round(this.gradient.opacity*100));
  page.querySelector('.gradient-stops')!.innerHTML=this.gradient.stops.map((s,i)=>`<div class="gradient-stop" data-stop="${i}"><button type="button" class="paint-stop-chip" data-pick-stop="${i}" style="background:${s.colour};--stop-opacity:${s.opacity}" aria-label="Choose stop ${i+1} colour" title="Choose stop ${i+1} colour" aria-haspopup="dialog" aria-expanded="false" aria-controls="paint-colour-popover"></button><input data-stop-colour aria-label="Stop ${i+1} colour" value="${s.colour}" maxlength="7" spellcheck="false"><button type="button" class="panel-icon" data-remove-stop="${i}" aria-label="Remove stop ${i+1}" ${this.gradient.stops.length<=2?'disabled':''}><svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-close"/></svg></button><div class="paint-field-row gradient-stop-fields"><label>Position %<input data-stop-position aria-label="Stop ${i+1} position (%)" type="number" min="0" max="100" step=".1" value="${Number((s.offset*100).toFixed(1))}"></label><label>Opacity %<input data-stop-opacity aria-label="Stop ${i+1} opacity (%)" type="number" min="0" max="100" value="${Math.round(s.opacity*100)}"></label></div></div>`).join('');
  if(active)page.querySelector<HTMLInputElement>(`[aria-label="${active}"]`)?.focus({preventScroll:true});
  page.querySelector<HTMLButtonElement>('[data-add-stop]')!.disabled=this.gradient.stops.length>=8;this.preview('gradient',this.gradient);
 }
 private buildPattern():void {
  const page=this.root.querySelector<HTMLElement>('#appearance-pattern')!;
  page.innerHTML=`<div class="paint-controls">${this.common('pattern')}<label class="paint-field">Pattern<select data-paint-field="type" aria-label="Pattern type"><option value="stripes">Stripes</option><option value="crosshatch">Crosshatch</option><option value="dots">Dots</option><option value="checkerboard">Checkerboard</option></select></label>${colourField('Foreground colour','foreground',this.pattern.foreground)}${colourField('Background colour','background',this.pattern.background)}<label class="paint-checkbox"><input data-paint-field="transparent" type="checkbox" checked>Transparent background</label><div class="paint-field-row">${field('Pattern size (mm)','size',5,.5,100,.1)}${field('Pattern angle (°)','angle',45,-360,360)}</div><div class="paint-field-row">${field('Detail (%)','detail',20,5,90)}${field('Pattern opacity (%)','opacity',100,0,100)}</div>${this.footer()}</div>`;
  page.addEventListener('change',()=>{try{const v=(key:string)=>page.querySelector<HTMLInputElement|HTMLSelectElement>(`[data-paint-field="${key}"]`)!;if([...page.querySelectorAll<HTMLInputElement>('input:not([type="checkbox"])')].some(input=>!input.value.trim()||!input.checkValidity()))throw new Error();this.pattern=validateFillPaint({kind:'pattern',type:v('type').value,foreground:v('foreground').value,background:v('background').value,transparent:(v('transparent') as HTMLInputElement).checked,size:Number(v('size').value),angle:Number(v('angle').value),detail:Number(v('detail').value),opacity:Number(v('opacity').value)/100}) as PatternPaint;this.error('pattern','');this.renderPattern();this.publish(true);}catch{this.error('pattern','Check the hex colours and numeric ranges. Pattern size is 0.5–100 mm.');}});
  this.renderPattern();
 }
 private renderPattern():void {const page=this.root.querySelector<HTMLElement>('#appearance-pattern')!;for(const key of ['type','foreground','background','transparent','size','angle','detail','opacity'] as const){const input=page.querySelector<HTMLInputElement|HTMLSelectElement>(`[data-paint-field="${key}"]`);if(!input)continue;if(key==='transparent')(input as HTMLInputElement).checked=this.pattern.transparent;else input.value=String(key==='opacity'?Math.round(this.pattern.opacity*100):this.pattern[key]);}
  page.querySelector<HTMLInputElement>('[data-paint-field="background"]')!.disabled=this.pattern.transparent;page.querySelector<HTMLButtonElement>('[data-pick-pattern="background"]')!.disabled=this.pattern.transparent;page.querySelector<HTMLInputElement>('[data-paint-field="detail"]')!.disabled=this.pattern.type==='checkerboard';for(const key of ['foreground','background'] as const)(page.querySelector(`[data-paint-field="${key}"]`)!.previousElementSibling as HTMLElement).style.background=this.pattern[key];this.preview('pattern',this.pattern);
 }
 private preview(kind:string,paint:FillPaint):void {this.root.querySelector(`[data-paint-preview="${kind}"]`)!.innerHTML=paintPreview(paint);}
 private error(kind:string,message:string):void {const el=this.root.querySelector<HTMLElement>(`[data-paint-error="${kind}"]`)!;el.textContent=message;el.hidden=!message;}
 set(paint:Paint):void {if(this.busy)return;this.solid=paint;this.colour.set(paint);this.tab('colour',false);}
 setAppearance(paint:FillPaint):void {if(this.busy)return;if(paint.kind==='colour'){this.set({hex:paint.colour,opacity:paint.opacity});return;}if(paint.kind==='gradient'){this.gradient=structuredClone(paint);this.renderGradient();}else{this.pattern=structuredClone(paint);this.renderPattern();}this.tab(paint.kind,false);}
 enableSampler(start:(button:HTMLButtonElement,choose:(paint:Paint)=>void)=>void):void {this.colour.enableSampler(start);}
 setNoFill(value:boolean):void {this.colour.setNoFill(value);this.root.querySelectorAll('[data-paint-none]').forEach(b=>b.setAttribute('aria-pressed',String(value)));}
 hint(text:string):void {this.colour.hint(text);}
}
