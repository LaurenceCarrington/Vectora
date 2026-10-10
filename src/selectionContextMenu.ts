import paper from 'paper';
import {layerId,layerRole,layerType} from './documentLayers';
import type { CADEditor } from './editor';

/** The shape clipboard is local to this editor; native text fields keep their own clipboard. */
export class SelectionContextMenu {
  readonly menu=document.createElement('div');
  private point:paper.Point|null=null;
  private copy:HTMLButtonElement;
  private paste:HTMLButtonElement;
  private smooth=document.createElement('button');
  private layer=document.createElement('button');
  private layerMenu=document.createElement('div');
  private layerSignature='';
  private anchor={x:0,y:0};
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
    this.smooth.type='button';this.smooth.className='node-action';this.smooth.setAttribute('role','menuitem');this.smooth.setAttribute('aria-haspopup','dialog');
    this.smooth.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-node-smooth"/></svg><span>Smooth</span>';
    this.smooth.onclick=()=>{const anchor={...this.anchor};this.close();editor.smoothing.open(anchor);};this.menu.append(this.smooth);
    this.layer.type='button';this.layer.className='node-action selection-layer-trigger';this.layer.setAttribute('role','menuitem');this.layer.setAttribute('aria-haspopup','menu');this.layer.setAttribute('aria-expanded','false');this.layer.setAttribute('aria-controls','selection-layer-menu');
    this.layer.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-layers"/></svg><span>Layer</span><svg class="selection-layer-chevron" aria-hidden="true" viewBox="0 0 24 24"><use href="#i-chevron"/></svg>';
    this.layerMenu.id='selection-layer-menu';this.layerMenu.className='selection-layer-menu';this.layerMenu.hidden=true;this.layerMenu.setAttribute('role','menu');this.layerMenu.setAttribute('aria-label','Move to layer');
    this.layer.onclick=()=>this.toggleLayers();this.menu.append(this.layer,this.layerMenu);
    this.menu.addEventListener('keydown',event=>{
      const nested=this.layerMenu.contains(event.target as Node);
      if(event.key==='ArrowRight'&&event.target===this.layer){event.preventDefault();event.stopPropagation();this.toggleLayers(true);return;}
      if(event.key==='ArrowLeft'&&nested){event.preventDefault();event.stopPropagation();this.toggleLayers(false);this.layer.focus();return;}
      if(event.key==='Escape'||event.key==='Tab'){
        event.stopPropagation();
        if(event.key==='Escape'){event.preventDefault();if(!this.layerMenu.hidden){this.toggleLayers(false);this.layer.focus();return;}editor.canvas.focus({preventScroll:true});}
        this.close();return;
      }
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
        event.preventDefault();event.stopPropagation();
        const buttons=nested?[...this.layerMenu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]:[this.copy,this.paste,this.smooth,this.layer].filter(button=>!button.disabled);
        const index=buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();
      }
    });
    editor.canvas.parentElement!.append(this.menu);
    editor.canvas.addEventListener('contextmenu',event=>{
      if(editor.tool!=='select'||editor.textEditing)return;
      event.preventDefault();this.close();this.beforeOpen();
      const r=editor.canvas.getBoundingClientRect();this.point=paper.view.viewToProject(new paper.Point(event.clientX-r.left,event.clientY-r.top));
      editor.selectForContext(this.point);this.refresh();this.menu.hidden=false;
      this.anchor={x:event.clientX,y:event.clientY};this.position();
      (this.copy.disabled?(this.paste.disabled?this.menu:this.paste):this.copy).focus({preventScroll:true});
    });
    document.addEventListener('pointerdown',event=>{if(!this.menu.contains(event.target as Node))this.close();});
    document.addEventListener('wheel',event=>{if(!this.menu.contains(event.target as Node))this.close();},{passive:true});
    window.addEventListener('resize',()=>this.close());window.addEventListener('blur',()=>this.close());
    document.addEventListener('keydown',event=>{
      if(event.target instanceof Element&&event.target.closest('input,textarea,select,[contenteditable="true"]'))return;
      if(document.querySelector('dialog[open]')||editor.textEditing)return;
      const key=event.key.toLowerCase();
      if((event.metaKey||event.ctrlKey)&&!event.altKey&&!event.shiftKey&&(key==='c'||key==='v')){
        event.preventDefault();event.stopPropagation();this.run(key==='c'?'copy':'paste',this.menu.hidden?undefined:this.point??undefined);return;
      }

    });
  }
  private position():void {
    const r=this.editor.canvas.getBoundingClientRect();
    const left=document.querySelector('.ruler-left')?.getBoundingClientRect().right??r.left;
    const right=document.querySelector('.right-toolbar')?.getBoundingClientRect().left??r.right;
    const top=(document.querySelector('.document-tabs')??document.querySelector('.top-toolbar'))?.getBoundingClientRect().bottom??r.top;
    const bottom=document.querySelector('.ruler-bottom')?.getBoundingClientRect().top??r.bottom;
    this.menu.style.maxWidth=`${Math.max(0,right-left)}px`;this.menu.style.maxHeight=`${Math.max(0,bottom-top)}px`;
    const bounds=this.menu.getBoundingClientRect();
    this.menu.style.left=`${Math.max(left,Math.min(this.anchor.x,right-bounds.width))}px`;
    this.menu.style.top=`${Math.max(top,Math.min(this.anchor.y,bottom-bounds.height))}px`;
  }
  private toggleLayers(open=this.layerMenu.hidden):void {
    if(open&&this.layer.disabled)return;
    this.layerMenu.hidden=!open;this.layer.setAttribute('aria-expanded',String(open));
    if(open){this.renderLayers();this.position();this.layerMenu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({preventScroll:true});}
    else this.position();
  }
  private renderLayers():void {
    const editor=this.editor,layers=editor.documentLayers;
    const signature=JSON.stringify([editor.selectedItems.map(item=>[item.data.uid,layerId(item.layer)]),layers.map(layer=>[layerId(layer),layer.name,layerRole(layer),layer.data.colour,layer.visible,layer.locked])]);
    if(signature===this.layerSignature)return;this.layerSignature=signature;this.layerMenu.replaceChildren();
    for(const layer of layers){
      const id=layerId(layer),current=editor.selectedItems.length>0&&editor.selectedItems.every(item=>item.layer===layer);
      const button=document.createElement('button');button.type='button';button.className='node-action selection-layer-option';button.setAttribute('role','menuitemradio');button.setAttribute('aria-checked',String(current));
      button.disabled=!editor.canMoveSelectionToLayer(id);
      button.title=`${layer.name}${layer.locked?' · Locked':!layer.visible?' · Hidden':current?' · Current layer':''}`;
      button.innerHTML='<span class="layer-dot" aria-hidden="true"></span><span class="selection-layer-name"></span><svg class="selection-layer-check" aria-hidden="true" viewBox="0 0 24 24"><use href="#i-check"/></svg>';
      button.querySelector<HTMLElement>('.layer-dot')!.style.setProperty('--layer-color',layer.data.colour??`var(${layerType(layerRole(layer)).color})`);
      button.querySelector('.selection-layer-name')!.textContent=layer.name;
      button.onclick=()=>{
        try{editor.moveSelectionToLayer(id);}catch(error){editor.onMessage((error as Error).message,true);}
        this.close();editor.canvas.focus({preventScroll:true});
      };
      this.layerMenu.append(button);
    }
  }
  private run(action:'copy'|'paste',point?:paper.Point):void {
    try{if(action==='copy')this.editor.copySelection();else this.editor.pasteSelection(point);}
    catch(error){this.editor.onMessage((error as Error).message,true);}
    this.close();this.editor.canvas.focus({preventScroll:true});
  }
  refresh():void {
    this.editor.smoothing.refresh();this.smooth.disabled=!this.editor.smoothing.eligible;
    this.smooth.title=this.smooth.disabled?'Select editable paths with at least three points. Convert text to paths first.':'Smooth selected objects';
    if(this.editor.tool!=='select'||this.editor.textEditing)this.close();
    this.copy.disabled=!this.editor.canCopySelection;this.paste.disabled=!this.editor.canPaste;this.layer.disabled=!this.editor.canCopySelection;
    if(!this.layerMenu.hidden){this.renderLayers();if(!this.menu.hidden)this.position();}
  }
  close():void {this.menu.hidden=true;this.point=null;this.layerMenu.hidden=true;this.layer.setAttribute('aria-expanded','false');}
}
