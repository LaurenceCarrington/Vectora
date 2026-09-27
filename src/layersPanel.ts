import type paper from 'paper';
import type { CADEditor } from './editor';
import type { ObjectRole, Shape } from './types';
import {layerId,layerRole,layerType} from './documentLayers';

const icon = (name: string) => `<svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-${name}"/></svg>`;

/** Live document data inside the design system's Layers component. */
export class LayersPanel {
  private active = 'cutline';
  private expanded = new Set<string>();
  private lastSelection: string | null = null;
  private lastRender = '';
  private draggedObjects: string[] = [];
  private scrollPointer: {x:number;y:number}|null = null;
  private scrollFrame = 0;
  private scrollTime = 0;
  private readonly scrollEdge: number;
  private readonly scrollSpeed: number;
  private drag: { id: number; x: number; y: number; left: number; top: number } | null = null;
  private readonly list: HTMLElement;
  private readonly grip: HTMLButtonElement;
  private readonly stage: HTMLElement;
  private readonly status: HTMLElement;
  private readonly inset: number;
  private readonly step: number;
  private readonly bigStep: number;

  constructor(private panel: HTMLElement, private editor: CADEditor, close: () => void) {
    this.list = panel.querySelector('.layer-list')!;
    this.grip = panel.querySelector('[data-panel-drag]')!;
    this.stage = panel.parentElement!;
    this.status = panel.querySelector('[role="status"]')!;
    const tokens = getComputedStyle(document.documentElement);
    this.inset = parseInt(tokens.getPropertyValue('--floating-edge-inset'), 10);
    this.step = parseInt(tokens.getPropertyValue('--drag-step'), 10);
    this.bigStep = parseInt(tokens.getPropertyValue('--drag-step-large'), 10);
    this.scrollEdge = parseFloat(tokens.getPropertyValue('--layer-drag-scroll-edge'));
    this.scrollSpeed = parseFloat(tokens.getPropertyValue('--layer-drag-scroll-speed'));
    const add=panel.querySelector<HTMLButtonElement>('[data-layer-add]')!,menu=panel.querySelector<HTMLElement>('[data-layer-add-menu]')!;
    const closeAdd=()=>{menu.hidden=true;add.setAttribute('aria-expanded','false');};
    add.onclick=()=>{menu.hidden=!menu.hidden;add.setAttribute('aria-expanded',String(!menu.hidden));if(!menu.hidden)menu.querySelector<HTMLButtonElement>('button')?.focus();};
    menu.addEventListener('click',event=>{
      const button=(event.target as Element).closest<HTMLButtonElement>('[data-add-layer-type]');if(!button)return;
      const layer=this.editor.addDocumentLayer(button.dataset.addLayerType as ObjectRole);this.active=layerId(layer);closeAdd();this.render();
      this.list.querySelector<HTMLButtonElement>(`[data-layer-id="${this.active}"] [data-layer-action="select"]`)?.focus({preventScroll:true});this.list.querySelector(`[data-layer-id="${this.active}"]`)?.scrollIntoView({block:'nearest'});
      this.editor.onMessage(`${layer.name} added.`,'success');
    });
    menu.addEventListener('keydown',event=>{
      const buttons=[...menu.querySelectorAll<HTMLButtonElement>('button')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeAdd();add.focus();}
      else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length]?.focus();}
    });
    document.addEventListener('pointerdown',event=>{if(!menu.hidden&&!menu.contains(event.target as Node)&&!add.contains(event.target as Node))closeAdd();});
    const remove=panel.querySelector<HTMLButtonElement>('[data-layer-delete]')!,dialog=document.querySelector<HTMLDialogElement>('#delete-layer-dialog')!;
    let pendingDelete:string|null=null;
    remove.onclick=()=>{
      const layer=this.editor.documentLayer(this.active);if(!layer||layer.locked)return;
      closeAdd();pendingDelete=this.active;dialog.querySelector('#delete-dialog-description')!.textContent=`“${layer.name}” and its ${layer.children.length} ${layer.children.length===1?'object':'objects'} will be deleted. You can undo this action.`;
      dialog.returnValue='';dialog.showModal();dialog.querySelector<HTMLButtonElement>('#delete-dialog-cancel')!.focus();
    };
    dialog.querySelector<HTMLButtonElement>('#delete-dialog-cancel')!.onclick=()=>dialog.close('cancel');
    dialog.querySelector<HTMLButtonElement>('#delete-dialog-confirm')!.onclick=()=>dialog.close('delete');
    dialog.addEventListener('keydown',event=>event.stopPropagation());
    dialog.addEventListener('close',()=>{
      const id=pendingDelete;pendingDelete=null;
      if(id&&dialog.returnValue==='delete'&&this.editor.deleteDocumentLayer(id)){this.render();this.editor.onMessage('Layer deleted. Undo restores its objects.','success');}
      (remove.disabled?add:remove).focus({preventScroll:true});
    });
    this.list.addEventListener('click', event => {
      const button = (event.target as Element).closest<HTMLButtonElement>('button');
      const entry = button?.closest<HTMLElement>('[data-layer-id]');
      if (!button || !entry || button.disabled) return;
      const role = entry.dataset.layerId!;
      const layer = this.editor.documentLayer(role);if(!layer)return;
      const action = button.dataset.layerAction;
      if (action === 'select') this.active = role;
      if (action === 'expand') this.expanded.has(role) ? this.expanded.delete(role) : this.expanded.add(role);
      if (action === 'visibility') this.editor.setLayerState(role, 'visible', !layer.visible);
      if (action === 'lock') this.editor.setLayerState(role, 'locked', !layer.locked);
      if (button.dataset.objectId) {
        const item = layer.children.find(item => item.data.uid === button.dataset.objectId);
        if (item) this.editor.select(item as Shape, (event as MouseEvent).shiftKey);
      }
      this.render();
      // Rebuilding rows must not strand keyboard focus on a detached button.
      const selector = button.dataset.objectId ? `[data-object-id="${button.dataset.objectId}"]` : `[data-layer-id="${role}"] [data-layer-action="${action}"]`;
      this.list.querySelector<HTMLButtonElement>(selector)?.focus({ preventScroll: true });
      this.status.textContent = `${layer.name} ${action === 'visibility' ? (layer.visible ? 'visible.' : 'hidden on canvas.') : action === 'lock' ? (layer.locked ? 'locked.' : 'unlocked.') : action === 'expand' ? (this.expanded.has(role) ? 'expanded.' : 'collapsed.') : 'selected.'}`;
    });
    this.list.addEventListener('dragstart', event => {
      const button=(event.target as Element).closest<HTMLButtonElement>('.layer-object');
      const item=this.editor.objects.find(item=>item.data.uid===button?.dataset.objectId);
      if(!button||button.disabled||!item||!event.dataTransfer){event.preventDefault();return;}
      const items=this.editor.selectedItems.includes(item)?this.editor.selectedItems:[item];
      this.draggedObjects=items.map(item=>item.data.uid);
      this.list.classList.add('is-object-drag-active');
      event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-vectora-layer-objects',JSON.stringify(this.draggedObjects));
      this.list.querySelectorAll<HTMLElement>('.layer-object').forEach(row=>row.classList.toggle('is-object-dragging',this.draggedObjects.includes(row.dataset.objectId!)));
      this.status.textContent=`Drag ${items.length===1?'object':`${items.length} selected objects`} to an unlocked, visible layer.`;
    });
    this.list.addEventListener('dragover',event=>{
      if(!this.draggedObjects.length)return;
      const entry=(event.target as Element).closest<HTMLElement>('[data-layer-id]');
      const valid=!!entry&&this.canDropObjects(entry.dataset.layerId!);
      this.clearDropTarget();
      if(event.dataTransfer)event.dataTransfer.dropEffect=valid?'move':'none';
      if(valid){event.preventDefault();entry!.classList.add('is-drop-target');}
    });
    this.list.addEventListener('dragleave',event=>{
      const entry=(event.target as Element).closest<HTMLElement>('[data-layer-id]');
      if(entry&&!entry.contains(event.relatedTarget as Node|null))entry.classList.remove('is-drop-target');
    });
    this.list.addEventListener('drop',event=>{
      if(!this.draggedObjects.length)return;
      event.preventDefault();event.stopPropagation();
      const id=(event.target as Element).closest<HTMLElement>('[data-layer-id]')?.dataset.layerId;
      const objects=this.editor.objects.filter(item=>this.draggedObjects.includes(item.data.uid));
      const valid=!!id&&this.canDropObjects(id);this.finishObjectDrag();
      if(!valid)return;
      try{
        const layer=this.editor.documentLayer(id!)!,moved=this.editor.moveObjectsToLayer(id!,objects);
        if(!moved)return;
        this.active=id!;this.expanded.add(id!);this.render();
        const row=this.list.querySelector<HTMLButtonElement>(`[data-layer-id="${id}"] .layer-object[aria-pressed="true"]`);
        row?.focus({preventScroll:true});row?.scrollIntoView({block:'nearest'});
        this.status.textContent=`${moved} ${moved===1?'object moved':'objects moved'} to ${layer.name}.`;
        this.editor.onMessage(this.status.textContent,'success');
      }catch(error){this.editor.onMessage(error instanceof Error?error.message:String(error),true);}
    });
    this.list.addEventListener('dragend',()=>this.finishObjectDrag());
    const trackDrag=(event:DragEvent)=>{
      if(!this.draggedObjects.length)return;
      const bounds=this.list.getBoundingClientRect();
      if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom){this.stopDragScroll();return;}
      this.scrollPointer={x:event.clientX,y:event.clientY};
      if(!this.scrollFrame){this.scrollTime=performance.now();this.scrollFrame=requestAnimationFrame(this.scrollDuringDrag);}
    };
    document.addEventListener('dragover',trackDrag);
    document.addEventListener('dragenter',trackDrag);
    document.addEventListener('drop',()=>this.finishObjectDrag());
    document.addEventListener('dragend',()=>this.finishObjectDrag());
    window.addEventListener('blur',()=>this.finishObjectDrag());
    this.grip.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      this.grip.focus({ preventScroll: true });
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: panel.offsetLeft, top: panel.offsetTop };
      this.grip.setPointerCapture(event.pointerId);
      panel.classList.add('is-dragging');
    });
    this.grip.addEventListener('pointermove', event => {
      if (this.drag?.id === event.pointerId) this.moveTo(this.drag.left + event.clientX - this.drag.x, this.drag.top + event.clientY - this.drag.y);
    });
    this.grip.addEventListener('pointerup', () => this.finishDrag());
    this.grip.addEventListener('pointercancel', () => this.finishDrag(true));
    this.grip.addEventListener('lostpointercapture', () => this.finishDrag(true));
    window.addEventListener('blur', () => this.finishDrag(true));
    this.grip.addEventListener('keydown', event => {
      const delta: Record<string, number[]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const direction = delta[event.key];
      if (!direction || this.drag) return;
      event.preventDefault();event.stopPropagation();
      const step = event.shiftKey ? this.bigStep : this.step;
      this.moveTo(panel.offsetLeft + direction[0] * step, panel.offsetTop + direction[1] * step);
      this.status.textContent = 'Layers panel moved.';
    });
    panel.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.code === 'Space') && (event.target as Element).closest('button')) {
        event.stopPropagation();return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();event.stopPropagation();
      if (this.drag) this.finishDrag(true); else close();
    });
    new ResizeObserver(() => { if (!panel.hidden) this.moveTo(panel.offsetLeft, panel.offsetTop); }).observe(this.stage);
  }

  render(): void {
    const layers=this.editor.documentLayers;
    if(!this.editor.documentLayer(this.active))this.active=layers[0]?layerId(layers[0]):'';
    const selection=this.editor.selectedItems,signature=selection.map(item=>`${layerId(item.layer)}:${item.data.uid}`).join('|'),layer=selection[0]?.layer;
    if(signature!==this.lastSelection&&layer&&selection.every(item=>item.layer===layer))this.active=layerId(layer);
    this.lastSelection=signature;
    const remove=this.panel.querySelector<HTMLButtonElement>('[data-layer-delete]')!,activeLayer=this.editor.documentLayer(this.active);
    remove.disabled=!activeLayer||activeLayer.locked;remove.title=activeLayer?.locked?'Unlock the selected layer before deleting':'Delete selected layer';
    const roles=layers.map(layerId);
    const key = JSON.stringify([this.active, this.editor.selectedItems.map(item=>item.data.uid), [...this.expanded], roles.map(role => {
      const layer = this.editor.documentLayer(role)!;
      return [role,layer.name,layerRole(layer),layer.visible, layer.locked, layer.children.map(item => [item.data.uid, item.data.name])];
    })]);
    if (key === this.lastRender) return;
    this.lastRender = key;
    this.list.replaceChildren();
    this.panel.querySelector('[data-layer-count]')!.textContent = String(layers.length);
    if(!layers.length){const empty=document.createElement('p');empty.className='layers-empty';empty.textContent='No layers yet. Add a layer to get started.';this.list.append(empty);}
    for (const role of roles) {
      const layer = this.editor.documentLayer(role)!, name = layer.name, expanded = this.expanded.has(role);
      const entry = document.createElement('div');
      entry.className = 'layer-entry';entry.dataset.layerId = role;entry.dataset.layerType = layerType(layerRole(layer)).type;
      const objectsId = `layer-objects-${role}`;
      entry.innerHTML = `<div class="layer-row${this.active === role ? ' is-selected' : ''}${!layer.visible ? ' is-hidden' : ''}">
        <button type="button" class="panel-icon layer-expand" data-layer-action="expand" aria-label="${expanded ? 'Collapse' : 'Expand'} ${name}" aria-expanded="${expanded}" aria-controls="${objectsId}">${icon('chevron')}</button>
        <button type="button" class="layer-select" data-layer-action="select" aria-pressed="${this.active === role}"><span class="layer-dot" aria-hidden="true"></span><span><span class="layer-name">${name}</span><span class="layer-meta">${layer.children.length} ${layer.children.length === 1 ? 'object' : 'objects'}</span></span></button>
        <button type="button" class="panel-icon" data-layer-action="visibility" aria-label="${layer.visible ? 'Hide' : 'Show'} ${name}" title="${layer.visible ? 'Hide' : 'Show'} ${name} on canvas" aria-pressed="${!layer.visible}">${icon(layer.visible ? 'eye' : 'eye-off')}</button>
        <button type="button" class="panel-icon" data-layer-action="lock" aria-label="${layer.locked ? 'Unlock' : 'Lock'} ${name}" title="${layer.locked ? 'Unlock' : 'Lock'} ${name}" aria-pressed="${layer.locked}">${icon(layer.locked ? 'lock' : 'unlock')}</button>
      </div>`;
      const objects = document.createElement('div');objects.id = objectsId;objects.className = 'layer-objects';objects.hidden = !expanded;
      if (!layer.children.length) objects.textContent = 'No objects in this layer.';
      for (const item of layer.children) {
        const button = document.createElement('button');button.type = 'button';button.className = 'layer-object';button.dataset.objectId = item.data.uid;
        button.disabled = !layer.visible || layer.locked;button.draggable=!button.disabled;button.setAttribute('aria-pressed', String(this.editor.selectedItems.includes(item as Shape)));
        button.innerHTML = icon(['Circle', 'Rectangle', 'Ellipse', 'Polygon', 'Line', 'Polyline', 'Freehand', 'Arc'].includes(item.data.name) ? item.data.name.toLowerCase() : item.data.regionFill?'fill':item.data.text?'text':item.data.dimension?'dimension-aligned': 'path');
        const label=document.createElement('span');label.textContent=item.data.name||'Object';button.title=`${label.textContent} · Drag to another layer`;button.append(label);objects.append(button);
      }
      entry.append(objects);this.list.append(entry);
    }
  }

  open(trigger: HTMLElement): void {
    this.finishObjectDrag();
    this.finishDrag();
    this.panel.style.left = '';this.panel.style.right = '';
    this.moveTo(this.panel.offsetLeft, trigger.getBoundingClientRect().top - this.stage.getBoundingClientRect().top);
    this.grip.focus({ preventScroll: true });
  }

  private canDropObjects(id:string):boolean {
    const layer=this.editor.documentLayer(id),items=this.editor.objects.filter(item=>this.draggedObjects.includes(item.data.uid));
    return !!layer&&layer.visible&&!layer.locked&&items.length===this.draggedObjects.length&&items.length>0
      &&items.every(item=>item.layer.visible&&!item.layer.locked&&(!item.data.dimension||layerRole(layer)==='artwork'))
      &&items.some(item=>item.layer!==layer);
  }
  private clearDropTarget():void {this.list.querySelectorAll('.is-drop-target').forEach(entry=>entry.classList.remove('is-drop-target'));}
  private scrollDuringDrag=(time:number):void=>{
    this.scrollFrame=0;
    if(!this.scrollPointer||!this.draggedObjects.length||this.panel.hidden){this.stopDragScroll();return;}
    const {x,y}=this.scrollPointer,bounds=this.list.getBoundingClientRect(),edge=Math.min(this.scrollEdge,bounds.height/3);
    const direction=y<bounds.top+edge?-Math.min(1,(bounds.top+edge-y)/edge):y>bounds.bottom-edge?Math.min(1,(y-bounds.bottom+edge)/edge):0;
    const previous=this.list.scrollTop;
    this.list.scrollTop+=direction*this.scrollSpeed*Math.min(32,time-this.scrollTime)/1000;
    this.scrollTime=time;
    if(this.list.scrollTop!==previous){
      this.clearDropTarget();
      const entry=document.elementFromPoint(x,y)?.closest<HTMLElement>('[data-layer-id]');
      if(entry&&this.list.contains(entry)&&this.canDropObjects(entry.dataset.layerId!))entry.classList.add('is-drop-target');
    }
    this.scrollFrame=requestAnimationFrame(this.scrollDuringDrag);
  };
  private stopDragScroll():void {
    cancelAnimationFrame(this.scrollFrame);this.scrollFrame=0;this.scrollPointer=null;
  }
  private finishObjectDrag():void {
    this.stopDragScroll();
    this.draggedObjects=[];this.list.classList.remove('is-object-drag-active');this.clearDropTarget();
    this.list.querySelectorAll('.is-object-dragging').forEach(row=>row.classList.remove('is-object-dragging'));
  }

  private moveTo(x: number, y: number): void {
    const maxX = Math.max(this.inset, this.stage.clientWidth - this.panel.offsetWidth - this.inset);
    const maxY = Math.max(this.inset, this.stage.clientHeight - this.panel.offsetHeight - this.inset);
    this.panel.style.right = 'auto';
    this.panel.style.left = `${Math.min(maxX, Math.max(this.inset, Math.round(x / this.step) * this.step))}px`;
    this.panel.style.top = `${Math.min(maxY, Math.max(this.inset, Math.round(y / this.step) * this.step))}px`;
  }

  private finishDrag(cancel = false): void {
    const drag = this.drag;this.drag = null;
    if (!drag) return;
    if (cancel) this.moveTo(drag.left, drag.top);
    this.panel.classList.remove('is-dragging');
    if (this.grip.hasPointerCapture(drag.id)) this.grip.releasePointerCapture(drag.id);
    this.status.textContent = cancel ? 'Panel move cancelled.' : 'Layers panel moved.';
  }
}
