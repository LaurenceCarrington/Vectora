interface Placement {left:number;top:number}
/** Pointer and keyboard movement for a pop-out whose owner clamps its position. */
export class MovablePopover {
 placement:Placement|null=null;
 private drag:{id:number;x:number;y:number;left:number;top:number;placement:Placement|null}|null=null;
 private header:HTMLElement;
 constructor(private root:HTMLElement,private handle:HTMLElement,label:string,private reposition:()=>void){
  this.header=handle.parentElement!;
  handle.tabIndex=0;handle.setAttribute('role','button');handle.setAttribute('aria-label',label);handle.dataset.popoverGrip='';
  handle.title='Drag to move. Arrow keys move; Shift moves faster.';
  this.header.addEventListener('pointerdown',event=>{
   if(event.button!==0||!event.isPrimary||this.drag||(event.target as Element).closest('button,input,select'))return;
   event.preventDefault();handle.focus({preventScroll:true});const box=root.getBoundingClientRect();
   this.drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:box.left,top:box.top,placement:this.placement?{...this.placement}:null};
   this.header.setPointerCapture(event.pointerId);root.classList.add('is-dragging');
  });
  this.header.addEventListener('pointermove',event=>{
   const drag=this.drag;if(drag?.id!==event.pointerId)return;
   this.placement={left:drag.left+event.clientX-drag.x,top:drag.top+event.clientY-drag.y};this.reposition();
  });
  this.header.addEventListener('pointerup',event=>{if(this.drag?.id===event.pointerId)this.finish();});
  for(const event of ['pointercancel','lostpointercapture'])this.header.addEventListener(event,e=>{if(this.drag?.id===(e as PointerEvent).pointerId)this.finish(true);});
  handle.addEventListener('keydown',event=>{
   if(event.key==='Escape'&&this.drag){event.preventDefault();event.stopPropagation();this.finish(true);return;}
   const direction=({ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]} as Record<string,number[]>)[event.key];
   if(!direction)return;event.preventDefault();event.stopPropagation();if(this.drag)return;
   const tokens=getComputedStyle(document.documentElement),step=parseFloat(tokens.getPropertyValue(event.shiftKey?'--drag-step-large':'--drag-step'))|| (event.shiftKey?10:2),box=root.getBoundingClientRect();
   this.placement={left:box.left+direction[0]*step,top:box.top+direction[1]*step};this.reposition();
  });
  window.addEventListener('blur',()=>this.finish(true));
  window.addEventListener('resize',()=>{this.finish(true);this.reposition();});
  new ResizeObserver(()=>this.reposition()).observe(root);
 }
 /** Keep subsequent adjustments relative to the visible, clamped position. */
 constrain(left:number,top:number):void {if(this.placement)this.placement={left,top};}
 finish(cancel=false):void {
  const drag=this.drag;this.drag=null;if(!drag)return;
  if(cancel)this.placement=drag.placement;
  this.root.classList.remove('is-dragging');
  if(this.header.hasPointerCapture(drag.id))this.header.releasePointerCapture(drag.id);
  this.reposition();
 }
}
