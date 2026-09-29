import type {CADEditor} from './editor';
import {exportSVG} from './exportSVG';
import {exportDXF} from './exportDXF';
import {exportImageSource,exportPNG} from './exportImage';
import {layoutSVG,dxfAtOrigin,previewDXF} from './exportLayout';
export type ExportFormat='png'|'svg'|'pdf'|'dxf'|'laser';
type ExportTab=Exclude<ExportFormat,'laser'>;
const formats:{id:ExportTab;name:string;icon:string;hint:string}[]=[
 {id:'png',name:'PNG',icon:'export-png',hint:'Raster image · transparent or solid background'},
 {id:'svg',name:'SVG',icon:'export-svg',hint:'Scalable vector artwork · exact curves and colours'},
 {id:'pdf',name:'PDF',icon:'export-pdf',hint:'Vector document · print at actual size / 100%'},
 {id:'dxf',name:'DXF',icon:'export-dxf',hint:'DXF 2000 · millimetres · circles, arcs & polylines'}
];
type Settings={compatibility:'standard'|'laser';dpi:number;pixels:number|null;colour:string;background:string;width:number|null;margin:number;groups:boolean;page:string;orientation:string;scale:number;tolerance:number;origin:boolean;layers:Set<string>|null};
const fresh=():Settings=>({compatibility:'standard',dpi:300,pixels:null,colour:'#ffffff',background:'transparent',width:null,margin:0,groups:true,page:'fit',orientation:'portrait',scale:100,tolerance:.05,origin:false,layers:null});
const icon=(name:string)=>`<svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-${name}"/></svg>`;
const number=(name:string,label:string,value:number,min:number,max:number,step='any')=>`<label>${label}<input class="number-input" data-setting="${name}" type="number" value="${value}" min="${min}" max="${max}" step="${step}" required></label>`;
const check=(name:string,label:string,value:boolean)=>`<label class="export-check"><input type="checkbox" data-setting="${name}" ${value?'checked':''}>${label}</label>`;
const select=(name:string,label:string,options:[string,string][],value:string)=>`<label>${label}<select class="number-input" aria-label="${label}" data-setting="${name}">${options.map(([id,text])=>`<option value="${id}" ${id===value?'selected':''}>${text}</option>`).join('')}</select></label>`;
/** One modal owns export settings and frozen output. The editor is never transformed for export. */
export class ExportDialog {
 private dialog=document.createElement('dialog');private format:ExportTab='svg';
 private settings=Object.fromEntries(formats.map(f=>[f.id,fresh()])) as Record<ExportTab,Settings>;
 private scope='drawing';private returnFocus:HTMLElement|null=null;private url='';private revision=0;private timer=0;private busy=false;
 private prepared:{contents:string;svg:string;width:number;height:number;pixels:number}|null=null;
 private cache=new Map<string,string>();
 constructor(private editor:CADEditor,private beforeOpen:()=>boolean,private notify:(message:string,kind:'success'|'error')=>void){
  this.dialog.id='export-dialog';this.dialog.className='export-dialog menu-surface';this.dialog.setAttribute('aria-labelledby','export-title');
  this.dialog.innerHTML=`<header class="export-header"><div><h2 id="export-title">Export</h2><p>Create a file for print, cutting or sharing.</p></div><button class="tool" type="button" aria-label="Close export">${icon('close')}</button></header><div class="export-body"><nav class="export-formats" role="tablist" aria-label="Export format" aria-orientation="vertical">${formats.map(f=>`<button type="button" role="tab" id="export-tab-${f.id}" aria-controls="export-options" data-format="${f.id}">${icon(f.icon)}<span>${f.name}</span></button>`).join('')}</nav><div class="export-main"><div class="export-preview"><img alt="Export preview"><p data-preview-empty>No export preview</p></div><p class="export-size" role="status" data-export-size></p><form id="export-options" class="export-options" role="tabpanel"><div class="export-fields"><label>Filename<input class="number-input" id="export-filename" required maxlength="180" autocomplete="off"></label><label>Export area<select class="number-input" id="export-scope"><option value="drawing">Drawing</option><option value="selection">Selection</option></select></label></div><p class="export-format-hint"></p><div class="export-fields" data-format-fields></div><details class="export-advanced"><summary>Advanced</summary><div class="export-fields" data-advanced-fields></div><fieldset class="export-layers"><legend>Layers</legend><p>Checked layers are included, even when hidden. Construction is excluded.</p><div data-export-layers></div></fieldset></details><p class="export-error" role="alert" hidden></p></form></div></div><footer class="export-footer"><span data-export-footer></span><button class="button" type="button" data-export-cancel>Cancel</button><button class="button" type="submit" form="export-options" data-export-submit>Export SVG</button></footer>`;
  document.body.append(this.dialog);
  this.get<HTMLButtonElement>('[aria-label="Close export"]').onclick=()=>this.dialog.close();this.get<HTMLButtonElement>('[data-export-cancel]').onclick=()=>this.dialog.close();
  this.get<HTMLFormElement>('form').onsubmit=e=>{e.preventDefault();void this.download();};
  this.dialog.addEventListener('close',()=>{this.revision++;clearTimeout(this.timer);this.busy=false;this.releasePreview();this.returnFocus?.focus({preventScroll:true});});
  this.dialog.addEventListener('keydown',event=>{
   event.stopPropagation();if(event.key==='Escape'){event.preventDefault();this.dialog.close();}
   const tab=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-format]');
   if(tab&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const i=formats.findIndex(f=>f.id===tab.dataset.format),n=event.key==='Home'?0:event.key==='End'?formats.length-1:(i+(event.key==='ArrowDown'?1:formats.length-1))%formats.length;this.choose(formats[n].id);this.get<HTMLButtonElement>(`[data-format="${this.format}"]`).focus();}
  });
  this.dialog.querySelectorAll<HTMLButtonElement>('[data-format]').forEach(button=>button.onclick=()=>this.choose(button.dataset.format as ExportTab));
  this.get<HTMLSelectElement>('#export-scope').onchange=e=>{this.scope=(e.target as HTMLSelectElement).value;this.refresh();};
  this.dialog.addEventListener('input',event=>{const input=event.target as HTMLInputElement;if(input.id==='export-filename'){this.queue();return;}if(input.matches('[data-setting]')){this.readSetting(input);this.queue();}});
  this.dialog.addEventListener('change',event=>{const input=event.target as HTMLInputElement;if(input.matches('[data-setting]')){this.readSetting(input);this.refresh();}if(input.matches('[data-layer]')){const layers=this.settings[this.format].layers!;input.checked?layers.add(input.dataset.layer!):layers.delete(input.dataset.layer!);this.refresh();}});
 }
 private get<T extends HTMLElement>(selector:string):T{return this.dialog.querySelector<T>(selector)!;}
 open(format?:ExportFormat):void {
  if(document.querySelector('dialog[open]')||!this.beforeOpen())return;
  this.returnFocus=(document.activeElement as HTMLElement)?.getClientRects().length?document.activeElement as HTMLElement:document.querySelector<HTMLElement>('[data-file-trigger]');this.cache.clear();this.revision++;this.busy=false;
  this.dialog.querySelectorAll<HTMLButtonElement|HTMLInputElement|HTMLSelectElement>('button,input,select').forEach(el=>el.disabled=false);
  const name=document.querySelector<HTMLInputElement>('[data-document-name]');this.get<HTMLInputElement>('#export-filename').value=(name?.value??name?.textContent??'Untitled.vectora').replace(/\.vectora$/i,'');
  const scope=this.get<HTMLSelectElement>('#export-scope');scope.querySelector<HTMLOptionElement>('[value="selection"]')!.disabled=!this.editor.selectedItems.length;if(!this.editor.selectedItems.length)this.scope='drawing';scope.value=this.scope;
  this.get<HTMLDetailsElement>('details').open=false;this.dialog.showModal();if(format==='laser')this.settings.dxf.compatibility='laser';this.choose(format==='laser'?'dxf':format??this.format);this.get<HTMLButtonElement>(`[data-format="${this.format}"]`).focus();
 }
 private choose(format:ExportTab):void {
  if(this.busy)return;this.format=format;const settings=this.settings[format],dxf=format==='dxf';
  const layers=this.editor.documentLayers.filter(layer=>layer.data.objectRole!=='construction');
  if(!settings.layers)settings.layers=new Set(layers.filter(layer=>dxf?layer.data.objectRole!=='artwork':layer.visible).map(layer=>layer.data.documentId));
  this.dialog.querySelectorAll<HTMLButtonElement>('[data-format]').forEach(button=>{const active=button.dataset.format===format;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;});
  this.get('form').setAttribute('aria-labelledby',`export-tab-${format}`);
  this.get('.export-format-hint').textContent=formats.find(f=>f.id===format)!.hint;
  this.get('[data-export-submit]').textContent=`Export ${formats.find(f=>f.id===format)!.name}`;
  this.get('[data-export-footer]').textContent=dxf?'Physical size · millimetres':`.${format} · document unchanged`;
  this.get('[data-format-fields]').innerHTML=format==='png'?number('dpi','Resolution (DPI)',settings.dpi,1,2400)+number('pixels','Width (px)',settings.pixels??1,1,16384,'1')+select('background','Background',[['transparent','Transparent'],['colour','Colour']],settings.background)+`<label data-background-colour>Background colour<input type="color" data-setting="colour" value="${settings.colour}"></label>`:format==='svg'?number('width','Width (mm)',settings.width??1,.001,1000000)+number('margin','Margin (mm)',settings.margin,0,10000):format==='pdf'?select('page','Page size',[['fit','Fit drawing'],['a4','A4 (210 × 297 mm)'],['a3','A3 (297 × 420 mm)'],['letter','Letter (216 × 279 mm)']],settings.page)+select('orientation','Orientation',[['portrait','Portrait'],['landscape','Landscape']],settings.orientation)+number('margin','Margin (mm)',settings.margin,0,1000)+number('scale','Scale (%)',settings.scale,.01,10000):select('compatibility','Compatibility',[['standard','Standard DXF (2000)'],['laser','Laser-compatible DXF (R12)']],settings.compatibility)+'<p class="export-wide">Paths remain at their original size. Fills export as outlines.</p>';
  this.get('[data-advanced-fields]').innerHTML=dxf?number('tolerance','Curve tolerance (mm)',settings.tolerance,.001,1)+check('origin','Move to origin',settings.origin):format==='svg'?check('groups','Preserve layer groups',settings.groups):'<p class="export-wide">Artwork exports black in both themes. Explicit fill colours are preserved.</p>';
  const list=this.get('[data-export-layers]');list.replaceChildren();for(const layer of layers){const label=document.createElement('label');label.className='export-check';const input=document.createElement('input');input.type='checkbox';input.dataset.layer=layer.data.documentId;input.checked=settings.layers.has(layer.data.documentId);label.append(input,document.createTextNode(layer.name));list.append(label);}
  this.refresh();
 }
 private readSetting(input:HTMLInputElement):void {
  const key=input.dataset.setting as keyof Settings,s=this.settings[this.format];
  if(input.type==='checkbox')(s as unknown as Record<string,unknown>)[key]=input.checked;
  else (s as unknown as Record<string,unknown>)[key]=input.type==='number'?input.valueAsNumber:input.value;
  if(key==='dpi')s.pixels=null;
 }
 private queue():void {this.prepared=null;this.get<HTMLButtonElement>('[data-export-submit]').disabled=true;clearTimeout(this.timer);this.timer=window.setTimeout(()=>this.refresh(),120);}
 private releasePreview():void {if(this.url)URL.revokeObjectURL(this.url);this.url='';}
 private refresh():void {
  clearTimeout(this.timer);this.prepared=null;const error=this.get('.export-error'),button=this.get<HTMLButtonElement>('[data-export-submit]');error.hidden=true;button.disabled=true;
  const form=this.get<HTMLFormElement>('form');
  try{
   const s=this.settings[this.format],dxf=this.format==='dxf';
   if(dxf)this.get('.export-format-hint').textContent=s.compatibility==='laser'?'DXF R12 · basic lines · choose millimetres when importing':'DXF 2000 · millimetres · circles, arcs & polylines';
   if(this.format==='pdf')this.get<HTMLSelectElement>('[data-setting="orientation"]').disabled=s.page==='fit';
   const objects=(this.scope==='selection'?this.editor.selectedItems:this.editor.objects).filter(item=>s.layers!.has(item.layer.data.documentId)&&!item.layer.data.deleted&&(dxf||item.visible));
   if(!objects.length)throw new Error('No objects in the chosen area and layers. Choose another area or include a layer.');
   let contents='',svg='',pixels=0;
   if(dxf&&!form.checkValidity())throw new Error('Check the highlighted export settings.');
   const cacheKey=JSON.stringify([this.scope,[...s.layers!],dxf?s.tolerance:'svg',dxf?s.compatibility:'svg']);
   let source=this.cache.get(cacheKey);if(!source){source=dxf?exportDXF(objects,true,s.compatibility,s.tolerance):exportSVG(objects,true);this.cache.set(cacheKey,source);}
   if(dxf){if(!form.checkValidity())throw new Error('Check the highlighted export settings.');contents=s.origin?dxfAtOrigin(source):source;svg=previewDXF(contents);}
   else{
    const base=exportImageSource(source);
    if(this.format==='png'){
     pixels=s.pixels??Math.max(1,Math.ceil(base.width*s.dpi/25.4-1e-7));if(s.pixels===null)this.get<HTMLInputElement>('[data-setting="pixels"]').value=String(pixels);
     const colour=this.get('[data-background-colour]');colour.hidden=s.background!=='colour';
     if(pixels>16384||Math.round(pixels*base.height/base.width)>16384||pixels*Math.round(pixels*base.height/base.width)>32000000)throw new Error('PNG exceeds 32 megapixels or 16,384 pixels per side. Reduce the pixel width or DPI.');
     svg=source;
    }else if(this.format==='svg'){
     if(s.width===null)this.get<HTMLInputElement>('[data-setting="width"]').value=String(base.width);
     svg=layoutSVG(source,{scale:s.width===null?1:s.width/base.width,margin:s.margin,groups:s.groups});
    }else{
     const sizes:Record<string,[number,number]>={a4:[210,297],a3:[297,420],letter:[215.9,279.4]};let page=sizes[s.page];if(page&&s.orientation==='landscape')page=[page[1],page[0]];
     svg=layoutSVG(source,{scale:s.scale/100,margin:s.margin,page});const size=exportImageSource(svg);if(size.width>5080||size.height>5080)throw new Error('PDF supports a maximum page size of 5,080 mm per side.');
    }
    if(!form.checkValidity())throw new Error('Check the highlighted export settings.');contents=svg;
   }
   const size=exportImageSource(svg);if(dxf){size.width=Number(size.svg.getAttribute('data-export-width'));size.height=Number(size.svg.getAttribute('data-export-height'));}this.prepared={contents,svg,width:size.width,height:size.height,pixels};
   const py=Math.max(1,Math.round(pixels*size.height/size.width));this.get('[data-export-size]').textContent=this.format==='png'?`${pixels} × ${py} px · ${s.dpi} DPI · ${(pixels*25.4/s.dpi).toFixed(2)} × ${(py*25.4/s.dpi).toFixed(2)} mm`:`${size.width.toFixed(2)} × ${size.height.toFixed(2)} mm${this.format==='pdf'?` · ${s.scale}% scale`:''}`;
   this.releasePreview();this.url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));const img=this.get<HTMLImageElement>('.export-preview img');img.src=this.url;img.hidden=false;this.get('[data-preview-empty]').hidden=true;
   this.get('.export-preview').style.background=this.format==='png'?(s.background==='colour'?s.colour:''):this.format==='pdf'?'#ffffff':'';
   button.disabled=this.busy;
  }catch(e){error.textContent=e instanceof Error?e.message:String(e);error.hidden=false;this.releasePreview();this.get('.export-preview img').hidden=true;this.get('[data-preview-empty]').hidden=false;this.get('[data-export-size]').textContent='';}
 }
 private async download():Promise<void> {
  if(this.busy)return;this.refresh();if(!this.prepared||!this.get<HTMLFormElement>('form').reportValidity())return;
  const name=this.get<HTMLInputElement>('#export-filename').value.trim().replace(/\.(svg|png|pdf|dxf)$/i,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'');if(!name){this.get<HTMLInputElement>('#export-filename').focus();return;}
  const format=this.format,s={...this.settings[format]},snapshot=this.prepared,revision=++this.revision;this.busy=true;
  const controls=[...this.dialog.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement>('button,input,select')].filter(el=>!el.matches('[data-export-cancel],[aria-label="Close export"]'));controls.forEach(el=>el.disabled=true);this.get('[data-export-submit]').setAttribute('aria-busy','true');
  try{
   const blob=format==='png'?await exportPNG(snapshot.contents,{dpi:s.dpi,width:snapshot.pixels,background:s.background==='colour'?s.colour:undefined}):format==='pdf'?await (await import('./exportPDF')).exportPDF(snapshot.contents):new Blob([snapshot.contents],{type:format==='svg'?'image/svg+xml':'application/dxf'});
   if(revision!==this.revision||!this.dialog.open)return;
   const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=`${name}.${format}`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),60000);this.dialog.close();this.notify(format==='dxf'&&s.compatibility==='laser'?'Laser-compatible DXF prepared. Choose millimetres when importing.':`${format.toUpperCase()} prepared for download.`,'success');
  }catch(e){if(revision===this.revision&&this.dialog.open){this.get('.export-error').textContent=e instanceof Error?e.message:String(e);this.get('.export-error').hidden=false;}}
  finally{if(revision===this.revision){this.busy=false;controls.forEach(el=>el.disabled=false);}this.get('[data-export-submit]').removeAttribute('aria-busy');}
 }
}
