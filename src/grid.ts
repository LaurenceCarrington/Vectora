import paper from 'paper';
import { GRID_BASE_SPACING_MM } from './units';
import { GRID_TYPES, gridMarks, snapGridPoint, type GridType, type GridMark } from './gridGeometry';
import {validateGridSettings} from './gridSettings';

const STORAGE_KEY = 'vectora.gridSpacingMM';
function validSpacing(value: number): boolean {
  return Number.isFinite(value) && value >= 0.1 && value <= 1000;
}

export class MillimetreGrid {
  readonly layer: paper.Layer;
  spacingMM = GRID_BASE_SPACING_MM;
  type:GridType = 'square';
  angleDegrees = 15;
  private lastView = '';
  private dots?: paper.Raster;
  private colors: { minor: string; major: string };

  constructor() {
    try {
      const saved = Number(localStorage.getItem(STORAGE_KEY));
      if (validSpacing(saved)) this.spacingMM = saved;
      const type=localStorage.getItem('vectora.gridType') as GridType;
      if(GRID_TYPES.includes(type))this.type=type;
      const angle=Number(localStorage.getItem('vectora.gridAngle'));
      if([5,10,15,20,30,45,60,90].includes(angle))this.angleDegrees=angle;
    } catch { /* Storage may be unavailable. */ }
    this.layer = new paper.Layer({ name: 'Millimetre grid', guide: true, locked: true, data: { role: 'grid' } });
    const tokens = getComputedStyle(document.documentElement);
    this.colors = {
      minor: tokens.getPropertyValue('--color-grid-minor').trim(),
      major: tokens.getPropertyValue('--color-grid-major').trim(),
    };
  }

  refreshColors(): void {
    const tokens = getComputedStyle(document.documentElement);
    this.colors = { minor: tokens.getPropertyValue('--color-grid-minor').trim(), major: tokens.getPropertyValue('--color-grid-major').trim() };
    this.lastView = '';
  }

  setSpacingMM(value: number): void {
    if (!validSpacing(value)) throw new Error('Enter a grid size from 0.1 to 1000 mm.');
    this.spacingMM = value;
    try { localStorage.setItem(STORAGE_KEY, String(value)); } catch { /* Keep the session preference. */ }
  }

  get config(){return {type:this.type,spacing:this.spacingMM,angle:this.angleDegrees};}
  applyConfig(value:unknown,persist=false):void {
    const grid=validateGridSettings(value);
    this.type=grid.type;this.spacingMM=grid.spacing;this.angleDegrees=grid.angle;
    if(persist)try{localStorage.setItem(STORAGE_KEY,String(grid.spacing));localStorage.setItem('vectora.gridType',grid.type);localStorage.setItem('vectora.gridAngle',String(grid.angle));}catch{ /* Keep the document settings. */ }
  }

  setType(type:GridType):void {
    if(!GRID_TYPES.includes(type))throw new Error('Choose a valid grid type.');
    this.type=type;
    try{localStorage.setItem('vectora.gridType',type);}catch{ /* Session preference. */ }
  }
  setAngle(degrees:number):void {
    if(![5,10,15,20,30,45,60,90].includes(degrees))throw new Error('Choose a radial angle from the list.');
    this.angleDegrees=degrees;
    try{localStorage.setItem('vectora.gridAngle',String(degrees));}catch{ /* Session preference. */ }
  }
  snap(point:paper.Point,spacing=this.spacingMM):paper.Point {
    const target=snapGridPoint(point,{type:this.type,spacing,angle:this.angleDegrees});
    return new paper.Point(target.x,target.y);
  }
  update(view: paper.View): void {
    const bounds = view.bounds;
    const key = [bounds.x,bounds.y,bounds.width,bounds.height,view.zoom,view.pixelRatio,this.spacingMM,this.type,this.angleDegrees].join(',');
    if(key===this.lastView)return;
    this.lastView=key;
    const marks=gridMarks(bounds,view.zoom,{type:this.type,spacing:this.spacingMM,angle:this.angleDegrees});
    if(this.type==='dot'){
      this.drawDots(view,marks);
      return;
    }
    this.layer.removeChildren();
    this.dots=undefined;
    for(const mark of marks){
      const style={insert:false,guide:true,data:{role:'grid'},strokeScaling:false,strokeWidth:1};
      const color=this.colors[mark.major?'major':'minor'];
      const path=mark.kind==='line'
        ?new paper.Path({...style,segments:[[mark.a.x,mark.a.y],[mark.b.x,mark.b.y]],strokeColor:color})
        :new paper.Shape.Circle({...style,center:[mark.center.x,mark.center.y],radius:mark.kind==='circle'?mark.radius:(mark.major?1.5:1)/view.zoom,...(mark.kind==='dot'?{fillColor:color}:{strokeColor:color})});
      this.layer.addChild(path);
    }
  }

  private drawDots(view: paper.View, marks: GridMark[]): void {
    // One cached image avoids traversing and drawing thousands of Paper items
    // on every pointer move. Grid geometry and snapping remain in millimetres.
    if(!this.dots){
      this.layer.removeChildren();
      this.dots=new paper.Raster({insert:false,guide:true,data:{role:'grid'}});
      this.layer.addChild(this.dots);
    }
    const raster=this.dots;
    raster.visible=marks.length>0;
    if(!raster.visible)return;
    const ratio=view.pixelRatio,zoom=view.zoom,bounds=view.bounds;
    const width=Math.ceil(view.viewSize.width*ratio),height=Math.ceil(view.viewSize.height*ratio);
    if(raster.width!==width||raster.height!==height){
      const canvas=document.createElement('canvas');
      canvas.width=width;canvas.height=height;
      raster.canvas=canvas;
    }
    const context=raster.context;
    context.resetTransform();
    raster.clear();
    context.scale(ratio,ratio);
    for(const major of [false,true]){
      const radius=major?1.5:1;
      context.beginPath();
      for(const mark of marks){
        if(mark.kind!=='dot'||mark.major!==major)continue;
        const x=(mark.center.x-bounds.left)*zoom,y=(mark.center.y-bounds.top)*zoom;
        context.moveTo(x+radius,y);
        context.arc(x,y,radius,0,Math.PI*2);
      }
      context.fillStyle=this.colors[major?'major':'minor'];
      context.fill();
    }
    const scale=1/(ratio*zoom);
    raster.matrix=new paper.Matrix(scale,0,0,scale,bounds.left+width*scale/2,bounds.top+height*scale/2);
  }
}
