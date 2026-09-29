import type { Family } from './generators/catalog';
import { HelpGuide } from './help';
import { ToolSearch, type SearchTool } from './toolSearch';
import { GRID_NAMES, GRID_HELP, type GridType } from './gridGeometry';
import { initializeThemeControls } from './theme';
import { CanvasRulers } from './rulers';
import { alignPopoutWithTrigger } from './menuPosition';
import paper from 'paper';
import {RasterToVector} from './rasterToVector';
import { Alerts, type AlertKind } from './alerts';
import { CADEditor } from './editor';
import { LayersPanel } from './layersPanel';
import { Preferences } from './preferences';
import { SelectionContextMenu } from './selectionContextMenu';
import { FloatingSelectionMenu } from './floatingSelectionMenu';
import { InlineText } from './inlineText';
import { DIMENSION_NAMES, isDimensionTool } from './dimensions';
import { loadTextFont } from './text';
import type { ObjectSnapMode } from './objectSnapping';
import { initializeClipper } from './clipperService';
import { downloadDXF, exportDXF } from './exportDXF';
import { downloadSVG, exportSVG } from './exportSVG';
import { DocumentFiles } from './documentFiles';
import { BASE_ZOOM } from './units';
import type { ToolName } from './types';
const $=<T extends HTMLElement>(selector:string)=>document.querySelector<T>(selector)!;
const editor=new CADEditor($<HTMLCanvasElement>('#cad-canvas'));
const rulers=new CanvasRulers(editor.canvas,document.querySelector<SVGSVGElement>('.ruler-left')!,document.querySelector<SVGSVGElement>('.ruler-bottom')!);
const resetZoom=$<HTMLButtonElement>('[data-reset-zoom]');
resetZoom.onclick=()=>editor.resetZoom();
resetZoom.addEventListener('keydown',event=>event.stopPropagation());
let ready=false;
const alerts=new Alerts($('#toast-stack'),editor.canvas,()=>closeMenus());
function notify(message:string,kind:boolean|AlertKind=false):void {
  alerts.show(message,typeof kind==='boolean'?(kind?'error':'information'):kind);
}
function attempt(action:()=>void):void {try{action();}catch(error){notify(error instanceof Error?error.message:String(error),true);}}
const props=$('#properties-panel'),layers=$('#primary-layers-panel');
const propertiesButton=$<HTMLButtonElement>('[aria-label="Properties"]'),layersButton=$<HTMLButtonElement>('[aria-label="Layers"]');
const layersPanel=new LayersPanel(layers,editor,()=>{setPanel(layers,false);layersButton.focus();});
const selectionMenu=new FloatingSelectionMenu($('#selection-menu'),editor);
const selectionContextMenu=new SelectionContextMenu(editor,()=>closeMenus());
const inlineText=new InlineText($<HTMLTextAreaElement>('#inline-text'),editor);
const documentFiles=new DocumentFiles(editor,$<HTMLDialogElement>('#document-dialog'),$<HTMLInputElement>('#open-document-file'),()=>inlineText.finish(false,false),notify);
const textFontSelect=$<HTMLSelectElement>('#text-font'),textSize=$<HTMLInputElement>('#text-property-size');
let textStyleRequest=0;
async function updateTextStyle():Promise<void> {
  const selected=editor.selected;if(!selected?.data.text)return;
  const uid=selected.data.uid,fontId=textFontSelect.value,size=textSize.valueAsNumber,request=++textStyleRequest;
  textFontSelect.disabled=true;textSize.disabled=true;$<HTMLButtonElement>('#edit-text').disabled=true;
  try{await loadTextFont(fontId);const current=editor.selected;if(request!==textStyleRequest||editor.textEditing||!current||current.data.uid!==uid)return;editor.saveText(current.data.text.content,size,null,uid,fontId);}
  catch(error){notify((error as Error).message,true);update();}
  finally{if(request===textStyleRequest){textFontSelect.disabled=false;textSize.disabled=false;$<HTMLButtonElement>('#edit-text').disabled=false;}}
}
textFontSelect.addEventListener('change',()=>{void updateTextStyle();});
textSize.addEventListener('change',()=>{void updateTextStyle();});
const convertTextButton=$<HTMLButtonElement>('#convert-text');
convertTextButton.addEventListener('click',()=>attempt(()=>{editor.convertTextToPaths();editor.canvas.focus({preventScroll:true});}));
convertTextButton.addEventListener('keydown',event=>{if(event.key===' '||event.key==='Enter')event.stopPropagation();});
$('#edit-text').addEventListener('click',()=>{if(editor.selected?.data.text)editor.onTextRequest(null,editor.selected);});
const closePathButton=$<HTMLButtonElement>('#selection-menu [aria-label="Close path"]');
closePathButton.addEventListener('click',()=>attempt(()=>{editor.closeSelection();editor.canvas.focus({preventScroll:true});}));
closePathButton.addEventListener('keydown',event=>{if(event.key===' '||event.key==='Enter')event.stopPropagation();});
const joinButton=$<HTMLButtonElement>('#selection-menu [aria-label="Join"]');
const explodeButton=$<HTMLButtonElement>('#selection-menu [aria-label="Explode"]');
explodeButton.addEventListener('click',()=>attempt(()=>{editor.explodeSelection();editor.canvas.focus({preventScroll:true});}));
explodeButton.addEventListener('keydown',event=>{if(event.key===' '||event.key==='Enter')event.stopPropagation();});
const flipButtons=document.querySelectorAll<HTMLButtonElement>('#selection-menu [data-flip]');
for(const button of flipButtons){
  button.addEventListener('click',()=>attempt(()=>{editor.flipSelection(button.dataset.flip as 'horizontal'|'vertical');editor.canvas.focus({preventScroll:true});}));
  button.addEventListener('keydown',event=>{if(event.key===' '||event.key==='Enter')event.stopPropagation();});
}
joinButton.addEventListener('click',()=>attempt(()=>{editor.joinSelection();editor.canvas.focus({preventScroll:true});}));
joinButton.addEventListener('keydown',event=>{if(event.key===' '||event.key==='Enter')event.stopPropagation();});
const shapeOperationsButton=$<HTMLButtonElement>('[data-shape-operations-open]');
shapeOperationsButton.onclick=()=>{closeMenus();selectionContextMenu.close();editor.shapeOperations.open();};
shapeOperationsButton.addEventListener('keydown',event=>event.stopPropagation());
const patternButton=$<HTMLButtonElement>('[data-pattern-open]');
patternButton.onclick=()=>{closeMenus();selectionContextMenu.close();editor.patterns.open();};
patternButton.addEventListener('keydown',event=>event.stopPropagation());
const duplicateButton=$<HTMLButtonElement>('#duplicate-selection');
duplicateButton.addEventListener('click',()=>attempt(()=>{editor.duplicateSelection();editor.canvas.focus({preventScroll:true});}));
duplicateButton.addEventListener('keydown',event=>{
  event.stopPropagation();
  if(event.key==='Escape'){event.preventDefault();editor.canvas.focus({preventScroll:true});}
});
let exportRequested=false;
function updatePropertiesContent():void {
  const hasSelection=editor.selectedItems.length>0;
  $('#properties-empty').hidden=hasSelection||exportRequested;
  $('#selection-properties').hidden=!hasSelection;
  $('#properties-export').hidden=!hasSelection&&!exportRequested;
}
function setPanel(panel:HTMLElement,open:boolean,showExport=false):void {
  exportRequested=panel===props&&open&&showExport;
  updatePropertiesContent();
  props.hidden=panel!==props||!open;layers.hidden=panel!==layers||!open;
  if(panel===layers&&open)layersPanel.open();
  for(const [button,target] of [[propertiesButton,props],[layersButton,layers]] as const){button.classList.toggle('selected',!target.hidden);button.setAttribute('aria-pressed',String(!target.hidden));button.setAttribute('aria-expanded',String(!target.hidden));}
  selectionMenu.render();selectionContextMenu.refresh();
}
setPanel(props,false);
propertiesButton.setAttribute('aria-controls','properties-panel');
propertiesButton.onclick=()=>setPanel(props,props.hidden);
layersButton.onclick=()=>setPanel(layers,layers.hidden);
$('#close-properties').onclick=()=>{setPanel(props,false);propertiesButton.focus();};$('#close-layers').onclick=()=>{setPanel(layers,false);layersButton.focus();};
const shapeMenu=$('#primary-shapes-menu'),fileMenu=$('#primary-file-menu'),lineMenu=$('#primary-lines-menu'),arcMenu=$('#primary-arcs-menu'),deleteMenu=$('#primary-delete-menu'),dimensionMenu=$('#primary-dimensions-menu'),imageMenu=$('#primary-images-menu'),fillMenu=$('#primary-fill-menu'),generatorMenu=$('#primary-generators-menu');
const menus=[[shapeMenu,$('[data-shape-trigger]')],[fileMenu,$('[data-file-trigger]')],[lineMenu,$('[data-line-trigger]')],[arcMenu,$('[data-arc-trigger]')],[deleteMenu,$('[data-delete-trigger]')],[dimensionMenu,$('[data-dimension-trigger]')],[imageMenu,$('[data-image-trigger]')],[fillMenu,$('[data-fill-trigger]')],[generatorMenu,$('[data-generator-trigger]')]] as const;
function closeMenus():void {alerts.close();for(const [menu,trigger] of menus){menu.hidden=true;trigger.setAttribute('aria-expanded','false');}}
function toggleMenu(menu:HTMLElement,trigger:HTMLElement):void {const open=menu.hidden;closeMenus();menu.hidden=!open;trigger.setAttribute('aria-expanded',String(open));if(open){if(menu!==fileMenu)alignPopoutWithTrigger(menu,trigger);(menu.querySelector<HTMLButtonElement>('button:not(:disabled)')??menu).focus({preventScroll:true});}}
window.addEventListener('resize',()=>{for(const [menu,trigger] of menus)if(menu!==fileMenu)alignPopoutWithTrigger(menu,trigger);});
$('[data-shape-trigger]').onclick=()=>toggleMenu(shapeMenu,$('[data-shape-trigger]'));
$('[data-image-trigger]').onclick=()=>toggleMenu(imageMenu,$('[data-image-trigger]'));
$('[data-generator-trigger]').onclick=()=>toggleMenu(generatorMenu,$('[data-generator-trigger]'));
generatorMenu.addEventListener('keydown',event=>{
  if(event.key==='Escape')return;
  event.stopPropagation();
  const buttons=[...generatorMenu.querySelectorAll<HTMLButtonElement>('[data-generator]')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:event.key==='ArrowDown'?(index+1)%buttons.length:event.key==='ArrowUp'?(index+buttons.length-1)%buttons.length:-1;
  if(next>=0){event.preventDefault();buttons[next].focus();}
});
let generatorWorkbench:import('./generators/workbench').GeneratorWorkbench|undefined;
let generatorLoading=false;
for(const button of generatorMenu.querySelectorAll<HTMLButtonElement>('[data-generator]'))button.onclick=async()=>{
  if(generatorLoading||!inlineText.finish(false,false))return;
  generatorLoading=true;editor.cancel();closeMenus();selectionContextMenu.close();editor.nodes.closeMenu();
  try{
    const [{GeneratorWorkbench},{generatedShapes}]=await Promise.all([import('./generators/workbench'),import('./generators/paperShapes')]);
    generatorWorkbench??=new GeneratorWorkbench({
      destination:result=>{const layer=editor.activeLayer,engrave=editor.documentLayers.find(item=>item.data.objectRole==='engrave');return {name:layer?.name??'Artwork',error:!layer||!layer.visible||layer.locked?'Show and unlock the active layer before inserting.':result?.parts.some(part=>part.operation==='engrave')&&(!engrave||!engrave.visible||engrave.locked)?'Show and unlock Engrave Path before inserting fold lines.':undefined};},
      insert:result=>{editor.addGeneratedShapes(generatedShapes(result,paper.view.center));editor.setTool('select');},
      returnFocus:()=>{$('[data-generator-trigger]').focus({preventScroll:true});}
    });
    generatorWorkbench.open(button.dataset.generator as Family);
  }catch(error){notify((error as Error).message,true);}finally{generatorLoading=false;}
};
$('[data-fill-trigger]').onclick=()=>{editor.setTool('fill');toggleMenu(fillMenu,$('[data-fill-trigger]'));};
const fillPicker=$<HTMLInputElement>('[data-fill-picker]'),fillHex=$<HTMLInputElement>('[data-fill-hex]');
function chooseFill(value:string):void {try{editor.setFillColor(value);fillHex.removeAttribute('aria-invalid');}catch(error){fillHex.setAttribute('aria-invalid','true');notify((error as Error).message,true);}}
fillPicker.addEventListener('input',()=>chooseFill(fillPicker.value));fillHex.addEventListener('change',()=>chooseFill(fillHex.value));
fillMenu.querySelectorAll<HTMLButtonElement>('[data-fill-colour]').forEach(button=>button.onclick=()=>chooseFill(button.dataset.fillColour!));
fillMenu.addEventListener('keydown',event=>{if(event.key!=='Escape')event.stopPropagation();});

$('[data-dimension-trigger]').onclick=()=>toggleMenu(dimensionMenu,$('[data-dimension-trigger]'));
$('[data-delete-trigger]').onclick=()=>toggleMenu(deleteMenu,$('[data-delete-trigger]'));
$('[data-arc-trigger]').onclick=()=>toggleMenu(arcMenu,$('[data-arc-trigger]'));
$('[data-line-trigger]').onclick=()=>toggleMenu(lineMenu,$('[data-line-trigger]'));
$('[data-file-trigger]').onclick=()=>toggleMenu(fileMenu,$('[data-file-trigger]'));
$('[aria-label="Select"]').onclick=()=>editor.setTool('select');
$('[data-node-tool]').onclick=()=>{editor.setTool('nodes');closeMenus();editor.canvas.focus();};
$('[data-text-tool]').onclick=()=>{editor.setTool('text');closeMenus();editor.canvas.focus();};
$('#snap-grid').onclick=()=>editor.setSnappingEnabled(!editor.snappingEnabled);
const snappingMaster=$<HTMLInputElement>('[data-snapping-master]'),gridSnapSetting=$<HTMLInputElement>('[data-grid-snap-setting]');
snappingMaster.onchange=()=>editor.setSnappingEnabled(snappingMaster.checked);
gridSnapSetting.onchange=()=>editor.setSnapToGrid(gridSnapSetting.checked);
const gridSize=$<HTMLInputElement>('#pref-grid-size');
gridSize.value=String(editor.grid.spacingMM);
const gridType=$<HTMLSelectElement>('#pref-grid-type'),gridAngle=$<HTMLSelectElement>('#pref-grid-angle');
gridType.value=editor.grid.type;gridAngle.value=String(editor.grid.angleDegrees);
function updateGridSettings():void {
  $('#pref-grid-angle-field').hidden=editor.grid.type!=='polar';
  $('#pref-grid-size-field').hidden=editor.grid.type==='none';
  $('#pref-grid-size-help').textContent=gridSize.value!==''&&gridSize.validity.valid?GRID_HELP[editor.grid.type]:'Enter a grid size from 0.1 to 1000 mm.';
}
gridType.onchange=()=>{editor.setGridType(gridType.value as GridType);updateGridSettings();};
gridAngle.onchange=()=>editor.setGridAngle(Number(gridAngle.value));
updateGridSettings();
gridSize.onchange=()=>{
  const valid=gridSize.value!==''&&gridSize.checkValidity();
  gridSize.setAttribute('aria-invalid',String(!valid));
  gridSize.closest('.number-shell')!.classList.toggle('is-invalid',!valid);
  $('#pref-grid-size-help').textContent=valid?GRID_HELP[editor.grid.type]:'Enter a grid size from 0.1 to 1000 mm.';
  if(valid)editor.setGridSpacing(gridSize.valueAsNumber);
};
for(const input of document.querySelectorAll<HTMLInputElement>('[data-object-snap]'))input.onchange=()=>editor.setObjectSnap(input.dataset.objectSnap as ObjectSnapMode,input.checked);
for(const button of document.querySelectorAll<HTMLButtonElement>('button')) {
  if(button.dataset.shape){const tool=button.dataset.shape.toLowerCase();if(tool==='rectangle'||tool==='circle'||tool==='ellipse'||tool==='polygon'||tool==='star'||tool==='heart'){button.tabIndex=0;button.onclick=()=>{editor.setTool(tool);closeMenus();$('#cad-canvas').focus();};}else disable(button);}
  if(button.dataset.dimensionTool&&isDimensionTool(button.dataset.dimensionTool as ToolName))button.onclick=()=>{editor.setTool(button.dataset.dimensionTool as ToolName);closeMenus();editor.canvas.focus();};
  if(button.dataset.deleteTool){const tool=button.dataset.deleteTool;if(tool==='dissect-delete'||tool==='line-delete')button.onclick=()=>{editor.setTool(tool);closeMenus();$('#cad-canvas').focus();};}
  if(button.dataset.arcTool){const tool=button.dataset.arcTool;if(tool==='arc'||tool==='arc-three-point'||tool==='arc-endpoints')button.onclick=()=>{editor.setTool(tool);closeMenus();$('#cad-canvas').focus();};}
  if(button.dataset.lineTool){const tool=button.dataset.lineTool;if(tool==='line'||tool==='polyline'||tool==='freehand')button.onclick=()=>{editor.setTool(tool);closeMenus();$('#cad-canvas').focus();};}
  if(button.dataset.fileAction){const action=button.dataset.fileAction;
    if(action==='New document'){button.tabIndex=0;button.onclick=()=>{closeMenus();void documentFiles.newDocument();};}
    else if(action==='Save changes'||action==='Save as…'||action==='Open file…'){button.tabIndex=0;button.onclick=()=>{closeMenus();void(action==='Open file…'?documentFiles.open():documentFiles.save(action==='Save as…'));};}
    else if(action==='Export PDF'||action==='Export PNG'){button.tabIndex=0;button.onclick=()=>void exportDrawingImage(action==='Export PDF'?'pdf':'png');}
    else if(action==='Export SVG'){button.tabIndex=0;button.onclick=exportDrawingSVG;}else if(action==='Export DXF'){button.tabIndex=0;button.onclick=()=>{closeMenus();setPanel(props,true,true);$('#export-dxf').focus();};}else disable(button);}
}
function disable(button:HTMLButtonElement):void {button.disabled=true;button.title=(button.title||button.textContent?.trim()||'This control')+' — not yet available';}
new RasterToVector($<HTMLDialogElement>('#raster-dialog'),editor,$<HTMLButtonElement>('[data-raster-open]'),()=>{editor.cancel();closeMenus();});
new Preferences($<HTMLDialogElement>('#preferences-dialog'),$<HTMLButtonElement>('[aria-label="Settings"]'),()=>{editor.cancel();closeMenus();});
new HelpGuide($<HTMLButtonElement>('[data-help-open]'),()=>{
  if(!inlineText.finish(false,false))return false;
  editor.cancel();closeMenus();selectionContextMenu.close();editor.nodes.closeMenu();return true;
});
$('[aria-label="Undo"]').onclick=()=>editor.undo();$('[aria-label="Redo"]').onclick=()=>editor.redo();
for(const key of ['x','y','width','height'] as const){const input=$<HTMLInputElement>('#field-'+key);input.value='';input.min=(key==='width'||key==='height')?'0.001':'';input.addEventListener('change',()=>{
  try{if(!input.value.trim())throw new Error('Enter a number.');editor.setProperty(key,input.valueAsNumber);input.setAttribute('aria-invalid','false');input.closest('.number-shell')!.classList.remove('is-invalid');}
  catch(error){input.setAttribute('aria-invalid','true');input.closest('.number-shell')!.classList.add('is-invalid');notify((error as Error).message,true);}
});}
const rotationInput=$<HTMLInputElement>('#field-rotation');
rotationInput.addEventListener('change',()=>{
  try{editor.setRotation(rotationInput.valueAsNumber);rotationInput.value=String(Number(editor.selectionRotation.toFixed(6)));rotationInput.setAttribute('aria-invalid','false');rotationInput.closest('.number-shell')!.classList.remove('is-invalid');}
  catch(error){rotationInput.setAttribute('aria-invalid','true');rotationInput.closest('.number-shell')!.classList.add('is-invalid');notify((error as Error).message,true);}
});
for(const key of ['radius','start','sweep'] as const){
  const input=$<HTMLInputElement>('#arc-'+key);
  input.addEventListener('change',()=>{
    try{editor.setArcProperty(key,input.valueAsNumber);input.setAttribute('aria-invalid','false');input.closest('.number-shell')!.classList.remove('is-invalid');}
    catch(error){input.setAttribute('aria-invalid','true');input.closest('.number-shell')!.classList.add('is-invalid');notify((error as Error).message,true);}
  });
}
$('#arc-semicircle').onclick=()=>attempt(()=>editor.setArcProperty('sweep',Math.sign(editor.selectedArc?.sweep??1)*180));
$('#arc-flip').onclick=()=>attempt(()=>editor.setArcProperty('sweep',-(editor.selectedArc?.sweep??180)));
$('#create-outline').onclick=()=>attempt(()=>{editor.outline($<HTMLInputElement>('#outline-distance').valueAsNumber);notify('Sticker outline created. The source shape is unchanged.','success');});
$('#export-dxf').onclick=()=>attempt(()=>{downloadDXF(exportDXF(editor.objects,$<HTMLInputElement>('#include-artwork').checked));notify('DXF downloaded in millimetres.','success');});
function exportDrawingSVG():void {closeMenus();attempt(()=>{downloadSVG(exportSVG(editor.objects));notify('SVG downloaded in millimetres.','success');});}
let imageExportPending=false;
async function exportDrawingImage(format:'pdf'|'png'):Promise<void> {
 closeMenus();if(imageExportPending)return;if(!inlineText.finish(false,false))return;
 imageExportPending=true;
 const buttons=[...document.querySelectorAll<HTMLButtonElement>('[data-file-action="Export PDF"],[data-file-action="Export PNG"]')];buttons.forEach(button=>{button.disabled=true;button.setAttribute('aria-busy','true');});
 try{
  const contents=exportSVG(editor.objects),{downloadImage,exportPNG}=await import('./exportImage');
  const blob=format==='png'?await exportPNG(contents):await (await import('./exportPDF')).exportPDF(contents);
  downloadImage(blob,format);notify(format==='png'?'PNG prepared at 300 DPI with a transparent background.':'PDF prepared at actual size in millimetres.','success');
 }catch(error){notify(error instanceof Error?error.message:'The export failed. Try again.',true);}
 finally{imageExportPending=false;buttons.forEach(button=>{button.disabled=false;button.removeAttribute('aria-busy');});}
}
function update():void {
  rulers.update(paper.view.bounds,paper.view.zoom);
  updatePropertiesContent();
  convertTextButton.hidden=!editor.selectedItems.some(item=>item.data.text);
  convertTextButton.disabled=!editor.canConvertText;
  $('#text-properties').hidden=!editor.selected?.data.text;
  $('#selection-name').hidden=!!editor.selected?.data.text;
  if(editor.selected?.data.text){const text=editor.selected.data.text;if(document.activeElement!==textFontSelect)textFontSelect.value=text.fontId??'lato';if(document.activeElement!==textSize)textSize.value=String(text.sizeMM);}
  inlineText.render();
  $('[data-node-tool]').classList.toggle('selected',editor.tool==='nodes');
  $('[data-node-tool]').setAttribute('aria-pressed',String(editor.tool==='nodes'));
  $('[data-text-tool]').classList.toggle('selected',editor.tool==='text');
  $('[data-text-tool]').setAttribute('aria-pressed',String(editor.tool==='text'));
  $('[data-fill-trigger]').classList.toggle('selected',editor.tool==='fill');
  $('[data-fill-trigger]').setAttribute('aria-pressed',String(editor.tool==='fill'));
  $('.fill-tools').style.setProperty('--fill-colour',editor.fillColor);
  $('.fill-tools').classList.toggle('is-no-fill',editor.noFill);
  fillPicker.value=editor.fillColor;if(document.activeElement!==fillHex)fillHex.value=editor.fillColor;
  fillMenu.querySelectorAll<HTMLButtonElement>('[data-fill-colour]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.fillColour?.toLowerCase()===(editor.noFill?'none':editor.fillColor.toLowerCase()))));
  shapeOperationsButton.disabled=!editor.shapeOperations.available;
  shapeOperationsButton.title=editor.shapeOperations.available?'Shape operations · Weld, Subtract or Intersect':'Select two or more closed paths on the same layer; convert text first';
  patternButton.disabled=!editor.patterns.available;
  closePathButton.disabled=!editor.canCloseSelection;
  closePathButton.title=editor.canCloseSelection?'Close path · Join nearest endpoints':'Select open paths on the same layer to close';
  joinButton.disabled=!editor.canJoinSelection;
  explodeButton.disabled=!editor.canExplodeSelection;
  explodeButton.title=editor.canExplodeSelection?'Explode · Separate joined shapes into paths':'Select a joined shape or compound outline to explode';
  for(const button of flipButtons)button.disabled=!editor.canFlipSelection;
  joinButton.title=editor.selectedItems.some(item=>item.data.text)?'Convert text to paths before joining':editor.canJoinSelection?'Join · Act as one shape':'Select two or more shapes on the same layer to join';
  const duplicatePoint=editor.duplicateControlPoint;
  duplicateButton.hidden=!duplicatePoint;
  if(duplicatePoint){duplicateButton.style.left=`${duplicatePoint.x}px`;duplicateButton.style.top=`${duplicatePoint.y}px`;}
  const selected=editor.selected,bounds=editor.selectionBounds,count=editor.selectedItems.length;
  for(const key of ['x','y','width','height'] as const){const input=$<HTMLInputElement>('#field-'+key);input.disabled=!bounds||((key==='width'||key==='height')&&bounds[key]<0.001);input.title=bounds&&(key==='width'||key==='height')&&bounds[key]<0.001?'Drag an endpoint to change direction':'';if(document.activeElement!==input){input.value=bounds?String(Number(bounds[key].toFixed(6))):'';input.setAttribute('aria-invalid','false');input.closest('.number-shell')!.classList.remove('is-invalid');}}
  rotationInput.disabled=!count;
  if(document.activeElement!==rotationInput){rotationInput.value=count?String(Number(editor.selectionRotation.toFixed(6))):'';rotationInput.setAttribute('aria-invalid','false');rotationInput.closest('.number-shell')!.classList.remove('is-invalid');}
  $('#rotation-label').textContent=count>1?'By':'R';
  rotationInput.setAttribute('aria-label',count>1?'Rotate selection by (degrees)':'Rotation (degrees)');
  $('#rotation-help').textContent=count>1?'Rotate together around the selection centre. Enter an amount to add.':'Clockwise rotation about the centre. Shift-drag snaps to 15°.';
  $('#arc-controls').hidden=!editor.selectedArc;
  for(const key of ['radius','start','sweep'] as const){const input=$<HTMLInputElement>('#arc-'+key);if(document.activeElement!==input){input.value=editor.selectedArc?String(Number(editor.selectedArc[key].toFixed(6))):'';input.setAttribute('aria-invalid','false');input.closest('.number-shell')!.classList.remove('is-invalid');}}
  $('#selection-name').textContent=count>1?`${count} objects selected · Combined bounds`:selected?`${selected.data.name} · ${selected.layer.name}`:'Select an object to edit its bounds.';
  $<HTMLButtonElement>('#create-outline').disabled=!ready||!editor.canOutlineSelection;
  $('#create-outline').title=!editor.canOutlineSelection?'Select one closed shape to create a sticker outline':'';
  $<HTMLButtonElement>('[aria-label="Undo"]').disabled=!editor.canUndo;$<HTMLButtonElement>('[aria-label="Redo"]').disabled=!editor.canRedo;
  $('#tool-status').textContent=({fill:'Colour fill · B · Click an enclosed area',select:editor.selectedArc?'Arc · Drag handles · Shift: 15°':count>1?`Select · V · ${count} selected`:'Select · V',nodes:'Nodes · N · Double-click to add · Right-click for actions',text:'Text · T · Click to place',rectangle:'Rectangle · R · Shift for square',circle:'Circle · C · Drag from centre',ellipse:'Ellipse · E · Shift for circle',heart:'Heart · Drag opposite corners · Shift for equal proportions',polygon:`Polygon · Y · ${editor.polygonSides} sides · ↑/↓ · Shift: 15°`,star:`Star · ⇧ Y · ${editor.starPoints} points · ↑/↓ · Shift: 15°`,line:'Line · L · Drag · Shift: 45°',polyline:'Polyline · P · Click points · Enter to finish',freehand:'Freehand · F · Drag to draw · No snapping',arc:`Centre arc · A · ${editor.arcHint}`,'arc-endpoints':`Start–end arc · ${editor.endpointArcHint}`,'arc-three-point':`Three-point arc · ⇧ A · ${editor.threePointArcHint}`,'dissect-delete':'Dissect delete · K · Click a section','line-delete':'Line delete · ⇧ K · Click an outline'} as Record<ToolName,string>)[editor.tool];
  if(isDimensionTool(editor.tool))$('#tool-status').textContent=`${DIMENSION_NAMES[editor.tool]}${editor.tool==='dimension-aligned'?' · D':''} · ${editor.dimensions.hint}`;
  const snapButton=$('#snap-grid');snapButton.classList.toggle('selected',editor.snappingEnabled);snapButton.setAttribute('aria-pressed',String(editor.snappingEnabled));snapButton.title=`Snapping (S) · ${editor.snappingEnabled?'On':'Off'}`;
  resetZoom.textContent=`${Math.round(editor.zoom/BASE_ZOOM*100)}%`;
  $('#grid-status').textContent=editor.grid.type==='none'?'No grid':`${editor.grid.type==='square'?'Grid':GRID_NAMES[editor.grid.type]} ${editor.grid.spacingMM} mm${editor.grid.type==='polar'?` · ${editor.grid.angleDegrees}°`:''}`;
  for(const [button,active] of [[$('[aria-label="Select"]'),editor.tool==='select'],[$('[data-shape-trigger]'),['rectangle','circle','ellipse','polygon','star','heart'].includes(editor.tool)],[$('[data-line-trigger]'),editor.tool==='line'||editor.tool==='polyline'||editor.tool==='freehand'],[$('[data-arc-trigger]'),editor.tool==='arc'||editor.tool==='arc-three-point'||editor.tool==='arc-endpoints'],[$('[data-delete-trigger]'),editor.isDeleteTool],[$('[data-dimension-trigger]'),isDimensionTool(editor.tool)]] as const){button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));}
  document.querySelectorAll<HTMLElement>('[data-shape]').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.shape?.toLowerCase()===editor.tool)));
  document.querySelectorAll<HTMLElement>('[data-line-tool]').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.lineTool===editor.tool)));
  document.querySelectorAll<HTMLElement>('[data-arc-tool]').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.arcTool===editor.tool)));
  document.querySelectorAll<HTMLElement>('[data-dimension-tool]').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.dimensionTool===editor.tool)));
  document.querySelectorAll<HTMLElement>('[data-delete-tool]').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.deleteTool===editor.tool)));
  layersPanel.render();
  selectionMenu.render();selectionContextMenu.refresh();
  snappingMaster.checked=editor.snappingEnabled;gridSnapSetting.checked=editor.snapToGridEnabled;gridSnapSetting.disabled=editor.grid.type==='none';
  $('#pref-snap-grid-help').textContent=editor.grid.type==='none'?'Choose a grid type in Grid preferences to enable grid snapping.':'Align to the grid size set in Grid preferences.';
  document.querySelectorAll<HTMLInputElement>('[data-object-snap]').forEach(input=>input.checked=editor.objectSnapModes[input.dataset.objectSnap as ObjectSnapMode]);
}
editor.onChange=update;editor.onMessage=notify;
initializeThemeControls(()=>{inlineText.finish(false,false);editor.cancel();editor.refreshTheme();});
update();
void documentFiles.restoreRecovery(()=>inlineText.recoveryDraft);
initializeClipper().then(()=>{ready=true;$('#wasm-status').textContent='Outline engine ready';update();}).catch(error=>{$('#wasm-status').textContent='Outline engine unavailable. Reload to retry.';notify(`Could not load the outline engine: ${error instanceof Error?error.message:String(error)}`,true);});
document.addEventListener('pointerdown',e=>{if(!(e.target instanceof Element))return;for(const [menu,trigger] of menus)if(!menu.contains(e.target)&&!trigger.contains(e.target)){menu.hidden=true;trigger.setAttribute('aria-expanded','false');}});
document.addEventListener('keydown',event=>{
  const key=event.key.toLowerCase();
  if(!(event.ctrlKey||event.metaKey)||event.altKey||!['s','o','n'].includes(key)||document.querySelector('dialog[open]'))return;
  const target=event.target as HTMLElement;
  if(target.closest('input,textarea,select,[contenteditable="true"]')&&target.id!=='inline-text')return;
  event.preventDefault();event.stopPropagation();closeMenus();void(key==='n'?documentFiles.newDocument():key==='o'?documentFiles.open():documentFiles.save(event.shiftKey));
},true);
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&!e.altKey&&!e.shiftKey&&e.key.toLowerCase()==='e'&&!(e.target as Element)?.closest('input,textarea,select,[contenteditable="true"]')&&!document.querySelector('dialog[open]')){
    e.preventDefault();e.stopPropagation();exportDrawingSVG();return;
  }
  if(e.key==='Escape'){
    const active=menus.find(([menu,trigger])=>!menu.hidden&&(menu.contains(e.target as Node)||trigger.contains(e.target as Node)));
    closeMenus();if(active){e.preventDefault();e.stopPropagation();active[1].focus();}
  }
  if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
    const menu=(e.target as Element)?.closest('[role="menu"]');
    if(menu){const buttons=[...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],index=buttons.indexOf(document.activeElement as HTMLButtonElement);e.preventDefault();e.stopPropagation();const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:buttons.length-1))%buttons.length;buttons[next]?.focus();}
  }
});
// Keep search actions connected to the same controls as the menus and toolbars.
const searchTools:SearchTool[]=[];
function searchButton(id:string,label:string,group:string,selector:string,keywords='',shortcut='',reason='Unavailable for the current selection',before?:()=>void):void {
  const button=$<HTMLButtonElement>(selector),icon=button.querySelector('use')?.getAttribute('href')?.replace('#i-','')??'select';
  searchTools.push({id,label,group,keywords,shortcut,icon,unavailable:()=>button.disabled?reason:undefined,run:()=>{before?.();button.click();if(!document.querySelector('dialog[open]')&&!document.activeElement?.closest('.menu-surface,.notifications-panel,.generator-menu,input,select,textarea'))editor.canvas.focus({preventScroll:true});}});
}
for(const [attribute,group] of [['data-shape','Shapes'],['data-line-tool','Lines'],['data-arc-tool','Arcs'],['data-dimension-tool','Dimensions and callouts'],['data-delete-tool','Delete tools'],['data-file-action','File']] as const){
  document.querySelectorAll<HTMLButtonElement>(`[${attribute}]`).forEach(button=>{
    const label=button.querySelector('span')?.textContent?.trim()??button.textContent!.trim();
    searchButton(`${attribute}-${button.getAttribute(attribute)!.replace(/[^a-z0-9]/gi,'-')}`,label,group,`[${attribute}="${button.getAttribute(attribute)}"]`,group==='File'?'document project download':'' ,button.querySelector('kbd')?.textContent?.trim());
  });
}
for(const [id,label,selector,keywords,shortcut] of [
  ['select','Select','[aria-label="Select"]','move resize rotate objects','V'],
  ['nodes','Node editing','[data-node-tool]','move add delete nodes adjust curve bezier handles tangents break split paths smooth corner point type','N'],
  ['text','Text','[data-text-tool]','type lettering font','T'],
  ['fill','Colour fill','[data-fill-trigger]','color paint bucket enclosed area no fill remove fill','B'],
  ['raster','Raster to vector','[data-raster-open]','image trace outline center centre line bitmap fill png jpg'],
  ['snap','Snapping','[data-snap-grid]','magnet snap on off','S'],
  ['generators','Generators','[data-generator-trigger]','generator menu'],
  ['settings','Settings','[data-open-preferences]','preferences'],
  ['help','Help','[data-help-open]','guide keyboard shortcuts controls tutorials examples instructions','F1'],
  ['undo','Undo','[aria-label="Undo"]','history'],['redo','Redo','[aria-label="Redo"]','history'],
  ['zoom','Reset zoom to 100%','[data-reset-zoom]','zoom reset view'],
] as const)searchButton(id,label,'Tools',selector,keywords,shortcut??'');
searchTools.push({id:'layers',label:'Layers',group:'Panels',icon:'layers',keywords:'artwork cut engrave construction visibility lock move objects',run:()=>{setPanel(layers,true);layersButton.focus();}},
 {id:'properties',label:'Properties',group:'Panels',icon:'sliders',keywords:'position size width height rotation radius',run:()=>{setPanel(props,true);propertiesButton.focus();}});
