import {ColourPanel,type Paint} from './colourPanel';

/** A shared picker outside scrolling docks, anchored to the colour being edited. */
export class ColourPopover {
 private root=document.createElement('div');
 private picker:ColourPanel;
 private anchor:HTMLButtonElement|null=null;
 private change:((paint:Paint,commit:boolean)=>void)|null=null;
 private openingAnchor:{left:number;top:number}|null=null;
 private placement:{left:number;top:number}|null=null;
 private drag:{id:number;x:number;y:number;left:number;top:number;placement:{left:number;top:number}|null}|null=null;
 private header:HTMLElement;
 constructor(owner:HTMLElement,idPrefix='paint',private onClose:()=>void=()=>{}){
  this.root.className='colour-panel colour-popover';this.root.id=`${idPrefix}-colour-popover`;this.root.hidden=true;
  this.root.setAttribute('role','dialog');document.body.append(this.root);
  this.picker=new ColourPanel(this.root,(paint,commit)=>this.change?.(paint,commit),()=>this.close(true),()=>{},false,`${idPrefix}-picker`);
  this.root.querySelector('.panel-eyebrow')!.remove();this.root.querySelector('[data-colour-none]')!.remove();this.root.querySelector('.colour-hint')!.remove();
  this.root.querySelector('[aria-label="Close Colour panel"]')!.setAttribute('aria-label','Close colour picker');
  this.header=this.root.querySelector<HTMLElement>('.layers-header')!;
  const handle=this.header.querySelector<HTMLElement>('.layer-heading')!,tokens=getComputedStyle(document.documentElement);
  handle.tabIndex=0;handle.setAttribute('role','button');handle.setAttribute('aria-label','Move colour picker');handle.title='Drag to move. Arrow keys move; Shift moves faster.';
  this.header.addEventListener('pointerdown',event=>{
   if(event.button!==0||!event.isPrimary||this.drag||(event.target as Element).closest('button'))return;
   event.preventDefault();handle.focus({preventScroll:true});const box=this.root.getBoundingClientRect();
   this.drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:box.left,top:box.top,placement:this.placement?{...this.placement}:null};
   this.header.setPointerCapture(event.pointerId);this.root.classList.add('is-dragging');
  });
  this.header.addEventListener('pointermove',event=>{
   if(this.drag?.id!==event.pointerId)return;
   this.placement={left:this.drag.left+event.clientX-this.drag.x,top:this.drag.top+event.clientY-this.drag.y};this.position();
  });
  this.header.addEventListener('pointerup',event=>{if(this.drag?.id===event.pointerId)this.finishDrag();});
  this.header.addEventListener('pointercancel',()=>this.finishDrag(true));
  this.header.addEventListener('lostpointercapture',()=>this.finishDrag(true));
  window.addEventListener('blur',()=>this.finishDrag(true));
  handle.addEventListener('keydown',event=>{
   if(event.key==='Escape'&&this.drag){event.preventDefault();event.stopPropagation();this.finishDrag(true);return;}
   const direction=({ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]} as Record<string,number[]>)[event.key];
   if(!direction)return;event.preventDefault();event.stopPropagation();if(this.drag)return;
   const step=parseFloat(tokens.getPropertyValue(event.shiftKey?'--drag-step-large':'--drag-step')),box=this.root.getBoundingClientRect();
   this.placement={left:box.left+direction[0]*step,top:box.top+direction[1]*step};this.position();
  });
  document.addEventListener('pointerdown',event=>{if(!this.root.hidden&&!this.root.contains(event.target as Node)&&!this.anchor?.contains(event.target as Node))this.close();},true);
  document.addEventListener('focusin',event=>{if(!this.root.hidden&&!this.root.contains(event.target as Node)&&!this.anchor?.contains(event.target as Node))this.close();});
  document.addEventListener('scroll',event=>{
   if(this.root.hidden||this.root.contains(event.target as Node))return;
   // A click can finish scrolling its anchor before opening; its queued scroll
   // event must not dismiss the newly opened picker at that same position.
   const box=this.anchor?.getBoundingClientRect();
   if(box&&this.openingAnchor&&(event.target as Node)?.contains(this.anchor)&&Math.abs(box.left-this.openingAnchor.left)<.5&&Math.abs(box.top-this.openingAnchor.top)<.5)return;
   this.close();
  },true);
  window.addEventListener('resize',()=>{this.finishDrag();this.position();});
  new ResizeObserver(()=>this.position()).observe(this.root);
  new MutationObserver(()=>{if(owner.hidden)this.close();}).observe(owner,{attributes:true,attributeFilter:['hidden']});
 }
 open(anchor:HTMLButtonElement,title:string,paint:Paint,opacity:boolean,change:(paint:Paint,commit:boolean)=>void):void {
  if(this.anchor===anchor&&!this.root.hidden){this.close(true);return;}
  this.close();this.placement=null;this.anchor=anchor;this.change=change;
  this.root.setAttribute('aria-label',title);this.root.querySelector('.panel-title')!.textContent=title;
  this.root.classList.toggle('colour-popover-solid',!opacity);this.picker.set(paint);
  this.root.querySelector<HTMLElement>('.colour-error')!.hidden=true;this.root.querySelector('input[aria-invalid]')?.removeAttribute('aria-invalid');
  anchor.setAttribute('aria-expanded','true');this.root.hidden=false;this.position();const box=anchor.getBoundingClientRect();this.openingAnchor={left:box.left,top:box.top};this.root.querySelector<HTMLElement>('.colour-plane')!.focus({preventScroll:true});
 }
 close(restoreFocus=false):void {
  if(this.root.hidden)return;
  this.finishDrag(true);
  // Commit a typed value before removing its target callback.
  if(document.activeElement instanceof HTMLElement&&this.root.contains(document.activeElement))document.activeElement.blur();
  const anchor=this.anchor;this.root.hidden=true;anchor?.setAttribute('aria-expanded','false');this.anchor=null;this.openingAnchor=null;this.change=null;this.onClose();
  if(restoreFocus&&anchor?.isConnected)anchor.focus({preventScroll:true});
 }
 private finishDrag(cancel=false):void {
  const drag=this.drag;this.drag=null;if(!drag)return;
  if(cancel)this.placement=drag.placement;
  this.root.classList.remove('is-dragging');
  if(this.header.hasPointerCapture(drag.id))this.header.releasePointerCapture(drag.id);
  this.position();
 }
 private position():void {
  if(this.root.hidden||!this.anchor)return;
  if(!this.anchor.isConnected||!this.anchor.getClientRects().length){this.close();return;}
  const anchor=this.anchor.getBoundingClientRect(),box=this.root.getBoundingClientRect(),margin=8;
  let left=anchor.left-box.width;if(left<margin)left=anchor.right;
  left=Math.max(margin,Math.min(this.placement?.left??left,innerWidth-box.width-margin));
  const top=Math.max(margin,Math.min(this.placement?.top??anchor.top,innerHeight-box.height-margin));
  this.root.style.left=`${left}px`;this.root.style.top=`${top}px`;
  if(this.placement)this.placement={left,top};
 }
}
