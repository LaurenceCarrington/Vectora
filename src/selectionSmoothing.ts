import paper from 'paper';
import type {CADEditor} from './editor';
import {documentPath} from './deletion';
import {pathsOf} from './geometry';
import {smoothPath,contourTopology,validSmoothedContours} from './smoothGeometry';
import {MovablePopover} from './movablePopover';
import type {DocumentSnapshot,Shape} from './types';

/** Nonmodal live editing, derived from the opening geometry rather than previous ticks. */
export class SelectionSmoothing {
 readonly panel=document.createElement('div');
 private sources:{owner:Shape;data:Shape['data'];topology:string;paths:{target:paper.Path;base:paper.Path;original:paper.Segment[];fixed:boolean}[]}[]=[];
 private before:DocumentSnapshot|null=null;
 private checkpoint:{owner:Shape;data:Shape['data'];paths:{target:paper.Path;segments:paper.Segment[]}[]}[]|null=null;
 private anchor={x:0,y:0};
 private strength:HTMLInputElement;
 private detail:HTMLInputElement;
 private updating=false;
 private mover:MovablePopover;
 constructor(private editor:CADEditor,private hooks:{changed:()=>void;commit:(before:DocumentSnapshot)=>void}){
  this.panel.className='smooth-popover menu-surface';this.panel.hidden=true;this.panel.setAttribute('role','dialog');this.panel.setAttribute('aria-label','Smooth selected objects');
  this.panel.innerHTML='<div class="smooth-header"><h2>Smooth</h2><button type="button" class="panel-icon" aria-label="Close Smooth" title="Close"><svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-close"/></svg></button></div><div class="smooth-controls"><div class="slider-label"><label for="smooth-strength">Smoothing strength</label><output for="smooth-strength">0%</output></div><input id="smooth-strength" class="vectora-slider" type="range" min="0" max="100" step="1" value="0"><div class="slider-label"><label for="smooth-detail">Detail reduction</label><output for="smooth-detail">0 mm</output></div><input id="smooth-detail" class="vectora-slider" type="range" min="0" max="2" step="0.05" value="0"><p class="smooth-hint">Preserves sharp corners and endpoints. Undo restores each adjustment.</p></div>';
  this.strength=this.panel.querySelector('#smooth-strength')!;this.detail=this.panel.querySelector('#smooth-detail')!;
  this.mover=new MovablePopover(this.panel,this.panel.querySelector('.smooth-header h2')!,'Move Smooth menu',()=>this.position());
  editor.canvas.parentElement!.append(this.panel);
  this.panel.querySelector('button')!.onclick=()=>this.close(true);
  for(const slider of [this.strength,this.detail]){
   slider.addEventListener('input',()=>this.update());slider.addEventListener('change',()=>this.finish());
   slider.addEventListener('pointercancel',()=>this.rollback());
  }
  this.panel.addEventListener('keydown',event=>{
   event.stopPropagation();
   if(event.key==='Escape'){event.preventDefault();this.rollback();this.close(true);}
   else if((event.ctrlKey||event.metaKey)&&['z','y'].includes(event.key.toLowerCase())){event.preventDefault();this.close(true);if(event.key.toLowerCase()==='y'||event.shiftKey)this.editor.redo();else this.editor.undo();}
  });
  document.addEventListener('pointerdown',event=>{if(!this.panel.hidden&&!this.panel.contains(event.target as Node))this.close();},true);
  document.addEventListener('focusin',event=>{if(!this.panel.hidden&&!this.panel.contains(event.target as Node))this.close();});
  window.addEventListener('resize',()=>this.position());window.addEventListener('blur',()=>{this.rollback();this.close();});
 }
 get eligible():boolean {return this.editor.canFlipSelection&&this.editor.selectedItems.every(item=>item.visible&&!item.locked&&!item.data.text&&!item.data.dimension)&&this.editor.selectedItems.some(item=>pathsOf(item).some(path=>path.visible&&!path.locked&&path.segments.length>=3));}
 open(anchor:{x:number;y:number}):void {
  this.close();if(!this.eligible)return;
  try{
   const count=this.editor.selectedItems.reduce((sum,item)=>sum+pathsOf(item).reduce((sum,path)=>sum+path.segments.length,0),0);
   if(count>20000)throw new Error('Select fewer paths (up to 20,000 points) for live smoothing.');
   for(const owner of this.editor.selectedItems){
    const source={owner,data:structuredClone(owner.data),topology:'',paths:[] as typeof this.sources[number]['paths']};this.sources.push(source);
    for(const target of pathsOf(owner)){
     const base=documentPath(target);if(owner.data.arc||owner.data.sides)base.data={arc:owner.data.arc,sides:owner.data.sides};
     source.paths.push({target,base,original:target.segments.map(s=>s.clone()),fixed:!target.visible||target.locked});
    }
    source.topology=contourTopology(source.paths.map(p=>p.base));
   }
  }catch(error){this.sources.forEach(s=>s.paths.forEach(p=>p.base.remove()));this.sources=[];this.editor.onMessage(`Unable to smooth this selection: ${(error as Error).message}`,true);this.editor.canvas.focus({preventScroll:true});return;}
  this.anchor=anchor;this.completed={strength:'0',detail:'0'};this.strength.value='0';this.detail.value='0';this.labels();this.panel.querySelector('.smooth-hint')!.textContent='Preserves sharp corners and endpoints. Undo restores each adjustment.';this.panel.hidden=false;this.position();this.strength.focus({preventScroll:true});
 }
 refresh():void {
  if(this.panel.hidden||this.updating)return;
  if(!this.eligible||this.sources.length!==this.editor.selectedItems.length||this.sources.some(({owner})=>!owner.isInserted()||!this.editor.selectedItems.includes(owner)))this.close();
  else this.position();
 }
 private update():void {
  if(this.panel.hidden||!this.eligible)return;
  if(!this.before){this.before=this.editor.snapshot();this.checkpoint=this.sources.map(({owner,paths})=>({owner,data:structuredClone(owner.data),paths:paths.map(({target})=>({target,segments:target.segments.map(s=>s.clone())}))}));}
  this.updating=true;
  try{
   let protectedCount=0;
   for(const {owner,data,paths,topology} of this.sources){
    let edited=false;
    const results:paper.Path[]=[];
    try{
     for(const {base,fixed} of paths)results.push(fixed?base.clone({insert:false}) as paper.Path:smoothPath(base,{strength:Number(this.strength.value),detail:Number(this.detail.value)}));
     const differs=results.some((p,i)=>p.pathData!==paths[i].base.pathData),safe=!differs||validSmoothedContours(results,topology);
     if(!safe)protectedCount++;
     for(let i=0;i<paths.length;i++){
     const {target,base,original}=paths[i],result=results[i],changed=safe&&result.pathData!==base.pathData;
     target.removeSegments();target.addSegments(changed?result.segments.map(s=>{
      const point=target.globalToLocal(s.point);return new paper.Segment(point,target.globalToLocal(s.point.add(s.handleIn)).subtract(point),target.globalToLocal(s.point.add(s.handleOut)).subtract(point));
     }):original.map(s=>s.clone()));
     edited||=changed;
    }
    }finally{results.forEach(path=>path.remove());}
    owner.data={...structuredClone(data)};if(edited){delete owner.data.arc;delete owner.data.sides;}
   }
   this.panel.querySelector('.smooth-hint')!.textContent=protectedCount?'Some paths kept unchanged to preserve holes or crossings. Reduce the settings.':'Preserves sharp corners and endpoints. Undo restores each adjustment.';
   this.labels();this.hooks.changed();
  }catch(error){this.rollback();this.editor.onMessage(`Unable to smooth this selection: ${(error as Error).message}`,true);this.close();}
  finally{this.updating=false;}
 }
 private labels():void {
  for(const slider of [this.strength,this.detail]){
   this.panel.querySelector(`output[for="${slider.id}"]`)!.textContent=slider===this.strength?`${slider.value}%`:`${Number(slider.value)} mm`;
   slider.style.setProperty('--range-progress',`${Number(slider.value)/Number(slider.max)*100}%`);
  }
 }
 private finish():void {const before=this.before;this.before=null;this.checkpoint=null;this.completed={strength:this.strength.value,detail:this.detail.value};if(before)this.hooks.commit(before);}
 private rollback():void {
  if(!this.before)return;
  // Restore only the unfinished adjustment, without rebuilding the document.
  const checkpoint=this.checkpoint;this.before=null;this.checkpoint=null;
  for(const {owner,data,paths} of checkpoint??[]){if(!owner.isInserted())continue;owner.data=data;for(const {target,segments} of paths){target.removeSegments();target.addSegments(segments);}}
  this.strength.value=this.completed.strength;this.detail.value=this.completed.detail;this.labels();this.hooks.changed();
 }
 private completed={strength:'0',detail:'0'};
 close(restoreFocus=false):void {
  if(this.panel.hidden)return;
  this.mover.finish(true);
  this.panel.hidden=true;this.finish();this.sources.forEach(s=>s.paths.forEach(p=>p.base.remove()));this.sources=[];
  if(restoreFocus)this.editor.canvas.focus({preventScroll:true});
 }
 private position():void {
  if(this.panel.hidden)return;
  const canvas=this.editor.canvas.getBoundingClientRect(),inset=8;
  const left=Math.max(canvas.left,document.querySelector('.ruler-left')?.getBoundingClientRect().right??0)+inset;
  const right=Math.min(innerWidth,canvas.right,document.querySelector('.right-toolbar')?.getBoundingClientRect().left??innerWidth)-inset;
  const top=Math.max(canvas.top,(document.querySelector('.document-tabs')??document.querySelector('.top-toolbar'))?.getBoundingClientRect().bottom??0)+inset;
  const bottom=Math.min(innerHeight,canvas.bottom,document.querySelector('.ruler-bottom')?.getBoundingClientRect().top??innerHeight)-inset;
  this.panel.style.maxWidth=`${Math.max(0,right-left)}px`;this.panel.style.maxHeight=`${Math.max(0,bottom-top)}px`;
  const box=this.panel.getBoundingClientRect();
  const x=Math.max(left,Math.min(this.mover.placement?.left??this.anchor.x,right-box.width)),y=Math.max(top,Math.min(this.mover.placement?.top??this.anchor.y,bottom-box.height));
  this.panel.style.left=`${x}px`;this.panel.style.top=`${y}px`;this.mover.constrain(x,y);
 }
}
