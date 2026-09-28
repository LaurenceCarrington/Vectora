import paper from 'paper';
import {canRoundCorner,editCorners,type CornerKind} from './cornerGeometry';
import type { CADEditor } from './editor';
import type { DocumentSnapshot, Shape } from './types';
import { pathsOf } from './geometry';
import { documentPath } from './deletion';
import { validNumber } from './units';

type Target={uid:string;contour:number;index:number};
type Part='point'|'handleIn'|'handleOut';
type Hooks={changed:()=>void;commit:(before:DocumentSnapshot)=>void;restore:(before:DocumentSnapshot)=>void;snap:(point:paper.Point,spacing:number|null)=>paper.Point};
export class NodeEditing {
  private active:Target|null=null;
  private corners:Target[]=[];
  private cornerKind:CornerKind='fillet';
  private cornerPlans:{owner:Shape;path:paper.Path;preview:paper.Path}[]=[];
  readonly cornerDialog=document.createElement('dialog');
  private lastSizes={fillet:3,chamfer:3};
  get canEditCorners():boolean{return !this.drag&&this.corners.length>0&&this.corners.every(target=>{const r=this.resolve(target);return !!r&&canRoundCorner(r.path,target.index);});}
  private drag:{id:number;before:DocumentSnapshot;part:Part;start:paper.Point;point:paper.Point;handleIn:paper.Point;handleOut:paper.Point;spacing:number|null;moved:boolean}|null=null;
  readonly menu=document.createElement('div');
  get dragging():boolean{return !!this.drag;}
  constructor(private editor:CADEditor,private hooks:Hooks){
    this.menu.className='node-context-menu menu-surface';this.menu.hidden=true;this.menu.setAttribute('role','menu');this.menu.setAttribute('aria-label','Node actions');
    for(const [action,label,icon] of [['fillet','Fillet','fillet'],['chamfer','Chamfer','chamfer'],['smooth','Smooth node','node-smooth'],['corner','Corner node','node-corner'],['split','Split path','node-split'],['delete','Delete node','delete']]){
      const button=document.createElement('button');button.type='button';button.className='node-action';button.dataset.nodeAction=action;button.setAttribute('role','menuitem');
      button.innerHTML=`<svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-${icon}"/></svg><span>${label}</span>`;
      button.onclick=()=>{if(action==='fillet'||action==='chamfer'){this.openCorner(action);return;}try{this.action(action);}catch(error){editor.onMessage((error as Error).message,true);}this.closeMenu();editor.canvas.focus({preventScroll:true});};this.menu.append(button);
    }
    editor.canvas.parentElement!.append(this.menu);
    this.setupCornerDialog();
    document.addEventListener('pointerdown',event=>{if(!this.menu.contains(event.target as Node))this.closeMenu();});
    this.menu.addEventListener('keydown',event=>{
      event.stopPropagation();
      if(event.key==='Escape'){event.preventDefault();this.closeMenu();editor.canvas.focus();}
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
        event.preventDefault();const buttons=Array.from(this.menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')),index=buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();
      }
    });
  }
  closeMenu():void{this.menu.hidden=true;}
  clear():void{this.closeCorner();this.active=null;this.corners=[];this.closeMenu();}
  private same(a:Target,b:Target):boolean{return a.uid===b.uid&&a.contour===b.contour&&a.index===b.index;}
  private setupCornerDialog():void {
    const d=this.cornerDialog;d.id='corner-dialog';d.className='corner-dialog menu-surface';d.setAttribute('aria-labelledby','corner-title');
    d.innerHTML=`<form method="dialog"><h2 id="corner-title">Fillet</h2><p class="corner-count"></p><label class="corner-field"><span data-corner-label>Radius</span><span class="number-shell"><input class="number-input" type="number" min="0.001" max="1000000" step="any" value="3" required data-corner-size><span class="number-unit">mm</span></span></label><p class="corner-feedback" role="status" aria-live="polite"></p><p class="corner-hint">Blue shows the new outline. Apply replaces the selected corners.</p><div class="corner-actions"><button type="button" class="button" data-corner-cancel>Cancel</button><button type="submit" class="button" data-corner-apply>Apply</button></div></form>`;
    document.body.append(d);d.querySelector<HTMLInputElement>('[data-corner-size]')!.oninput=()=>this.previewCorners();
    d.querySelector<HTMLButtonElement>('[data-corner-cancel]')!.onclick=()=>this.closeCorner(true);
    d.querySelector('form')!.onsubmit=event=>{event.preventDefault();this.applyCorners();};
    d.addEventListener('cancel',event=>{event.preventDefault();this.closeCorner(true);});
    d.addEventListener('keydown',event=>event.stopPropagation());
    d.addEventListener('close',()=>{if(!d.open){this.disposeCorners();this.hooks.changed();}});
  }
  openCorner(kind:CornerKind):void {
    if(!this.canEditCorners||document.querySelector('dialog[open]'))return;
    this.closeMenu();this.cornerKind=kind;this.cornerDialog.querySelector('h2')!.textContent=kind==='fillet'?'Fillet':'Chamfer';
    this.cornerDialog.querySelector('[data-corner-label]')!.textContent=kind==='fillet'?'Radius':'Distance';
    this.cornerDialog.querySelector('.corner-count')!.textContent=`${this.corners.length} ${this.corners.length===1?'corner':'corners'} selected`;
    const input=this.cornerDialog.querySelector<HTMLInputElement>('[data-corner-size]')!;input.value=String(this.lastSizes[kind]);this.cornerDialog.showModal();this.previewCorners();input.focus();input.select();
  }
  private disposeCorners():void {this.cornerPlans.forEach(p=>p.preview.remove());this.cornerPlans=[];}
  private closeCorner(focus=false):void {this.disposeCorners();if(this.cornerDialog.open)this.cornerDialog.close();if(focus){this.hooks.changed();this.editor.canvas.focus({preventScroll:true});}}
  private previewCorners():boolean {
    this.disposeCorners();const input=this.cornerDialog.querySelector<HTMLInputElement>('[data-corner-size]')!,feedback=this.cornerDialog.querySelector<HTMLElement>('.corner-feedback')!,apply=this.cornerDialog.querySelector<HTMLButtonElement>('[data-corner-apply]')!;
    try{
      if(!this.canEditCorners)throw new Error('Select editable corners between straight edges.');
      const groups=new Map<paper.Path,{owner:Shape;indices:number[]}>();for(const target of this.corners){const {owner,path}=this.resolve(target)!;const group=groups.get(path)??{owner,indices:[]};group.indices.push(target.index);groups.set(path,group);}
      for(const [path,group] of groups)this.cornerPlans.push({owner:group.owner,path,preview:editCorners(path,group.indices,this.cornerKind,input.valueAsNumber)});
      feedback.textContent=this.cornerKind==='fillet'?'Tangent rounding at the entered radius.':'Distance is measured along each adjoining edge.';feedback.classList.remove('is-error');input.setAttribute('aria-invalid','false');apply.disabled=false;this.hooks.changed();return true;
    }catch(error){this.disposeCorners();feedback.textContent=(error as Error).message;feedback.classList.add('is-error');input.setAttribute('aria-invalid','true');apply.disabled=true;this.hooks.changed();return false;}
  }
  private applyCorners():void {
    if(!this.previewCorners())return;const before=this.editor.snapshot();
    // Precompute all local geometry before touching any contour, preserving parent transforms.
    const edits=this.cornerPlans.map(({owner,path,preview})=>({owner,path,segments:preview.segments.map(s=>{const p=path.globalToLocal(s.point);return new paper.Segment(p,path.globalToLocal(s.point.add(s.handleIn)).subtract(p),path.globalToLocal(s.point.add(s.handleOut)).subtract(p));})}));
    for(const {owner,path,segments} of edits){path.removeSegments();path.addSegments(segments);this.markEdited(owner);}
    this.lastSizes[this.cornerKind]=this.cornerDialog.querySelector<HTMLInputElement>('[data-corner-size]')!.valueAsNumber;this.active=null;this.corners=[];this.closeCorner();this.hooks.commit(before);this.editor.canvas.focus({preventScroll:true});
  }
  private editable(owner:Shape):boolean{return owner.visible&&!owner.locked&&owner.layer.visible&&!owner.layer.locked&&!owner.data.text&&!owner.data.dimension;}
  private resolve(target=this.active){
    const owner=this.editor.selectedItems.find(item=>item.data.uid===target?.uid);
    if(!owner||!target||!this.editable(owner))return null;
    const path=pathsOf(owner)[target.contour],segment=path?.segments[target.index];return segment?{owner,path,segment}:null;
  }
  private markEdited(owner:Shape):void{delete owner.data.arc;delete owner.data.sides;}
  private nodeHit(point:paper.Point):{target:Target;part:Part}|null{
    const resolved=this.resolve();
    if(resolved)for(const part of ['handleIn','handleOut'] as const){
      const {path,segment}=resolved;
      if(!segment[part].isZero()&&path.localToGlobal(segment.point.add(segment[part])).getDistance(point)<=7/paper.view.zoom)return {target:this.active!,part};
    }
    let nearest:{target:Target;part:Part}|null=null,distance=8/paper.view.zoom;
    for(const owner of this.editor.selectedItems)if(this.editable(owner))pathsOf(owner).forEach((path,contour)=>path.segments.forEach((segment,index)=>{
      const d=path.localToGlobal(segment.point).getDistance(point);if(d<=distance){distance=d;nearest={target:{uid:owner.data.uid,contour,index},part:'point'};}
    }));
    return nearest;
  }
  private curveHit(point:paper.Point){
    let nearest:{owner:Shape;path:paper.Path;contour:number;curve:number;time:number}|null=null,distance=8/paper.view.zoom;
    for(const owner of [...this.editor.objects].reverse())if(this.editable(owner))pathsOf(owner).forEach((path,contour)=>{
      const copy=documentPath(path),location=copy.getNearestLocation(point);
      if(location){const d=location.point.getDistance(point);if(d<distance){distance=d;nearest={owner,path,contour,curve:location.index,time:location.time};}}
      copy.remove();
    });
    return nearest as {owner:Shape;path:paper.Path;contour:number;curve:number;time:number}|null;
  }
  down(event:PointerEvent,point:paper.Point):void{
    this.closeMenu();let hit=this.nodeHit(point);
    if(!hit){
      const curve=this.curveHit(point);
      if(!curve){
        const text=this.editor.objects.find(item=>item.data.text&&item.bounds.contains(point)&&item.layer.visible&&!item.layer.locked);
        this.clear();this.editor.select(text??null);if(text)this.editor.onMessage('Convert text to paths before editing its nodes.');return;
      }
      if(!event.shiftKey||!this.editor.selectedItems.includes(curve.owner))this.editor.select(curve.owner,event.shiftKey);if(!event.shiftKey)this.corners=[];this.active=null;hit=this.nodeHit(point);
    }
    if(hit){
      if(hit.part==='point'){
        const exists=this.corners.some(t=>this.same(t,hit!.target));
        if(event.shiftKey){this.corners=exists?this.corners.filter(t=>!this.same(t,hit!.target)):[...this.corners,hit.target];this.active=exists?this.corners.at(-1)??null:hit.target;this.hooks.changed();return;}
        this.corners=[hit.target];
      }
      this.active=hit.target;const resolved=this.resolve()!;
      this.drag={id:event.pointerId,before:this.editor.snapshot(),part:hit.part,start:point,point:resolved.segment.point.clone(),handleIn:resolved.segment.handleIn.clone(),handleOut:resolved.segment.handleOut.clone(),spacing:this.editor.gridSnappingActive?this.editor.grid.spacingMM:null,moved:false};
      this.editor.canvas.setPointerCapture(event.pointerId);
    }
    this.hooks.changed();
  }
  move(event:PointerEvent,point:paper.Point):void{
    const drag=this.drag,resolved=this.resolve();if(!drag||!resolved||drag.id!==event.pointerId)return;
    if(!drag.moved&&point.getDistance(drag.start)*paper.view.zoom<2)return;
    const {path,segment,owner}=resolved;
    if(drag.part==='point'){
      const origin=path.localToGlobal(drag.point),target=this.hooks.snap(origin.add(point.subtract(drag.start)),drag.spacing);
      if(!validNumber(target.x)||!validNumber(target.y))return;
      segment.point=path.globalToLocal(target);
    }else{
      const origin=path.localToGlobal(drag.point.add(drag[drag.part])),target=origin.add(point.subtract(drag.start));
      if(!validNumber(target.x)||!validNumber(target.y))return;
      const handle=path.globalToLocal(target).subtract(segment.point);segment[drag.part]=handle;
      const other=drag.part==='handleIn'?'handleOut':'handleIn',a=drag.handleIn,b=drag.handleOut;
      const smooth=a.length>0&&b.length>0&&Math.abs(a.normalize().cross(b.normalize()))<1e-5&&a.dot(b)<0;
      if(smooth&&!event.altKey&&handle.length>0)segment[other]=handle.normalize(-drag[other].length);
    }
    drag.moved=true;this.markEdited(owner);this.hooks.changed();
  }
  up(event:PointerEvent,point:paper.Point):void{
    if(this.drag?.id!==event.pointerId)return;this.move(event,point);const drag=this.drag!;this.drag=null;
    if(this.editor.canvas.hasPointerCapture(event.pointerId))this.editor.canvas.releasePointerCapture(event.pointerId);
    if(drag.moved)this.hooks.commit(drag.before);else this.hooks.changed();
  }
  cancel():void{
    const drag=this.drag;this.drag=null;this.closeMenu();this.closeCorner();
    if(drag){if(this.editor.canvas.hasPointerCapture(drag.id))this.editor.canvas.releasePointerCapture(drag.id);if(drag.moved)this.hooks.restore(drag.before);}
  }
  add(point:paper.Point):void{
    const hit=this.curveHit(point);if(!hit)return;
    if(hit.path.segments.some(segment=>hit.path.localToGlobal(segment.point).getDistance(point)<6/paper.view.zoom))return;
    const before=this.editor.snapshot(),curve=hit.path.curves[hit.curve].divideAtTime(hit.time);if(!curve)return;
    this.editor.select(hit.owner);this.active={uid:hit.owner.data.uid,contour:hit.contour,index:curve.segment1.index};this.corners=[this.active];this.markEdited(hit.owner);this.hooks.commit(before);
  }
  context(point:paper.Point):void{
    const hit=this.nodeHit(point);if(!hit||hit.part!=='point')return;
    if(!this.corners.some(t=>this.same(t,hit.target)))this.corners=[hit.target];this.active=hit.target;this.hooks.changed();const {path,segment}=this.resolve()!;
    this.menu.querySelectorAll<HTMLButtonElement>('[data-node-action]').forEach(button=>{button.disabled=['fillet','chamfer'].includes(button.dataset.nodeAction!)?!this.canEditCorners:this.corners.length>1;});
    this.menu.querySelector<HTMLButtonElement>('[data-node-action="split"]')!.disabled=this.corners.length>1||!path.closed&&(segment.index===0||segment.index===path.segments.length-1);
    this.menu.hidden=false;const screen=paper.view.projectToView(point),bounds=this.editor.canvas.parentElement!.getBoundingClientRect();
    this.menu.style.left=`${Math.max(8,Math.min(screen.x+12,bounds.width-this.menu.offsetWidth-8))}px`;
    this.menu.style.top=`${Math.max(8,Math.min(screen.y+12,bounds.height-this.menu.offsetHeight-8))}px`;
    this.menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }
  action(action:string):void{
    const resolved=this.resolve();if(!resolved||this.drag)return;
    if(this.corners.length>1){this.editor.onMessage('Select a single node for this action.');return;}
    const {owner,path,segment}=resolved,before=this.editor.snapshot();
    if(action==='delete'){
      path.removeSegment(segment.index);
      if(path.segments.length<2){path.remove();if(owner===path||!pathsOf(owner).length){owner.remove();this.editor.select(null);}}
      this.active=null;
    }else if(action==='corner'){segment.handleIn=new paper.Point(0,0);segment.handleOut=new paper.Point(0,0);}
    else if(action==='smooth'){
      const prev=segment.previous,next=segment.next;
      const tangent=prev&&next?next.point.subtract(prev.point):next?next.point.subtract(segment.point):prev?segment.point.subtract(prev.point):new paper.Point(1,0);
      const direction=tangent.length?tangent.normalize():new paper.Point(1,0);
      segment.handleIn=prev?direction.multiply(-segment.point.getDistance(prev.point)/3):new paper.Point(0,0);
      segment.handleOut=next?direction.multiply(segment.point.getDistance(next.point)/3):new paper.Point(0,0);
    }else if(action==='split'){
      if(!path.closed&&(segment.index===0||segment.index===path.segments.length-1))return;
      const first=documentPath(path),location=first.curves[segment.index].getLocationAtTime(0),second=first.splitAt(location);
      if(!second){first.remove();return;}
      const parts=second===first?[first]:[first,second],parent=owner.parent;let index=owner.index+1;
      for(const part of parts){part.firstSegment.handleIn=new paper.Point(0,0);part.lastSegment.handleOut=new paper.Point(0,0);part.style=owner.style;if(owner.data.rasterTrace&&owner.fillColor){part.strokeColor=owner.fillColor;part.fillColor=null;}part.data={...structuredClone(owner.data),uid:crypto.randomUUID(),name:'Split path'};delete part.data.arc;delete part.data.sides;delete part.data.joined;parent.insertChild(index++,part);}
      path.remove();if(owner!==path&&!pathsOf(owner).length)owner.remove();
      this.editor.select(parts[0]);if(parts.length>1)this.editor.select(parts[1],true);this.active=null;
    }else return;
    this.corners=this.active&&this.resolve()?[this.active]:[];this.markEdited(owner);this.hooks.commit(before);
  }
  draw():void{
    this.corners=this.corners.filter(t=>!!this.resolve(t));
    const color=getComputedStyle(document.documentElement).getPropertyValue('--color-selection').trim(),zoom=paper.view.zoom;
    const add=(item:paper.Item,control:string)=>{item.data={role:'overlay',control};this.editor.overlays.addChild(item);};
    const resolved=this.resolve();
    if(resolved){const {path,segment}=resolved,point=path.localToGlobal(segment.point);
      for(const part of ['handleIn','handleOut'] as const)if(!segment[part].isZero()){
        const end=path.localToGlobal(segment.point.add(segment[part]));
        add(new paper.Path({insert:false,segments:[point,end],strokeColor:color,strokeWidth:1/zoom}),'node-tangent');
        add(new paper.Path.Circle({insert:false,center:end,radius:3.5/zoom,fillColor:'white',strokeColor:color,strokeWidth:1/zoom}),part);
      }
    }
    for(const owner of this.editor.selectedItems)if(this.editable(owner))pathsOf(owner).forEach((path,contour)=>path.segments.forEach((segment,index)=>{
      const point=path.localToGlobal(segment.point),selected=this.corners.some(t=>t.uid===owner.data.uid&&t.contour===contour&&t.index===index);
      add(new paper.Path.Rectangle({insert:false,rectangle:new paper.Rectangle(point.subtract(4/zoom),new paper.Size(8/zoom,8/zoom)),fillColor:selected?color:'white',strokeColor:color,strokeWidth:1/zoom}),'node');
    }));
    for(const plan of this.cornerPlans){const preview=plan.preview.clone({insert:false});preview.strokeColor=new paper.Color(getComputedStyle(document.documentElement).getPropertyValue('--chrome-accent').trim());preview.strokeWidth=2/zoom;preview.fillColor=null;add(preview,'corner-preview');}
  }
}
