export type AlertKind='success'|'warning'|'error'|'information';
const variants:Record<AlertKind,{title:string;icon:string}>={success:{title:'Success',icon:'check'},warning:{title:'Warning',icon:'warning'},error:{title:'Error',icon:'error'},information:{title:'Information',icon:'info'}};

/** Corner alerts dismiss five seconds after their latest update. */
export class Alerts {
  private announcementCount=0;
  private timers=new WeakMap<HTMLElement,ReturnType<typeof setTimeout>>();
  private exitTimers=new WeakMap<HTMLElement,ReturnType<typeof setTimeout>>();
  private returnFocus=new WeakMap<HTMLElement,HTMLElement>();
  constructor(private stack:HTMLElement,private fallback:HTMLElement){
    stack.addEventListener('click',event=>{
      const button=(event.target as Element).closest('[data-toast-dismiss]');
      if(button)this.dismiss(button.closest<HTMLElement>('[data-toast-kind]')!);
    });
    stack.addEventListener('keydown',event=>{
      event.stopPropagation();
      if(event.key==='Escape'){
        const card=(event.target as Element).closest<HTMLElement>('[data-toast-kind]');
        if(card){event.preventDefault();this.dismiss(card);}
      }
    });
  }
  show(message:string,kind:AlertKind='information'):void {
    const variant=variants[kind];let card=this.stack.querySelector<HTMLElement>(`[data-toast-kind="${kind}"]`);
    if(!card){
      card=document.createElement('article');card.className=`toast-card toast-${kind}`;card.dataset.toastKind=kind;card.setAttribute('aria-label',`${variant.title} alert`);
      card.innerHTML=`<span class="toast-icon"><svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-${variant.icon}"/></svg></span><div class="toast-copy"><h3>${variant.title}</h3><p></p></div><button type="button" class="toast-close" aria-label="Dismiss ${kind} alert" title="Dismiss" data-toast-dismiss><svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-close"/></svg></button>`;
    }
    clearTimeout(this.exitTimers.get(card));this.exitTimers.delete(card);
    card.classList.remove('is-leaving');card.inert=false;card.removeAttribute('aria-hidden');
    const focused=document.activeElement instanceof HTMLElement?document.activeElement:null,keepFocus=focused&&card.contains(focused);
    if(focused&&!this.stack.contains(focused))this.returnFocus.set(card,focused);
    card.querySelector('p')!.textContent=message;this.stack.append(card);
    // Transformed bounds include the entrance slide and would scroll a fitting stack by 8px.
    this.stack.scrollTop=Math.max(0,card.offsetTop+card.offsetHeight+parseFloat(getComputedStyle(this.stack).paddingBottom)-this.stack.clientHeight);
    if(keepFocus)focused.focus({preventScroll:true});
    clearTimeout(this.timers.get(card));
    this.timers.set(card,setTimeout(()=>this.dismiss(card!),5000));
    document.getElementById(kind==='error'?'toast-error-announcement':'toast-announcement')!.textContent=`${variant.title} ${++this.announcementCount}. ${message}`;
  }
  private dismiss(card:HTMLElement):void {
    if(this.exitTimers.has(card)||!card.isConnected)return;
    clearTimeout(this.timers.get(card));this.timers.delete(card);
    const restore=card.contains(document.activeElement),origin=this.returnFocus.get(card);
    if(restore){
      const available=origin?.isConnected&&origin.getClientRects().length&&!origin.matches(':disabled');
      (available?origin:this.fallback)!.focus({preventScroll:true});
    }
    if(matchMedia('(prefers-reduced-motion: reduce)').matches){card.remove();return;}
    card.inert=true;card.setAttribute('aria-hidden','true');card.classList.add('is-leaving');
    const duration=parseFloat(getComputedStyle(card).getPropertyValue('--alert-exit-duration'))||180;
    this.exitTimers.set(card,setTimeout(()=>{card.remove();this.exitTimers.delete(card);},duration));
  }
}
