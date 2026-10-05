import type {Paint} from './colourPanel';
/** One rendered snapshot per session; hovering reads only one device pixel. */
export class CanvasColourSampler {
 private stopSession:(()=>void)|null=null;
 constructor(private surface:HTMLCanvasElement,private capture:()=>HTMLCanvasElement,private valid:()=>boolean,private error:(error:unknown)=>void=()=>{}){}
 cancel():void {this.stopSession?.();}
 start(button:HTMLButtonElement,choose:(paint:Paint)=>void):void {
  if(this.stopSession){this.cancel();return;}
  let snapshot:HTMLCanvasElement;
  try{snapshot=this.capture();}catch(error){this.error(error);return;}
  const context=snapshot.getContext('2d',{willReadFrequently:true});if(!context){snapshot.width=snapshot.height=0;return;}
  const controller=new AbortController(),signal=controller.signal,cursor=this.surface.style.cursor;
  const hud=document.createElement('div');hud.className='colour-sample-hud';hud.setAttribute('role','status');hud.setAttribute('aria-live','polite');hud.setAttribute('aria-atomic','true');hud.innerHTML='<span class="colour-sample-chip" hidden></span><span data-sample-label>Hover artwork · Arrows move · Enter picks · Esc cancels</span>';document.body.append(hud);
  const label=hud.querySelector<HTMLElement>('[data-sample-label]')!,chip=hud.querySelector<HTMLElement>('.colour-sample-chip')!;
  let paint:Paint|null=null,down:number|null=null,x=0,y=0,frame=0;
  const stop=(focus=false)=>{paint=null;down=null;controller.abort();observer.disconnect();cancelAnimationFrame(frame);hud.remove();snapshot.width=snapshot.height=0;this.surface.style.cursor=cursor;button.setAttribute('aria-pressed','false');this.stopSession=null;if(focus&&button.isConnected)button.focus({preventScroll:true});};
  const observer=new MutationObserver(()=>{if(!this.valid())stop();});observer.observe(button.closest('.colour-panel')??button.parentElement!,{subtree:true,attributes:true,attributeFilter:['hidden','aria-selected']});
  this.stopSession=()=>stop();button.setAttribute('aria-pressed','true');this.surface.style.cursor='crosshair';
  const sample=()=>{
   cancelAnimationFrame(frame);frame=0;if(!this.valid()){stop();return;}
   const rect=this.surface.getBoundingClientRect(),px=Math.floor((x-rect.left)*snapshot.width/rect.width),py=Math.floor((y-rect.top)*snapshot.height/rect.height);
   paint=null;
   try{if(px>=0&&py>=0&&px<snapshot.width&&py<snapshot.height){const [r,g,b,a]=context.getImageData(px,py,1,1).data;if(a)paint={hex:'#'+[r,g,b].map(n=>n.toString(16).padStart(2,'0')).join('').toUpperCase(),opacity:a/255};}}catch(error){stop(true);this.error(error);return;}
   chip.hidden=!paint;if(paint){chip.style.background=paint.hex;chip.style.opacity=String(paint.opacity);}
   const text=paint?`${paint.hex} · ${Math.round(paint.opacity*100)}% · Click or Enter to pick`:'Hover artwork · Arrows move · Enter picks · Esc cancels';if(label.textContent!==text)label.textContent=text;hud.hidden=false;
   const box=hud.getBoundingClientRect();hud.style.left=`${Math.max(8,Math.min(x+18,innerWidth-box.width-8))}px`;hud.style.top=`${Math.max(8,Math.min(y+18,innerHeight-box.height-8))}px`;
  };
  const point=(event:PointerEvent)=>{x=event.clientX;y=event.clientY;};
  const consume=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();};
  window.addEventListener('pointermove',event=>{if(event.target!==this.surface){cancelAnimationFrame(frame);frame=0;paint=null;hud.hidden=true;return;}consume(event);point(event);if(!frame)frame=requestAnimationFrame(sample);},{capture:true,signal});
  window.addEventListener('pointerdown',event=>{if(event.target!==this.surface){if(event.target instanceof Node&&button.contains(event.target))return;stop();return;}consume(event);point(event);sample();if(event.button===0)down=event.pointerId;},{capture:true,signal});
  window.addEventListener('pointerup',event=>{if(event.target!==this.surface){if(down!==null){consume(event);stop(true);}return;}consume(event);if(event.pointerId!==down)return;down=null;point(event);sample();if(paint){const picked=paint;stop(true);choose(picked);}},{capture:true,signal});
  window.addEventListener('keyup',consume,{capture:true,signal});
  window.addEventListener('contextmenu',consume,{capture:true,signal});
  window.addEventListener('wheel',event=>{stop();},{capture:true,signal,passive:true});
  window.addEventListener('keydown',event=>{
   if(event.key==='Tab'){stop();return;}consume(event);
   if(event.key==='Escape'){stop(true);return;}
   if(event.key==='Enter'&&paint){const picked=paint;stop(true);choose(picked);return;}
   if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){const step=event.shiftKey?10:1;x+=event.key==='ArrowRight'?step:event.key==='ArrowLeft'?-step:0;y+=event.key==='ArrowDown'?step:event.key==='ArrowUp'?-step:0;sample();}
  },{capture:true,signal});
  for(const name of ['resize','blur','pointercancel','scroll'])window.addEventListener(name,()=>stop(),{capture:true,signal});
  const rect=this.surface.getBoundingClientRect();x=rect.left+rect.width/2;y=rect.top+rect.height/2;sample();
 }
}
