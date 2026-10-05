import {generalPreferences} from './generalPreferences';
import {canvasPresets,unitScale,validateCanvasSize,MAX_CANVAS_MM,type CanvasSize,type CanvasUnit} from './canvasSize';
import {GRID_NAMES,GRID_TYPES,GRID_HELP,type GridConfig,type GridType} from './gridGeometry';
import {DEFAULT_GRID,GRID_ANGLES,validateGridSettings} from './gridSettings';
export interface WorkspaceSetup {canvasSize:CanvasSize;grid:GridConfig}
export class NewDocumentDialog {
 private dialog=document.createElement('dialog');
 private size:CanvasSize={kind:'infinite'};
 private unit:CanvasUnit='mm';private preset='infinite';
 private width=300;private height=200;private grid:GridConfig={...DEFAULT_GRID};
 private category:'machine'|'sticker'='machine';
 private resolve:((settings:WorkspaceSetup|null)=>void)|null=null;
 constructor(){
  this.dialog.id='new-document-dialog';this.dialog.className='new-document-dialog export-dialog menu-surface';this.dialog.setAttribute('aria-labelledby','new-document-title');
  this.dialog.innerHTML=`<header class="export-header"><div><h2 id="new-document-title">New document</h2><p>Choose an infinite canvas or a measured workspace.</p></div><button class="tool" type="button" data-setup-close aria-label="Close canvas setup"><svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-close"/></svg></button></header>
   <form><div class="canvas-setup-body"><section class="canvas-presets" aria-label="Canvas presets"><h3>Start with a workspace</h3><div class="canvas-preset-grid canvas-workspace-options">${this.cards('workspace')}</div><div class="canvas-preset-tabs" role="tablist" aria-label="Preset categories">${(['machine','sticker'] as const).map((group,index)=>`<button type="button" role="tab" id="canvas-tab-${group}" data-preset-category="${group}" aria-controls="canvas-presets-${group}" aria-selected="${index===0}" tabindex="${index===0?0:-1}">${group==='machine'?'Machine beds':'Sticker sheets'}</button>`).join('')}</div>${(['machine','sticker'] as const).map(group=>`<div role="tabpanel" id="canvas-presets-${group}" aria-labelledby="canvas-tab-${group}" ${group==='sticker'?'hidden':''}><div class="canvas-preset-grid">${this.cards(group)}</div><p class="subtext canvas-preset-note">${group==='machine'?'Working-area guides; adjust to your machine’s usable bed.':'Full sheet sizes; allow for your printer’s margins and registration marks.'}</p></div>`).join('')}</section>
   <section class="canvas-details" aria-label="Canvas details"><h3>Canvas details</h3><div class="canvas-size-preview" aria-hidden="true"></div><p class="canvas-size-readout"></p><fieldset data-size-fields><legend class="sr-only">Custom dimensions</legend><label>Units<select class="number-input" aria-label="Units"><option value="mm">Millimetres</option><option value="cm">Centimetres</option><option value="in">Inches</option></select></label><div class="canvas-dimensions"><label>Width<input class="number-input" aria-label="Width" name="width" type="number" step="any" required></label><label>Height<input class="number-input" aria-label="Height" name="height" type="number" step="any" required></label></div><div class="canvas-orientation"><span>Orientation</span><button type="button" class="panel-icon" data-orientation="portrait" aria-label="Portrait" title="Portrait"><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="6" y="3" width="12" height="18"/></svg></button><button type="button" class="panel-icon" data-orientation="landscape" aria-label="Landscape" title="Landscape"><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12"/></svg></button></div></fieldset><fieldset class="canvas-grid-settings"><legend>Grid</legend><label>Grid pattern<select class="number-input" aria-label="Grid pattern" data-setup-grid-type>${GRID_TYPES.map(type=>`<option value="${type}">${GRID_NAMES[type]}</option>`).join('')}</select></label><div class="canvas-dimensions"><label data-setup-grid-size-field>Grid size (mm)<input class="number-input" aria-label="Grid size (mm)" type="number" min="0.1" max="1000" step="any" required data-setup-grid-size></label><label data-setup-grid-angle-field hidden>Spoke angle<select class="number-input" aria-label="Spoke angle" data-setup-grid-angle>${GRID_ANGLES.map(angle=>`<option value="${angle}">${angle}°</option>`).join('')}</select></label></div><p class="canvas-grid-help" data-setup-grid-help></p><p class="canvas-grid-help">Saved with this document. Edit any time in Preferences → Grid.</p></fieldset><p class="subtext">A fixed canvas is a visual guide. You can draw outside it; exports keep their own settings.</p><p class="paint-error" role="status" data-setup-error hidden></p></section></div>
   <footer class="export-footer"><span>Dimensions are stored in millimetres.</span><button type="button" class="button" data-setup-cancel>Cancel</button><button type="submit" class="button button-primary" data-setup-create>Create document</button></footer></form>`;
  document.body.append(this.dialog);
  this.dialog.addEventListener('keydown',event=>event.stopPropagation());
  this.get('[data-setup-close]').onclick=this.get('[data-setup-cancel]').onclick=()=>this.finish(null);
  this.dialog.addEventListener('cancel',event=>{event.preventDefault();this.finish(null);});
  this.dialog.addEventListener('click',event=>{
   const button=(event.target as Element).closest<HTMLButtonElement>('[data-canvas-preset],[data-orientation]');if(!button)return;
   if(button.dataset.canvasPreset){const p=canvasPresets.find(p=>p.id===button.dataset.canvasPreset)!;this.preset=p.id;this.size=p.id==='infinite'?{kind:'infinite'}:{kind:'fixed',width:p.width,height:p.height,unit:p.unit??'mm'};if(p.id!=='infinite'){this.width=p.width;this.height=p.height;this.unit=p.unit??'mm';}}
   else{const landscape=button.dataset.orientation==='landscape',large=Math.max(this.width,this.height),small=Math.min(this.width,this.height);this.width=landscape?large:small;this.height=landscape?small:large;}
   this.render();
  });
  this.get<HTMLSelectElement>('select').onchange=()=>{this.unit=this.get<HTMLSelectElement>('select').value as CanvasUnit;this.render();};
  this.dialog.querySelectorAll<HTMLInputElement>('[name="width"],[name="height"]').forEach(input=>input.oninput=()=>{const value=input.valueAsNumber*unitScale[this.unit];if(Number.isFinite(value)&&value>0){if(input.name==='width')this.width=value;else this.height=value;}this.preset='custom';this.preview();this.highlight();});
  this.get<HTMLSelectElement>('[data-setup-grid-type]').onchange=()=>{this.grid.type=this.get<HTMLSelectElement>('[data-setup-grid-type]').value as GridType;this.renderGrid();};
  this.get<HTMLInputElement>('[data-setup-grid-size]').oninput=()=>{const n=this.get<HTMLInputElement>('[data-setup-grid-size]').valueAsNumber;if(Number.isFinite(n)&&n>=.1&&n<=1000)this.grid.spacing=n;};
  this.dialog.querySelectorAll<HTMLButtonElement>('[data-preset-category]').forEach((tab,index,tabs)=>{
   tab.onclick=()=>{this.category=tab.dataset.presetCategory as 'machine'|'sticker';this.showCategory();};
   tab.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+1)%tabs.length;tabs[next].click();tabs[next].focus();};
  });
  this.get<HTMLFormElement>('form').onsubmit=event=>{event.preventDefault();try{this.size=this.preset==='infinite'?{kind:'infinite'}:validateCanvasSize({kind:'fixed',width:Number((this.get<HTMLInputElement>('[name="width"]').valueAsNumber*unitScale[this.unit]).toFixed(8)),height:Number((this.get<HTMLInputElement>('[name="height"]').valueAsNumber*unitScale[this.unit]).toFixed(8)),unit:this.unit});const spacing=this.get<HTMLInputElement>('[data-setup-grid-size]');const grid=validateGridSettings({...this.grid,spacing:this.grid.type==='none'?this.grid.spacing:spacing.valueAsNumber,angle:Number(this.get<HTMLSelectElement>('[data-setup-grid-angle]').value)});this.finish({canvasSize:this.size,grid});}catch(error){const message=this.get('[data-setup-error]');message.textContent=(error as Error).message;message.hidden=false;}};
 }
 private cards(group:'workspace'|'machine'|'sticker'):string {
  return canvasPresets.filter(p=>p.group===group).map(p=>`<button type="button" class="canvas-preset" data-canvas-preset="${p.id}" aria-label="${p.label}" aria-pressed="false"><svg aria-hidden="true" viewBox="0 0 64 48">${p.id==='infinite'?'<path d="M32 24C24 10 8 10 8 24S24 38 32 24S56 10 56 24S40 38 32 24"/>':`<rect x="${p.width>p.height?8:17}" y="${p.width>p.height?10:4}" width="${p.width>p.height?48:30}" height="${p.width>p.height?28:40}"/>`}</svg><strong>${p.label}</strong><span>${p.detail}</span></button>`).join('');
 }
 private showCategory():void {
  this.dialog.querySelectorAll<HTMLElement>('[data-preset-category]').forEach(tab=>{const active=tab.dataset.presetCategory===this.category;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;this.get('#'+tab.getAttribute('aria-controls')).hidden=!active;});
 }
 private renderGrid():void {
  const type=this.grid.type,none=type==='none';this.get<HTMLSelectElement>('[data-setup-grid-type]').value=type;
  this.get('[data-setup-grid-size-field]').hidden=none;this.get<HTMLInputElement>('[data-setup-grid-size]').disabled=none;
  this.get('[data-setup-grid-angle-field]').hidden=type!=='polar';this.get('[data-setup-grid-help]').textContent=GRID_HELP[type];
 }
 private get<T extends HTMLElement=HTMLElement>(selector:string):T{return this.dialog.querySelector<T>(selector)!;}
 open(size:CanvasSize|undefined=undefined,mode:'new'|'startup'|'edit'='new',grid:GridConfig=DEFAULT_GRID):Promise<WorkspaceSetup|null>{
  if(this.dialog.open)return Promise.resolve(null);
  this.grid=validateGridSettings(grid);this.get<HTMLInputElement>('[data-setup-grid-size]').value=String(this.grid.spacing);this.get<HTMLSelectElement>('[data-setup-grid-angle]').value=String(this.grid.angle);this.renderGrid();this.category='machine';this.showCategory();
  const preset=canvasPresets.find(p=>p.id===generalPreferences.value.canvasPreset)!;
  const useDefault=size===undefined;size??=preset.id==='infinite'?{kind:'infinite'}:{kind:'fixed',width:preset.width,height:preset.height,unit:preset.unit??'mm'};
  this.size=structuredClone(size);this.preset=size.kind==='infinite'?'infinite':'custom';this.unit=size.kind==='fixed'?size.unit:'mm';this.width=size.kind==='fixed'?size.width:300;this.height=size.kind==='fixed'?size.height:200;
  if(useDefault){this.preset=preset.id;if(preset.group==='machine'||preset.group==='sticker'){this.category=preset.group;this.showCategory();}}
  this.dialog.dataset.mode=mode;this.get('#new-document-title').textContent=mode==='edit'?'Canvas size':'New document';this.get('[data-setup-create]').textContent=mode==='edit'?'Apply':'Create document';this.get('[data-setup-cancel]').textContent=mode==='startup'?'Use infinite canvas':'Cancel';this.get('[data-setup-error]').hidden=true;this.render();this.dialog.returnValue='';
  return new Promise(resolve=>{this.resolve=resolve;this.dialog.showModal();this.get<HTMLButtonElement>(`[data-canvas-preset="${this.preset}"]`).focus();});
 }
 private finish(size:WorkspaceSetup|null):void {const resolve=this.resolve;this.resolve=null;this.dialog.close();resolve?.(size?structuredClone(size):null);}
 private highlight():void{this.dialog.querySelectorAll<HTMLElement>('[data-canvas-preset]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.canvasPreset===this.preset)));}
 private render():void {
  this.highlight();this.get<HTMLFieldSetElement>('[data-size-fields]').disabled=this.preset==='infinite';this.get<HTMLSelectElement>('select').value=this.unit;
  for(const key of ['width','height'] as const){const input=this.get<HTMLInputElement>(`[name="${key}"]`);input.value=String(Number((this[key]/unitScale[this.unit]).toFixed(6)));input.min=String(.1/unitScale[this.unit]);input.max=String(MAX_CANVAS_MM/unitScale[this.unit]);}
  this.preview();
 }
 private preview():void {
  const infinite=this.preset==='infinite',ratio=Math.min(3,Math.max(1/3,this.width/this.height));
  this.get('.canvas-size-preview').innerHTML=infinite?'<span>∞</span>':`<span style="width:${ratio>=1?64:64*ratio}px;height:${ratio>=1?64/ratio:64}px"></span>`;
  this.get('.canvas-size-readout').textContent=infinite?'Infinite canvas':`${Number(this.width.toFixed(3))} × ${Number(this.height.toFixed(3))} mm`;
  this.dialog.querySelectorAll<HTMLElement>('[data-orientation]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.orientation===(this.width>this.height?'landscape':'portrait'))));
 }
}
