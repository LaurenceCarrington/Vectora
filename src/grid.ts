import paper from 'paper';
import { GRID_BASE_SPACING_MM } from './units';
import { GRID_TYPES, gridMarks, snapGridPoint, type GridType } from './gridGeometry';

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
    const key = [bounds.x,bounds.y,bounds.width,bounds.height,view.zoom,this.spacingMM,this.type,this.angleDegrees].join(',');
    if(key===this.lastView)return;
    this.lastView=key;this.layer.removeChildren();
    for(const mark of gridMarks(bounds,view.zoom,{type:this.type,spacing:this.spacingMM,angle:this.angleDegrees})){
      const style={insert:false,guide:true,data:{role:'grid'},strokeScaling:false,strokeWidth:1};
      const color=this.colors[mark.major?'major':'minor'];
      const path=mark.kind==='line'
        ?new paper.Path({...style,segments:[[mark.a.x,mark.a.y],[mark.b.x,mark.b.y]],strokeColor:color})
        :new paper.Shape.Circle({...style,center:[mark.center.x,mark.center.y],radius:mark.kind==='circle'?mark.radius:(mark.major?1.5:1)/view.zoom,...(mark.kind==='dot'?{fillColor:color}:{strokeColor:color})});
      this.layer.addChild(path);
    }
  }
}
