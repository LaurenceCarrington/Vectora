import paper from 'paper';
import type {CanvasSize} from './canvasSize';
/** Constant-size, non-interactive artwork guide; never part of document objects. */
export class CanvasGuide {
 readonly layer=new paper.Layer({name:'Canvas boundary',guide:true,locked:true,data:{role:'canvas-guide'}});
 private key='';
 private border='';private outside='';
 constructor(){this.refreshColors();}
 refreshColors():void {const css=getComputedStyle(document.documentElement);this.border=css.getPropertyValue('--canvas-boundary').trim();this.outside=css.getPropertyValue('--canvas-outside').trim();this.key='';}
 update(size:CanvasSize):void {
  const view=paper.view,b=view.bounds,key=JSON.stringify([size,b.x,b.y,b.width,b.height,view.zoom]);if(key===this.key)return;this.key=key;this.layer.removeChildren();
  if(size.kind==='infinite')return;
  const rectangle=new paper.Rectangle(0,0,size.width,size.height),outer=new paper.Path.Rectangle({insert:false,rectangle:b.expand(2/view.zoom)}),hole=new paper.Path.Rectangle({insert:false,rectangle});
  const shade=new paper.CompoundPath({insert:false,children:[outer,hole],fillColor:this.outside,fillRule:'evenodd'});
  // Clip the shading to the visible view so an offscreen page never adds a second island.
  const mask=new paper.Path.Rectangle({insert:false,rectangle:b});mask.clipMask=true;
  this.layer.addChild(new paper.Group({insert:false,children:[mask,shade],clipped:true}));
  this.layer.addChild(new paper.Path.Rectangle({insert:false,rectangle,strokeColor:this.border,strokeWidth:1,strokeScaling:false}));
 }
}
