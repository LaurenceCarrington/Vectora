import paper from 'paper';
import type { CADEditor } from './editor';

/** The shape clipboard is local to this editor; native text fields keep their own clipboard. */
export class SelectionContextMenu {
  readonly menu=document.createElement('div');
  private point:paper.Point|null=null;
  private copy:HTMLButtonElement;
  private paste:HTMLButtonElement;
  constructor(private editor:CADEditor,private beforeOpen:()=>void){
    this.menu.className='selection-context-menu menu-surface';this.menu.hidden=true;
    this.menu.setAttribute('role','menu');this.menu.setAttribute('aria-label','Selection actions');this.menu.tabIndex=-1;
    const command=/Mac|iPhone|iPad/.test(navigator.platform)?'⌘':'Ctrl';
    const button=(action:'copy'|'paste',label:string,key:string)=>{
      const el=document.createElement('button');el.type='button';el.className='node-action';el.setAttribute('role','menuitem');el.setAttribute('aria-keyshortcuts',`Control+${key} Meta+${key}`);
      el.innerHTML=`<svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-${action}"/></svg><span>${label}</span><kbd aria-hidden="true">${command} ${key}</kbd>`;
      el.onclick=()=>this.run(action,this.point??undefined);this.menu.append(el);return el;
    };
    this.copy=button('copy','Copy','C');this.paste=button('paste','Paste','V');
    editor.canvas.parentElement!.append(this.menu);
    editor.canvas.addEventListener('contextmenu',event=>{
      if(editor.tool!=='select'||editor.textEditing)return;
      event.preventDefault();this.beforeOpen();
      const r=editor.canvas.getBoundingClientRect();this.point=paper.view.viewToProject(new paper.Point(event.clientX-r.left,event.clientY-r.top));
      editor.selectForContext(this.point);this.refresh();this.menu.hidden=false;
      const left=document.querySelector('.ruler-left')?.getBoundingClientRect().right??r.left;
      const right=document.querySelector('.right-toolbar')?.getBoundingClientRect().left??r.right;
      const top=document.querySelector('.top-toolbar')?.getBoundingClientRect().bottom??r.top;
      const bottom=document.querySelector('.ruler-bottom')?.getBoundingClientRect().top??r.bottom;
      this.menu.style.maxWidth=`${Math.max(0,right-left)}px`;this.menu.style.maxHeight=`${Math.max(0,bottom-top)}px`;
      const bounds=this.menu.getBoundingClientRect();
      this.menu.style.left=`${Math.max(left,Math.min(event.clientX,right-bounds.width))}px`;
      this.menu.style.top=`${Math.max(top,Math.min(event.clientY,bottom-bounds.height))}px`;
      (this.copy.disabled?(this.paste.disabled?this.menu:this.paste):this.copy).focus({preventScroll:true});
    });
    document.addEventListener('pointerdown',event=>{if(!this.menu.contains(event.target as Node))this.close();});
    document.addEventListener('wheel',()=>this.close(),{passive:true});
    window.addEventListener('resize',()=>this.close());window.addEventListener('blur',()=>this.close());
    document.addEventListener('keydown',event=>{
      if(event.target instanceof Element&&event.target.closest('input,textarea,select,[contenteditable="true"]'))return;
      if(document.querySelector('dialog[open]')||editor.textEditing)return;
      const key=event.key.toLowerCase();
      if((event.metaKey||event.ctrlKey)&&!event.altKey&&!event.shiftKey&&(key==='c'||key==='v')){
        event.preventDefault();event.stopPropagation();this.run(key==='c'?'copy':'paste',this.menu.hidden?undefined:this.point??undefined);return;
      }
      if(this.menu.hidden)return;
      if(event.key==='Escape'||event.key==='Tab'){
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();editor.canvas.focus({preventScroll:true});}this.close();return;
      }
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
        event.preventDefault();event.stopPropagation();
        const buttons=[this.copy,this.paste].filter(el=>!el.disabled),index=buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();
      }
    });
  }
  private run(action:'copy'|'paste',point?:paper.Point):void {
    try{if(action==='copy')this.editor.copySelection();else this.editor.pasteSelection(point);}
    catch(error){this.editor.onMessage((error as Error).message,true);}
    this.close();this.editor.canvas.focus({preventScroll:true});
  }
  refresh():void {
    if(this.editor.tool!=='select'||this.editor.textEditing)this.close();
    this.copy.disabled=!this.editor.canCopySelection;this.paste.disabled=!this.editor.canPaste;
  }
  close():void {this.menu.hidden=true;this.point=null;}
}
