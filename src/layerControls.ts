import {ColourPopover} from './colourPopover';
import {validateLayerName} from './documentLayers';
import type {ObjectRole} from './types';

export interface ManagedLayer {id:string;name:string;colour:string;custom:boolean;locked:boolean}
export interface LayerControlModel {
 active():ManagedLayer|undefined;
 layer(id:string):ManagedLayer|undefined;
 add(role:ObjectRole):void;
 rename(id:string,name:string):void;
 colour(id:string,colour:string,commit:boolean):void;
 finishColour():void;
 prepareColour():void;
 remove(id:string):void;
 message(message:string):void;
}
const icon=(name:string)=>`<svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-${name}"/></svg>`;

/** Shared custom-layer controls for the editor and interactive design reference. */
export class LayerControls {
 private footer=document.createElement('div');
 private addButton:HTMLButtonElement;
 private deleteButton:HTMLButtonElement;
 private addMenu:HTMLElement;
 private picker:ColourPopover;
 private dialog=document.createElement('dialog');
 private editing:{id:string;input:HTMLInputElement;select:HTMLButtonElement}|null=null;
 constructor(private panel:HTMLElement,private model:LayerControlModel){
  const prefix=`${panel.id}-layer`;
  this.footer.className='layer-manager-footer';
  this.footer.innerHTML=`<div class="layer-add-anchor"><button type="button" class="button layer-add-button" data-layer-add aria-haspopup="menu" aria-expanded="false" aria-controls="${prefix}-types">${icon('plus')}<span>Add layer</span></button><div class="layer-add-menu menu-surface" id="${prefix}-types" role="menu" aria-label="Layer type" hidden>${[['artwork','Artwork'],['cutline','Cut'],['engrave','Engrave'],['construction','Construction']].map(([role,label])=>`<button type="button" class="node-action" role="menuitem" data-add-layer-role="${role}">${icon('layers')}<span>${label}</span></button>`).join('')}</div></div><button type="button" class="panel-icon" data-layer-delete aria-label="Delete layer" title="Delete custom layer">${icon('delete')}</button>`;
  panel.insertBefore(this.footer,panel.querySelector('[role="status"]'));
  this.addButton=this.footer.querySelector('[data-layer-add]')!;this.deleteButton=this.footer.querySelector('[data-layer-delete]')!;this.addMenu=this.footer.querySelector('.layer-add-menu')!;
  this.picker=new ColourPopover(panel,prefix,()=>model.finishColour());
  this.addButton.onclick=()=>this.toggleAdd(this.addMenu.hidden);
  this.addButton.onkeydown=event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();event.stopPropagation();this.toggleAdd(true,event.key==='ArrowUp');}};
  this.addMenu.onclick=event=>{const button=(event.target as Element).closest<HTMLButtonElement>('[data-add-layer-role]');if(!button)return;this.toggleAdd(false);this.run(()=>model.add(button.dataset.addLayerRole as ObjectRole));this.refresh();this.panel.querySelector<HTMLButtonElement>('.layer-select[aria-pressed="true"]')?.focus({preventScroll:true});};
  this.addMenu.onkeydown=event=>{
   event.stopPropagation();const buttons=[...this.addMenu.querySelectorAll<HTMLButtonElement>('button')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);
   if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}
   if(event.key==='Escape'){event.preventDefault();this.toggleAdd(false);this.addButton.focus();}
   if(event.key==='Tab')this.toggleAdd(false);
  };
  this.deleteButton.onclick=()=>this.confirmDelete();
  panel.addEventListener('dblclick',event=>{const select=(event.target as Element).closest<HTMLElement>('.layer-select');const id=select?.closest<HTMLElement>('[data-layer-id]')?.dataset.layerId;if(id)this.startRename(id);});
  panel.addEventListener('keydown',event=>{if(event.key==='F2'&&(event.target as Element).closest('.layer-select')){event.preventDefault();event.stopPropagation();const id=(event.target as Element).closest<HTMLElement>('[data-layer-id]')?.dataset.layerId;if(id)this.startRename(id);}},true);
  panel.addEventListener('click',event=>{
   const button=(event.target as Element).closest<HTMLButtonElement>('[data-layer-colour]');if(!button||button.disabled)return;
   const id=button.closest<HTMLElement>('[data-layer-id]')!.dataset.layerId!;model.prepareColour();
   const layer=model.layer(id),anchor=panel.querySelector<HTMLButtonElement>(`[data-layer-id="${id}"] [data-layer-colour]`);if(!layer||layer.locked||!layer.custom||!anchor)return;
   this.picker.open(anchor,'Layer colour',{hex:layer.colour,opacity:1},false,(paint,commit)=>this.run(()=>model.colour(id,paint.hex,commit)));
  });
  document.addEventListener('pointerdown',event=>{if(!this.footer.contains(event.target as Node))this.toggleAdd(false);},true);
  new MutationObserver(()=>this.refresh()).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  new MutationObserver(()=>{if(panel.hidden){this.toggleAdd(false);this.endRename(false);}}).observe(panel,{attributes:true,attributeFilter:['hidden']});
  this.dialog.className='delete-dialog menu-surface';this.dialog.setAttribute('aria-labelledby',`${prefix}-delete-title`);
  this.dialog.innerHTML=`<form method="dialog"><div class="delete-dialog-heading"><span class="delete-dialog-icon" aria-hidden="true">${icon('delete')}</span><h2 id="${prefix}-delete-title">Delete layer?</h2></div><p data-layer-delete-message></p><div class="delete-dialog-actions"><button type="submit" class="button" value="cancel" autofocus>Cancel</button><button type="submit" class="button button--danger" value="delete">Delete layer</button></div></form>`;
  this.dialog.addEventListener('keydown',event=>event.stopPropagation());document.body.append(this.dialog);
 }
 private run(action:()=>void):void {try{action();}catch(error){this.model.message(error instanceof Error?error.message:String(error));}}
 private toggleAdd(open:boolean,last=false):void {
  this.addMenu.hidden=!open;this.addButton.setAttribute('aria-expanded',String(open));
  if(open){this.endRename(true);this.picker.close();const buttons=this.addMenu.querySelectorAll<HTMLButtonElement>('button');buttons[last?buttons.length-1:0]?.focus({preventScroll:true});}
 }
 private startRename(id:string):void {
  const layer=this.model.layer(id);if(!layer?.custom||layer.locked)return;
  this.endRename(true);this.picker.close();
  const select=this.panel.querySelector<HTMLButtonElement>(`[data-layer-id="${id}"] .layer-select`);if(!select)return;
  const input=document.createElement('input');input.className='layer-name-input';input.type='text';input.maxLength=200;input.value=layer.name;input.setAttribute('aria-label','Layer name');input.title='Enter to rename; Escape to cancel';
  this.editing={id,input,select};select.hidden=true;select.parentElement!.append(input);
  input.onkeydown=event=>{event.stopPropagation();if(event.key==='Enter'){event.preventDefault();this.endRename(true,true);}else if(event.key==='Escape'){event.preventDefault();this.endRename(false,true);}};
  input.onblur=()=>{this.endRename(true);if(this.editing?.input===input)this.endRename(false);};input.focus({preventScroll:true});input.select();
 }
 private endRename(commit:boolean,restoreFocus=false):void {
  const edit=this.editing;if(!edit)return;
  let name='';if(commit){try{name=validateLayerName(edit.input.value);}catch(error){edit.input.setAttribute('aria-invalid','true');this.model.message((error as Error).message);return;}}
  this.editing=null;edit.input.remove();edit.select.hidden=false;
  if(commit)this.run(()=>this.model.rename(edit.id,name));
  if(restoreFocus)this.panel.querySelector<HTMLButtonElement>(`[data-layer-id="${edit.id}"] .layer-select`)?.focus({preventScroll:true});
 }
 private confirmDelete():void {
  const layer=this.model.active();if(!layer?.custom||layer.locked||this.dialog.open)return;
  this.endRename(true);this.picker.close();
  const count=this.panel.querySelector(`[data-layer-id="${layer.id}"] .layer-meta`)?.textContent??'its objects';
  this.dialog.querySelector('[data-layer-delete-message]')!.textContent=`Delete “${layer.name}” and ${count}? You can restore the layer and its contents with Undo.`;
  this.dialog.returnValue='';this.dialog.addEventListener('close',()=>{
   if(this.dialog.returnValue==='delete'){const current=this.model.layer(layer.id);if(current?.custom&&!current.locked)this.run(()=>this.model.remove(layer.id));}
   this.refresh();this.deleteButton.focus({preventScroll:true});if(this.deleteButton.disabled)this.addButton.focus({preventScroll:true});
  },{once:true});this.dialog.showModal();
 }
 refresh():void {
  const active=this.model.active(),editable=!!active?.custom&&!active.locked;this.deleteButton.disabled=!editable;
  for(const entry of this.panel.querySelectorAll<HTMLElement>('[data-layer-id]')){
   const layer=this.model.layer(entry.dataset.layerId!);if(!layer)continue;entry.style.setProperty('--layer-color',layer.colour);
   if(!layer.custom)continue;
   const select=entry.querySelector<HTMLButtonElement>('.layer-select')!;
   if(!entry.querySelector('.layer-label')){const wrap=document.createElement('div');wrap.className='layer-label';select.before(wrap);wrap.append(select);select.querySelector('.layer-dot')?.remove();select.title=`Draw in ${layer.name} · Double-click or F2 to rename`;}
   let swatch=entry.querySelector<HTMLButtonElement>('[data-layer-colour]');
   if(!swatch){swatch=document.createElement('button');swatch.type='button';swatch.className='panel-icon layer-colour-button';swatch.dataset.layerColour='';swatch.setAttribute('aria-haspopup','dialog');swatch.setAttribute('aria-expanded','false');swatch.setAttribute('aria-controls',`${this.panel.id}-layer-colour-popover`);swatch.innerHTML='<span class="layer-dot" aria-hidden="true"></span>';entry.querySelector('.layer-label')!.before(swatch);}
   swatch.disabled=layer.locked;swatch.setAttribute('aria-label',`Change ${layer.name} colour`);swatch.title=`Change ${layer.name} colour`;
  }
  if(this.editing&&!this.editing.input.isConnected)this.editing=null;
 }
}
