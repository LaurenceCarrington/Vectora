import paper from 'paper';
import {hasFilledArea} from './shapeStyles';
import {regionAt} from './regionFill';
import {LAYER_TYPES,layerType,layerId,layerRole,type LayerSnapshot} from './documentLayers';
import { NodeEditing } from './nodeEditing';
import { DimensionTools } from './dimensionTools';
import { dimensionLabel, isDimensionTool } from './dimensions';
import type { AlertKind } from './alerts';
import { createDeletePlan, disposeDeletePlan, documentPath, type DeletePlan } from './deletion';
import { pathsOf } from './geometry';
import { closeNearestPaths } from './closePath';
import { createTextShape, isStrokeFont, transformText, type TextData } from './text';
import { createArc, createEndpointArc, arcPoint, createCircularArc, updateCircularArc, snapArcAngle, type ArcGeometry } from './arc';
import { MillimetreGrid } from './grid';
import { findObjectSnap, SNAP_LABELS, type ObjectSnap, type ObjectSnapMode, type SnapModes } from './objectSnapping';
import { createStickerOutline } from './clipperService';
import { BASE_ZOOM, MIN_ZOOM, MAX_ZOOM, MIN_DIMENSION_MM, validNumber, validDimension, snapMM } from './units';
import type { DocumentSnapshot, Shape, ToolName, ObjectRole } from './types';

