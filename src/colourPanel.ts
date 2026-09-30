export interface Paint {hex:string;opacity:number}
export function rgbToHsv(hex:string):[number,number,number] {
 const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255),max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
 const h=!d?0:max===r?((g-b)/d+6)%6:max===g?(b-r)/d+2:(r-g)/d+4;
 return [h*60,max?d/max:0,max];
}
export function hsvToHex(h:number,s:number,v:number):string {
 const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c;
 const rgb=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
 return '#'+rgb.map(n=>Math.round((n+m)*255).toString(16).padStart(2,'0')).join('').toUpperCase();
}
export class ColourPanel {
 private h=0;private s=1;private v=1;private opacity=1;private busy=false;private pointer:number|null=null;private start:Paint|null=null;
 private hex:HTMLInputElement;private hue:HTMLInputElement;private alpha:HTMLInputElement;private percent:HTMLInputElement;private plane:HTMLElement;
 constructor(readonly root:HTMLElement,private change:(paint:Paint,commit:boolean)=>void,private close:()=>void,private noFill:()=>void){
  root.innerHTML=`<div class="layers-header"><div class="layer-heading"><span class="panel-eyebrow">Artwork &amp; fill</span><h2 class="panel-title" id="colour-panel-title">Colour</h2></div><button type="button" class="panel-icon" aria-label="Close Colour panel" title="Close"><svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-close"/></svg></button></div>
  <div class="colour-panel-body">
   <div class="colour-plane" role="group" aria-label="Saturation and brightness" tabindex="0" aria-describedby="colour-plane-help"><span class="colour-cursor"></span></div>
   <p id="colour-plane-help" class="sr-only">Left and right adjust saturation; up and down adjust brightness. Hold Shift for larger steps.</p>
   <div class="colour-track-field"><label for="colour-hue">Hue</label><output data-hue-value></output></div><input id="colour-hue" class="colour-hue" aria-label="Hue" type="range" min="0" max="359" step="1">
   <div class="colour-track-field"><label for="colour-opacity">Opacity</label><div class="colour-percent"><input id="colour-opacity-number" aria-label="Opacity (%)" type="number" min="0" max="100" step="1"><span>%</span></div></div><input id="colour-opacity" class="colour-alpha" aria-label="Opacity" type="range" min="0" max="100" step="1">
   <div class="colour-hex-row"><span class="colour-preview" aria-hidden="true"><span></span></span><label class="sr-only" for="colour-hex">Hex colour</label><input id="colour-hex" type="text" spellcheck="false" maxlength="7" aria-describedby="colour-error"><button type="button" class="panel-icon" data-save-colour aria-label="Save colour swatch" title="Save colour swatch for this session"><svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-plus"/></svg></button></div>
   <p id="colour-error" class="colour-error" role="status" hidden>Enter a hex colour such as #8235DC.</p>
   <div class="colour-rgb">${['R','G','B'].map(c=>`<label>${c}<input type="number" min="0" max="255" step="1" aria-label="${{R:'Red',G:'Green',B:'Blue'}[c]}" data-colour-channel="${c}"></label>`).join('')}</div>
   <div class="colour-swatches" aria-label="Colour presets"><button type="button" class="colour-swatch colour-none" aria-label="No fill" title="No fill"></button>${['#FF0000','#0000FF','#00FFFF','#FF00FF'].map(c=>`<button type="button" class="colour-swatch" data-colour="${c}" style="--swatch:${c}" aria-label="${c}" title="${c}"></button>`).join('')}</div>
   <div class="colour-saved" hidden><p class="subtext">Saved swatches</p><div class="colour-swatches" data-saved-swatches></div></div>
   <p class="subtext colour-hint" data-colour-hint>Sets the Fill tool colour. Selected Artwork uses this colour too.</p>
  </div>`;
  const input=(selector:string)=>root.querySelector<HTMLInputElement>(selector)!;
  this.hex=input('#colour-hex');this.hue=input('#colour-hue');this.alpha=input('#colour-opacity');this.percent=input('#colour-opacity-number');this.plane=root.querySelector('.colour-plane')!;
  root.querySelector<HTMLButtonElement>('[aria-label="Close Colour panel"]')!.onclick=close;
  root.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();this.cancel();close();}if(event.key==='Enter'&&event.target instanceof HTMLInputElement){event.preventDefault();event.target.dispatchEvent(new Event('change',{bubbles:true}));}});
  this.hex.addEventListener('change',()=>{let hex=this.hex.value.trim();if(!hex.startsWith('#'))hex='#'+hex;if(/^#[0-9a-f]{3}$/i.test(hex))hex='#'+hex.slice(1).split('').map(c=>c+c).join('');const valid=/^#[0-9a-f]{6}$/i.test(hex);this.hex.setAttribute('aria-invalid',String(!valid));root.querySelector<HTMLElement>('#colour-error')!.hidden=valid;if(!valid)return;this.set({hex,opacity:this.opacity});this.publish(true);});
  const slider=(el:HTMLInputElement,assign:()=>void)=>{el.addEventListener('input',()=>{assign();this.render();this.publish(false);});el.addEventListener('change',()=>{assign();this.render();this.publish(true);});};
  slider(this.hue,()=>this.h=Number(this.hue.value));slider(this.alpha,()=>this.opacity=Number(this.alpha.value)/100);
  this.percent.addEventListener('change',()=>{if(!this.percent.value||!this.percent.checkValidity()){this.render();return;}this.opacity=Number(this.percent.value)/100;this.render();this.publish(true);});
  root.querySelectorAll<HTMLInputElement>('[data-colour-channel]').forEach(el=>el.addEventListener('change',()=>{if(!el.value||!el.checkValidity()){this.render();return;}const rgb=[...root.querySelectorAll<HTMLInputElement>('[data-colour-channel]')].map(x=>Number(x.value));this.set({hex:'#'+rgb.map(n=>n.toString(16).padStart(2,'0')).join(''),opacity:this.opacity});this.publish(true);}));
  this.plane.addEventListener('pointerdown',event=>{if(event.button!==0||this.pointer!==null)return;event.preventDefault();this.plane.focus();this.pointer=event.pointerId;this.start=this.paint;this.plane.setPointerCapture(event.pointerId);this.position(event);});
  this.plane.addEventListener('pointermove',event=>{if(event.pointerId===this.pointer)this.position(event);});
  this.plane.addEventListener('pointerup',event=>{if(event.pointerId!==this.pointer)return;this.position(event);this.pointer=null;this.start=null;this.publish(true);});
  this.plane.addEventListener('pointercancel',()=>this.cancel());this.plane.addEventListener('lostpointercapture',()=>this.cancel());
  this.plane.addEventListener('keydown',event=>{const step=event.shiftKey?.1:.01;if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();this.s=Math.max(0,Math.min(1,this.s+(event.key==='ArrowRight'?step:event.key==='ArrowLeft'?-step:0)));this.v=Math.max(0,Math.min(1,this.v+(event.key==='ArrowUp'?step:event.key==='ArrowDown'?-step:0)));this.render();this.publish(true);});
  root.querySelector<HTMLButtonElement>('.colour-none')!.onclick=()=>noFill();
  root.addEventListener('click',event=>{const button=(event.target as Element).closest<HTMLButtonElement>('[data-colour]');if(button){this.set({hex:button.dataset.colour!,opacity:Number(button.dataset.opacity??1)});this.publish(true);}});
  root.querySelector<HTMLButtonElement>('[data-save-colour]')!.onclick=()=>{const list=root.querySelector<HTMLElement>('[data-saved-swatches]')!,paint=this.paint;if([...list.children].some(b=>(b as HTMLElement).dataset.colour===paint.hex&&(b as HTMLElement).dataset.opacity===String(paint.opacity)))return;const button=document.createElement('button');button.type='button';button.className='colour-swatch';button.dataset.colour=paint.hex;button.dataset.opacity=String(paint.opacity);button.style.setProperty('--swatch',paint.hex);button.title=`${paint.hex} · ${Math.round(paint.opacity*100)}%`;button.setAttribute('aria-label',button.title);list.append(button);if(list.children.length>12)list.firstElementChild!.remove();root.querySelector<HTMLElement>('.colour-saved')!.hidden=false;};
  this.render();
 }
 setNoFill(value:boolean):void {this.root.querySelector('.colour-none')!.setAttribute('aria-pressed',String(value));}
 private get paint():Paint{return {hex:hsvToHex(this.h,this.s,this.v),opacity:this.opacity};}
 private publish(commit:boolean):void {this.busy=true;try{this.change(this.paint,commit);}finally{this.busy=false;}}
 private cancel():void {if(this.pointer===null)return;this.pointer=null;if(this.start){this.set(this.start);this.publish(false);}this.start=null;}
 private position(event:PointerEvent):void {const rect=this.plane.getBoundingClientRect();this.s=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));this.v=1-Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height));this.render();this.publish(false);}
 set(paint:Paint):void {if(this.busy||this.pointer!==null)return;const [h,s,v]=rgbToHsv(paint.hex);if(s&&v)this.h=h;this.s=s;this.v=v;this.opacity=paint.opacity;this.render();}
 hint(text:string):void {this.root.querySelector<HTMLElement>('[data-colour-hint]')!.textContent=text;}
 private render():void {const paint=this.paint;this.root.style.setProperty('--picker-hue',hsvToHex(this.h,1,1));this.root.style.setProperty('--picker-colour',paint.hex);this.root.style.setProperty('--picker-opacity',String(this.opacity));this.root.style.setProperty('--picker-paint',paint.hex+Math.round(this.opacity*255).toString(16).padStart(2,'0'));this.plane.style.setProperty('--picker-x',`${this.s*100}%`);this.plane.style.setProperty('--picker-y',`${(1-this.v)*100}%`);this.plane.setAttribute('aria-label',`Saturation ${Math.round(this.s*100)}%, brightness ${Math.round(this.v*100)}%`);this.hex.value=paint.hex;this.hue.value=String(Math.round(this.h));this.alpha.value=this.percent.value=String(Math.round(this.opacity*100));this.root.querySelector('output')!.textContent=`${Math.round(this.h)}°`;this.root.querySelectorAll<HTMLInputElement>('[data-colour-channel]').forEach((el,i)=>el.value=String(parseInt(paint.hex.slice(1+i*2,3+i*2),16)));}
}
