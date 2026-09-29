import type {CADEditor} from './editor';
import {analyzeLaserJob,type LaserJobAnalysis,type LaserJobPath} from './laserPreflight';
import {validateLaserJobSettings,type LaserJobSettings} from './laserJob';

const SVG_NS='http://www.w3.org/2000/svg';
const icon=(name:string)=>`<svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-${name}"/></svg>`;
const input=(name:string,label:string,value:number,min:number,max:number)=>`<label>${label}<span class="laser-number-shell"><input class="number-input" type="number" inputmode="decimal" data-laser-${name} aria-label="${label}" min="${min}" max="${max}" step="any" value="${value}"><span>mm</span></span></label>`;

/** Read-only bed and operation view; only validated settings enter document history. */
export class LaserPreflightDialog {
  private dialog=document.createElement('dialog');
  private report:LaserJobAnalysis|null=null;
  private generation=0;
  private timer=0;
  private stage='all';
  private showKerf=true;
  private focusedId:string|null=null;
  constructor(private editor:CADEditor,private trigger:HTMLButtonElement,private onExport:()=>void){
    const settings=editor.laserJobSettings;
    this.dialog.id='laser-preflight-dialog';this.dialog.className='laser-preflight-dialog menu-surface';this.dialog.setAttribute('aria-labelledby','laser-preflight-title');
    this.dialog.innerHTML=`<header class="laser-header"><div><h2 id="laser-preflight-title">Laser preflight</h2><p>Check the job at actual size before exporting.</p></div><button type="button" class="tool" data-laser-close aria-label="Close laser preflight">${icon('close')}</button></header><div class="laser-body"><aside class="laser-settings"><h3>Job settings</h3><div class="laser-settings-grid">${input('bed-width','Bed width',settings.bedWidthMM,1,10000)}${input('bed-height','Bed height',settings.bedHeightMM,1,10000)}${input('kerf','Measured kerf',settings.kerfMM,0,10)}<label>Operation order<select class="number-input" data-laser-order aria-label="Operation order"><option value="engrave-cut">Engrave → Cut</option><option value="cut-engrave">Cut → Engrave</option></select></label></div><p class="laser-field-error" role="alert" hidden></p><div class="laser-checks"><h3>Preflight <span data-laser-status></span></h3><ul data-laser-issues></ul></div></aside><section class="laser-preview-panel" aria-label="Laser job preview"><div class="laser-preview-controls"><label>Show<select class="number-input" data-laser-stage aria-label="Preview stage"><option value="all">All operations</option><option value="engrave">Engrave</option><option value="cutline">Cut</option></select></label><label class="laser-check"><input type="checkbox" data-laser-kerf-overlay checked> Show kerf band</label></div><div class="laser-preview-frame"><svg data-laser-preview role="img" aria-label="Unscaled laser bed and job preview"></svg></div><p class="laser-measurements" data-laser-measurements></p><p class="laser-explanation">All Cut and Engrave layers are included, even when hidden or locked. Bed placement is illustrative and never scales the design.</p></section></div><footer class="laser-footer"><span>Kerf is visual only. DXF exports original paths; set compensation in laser software.</span><button type="button" class="button" data-laser-close>Close</button><button type="button" class="button laser-export" data-laser-export>Continue to DXF export</button></footer>`;
    document.body.append(this.dialog);
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-laser-close]').forEach(button=>button.onclick=()=>this.close());
    this.dialog.querySelector<HTMLButtonElement>('[data-laser-export]')!.onclick=()=>{this.close();this.onExport();};
    this.dialog.addEventListener('close',()=>{clearTimeout(this.timer);this.generation++;this.trigger.setAttribute('aria-expanded','false');this.trigger.classList.remove('selected');this.trigger.focus({preventScroll:true});});
    this.dialog.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();this.close();}});
    this.dialog.addEventListener('input',event=>{const target=event.target as HTMLElement;if(target.matches('[data-laser-bed-width],[data-laser-bed-height],[data-laser-kerf]'))this.validateDraft();});
    this.dialog.addEventListener('change',event=>{
      const target=event.target as HTMLElement;
      if(target.matches('[data-laser-bed-width],[data-laser-bed-height],[data-laser-kerf],[data-laser-order]'))this.commitSettings();
      else if(target.matches('[data-laser-stage]')){this.stage=(target as HTMLSelectElement).value;this.renderPaths();}
      else if(target.matches('[data-laser-kerf-overlay]')){this.showKerf=(target as HTMLInputElement).checked;this.renderPaths();}
    });
  }
  private get<T extends Element>(selector:string):T{return this.dialog.querySelector<T>(selector)!;}
  open():void {
    if(this.dialog.open||document.querySelector('dialog[open]'))return;
    this.focusedId=null;this.stage='all';this.showKerf=true;
    this.get<HTMLSelectElement>('[data-laser-stage]').value='all';this.get<HTMLInputElement>('[data-laser-kerf-overlay]').checked=true;
    this.syncFields();this.dialog.showModal();this.trigger.setAttribute('aria-expanded','true');this.trigger.classList.add('selected');
    this.get<HTMLInputElement>('[data-laser-bed-width]').focus();this.refreshIfOpen();
  }
  close():void {if(this.dialog.open)this.dialog.close();}
  refreshIfOpen():void {
    if(!this.dialog.open)return;
    clearTimeout(this.timer);const revision=++this.generation;
    this.timer=window.setTimeout(()=>{if(!this.dialog.open||revision!==this.generation)return;this.report=analyzeLaserJob(this.editor.objects,this.editor.laserJobSettings);this.syncFields();this.render();},60);
  }
  private syncFields():void {
    const settings=this.editor.laserJobSettings;
    for(const [key,value] of [['bed-width',settings.bedWidthMM],['bed-height',settings.bedHeightMM],['kerf',settings.kerfMM]] as const){
      const field=this.get<HTMLInputElement>(`[data-laser-${key}]`);
      if(document.activeElement!==field||!field.getAttribute('aria-invalid'))field.value=String(value);
    }
    this.get<HTMLSelectElement>('[data-laser-order]').value=settings.order;
  }
  private draft():LaserJobSettings {
    return validateLaserJobSettings({bedWidthMM:this.get<HTMLInputElement>('[data-laser-bed-width]').valueAsNumber,bedHeightMM:this.get<HTMLInputElement>('[data-laser-bed-height]').valueAsNumber,kerfMM:this.get<HTMLInputElement>('[data-laser-kerf]').valueAsNumber,order:this.get<HTMLSelectElement>('[data-laser-order]').value});
  }
  private validateDraft():void {
    clearTimeout(this.timer);const revision=++this.generation;
    this.timer=window.setTimeout(()=>{if(!this.dialog.open||revision!==this.generation)return;try{this.draft();this.get<HTMLElement>('.laser-field-error').hidden=true;}catch(error){const message=this.get<HTMLElement>('.laser-field-error');message.textContent=(error as Error).message;message.hidden=false;}},120);
  }
  private commitSettings():void {
    try{
      const settings=this.draft();this.editor.setLaserJobSettings(settings);
      this.syncStageLabels();
      this.dialog.querySelectorAll<HTMLInputElement|HTMLSelectElement>('.laser-settings-grid input,.laser-settings-grid select').forEach(field=>field.setAttribute('aria-invalid','false'));
      this.get<HTMLElement>('.laser-field-error').hidden=true;this.refreshIfOpen();
    }catch(error){
      const active=document.activeElement as HTMLInputElement|HTMLSelectElement;if(active?.matches('.laser-settings-grid input,.laser-settings-grid select'))active.setAttribute('aria-invalid','true');
      const message=this.get<HTMLElement>('.laser-field-error');message.textContent=(error as Error).message;message.hidden=false;
    }
  }
  private render():void {
    const report=this.report;if(!report)return;
    this.syncStageLabels();
    const status=this.get<HTMLElement>('[data-laser-status]');
    status.textContent=report.complete?`${report.issues.length} ${report.issues.length===1?'issue':'issues'}`:'Check incomplete';
    status.className=report.complete&&report.issues.length===0?'is-ready':'has-issues';
    const list=this.get<HTMLUListElement>('[data-laser-issues]');list.replaceChildren();
    if(!report.issues.length){const row=document.createElement('li');row.textContent='No issues found in the checked geometry.';list.append(row);}
    for(const issue of report.issues){
      const row=document.createElement('li');row.className=`laser-issue laser-issue-${issue.severity}`;
      if(issue.objectId){const button=document.createElement('button');button.type='button';button.textContent=issue.message;button.onclick=()=>{this.focusedId=issue.objectId!;this.renderPaths();};row.append(button);}
      else row.textContent=issue.message;
      list.append(row);
    }
    this.get<HTMLButtonElement>('[data-laser-export]').disabled=!report.paths.length||!report.complete;
    this.get<HTMLElement>('[data-laser-measurements]').textContent=`Job ${report.bounds.width.toFixed(2)} × ${report.bounds.height.toFixed(2)} mm · Cut ${report.cutLengthMM.toFixed(2)} mm · Engrave ${report.engraveLengthMM.toFixed(2)} mm`;
    this.renderPaths();
  }
  private syncStageLabels():void {
    const select=this.get<HTMLSelectElement>('[data-laser-stage]');
    const order=this.editor.laserJobSettings.order==='engrave-cut'?['engrave','cutline']:['cutline','engrave'];
    for(const [index,role] of order.entries()){
      const option=select.querySelector<HTMLOptionElement>(`option[value="${role}"]`)!;
      option.textContent=`Step ${index+1} · ${role==='cutline'?'Cut':'Engrave'}`;
      select.append(option);
    }
  }
  private renderPaths():void {
    const report=this.report;if(!report)return;
    const settings=this.editor.laserJobSettings,svg=this.get<SVGSVGElement>('[data-laser-preview]');svg.replaceChildren();
    const margin=Math.max(8,Math.min(settings.bedWidthMM,settings.bedHeightMM)*.06);
    const extentWidth=Math.max(settings.bedWidthMM,report.bounds.width+settings.kerfMM);
    const extentHeight=Math.max(settings.bedHeightMM,report.bounds.height+settings.kerfMM);
    svg.setAttribute('viewBox',`${-margin-(extentWidth-settings.bedWidthMM)/2} ${-margin-(extentHeight-settings.bedHeightMM)/2} ${extentWidth+margin*2} ${extentHeight+margin*2}`);
    const bed=document.createElementNS(SVG_NS,'rect');bed.classList.add('laser-bed');bed.setAttribute('x','0');bed.setAttribute('y','0');bed.setAttribute('width',String(settings.bedWidthMM));bed.setAttribute('height',String(settings.bedHeightMM));svg.append(bed);
    if(!report.paths.length)return;
    const dx=(settings.bedWidthMM-report.bounds.width)/2-report.bounds.x;
    const dy=(settings.bedHeightMM-report.bounds.height)/2-report.bounds.y;
    const group=document.createElementNS(SVG_NS,'g');group.setAttribute('transform',`translate(${dx} ${dy})`);group.classList.add('laser-job-geometry');svg.append(group);
    for(const path of report.paths)this.appendPath(group,path,settings.kerfMM);
  }
  private appendPath(group:SVGGElement,path:LaserJobPath,kerf:number):void {
    const dimmed=this.stage!=='all'&&this.stage!==path.role,highlighted=this.focusedId===path.objectId;
    if(path.role==='cutline'&&this.showKerf&&kerf>0){
      const band=document.createElementNS(SVG_NS,'path');band.setAttribute('d',path.d);band.setAttribute('fill','none');band.setAttribute('stroke-width',String(kerf));band.setAttribute('data-kerf-band','');band.classList.add('laser-kerf-band');if(dimmed)band.classList.add('is-dimmed');group.append(band);
    }
    const element=document.createElementNS(SVG_NS,'path');element.setAttribute('d',path.d);element.setAttribute('data-operation',path.role);element.setAttribute('data-object-id',path.objectId);
    element.classList.add('laser-operation-path',`laser-${path.role}`);if(path.filled)element.classList.add('is-filled');if(dimmed)element.classList.add('is-dimmed');if(highlighted)element.classList.add('is-highlighted');group.append(element);
  }
}