type Interaction = {
  id:number; kind:'pan'|'draw'|'move'|'resize'|'marquee'|'endpoint'|'arc-handle'|'rotate'; start:paper.Point; screen:paper.Point;
  center:paper.Point; before:DocumentSnapshot; item?:Shape; bounds?:paper.Rectangle;
  rotationPivot?:paper.Point; rotationDelta?:number; arcGeometry?:ArcGeometry; handle?:number; items?:Shape[]; positions?:paper.Point[]; originals?:Shape[]; initialSelection?:Shape[]; snapSpacing:number|null; hasDragged?:boolean; drawPoint?:paper.Point; shift?:boolean;
};
export class CADEditor {
  readonly grid:MillimetreGrid;
  readonly nodes:NodeEditing;
  readonly dimensions:DimensionTools;
  readonly artwork:paper.Layer;
  readonly cutlines:paper.Layer;
  private extraLayers:paper.Layer[]=[];
  readonly overlays:paper.Layer;
  private selection:Shape[]=[];
  get selectedItems():readonly Shape[] {return this.selection;}
  get selected():Shape|null {return this.selection.length===1?this.selection[0]:null;}
  set selected(item:Shape|null){this.selection=item?[item]:[];}
  get selectionRotation():number {return this.selected?.data.rotationDegrees??0;}
  private objectBounds(item:Shape):paper.Rectangle {const label=dimensionLabel(item),bounds=label?item.bounds.unite(label.bounds):item.bounds.clone();label?.remove();return bounds;}
  get selectionBounds():paper.Rectangle|null {return this.selection.reduce<paper.Rectangle|null>((bounds,item)=>bounds?bounds.unite(this.objectBounds(item)):this.objectBounds(item),null);}
  tool:ToolName='select';
  fillColor='#FF0000';
  noFill=false;
  snappingEnabled=true;
  snapToGridEnabled=true;
  get gridSnappingActive():boolean {return this.snappingEnabled&&this.snapToGridEnabled;}
  readonly objectSnapModes:SnapModes={intersection:false,nearest:false,centre:false,tangent:false,perpendicular:false};
  activeObjectSnap:ObjectSnap|null=null;
  polygonSides=6;
  onChange:()=>void=()=>{};
  onTextRequest:(point:paper.Point|null,target:Shape|null)=>void=()=>{};
  textEditing=false;
  private textEditingBounds:paper.Rectangle|null=null;
  setTextEditing(value:boolean):void {this.textEditing=value;if(!value)this.textEditingBounds=null;this.changed();}
  setTextEditingBounds(bounds:paper.Rectangle):void {
    this.textEditingBounds=bounds.clone();this.drawOverlay();paper.view.update();
  }
  onMessage:(message:string,error?:boolean|AlertKind)=>void=()=>{};
  private undoStack:{before:DocumentSnapshot;after:DocumentSnapshot}[]=[];
  private redoStack:{before:DocumentSnapshot;after:DocumentSnapshot}[]=[];
  private interaction:Interaction|null=null;
  private polyline:{points:paper.Point[];item:paper.Path;before:DocumentSnapshot;spacing:number|null}|null=null;
  private threePointArc:{points:paper.Point[];item:paper.Path;before:DocumentSnapshot;spacing:number|null}|null=null;
  get threePointArcHint():string {return this.threePointArc?.points.length===2?'Click end':this.threePointArc?'Click curve point':'Click start';}
  get endpointArcHint():string {
    const state=this.threePointArc;
    if(!state)return 'Click start';
    if(state.points.length===1)return 'Click end';
    const sweep=state.item.data.arc?.sweep;
    return `Click to set angle${sweep?` · ${Number(Math.abs(sweep).toFixed(1))}°`:''} · Shift: 15°`;
  }
  get selectedArc():ArcGeometry|null {return this.selected?.data.arc??null;}
  get arcHint():string {return 'Drag from centre · Semicircle · Shift: 15°';}
  private deletionPreview:DeletePlan|null=null;
  get isDeleteTool():boolean {return this.tool==='dissect-delete'||this.tool==='line-delete';}
  private space=false;
  private observer:ResizeObserver;
  private readonly selectionColor:string;
  private readonly selectionArea:string;
  private readonly deletePreviewColor:string;
  private readonly rotationHandleOffset:number;
  private readonly rotationHandleRadius:number;
  constructor(readonly canvas:HTMLCanvasElement) {
    paper.setup(canvas);
    const tokens=getComputedStyle(document.documentElement);
    this.selectionColor=tokens.getPropertyValue('--color-selection').trim();
    this.selectionArea=tokens.getPropertyValue('--color-selection-area').trim();
    this.deletePreviewColor=tokens.getPropertyValue('--color-delete-preview').trim();
    this.rotationHandleOffset=parseFloat(tokens.getPropertyValue('--rotation-handle-offset'));
    this.rotationHandleRadius=parseFloat(tokens.getPropertyValue('--rotation-handle-radius'));
    this.grid=new MillimetreGrid();
    this.artwork=new paper.Layer({name:'Artwork',data:{role:'artwork-layer',documentId:'artwork',objectRole:'artwork'}});
    this.cutlines=new paper.Layer({name:'Cut Path',data:{role:'cutline-layer',documentId:'cutline',objectRole:'cutline'}});
    this.overlays=new paper.Layer({name:'Editor overlays',data:{role:'overlay'}});
    this.createDocumentLayer('engrave','Engrave Path','engrave');
    this.createDocumentLayer('construction','Construction Path','construction');
    this.artwork.activate();
    this.nodes=new NodeEditing(this,{changed:()=>this.changed(),commit:before=>this.commit(before),restore:before=>this.restore(before),snap:(point,spacing)=>this.snapPoint(point,spacing,undefined,false)});
    this.dimensions=new DimensionTools(this,{changed:()=>this.changed(),snap:point=>this.snapPoint(point,this.gridSnappingActive?this.grid.spacingMM:null)});
    paper.view.zoom=BASE_ZOOM;
    paper.view.center=new paper.Point(100,70);
    this.observer=new ResizeObserver(()=>this.resize()); this.observer.observe(canvas.parentElement!);
    canvas.addEventListener('pointerdown',this.pointerDown);
    canvas.addEventListener('pointermove',this.pointerMove);
    canvas.addEventListener('pointerup',this.pointerUp);
    canvas.addEventListener('pointerleave',()=>{this.activeObjectSnap=null;this.changed();if(this.deletionPreview){this.clearDeletePreview();this.changed();}});
    canvas.addEventListener('dblclick',event=>{if(this.tool==='nodes'){event.preventDefault();const r=this.canvas.getBoundingClientRect();this.nodes.add(paper.view.viewToProject(new paper.Point(event.clientX-r.left,event.clientY-r.top)));}else if(this.polyline){event.preventDefault();this.finishPolyline();}else if(this.tool==='select'&&this.selected?.data.dimension?.kind==='leader'){event.preventDefault();this.dimensions.editSelected();}else if(this.tool==='select'&&this.selected?.data.text){event.preventDefault();this.onTextRequest(null,this.selected);}});
    canvas.addEventListener('pointercancel',()=>this.cancel());
    canvas.addEventListener('lostpointercapture',()=>{if(this.interaction||this.nodes.dragging)this.cancel();});
    canvas.addEventListener('wheel',this.wheel,{passive:false});
    canvas.addEventListener('contextmenu',event=>{event.preventDefault();if(this.tool==='nodes'){const r=this.canvas.getBoundingClientRect();this.nodes.context(paper.view.viewToProject(new paper.Point(event.clientX-r.left,event.clientY-r.top)));}});
    window.addEventListener('keydown',this.keyDown);
    window.addEventListener('keyup',e=>{if(e.code==='Space'){this.space=false;this.updateCursor();}});
    window.addEventListener('blur',()=>{this.space=false;this.cancel();});
    this.resize();
  }
  get documentLayers():paper.Layer[] {return [this.cutlines,...this.extraLayers,this.artwork].filter(layer=>!layer.data.deleted);}
  get objects():Shape[] {return [this.artwork,...this.extraLayers,this.cutlines].filter(layer=>!layer.data.deleted).flatMap(layer=>layer.children) as Shape[];}
  documentLayer(id:string):paper.Layer|undefined {return this.documentLayers.find(layer=>layerId(layer)===id);}
  private isClosedShape(item:Shape):boolean {return item instanceof paper.Path?item.closed:item.children.every(child=>(child as paper.Path).closed);}
  get canOutlineSelection():boolean {return !!this.selected&&!this.selected.data.dimension&&this.isClosedShape(this.selected);}
  private get hasEndpointHandles():boolean {return this.selected instanceof paper.Path&&!this.selected.closed&&this.selected.segments.length===2&&this.selected.segments.every(segment=>segment.handleIn.isZero()&&segment.handleOut.isZero());}
  get canUndo():boolean {return this.undoStack.length>0;}
  get canRedo():boolean {return this.redoStack.length>0;}
  get zoom():number {return paper.view.zoom;}
  resetZoom():void {
    if(this.interaction)return;
    this.activeObjectSnap=null;this.clearDeletePreview();
    paper.view.zoom=BASE_ZOOM;this.changed();
  }
  snapshot():DocumentSnapshot {
    return {artwork:JSON.stringify(this.artwork.children.map(i=>i.exportJSON({precision:12}))),cutlines:JSON.stringify(this.cutlines.children.map(i=>i.exportJSON({precision:12}))),selected:this.selected?.data.uid??null,selectedIds:this.selection.map(item=>item.data.uid),layers:JSON.stringify([this.artwork,this.cutlines,...this.extraLayers].map(layer=>({id:layerId(layer),name:layer.name,role:layerRole(layer),visible:layer.visible,locked:layer.locked,deleted:!!layer.data.deleted,...(this.extraLayers.includes(layer)?{objects:JSON.stringify(layer.children.map(item=>item.exportJSON({precision:12})))}:{})})))};
  }
  newDocument():void {
    const layers=LAYER_TYPES.map(({role,name})=>({id:role,name,role,visible:true,locked:false,deleted:false}));
    this.loadDocument({artwork:'[]',cutlines:'[]',layers:JSON.stringify(layers),selected:null,selectedIds:[]},{zoom:BASE_ZOOM,center:[100,70]});
  }
  loadDocument(snapshot:DocumentSnapshot,view:{zoom:number;center:[number,number]}):void {
    this.cancel();const before=this.snapshot(),oldZoom=paper.view.zoom,oldCenter=paper.view.center.clone();
    try{
      this.restore(snapshot);paper.view.zoom=view.zoom;paper.view.center=new paper.Point(...view.center);
      this.tool='select';this.updateCursor();this.undoStack=[];this.redoStack=[];this.changed();
    }catch(error){this.restore(before);paper.view.zoom=oldZoom;paper.view.center=oldCenter;this.changed();throw error;}
  }
  private restore(snapshot:DocumentSnapshot):void {
    this.dimensions.cancel();this.nodes.clear();
    this.selected=null; this.artwork.removeChildren();this.cutlines.removeChildren();
    this.extraLayers.forEach(layer=>layer.remove());this.extraLayers=[];
    for(const state of JSON.parse(snapshot.layers??'[]') as LayerSnapshot[]){
      const layer=state.id==='artwork'?this.artwork:state.id==='cutline'?this.cutlines:this.createDocumentLayer(state.role,state.name,state.id);
      layer.name=state.name;layer.data.deleted=state.deleted;layer.visible=state.visible;layer.locked=state.locked;
      for(const json of JSON.parse(state.objects??'[]'))layer.addChild(paper.project.importJSON(json));
    }
    for(const [layer,json] of [[this.artwork,snapshot.artwork],[this.cutlines,snapshot.cutlines]] as const) {
      for(const itemJSON of JSON.parse(json) as string[]) layer.addChild(paper.project.importJSON(itemJSON));
    }
    const ids=snapshot.selectedIds??(snapshot.selected?[snapshot.selected]:[]);
    this.selection=this.objects.filter(o=>ids.includes(o.data.uid)&&this.isEditable(o));
    this.artwork.activate();this.changed();
  }
  private commit(before:DocumentSnapshot):void {
    const after=this.snapshot();
    if(before.artwork!==after.artwork || before.cutlines!==after.cutlines || before.layers!==after.layers) {
      this.undoStack.push({before,after}); if(this.undoStack.length>100)this.undoStack.shift();this.redoStack=[];
    }
    this.changed();
  }
  undo():void {this.cancel();const entry=this.undoStack.pop();if(entry){this.redoStack.push(entry);this.restore(entry.before);}}
  redo():void {this.cancel();const entry=this.redoStack.pop();if(entry){this.undoStack.push(entry);this.restore(entry.after);}}
  private isEditable(item:Shape):boolean {return !item.layer.data.deleted && item.layer.visible && !item.layer.locked;}
  private createDocumentLayer(role:ObjectRole,name:string,id:string):paper.Layer {
    const layer=new paper.Layer({name,data:{documentId:id,objectRole:role,role:`${role}-layer`}});
    layer.insertBelow(this.overlays);this.extraLayers.push(layer);this.artwork.activate();return layer;
  }
  addDocumentLayer(role:ObjectRole='artwork'):paper.Layer {
    this.cancel();const before=this.snapshot(),base=role==='artwork'?this.artwork:role==='cutline'?this.cutlines:undefined;
    let layer:paper.Layer;
    if(base?.data.deleted){layer=base;layer.data.deleted=false;layer.visible=true;layer.locked=false;}
    else{
      const original=layerType(role).name;let name:string=original,index=2;
      while(this.documentLayers.some(layer=>layer.name===name))name=`${original} ${index++}`;
      layer=this.createDocumentLayer(role,name,crypto.randomUUID());
    }
    this.commit(before);return layer;
  }
  deleteDocumentLayer(id:string):boolean {
    this.cancel();const layer=this.documentLayer(id);if(!layer||layer.locked)return false;
    const before=this.snapshot();this.selection=this.selection.filter(item=>item.layer!==layer);layer.removeChildren();
    if(layer===this.artwork||layer===this.cutlines){layer.data.deleted=true;layer.visible=false;}
    else{this.extraLayers=this.extraLayers.filter(item=>item!==layer);layer.remove();}
    this.artwork.activate();this.commit(before);return true;
  }
  setLayerState(id:string,key:'visible'|'locked',value:boolean):void {
    this.cancel();const layer=this.documentLayer(id);if(!layer)return;const before=this.snapshot();layer[key]=value;
    this.selection=this.selection.filter(item=>this.isEditable(item));this.commit(before);
  }
  canMoveSelectionToLayer(id:string):boolean {
    const layer=this.documentLayer(id);return !!layer&&layer.visible&&!layer.locked&&this.selection.some(item=>item.layer!==layer&&this.isEditable(item)&&(!item.data.dimension||layerRole(layer)==='artwork'));
  }
  moveSelectionToLayer(id:string):number {
    return this.moveObjectsToLayer(id,this.selection);
  }
  moveObjectsToLayer(id:string,objects:readonly Shape[]):number {
    this.cancel();const layer=this.documentLayer(id);if(!layer)throw new Error('Choose an available destination layer.');
    if(!layer.visible||layer.locked)throw new Error(`Show and unlock ${layer.name} before moving objects.`);
    const items=objects.filter(item=>this.objects.includes(item)&&item.layer!==layer&&this.isEditable(item)&&(!item.data.dimension||layerRole(layer)==='artwork'));
    if(!items.length)return 0;const before=this.snapshot(),role=layerRole(layer);
    const color=new paper.Color(getComputedStyle(document.documentElement).getPropertyValue(layerType(role).color).trim());
    for(const item of items){
      layer.addChild(item);item.data.role=role;
      if(role==='artwork'&&item.data.regionFill){item.fillColor=new paper.Color(item.data.regionFillColor??this.fillColor);item.strokeColor=null;}
      else if(item.data.text||(role==='engrave'&&hasFilledArea(item))||(role==='artwork'&&item.data.rasterTrace?.mode==='fill')){item.fillColor=color;item.strokeColor=null;}
      else{item.fillColor=null;item.strokeColor=color;item.strokeWidth=1.5;item.strokeScaling=false;}
    }
    this.selection=items;this.commit(before);return items.length;
  }
  select(item:Shape|null,additive=false):void {
    if(this.polyline||this.threePointArc){const uid=item?.data.uid;this.cancel();item=uid?this.objects.find(shape=>shape.data.uid===uid)??null:null;}
    if(item&&!this.isEditable(item))return;
    if(additive&&item)this.selection=this.selection.includes(item)?this.selection.filter(shape=>shape!==item):[...this.selection,item];
    else this.selected=item;
    this.changed();
  }
  setTool(tool:ToolName):void {this.cancel();this.nodes.clear();this.tool=tool;this.updateCursor();this.changed();}
  setFillColor(color:string):void {
    if(color==='none'){this.noFill=true;this.changed();return;}
    if(!/^#[0-9a-f]{6}$/i.test(color))throw new Error('Enter a six-digit hex colour, such as #2678A8.');
    this.noFill=false;this.fillColor=color.toUpperCase();this.changed();
  }
  fillAt(point:paper.Point):void {
    if(this.noFill){this.clearFillAt(point);return;}
    if(this.artwork.data.deleted||!this.artwork.visible||this.artwork.locked)throw new Error('Show and unlock Artwork before filling.');
    const region=regionAt(this.objects,point);
    if(!region){this.onMessage('Click inside an enclosed area. Open gaps cannot be filled.','information');return;}
    const before=this.snapshot();
    const existing=this.objects.find(item=>item.data.regionFill&&this.isEditable(item)&&layerRole(item.layer)==='artwork'&&item.compare(region));
    if(existing){region.remove();existing.fillColor=new paper.Color(this.fillColor);existing.data.regionFillColor=this.fillColor;this.selected=existing;}
    else{
      region.data={uid:crypto.randomUUID(),name:'Colour fill',role:'artwork',regionFill:true,regionFillColor:this.fillColor};region.fillColor=new paper.Color(this.fillColor);region.strokeColor=null;
      const painted=this.artwork.children.filter(item=>item.fillColor);
      const index=painted.length?painted[painted.length-1].index+1:0;
      this.artwork.insertChild(index,region);this.selected=region;
    }
    this.commit(before);
  }
  private clearFillAt(point:paper.Point):void {
    const region=regionAt(this.objects,point);
    if(!region)return;
    const plans:{item:Shape;remainder:Shape|null}[]=[];
    try{
      for(const item of this.objects){
        if(!this.isEditable(item)||item.locked||!item.visible||!item.fillColor||item.data.text||item.data.dimension||!item.contains(point))continue;
        const contours=pathsOf(item).map(documentPath);
        const source:Shape=contours.length===1?contours[0]:new paper.CompoundPath({insert:false,children:contours});
        source.fillRule=item.fillRule;
        try{
          const remainder=source.compare(region)?null:source.subtract(region,{insert:false}) as Shape;
          if(remainder&&Math.abs(remainder.area)<1e-7){remainder.remove();plans.push({item,remainder:null});}
          else plans.push({item,remainder});
        }finally{source.remove();}
      }
    }catch(error){for(const plan of plans)plan.remainder?.remove();throw error;}
    finally{region.remove();}
    if(!plans.length)return;
    const before=this.snapshot();
    for(const {item,remainder} of plans){
      if(remainder){
        remainder.style=item.style;remainder.strokeColor=null;
        remainder.data={uid:item.strokeColor?crypto.randomUUID():item.data.uid,name:'Colour fill',role:item.data.role,regionFill:true,regionFillColor:item.fillColor!.toCSS(true)};
        item.layer.insertChild(item.index,remainder);
      }
      // Keep the original outline intact; only its painted area changes.
      if(item.strokeColor)item.fillColor=null;else item.remove();
    }
    this.selection=this.selection.filter(item=>item.isInserted());this.commit(before);
  }
  setPolygonSides(sides:number):void {
    if(!Number.isInteger(sides)||sides<3||sides>64)throw new Error('Enter a whole number of sides from 3 to 64.');
    this.polygonSides=sides;
    const state=this.interaction;
    if(this.tool==='polygon'&&state?.kind==='draw'&&state.drawPoint)this.drawShape(state,state.drawPoint,state.shift??false);
    this.changed();
  }
  setSnappingEnabled(enabled:boolean):void {
    if(this.snappingEnabled===enabled)return;
    this.cancel();this.snappingEnabled=enabled;this.changed();
  }
  setSnapToGrid(enabled:boolean):void {
    if(this.snapToGridEnabled===enabled)return;
    this.cancel();this.snapToGridEnabled=enabled;this.changed();
  }
  setObjectSnap(mode:ObjectSnapMode,enabled:boolean):void {
    this.cancel();this.objectSnapModes[mode]=enabled;this.changed();
  }
  private snapPoint(point:paper.Point,spacing:number|null,anchor?:paper.Point,objectSnaps=true):paper.Point {
    this.activeObjectSnap=objectSnaps&&this.snappingEnabled?findObjectSnap(this.objects,point,10/paper.view.zoom,this.objectSnapModes,anchor,this.interaction?.items??[]):null;
    return this.activeObjectSnap?.point??(spacing===null?point:new paper.Point(snapMM(point.x,spacing),snapMM(point.y,spacing)));
  }
  deleteSelection():void {this.cancel();if(!this.selection.length)return;const before=this.snapshot();for(const item of this.selection)item.remove();this.selected=null;this.commit(before);}
  saveText(content:string,sizeMM:number,point:paper.Point|null,uid:string|null,fontId?:string):void {
    const source=uid?this.objects.find(item=>item.data.uid===uid):undefined;
    if(uid&&(!source?.data.text||!this.isEditable(source)))throw new Error('Select editable text to update it.');
    const data:TextData={content,sizeMM,fontId:fontId??source?.data.text.fontId??'lato',transform:source?structuredClone(source.data.text.transform):[1,0,0,1,point!.x,point!.y]};
    const shape=createTextShape(data);
    if(![shape.bounds.left,shape.bounds.right,shape.bounds.top,shape.bounds.bottom].every(validNumber)){shape.remove();throw new Error('Text exceeds the document limits.');}
    if(source){
      const before=this.snapshot();shape.style=source.style;shape.data={...structuredClone(source.data),text:shape.data.text};
      source.parent.insertChild(source.index,shape);source.remove();this.selected=shape;this.commit(before);
    }else{this.addShape(shape,'Text');this.setTool('select');}
  }
  updateCallout(uid:string,text:string):void {
    const source=this.objects.find(item=>item.data.uid===uid);if(!source||!this.isEditable(source)||source.data.dimension?.kind!=='leader')return;
    const before=this.snapshot();source.data.dimension={...structuredClone(source.data.dimension),text};this.commit(before);
  }
  get canConvertText():boolean {return !this.textEditing&&!this.dimensions.active&&!this.interaction&&!this.polyline&&!this.threePointArc&&this.selection.some(item=>item.data.text&&this.isEditable(item));}
  convertTextToPaths():void {
    if(!this.canConvertText)return;
    const engraving=new Map<Shape,Shape>();
    try{
    for(const item of this.selection)if(item.data.text&&this.isEditable(item)&&isStrokeFont(item.data.text.fontId))engraving.set(item,createTextShape(item.data.text,true));
    for(const selected of this.selection)if(selected.data.text){
      const item=engraving.get(selected)??selected;
      const counts=(item.data.text as TextData).glyphContours;
      if(!counts||counts.reduce((a,b)=>a+b,0)!==pathsOf(item).length)throw new Error('Edit and save this text before converting it.');
    }
    const before=this.snapshot(),selection:Shape[]=[];
    for(const item of this.selection){
      if(!item.data.text||!this.isEditable(item)){selection.push(item);continue;}
      const geometry=engraving.get(item)??item,text=geometry.data.text as TextData,paths=pathsOf(geometry);
      const counts=text.glyphContours!;
      let offset=0,index=item.index;
      counts.forEach((count,i)=>{
        const contours=paths.slice(offset,offset+count).map(documentPath);offset+=count;
        contours.forEach((contour,part)=>{
          contour.style=item.style;contour.strokeColor=item.fillColor??item.strokeColor;contour.fillColor=null;
          contour.data={uid:crypto.randomUUID(),role:item.data.role,name:`Letter ${text.glyphLabels?.[i]||i+1}${count>1?` · Contour ${part+1}`:''}`,rotationDegrees:item.data.rotationDegrees??0};
          item.parent.insertChild(index++,contour);selection.push(contour);
        });
      });
      item.remove();
    }
    this.selection=selection;
    this.commit(before);
    }finally{engraving.forEach(shape=>shape.remove());}
  }
  get canJoinSelection():boolean {
    return !this.dimensions.active&&!this.interaction&&!this.polyline&&!this.threePointArc&&this.selection.length>1&&
      this.selection.every(item=>this.isEditable(item)&&!item.data.text&&!item.data.dimension&&item.layer===this.selection[0].layer);
  }
  joinSelection():void {
    if(!this.canJoinSelection)return;
    const before=this.snapshot(),sources=[...this.selection].sort((a,b)=>a.index-b.index),first=sources[0];
    const joined=new paper.CompoundPath({insert:false,children:sources.flatMap(pathsOf).map(documentPath)});
    joined.style=first.style;joined.strokeColor=first.strokeColor??first.fillColor;joined.fillColor=null;
    joined.data={uid:crypto.randomUUID(),role:first.data.role,name:'Joined shape',joined:true};
    first.parent.insertChild(first.index,joined);sources.forEach(item=>item.remove());
    this.selected=joined;this.commit(before);
  }
  get canExplodeSelection():boolean {
    return !this.textEditing&&!this.nodes.dragging&&!this.dimensions.active&&!this.interaction&&!this.polyline&&!this.threePointArc&&
      this.selection.some(item=>item instanceof paper.CompoundPath&&item.children.length>0&&!item.data.text&&!item.data.dimension&&this.isEditable(item));
  }
  explodeSelection():void {
    if(!this.canExplodeSelection)return;
    const before=this.snapshot(),selection:Shape[]=[];
    for(const source of this.selection){
      if(!(source instanceof paper.CompoundPath)||source.data.text||source.data.dimension||!this.isEditable(source)){selection.push(source);continue;}
      let index=source.index;
      pathsOf(source).forEach((contour,i)=>{
        const path=documentPath(contour);path.style=source.style;path.strokeColor=source.strokeColor??source.fillColor;path.fillColor=null;
        path.data={uid:crypto.randomUUID(),role:source.data.role,name:`${source.data.name??'Shape'} · Path ${i+1}`,rotationDegrees:source.data.rotationDegrees??0};
        source.parent.insertChild(index++,path);selection.push(path);
      });
      source.remove();
    }
    this.nodes.clear();this.selection=selection;this.commit(before);
  }
  private get closePathSources():Shape[] {
    return this.selection.filter(item=>this.isEditable(item)&&!item.data.dimension&&pathsOf(item).some(path=>!path.closed&&path.segments.length>1));
  }
  get canCloseSelection():boolean {
    if(this.dimensions.active||this.interaction||this.polyline||this.threePointArc)return false;
    const sources=this.closePathSources,paths=sources.flatMap(pathsOf).filter(path=>!path.closed&&path.segments.length>1);
    return sources.length>0&&sources.every(item=>item.layer===sources[0].layer)&&
      (paths.length>1||paths.some(path=>path.segments.length>2||path.curves.some(curve=>!curve.isStraight())));
  }
  closeSelection():void {
    if(!this.canCloseSelection)return;
    const sources=this.closePathSources,before=this.snapshot(),first=sources[0];
    const contours=sources.flatMap(pathsOf),open=contours.filter(path=>!path.closed&&path.segments.length>1);
    const closed=closeNearestPaths(open),retained=contours.filter(path=>!open.includes(path)).map(documentPath);
    const result:Shape=retained.length?new paper.CompoundPath({insert:false,children:[...retained,closed]}):closed;
    result.style=first.style;result.strokeColor=first.strokeColor??first.fillColor;result.fillColor=null;
    result.data={...structuredClone(first.data),name:'Closed path'};
    delete result.data.arc;delete result.data.sides;
    if(sources.length>1)delete result.data.rotationDegrees;
    first.parent.insertChild(first.index,result);
    const unchanged=this.selection.filter(item=>!sources.includes(item));
    sources.forEach(item=>item.remove());this.selection=[...unchanged,result];
    this.commit(before);
  }
  get duplicateControlPoint():paper.Point|null {
    const bounds=this.selectionBounds;
    return bounds&&this.tool!=='nodes'&&!this.textEditing&&!this.isDeleteTool&&!this.dimensions.active&&!this.interaction&&!this.polyline&&!this.threePointArc&&!this.space
      ?paper.view.projectToView(bounds.bottomCenter).add([0,28]):null;
  }
  duplicateSelection():void {
    this.cancel();
    const sources=this.selection.filter(item=>this.isEditable(item));
    if(!sources.length)return;
    const before=this.snapshot();
    this.selection=sources.map(source=>{
      const copy=source.clone({insert:false}) as Shape;
      copy.data={...structuredClone(source.data),uid:crypto.randomUUID()};
      copy.translate(new paper.Point(10,10));
      transformText(copy,new paper.Matrix().translate(new paper.Point(10,10)));
      if(copy.data.arc){copy.data.arc.cx+=10;copy.data.arc.cy+=10;}
      source.layer.addChild(copy);return copy;
    });
    this.commit(before);
  }
  addShape(item:Shape, name:string):void {
    const layer=item.data.role==='cutline'?this.cutlines:this.artwork;
    if(layer.data.deleted||!layer.visible||layer.locked)throw new Error('Show and unlock the destination layer before adding an object.');
    const before=this.snapshot();
    // Read first so Paper resolves any lazily stored color string before clearing it.
    if(item.fillColor&&!item.data.text&&item.data.rasterTrace?.mode!=='fill')item.fillColor=null;
    item.data={...item.data,uid:crypto.randomUUID(),role:item.data.role??'artwork',name};
    (item.data.role==='cutline'?this.cutlines:this.artwork).addChild(item);this.selected=item;this.commit(before);
  }
  addTracedShapes(items:Shape[],name:string):void {
    if(!items.length)return;
    if(this.artwork.data.deleted||!this.artwork.visible||this.artwork.locked)throw new Error('Show and unlock Artwork before adding traced vectors.');
    const before=this.snapshot();
    items.forEach((item,index)=>{item.data={...item.data,uid:crypto.randomUUID(),role:'artwork',name:items.length>1?`${name} · Path ${index+1}`:name};this.artwork.addChild(item);});
    this.selection=items;this.commit(before);
  }
  get canMoveSelectionToCutPath():boolean {return this.canMoveSelectionToLayer('cutline');}
  moveSelectionToCutPath():number {return this.moveSelectionToLayer('cutline');}
  outline(distance:number):void {if(!this.canOutlineSelection||!this.selected)throw new Error('Select a closed shape first.');if(!this.cutlines.visible||this.cutlines.locked)throw new Error('Show and unlock Cut Path before creating an outline.');const result=createStickerOutline(this.selected,distance);this.addShape(result,'Sticker outline');this.setTool('select');}
  setProperty(key:'x'|'y'|'width'|'height',value:number):void {
    if(!this.selection.length)return;
    if(!validNumber(value) || ((key==='width'||key==='height')&&!validDimension(value))) throw new Error('Enter a finite position or a dimension of at least 0.001 mm, within ±1,000,000 mm.');
    const before=this.snapshot(), original=this.selectionBounds!,bounds=original.clone();
    if((key==='width'||key==='height')&&original[key]<MIN_DIMENSION_MM)throw new Error('Drag a line endpoint to change its direction.');
    bounds[key]=value;
    if(this.selectedArc&&(key==='width'||key==='height')){const scale=value/original[key];bounds.width=original.width*scale;bounds.height=original.height*scale;}
    if(![bounds.left,bounds.top,bounds.right,bounds.bottom].every(validNumber)) throw new Error('The resulting bounds exceed ±1,000,000 mm.');
    this.transformSelection(this.selection,original,bounds);this.commit(before);
  }
  private normalizedRotation(angle:number):number {return ((angle%360)+360)%360;}
  get canFlipSelection():boolean {
    return !this.textEditing&&!this.nodes.dragging&&!this.dimensions.active&&!this.interaction&&!this.polyline&&!this.threePointArc&&this.selection.length>0&&this.selection.every(item=>this.isEditable(item));
  }
  flipSelection(axis:'horizontal'|'vertical'):void {
    if(!this.canFlipSelection)return;
    const horizontal=axis==='horizontal',pivot=this.selectionBounds!.center;
    const matrix=new paper.Matrix().scale(horizontal?-1:1,horizontal?1:-1,pivot),copies:Shape[]=[];
    try{
      for(const source of this.selection){
        const copy=source.clone({insert:false}) as Shape;copies.push(copy);copy.transform(matrix);transformText(copy,matrix);
        copy.data.rotationDegrees=this.normalizedRotation((horizontal?180:0)-(source.data.rotationDegrees??0));
        if(source.data.arc){
          const arc=source.data.arc as ArcGeometry,center=matrix.transform(new paper.Point(arc.cx,arc.cy));
          copy.data.arc={...arc,cx:center.x,cy:center.y,start:this.normalizedRotation((horizontal?180:0)-arc.start),sweep:-arc.sweep};
        }
        if(![copy.bounds.left,copy.bounds.top,copy.bounds.right,copy.bounds.bottom].every(validNumber))throw new Error('Flip would exceed the document coordinate limits.');
      }
    }catch(error){copies.forEach(copy=>copy.remove());throw error;}
    const before=this.snapshot();this.replaceItems(this.selection,copies);this.commit(before);
  }
  private rotatedCopies(items:readonly Shape[],degrees:number,pivot:paper.Point):Shape[] {
    const copies:Shape[]=[];
    try{
      for(const source of items){
        const copy=source.clone({insert:false}) as Shape;copies.push(copy);copy.rotate(degrees,pivot);
        transformText(copy,new paper.Matrix().rotate(degrees,pivot));
        copy.data.rotationDegrees=this.normalizedRotation((source.data.rotationDegrees??0)+degrees);
        if(source.data.arc){const arc=source.data.arc as ArcGeometry,center=new paper.Point(arc.cx,arc.cy).rotate(degrees,pivot);copy.data.arc={...arc,cx:center.x,cy:center.y,start:this.normalizedRotation(arc.start+degrees)};}
        if(![copy.bounds.left,copy.bounds.top,copy.bounds.right,copy.bounds.bottom].every(validNumber))throw new Error('Rotation would exceed the document coordinate limits.');
      }
      return copies;
    }catch(error){copies.forEach(copy=>copy.remove());throw error;}
  }
  private replaceItems(items:readonly Shape[],copies:Shape[]):void {
    items.forEach((item,i)=>{item.parent.insertChild(item.index,copies[i]);item.remove();});this.selection=copies;
  }
  setRotation(value:number):void {
    if(!this.selection.length)return;
    if(!Number.isFinite(value))throw new Error('Enter a finite rotation angle in degrees.');
    const degrees=this.selection.length===1?this.normalizedRotation(value)-this.selectionRotation:value%360;
    if(Math.abs(degrees)<1e-10)return;
    const arc=this.selectedArc,pivot=arc?new paper.Point(arc.cx,arc.cy):this.selectionBounds!.center;
    const copies=this.rotatedCopies(this.selection,degrees,pivot),before=this.snapshot();
    this.replaceItems(this.selection,copies);this.commit(before);
  }
  setArcProperty(key:'radius'|'start'|'sweep',value:number):void {
    const arc=this.selectedArc,item=this.selected;if(!arc||!(item instanceof paper.Path))return;
    const before=this.snapshot(),next={...arc,[key]:value};
    if(key==='start')next.start=((value%360)+360)%360;
    updateCircularArc(item,next);if(key==='start')item.data.rotationDegrees=this.normalizedRotation((item.data.rotationDegrees??0)+next.start-arc.start);this.commit(before);
  }
  private resize():void {
    const center=paper.view.center.clone(),r=this.canvas.parentElement!.getBoundingClientRect();
    paper.view.viewSize=new paper.Size(Math.max(1,r.width),Math.max(1,r.height));paper.view.center=center;this.changed();
  }
  private screen(event:PointerEvent|WheelEvent):paper.Point {const r=this.canvas.getBoundingClientRect();return new paper.Point(event.clientX-r.left,event.clientY-r.top);}
  private handlePoints():paper.Point[] {
    const arc=this.selectedArc;
    if(arc)return [new paper.Point(arc.cx,arc.cy),arcPoint(arc,arc.start),arcPoint(arc,arc.start+arc.sweep),arcPoint(arc,arc.start+arc.sweep/2)];
    if(this.hasEndpointHandles){const path=this.selected as paper.Path;return path.segments.map(segment=>path.localToGlobal(segment.point));}
    const b=this.selectionBounds;if(!b)return [];
    return this.boxHandlePoints(b);
  }
  private boxHandlePoints(b:paper.Rectangle):paper.Point[] {return [b.topLeft,b.topCenter,b.topRight,b.rightCenter,b.bottomRight,b.bottomCenter,b.bottomLeft,b.leftCenter];}
  private drawSelectionBorder(rectangle:paper.Rectangle):void {
    const border=new paper.Path.Rectangle({rectangle,insert:false,strokeColor:this.selectionColor,strokeWidth:1/paper.view.zoom,dashArray:[4/paper.view.zoom,4/paper.view.zoom]});
    border.data={role:'overlay',control:'selection-border'};this.overlays.addChild(border);
  }
  private drawSelectionHandles(points:paper.Point[]):void {
    for(const point of points){
      const size=8/paper.view.zoom;
      const handle=new paper.Path.Rectangle({rectangle:new paper.Rectangle(point.subtract(size/2),new paper.Size(size,size)),insert:false,fillColor:'white',strokeColor:this.selectionColor,strokeWidth:1/paper.view.zoom});
      handle.data={role:'overlay',control:'selection-handle'};this.overlays.addChild(handle);
    }
  }
  private rotationControl():{anchor:paper.Point;point:paper.Point}|null {
    const bounds=this.selectionBounds;if(!bounds||this.selectedArc)return null;
    const anchor=bounds.topCenter;
    return {anchor,point:anchor.subtract(new paper.Point(0,this.rotationHandleOffset/paper.view.zoom))};
  }
  private rotationHandlePoint():paper.Point|null {return this.rotationControl()?.point??null;}
  private drawRotationHandle():void {
    const control=this.rotationControl();if(!control)return;
    const {anchor,point}=control,state=this.interaction;
    const stem=new paper.Path({segments:[anchor,point],insert:false,strokeColor:this.selectionColor,strokeWidth:1/paper.view.zoom});
    const knob=new paper.Path.Circle({center:point,radius:this.rotationHandleRadius/paper.view.zoom,insert:false,fillColor:'white',strokeColor:this.selectionColor,strokeWidth:1/paper.view.zoom});
    const label=new paper.PointText({point:point.add([12/paper.view.zoom,4/paper.view.zoom]),content:state?.kind==='rotate'?`${Number((this.selected?this.selectionRotation:state.rotationDelta??0).toFixed(1))}°`:'Rotate',fontSize:11/paper.view.zoom,fillColor:this.selectionColor,insert:false});
    for(const item of [stem,knob,label]){item.data.role='overlay';this.overlays.addChild(item);}
    stem.data.control='rotation-stem';knob.data.control='rotate';
  }
  private changed():void {this.grid.update(paper.view);this.drawOverlay();this.onChange();paper.view.update();}
  private drawOverlay():void {
    // A drawing preview also lives on this layer, so remove selection decorations only.
    for(const child of [...this.overlays.children]) if(child.data.role==='overlay')child.remove();
    this.dimensions.draw();
    if(this.textEditing){
      if(this.textEditingBounds){this.drawSelectionBorder(this.textEditingBounds);this.drawSelectionHandles(this.boxHandlePoints(this.textEditingBounds));}
      return;
    }
    if(this.tool==='nodes'){this.nodes.draw();this.drawSnapMarker();return;}
    for(const point of [...(this.polyline?.points??[]),...(this.threePointArc?.points??[])]){const marker=new paper.Path.Circle({center:point,radius:3/paper.view.zoom,insert:false,fillColor:'white',strokeColor:this.selectionColor,strokeWidth:1/paper.view.zoom});marker.data.role='overlay';this.overlays.addChild(marker);}
    if(this.tool==='arc-endpoints'&&this.threePointArc?.points.length===2){
      const [from,to]=this.threePointArc.points,arc=this.threePointArc.item.data.arc as ArcGeometry|undefined;
      const guide=new paper.Path({segments:[from,to],insert:false,strokeColor:this.selectionColor,strokeWidth:1/paper.view.zoom,dashArray:[4/paper.view.zoom,4/paper.view.zoom]});
      guide.data.role='overlay';this.overlays.addChild(guide);
      if(arc){const label=new paper.PointText({point:arcPoint(arc,arc.start+arc.sweep/2).add([12/paper.view.zoom,-12/paper.view.zoom]),content:`${Number(Math.abs(arc.sweep).toFixed(1))}°`,insert:false,fontSize:11/paper.view.zoom,fillColor:this.selectionColor});label.data.role='overlay';this.overlays.addChild(label);}
    }
    const state=this.interaction;
    if(state?.kind==='marquee'&&state.bounds){
      const marquee=new paper.Path.Rectangle({rectangle:state.bounds,insert:false,strokeColor:this.selectionColor,fillColor:this.selectionArea,strokeWidth:1/paper.view.zoom,dashArray:[4/paper.view.zoom,4/paper.view.zoom]});
      marquee.data.role='overlay';this.overlays.addChild(marquee);
    }
    this.drawSnapMarker();
    const bounds=this.selectionBounds;
    if(this.isDeleteTool)return;
    if(!bounds||state?.kind==='draw'||this.polyline||this.threePointArc)return;
    const duplicatePoint=this.duplicateControlPoint;
    if(duplicatePoint){
      // Draw underneath the canvas handles so their white fill masks the join.
      const stem=new paper.Path({segments:[bounds.bottomCenter,paper.view.viewToProject(duplicatePoint)],insert:false,strokeColor:this.selectionColor,strokeWidth:1/paper.view.zoom});
      stem.data.role='overlay';stem.data.control='duplicate-stem';this.overlays.addChild(stem);
    }
    if(this.selectedArc){this.drawArcControls(this.selectedArc);return;}
    for(const rectangle of this.selection.length>1?[...this.selection.map(item=>item.bounds),bounds]:[bounds]){
      this.drawSelectionBorder(rectangle);
    }
    if(state?.kind==='marquee')return;
    this.drawRotationHandle();
    this.drawSelectionHandles(this.handlePoints());
  }
  private drawSnapMarker():void {
    const snap=this.activeObjectSnap;if(!snap)return;
    const zoom=paper.view.zoom,color=getComputedStyle(document.documentElement).getPropertyValue('--color-object-snap').trim();
    const marker=new paper.Path.Rectangle({rectangle:new paper.Rectangle(snap.point.subtract(5/zoom),new paper.Size(10/zoom,10/zoom)),insert:false,strokeColor:color,fillColor:'white',strokeWidth:1.5/zoom});
    const label=new paper.PointText({point:snap.point.add([10/zoom,-10/zoom]),content:SNAP_LABELS[snap.mode],insert:false,fillColor:color,fontSize:11/zoom});
    for(const item of [marker,label]){item.data.role='overlay';item.data.snapMode=snap.mode;this.overlays.addChild(item);}
  }
  private drawArcControls(arc:ArcGeometry):void {
    const center=new paper.Point(arc.cx,arc.cy),points=[center,arcPoint(arc,arc.start),arcPoint(arc,arc.start+arc.sweep),arcPoint(arc,arc.start+arc.sweep/2)];
    const guide=new paper.Path({segments:[points[1],center,points[2]],insert:false,strokeColor:this.selectionColor,strokeWidth:1/paper.view.zoom,dashArray:[4/paper.view.zoom,4/paper.view.zoom],opacity:0.45});guide.data.role='overlay';this.overlays.addChild(guide);
    points.forEach((point,index)=>{
      const size=9/paper.view.zoom;
      const handle=index===0?new paper.Path.Circle({center:point,radius:size/2,insert:false}):new paper.Path.Rectangle({rectangle:new paper.Rectangle(point.subtract(size/2),new paper.Size(size,size)),insert:false});
      if(index===3)handle.rotate(45);
      handle.fillColor=new paper.Color('white');handle.strokeColor=new paper.Color(this.selectionColor);handle.strokeWidth=1/paper.view.zoom;handle.data.role='overlay';this.overlays.addChild(handle);
      const label=new paper.PointText({point:point.add([12/paper.view.zoom,-12/paper.view.zoom]),content:['Move','Rotate','Sweep','Radius'][index],fontSize:11/paper.view.zoom,fillColor:this.selectionColor,insert:false});label.data.role='overlay';this.overlays.addChild(label);
    });
  }
  private pointerDown=(event:PointerEvent):void=>{
    if(this.interaction || ![0,1].includes(event.button))return;
    event.preventDefault();this.canvas.focus({preventScroll:true});
    if(event.button===0&&!this.space&&this.tool!=='select'&&this.tool!=='nodes'&&!this.isDeleteTool&&(this.artwork.data.deleted||!this.artwork.visible||this.artwork.locked)){this.onMessage(this.artwork.data.deleted?'Add an Artwork layer before drawing.':'Show and unlock Artwork before drawing.','warning');return;}
    const screen=this.screen(event),point=paper.view.viewToProject(screen);
    const base={id:event.pointerId,start:point,screen,center:paper.view.center.clone(),before:this.snapshot(),snapSpacing:this.gridSnappingActive?this.grid.spacingMM:null};
    if(event.button===1 || this.space){this.activeObjectSnap=null;this.clearDeletePreview();this.interaction={...base,kind:'pan'};}
    else if(isDimensionTool(this.tool)){this.dimensions.down(point);return;}
    else if(this.tool==='nodes'){this.nodes.down(event,point);return;}
    else if(this.tool==='fill'){try{this.fillAt(point);}catch(error){this.onMessage((error as Error).message,true);}return;}
    else if(this.tool==='text'){this.onTextRequest(this.snapPoint(point,base.snapSpacing),null);return;}
    else if(this.isDeleteTool){this.deleteAt(point);return;}
    else if(this.tool==='arc-three-point'||this.tool==='arc-endpoints'){this.addThreePointArcPoint(point,event.shiftKey);return;}
    else if(this.tool==='polyline'){this.addPolylinePoint(point,event.shiftKey);return;}
    else if(this.tool!=='select') {
      this.selected=null;this.interaction={...base,start:this.tool==='freehand'?point:this.snapPoint(point,base.snapSpacing),kind:'draw'};
    } else {
      const rotationHandle=this.rotationHandlePoint();
      const handle=this.handlePoints().findIndex(p=>p.getDistance(point)<=9/paper.view.zoom);
      if(rotationHandle&&rotationHandle.getDistance(point)<=9/paper.view.zoom){
        this.interaction={...base,kind:'rotate',rotationPivot:this.selectionBounds!.center,rotationDelta:0,items:[...this.selection],bounds:this.selectionBounds!,originals:this.selection.map(item=>item.clone({insert:false}) as Shape)};
      }else if(handle>=0 && this.selection.length) {
        this.interaction={...base,kind:this.selectedArc?'arc-handle':this.hasEndpointHandles?'endpoint':'resize',arcGeometry:this.selectedArc?{...this.selectedArc}:undefined,items:[...this.selection],bounds:this.selectionBounds!,handle,originals:this.selection.map(item=>item.clone({insert:false}) as Shape)};
      } else {
        const candidates=[...this.objects].reverse().filter(object=>this.isEditable(object));
        // A precise outline hit wins over the generous interior/tolerance target of enclosing paths.
        let hit:Shape|null=candidates.find(object=>!object.fillColor&&object.hitTest(point,{stroke:true,tolerance:1/paper.view.zoom}))??null;
        if(!hit)for(const object of candidates) if(object.hitTest(point,{fill:true,stroke:true,segments:true,tolerance:6/paper.view.zoom}) || ((object.data.text||object.data.dimension)&&this.objectBounds(object).contains(point)) || (object.data.role!=='cutline' && (object.data.joined?pathsOf(object).some(path=>path.closed&&path.contains(point)):this.isClosedShape(object)&&object.contains(point)))){hit=object;break;}
        if(hit){
          if(event.shiftKey){this.select(hit,true);return;}
          if(!this.selection.includes(hit))this.selected=hit;
          this.interaction={...base,before:this.snapshot(),kind:'move',items:[...this.selection],positions:this.selection.map(item=>item.position.clone()),bounds:this.selectionBounds!};
        }else{
          const initialSelection=event.shiftKey?[...this.selection]:[];
          this.selection=initialSelection;
          this.interaction={...base,kind:'marquee',initialSelection};
        }
      }
    }
    if(this.interaction)this.canvas.setPointerCapture(event.pointerId);
    this.changed();this.updateCursor();
  };
  private pointerMove=(event:PointerEvent):void=>{
    if(this.nodes.dragging){this.nodes.move(event,paper.view.viewToProject(this.screen(event)));return;}
    const state=this.interaction;
    if(!state&&isDimensionTool(this.tool)){this.dimensions.move(paper.view.viewToProject(this.screen(event)));return;}
    if(!state&&this.isDeleteTool){if(this.space)this.clearDeletePreview();else this.previewDelete(paper.view.viewToProject(this.screen(event)));this.changed();return;}
    if(!state&&this.threePointArc){this.previewThreePointArc(paper.view.viewToProject(this.screen(event)),event.shiftKey);return;}
    if(!state&&this.polyline){this.previewPolyline(paper.view.viewToProject(this.screen(event)),event.shiftKey);return;}
    if(!state){
      if(!this.space&&this.tool!=='select'&&this.tool!=='nodes'&&this.tool!=='fill'&&this.tool!=='freehand'&&!this.isDeleteTool)this.snapPoint(paper.view.viewToProject(this.screen(event)),null);
      else this.activeObjectSnap=null;
      this.changed();return;
    }
    if(state.id!==event.pointerId)return;event.preventDefault();
    const screen=this.screen(event),point=paper.view.viewToProject(screen);
    if(state.kind==='draw'||state.kind==='move'||state.kind==='resize'||state.kind==='marquee'||state.kind==='endpoint'||state.kind==='arc-handle'||state.kind==='rotate'){
      state.hasDragged ||= screen.getDistance(state.screen)>=2;
      if(!state.hasDragged)return;
    }
    if(state.kind==='pan')paper.view.center=state.center.subtract(screen.subtract(state.screen).divide(paper.view.zoom));
    if(state.kind==='draw'){
      if(this.tool==='freehand'){
        for(const sample of event.getCoalescedEvents?.()??[])this.appendFreehand(state,paper.view.viewToProject(this.screen(sample)));
        this.appendFreehand(state,point);
      }else this.drawShape(state,point,event.shiftKey);
    }
    if(state.kind==='marquee'){
      state.bounds=new paper.Rectangle(state.start,point);
      this.selection=[...new Set([...(state.initialSelection??[]),...this.objects.filter(item=>this.isEditable(item)&&state.bounds!.contains(item.bounds))])];
    }
    if(state.kind==='move' && state.items && state.positions && state.bounds) {
      const topLeft=this.snapPoint(state.bounds.topLeft.add(point.subtract(state.start)),state.snapSpacing);
      const delta=topLeft.subtract(state.bounds.topLeft);
      state.items.forEach((item,i)=>{
        const target=state.positions![i].add(delta),offset=target.subtract(item.position);
        if(item.data.arc){item.data.arc.cx+=offset.x;item.data.arc.cy+=offset.y;}
        item.position=target;
        transformText(item,new paper.Matrix().translate(offset));
      });
    }
    if(state.kind==='rotate'&&state.items&&state.originals&&state.rotationPivot){
      const vector=point.subtract(state.rotationPivot);
      if(vector.length>=1/paper.view.zoom){
        let degrees=vector.angle-state.start.subtract(state.rotationPivot).angle;
        const initial=state.originals.length===1?(state.originals[0].data.rotationDegrees??0):0;
        if(event.shiftKey)degrees=Math.round((initial+degrees)/15)*15-initial;
        try{const copies=this.rotatedCopies(state.originals,degrees,state.rotationPivot);this.replaceItems(state.items,copies);state.items=copies;state.rotationDelta=degrees;}
        catch{/* Keep the last valid rotation while dragging beyond document limits. */}
      }
    }
    if(state.kind==='arc-handle'&&state.arcGeometry&&state.items){
      const arc={...state.arcGeometry},center=new paper.Point(arc.cx,arc.cy),delta=point.subtract(center);
      if(state.handle===0){const target=this.snapPoint(center.add(point.subtract(state.start)),state.snapSpacing);arc.cx=target.x;arc.cy=target.y;}
      else if(delta.length>=MIN_DIMENSION_MM){
        if(state.handle===3)arc.radius=Math.max(MIN_DIMENSION_MM,state.snapSpacing===null?delta.length:snapMM(delta.length,state.snapSpacing));
        else if(state.handle===1)arc.start=snapArcAngle(delta.angle,event.shiftKey);
        else {const sign=Math.sign(arc.sweep),angle=((sign*(delta.angle-arc.start)%360)+360)%360;arc.sweep=sign*Math.max(1,Math.min(359,snapArcAngle(angle,event.shiftKey)));}
      }
      try{updateCircularArc(state.items[0] as paper.Path,arc);if(state.handle===1)state.items[0].data.rotationDegrees=this.normalizedRotation((state.originals?.[0].data.rotationDegrees??0)+arc.start-state.arcGeometry.start);}catch{/* Keep the last valid geometry when a handle crosses document limits. */}
    }
    if(state.kind==='endpoint'&&state.items){
      const item=state.items[0] as paper.Path,anchor=item.localToGlobal(item.segments[1-state.handle!].point);
      const target=this.segmentEnd(anchor,point,state.snapSpacing,event.shiftKey);
      if(target.getDistance(anchor)>=MIN_DIMENSION_MM)item.segments[state.handle!].point=item.globalToLocal(target);
    }
    if(state.kind==='resize' && state.items && state.bounds && state.originals) {
      const b=state.bounds,h=state.handle!, anchor=[b.bottomRight,b.bottomCenter,b.bottomLeft,b.leftCenter,b.topLeft,b.topCenter,b.topRight,b.rightCenter][h];
      const handle=[b.topLeft,b.topCenter,b.topRight,b.rightCenter,b.bottomRight,b.bottomCenter,b.bottomLeft,b.leftCenter][h];
      const target=this.snapPoint(handle.add(point.subtract(state.start)),state.snapSpacing,undefined,!event.shiftKey&&h%2===0);
      const minimum=this.activeObjectSnap?MIN_DIMENSION_MM:state.snapSpacing??MIN_DIMENSION_MM;
      const horizontal=h!==1&&h!==5&&b.width>=MIN_DIMENSION_MM,vertical=h!==3&&h!==7&&b.height>=MIN_DIMENSION_MM;
      let width=horizontal?Math.max(minimum,Math.abs(target.x-anchor.x)):b.width;
      let height=vertical?Math.max(minimum,Math.abs(target.y-anchor.y)):b.height;
      if(event.shiftKey&&(horizontal||vertical)) {const scale=horizontal&&vertical?Math.max(width/b.width,height/b.height):horizontal?width/b.width:height/b.height;width=b.width*scale;height=b.height*scale;}
      const left=[0,6,7].includes(h),top=[0,1,2].includes(h);
      const x=horizontal?(left?anchor.x-width:anchor.x):b.center.x-width/2;
      const y=vertical?(top?anchor.y-height:anchor.y):b.center.y-height/2;
      // Rebuild from the original for every sample, avoiding accumulated rounding/flattening.
      state.items=state.items.map((item,i)=>{
        const replacement=state.originals![i].clone({insert:false}) as Shape;
        item.parent.insertChild(item.index,replacement);item.remove();return replacement;
      });
      this.transformSelection(state.items,b,new paper.Rectangle(x,y,width,height));this.selection=state.items;
    }
    this.changed();
  };
  private transformSelection(items:Shape[],from:paper.Rectangle,to:paper.Rectangle):void {
    const sx=from.width>=MIN_DIMENSION_MM?to.width/from.width:1,sy=from.height>=MIN_DIMENSION_MM?to.height/from.height:1;
    for(const item of items){
      const arc=item.data.arc as ArcGeometry|undefined;
      item.scale(sx,sy,from.topLeft);transformText(item,new paper.Matrix().scale(sx,sy,from.topLeft));
      const delta=to.topLeft.subtract(from.topLeft);item.translate(delta);transformText(item,new paper.Matrix().translate(delta));
      if(arc){
        if(Math.abs(sx-sy)<1e-9)item.data.arc={...arc,cx:to.x+(arc.cx-from.x)*sx,cy:to.y+(arc.cy-from.y)*sy,radius:arc.radius*sx};
        else delete item.data.arc; // A nonuniform group transform intentionally converts the arc to a freeform path.
      }
    }
  }
  private clearDeletePreview():void {disposeDeletePlan(this.deletionPreview);this.deletionPreview=null;}
  private previewDelete(point:paper.Point):void {
    this.clearDeletePreview();
    try{this.deletionPreview=createDeletePlan(this.tool==='dissect-delete'?this.objects.filter(item=>!item.data.dimension):this.objects,point,6/paper.view.zoom,this.tool as 'dissect-delete'|'line-delete');}
    catch{return;}
    for(const path of this.deletionPreview?.preview??[]){
      path.strokeColor=new paper.Color(this.deletePreviewColor);path.strokeWidth=5;path.strokeScaling=false;path.fillColor=null;path.opacity=0.85;path.data.role='delete-preview';this.overlays.addChild(path);
    }
  }
  private deleteAt(point:paper.Point):void {
    this.clearDeletePreview();let plan:DeletePlan|null=null;
    try{
      plan=createDeletePlan(this.tool==='dissect-delete'?this.objects.filter(item=>!item.data.dimension):this.objects,point,6/paper.view.zoom,this.tool as 'dissect-delete'|'line-delete');
      if(!plan){this.changed();return;}
      const before=this.snapshot(),owner=plan.owner;
      let replacement:Shape|null=null;
      if(plan.remaining?.length){
        replacement=plan.remaining.length===1?plan.remaining[0]:new paper.CompoundPath({children:plan.remaining,insert:false});
        replacement.style=owner.style;if(owner.fillColor&&!owner.strokeColor)replacement.strokeColor=owner.fillColor;replacement.fillColor=null;
        replacement.data={...owner.data,name:'Trimmed path'};delete replacement.data.arc;delete replacement.data.sides;delete replacement.data.text;
        owner.parent.insertChild(owner.index,replacement);plan.remaining=null;
      }
      this.selection=this.selection.flatMap(item=>item===owner?(replacement?[replacement]:[]):[item]);
      owner.remove();this.commit(before);
    }catch(error){this.onMessage((error as Error).message,true);}
    finally{disposeDeletePlan(plan);}
  }
  private addThreePointArcPoint(point:paper.Point,shift=false):void {
    const angleStep=this.tool==='arc-endpoints'&&this.threePointArc?.points.length===2;
    const spacing=this.threePointArc?this.threePointArc.spacing:this.gridSnappingActive?this.grid.spacingMM:null,end=angleStep?point:this.snapPoint(point,spacing);
    if(angleStep)this.activeObjectSnap=null;
    if(!validNumber(end.x)||!validNumber(end.y)){this.onMessage('Arc points must be within the document coordinate limits.',true);return;}
    if(!this.threePointArc){
      const before=this.snapshot(),item=new paper.Path({insert:false});this.overlays.addChild(item);
      this.threePointArc={points:[end],item,before,spacing};this.selected=null;this.previewThreePointArc();return;
    }
    const state=this.threePointArc;
    if(state.points.some(point=>point.getDistance(end)<MIN_DIMENSION_MM)){this.onMessage('Choose three different points for the arc.',true);return;}
    if(state.points.length===1){state.points.push(end);this.previewThreePointArc();return;}
    try{
      const item=this.tool==='arc-endpoints'?createEndpointArc(state.points[0],state.points[1],end,shift):createArc(state.points[0],state.points[1],end);
      item.strokeColor=new paper.Color('#383838');item.strokeWidth=1.5;item.strokeScaling=false;item.fillColor=null;
      item.data={...item.data,role:'artwork',uid:crypto.randomUUID(),name:'Arc'};
      if(this.tool==='arc-endpoints'){this.tool='select';this.updateCursor();}
      state.item.remove();this.threePointArc=null;this.activeObjectSnap=null;this.artwork.addChild(item);this.selected=item;this.commit(state.before);
    }catch(error){this.onMessage((error as Error).message,true);}
  }
  private previewThreePointArc(point?:paper.Point,shift=false):void {
    const state=this.threePointArc!,angleStep=this.tool==='arc-endpoints'&&state.points.length===2;
    const points=point?[...state.points,angleStep?point:this.snapPoint(point,state.spacing)]:state.points;
    if(angleStep)this.activeObjectSnap=null;
    let item:paper.Path|null=null;
    if(points.length===3){try{item=this.tool==='arc-endpoints'?createEndpointArc(points[0],points[1],points[2],shift):createArc(points[0],points[1],points[2]);}catch{/* Keep a guide for invalid preview positions. */}}
    if(!item)item=new paper.Path({segments:angleStep?state.points:points,insert:false,dashArray:[4,4]});
    item.strokeColor=new paper.Color('#383838');item.strokeWidth=1.5;item.strokeScaling=false;item.fillColor=null;
    state.item.remove();this.overlays.addChild(item);state.item=item;this.changed();
  }
  private segmentEnd(start:paper.Point,point:paper.Point,spacing:number|null,shift:boolean):paper.Point {
    const end=this.snapPoint(point,spacing,start,!shift);if(!shift)return end;
    const delta=end.subtract(start),angle=Math.round(Math.atan2(delta.y,delta.x)/(Math.PI/4))*(Math.PI/4);
    return start.add(new paper.Point(Math.cos(angle)*delta.length,Math.sin(angle)*delta.length));
  }
  private addPolylinePoint(point:paper.Point,shift:boolean):void {
    if(!this.polyline){
      const before=this.snapshot(),spacing=this.gridSnappingActive?this.grid.spacingMM:null;
      const item=new paper.Path({insert:false,closed:false,strokeColor:'#383838',strokeWidth:1.5,strokeScaling:false,fillColor:null});
      this.overlays.addChild(item);this.polyline={points:[this.snapPoint(point,spacing)],item,before,spacing};this.selected=null;
    }else{
      const state=this.polyline,last=state.points[state.points.length-1],end=this.segmentEnd(last,point,state.spacing,shift);
      if(last.getDistance(end)>=MIN_DIMENSION_MM)state.points.push(end);
    }
    this.polyline.item.removeSegments();this.polyline.item.addSegments(this.polyline.points.map(point=>new paper.Segment(point)));this.changed();
  }
  private previewPolyline(point:paper.Point,shift:boolean):void {
    const state=this.polyline!;state.item.removeSegments();state.item.addSegments(state.points.map(point=>new paper.Segment(point)));
    const last=state.points[state.points.length-1],end=this.segmentEnd(last,point,state.spacing,shift);
    if(last.getDistance(end)>=MIN_DIMENSION_MM)state.item.add(end);this.changed();
  }
  private finishPolyline():void {
    const state=this.polyline;if(!state)return;
    if(state.points.length<2){this.cancel();return;}
    this.polyline=null;this.activeObjectSnap=null;state.item.removeSegments();state.item.addSegments(state.points.map(point=>new paper.Segment(point)));
    state.item.data={...state.item.data,role:'artwork',uid:crypto.randomUUID(),name:'Polyline'};
    this.artwork.addChild(state.item);this.selected=state.item;this.commit(state.before);
  }
  private appendFreehand(state:Interaction,point:paper.Point,force=false):void {
    if(![state.start.x,state.start.y,point.x,point.y].every(validNumber))return;
    if(!state.item){
      state.item=new paper.Path({segments:[state.start],insert:false,closed:false,fillColor:null,strokeColor:'#383838',strokeWidth:1.5,strokeScaling:false,strokeCap:'round',strokeJoin:'round'});
      this.overlays.addChild(state.item);
    }
    const path=state.item as paper.Path;
    if(path.lastSegment.point.getDistance(point)>=(force?0.000001:1.5/paper.view.zoom))path.add(point);
  }
  private finishFreehand(state:Interaction,event:PointerEvent):void {
    if(!state.item)return;
    this.appendFreehand(state,paper.view.viewToProject(this.screen(event)),true);
    const path=state.item as paper.Path;
    if(path.segments.length>2){
      const original=path.segments.map(segment=>segment.clone());
      path.simplify(0.75/paper.view.zoom);
      if(![path.bounds.left,path.bounds.top,path.bounds.right,path.bounds.bottom].every(validNumber)){
        path.removeSegments();path.addSegments(original);
      }
    }
  }
  private drawShape(state:Interaction,point:paper.Point,shift:boolean):void {
    state.drawPoint=point;state.shift=shift;state.item?.remove();
    const cornerTool=this.tool==='rectangle'||this.tool==='ellipse';
    const target=this.tool==='line'?point:this.snapPoint(point,cornerTool?state.snapSpacing:null,undefined,!shift);
    let delta=target.subtract(state.start);
    if(shift&&cornerTool){const size=Math.max(Math.abs(delta.x),Math.abs(delta.y));delta=new paper.Point(Math.sign(delta.x||1)*size,Math.sign(delta.y||1)*size);}
    const bounds=new paper.Rectangle(state.start,state.start.add(delta));
    const radius=state.snapSpacing===null||this.activeObjectSnap?delta.length:snapMM(delta.length,state.snapSpacing);
    let item:paper.Path;
    if(this.tool==='arc'){
      if(radius<MIN_DIMENSION_MM){state.item=undefined;return;}
      try{item=createCircularArc({cx:state.start.x,cy:state.start.y,radius,start:(this.activeObjectSnap?delta.angle:snapArcAngle(point.subtract(paper.view.viewToProject(state.screen)).angle,shift))+180,sweep:180});}
      catch{state.item=undefined;return;}
    }
    else if(this.tool==='line')item=new paper.Path({segments:[state.start,this.segmentEnd(state.start,point,state.snapSpacing,shift)],insert:false,closed:false});
    else if(this.tool==='rectangle')item=new paper.Path.Rectangle({rectangle:bounds,insert:false});
    else if(this.tool==='ellipse')item=new paper.Path.Ellipse({rectangle:bounds,insert:false});
    else if(this.tool==='polygon'){
      let angle=Math.atan2(delta.y,delta.x);
      if(shift)angle=Math.round(angle/(Math.PI/12))*(Math.PI/12);
      const segments=Array.from({length:this.polygonSides},(_,i)=>{
        const theta=angle+i*2*Math.PI/this.polygonSides;
        return state.start.add(new paper.Point(Math.cos(theta)*radius,Math.sin(theta)*radius));
      });
      item=new paper.Path({segments,closed:true,insert:false});
    }else item=new paper.Path.Circle({center:state.start,radius,insert:false});
    item.fillColor=null;item.strokeColor=new paper.Color('#383838');item.strokeWidth=1.5;item.strokeScaling=false;
    this.overlays.addChild(item);state.item=item;
  }
  private pointerUp=(event:PointerEvent):void=>{
    if(this.nodes.dragging){this.nodes.up(event,paper.view.viewToProject(this.screen(event)));return;}
    const state=this.interaction;if(!state||event.pointerId!==state.id)return;
    this.pointerMove(event);if(state.kind==='draw'&&this.tool==='freehand')this.finishFreehand(state,event);this.interaction=null;this.activeObjectSnap=null;state.originals?.forEach(item=>item.remove());
    if(state.kind==='draw' && state.item) {
      if(this.tool==='line'||this.tool==='freehand'?(state.item as paper.Path).length<MIN_DIMENSION_MM:state.item.bounds.width<MIN_DIMENSION_MM||state.item.bounds.height<MIN_DIMENSION_MM)state.item.remove();
      else {state.item.data={...state.item.data,role:'artwork',uid:crypto.randomUUID(),name:this.tool[0].toUpperCase()+this.tool.slice(1),...(this.tool==='polygon'?{sides:this.polygonSides}:{})};this.artwork.addChild(state.item);this.selected=state.item;if(this.tool==='arc')this.tool='select';}
    }
    if(state.kind!=='pan'&&state.kind!=='marquee')this.commit(state.before);
    if(this.canvas.hasPointerCapture(event.pointerId))this.canvas.releasePointerCapture(event.pointerId);
    this.updateCursor();this.changed();
  };
  cancel():void {
    this.dimensions.cancel();this.nodes.cancel();
    this.activeObjectSnap=null;this.clearDeletePreview();
    const arc=this.threePointArc;this.threePointArc=null;
    if(arc){arc.item.remove();this.restore(arc.before);}
    const polyline=this.polyline;this.polyline=null;
    if(polyline){polyline.item.remove();this.restore(polyline.before);}
    const state=this.interaction;this.interaction=null;
    if(state){state.originals?.forEach(item=>item.remove());if(state.kind==='draw')state.item?.remove();if(state.kind==='pan')paper.view.center=state.center;else this.restore(state.before);if(this.canvas.hasPointerCapture(state.id))this.canvas.releasePointerCapture(state.id);}
    this.updateCursor();this.changed();
  }
  private wheel=(event:WheelEvent):void=>{
    event.preventDefault();if(this.interaction)return;this.activeObjectSnap=null;this.clearDeletePreview();
    const cursor=this.screen(event),anchor=paper.view.viewToProject(cursor);
    const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?this.canvas.clientHeight:1);
    paper.view.zoom=Math.min(MAX_ZOOM,Math.max(MIN_ZOOM,paper.view.zoom*Math.exp(-delta*0.0015)));
    paper.view.center=paper.view.center.add(anchor.subtract(paper.view.viewToProject(cursor)));this.changed();
  };
  private keyDown=(event:KeyboardEvent):void=>{
    if(event.target instanceof HTMLElement && (event.target.closest('input,textarea,select,[contenteditable="true"]')))return;
    const key=event.key.toLowerCase(),command=event.metaKey||event.ctrlKey;
    if(event.code==='Space'){event.preventDefault();this.activeObjectSnap=null;this.clearDeletePreview();this.changed();this.space=true;this.updateCursor();return;}
    if(command&&key==='z'){event.preventDefault();event.shiftKey?this.redo():this.undo();return;}
    if(command&&key==='y'){event.preventDefault();this.redo();return;}
    if(command||event.altKey)return;
    if(this.threePointArc&&key==='backspace'){event.preventDefault();this.threePointArc.points.pop();if(!this.threePointArc.points.length)this.cancel();else this.previewThreePointArc();return;}
    if(this.polyline&&key==='enter'){event.preventDefault();this.finishPolyline();return;}
    if(this.polyline&&key==='backspace'){event.preventDefault();this.polyline.points.pop();if(!this.polyline.points.length)this.cancel();else{this.polyline.item.removeSegments();this.polyline.item.addSegments(this.polyline.points.map(point=>new paper.Segment(point)));this.changed();}return;}
    if(key==='escape'){event.preventDefault();if(this.interaction||this.nodes.dragging||this.dimensions.active||this.polyline||this.threePointArc)this.cancel();else if(this.isDeleteTool)this.setTool('select');else this.select(null);}
    if(key==='delete'||key==='backspace'){event.preventDefault();if(this.tool==='nodes')this.nodes.action('delete');else this.deleteSelection();}
    if(key==='s'&&!event.repeat){event.preventDefault();this.setSnappingEnabled(!this.snappingEnabled);}
    if(this.tool==='polygon'&&event.target===this.canvas&&(key==='arrowup'||key==='arrowdown')){event.preventDefault();this.setPolygonSides(Math.max(3,Math.min(64,this.polygonSides+(key==='arrowup'?1:-1))));return;}
    if(key==='f')this.setTool('freehand');
    if(key==='b')this.setTool('fill');
    if(key==='t')this.setTool('text');
    if(key==='n')this.setTool('nodes');
    if(key==='d'&&!event.shiftKey)this.setTool('dimension-aligned');
    if(key==='k')this.setTool(event.shiftKey?'line-delete':'dissect-delete');
    if(key==='v')this.setTool('select');if(key==='r')this.setTool('rectangle');if(key==='c')this.setTool('circle');if(key==='e')this.setTool('ellipse');if(key==='y')this.setTool('polygon');if(key==='l')this.setTool('line');if(key==='p')this.setTool('polyline');if(key==='a')this.setTool(event.shiftKey?'arc-three-point':'arc');
  };
  private updateCursor():void {this.canvas.style.cursor=this.interaction?.kind==='pan'||this.interaction?.kind==='rotate'?'grabbing':this.space?'grab':this.tool==='select'||this.tool==='nodes'?'default':this.tool==='text'?'text':'crosshair';}
}