for(const [id,label,selector,keywords,reason] of [
 ['close-path','Close path','#selection-menu [aria-label="Close path"]','close shape nearest endpoints','Select an open path that can be closed'],
 ['join','Join','#selection-menu [aria-label="Join"]','group combine shapes','Select two or more objects on the same layer'],
 ['explode','Explode','#selection-menu [aria-label="Explode"]','ungroup separate contours','Select a joined shape or compound path'],
 ['flip-h','Flip horizontal','[data-flip="horizontal"]','mirror left right','Select an object'],
 ['flip-v','Flip vertical','[data-flip="vertical"]','mirror top bottom','Select an object'],
 ['convert','Convert to path','#convert-text','text outline letters contours','Select text to convert'],
 ['edit-text','Edit text','#edit-text','font type lettering','Select a text object'],
 ['outline','Sticker outline','#create-outline','offset contour border cut','Select one closed shape'],
] as const){
 searchButton(id,label,'Selection',selector,keywords,'',reason);
 if(id==='edit-text')searchTools.at(-1)!.unavailable=()=>editor.selected?.data.text&&!$<HTMLButtonElement>('#edit-text').disabled?undefined:reason;
}
for(const [id,label,keywords] of [['fillet','Fillet','round corner radius'],['chamfer','Chamfer','bevel corner distance']] as const)searchTools.push({id,label,group:'Node editing',icon:id,keywords,unavailable:()=>editor.tool==='nodes'&&editor.nodes.canEditCorners?undefined:'Select corners between straight edges with Node editing',run:()=>editor.nodes.openCorner(id)});
for(const [kind,label,icon,keywords] of [['rectangular','Rectangular pattern','pattern-rectangular','array repeat rows columns holes slots spacing'],['circular','Circular pattern','pattern-circular','array repeat radial polar holes slots centre angle']] as const)searchTools.push({id:`pattern-${kind}`,label,group:'Selection',icon,keywords,unavailable:()=>editor.patterns.available?undefined:'Select visible, unlocked objects to repeat',run:()=>editor.patterns.open(kind)});
for(const [kind,label,keywords] of [['weld','Weld','boolean union merge overlapping outlines'],['subtract','Subtract','boolean difference cut hole remove'],['intersect','Intersect','boolean intersection shared overlap']] as const)searchTools.push({id:`shape-${kind}`,label,group:'Selection',icon:kind,keywords,unavailable:()=>editor.shapeOperations.available?undefined:'Select two or more closed paths on the same layer; convert text first',run:()=>editor.shapeOperations.open(kind)});
searchButton('notifications','Notifications','Application','[data-notifications-trigger]','alerts messages history');
const needsSelection=()=>editor.canCopySelection?undefined:'Select one or more objects';
for(const [id,label,icon,field,keywords] of [['move','Move / position','select','x','translate coordinates'],['resize','Resize','width','width','scale size width height'],['rotate','Rotate','rotate','rotation','angle rotation']] as const)searchTools.push({id,label,group:'Properties',icon,keywords,unavailable:()=>editor.selectedItems.length?undefined:'Select one or more objects',run:()=>{setPanel(props,true);$<HTMLInputElement>(`#field-${field}`).focus();}});
for(const [id,label,selector,keywords] of [['arc-semicircle','Semicircle 180°','#arc-semicircle','arc half circle'],['arc-flip','Flip arc','#arc-flip','reverse arc sweep']] as const){
 searchButton(id,label,'Arc properties',selector,keywords);
 searchTools.at(-1)!.unavailable=()=>editor.selectedArc?undefined:'Select a circular arc';
}
searchTools.push({id:'edit-callout',label:'Edit callout',group:'Selection',icon:'leader',keywords:'leader label annotation text',unavailable:()=>editor.selected?.data.dimension?.kind==='leader'?undefined:'Select a leader callout',run:()=>editor.dimensions.editSelected()});

