export interface SearchTool {
  id:string;label:string;group:string;keywords?:string;icon:string;shortcut?:string;
  unavailable?:()=>string|undefined;
  run:()=>void;
}

/** Search the live editor commands while leaving their existing validation and actions in charge. */
export class ToolSearch {
  private dialog=document.createElement('dialog');
  private input:HTMLInputElement;
  private results:HTMLElement;
  private status:HTMLElement;
  private matches:SearchTool[]=[];
  private active=0;
  private restoreFocus=true;
  constructor(private trigger:HTMLButtonElement,private tools:SearchTool[],private beforeOpen:()=>boolean,private onError:(message:string)=>void){
    this.dialog.id='tool-search-dialog';this.dialog.className='tool-search-dialog menu-surface';this.dialog.setAttribute('aria-label','Search tools');
    this.dialog.innerHTML='<div class="tool-search-header"><div class="search-shell"><svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-search"/></svg><input class="search-input" type="search" aria-label="Search tools" placeholder="Search tools…" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="tool-search-results" aria-describedby="tool-search-status"></div><button type="button" class="tool tool-search-close" aria-label="Close tool search" title="Close (Esc)"><svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-close"/></svg></button></div><div class="tool-search-results" id="tool-search-results" role="listbox" aria-label="Tools"></div><p class="tool-search-status" id="tool-search-status" role="status"></p>';
    document.body.append(this.dialog);
    this.input=this.dialog.querySelector('input')!;this.results=this.dialog.querySelector('.tool-search-results')!;this.status=this.dialog.querySelector('.tool-search-status')!;
    trigger.addEventListener('click',()=>this.open());
    this.dialog.querySelector('button')!.addEventListener('click',()=>this.dialog.close());
    this.input.addEventListener('input',()=>{this.active=0;this.render();});
    this.dialog.addEventListener('click',event=>{if(event.target!==this.dialog)return;const r=this.dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)this.dialog.close();});
    this.dialog.addEventListener('keydown',event=>{
      event.stopPropagation();
      if(event.isComposing)return;
      if(event.key==='Escape'){event.preventDefault();this.dialog.close();return;}
      if(['ArrowDown','ArrowUp'].includes(event.key)){
        event.preventDefault();this.active=(this.active+(event.key==='ArrowDown'?1:-1)+this.matches.length)%Math.max(1,this.matches.length);this.highlight();this.input.focus();
      }else if(event.key==='Enter'&&event.target===this.input){event.preventDefault();this.execute(this.matches[this.active]);}
      else if(event.key==='Tab'){
        // Results use active-descendant navigation; Tab stays between search and close.
        event.preventDefault();(document.activeElement===this.input?this.dialog.querySelector<HTMLButtonElement>('.tool-search-close')!:this.input).focus();
      }
    });
    this.dialog.addEventListener('close',()=>{trigger.classList.remove('selected');trigger.setAttribute('aria-expanded','false');if(this.restoreFocus)trigger.focus({preventScroll:true});});
  }
  private open():void {
    if(this.dialog.open||document.querySelector('dialog[open]')||!this.beforeOpen())return;
    this.restoreFocus=true;this.input.value='';this.active=0;this.render();this.dialog.showModal();
    this.trigger.classList.add('selected');this.trigger.setAttribute('aria-expanded','true');this.input.focus();this.results.scrollTop=0;
  }
  private render():void {
    const words=this.input.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    this.matches=this.tools.filter(tool=>words.every(word=>`${tool.label} ${tool.group} ${tool.keywords??''}`.toLocaleLowerCase().includes(word)));
    // Exact names and name prefixes precede keyword-only matches.
    const query=words.join(' '),score=(tool:SearchTool)=>tool.label.toLocaleLowerCase()===query?0:tool.label.toLocaleLowerCase().startsWith(query)?1:2;
    this.matches.sort((a,b)=>score(a)-score(b));this.results.replaceChildren();
    for(const [index,tool] of this.matches.entries()){
      const reason=tool.unavailable?.(),row=document.createElement('button');row.type='button';row.className='tool-search-result';row.id=`tool-search-${tool.id}`;row.tabIndex=-1;row.setAttribute('role','option');row.setAttribute('aria-disabled',String(!!reason));
      row.innerHTML=`<svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-${tool.icon}"/></svg><span class="tool-search-label"><strong></strong><small></small></span><kbd aria-hidden="true"></kbd>`;
      row.querySelector('strong')!.textContent=tool.label;row.querySelector('small')!.textContent=reason??tool.group;row.querySelector('kbd')!.textContent=tool.shortcut??'';
      row.addEventListener('pointermove',()=>{this.active=index;this.highlight(false);});
      row.onclick=()=>this.execute(tool);this.results.append(row);
    }
    this.status.textContent=this.matches.length?`${this.matches.length} tools · ↑ ↓ to browse · Enter to choose · Esc to close`:'No tools found. Try a tool name, such as “circle” or “export”.';
    this.highlight();this.results.scrollTop=0;
  }
  private highlight(scroll=true):void {
    const rows=[...this.results.children] as HTMLElement[];
    rows.forEach((row,index)=>row.setAttribute('aria-selected',String(index===this.active)));
    const row=rows[this.active];if(row){this.input.setAttribute('aria-activedescendant',row.id);if(scroll)row.scrollIntoView({block:'nearest'});}else this.input.removeAttribute('aria-activedescendant');
  }
  private execute(tool?:SearchTool):void {
    if(!tool)return;
    const reason=tool.unavailable?.();if(reason){this.status.textContent=reason;this.input.focus();return;}
    this.restoreFocus=false;this.dialog.close();
    try{tool.run();}catch(error){this.onError(error instanceof Error?error.message:String(error));}
  }
}
