export interface DocumentTabLabel {id:string;filename:string;dirty:boolean}

/** Shared tab strip. DocumentFiles owns the drawings and save lifecycle. */
export class DocumentTabs {
 private list:HTMLElement;
 private add:HTMLButtonElement;
 private activeId='';
 private items=new Map<string,HTMLElement>();
 constructor(private root:HTMLElement,private actions:{select:(id:string)=>Promise<void>;close:(id:string)=>Promise<void>;create:()=>Promise<void>}){
  this.list=root.querySelector('[role="tablist"]')!;
  this.add=root.querySelector('[data-document-new]')!;
  this.add.onclick=()=>{void actions.create();};
  this.list.addEventListener('wheel',event=>{if(this.list.scrollWidth<=this.list.clientWidth||Math.abs(event.deltaX)>Math.abs(event.deltaY))return;event.preventDefault();this.list.scrollLeft+=event.deltaY;},{passive:false});
  new ResizeObserver(()=>this.revealActive()).observe(this.list);
  root.addEventListener('keydown',event=>{
   if(['Enter',' ','Delete','Backspace'].includes(event.key))event.stopPropagation();
   const button=(event.target as Element).closest<HTMLButtonElement>('[role="tab"]');if(!button)return;
   const tabs=[...this.list.querySelectorAll<HTMLButtonElement>('[role="tab"]')],index=tabs.indexOf(button);
   const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='ArrowRight'?(index+1)%tabs.length:undefined;
   if(next===undefined)return;event.preventDefault();event.stopPropagation();
   void actions.select(tabs[next].dataset.documentId!).then(()=>this.items.get(this.activeId)?.querySelector<HTMLButtonElement>('[role="tab"]')?.focus({preventScroll:true}));
  });
 }
 private revealActive():void {
  const active=this.items.get(this.activeId);if(!active)return;
  const left=active.offsetLeft,right=left+active.offsetWidth;
  if(left<this.list.scrollLeft)this.list.scrollLeft=left;else if(right>this.list.scrollLeft+this.list.clientWidth)this.list.scrollLeft=right-this.list.clientWidth;
 }
 render(tabs:DocumentTabLabel[],activeId:string,busy=false):void {
  const changed=this.activeId!==activeId;this.activeId=activeId;
  const focused=document.activeElement,hadFocus=!!focused&&this.list.contains(focused);
  for(const [id,item] of this.items)if(!tabs.some(tab=>tab.id===id)){item.remove();this.items.delete(id);}
  for(const tab of tabs){
   let item=this.items.get(tab.id);
   if(!item){
    item=document.createElement('div');item.className='document-tab';item.setAttribute('role','presentation');
    item.innerHTML='<button type="button" class="document-tab-select" role="tab"><span class="document-tab-name"></span><span class="document-tab-dirty" aria-hidden="true" hidden></span></button><button type="button" class="document-tab-close"><svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-close"/></svg></button>';
    const select=item.querySelector<HTMLButtonElement>('[role="tab"]')!;select.id=`document-tab-${tab.id}`;select.dataset.documentId=tab.id;if(document.getElementById('cad-canvas'))select.setAttribute('aria-controls','cad-canvas');
    select.onclick=()=>{void this.actions.select(tab.id).then(()=>this.items.get(this.activeId)?.querySelector<HTMLButtonElement>('[role="tab"]')?.focus({preventScroll:true}));};item.querySelector<HTMLButtonElement>('.document-tab-close')!.onclick=()=>{void this.actions.close(tab.id);};
    this.items.set(tab.id,item);this.list.append(item);
   }
   const selected=tab.id===activeId,select=item.querySelector<HTMLButtonElement>('[role="tab"]')!,close=item.querySelector<HTMLButtonElement>('.document-tab-close')!;
   item.classList.toggle('is-active',selected);select.setAttribute('aria-selected',String(selected));select.tabIndex=selected?0:-1;select.disabled=busy;
   select.setAttribute('aria-label',tab.filename+(tab.dirty?', unsaved changes':''));select.title=tab.filename+(tab.dirty?' · Unsaved changes':'');
   item.querySelector('.document-tab-name')!.textContent=tab.filename;item.querySelector<HTMLElement>('.document-tab-dirty')!.hidden=!tab.dirty;
   close.setAttribute('aria-label',`Close ${tab.filename}`);close.title=`Close ${tab.filename}`;close.disabled=busy;
  }
  this.add.disabled=busy;this.root.setAttribute('aria-busy',String(busy));
  document.getElementById('cad-canvas')?.setAttribute('aria-labelledby',`document-tab-${activeId}`);
  const active=this.items.get(activeId);
  if(changed)this.revealActive();
  if(hadFocus&&focused&&!focused.isConnected)active?.querySelector<HTMLButtonElement>('[role="tab"]')?.focus({preventScroll:true});
 }
}
