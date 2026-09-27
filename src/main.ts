import { initializeThemeControls } from './theme';
import { CanvasRulers } from './rulers';
import { alignPopoutWithTrigger } from './menuPosition';
import paper from 'paper';
import {RasterToVector} from './rasterToVector';
import { Alerts, type AlertKind } from './alerts';
import { CADEditor } from './editor';
import { LayersPanel } from './layersPanel';
import { Preferences } from './preferences';
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
const alerts=new Alerts($('#toast-stack'),editor.canvas);
function notify(message:string,kind:boolean|AlertKind=false):void {
  alerts.show(message,typeof kind==='boolean'?(kind?'error':'information'):kind);
}
function attempt(action:()=>void):void {try{action();}catch(error){notify(error instanceof Error?error.message:String(error),true);}}
const props=$('#properties-panel'),layers=$('#primary-layers-panel');
const propertiesButton=$<HTMLButtonElement>('[aria-label="Properties"]'),layersButton=$<HTMLButtonElement>('[aria-label="Layers"]');
const layersPanel=new LayersPanel(layers,editor,()=>{setPanel(layers,false);layersButton.focus();});
const selectionMenu=new FloatingSelectionMenu($('#selection-menu'),editor);
const inlineText=new InlineText($<HTMLTextAreaElement>('#inline-text'),editor);
const documentFiles=new DocumentFiles(editor,$<HTMLDialogElement>('#document-dialog'),$<HTMLInputElement>('#open-document-file'),()=>inlineText.finish(false,false),notify);
const previewTrigger=$<HTMLButtonElement>('[data-preview-open]');
let preview:import('./preview3D').Preview3D|undefined,previewLoading=false;
previewTrigger.addEventListener('click',async()=>{
  if(previewLoading||!inlineText.finish(false,false))return;
  editor.cancel();closeMenus();previewLoading=true;
  try{const {Preview3D}=await import('./preview3D');preview??=new Preview3D($<HTMLDialogElement>('#preview3d-dialog'),editor,previewTrigger);if(import.meta.env.MODE==='test')(window as any).__preview3D=preview;await preview.open();}
  catch(error){notify(`Could not open 3D preview: ${error instanceof Error?error.message:String(error)}`,true);}
  finally{previewLoading=false;}
});
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
}
setPanel(props,false);
propertiesButton.setAttribute('aria-controls','properties-panel');
propertiesButton.onclick=()=>setPanel(props,props.hidden);
layersButton.onclick=()=>setPanel(layers,layers.hidden);
$('#close-properties').onclick=()=>{setPanel(props,false);propertiesButton.focus();};$('#close-layers').onclick=()=>{setPanel(layers,false);layersButton.focus();};
const shapeMenu=$('#primary-shapes-menu'),fileMenu=$('#primary-file-menu'),lineMenu=$('#primary-lines-menu'),arcMenu=$('#primary-arcs-menu'),deleteMenu=$('#primary-delete-menu'),dimensionMenu=$('#primary-dimensions-menu'),imageMenu=$('#primary-images-menu'),fillMenu=$('#primary-fill-menu');
const menus=[[shapeMenu,$('[data-shape-trigger]')],[fileMenu,$('[data-file-trigger]')],[lineMenu,$('[data-line-trigger]')],[arcMenu,$('[data-arc-trigger]')],[deleteMenu,$('[data-delete-trigger]')],[dimensionMenu,$('[data-dimension-trigger]')],[imageMenu,$('[data-image-trigger]')],[fillMenu,$('[data-fill-trigger]')]] as const;
function closeMenus():void {for(const [menu,trigger] of menus){menu.hidden=true;trigger.setAttribute('aria-expanded','false');}}
function toggleMenu(menu:HTMLElement,trigger:HTMLElement):void {const open=menu.hidden;closeMenus();menu.hidden=!open;trigger.setAttribute('aria-expanded',String(open));if(open){if(menu!==fileMenu)alignPopoutWithTrigger(menu,trigger);(menu.querySelector<HTMLButtonElement>('button:not(:disabled)')??menu).focus({preventScroll:true});}}
window.addEventListener('resize',()=>{for(const [menu,trigger] of menus)if(menu!==fileMenu)alignPopoutWithTrigger(menu,trigger);});
$('[data-shape-trigger]').onclick=()=>toggleMenu(shapeMenu,$('[data-shape-trigger]'));
$('[data-image-trigger]').onclick=()=>toggleMenu(imageMenu,$('[data-image-trigger]'));
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
gridSize.onchange=()=>{
  const valid=gridSize.value!==''&&gridSize.checkValidity();
  gridSize.setAttribute('aria-invalid',String(!valid));
  gridSize.closest('.number-shell')!.classList.toggle('is-invalid',!valid);
  $('#pref-grid-size-help').textContent=valid?'Distance between grid lines. Major lines appear every five cells.':'Enter a grid size from 0.1 to 1000 mm.';
  if(valid)editor.setGridSpacing(gridSize.valueAsNumber);
};
for(const input of document.querySelectorAll<HTMLInputElement>('[data-object-snap]'))input.onchange=()=>editor.setObjectSnap(input.dataset.objectSnap as ObjectSnapMode,input.checked);
for(const button of document.querySelectorAll<HTMLButtonElement>('button')) {
  if(button.dataset.shape){const tool=button.dataset.shape.toLowerCase();if(tool==='rectangle'||tool==='circle'||tool==='ellipse'||tool==='polygon'){button.tabIndex=0;button.onclick=()=>{editor.setTool(tool);closeMenus();$('#cad-canvas').focus();};}else disable(button);}
  if(button.dataset.dimensionTool&&isDimensionTool(button.dataset.dimensionTool as ToolName))button.onclick=()=>{editor.setTool(button.dataset.dimensionTool as ToolName);closeMenus();editor.canvas.focus();};
  if(button.dataset.deleteTool){const tool=button.dataset.deleteTool;if(tool==='dissect-delete'||tool==='line-delete')button.onclick=()=>{editor.setTool(tool);closeMenus();$('#cad-canvas').focus();};}
  if(button.dataset.arcTool){const tool=button.dataset.arcTool;if(tool==='arc'||tool==='arc-three-point'||tool==='arc-endpoints')button.onclick=()=>{editor.setTool(tool);closeMenus();$('#cad-canvas').focus();};}
  if(button.dataset.lineTool){const tool=button.dataset.lineTool;if(tool==='line'||tool==='polyline'||tool==='freehand')button.onclick=()=>{editor.setTool(tool);closeMenus();$('#cad-canvas').focus();};}
  if(button.dataset.fileAction){const action=button.dataset.fileAction;
    if(action==='New document'){button.tabIndex=0;button.onclick=()=>{closeMenus();void documentFiles.newDocument();};}
    else if(action==='Save changes'||action==='Save as…'||action==='Open file…'){button.tabIndex=0;button.onclick=()=>{closeMenus();void(action==='Open file…'?documentFiles.open():documentFiles.save(action==='Save as…'));};}
    else if(action==='Export SVG'){button.tabIndex=0;button.onclick=exportDrawingSVG;}else if(action==='Export DXF'){button.tabIndex=0;button.onclick=()=>{closeMenus();setPanel(props,true,true);$('#export-dxf').focus();};}else disable(button);}
}
function disable(button:HTMLButtonElement):void {button.disabled=true;button.title=(button.title||button.textContent?.trim()||'This control')+' — not yet available';}
new RasterToVector($<HTMLDialogElement>('#raster-dialog'),editor,$<HTMLButtonElement>('[data-raster-open]'),()=>{editor.cancel();closeMenus();});
new Preferences($<HTMLDialogElement>('#preferences-dialog'),$<HTMLButtonElement>('[aria-label="Settings"]'),()=>{editor.cancel();closeMenus();});
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
  $('#tool-status').textContent=({fill:'Colour fill · B · Click an enclosed area',select:editor.selectedArc?'Arc · Drag handles · Shift: 15°':count>1?`Select · V · ${count} selected`:'Select · V',nodes:'Nodes · N · Double-click to add · Right-click for actions',text:'Text · T · Click to place',rectangle:'Rectangle · R · Shift for square',circle:'Circle · C · Drag from centre',ellipse:'Ellipse · E · Shift for circle',polygon:`Polygon · Y · ${editor.polygonSides} sides · ↑/↓ · Shift: 15°`,line:'Line · L · Drag · Shift: 45°',polyline:'Polyline · P · Click points · Enter to finish',freehand:'Freehand · F · Drag to draw · No snapping',arc:`Centre arc · A · ${editor.arcHint}`,'arc-endpoints':`Start–end arc · ${editor.endpointArcHint}`,'arc-three-point':`Three-point arc · ⇧ A · ${editor.threePointArcHint}`,'dissect-delete':'Dissect delete · K · Click a section','line-delete':'Line delete · ⇧ K · Click an outline'} as Record<ToolName,string>)[editor.tool];
  if(isDimensionTool(editor.tool))$('#tool-status').textContent=`${DIMENSION_NAMES[editor.tool]}${editor.tool==='dimension-aligned'?' · D':''} · ${editor.dimensions.hint}`;
  const snapButton=$('#snap-grid');snapButton.classList.toggle('selected',editor.snappingEnabled);snapButton.setAttribute('aria-pressed',String(editor.snappingEnabled));snapButton.title=`Snapping (S) · ${editor.snappingEnabled?'On':'Off'}`;
  resetZoom.textContent=`${Math.round(editor.zoom/BASE_ZOOM*100)}%`;
  $('#grid-status').textContent=`Grid ${editor.grid.spacingMM} mm`;
  for(const [button,active] of [[$('[aria-label="Select"]'),editor.tool==='select'],[$('[data-shape-trigger]'),['rectangle','circle','ellipse','polygon'].includes(editor.tool)],[$('[data-line-trigger]'),editor.tool==='line'||editor.tool==='polyline'||editor.tool==='freehand'],[$('[data-arc-trigger]'),editor.tool==='arc'||editor.tool==='arc-three-point'||editor.tool==='arc-endpoints'],[$('[data-delete-trigger]'),editor.isDeleteTool],[$('[data-dimension-trigger]'),isDimensionTool(editor.tool)]] as const){button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));}
  document.querySelectorAll<HTMLElement>('[data-shape]').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.shape?.toLowerCase()===editor.tool)));
  document.querySelectorAll<HTMLElement>('[data-line-tool]').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.lineTool===editor.tool)));
  document.querySelectorAll<HTMLElement>('[data-arc-tool]').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.arcTool===editor.tool)));
  document.querySelectorAll<HTMLElement>('[data-dimension-tool]').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.dimensionTool===editor.tool)));
  document.querySelectorAll<HTMLElement>('[data-delete-tool]').forEach(b=>b.setAttribute('aria-checked',String(b.dataset.deleteTool===editor.tool)));
  layersPanel.render();
  selectionMenu.render();
  snappingMaster.checked=editor.snappingEnabled;gridSnapSetting.checked=editor.snapToGridEnabled;
  document.querySelectorAll<HTMLInputElement>('[data-object-snap]').forEach(input=>input.checked=editor.objectSnapModes[input.dataset.objectSnap as ObjectSnapMode]);
}
editor.onChange=update;editor.onMessage=notify;
initializeThemeControls(()=>{inlineText.finish(false,false);editor.cancel();editor.refreshTheme();});
update();
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
// Explicit test harness only; no application state is exposed in normal builds.
if(import.meta.env.MODE==='test')Object.assign(window,{__vectora:editor,__paper:paper});
