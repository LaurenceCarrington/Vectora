export type AlertKind='success'|'warning'|'error'|'information';
const variants:Record<AlertKind,{title:string;icon:string}>={
  success:{title:'Success',icon:'check'},warning:{title:'Warning',icon:'warning'},
  error:{title:'Error',icon:'error'},information:{title:'Information',icon:'info'}
};

/** Session notification history; newest first, bounded to fifteen messages. */
export class Alerts {
  private panel:HTMLElement;
  private trigger:HTMLButtonElement;
  constructor(private stack:HTMLElement,_fallback:HTMLElement,beforeOpen:()=>void=()=>{}){
    this.panel=stack.closest<HTMLElement>('.notifications-panel')!;
    this.trigger=document.querySelector<HTMLButtonElement>('[data-notifications-trigger]')!;
    this.trigger.addEventListener('click',()=>{
      if(!this.panel.hidden){this.close();return;}
      beforeOpen();this.panel.hidden=false;this.trigger.setAttribute('aria-expanded','true');
      this.position();this.panel.querySelector<HTMLButtonElement>('[data-notifications-close]')!.focus({preventScroll:true});
    });
    this.panel.querySelector('[data-notifications-close]')!.addEventListener('click',()=>this.close(true));
    stack.addEventListener('click',event=>{
      const card=(event.target as Element).closest<HTMLElement>('[data-toast-dismiss]')?.closest<HTMLElement>('[data-toast-kind]');
      if(card){
        const focused=card.contains(document.activeElement);
        const next=(card.nextElementSibling??card.previousElementSibling)?.querySelector<HTMLButtonElement>('button');
        card.remove();this.update();
        if(focused)(next??this.panel.querySelector<HTMLButtonElement>('[data-notifications-close]')!).focus({preventScroll:true});
      }
    });
    this.panel.addEventListener('keydown',event=>{
      event.stopPropagation();
      if(event.key==='Escape'){event.preventDefault();this.close(true);}
    });
    this.trigger.addEventListener('keydown',event=>{if(event.key==='Escape'&&!this.panel.hidden){event.preventDefault();event.stopPropagation();this.close(true);}});
    document.addEventListener('pointerdown',event=>{if(!this.panel.contains(event.target as Node)&&!this.trigger.contains(event.target as Node))this.close();});
    this.panel.addEventListener('focusout',event=>{
      const next=event.relatedTarget as Node|null;
      if(next&&!this.panel.contains(next)&&next!==this.trigger)this.close();
    });
    window.addEventListener('resize',()=>this.position());
    window.addEventListener('scroll',()=>this.position(),true);
    this.update();
  }
  close(restore=false):void {
    this.panel.hidden=true;this.trigger.setAttribute('aria-expanded','false');
    if(restore)this.trigger.focus({preventScroll:true});
  }
  show(message:string,kind:AlertKind='information'):void {
    const variant=variants[kind],card=document.createElement('article');
    card.className=`toast-card toast-${kind}`;card.dataset.toastKind=kind;
    card.setAttribute('aria-label',`${variant.title} notification`);
    card.innerHTML=`<span class="toast-icon"><svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-${variant.icon}"/></svg></span><div class="toast-copy"><h3>${variant.title}</h3><p></p></div><button type="button" class="toast-close" aria-label="Dismiss ${kind} notification" title="Dismiss" data-toast-dismiss><svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-close"/></svg></button>`;
    card.querySelector('p')!.textContent=message;
    this.stack.prepend(card);
    while(this.stack.children.length>15){
      const oldest=this.stack.lastElementChild!;
      if(oldest.contains(document.activeElement))this.panel.querySelector<HTMLButtonElement>('[data-notifications-close]')!.focus({preventScroll:true});
      oldest.remove();
    }
    this.update();
  }
  private update():void {
    const count=this.stack.children.length,badge=this.trigger.querySelector<HTMLElement>('.notification-badge')!;
    badge.textContent=String(count);badge.hidden=count===0;
    this.trigger.title=`Notifications (${count})`;
    this.trigger.setAttribute('aria-description',`${count} stored notification${count===1?'':'s'}`);
    this.panel.querySelector<HTMLElement>('[data-notifications-empty]')!.hidden=count>0;
    this.panel.querySelector<HTMLElement>('[data-notifications-count]')!.textContent=String(count);
    this.position();
  }
  private position():void {
    if(this.panel.hidden)return;
    const rail=this.trigger.closest<HTMLElement>('.toolbar')!.getBoundingClientRect();
    const button=this.trigger.getBoundingClientRect(),top=Math.max(0,rail.top),bottom=Math.min(innerHeight,rail.bottom);
    this.panel.style.maxHeight=`${Math.max(0,bottom-top)}px`;
    this.panel.style.maxWidth=`${Math.max(0,rail.left)}px`;
    this.panel.style.left='0px';this.panel.style.top='0px';
    const size=this.panel.getBoundingClientRect();
    this.panel.style.left=`${Math.max(0,rail.left-size.width)}px`;
    this.panel.style.top=`${Math.max(top,Math.min(button.bottom,bottom)-size.height)}px`;
  }
}
