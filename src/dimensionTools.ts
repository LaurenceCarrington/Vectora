import paper from 'paper';
import type { CADEditor } from './editor';
import type { DimensionTool, DimensionData } from './dimensions';
import { circleAt, createDimension, dimensionLabel, DIMENSION_NAMES, isDimensionTool } from './dimensions';
import { pathsOf } from './geometry';
import { MIN_DIMENSION_MM, validNumber } from './units';

type Hooks={changed:()=>void;snap:(point:paper.Point)=>paper.Point};
export class DimensionTools {
  private points:paper.Point[]=[];
  private circle:{center:paper.Point;radius:number}|null=null;
  private cursor:paper.Point|null=null;
  private pending:DimensionData|null=null;
  private editingUid:string|null=null;
  readonly form=document.createElement('form');
  private input:HTMLInputElement;
  constructor(private editor:CADEditor,private hooks:Hooks){
    this.form.className='callout-editor menu-surface';this.form.hidden=true;this.form.setAttribute('aria-label','Leader callout text');
    this.form.innerHTML='<label class="number-label" for="callout-text">Callout text</label><div class="number-shell"><input class="number-input" id="callout-text" maxlength="120" placeholder="Enter callout text" required></div><div class="callout-actions"><button type="button" class="button" data-callout-cancel>Cancel</button><button type="submit" class="button">Done</button></div>';
    editor.canvas.parentElement!.append(this.form);this.input=this.form.querySelector('input')!;
    this.form.addEventListener('submit',event=>{event.preventDefault();if(this.pending&&this.input.value.trim())this.finish({...this.pending,text:this.input.value.trim()});});
    this.form.querySelector('[data-callout-cancel]')!.addEventListener('click',()=>{this.cancel();this.hooks.changed();editor.canvas.focus();});
    this.form.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();this.cancel();this.hooks.changed();editor.canvas.focus();}});
    this.input.addEventListener('input',()=>{if(this.pending){this.pending.text=this.input.value;this.hooks.changed();}});
  }
  get active():boolean{return this.points.length>0||!!this.pending;}
  get hint():string{
    if(this.pending)return 'Enter callout text';
    if(this.editor.tool==='dimension-radial'||this.editor.tool==='dimension-diameter')return this.circle?'Click label position':'Click a circle or circular arc';
    if(this.editor.tool==='leader')return ['Click arrow tip','Click elbow','Click label position'][Math.min(2,this.points.length)];
    return ['Click first point','Click second point','Click dimension position'][Math.min(2,this.points.length)];
  }
  cancel():void{this.points=[];this.circle=null;this.cursor=null;this.pending=null;this.editingUid=null;this.form.hidden=true;}
  private snap(point:paper.Point):paper.Point{
    if(!this.editor.snappingEnabled)return point;
    let nearest:paper.Point|null=null,distance=8/paper.view.zoom;
    for(const owner of this.editor.objects)if(owner.layer.visible&&!owner.data.dimension&&!owner.data.text)for(const path of pathsOf(owner))for(const segment of path.segments){
      const anchor=path.localToGlobal(segment.point),d=anchor.getDistance(point);if(d<distance){distance=d;nearest=anchor;}
    }
    return nearest??this.hooks.snap(point);
  }
  move(point:paper.Point):void{if(this.pending)return;this.cursor=this.snap(point);this.hooks.changed();}
  down(point:paper.Point):void{
    const tool=this.editor.tool;if(!isDimensionTool(tool)||this.pending)return;
    const target=this.snap(point);if(!validNumber(target.x)||!validNumber(target.y))return;
    if(tool==='dimension-radial'||tool==='dimension-diameter'){
      if(!this.circle){
        this.circle=circleAt(this.editor.objects,point,10/paper.view.zoom);
        if(!this.circle){this.editor.onMessage('Choose a circle or circular arc for this dimension.','warning');return;}
        this.points=[this.circle.center,this.circle.center.add([this.circle.radius,0])];
      }else{if(target.getDistance(this.circle.center)<MIN_DIMENSION_MM)return;const data=this.data(tool,target);if(data)this.finish(data);}
    }else if(this.points.length<2){
      if(this.points.length&&target.getDistance(this.points[0])<MIN_DIMENSION_MM){this.editor.onMessage('Choose two different reference points.','warning');return;}
      this.points.push(target);
    }else{
      const data=this.data(tool,target);if(!data)return;
      if(tool==='leader')this.openForm(data);else this.finish(data);
    }
    this.cursor=target;this.hooks.changed();
  }
  private data(kind:DimensionTool,position:paper.Point):DimensionData|null{
    if(this.points.length<2)return null;
    const [a,originalB]=this.points,b=(kind==='dimension-radial'||kind==='dimension-diameter')?a.add(position.subtract(a).normalize(a.getDistance(originalB))):originalB,axis=Math.abs(position.y-(a.y+b.y)/2)>=Math.abs(position.x-(a.x+b.x)/2)?'x':'y';
    if(kind==='dimension-linear'&&Math.abs(b[axis]-a[axis])<MIN_DIMENSION_MM)return null;
    return {kind,points:[a,b,position].map(p=>[p.x,p.y]),...(kind==='dimension-linear'?{axis}:{}),transform:[1,0,0,1,0,0]};
  }
  private finish(data:DimensionData):void{
    try{
      if(this.editingUid)this.editor.updateCallout(this.editingUid,data.text??'');
      else this.editor.addShape(createDimension(data),DIMENSION_NAMES[data.kind]);
      this.cancel();this.editor.setTool('select');this.editor.canvas.focus({preventScroll:true});
    }catch(error){this.editor.onMessage((error as Error).message,true);}
  }
  private openForm(data:DimensionData):void{
    this.pending=data;this.form.hidden=false;this.input.value=data.text??'';
    const matrix=new paper.Matrix(...data.transform),point=paper.view.projectToView(matrix.transform(new paper.Point(data.points[2]))),bounds=this.editor.canvas.parentElement!.getBoundingClientRect();
    this.form.style.left=`${Math.max(8,Math.min(point.x+12,bounds.width-this.form.offsetWidth-8))}px`;
    this.form.style.top=`${Math.max(8,Math.min(point.y+12,bounds.height-this.form.offsetHeight-8))}px`;this.input.focus({preventScroll:true});
  }
  editSelected():void{
    const source=this.editor.selected;if(source?.data.dimension?.kind!=='leader')return;
    this.cancel();this.editingUid=source.data.uid;this.openForm(structuredClone(source.data.dimension));this.hooks.changed();
  }
  draw():void{
    const add=(item:paper.Item)=>{item.data.role='overlay';this.editor.overlays.addChild(item);};
    for(const owner of this.editor.objects)if(owner.layer.visible&&owner.visible&&owner.data.dimension&&owner.data.uid!==this.editingUid){const label=dimensionLabel(owner);if(label)add(label);}
    if(!this.active||!isDimensionTool(this.editor.tool)&&!this.pending)return;
    let data=this.pending;
    if(!data&&this.cursor)data=this.data(this.editor.tool as DimensionTool,this.cursor);
    if(data){const shape=createDimension(data);shape.opacity=0.65;const label=dimensionLabel(shape);add(shape);if(label){label.opacity=0.8;add(label);}}
    else if(this.points.length&&this.cursor)add(new paper.Path({insert:false,segments:[this.points[0],this.cursor],strokeColor:'#383838',strokeWidth:1/paper.view.zoom,dashArray:[4/paper.view.zoom,4/paper.view.zoom]}));
    for(const point of this.points)add(new paper.Path.Circle({insert:false,center:point,radius:3/paper.view.zoom,fillColor:'white',strokeColor:'#383838',strokeWidth:1/paper.view.zoom}));
  }
}