searchTools.push(
 {id:'copy',label:'Copy',group:'Selection',icon:'copy',keywords:'clipboard',unavailable:needsSelection,run:()=>{editor.copySelection();editor.canvas.focus();}},
 {id:'paste',label:'Paste',group:'Selection',icon:'paste',keywords:'clipboard',unavailable:()=>editor.canPaste?undefined:'Copy an object first',run:()=>{editor.pasteSelection();editor.canvas.focus();}},
 {id:'duplicate',label:'Duplicate',group:'Selection',icon:'copy',keywords:'copy clone',unavailable:needsSelection,run:()=>{editor.duplicateSelection();editor.canvas.focus();}},
 {id:'delete-selection',label:'Delete selection',group:'Selection',icon:'delete',shortcut:'Delete',keywords:'remove objects',unavailable:needsSelection,run:()=>{editor.deleteSelection();editor.canvas.focus();}});
for(const [tab,label,keywords] of [
 ['grid','Grid settings','square isometric polar radial hexagonal triangular dot step no grid spacing size mm angle'],
 ['snapping','Snapping settings','intersection nearest centre center tangent perpendicular object snap grid'],
 ['appearance','Appearance','theme dark light mode'],
] as const)searchTools.push({id:`settings-${tab}`,label,group:'Preferences',icon:'gear',keywords,run:()=>{$<HTMLButtonElement>('[data-open-preferences]').click();$<HTMLButtonElement>(`[data-pref-tab="${tab}"]`).click();$(`[data-pref-tab="${tab}"]`).focus();}});
searchTools.push({id:'font',label:'Font and text size',group:'Properties',icon:'text',keywords:'fonts lettering lato hershey relief freemono inter jetbrains oswald montserrat bebas allerta saira',unavailable:()=>editor.selected?.data.text?undefined:'Select a text object',run:()=>{setPanel(props,true);textFontSelect.focus();}});
for(const [id,label,words] of [['gear','Involute gear','spur helical bevel rack pinion module teeth'],['drive','Sprocket & timing pulley','chain roller belt groove'],['fastener','Thread & fastener','bolt nut washer thread pitch'],['cam','Cam profile','follower cycloidal harmonic polynomial'],['box','Box & finger joints','enclosure laser finger tabs t-slot nut joint'],['hinge','Flexure & living hinge','kerf bend wood acrylic slits slots'],['packaging','Packaging & die-cut nets','carton corrugated fold score glue tray'],['framework','Truss & framework','warren pratt howe structural lattice frame'],['voronoi','Voronoi pattern','cells seed organic panel webs'],['spirograph','Spirograph & cycloid','hypotrochoid epitrochoid rolling circle'],['maze','Maze & labyrinth','rectangular circular walls solution'],['halftone','Halftone & stipple','image photo holes dots tone'],['waveform','Noise & waveform','perlin sine wave strips panel']] as const)searchButton(`generator-${id}`,label,'Generators',`[data-generator="${id}"]`,words);
new ToolSearch($<HTMLButtonElement>('[data-tool-search]'),searchTools,()=>{
  if(!inlineText.finish(false,false))return false;
  editor.cancel();closeMenus();selectionContextMenu.close();editor.nodes.closeMenu();return true;
},message=>notify(message,true));
// Explicit test harness only; no application state is exposed in normal builds.
if(import.meta.env.MODE==='test')Object.assign(window,{__vectora:editor,__paper:paper});
