import {HELP_TOPICS} from './helpContent';

/** Read-only guide shared with the reference, with local search and an accessible topic index. */
export class HelpGuide {
  private dialog=document.createElement('dialog');
  private input:HTMLInputElement;
  private content:HTMLElement;
  private tabs:HTMLButtonElement[];
  private pages:HTMLElement[];
  private status:HTMLElement;
  private empty:HTMLElement;
  private active='start';
  private visible=new Set(HELP_TOPICS.map(topic=>topic.id));
  private searchText:Map<string,string>;
  constructor(private trigger:HTMLButtonElement,private beforeOpen:()=>boolean=()=>true){
    this.dialog.id='help-dialog';this.dialog.className='help-dialog menu-surface';this.dialog.setAttribute('aria-labelledby','help-title');
    this.dialog.innerHTML=`<header class="help-header"><div><span class="help-eyebrow">VECTORA / GUIDE</span><h2 id="help-title">Help &amp; learning</h2></div><label class="search-shell help-search"><svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-search"/></svg><input type="search" class="search-input" aria-label="Search help" placeholder="Search guides, tools, shortcuts…" autocomplete="off" spellcheck="false" aria-controls="help-index"/></label><button type="button" class="tool help-close" aria-label="Close help" title="Close (Esc)"><svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-close"/></svg></button></header><div class="help-body"><nav class="help-sidebar" aria-label="Help index"><p class="help-index-label">CONTENTS</p><div id="help-index" role="tablist" aria-label="Help topics" aria-orientation="vertical">${HELP_TOPICS.map(topic=>`<button type="button" class="help-tab" id="help-tab-${topic.id}" role="tab" aria-controls="help-page-${topic.id}" aria-selected="false" tabindex="-1" data-help-topic="${topic.id}"><svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-${topic.icon}"/></svg><span>${topic.title}</span></button>`).join('')}</div></nav><div class="help-content">${HELP_TOPICS.map((topic,index)=>`<article id="help-page-${topic.id}" class="help-page" role="tabpanel" aria-labelledby="help-tab-${topic.id}" tabindex="0" hidden><div class="help-page-heading"><span class="help-eyebrow">GUIDE ${String(index+1).padStart(2,'0')} / ${HELP_TOPICS.length}</span><h2>${topic.title}</h2><p>${topic.summary}</p></div>${topic.body}</article>`).join('')}<div class="help-empty" hidden><svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-search"/></svg><h3>No matching guides</h3><p>Try “save”, “nodes” or “snapping”.</p><button type="button" class="button" data-help-clear>Clear search</button></div></div></div><footer class="help-footer"><span role="status" aria-live="polite" data-help-status></span><span>Esc to close · F1 for Help</span></footer>`;
    document.body.append(this.dialog);
    this.input=this.dialog.querySelector('input')!;this.content=this.dialog.querySelector('.help-content')!;
    this.tabs=[...this.dialog.querySelectorAll<HTMLButtonElement>('[data-help-topic]')];
    this.pages=[...this.dialog.querySelectorAll<HTMLElement>('.help-page')];
    this.status=this.dialog.querySelector('[data-help-status]')!;this.empty=this.dialog.querySelector('.help-empty')!;
    this.searchText=new Map(HELP_TOPICS.map((topic,index)=>[topic.id,`${topic.title} ${topic.summary} ${topic.keywords??''} ${this.pages[index].textContent}`.toLocaleLowerCase()]));
    this.tabs.forEach(tab=>{
      tab.addEventListener('click',()=>this.select(tab.dataset.helpTopic!));
      tab.addEventListener('keydown',event=>{
        const visibleTabs=this.tabs.filter(item=>!item.hidden),index=visibleTabs.indexOf(tab);
        const next=event.key==='Home'?0:event.key==='End'?visibleTabs.length-1:event.key==='ArrowDown'?(index+1)%visibleTabs.length:event.key==='ArrowUp'?(index+visibleTabs.length-1)%visibleTabs.length:null;
        if(next===null)return;event.preventDefault();const target=visibleTabs[next];this.select(target.dataset.helpTopic!);target.focus({preventScroll:true});target.scrollIntoView({block:'nearest'});
      });
    });
    this.input.addEventListener('input',()=>this.filter());
    this.dialog.querySelector('[data-help-clear]')!.addEventListener('click',()=>{this.input.value='';this.filter();this.input.focus();});
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-help-go]').forEach(button=>button.addEventListener('click',()=>{
      this.input.value='';this.filter();this.select(button.dataset.helpGo!);this.pages.find(page=>!page.hidden)?.focus({preventScroll:true});
    }));
    this.dialog.querySelector('.help-close')!.addEventListener('click',()=>this.dialog.close());
    this.dialog.addEventListener('keydown',event=>{
      // Leave all drawing and document shortcuts outside this read-only modal.
      event.stopPropagation();
      if(event.isComposing)return;
      if(event.key==='Escape'){event.preventDefault();this.dialog.close();}
      if(event.key==='Tab'){
        const targets=[...this.dialog.querySelectorAll<HTMLElement>('button,input,[tabindex]')].filter(el=>el.tabIndex>=0&&!el.matches(':disabled')&&el.getClientRects().length>0);
        const first=targets[0],last=targets[targets.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    });
    this.dialog.addEventListener('close',()=>{trigger.classList.remove('selected');trigger.setAttribute('aria-expanded','false');trigger.focus({preventScroll:true});});
    trigger.addEventListener('click',()=>this.open());
    document.addEventListener('keydown',event=>{
      if(event.key!=='F1'||event.ctrlKey||event.metaKey||event.altKey)return;
      if(document.querySelector('dialog[open]')!==this.dialog&&document.querySelector('dialog[open]'))return;
      event.preventDefault();this.open();
    },true);
    this.filter();
  }
  private open():void {
    if(this.dialog.open||document.querySelector('dialog[open]')||!this.beforeOpen())return;
    this.input.value='';this.filter();this.dialog.showModal();
    this.trigger.classList.add('selected');this.trigger.setAttribute('aria-expanded','true');this.input.focus({preventScroll:true});
    this.tabs.find(tab=>tab.getAttribute('aria-selected')==='true')?.scrollIntoView({block:'nearest'});
  }
  private select(id:string):void {
    this.active=id;
    this.tabs.forEach(tab=>{const selected=tab.dataset.helpTopic===id;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;});
    this.pages.forEach(page=>page.hidden=page.id!==`help-page-${id}`);this.content.scrollTop=0;
  }
  private filter():void {
    const words=this.input.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    this.visible=new Set(HELP_TOPICS.filter(topic=>words.every(word=>this.searchText.get(topic.id)!.includes(word))).map(topic=>topic.id));
    this.tabs.forEach(tab=>tab.hidden=!this.visible.has(tab.dataset.helpTopic!));
    this.select(this.visible.has(this.active)?this.active:[...this.visible][0]??'');
    this.empty.hidden=this.visible.size>0;
    this.status.textContent=words.length?`${this.visible.size} matching guide${this.visible.size===1?'':'s'}`:`${HELP_TOPICS.length} guides · Shortcuts, controls & worked examples`;
  }
}
