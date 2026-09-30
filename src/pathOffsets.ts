import paper from 'paper';
import type {CADEditor} from './editor';
import type {Shape} from './types';
import {createPathOffset,initializeClipper,offsetEligible,type OffsetSettings} from './clipperService';

type Copy={source:Shape;copy:Shape};
export class PathOffsets {
 readonly dialog=document.createElement('dialog');
 private sources:Shape[]=[];
 private copies:Copy[]=[];
 private previewGroup:paper.Group|null=null;
 private timer:ReturnType<typeof setTimeout>|undefined;
 private anchor:HTMLElement|null=null;
 private picking=false;
 private previousCursor='';
 get active():boolean{return this.sources.length>0;}
 get available():boolean{return !this.editor.hasPendingGesture&&!this.editor.textEditing&&(this.editor.selectedItems.length===0||this.editor.selectedItems.length<=100&&this.editor.selectedItems.every(offsetEligible));}
 constructor(private editor:CADEditor,private hooks:{changed:()=>void;apply:(copies:Copy[])=>void}){
  const d=this.dialog;d.id='offset-dialog';d.className='offset-dialog menu-surface';d.setAttribute('aria-label','Offset path');
  d.innerHTML=`<form><h2>Offset path</h2><div class="offset-source"><span data-offset-source>No path selected</span><button type="button" class="button" data-offset-pick>Select path</button></div><label class="pattern-field">Distance<span class="number-shell"><input data-offset-distance class="number-input" aria-label="Distance" type="number" min="0.001" max="10000" step="any" value="2" required><span class="number-unit" aria-hidden="true">mm</span></span></label><div class="offset-options"><label class="pattern-field">Direction<select aria-label="Direction" data-offset-direction><option value="outward">Outward</option><option value="inward">Inward</option></select></label><label class="pattern-field">Corners<select aria-label="Corners" data-offset-corners><option value="round">Round</option><option value="sharp">Sharp</option><option value="bevel">Bevel</option></select></label></div><p class="pattern-feedback" role="status" aria-live="polite"></p><p class="pattern-hint">Creates unfilled paths on the original layers. Originals stay unchanged.</p><div class="pattern-actions"><button type="button" class="button" data-offset-cancel>Cancel</button><button type="submit" class="button" data-offset-create>Create offset</button></div></form>`;
  document.body.append(d);
  d.addEventListener('input',()=>{this.dispose();this.createButton.disabled=true;this.feedback.classList.remove('is-error');this.feedback.textContent=this.active?'Updating preview…':'Select a closed path to offset.';this.hooks.changed();clearTimeout(this.timer);if(this.active)this.timer=setTimeout(()=>this.preview(),70);});
  d.querySelector('[data-offset-cancel]')!.addEventListener('click',()=>this.close());
  d.querySelector('[data-offset-pick]')!.addEventListener('click',()=>this.startPicking());
  d.querySelector('form')!.onsubmit=event=>{event.preventDefault();clearTimeout(this.timer);if(!this.preview())return;const copies=this.copies;this.copies=[];this.cancel();this.hooks.apply(copies);this.editor.canvas.focus({preventScroll:true});};
  d.addEventListener('cancel',event=>{event.preventDefault();this.close();});
  d.addEventListener('keydown',event=>event.stopPropagation());
  d.addEventListener('click',event=>{if(event.target!==d)return;const r=d.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)this.close();});
  window.addEventListener('resize',()=>this.position());window.visualViewport?.addEventListener('resize',()=>this.position());
 }
 private get createButton(){return this.dialog.querySelector<HTMLButtonElement>('[data-offset-create]')!;}
 private get feedback(){return this.dialog.querySelector<HTMLElement>('.pattern-feedback')!;}
 open(anchor?:HTMLElement):void {
  if(!this.available||document.querySelector('dialog[open]'))return;
  this.editor.cancel();this.editor.nodes.closeMenu();this.anchor=anchor??document.querySelector('[data-offset-open]');this.sources=[...this.editor.selectedItems];
  this.dialog.querySelector<HTMLElement>('[data-offset-source]')!.textContent=this.sources.length===1?String(this.sources[0].data.name??'1 selected path'):this.sources.length?`${this.sources.length} selected paths`:'No path selected';
  this.dialog.showModal();this.position();this.createButton.disabled=true;this.feedback.classList.remove('is-error');this.feedback.textContent=this.sources.length?'Preparing preview…':'Select a closed path to offset.';this.hooks.changed();
  (this.sources.length?this.dialog.querySelector<HTMLInputElement>('[data-offset-distance]')!:this.dialog.querySelector<HTMLButtonElement>('[data-offset-pick]')!).focus();
  void initializeClipper().then(()=>{if(this.active)this.preview();}).catch(error=>{if(this.active){this.feedback.textContent=(error as Error).message;this.feedback.classList.add('is-error');}});
 }
 private startPicking():void {
  const anchor=this.anchor;
  this.cancel();this.editor.setTool('select');
  this.anchor=anchor;this.picking=true;this.previousCursor=this.editor.canvas.style.cursor;
  this.editor.canvas.style.cursor='crosshair';
  this.editor.canvas.addEventListener('pointerdown',this.pickPointerDown,true);
  window.addEventListener('keydown',this.pickKeyDown,true);window.addEventListener('blur',this.stopPicking);
  this.editor.canvas.focus({preventScroll:true});
  this.editor.onMessage('Click a visible, unlocked closed path. Press Escape to cancel.','information');
 }
 private pickPointerDown=(event:PointerEvent):void=>{
  if(!this.picking||event.button!==0)return;
  event.preventDefault();event.stopImmediatePropagation();
  const rect=this.editor.canvas.getBoundingClientRect();
  const point=paper.view.viewToProject(new paper.Point(event.clientX-rect.left,event.clientY-rect.top));
  const source=this.editor.hitObject(point);
  if(!source||!offsetEligible(source)){this.editor.onMessage('Select a visible, unlocked closed path.','warning');return;}
  const anchor=this.anchor;this.stopPicking();this.editor.select(source);
  setTimeout(()=>this.open(anchor??undefined),0);
 };
 private pickKeyDown=(event:KeyboardEvent):void=>{
  if(event.key!=='Escape')return;
  event.preventDefault();event.stopImmediatePropagation();this.stopPicking();this.editor.canvas.focus({preventScroll:true});
 };
 private stopPicking=():void=>{
  if(!this.picking)return;
  this.picking=false;this.editor.canvas.removeEventListener('pointerdown',this.pickPointerDown,true);
  window.removeEventListener('keydown',this.pickKeyDown,true);window.removeEventListener('blur',this.stopPicking);
  this.editor.canvas.style.cursor=this.previousCursor;
 };
 private position():void {
  if(!this.dialog.open)return;
  const viewport=window.visualViewport,left=(viewport?.offsetLeft??0)+4,right=left+(viewport?.width??innerWidth)-8;
  const top=Math.max((viewport?.offsetTop??0)+4,(document.querySelector('.document-tabs')??document.querySelector('.top-toolbar'))?.getBoundingClientRect().bottom??0);
  const bottom=Math.min((viewport?.offsetTop??0)+(viewport?.height??innerHeight)-4,document.querySelector('.ruler-bottom')?.getBoundingClientRect().top??innerHeight);
  this.dialog.style.maxHeight=`${Math.max(80,bottom-top)}px`;this.dialog.style.maxWidth=`${right-left}px`;
  const anchor=this.anchor?.getBoundingClientRect(),r=this.dialog.getBoundingClientRect();
  const x=Math.max(left,Math.min(anchor?.left??left,right-r.width));
  const y=anchor&&anchor.top-r.height>=top?anchor.top-r.height:anchor&&anchor.bottom+r.height<=bottom?anchor.bottom:Math.max(top,bottom-r.height);
  this.dialog.style.left=`${x}px`;this.dialog.style.top=`${y}px`;
 }
 private settings():OffsetSettings{return {distance:this.dialog.querySelector<HTMLInputElement>('[data-offset-distance]')!.valueAsNumber,direction:this.dialog.querySelector<HTMLSelectElement>('[data-offset-direction]')!.value as OffsetSettings['direction'],corners:this.dialog.querySelector<HTMLSelectElement>('[data-offset-corners]')!.value as OffsetSettings['corners']};}
 private dispose():void {this.previewGroup?.remove();this.previewGroup=null;this.copies.forEach(({copy})=>copy.remove());this.copies=[];}
 private preview():boolean {
  this.dispose();
  try{
   if(!this.active||this.sources.length!==this.editor.selectedItems.length||!this.sources.every(s=>this.editor.objects.includes(s)&&this.editor.selectedItems.includes(s)&&offsetEligible(s)))throw new Error('Select visible, unlocked closed paths.');
   if(this.sources.reduce((sum,s)=>sum+(s instanceof paper.Path?s.curves.length:(s.children as paper.Path[]).reduce((n,p)=>n+p.curves.length,0)),0)>2000)throw new Error('This selection is too complex to offset.');
   for(const source of this.sources)this.copies.push({source,copy:createPathOffset(source,this.settings())});
   this.feedback.textContent=`${this.copies.length} offset${this.copies.length===1?'':'s'} · Blue shows the new paths`;
   this.feedback.classList.remove('is-error');this.createButton.disabled=false;this.hooks.changed();this.position();return true;
  }catch(error){this.dispose();this.feedback.textContent=(error as Error).message;this.feedback.classList.add('is-error');this.createButton.disabled=true;this.hooks.changed();this.position();return false;}
 }
 cancel():void {this.stopPicking();clearTimeout(this.timer);this.dispose();this.sources=[];if(this.dialog.open)this.dialog.close();}
 private close():void {const anchor=this.anchor;this.cancel();this.hooks.changed();if(anchor?.isConnected&&!anchor.hidden)anchor.focus({preventScroll:true});else this.editor.canvas.focus({preventScroll:true});}
 draw():void {
  if(!this.active||this.previewGroup)return;
  const color=getComputedStyle(document.documentElement).getPropertyValue('--chrome-accent').trim();
  this.previewGroup=new paper.Group({insert:false,data:{role:'offset-preview',control:'offset-preview'}});
  for(const {copy} of this.copies){const ghost=copy.clone({insert:false});ghost.strokeColor=new paper.Color(color);ghost.fillColor=null;ghost.strokeWidth=1.5;ghost.strokeScaling=false;ghost.opacity=.8;ghost.data={role:'overlay'};this.previewGroup.addChild(ghost);}
  this.editor.overlays.addChild(this.previewGroup);
 }
}
