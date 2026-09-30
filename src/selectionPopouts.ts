type Popout={trigger:HTMLButtonElement;panel:HTMLElement};

/** Small top-layer menus stay attached to the movable selection bar without clipping. */
export class SelectionPopouts {
 private readonly entries:Popout[];
 private active:Popout|null=null;
 constructor(private bar:HTMLElement,private beforeOpen:()=>void=()=>{}){
  this.entries=[...bar.querySelectorAll<HTMLButtonElement>('[data-selection-popout]')].map(trigger=>({trigger,panel:bar.querySelector<HTMLElement>(`#${trigger.getAttribute('aria-controls')}`)!}));
  for(const entry of this.entries){
   entry.trigger.onclick=()=>this.active===entry?this.close(true):this.open(entry);
   entry.trigger.addEventListener('keydown',event=>{
    if(['ArrowDown','ArrowUp','Enter',' '].includes(event.key)){event.stopPropagation();if(event.key.startsWith('Arrow')){event.preventDefault();this.open(entry,event.key==='ArrowUp');}}
    if(event.key==='Escape'&&this.active){event.preventDefault();event.stopPropagation();this.close(true);}
   });
   entry.panel.addEventListener('keydown',event=>this.keyDown(event,entry));
   entry.panel.addEventListener('focusout',event=>{
    // During native focus transfer activeElement can briefly be body. Use the
    // destination so clicking the trigger closes once instead of reopening it.
    const next=event.relatedTarget as Node|null;
    if(this.active===entry&&!entry.panel.contains(next)&&next!==entry.trigger)this.close();
   });
  }
  document.addEventListener('pointerdown',event=>{if(this.active&&!this.active.panel.contains(event.target as Node)&&!this.active.trigger.contains(event.target as Node))this.close();},true);
  window.addEventListener('blur',()=>this.close());
  window.addEventListener('resize',()=>this.position());
  window.visualViewport?.addEventListener('resize',()=>this.position());
  window.visualViewport?.addEventListener('scroll',()=>this.position());
  new ResizeObserver(()=>this.position()).observe(bar);
  new MutationObserver(()=>this.refresh()).observe(bar,{attributes:true,attributeFilter:['hidden','style']});
 }
 refresh():void {
  for(const {trigger,panel} of this.entries)trigger.disabled=!panel.querySelector('button:not(:disabled)');
  if(this.active&&(this.bar.hidden||this.active.trigger.disabled||document.querySelector('dialog[open]')))this.close();
  else this.position();
 }
 close(restoreFocus=false):void {
  const entry=this.active;if(!entry)return;this.active=null;
  entry.panel.hidePopover();entry.panel.hidden=true;entry.trigger.setAttribute('aria-expanded','false');
  if(restoreFocus&&!entry.trigger.disabled&&!this.bar.hidden)entry.trigger.focus({preventScroll:true});
 }
 private open(entry:Popout,last=false):void {
  if(entry.trigger.disabled||this.bar.hidden)return;
  this.beforeOpen();this.close();this.active=entry;
  entry.panel.hidden=false;entry.panel.showPopover();entry.trigger.setAttribute('aria-expanded','true');this.position();
  const buttons=this.buttons(entry);(last?buttons.at(-1):buttons[0])?.focus({preventScroll:true});
 }
 private buttons(entry:Popout):HTMLButtonElement[]{return [...entry.panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];}
 private keyDown(event:KeyboardEvent,entry:Popout):void {
  event.stopPropagation();
  if(event.key==='Escape'){event.preventDefault();this.close(true);return;}
  if(event.key==='Tab'){this.close(true);return;}
  const buttons=this.buttons(entry),index=buttons.indexOf(document.activeElement as HTMLButtonElement),columns=Number(entry.panel.dataset.columns??4);
  const delta=({ArrowRight:1,ArrowLeft:-1,ArrowDown:columns,ArrowUp:-columns} as Record<string,number>)[event.key];
  const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:delta!==undefined?(index+delta+buttons.length)%buttons.length:-1;
  if(next>=0){event.preventDefault();buttons[next]?.focus();}
 }
 position():void {
  if(!this.active)return;
  const {panel,trigger}=this.active,viewport=window.visualViewport;
  const left=viewport?.offsetLeft??0,top=viewport?.offsetTop??0,right=left+(viewport?.width??innerWidth),bottom=top+(viewport?.height??innerHeight);
  const bar=this.bar.getBoundingClientRect(),button=trigger.getBoundingClientRect();
  let minY=top+4,maxY=bottom-4;
  if(this.bar.classList.contains('editor-selection-menu')){
   minY=Math.max(minY,(document.querySelector('.document-tabs')??document.querySelector('.top-toolbar'))?.getBoundingClientRect().bottom??minY);
   maxY=Math.min(maxY,document.querySelector('.ruler-bottom')?.getBoundingClientRect().top??maxY);
  }
  panel.style.maxWidth=`${Math.max(0,right-left-8)}px`;panel.style.maxHeight=`${Math.max(0,maxY-minY)}px`;
  const width=panel.offsetWidth,height=panel.offsetHeight;
  const x=Math.max(left+4,Math.min(button.left,right-width-4));
  const y=bar.top-height>=minY?bar.top-height:bar.bottom+height<=maxY?bar.bottom:Math.max(minY,Math.min(bar.top-height,maxY-height));
  panel.style.left=`${x}px`;panel.style.top=`${y}px`;
 }
}
