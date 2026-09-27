/** Preferences navigation with live snapping controls and reserved category panels. */
export class Preferences {
  constructor(private dialog:HTMLDialogElement, private trigger:HTMLButtonElement, beforeOpen:()=>void) {
    const tabs=[...dialog.querySelectorAll<HTMLButtonElement>('[data-pref-tab]')];
    const pages=[...dialog.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
    const content=dialog.querySelector<HTMLElement>('.preferences-content')!;
    const select=(tab:HTMLButtonElement,focus=false)=>{
      for(const item of tabs){const active=item===tab;item.setAttribute('aria-selected',String(active));item.tabIndex=active?0:-1;}
      for(const page of pages)page.hidden=page.id!==tab.getAttribute('aria-controls');
      dialog.querySelector('#preferences-status')!.textContent=tab.dataset.prefTab==='snapping'?'Changes apply immediately.':'Coming soon — settings are placeholders.';
      content.scrollTop=0;if(focus)tab.focus();
    };
    tabs.forEach((tab,index)=>{
      tab.addEventListener('click',()=>select(tab));
      tab.addEventListener('keydown',event=>{
        const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:event.key==='ArrowDown'?(index+1)%tabs.length:event.key==='ArrowUp'?(index+tabs.length-1)%tabs.length:null;
        if(next!==null){event.preventDefault();select(tabs[next],true);}
      });
    });
    // Keep editor shortcuts out of the modal, while preserving native Escape and Tab.
    dialog.addEventListener('keydown',event=>{
      event.stopPropagation();
      if(event.key!=='Tab')return;
      const targets=[...dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]')].filter(element=>element.tabIndex>=0&&!element.matches(':disabled')&&element.getClientRects().length>0);
      const first=targets[0],last=targets[targets.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    });
    dialog.querySelector('form')!.addEventListener('submit',event=>event.preventDefault());
    trigger.addEventListener('click',()=>{
      if(dialog.open)return;
      beforeOpen();dialog.showModal();trigger.classList.add('selected');trigger.setAttribute('aria-expanded','true');
      tabs.find(tab=>tab.getAttribute('aria-selected')==='true')?.focus({preventScroll:true});
    });
    dialog.querySelector<HTMLButtonElement>('#preferences-close')!.onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{trigger.classList.remove('selected');trigger.setAttribute('aria-expanded','false');trigger.focus({preventScroll:true});});
  }
}
