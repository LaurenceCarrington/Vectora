import paper from 'paper';
import type {CADEditor} from './editor';
import type {Shape} from './types';
import {validNumber} from './units';
import {dimensionLabel} from './dimensions';
import {buildObjectPattern,type PatternKind,type PatternSettings,type PatternCopy} from './objectPatternGeometry';

type Hooks={changed:()=>void;apply:(copies:PatternCopy[])=>void;snap:(point:paper.Point)=>paper.Point};
/** Non-destructive array preview. Only Apply inserts the prepared copies into document layers. */
export class ObjectPatterns {
 readonly dialog=document.createElement('dialog');
 private sources:Shape[]=[];
 private copies:PatternCopy[]=[];
 private previewGroup:paper.Group|null=null;
 private anchor=new paper.Point(0,0);
 private kind:PatternKind='rectangular';
 private pickPoint:paper.Point|null=null;
 private picker=document.createElement('div');
 picking=false;
 get active():boolean{return this.sources.length>0;}
 get available():boolean{return !this.active&&!this.editor.hasPendingGesture&&!this.editor.textEditing&&this.editor.selectedItems.length>0&&this.editor.selectedItems.every(s=>s.visible&&!s.locked&&s.layer.visible&&!s.layer.locked&&!s.layer.data.deleted);}
 constructor(private editor:CADEditor,private hooks:Hooks){
  const d=this.dialog;d.id='pattern-dialog';d.className='pattern-dialog menu-surface';d.setAttribute('aria-label','Pattern');
  const field=(name:string,label:string,value:number,unit='',min=-1_000_000,max=1_000_000,step='any')=>`<label class="pattern-field" for="pattern-${name}">${label}<span class="number-shell"><input id="pattern-${name}" data-pattern-field="${name}" aria-label="${label}" class="number-input" type="number" min="${min}" max="${max}" step="${step}" value="${value}" required>${unit?`<span class="number-unit" aria-hidden="true">${unit}</span>`:''}</span></label>`;
  d.innerHTML=`<form><h2>Pattern</h2><div class="pattern-tabs" role="tablist" aria-label="Pattern type"><button type="button" role="tab" id="pattern-tab-rectangular" aria-controls="pattern-rectangular" aria-selected="true" data-pattern-kind="rectangular"><svg aria-hidden="true"><use href="#i-pattern-rectangular"/></svg>Rectangular</button><button type="button" role="tab" id="pattern-tab-circular" aria-controls="pattern-circular" aria-selected="false" tabindex="-1" data-pattern-kind="circular"><svg aria-hidden="true"><use href="#i-pattern-circular"/></svg>Circular</button></div><div id="pattern-rectangular" role="tabpanel" aria-labelledby="pattern-tab-rectangular"><div class="pattern-fields">${field('columns','Columns',2,'',1,1000,'1')}${field('rows','Rows',2,'',1,1000,'1')}${field('dx','Column spacing',20,'mm')}${field('dy','Row spacing',20,'mm')}</div><p class="pattern-hint">Spacing is the repeat distance. Negative values repeat left or up.</p></div><div id="pattern-circular" role="tabpanel" aria-labelledby="pattern-tab-circular" hidden><div class="pattern-fields">${field('count','Instances',6,'',2,1000,'1')}${field('angle','Total angle',360,'°',-360,360)}${field('cx','Centre X',0,'mm')}${field('cy','Centre Y',0,'mm')}</div><button type="button" class="button pattern-pick" data-pattern-pick><svg aria-hidden="true"><use href="#i-pattern-centre"/></svg>Pick centre on canvas</button><label class="pattern-rotate"><input type="checkbox" checked data-pattern-rotate>Rotate copies</label><p class="pattern-hint">Positive angles run clockwise. A full turn has no duplicate at the end.</p></div><p class="pattern-feedback" role="status" aria-live="polite"></p><p class="pattern-hint">Counts include the original. Blue shows new copies; Apply keeps them individually editable.</p><div class="pattern-actions"><button type="button" class="button" data-pattern-cancel>Cancel</button><button type="submit" class="button" data-pattern-apply>Apply</button></div></form>`;
  this.picker.className='pattern-pick-status menu-surface';this.picker.hidden=true;this.picker.innerHTML='<span>Click a centre on the canvas · Esc to return</span><button type="button" class="button">Cancel pick</button>';
  document.body.append(d,this.picker);
  d.querySelectorAll<HTMLInputElement>('input').forEach(input=>input.addEventListener('input',()=>this.preview()));
  d.querySelectorAll<HTMLButtonElement>('[data-pattern-kind]').forEach(button=>{button.onclick=()=>this.setKind(button.dataset.patternKind as PatternKind);button.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();this.setKind(event.key==='Home'?'rectangular':event.key==='End'?'circular':this.kind==='rectangular'?'circular':'rectangular');d.querySelector<HTMLButtonElement>('[aria-selected="true"]')!.focus();};});
  d.querySelector('[data-pattern-cancel]')!.addEventListener('click',()=>this.close());
  d.querySelector('[data-pattern-pick]')!.addEventListener('click',()=>this.startPick());
  d.querySelector('form')!.onsubmit=event=>{event.preventDefault();this.apply();};
  d.addEventListener('cancel',event=>{event.preventDefault();this.close();});
  d.addEventListener('keydown',event=>event.stopPropagation());
  this.picker.querySelector('button')!.onclick=()=>this.endPick();
  document.addEventListener('pointerdown',event=>{if(this.picking&&event.target!==editor.canvas&&!this.picker.contains(event.target as Node))this.editor.cancel();},true);
  editor.canvas.addEventListener('pointerdown',event=>{if(!this.picking)return;event.preventDefault();event.stopImmediatePropagation();if(event.button!==0)return;const point=this.point(event);this.input('cx').value=String(point.x);this.input('cy').value=String(point.y);this.endPick();},true);
  editor.canvas.addEventListener('pointermove',event=>{if(!this.picking)return;event.stopImmediatePropagation();this.pickPoint=this.point(event);this.hooks.changed();},true);
  editor.canvas.addEventListener('dblclick',event=>{if(this.active){event.preventDefault();event.stopImmediatePropagation();}},true);
  editor.canvas.addEventListener('contextmenu',event=>{if(this.picking){event.preventDefault();event.stopImmediatePropagation();}},true);
  window.addEventListener('keydown',event=>{if(!this.picking)return;event.stopImmediatePropagation();if(event.key==='Tab'){event.preventDefault();(document.activeElement===this.editor.canvas?this.picker.querySelector<HTMLButtonElement>('button')!:this.editor.canvas).focus();return;}if((event.key==='Enter'||event.key===' ')&&this.picker.contains(event.target as Node)){event.preventDefault();this.endPick();return;}event.preventDefault();if(event.key==='Escape')this.endPick();},true);
 }
 private input(name:string):HTMLInputElement{return this.dialog.querySelector<HTMLInputElement>(`[data-pattern-field="${name}"]`)!;}
 open(kind:PatternKind='rectangular'):void {
  if(!this.available||document.querySelector('dialog[open]'))return;
  this.editor.cancel();this.editor.nodes.closeMenu();this.sources=[...this.editor.selectedItems];const bounds=this.editor.selectionBounds!;this.anchor=bounds.center.clone();
  this.input('dx').value=String(Number((bounds.width+10).toFixed(6)));this.input('dy').value=String(Number((bounds.height+10).toFixed(6)));
  this.input('cx').value=String(Number((this.anchor.x-bounds.width-10).toFixed(6)));this.input('cy').value=String(Number(this.anchor.y.toFixed(6)));
  this.setKind(kind);this.dialog.showModal();this.input(kind==='rectangular'?'columns':'count').focus();
 }
 private setKind(kind:PatternKind):void {
  this.kind=kind;
  for(const button of this.dialog.querySelectorAll<HTMLButtonElement>('[data-pattern-kind]')){const selected=button.dataset.patternKind===kind;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;}
  for(const panel of this.dialog.querySelectorAll<HTMLElement>('[role="tabpanel"]')){panel.hidden=panel.id!==`pattern-${kind}`;panel.querySelectorAll<HTMLInputElement>('input').forEach(input=>input.disabled=panel.hidden);}
  this.input('dx').disabled=kind!=='rectangular'||this.input('columns').valueAsNumber===1;this.input('dy').disabled=kind!=='rectangular'||this.input('rows').valueAsNumber===1;
  this.preview();
 }
 private settings():PatternSettings {
  const value=(name:string)=>this.input(name).valueAsNumber;
  return this.kind==='rectangular'?{kind:this.kind,rows:value('rows'),columns:value('columns'),dx:this.input('dx').disabled?0:value('dx'),dy:this.input('dy').disabled?0:value('dy')}:{kind:this.kind,count:value('count'),angle:value('angle'),cx:value('cx'),cy:value('cy'),rotate:this.dialog.querySelector<HTMLInputElement>('[data-pattern-rotate]')!.checked};
 }
 private validSources():boolean{return this.sources.length>0&&this.sources.every(source=>this.editor.objects.includes(source)&&this.editor.selectedItems.includes(source)&&source.visible&&!source.locked&&source.layer.visible&&!source.layer.locked&&!source.layer.data.deleted)&&this.sources.length===this.editor.selectedItems.length;}
 private dispose():void{this.previewGroup?.remove();this.previewGroup=null;this.copies.forEach(({copy})=>copy.remove());this.copies=[];}
 private preview():boolean {
  this.dispose();const feedback=this.dialog.querySelector<HTMLElement>('.pattern-feedback')!,apply=this.dialog.querySelector<HTMLButtonElement>('[data-pattern-apply]')!;
  this.input('dx').disabled=this.kind!=='rectangular'||this.input('columns').valueAsNumber===1;this.input('dy').disabled=this.kind!=='rectangular'||this.input('rows').valueAsNumber===1;
  try{
   if(!this.validSources())throw new Error('Select visible, unlocked objects to repeat.');
   const result=buildObjectPattern(this.sources,this.settings(),this.anchor);this.copies=result.copies;
   feedback.textContent=`${result.instances} instances · ${result.instances*this.sources.length} objects · ${this.copies.length} new`;
   feedback.classList.remove('is-error');apply.disabled=false;this.hooks.changed();return true;
  }catch(error){feedback.textContent=(error as Error).message;feedback.classList.add('is-error');apply.disabled=true;this.hooks.changed();return false;}
 }
 private apply():void {
  if(!this.preview())return;
  const copies=this.copies;this.copies=[];this.cancel();this.hooks.apply(copies);this.editor.canvas.focus({preventScroll:true});
 }
 /** Editor cancellation handles tool changes, Undo, document replacement and window blur. */
 cancel():void {this.dispose();this.sources=[];this.picking=false;this.pickPoint=null;this.picker.hidden=true;if(this.dialog.open)this.dialog.close();this.editor.canvas.classList.remove('pattern-picking');}
 private close():void {this.cancel();this.editor.cancel();this.editor.canvas.focus({preventScroll:true});}
 private startPick():void {this.picking=true;this.pickPoint=null;this.dialog.close();this.picker.hidden=false;this.editor.canvas.classList.add('pattern-picking');this.hooks.changed();this.editor.canvas.focus({preventScroll:true});}
 private endPick():void {if(!this.picking)return;this.picking=false;this.pickPoint=null;this.picker.hidden=true;this.editor.activeObjectSnap=null;this.editor.canvas.classList.remove('pattern-picking');this.dialog.showModal();this.preview();this.dialog.querySelector<HTMLButtonElement>('[data-pattern-pick]')!.focus();}
 private point(event:PointerEvent):paper.Point {const r=this.editor.canvas.getBoundingClientRect();return this.hooks.snap(paper.view.viewToProject(new paper.Point(event.clientX-r.left,event.clientY-r.top)));}
 draw():void {
  if(!this.active)return;
  const color=getComputedStyle(document.documentElement).getPropertyValue('--chrome-accent').trim(),zoom=paper.view.zoom;
  const add=(item:paper.Item)=>{item.data={role:'overlay',control:'pattern-preview'};this.editor.overlays.addChild(item);};
  // Cache preview geometry across pointer movement and zoom; only the centre guide redraws.
  if(!this.previewGroup){
   this.previewGroup=new paper.Group({insert:false,data:{role:'pattern-preview',control:'pattern-preview'}});
   for(const {copy} of this.copies){
    const ghost=copy.clone({insert:false}),label=dimensionLabel(copy);ghost.strokeColor=new paper.Color(color);ghost.strokeWidth=1.5;ghost.strokeScaling=false;ghost.fillColor=copy.fillColor?new paper.Color(color):null;ghost.opacity=.65;ghost.data={role:'overlay'};this.previewGroup.addChild(ghost);
    if(label){label.fillColor=new paper.Color(color);label.opacity=.65;this.previewGroup.addChild(label);}
   }
   this.editor.overlays.addChild(this.previewGroup);
  }
  if(this.kind==='circular'){
   const center=this.pickPoint??new paper.Point(this.input('cx').valueAsNumber,this.input('cy').valueAsNumber);
   if(!validNumber(center.x)||!validNumber(center.y))return;
   const radius=center.getDistance(this.anchor);if(radius>0)add(new paper.Path.Circle({insert:false,center,radius,strokeColor:color,strokeWidth:1/zoom,dashArray:[4/zoom,4/zoom],opacity:.4}));
   const size=6/zoom;add(new paper.Path({insert:false,segments:[center.add([-size,0]),center.add([size,0])],strokeColor:color,strokeWidth:1/zoom}));add(new paper.Path({insert:false,segments:[center.add([0,-size]),center.add([0,size])],strokeColor:color,strokeWidth:1/zoom}));
  }
 }
}
