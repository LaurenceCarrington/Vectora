import {ColourPanel,type Paint} from './colourPanel';

/** A shared picker outside scrolling docks, anchored to the colour being edited. */
export class ColourPopover {
 private root=document.createElement('div');
 private picker:ColourPanel;
 private anchor:HTMLButtonElement|null=null;
 private change:((paint:Paint,commit:boolean)=>void)|null=null;
 constructor(owner:HTMLElement){
  this.root.className='colour-panel colour-popover';this.root.id='paint-colour-popover';this.root.hidden=true;
  this.root.setAttribute('role','dialog');document.body.append(this.root);
  this.picker=new ColourPanel(this.root,(paint,commit)=>this.change?.(paint,commit),()=>this.close(true),()=>{},false,'paint-picker');
  this.root.querySelector('.panel-eyebrow')!.remove();this.root.querySelector('[data-colour-none]')!.remove();this.root.querySelector('.colour-hint')!.remove();
  this.root.querySelector('[aria-label="Close Colour panel"]')!.setAttribute('aria-label','Close colour picker');
  document.addEventListener('pointerdown',event=>{if(!this.root.hidden&&!this.root.contains(event.target as Node)&&!this.anchor?.contains(event.target as Node))this.close();},true);
  document.addEventListener('focusin',event=>{if(!this.root.hidden&&!this.root.contains(event.target as Node)&&!this.anchor?.contains(event.target as Node))this.close();});
  document.addEventListener('scroll',event=>{if(!this.root.hidden&&!this.root.contains(event.target as Node))this.close();},true);
  window.addEventListener('resize',()=>this.position());
  new ResizeObserver(()=>this.position()).observe(this.root);
  new MutationObserver(()=>{if(owner.hidden)this.close();}).observe(owner,{attributes:true,attributeFilter:['hidden']});
 }
 open(anchor:HTMLButtonElement,title:string,paint:Paint,opacity:boolean,change:(paint:Paint,commit:boolean)=>void):void {
  if(this.anchor===anchor&&!this.root.hidden){this.close(true);return;}
  this.close();this.anchor=anchor;this.change=change;
  this.root.setAttribute('aria-label',title);this.root.querySelector('.panel-title')!.textContent=title;
  this.root.classList.toggle('colour-popover-solid',!opacity);this.picker.set(paint);
  this.root.querySelector<HTMLElement>('.colour-error')!.hidden=true;this.root.querySelector('input[aria-invalid]')?.removeAttribute('aria-invalid');
  anchor.setAttribute('aria-expanded','true');this.root.hidden=false;this.position();this.root.querySelector<HTMLElement>('.colour-plane')!.focus({preventScroll:true});
 }
 close(restoreFocus=false):void {
  if(this.root.hidden)return;
  // Commit a typed value before removing its target callback.
  if(document.activeElement instanceof HTMLElement&&this.root.contains(document.activeElement))document.activeElement.blur();
  const anchor=this.anchor;this.root.hidden=true;anchor?.setAttribute('aria-expanded','false');this.anchor=null;this.change=null;
  if(restoreFocus&&anchor?.isConnected)anchor.focus({preventScroll:true});
 }
 private position():void {
  if(this.root.hidden||!this.anchor)return;
  if(!this.anchor.isConnected||!this.anchor.getClientRects().length){this.close();return;}
  const anchor=this.anchor.getBoundingClientRect(),box=this.root.getBoundingClientRect(),margin=8;
  let left=anchor.left-box.width;if(left<margin)left=anchor.right;
  this.root.style.left=`${Math.max(margin,Math.min(left,innerWidth-box.width-margin))}px`;
  this.root.style.top=`${Math.max(margin,Math.min(anchor.top,innerHeight-box.height-margin))}px`;
 }
}
