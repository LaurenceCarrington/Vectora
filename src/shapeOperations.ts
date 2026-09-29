import paper from 'paper';
import type {CADEditor} from './editor';
import type {Shape} from './types';
import {buildShapeOperation,eligibleForShapeOperation,OPERATION_LABELS,type ShapeOperation} from './shapeOperationGeometry';

type Hooks={changed:()=>void;apply:(sources:readonly Shape[],result:Shape)=>void};
const descriptions:Record<ShapeOperation,string>={weld:'Merge the selected areas into one shape.',subtract:'Remove upper shapes from the bottom shape.',intersect:'Keep only the area shared by every shape.'};

/** Selection pop-out with an isolated preview; only Apply touches the document. */
export class ShapeOperations {
 readonly dialog=document.createElement('dialog');
 private sources:Shape[]=[];
 private result:Shape|null=null;
 private ghost:Shape|null=null;
 private operation:ShapeOperation='weld';
 get active():boolean{return this.sources.length>0;}
 get available():boolean{return !this.editor.hasPendingGesture&&!this.editor.textEditing&&eligibleForShapeOperation(this.editor.selectedItems);}
 constructor(private editor:CADEditor,private hooks:Hooks){
  const d=this.dialog;d.id='shape-operations-dialog';d.className='shape-operations-dialog menu-surface';d.setAttribute('aria-label','Shape operations');
  d.innerHTML=`<form><h2>Shape operations</h2><div class="shape-operation-options" role="radiogroup" aria-label="Operation">${(Object.keys(OPERATION_LABELS) as ShapeOperation[]).map(kind=>`<button type="button" class="shape-operation-option" role="radio" aria-checked="false" aria-label="${OPERATION_LABELS[kind]}" data-shape-operation="${kind}"><svg aria-hidden="true"><use href="#i-${kind}"/></svg><span>${OPERATION_LABELS[kind]}<small>${descriptions[kind]}</small></span></button>`).join('')}</div><p class="shape-operation-feedback" role="status" aria-live="polite"></p><p class="shape-operation-hint">Blue shows the result. Apply replaces the selected shapes and keeps the bottom shape’s style.</p><div class="shape-operation-actions"><button type="button" class="button" data-operation-cancel>Cancel</button><button type="submit" class="button" data-operation-apply>Apply</button></div></form>`;
  document.body.append(d);
  d.querySelectorAll<HTMLButtonElement>('[data-shape-operation]').forEach(button=>{
   button.onclick=()=>this.setOperation(button.dataset.shapeOperation as ShapeOperation);
   button.onkeydown=event=>{
    const keys=['ArrowDown','ArrowRight','ArrowUp','ArrowLeft','Home','End'];if(!keys.includes(event.key))return;event.preventDefault();
    const kinds=Object.keys(OPERATION_LABELS) as ShapeOperation[],index=kinds.indexOf(this.operation),next=event.key==='Home'?0:event.key==='End'?2:(index+(['ArrowUp','ArrowLeft'].includes(event.key)?2:1))%3;
    this.setOperation(kinds[next]);d.querySelector<HTMLButtonElement>('[aria-checked="true"]')!.focus();
   };
  });
  d.querySelector('[data-operation-cancel]')!.addEventListener('click',()=>this.close());
  d.querySelector('form')!.onsubmit=event=>{event.preventDefault();this.apply();};
  d.addEventListener('cancel',event=>{event.preventDefault();this.close();});
  d.addEventListener('keydown',event=>event.stopPropagation());
  d.addEventListener('click',event=>{if(event.target===d){const r=d.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)this.close();}});
  window.addEventListener('resize',()=>this.position());
  window.visualViewport?.addEventListener('resize',()=>this.position());
 }
 open(operation:ShapeOperation='weld'):void {
  if(!this.available||document.querySelector('dialog[open]'))return;
  this.editor.cancel();this.editor.nodes.closeMenu();this.sources=[...this.editor.selectedItems];
  this.setOperation(operation);this.dialog.showModal();this.position();this.dialog.querySelector<HTMLButtonElement>('[aria-checked="true"]')!.focus({preventScroll:true});
 }
 private position():void {
  if(!this.dialog.open)return;
  const viewport=window.visualViewport,left=viewport?.offsetLeft??0,top=viewport?.offsetTop??0,width=viewport?.width??innerWidth,height=viewport?.height??innerHeight;
  const menu=document.getElementById('selection-menu')!.getBoundingClientRect(),button=document.querySelector('[data-shape-operations-open]')!.getBoundingClientRect(),d=this.dialog;
  d.style.maxWidth=`${Math.max(0,width-16)}px`;d.style.maxHeight=`${Math.max(0,height-16)}px`;
  const x=Math.max(left+8,Math.min(button.left,left+width-d.offsetWidth-8));
  const above=menu.top-d.offsetHeight,y=above>=top+8?above:menu.bottom+d.offsetHeight<=top+height-8?menu.bottom:Math.max(top+8,top+height-d.offsetHeight-8);
  d.style.left=`${x}px`;d.style.top=`${y}px`;
 }
 private setOperation(operation:ShapeOperation):void {
  this.operation=operation;
  for(const button of this.dialog.querySelectorAll<HTMLButtonElement>('[data-shape-operation]')){const selected=button.dataset.shapeOperation===operation;button.setAttribute('aria-checked',String(selected));button.tabIndex=selected?0:-1;}
  this.preview();this.position();
 }
 private validSources():boolean{return this.sources.length===this.editor.selectedItems.length&&this.sources.every(s=>this.editor.objects.includes(s)&&this.editor.selectedItems.includes(s))&&eligibleForShapeOperation(this.sources);}
 private dispose():void {this.result?.remove();this.result=null;this.ghost?.remove();this.ghost=null;}
 private preview():boolean {
  this.dispose();const feedback=this.dialog.querySelector<HTMLElement>('.shape-operation-feedback')!,apply=this.dialog.querySelector<HTMLButtonElement>('[data-operation-apply]')!;
  try{
   if(!this.validSources())throw new Error('The selection changed. Close this menu and select the shapes again.');
   this.result=buildShapeOperation(this.sources,this.operation);
   feedback.textContent=`${this.sources.length} shapes → 1 ${this.result instanceof paper.CompoundPath?'compound shape':'shape'}`;feedback.classList.remove('is-error');apply.disabled=false;this.hooks.changed();return true;
  }catch(error){feedback.textContent=(error as Error).message;feedback.classList.add('is-error');apply.disabled=true;this.hooks.changed();return false;}
 }
 private apply():void {
  if(!this.preview()||!this.result)return;
  const sources=this.sources,result=this.result;this.result=null;this.cancel();this.hooks.apply(sources,result);this.editor.canvas.focus({preventScroll:true});
 }
 cancel():void {this.dispose();this.sources=[];if(this.dialog.open)this.dialog.close();}
 private close():void {this.editor.cancel();const trigger=document.querySelector<HTMLButtonElement>('[data-shape-operations-open]');if(trigger&&!trigger.disabled)trigger.focus({preventScroll:true});else this.editor.canvas.focus({preventScroll:true});}
 draw():void {
  if(!this.result||this.ghost)return;
  const color=getComputedStyle(document.documentElement).getPropertyValue('--chrome-accent').trim();
  this.ghost=this.result.clone({insert:false});this.ghost.data={role:'boolean-preview',control:'boolean-preview'};
  this.ghost.strokeColor=new paper.Color(color);this.ghost.strokeWidth=2.5;this.ghost.strokeScaling=false;this.ghost.dashArray=[];
  this.ghost.fillColor=new paper.Color(color);this.ghost.fillColor.alpha=.16;this.ghost.opacity=1;this.editor.overlays.addChild(this.ghost);
 }
}
